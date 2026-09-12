/**
 * Approvals and questions of the terminal surface.
 *
 * Both arrive as answerable mux frames: `approval/requested` carries an
 * approval id, `question/requested` carries a batch of questions, and each one
 * has a stable `rpcId` the answer must echo. Answering is a plain client
 * response through the same API client the rest of the surface uses, so the
 * host resolves it exactly as it resolves a browser's answer.
 *
 * Two policies exist: an interactive one (the terminal renders the request and
 * waits for a key) and a headless one (a run without a terminal denies an
 * approval and refuses to invent an answer, which is what makes `kibborg -p`
 * usable from CI instead of hanging).
 * @module @kibborg/client-node/interaction
 */

import { readFileSync } from 'node:fs'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The two outcomes the wire accepts from a client. */
export type ApprovalDecision = 'allowed-once' | 'rejected'

/** One option a question offers. */
export interface QuestionOption {
  /** Label sent back as the selection. */
  readonly label: string
  /** Optional explanation shown beside the label. */
  readonly description?: string
}

/** One question in a request. */
export interface QuestionItem {
  /** Stable id echoed in the answer. */
  readonly id: string
  /** The question text. */
  readonly question: string
  /** Supporting detail, often the plan a review is about. */
  readonly detail?: string
  /** Optional heading. */
  readonly header?: string
  /** Choices the terminal renders as a menu. */
  readonly options?: readonly QuestionOption[]
  /** Whether several options may be selected. */
  readonly multiSelect?: boolean
  /** Presentation intent; `plan-review` names the option that approves the plan. */
  readonly intent?: { readonly kind: string; readonly approve?: string }
}

/** One answer, as the wire expects it. */
export interface QuestionAnswer {
  /** The answered question id. */
  readonly id: string
  /** Selected option labels. */
  readonly selected: readonly string[]
  /** Free-text answer, when the terminal collected one. */
  readonly custom?: string
}

/** What a headless run does when a question cannot be answered. */
export type HeadlessQuestionPolicy = 'fail' | 'answers-file'

/** A request the surface must answer. */
export interface PendingApproval {
  /** Frame correlation id the answer must echo. */
  readonly rpcId: string
  /** Session the request belongs to. */
  readonly sessionId: SessionId
  /** Approval identity the payload carries back. */
  readonly approvalId: string
  /** Tool the model wants to run. */
  readonly toolName: string
  /** Optional host-provided reason. */
  readonly reason?: string
}

/** A question batch the surface must answer. */
export interface PendingQuestion {
  /** Frame correlation id the answer must echo. */
  readonly rpcId: string
  /** Session the request belongs to. */
  readonly sessionId: SessionId
  /** The questions, in order. */
  readonly questions: readonly QuestionItem[]
}

/**
 * Answer an approval request.
 * @param client - the in-process API client.
 * @param pending - the request being answered.
 * @param outcome - the decision to send.
 * @returns whether the host accepted the answer.
 */
export async function answerApproval(
  client: IApiClient,
  pending: PendingApproval,
  outcome: ApprovalDecision,
): Promise<boolean> {
  const receipt = await client.respond({
    type: 'client-response',
    rpcId: pending.rpcId as never,
    result: {
      ok: true,
      value: {
        sessionId: pending.sessionId,
        approvalId: pending.approvalId,
        outcome,
      },
    },
  } as never)
  return receipt.accepted === true
}

/**
 * Answer a question batch.
 * @param client - the in-process API client.
 * @param pending - the request being answered.
 * @param answers - one answer per question.
 * @returns whether the host accepted the answer.
 */
export async function answerQuestions(
  client: IApiClient,
  pending: PendingQuestion,
  answers: readonly QuestionAnswer[],
): Promise<boolean> {
  const receipt = await client.respond({
    type: 'client-response',
    rpcId: pending.rpcId as never,
    result: {
      ok: true,
      value: {
        sessionId: pending.sessionId,
        answer: { answers },
      },
    },
  } as never)
  return receipt.accepted === true
}

/** Parse the `--question-answers <file>` document into per-question answers. */
function readAnswerFile(path: string): Map<string, QuestionAnswer> | undefined {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    process.stderr.write(`kibborg: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}\n`)
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    process.stderr.write(`kibborg: ${path} is not valid JSON\n`)
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    process.stderr.write(`kibborg: ${path} must hold an object keyed by question id\n`)
    return undefined
  }
  const answers = new Map<string, QuestionAnswer>()
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      process.stderr.write(`kibborg: ${path}: entry ${id} must be an object\n`)
      return undefined
    }
    const entry = value as { selected?: unknown; custom?: unknown }
    const selected = Array.isArray(entry.selected) ? entry.selected.map(String) : []
    const custom = typeof entry.custom === 'string' ? entry.custom : undefined
    if (selected.length === 0 && (custom === undefined || custom === '')) {
      process.stderr.write(`kibborg: ${path}: entry ${id} needs selected labels or custom text\n`)
      return undefined
    }
    answers.set(id, { id, selected, ...(custom === undefined ? {} : { custom }) })
  }
  return answers
}

/**
 * Answer one question batch without a terminal.
 *
 * A policy of `fail` refuses to guess: the run stops with exit code 3 so a CI
 * caller can tell "needs a human" apart from "failed". A policy of
 * `answers-file` answers from the document the caller prepared, and still fails
 * when that document does not answer every question.
 * @param pending - the request being answered.
 * @param options - the headless policy and, for `answers-file`, the document path.
 * @returns the answers, or `undefined` when the request cannot be answered here.
 */
export function headlessAnswers(
  pending: PendingQuestion,
  options: { policy: HeadlessQuestionPolicy; answersFile?: string },
): readonly QuestionAnswer[] | undefined {
  if (options.policy === 'fail' || options.answersFile === undefined) {
    process.stderr.write('kibborg: the model asked a question and this run has no interactive terminal\n')
    for (const question of pending.questions) {
      process.stderr.write(`kibborg:   ${question.id}: ${question.question}\n`)
      for (const option of question.options ?? []) {
        process.stderr.write(`kibborg:     - ${option.label}\n`)
      }
    }
    process.stderr.write('kibborg: answer it interactively, or pass --question-answers <file.json>\n')
    return undefined
  }
  const document = readAnswerFile(options.answersFile)
  if (document === undefined) return undefined
  const answers: QuestionAnswer[] = []
  for (const question of pending.questions) {
    const answer = document.get(question.id)
    if (answer === undefined) {
      process.stderr.write(`kibborg: ${options.answersFile} has no answer for question ${question.id}\n`)
      return undefined
    }
    answers.push(answer)
  }
  return answers
}

/** Where the headless policy's decisions came from, for the transcript. */
export function describeHeadlessApproval(pending: PendingApproval): string {
  return `approval for ${pending.toolName} was denied: this run has no interactive terminal`
}

/** Prefix that turns a typed line into a free-text answer. */
export const CUSTOM_PREFIX = 'other:'

/**
 * Interpret one typed line as the answer to a question.
 *
 * The terminal asks for option numbers rather than full labels, so the mapping
 * back to labels happens here: `2` selects the second option, `1,3` selects two,
 * and `other:<text>` carries free text. Anything that selects nothing and
 * carries no text is not an answer and returns `undefined`, which lets the
 * caller re-prompt instead of sending an empty answer the host would reject.
 * @param text - the typed line.
 * @param options - the labels the question offered, in display order.
 * @param multiSelect - whether several labels may be selected.
 * @returns the selected labels and optional custom text, or `undefined`.
 */
export function parseAnswerLine(
  text: string,
  options: readonly string[],
  multiSelect: boolean,
): { readonly selected: readonly string[]; readonly custom?: string } | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (trimmed.toLowerCase().startsWith(CUSTOM_PREFIX)) {
    const custom = trimmed.slice(CUSTOM_PREFIX.length).trim()
    return custom === '' ? undefined : { selected: [], custom }
  }
  const indices = trimmed
    .split(/[\s,]+/u)
    .filter(part => part !== '')
    .map(part => Number.parseInt(part, 10) - 1)
    .filter(index => Number.isInteger(index) && index >= 0 && index < options.length)
  if (indices.length === 0) return undefined
  const chosen = (multiSelect ? indices : indices.slice(0, 1))
    .map(index => options[index])
    .filter((label): label is string => label !== undefined && label !== '')
  return chosen.length === 0 ? undefined : { selected: chosen }
}
