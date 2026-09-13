/**
 * Interactive loop of the terminal surface.
 *
 * The loop owns the lower zone — an optional overlay, the composer, and the
 * status line — and redraws only those rows in place; the conversation above it
 * is appended to the scrollback and never re-rendered, which is what keeps a
 * long session cheap in `inline` mode (`UI.md` §10).
 *
 * Interruption follows `ARCHITECTURE.md` §4.1: the first Ctrl+C or Esc cancels
 * the running turn (or clears the draft when nothing runs), a second Ctrl+C
 * within {@link INTERRUPT_WINDOW_MS} leaves the process, and Ctrl+D leaves on an
 * empty draft. Esc never exits.
 * @module @kibborg/client-node/repl
 */

import { stdin, stdout } from 'node:process'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import {
  appendHistory,
  commandMenuItems,
  completeDraft,
  completionHint,
  composerCursorColumn,
  createApp,
  createLogRenderer,
  cursorColumn,
  cursorUp,
  ERASE_DOWN,
  historyPath,
  loadHistory,
  paletteForTheme,
  panelBodyLines,
  panelLines,
  permissionDialog,
  plainPalette,
  questionDialog,
  statusLine,
  zoneLines,
  type App,
  type CompletionSources,
  type DialogView,
  type KeyEvent,
  type MenuItem,
  type Palette,
} from '@kibborg/tui'
import { runTurn } from './turn.ts'
import { createEscapeIdle } from './escape-idle.ts'
import { renderSessionHistory } from './history-render.ts'
import { readHistoryEvents } from './sessions.ts'
import { copyToClipboard } from './transcript.ts'
import { openTarget } from './open-target.ts'
import type { CommandOutcome } from './remote.ts'
import type { SurfaceState } from './command-router.ts'
import { nearestCommand, splitCommand } from './command-router.ts'
import { actOnPanel, movePanelSelection, switchPanelTab, type PanelSession, type PanelState } from './panel.ts'
import type { SurfaceSettings } from './surface-settings.ts'
import type {
  ApprovalDecision,
  PendingApproval,
  PendingQuestion,
  QuestionAnswer,
} from './interaction.ts'
import { parseAnswerLine } from './interaction.ts'

/** Two Ctrl+C presses within this window leave the process. */
export const INTERRUPT_WINDOW_MS = 800

/** Version shown in the surface's brand header; it tracks the package version. */
const SURFACE_VERSION = 'v0.1.0'

/** ANSI escape sequences, stripped when a line moves into the transcript log. */
const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/gu

/** What the interactive loop needs from its host. */
export interface ReplOptions {
  /** The in-process client. */
  readonly client: IApiClient
  /** The session every submitted task goes to. */
  readonly sessionId: SessionId
  /**
   * Live surface state: the loop reads the model, permission badge, and git
   * context from it, and a local slash command such as `/model` updates the
   * same object, so the status line never drifts from what is in force.
   */
  readonly state: SurfaceState
  /** Harness home, where the input history lives. */
  readonly home: string
  /** Behaviour this surface reads from its `kibborg-cli` settings section. */
  readonly settings: SurfaceSettings
  /** Candidate sets the Tab key completes from; its command names classify a slash line. */
  readonly sources: CompletionSources
  /** Runs a slash command; the local router owns its own lines and delegates the rest. */
  readonly onCommand: (line: string, write: (chunk: string) => void) => Promise<CommandOutcome>
  /** The tabs modal: how to read its registries and what to act through. */
  readonly panel: {
    /** Read every registry and return the modal's opening state. */
    open(): Promise<PanelState>
    /** The services and session the modal's actions write through. */
    readonly session: PanelSession
  }
}

/** Whether a slash line names a command this surface or the host registers. */
function namesCommand(line: string, sources: CompletionSources): boolean {
  const name = splitCommand(line).name
  return name !== '' && sources.commands.includes(name)
}

/**
 * Run the interactive loop until the user leaves.
 * @param options - client, session, status values, and the history location.
 * @returns the process exit code.
 */
export async function runInteractive(options: ReplOptions): Promise<number> {
  const cols = stdout.columns ?? 88
  const innerWidth = Math.max(20, cols - 4)
  const palette: Palette = paletteForTheme(options.settings.theme, process.env, true)
  const write = (chunk: string): void => void stdout.write(chunk)

  /**
   * The fullscreen surface owns the terminal when output is a terminal and the
   * caller did not ask for the inline layout with `KIBBORG_INLINE=1`. It keeps
   * the brand header, the transcript, and the composer static instead of
   * reprinting them, and drives scrolling from the mouse wheel.
   */
  const app: App | undefined = stdout.isTTY === true && process.env['KIBBORG_INLINE'] !== '1'
    ? createApp({
        stdout,
        stdin,
        palette,
        version: SURFACE_VERSION,
        cwd: process.cwd().replace(/\\/gu, '/'),
        status: {
          model: options.state.model,
          mode: options.state.mode,
          contextPercent: 0,
          ...(options.state.branch === undefined ? {} : { branch: options.state.branch }),
          ...(options.state.dirty === undefined ? {} : { dirty: options.state.dirty }),
        },
        welcome: {
          version: SURFACE_VERSION,
          cwd: process.cwd().replace(/\\/gu, '/'),
          model: options.state.model,
          mode: options.state.mode,
          tick: 0,
          recent: [],
          ...(options.state.branch === undefined ? {} : { branch: options.state.branch }),
          ...(options.state.dirty === undefined ? {} : { dirty: options.state.dirty }),
        },
      })
    : undefined

  /** The slash palette's entries: the commands this surface and the host register. */
  const menuItems: readonly MenuItem[] = commandMenuItems(options.sources.commands)

  /** The request box for whatever the surface is waiting on, if anything. */
  const currentDialog = (): DialogView | null => {
    if (approval !== undefined) {
      return permissionDialog({
        tool: approval.pending.toolName,
        target: approval.pending.reason ?? '',
      })
    }
    if (question !== undefined) {
      const pending = question.pending
      const current = pending.questions[question.index]
      if (current === undefined) return null
      return questionDialog({
        question: current.question,
        index: question.index + 1,
        total: pending.questions.length,
        options: (current.options ?? []).map(option => option.label),
        selected: 0,
        ...(current.multiSelect === true ? { multi: true } : {}),
      })
    }
    return null
  }

  /**
   * The tabs modal as a request box.
   *
   * The surface owns the composed screen, so an open modal has to reach it
   * through the box slot; a box carries plain spans, so the modal's own colors
   * are not applied twice.
   */
  const panelDialog = (): DialogView | null => {
    if (panel === undefined) return null
    const lines = panelBodyLines(panel.view, { palette: plainPalette, cols: stdout.columns ?? 80 })
    return {
      token: 'Subtle',
      label: 'panel',
      // The box draws the frame and the arrows stay with this loop: the modal
      // keeps its own selection, which the box would otherwise replace.
      passthroughArrows: true,
      lines: lines.map(text => ({ spans: [{ text, token: 'Text' as const }] })),
    }
  }

  const historyFile = historyPath(options.home)
  const history: string[] = [...loadHistory(historyFile)]
  let historyIndex = history.length
  /** The session this loop talks to; `/new` and the session picker replace it. */
  let sessionId: SessionId = options.sessionId
  let draft = ''
  let overlay: readonly string[] = []
  let hint = ''
  /** The tabs modal, while it is open. */
  let panel: PanelState | undefined
  /** One line of feedback shown inside the modal. */
  let panelStatus = ''
  let contextPercent = 0
  let zoneHeight = 0
  let running = false
  /** True while a slash command runs: it owns the screen until it finishes. */
  let commandBusy = false
  let controller: AbortController | undefined
  let lastInterrupt = 0
  let approval: { readonly pending: PendingApproval; readonly resolve: (decision: ApprovalDecision) => void } | undefined
  let question: {
    readonly pending: PendingQuestion
    readonly resolve: (answers: readonly QuestionAnswer[] | undefined) => void
    readonly collected: QuestionAnswer[]
    index: number
  } | undefined

  /** Overlay rows describing whatever the surface is waiting on. */
  const pendingOverlay = (): readonly string[] => {
    if (approval !== undefined) {
      const tool = approval.pending.toolName
      const reason = approval.pending.reason === undefined ? '' : ` — ${approval.pending.reason}`
      return [
        `  ${palette.paint('approval', 'Warn')}  ${palette.paint(tool, 'Text')}${palette.paint(reason, 'Muted')}`,
        `  ${palette.paint('[y] once   [a] always   [n] deny   [esc] deny', 'Muted')}`,
      ]
    }
    if (question !== undefined) {
      const current = question.pending.questions[question.index]
      if (current === undefined) return []
      const lines = [
        `  ${palette.paint(current.question, 'Text')}`,
      ]
      if (current.detail !== undefined) {
        for (const line of current.detail.split('\n').slice(0, 12)) lines.push(`  ${palette.paint(line, 'Muted')}`)
      }
      const options = current.options ?? []
      for (const [index, option] of options.entries()) {
        lines.push(`    ${palette.paint(`${String(index + 1)}.`, 'Accent')} ${palette.paint(option.label, 'Text')}`)
      }
      const hint = current.multiSelect === true
        ? '  type option numbers separated by commas, or other:<text>'
        : '  type an option number, or other:<text>'
      lines.push(`  ${palette.paint(hint, 'Muted')}`)
      return lines
    }
    return []
  }

  /**
   * Ask the terminal to answer an approval.
   *
   * The wire accepts only a grant or a refusal; the third key offered here is
   * the same grant with an explicit note that a durable rule belongs to the
   * permission preset, not to this answer.
   */
  const askApproval = (pending: PendingApproval): Promise<ApprovalDecision> =>
    new Promise<ApprovalDecision>(resolve => {
      approval = { pending, resolve }
      overlay = pendingOverlay()
      drawZone()
    })

  /** Ask the terminal to answer a batch of questions, one at a time. */
  const askQuestion = (pending: PendingQuestion): Promise<readonly QuestionAnswer[] | undefined> =>
    new Promise<readonly QuestionAnswer[] | undefined>(resolve => {
      question = { pending, resolve, collected: [], index: 0 }
      draft = ''
      overlay = pendingOverlay()
      drawZone()
    })

  /** Resolve the active question with the line the user typed. */
  const answerCurrentQuestion = (text: string): void => {
    const active = question
    if (active === undefined) return
    const current = active.pending.questions[active.index]
    if (current === undefined) return
    const trimmed = text.trim()
    const parsed = parseAnswerLine(trimmed, (current.options ?? []).map(option => option.label), current.multiSelect === true)
    if (parsed === undefined) {
      note('  (that was not an option number; try again)\n')
      drawZone()
      return
    }
    const answer: QuestionAnswer = {
      id: current.id,
      selected: parsed.selected,
      ...(parsed.custom === undefined ? {} : { custom: parsed.custom }),
    }
    active.collected.push(answer)
    draft = ''
    active.index += 1
    if (active.index >= active.pending.questions.length) {
      question = undefined
      overlay = []
      active.resolve(active.collected)
    } else {
      overlay = pendingOverlay()
    }
    drawZone()
  }

  const drawZone = (): void => {
    if (app !== undefined) {
      app.setDraft(draft)
      app.setHint(hint)
      app.setDialog(currentDialog() ?? panelDialog())
      app.render()
      return
    }
    // Park the cursor at column 1 first: a row move keeps the column, and
    // erasing from a mid-row cursor would leave the previous text's head behind.
    if (zoneHeight > 0) write(`\r${cursorUp(zoneHeight)}${ERASE_DOWN}`)
    // An open request owns the overlay; then the tabs modal; otherwise the
    // overlay carries the completion hint.
    const overlayLines = overlay.length > 0
      ? overlay
      : panel !== undefined
        ? [
            ...panelLines(panel.view, { palette, cols }),
            ...(panelStatus === '' ? [] : [`  ${palette.paint(panelStatus, 'Muted')}`]),
          ]
        : hint === ''
          ? []
          : [`  ${palette.paint(hint, 'Muted')}`]
    const lines = zoneLines({
      draft,
      innerWidth,
      showHint: !running,
      status: {
        model: options.state.model,
        contextPercent,
        mode: running ? `${options.state.mode} ·` : options.state.mode,
        ...(options.state.branch === undefined ? {} : { branch: options.state.branch }),
        ...(options.state.dirty === undefined ? {} : { dirty: options.state.dirty }),
      },
      cols,
      ...(overlayLines.length === 0 ? {} : { overlay: overlayLines }),
    }, palette)
    write(`${lines.join('\n')}\n`)
    zoneHeight = lines.length
    const toInputRow = zoneHeight - (overlayLines.length + 1)
    if (toInputRow > 0) write(cursorUp(toInputRow))
    write(cursorColumn(composerCursorColumn(draft, innerWidth)))
  }

  const clearZone = (): void => {
    if (app !== undefined) return
    if (zoneHeight > 0) {
      write(`\r${cursorUp(zoneHeight)}${ERASE_DOWN}`)
      zoneHeight = 0
    }
  }

  /**
   * Print one line above the zone without losing it.
   *
   * The zone is redrawn from the cursor downwards, so anything printed while it
   * still occupies the screen is erased by that redraw; lifting the zone first
   * keeps notes, cancellations, and approvals visible in the scrollback.
   * @param text - the line to print, ending in a newline.
   */
  const note = (text: string): void => {
    if (app !== undefined) {
      const plain = text.replace(ANSI_PATTERN, '').trim()
      // A log entry renders as one row, so a multi-line answer (a status block,
      // a listing) becomes one entry per line instead of losing all but its head.
      for (const line of plain.split('\n')) {
        const trimmed = line.trimEnd()
        if (trimmed !== '') app.log.append({ kind: 'info', text: trimmed })
      }
      app.render()
      return
    }
    clearZone()
    write(text)
  }

  /**
   * Report one line of output.
   *
   * The composed surface owns the screen, so its output has to enter the log;
   * writing straight to stdout would paint under the next frame and leave only
   * whatever the frame did not repaint.
   * @param text - the text to report, ending in a newline.
   */
  const emit = (text: string): void => {
    if (app !== undefined) note(text)
    else write(text)
  }

  /**
   * The handler waiting for a pick from a list the surface opened.
   *
   * `/model`, `/effort`, `/permission`, `/resume` need one more decision, so the
   * command opens a list instead of printing text; the pick arrives through the
   * palette callback and is applied here.
   */
  let choosing: ((name: string) => Promise<void>) | undefined

  /**
   * Show one list of choices and apply the pick.
   *
   * Every list starts with a way back, because a nested list has to answer "how
   * do I leave this" with a visible row and not only with a key the user has to
   * guess.
   * @param items - the choices, described the same way palette entries are.
   * @param title - what is being chosen; it titles the frame.
   * @param apply - called with the picked entry name.
   */
  const chooseFrom = (items: readonly MenuItem[], title: string, apply: (name: string) => Promise<void>): void => {
    if (items.length === 0) {
      emit('  нечего выбирать\n')
      return
    }
    if (app === undefined) {
      for (const item of items) write(`  ${item.name}   ${item.desc}\n`)
      return
    }
    choosing = async name => {
      if (name === BACK_ENTRY) {
        backToCommands()
        return
      }
      await apply(name)
    }
    // The way back leads the list but is not preselected: Enter picks the first
    // real choice, and the back row is one arrow away.
    app.openMenu([{ group: 'НАВИГАЦИЯ', name: BACK_ENTRY, desc: 'вернуться к списку команд' }, ...items], title, 1)
  }

  /**
   * Close a nested list and show the command palette again.
   *
   * Going back means "one level up", not "leave everything": the palette comes
   * back with the same list of commands the user started from, and a second
   * `Escape` closes it.
   */
  const backToCommands = (): void => {
    choosing = undefined
    app?.closeMenu()
    app?.setMenuItems(menuItems)
    draft = app === undefined ? '' : '/'
    app?.setDraft(draft)
    hint = ''
    drawZone()
  }

  /** Close the palette and leave the composer empty. */
  const closePalette = (): void => {
    choosing = undefined
    draft = ''
    hint = ''
    app?.setMenuItems(menuItems)
    app?.closeMenu()
    drawZone()
  }

  /** Move this loop to another session and show what it contains. */
  const adoptSession = async (id: SessionId, label: string): Promise<void> => {
    sessionId = id
    emit(`  ${label}: ${sessionId}\n`)
    const read = await readHistoryEvents(options.client, id)
    if (read === undefined) return
    renderSessionHistory(read.events, {
      palette,
      cols: stdout.columns ?? 88,
      sink: {
        write: chunk => {
          for (const line of chunk.split('\n')) {
            if (line.trim() !== '') emit(`${line}\n`)
          }
        },
      },
    })
  }

  /** Set once the interactive loop owns the streams, so `/quit` can end it. */
  let requestExit: ((code: number) => void) | undefined

  /**
   * The row every nested list starts with: picking it leaves the list.
   *
   * It is a real entry rather than only a key hint, so a list a user fell into
   * always shows the way out on screen.
   */
  const BACK_ENTRY = '↩ назад'

  /** The commands this surface answers itself, with the decision each one asks for. */
  const surfaceCommands: Record<string, () => Promise<void>> = {
    '/new': async () => {
      const created = await options.client.sessions.create({ cwd: process.cwd() })
      if (!created.result.ok) {
        emit(`  не удалось создать сессию: ${created.result.error.message}\n`)
        return
      }
      await adoptSession(created.result.value.sessionId, 'новая сессия')
    },
    '/resume': async () => {
      const listed = await options.client.sessions.list({})
      if (!listed.result.ok) {
        emit(`  не удалось прочитать сессии: ${listed.result.error.message}\n`)
        return
      }
      const items = [...listed.result.value.items]
        .filter(item => item.blank !== true)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, 20)
        .map(item => ({ group: 'SESSION', name: item.sessionId, desc: item.cwd ?? '' }))
      chooseFrom(items, 'сессия', async name => { await adoptSession(name as SessionId, 'сессия') })
    },
    '/model': async () => {
      const catalog = await options.client.sessions.models({ sessionId })
      if (!catalog.result.ok) {
        emit(`  каталог моделей недоступен: ${catalog.result.error.message}\n`)
        return
      }
      const current = options.state.model
      const items = catalog.result.value.groups.flatMap(group => group.models.map(model => ({
        group: group.id,
        name: model.id,
        desc: `${group.id}${current === `${group.id}/${model.id}` ? '  (текущая)' : ''}`,
      })))
      chooseFrom(items, 'модель', async name => {
        const picked = items.find(item => item.name === name)
        const selected = await options.client.sessions.selectModel({
          sessionId,
          provider: picked?.group ?? '',
          model: name,
        })
        if (!selected.result.ok) {
          emit(`  не удалось переключить модель: ${selected.result.error.message}\n`)
          return
        }
        // The host answers with the selection that is actually in force, which is
        // the only authoritative source: a router or a provider fallback may
        // resolve a request to a different model than the row the user clicked.
        const applied = selected.result.value.selected
        const label = `${applied.provider}/${applied.model}`
        options.state.model = label
        options.state.effort = applied.reasoningEffort ?? options.state.effort
        announce(`модель: ${label}`)
      })
    },
    '/effort': async () => {
      const items = [
        { group: 'EFFORT', name: 'low', desc: 'быстрые ответы' },
        { group: 'EFFORT', name: 'medium', desc: 'баланс' },
        { group: 'EFFORT', name: 'high', desc: 'глубокое рассуждение' },
      ]
      chooseFrom(items, 'усилие', async name => {
        const outcome = await options.onCommand(`/effort ${name}`, emit)
        if (!outcome.ok) emit(`  ${outcome.error ?? 'effort failed'}\n`)
        else {
          options.state.effort = name
          announce(`effort: ${name}`)
        }
      })
    },
    '/permission': async () => {
      const items = [
        { group: 'MODE', name: 'Ask', desc: 'только чтение' },
        { group: 'MODE', name: 'Plan', desc: 'план без записи' },
        { group: 'MODE', name: 'Agent', desc: 'запись с подтверждением' },
        { group: 'MODE', name: 'YOLO', desc: 'подтверждать всё' },
      ]
      chooseFrom(items, 'режим', async name => {
        const outcome = await options.onCommand(`/permission ${name}`, emit)
        if (!outcome.ok) {
          emit(`  ${outcome.error ?? 'permission failed'}\n`)
          return
        }
        options.state.mode = name
        announce(`режим: ${name}`)
      })
    },
    '/quit': async () => {
      requestExit?.(0)
    },
  }
  // `/sessions` is the same picker as `/resume`; both read as "switch session".
  surfaceCommands['/sessions'] = async () => { await surfaceCommands['/resume']?.() }

  /**
   * Report an acknowledgement that should not stay in the transcript.
   *
   * "copied", "model switched", "opened" describe an action that just happened;
   * the surface shows them briefly and also refreshes the status line, because
   * a model switch changes what the session is running with.
   * @param text - the confirmation text.
   */
  const announce = (text: string): void => {
    if (app === undefined) {
      write(`  ${text}\n`)
      return
    }
    app.flash(`  ${text}`)
    app.setStatus({
      model: options.state.model,
      mode: options.state.mode,
      ...(options.state.effort === undefined ? {} : { effort: options.state.effort }),
    })
    drawZone()
  }

  const submit = async (text: string): Promise<void> => {
    const task = text.trim()
    if (task === '') return
    appendHistory(historyFile, task)
    history.push(task)
    historyIndex = history.length
    draft = ''
    overlay = []
    hint = ''
    // A leading slash names a command only when one is registered under it. A
    // skill invocation is the same shape but a PROMPT: the host's pre-step
    // boundary recognizes `/name` and injects the skill body, so an unmatched
    // line has to reach the model rather than the command registry.
    if (task === '/panel') {
      commandBusy = true
      // Reading every registry takes seconds; the empty composer alone would look
      // like the line was swallowed, so the modal appears with a progress row
      // before the read starts and is filled in when it returns.
      panelStatus = 'читаю реестры…'
      drawZone()
      try {
        panel = await options.panel.open()
        panelStatus = ''
      } catch (error) {
        emit(`  panel failed: ${error instanceof Error ? error.message : String(error)}\n`)
      } finally {
        commandBusy = false
      }
      drawZone()
      return
    }
    // A mistyped command is a typo, not a prompt: sending /statuss to the model
    // would start a paid turn the user never asked for.
    if (task.startsWith('/') && !namesCommand(task, options.sources)) {
      const suggestion = nearestCommand(task, options.sources.commands)
      if (suggestion !== undefined) {
        emit(`  неизвестная команда ${splitCommand(task).name} — возможно, вы имели в виду /${suggestion}\n`)
        drawZone()
        return
      }
    }
    const action = surfaceCommands[task]
    if (action !== undefined) {
      commandBusy = true
      try {
        await action()
      } catch (error) {
        emit(`  команда не выполнена: ${error instanceof Error ? error.message : String(error)}\n`)
      } finally {
        commandBusy = false
      }
      drawZone()
      return
    }
    if (task.startsWith('/') && namesCommand(task, options.sources)) {
      commandBusy = true
      clearZone()
      try {
        const outcome = await options.onCommand(task, emit)
        if (!outcome.ok) emit(`  ${outcome.error ?? 'command failed'}\n`)
        else if (outcome.text !== undefined) emit(`  ${outcome.text}\n`)
      } catch (error) {
        // A command that throws must still say so: a silent failure would look
        // like the line was never submitted.
        emit(`  command failed: ${error instanceof Error ? error.message : String(error)}\n`)
      } finally {
        commandBusy = false
      }
      drawZone()
      return
    }
    running = true
    clearZone()
    if (app !== undefined) {
      // The composer is not repainted while a turn runs, so clearing the line has
      // to reach the surface now: otherwise the submitted task stays visible in
      // the input box for the whole turn instead of living in the transcript.
      app.setDraft('')
      app.setHint('')
      app.setRunning(true, 'Working…')
    }
    controller = new AbortController()
    // The transcript names the model behind each line, and this surface already
    // tracks the session's route for its status line.
    const route = options.state.model
    const outcome = await runTurn({
      client: options.client,
      sessionId,
      task,
      palette,
      sink: { write },
      cols,
      signal: controller.signal,
      onApproval: askApproval,
      onQuestion: askQuestion,
      ...(route === undefined || route === '' ? {} : { model: route }),
      ...(options.settings.timestamps ? { timestamps: true } : {}),
      ...(app === undefined
        ? {}
        : {
            renderer: createLogRenderer({
              log: app.log,
              onFooter: footer => {
                app.setStatus({ tokens: footer.tokens })
              },
            }),
          }),
    })
    contextPercent = outcome.contextPercent
    options.state.contextPercent = contextPercent
    controller = undefined
    running = false
    if (app !== undefined) {
      app.setRunning(false)
      app.setStatus({ contextPercent, turnSeconds: outcome.seconds, mode: options.state.mode })
      drawZone()
      return
    }
    write(`${statusLine({
      model: options.state.model,
      contextPercent,
      turnSeconds: outcome.seconds,
      mode: options.state.mode,
      cols,
      ...(options.state.branch === undefined ? {} : { branch: options.state.branch }),
      ...(options.state.dirty === undefined ? {} : { dirty: options.state.dirty }),
    }, palette)}\n`)
    drawZone()
  }

  /**
   * Hand a line to the running turn instead of starting a new one.
   *
   * Steering is the supported way to redirect work already underway: the host
   * admits the message into the live turn rather than queueing a second one.
   */
  const steer = async (text: string): Promise<void> => {
    const task = text.trim()
    if (task === '') return
    draft = ''
    hint = ''
    app?.setDraft('')
    app?.setHint('')
    const sent = await options.client.sessions.prompt({
      sessionId,
      mode: 'steer',
      content: [{ type: 'text', text: task }],
    })
    note(sent.result.ok
      ? `  → steering: ${task}\n`
      : `  steering failed: ${sent.result.error.message}\n`)
    drawZone()
  }

  const completeFromHistory = (): void => {    if (draft === '') return
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const candidate = history[index]
      if (candidate !== undefined && candidate.startsWith(draft) && candidate !== draft) {
        draft = candidate
        return
      }
    }
  }

  return await new Promise<number>(resolve => {
    const leave = (code: number): void => {
      escapeIdle.stop()
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      if (app !== undefined) app.stop()
      else write('\n')
      resolve(code)
    }
    requestExit = leave

    const cancelTurn = (): void => {
      if (!running) return
      controller?.abort()
      void options.client.sessions.cancel({ sessionId })
      note('  (cancelling)\n')
    }

    const handle = (key: KeyEvent, now: number): void => {
      // A running command owns the keyboard: a second Enter while one is still
      // reading its registry would submit on top of it and print into a zone
      // the first command is about to redraw.
      if (commandBusy) return
      // The modal owns the keyboard while it is open: its keys navigate tabs and
      // rows, and Esc closes it without leaving the loop.
      if (panel !== undefined) {
        const act = (action: 'enter' | 'space' | 'v'): void => {
          void actOnPanel(panel as PanelState, action, options.panel.session)
            .then(status => {
              panelStatus = status ?? ''
              drawZone()
            })
            .catch((error: unknown) => {
              panelStatus = error instanceof Error ? error.message : String(error)
              drawZone()
            })
        }
        switch (key.kind) {
          case 'tab': panel = switchPanelTab(panel, 1); panelStatus = ''; return
          case 'shift-tab': panel = switchPanelTab(panel, -1); panelStatus = ''; return
          case 'up': panel = movePanelSelection(panel, -1); panelStatus = ''; return
          case 'down': panel = movePanelSelection(panel, 1); panelStatus = ''; return
          case 'enter': act('enter'); return
          case 'char':
            if (key.text === ' ') act('space')
            else if (key.text === 'v' || key.text === 'V') act('v')
            return
          case 'escape':
          case 'ctrl-c':
          case 'ctrl-d':
            panel = undefined
            panelStatus = ''
            return
          default:
            return
        }
      }
      // An open request owns the keyboard until it is answered: its keys mean
      // the answer, never a new draft.
      if (approval !== undefined) {
        const active = approval
        const decide = (decision: ApprovalDecision): void => {
          approval = undefined
          overlay = []
          if (decision === 'allowed-once') {
            note('  (granted once; a durable rule belongs to /permission)\n')
          }
          active.resolve(decision)
          drawZone()
        }
        switch (key.kind) {
          case 'char':
            if (key.text === 'y' || key.text === 'Y') decide('allowed-once')
            else if (key.text === 'a' || key.text === 'A') decide('allowed-once')
            else if (key.text === 'n' || key.text === 'N') decide('rejected')
            return
          case 'escape':
          case 'ctrl-c':
            decide('rejected')
            return
          default:
            return
        }
      }
      if (question !== undefined) {
        switch (key.kind) {
          case 'enter':
            answerCurrentQuestion(draft)
            return
          case 'escape':
          case 'ctrl-c': {
            const active = question
            question = undefined
            overlay = []
            active.resolve(undefined)
            drawZone()
            return
          }
          default:
            break
        }
      }
      switch (key.kind) {
        case 'ctrl-c':
          if (running) {
            cancelTurn()
            return
          }
          if (draft !== '') {
            draft = ''
            return
          }
          if (now - lastInterrupt < INTERRUPT_WINDOW_MS) {
            leave(130)
            return
          }
          lastInterrupt = now
          note('  (press Ctrl+C again to leave)\n')
          return
        case 'ctrl-d':
          if (draft === '') {
            leave(0)
            return
          }
          return
        case 'escape':
          if (running) cancelTurn()
          else draft = ''
          return
        case 'enter':
          if (draft.trim() === '') return
          // `multiline` swaps the two: Enter breaks the line and Ctrl+J
          // submits, which is the habit a terminal editor user brings.
          if (options.settings.multiline) {
            draft += '\n'
            return
          }
          if (running) void steer(draft)
          else void submit(draft)
          return
        case 'newline':
          if (options.settings.multiline && draft.trim() !== '') {
            if (running) void steer(draft)
            else void submit(draft)
            return
          }
          draft += '\n'
          return
        case 'char':
          hint = ''
          draft += key.text
          return
        case 'paste':
          hint = ''
          draft += key.text
          return
        case 'backspace':
          hint = ''
          draft = draft.slice(0, -1)
          return
        case 'ctrl-u':
          hint = ''
          draft = ''
          return
        case 'tab': {
          // A prefix completes against its own source; a bare draft falls back
          // to the input history, which is the only completion with no prefix.
          const completed = completeDraft(draft, options.sources)
          if (completed.active) {
            draft = completed.draft
            hint = completed.candidates.length > 1 ? completionHint(completed.candidates) : ''
            if (completed.candidates.length === 0) hint = 'no match'
            return
          }
          hint = ''
          completeFromHistory()
          return
        }
        case 'up':
          hint = ''
          if (history.length === 0) return
          historyIndex = Math.max(0, historyIndex - 1)
          draft = history[historyIndex] ?? ''
          return
        case 'down':
          hint = ''
          if (history.length === 0) return
          historyIndex = Math.min(history.length, historyIndex + 1)
          draft = historyIndex >= history.length ? '' : (history[historyIndex] ?? '')
          return
        default:
          return
      }
    }

    const escapeIdle = createEscapeIdle(() => {
      deliver([{ kind: 'escape' }], Date.now())
      // The composed surface repaints a diff, so it can be refreshed while a turn
      // runs; the scrollback zone must not be, or it would erase the turn's own
      // output. Keeping the composer in sync at every moment is what stops a
      // submitted task from lingering in the input line.
      if (app !== undefined || (!running && !commandBusy)) drawZone()
    })

    /** Route decoded keys to the surface that owns them. */
    function deliver(keys: readonly KeyEvent[], now: number): void {
      if (app !== undefined) {
        // The surface consumes the wheel and paging itself and forwards every
        // other key back here, so the transcript scrolls without touching the
        // draft, and the draft is edited without touching the scroll offset.
        for (const key of keys) app.handleKey(key)
        return
      }
      for (const key of keys) handle(key, now)
    }

    function onData(chunk: Buffer): void {
      const now = Date.now()
      deliver(escapeIdle.push(chunk.toString('utf8')), now)
      if (app !== undefined || (!running && !commandBusy)) drawZone()
    }

    if (app !== undefined) {
      app.setMenuItems(menuItems)
      app.onMenuAccept(item => {
        // A list opened by a command reports the pick to that command; the
        // palette the user typed runs the command it names.
        const pending = choosing
        if (pending !== undefined) {
          choosing = undefined
          app.closeMenu()
          void pending(item.name)
          return
        }
        app.closeMenu()
        void submit(item.name)
      })
      app.onMenuClose(nested => {
        if (nested) backToCommands()
        else closePalette()
      })
      app.onSelection(text => {
        // The drag is the copy gesture: the terminal cannot do its own selection
        // while mouse reporting is on, so a released selection lands on the
        // clipboard directly and the surface says how much went there.
        const lines = text.split('\n').length
        void copyToClipboard(text).then(copied => {
          if (copied) announce(`скопировано строк: ${String(lines)}`)
          else emit('  не удалось обратиться к буферу обмена\n')
        })
      })
      app.onOpen(target => {
        if (openTarget(target)) announce(`открыто: ${target}`)
        else emit(`  не удалось открыть: ${target}\n`)
      })
      app.onUnhandled(key => handle(key, Date.now()))
      app.start()
    } else if (options.state.branch !== undefined) {
      write(`  session ${sessionId}\n`)
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
    drawZone()
  })
}
