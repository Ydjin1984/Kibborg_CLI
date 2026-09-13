import { describe, it, expect } from 'vitest'
import { createLog, clampScroll, plainText, renderEntries, renderTranscript, transcriptWindow, type AgentBadge } from '../src/log.ts'
import { createLogRenderer } from '../src/log-renderer.ts'
import { agentToken } from '../src/tokens.ts'

/** A subagent badge at the given depth. */
function badge(depth: number, overrides: Partial<AgentBadge> = {}): AgentBadge {
  return { label: 'executor', depth, token: 'Accent', ...overrides }
}

describe('agent rows', () => {
  it('draws a heading with the model and the role', () => {
    const log = createLog()
    log.append({
      kind: 'agent',
      text: 'посчитать файлы',
      agent: badge(0, { label: 'KIBORG', model: 'kibborg/Kibborg_Flash_v5.7', role: 'ORCHESTRATOR' }),
    })
    const lines = renderEntries(log.entries, 120).map(plainText)
    expect(lines[0]).toContain('KIBORG')
    expect(lines[0]).toContain('kibborg/Kibborg_Flash_v5.7')
    expect(lines[0]).toContain('ORCHESTRATOR')
    expect(lines[1]).toContain('посчитать файлы')
  })

  it('draws a delegation as a box and closes it below its work', () => {
    const log = createLog()
    const child = badge(1, { label: 'Kibborg_Flash', role: 'EXECUTOR', sessionId: 'child' })
    log.append({ kind: 'agent', text: '', agent: child })
    log.append({ kind: 'tool', text: 'packages', name: 'bash', status: 'running', title: 'Запускает ls', agent: child })
    const closed = log.append({ kind: 'agent', text: 'готово', agent: { ...child, state: 'done' } })
    const rendered = renderEntries(log.entries, 120)
    const lines = rendered.map(plainText)
    // The open row names the agent, its role, and its state, and lands its corner
    // in the last column.
    expect(lines[0]).toContain('┌─')
    expect(lines[0]).toContain('EXECUTOR')
    expect(lines[0]).toContain('WORKING')
    expect(lines[0]?.endsWith('┐')).toBe(true)
    // The count of the folded branch sits inside the box, and the close follows it.
    expect(lines[1]).toContain('1 шаг этой ветки')
    expect(lines[2]).toContain('└─')
    expect(lines[2]).toContain('DONE')
    expect(lines[2]?.endsWith('┘')).toBe(true)
    expect(rendered.some(line => line.collapsed === true && line.entryId === closed)).toBe(true)
    // Expanding the close brings the branch back between the walls.
    log.patch(closed, { expanded: true })
    const opened = renderEntries(log.entries, 120).map(plainText)
    const row = opened.find(text => text.includes('Запускает ls')) ?? ''
    expect(row.startsWith('  │')).toBe(true)
    expect(row.endsWith('│')).toBe(true)
  })

  it('draws two agents in the same neutral color, keeping color for state', () => {
    // Who is working is stated by name, model, and role: a palette per agent made
    // the transcript look like a chart and told the reader nothing about the work.
    expect(agentToken('KIBORG')).toBe('Text')
    expect(agentToken('Kibborg_Flash')).toBe('Text')
    expect(agentToken('')).toBe('Muted')
  })

  it('settles a call of each agent in its own row', () => {
    const log = createLog()
    const renderer = createLogRenderer({ log })
    renderer.agent?.(badge(0, { label: 'KIBORG', sessionId: 'root' }))
    renderer.toolCall('bash', 'root call', undefined)
    renderer.agent?.(badge(1, { label: 'executor', sessionId: 'child' }))
    renderer.toolCall('bash', 'child call', undefined)
    renderer.toolDone('bash', 12)
    renderer.agent?.(badge(0, { label: 'KIBORG', sessionId: 'root' }))
    renderer.toolDone('bash', 40)
    const tools = log.entries.filter(entry => entry.kind === 'tool')
    expect(tools.map(entry => entry.status)).toEqual(['ok', 'ok'])
    // Each result landed on the row of the agent that produced it.
    expect(tools[0]?.durationMs).toBe(40)
    expect(tools[1]?.durationMs).toBe(12)
  })

  it('settles two calls of the same tool in call order', () => {
    const log = createLog()
    const renderer = createLogRenderer({ log })
    renderer.toolCall('bash', 'first', undefined)
    renderer.toolCall('bash', 'second', undefined)
    renderer.toolDone('bash', 12)
    renderer.toolDone('bash', 40)
    const tools = log.entries.filter(entry => entry.kind === 'tool')
    // A step may run the same tool twice; both rows must settle, and the first
    // result belongs to the first row.
    expect(tools.map(entry => entry.status)).toEqual(['ok', 'ok'])
    expect(tools.map(entry => entry.durationMs)).toEqual([12, 40])
    // A third result with no row left must not settle anything twice.
    renderer.toolDone('bash', 99)
    expect(log.entries.filter(entry => entry.kind === 'tool')).toHaveLength(2)
  })

  it('settles a result whose name the host did not repeat', () => {
    const log = createLog()
    const renderer = createLogRenderer({ log })
    renderer.toolCall('bash', 'first', undefined)
    renderer.toolDone('tool', 12)
    // Some hosts report the result without the tool's name: the oldest open row is
    // the only one it can belong to, and leaving it "running" would make the
    // transcript claim work that has already finished.
    expect(log.entries[0]?.status).toBe('ok')
    expect(log.entries[0]?.durationMs).toBe(12)
  })

  it('redraws a heading when the delegation names the agent', () => {
    const log = createLog()
    const renderer = createLogRenderer({ log })
    renderer.agent?.(badge(1, { label: 'subagent 5c443a', sessionId: 'child' }), 'grep')
    renderer.agent?.(badge(1, { label: 'посчитать строки', sessionId: 'child', role: 'EXECUTOR' }), 'grep')
    const headings = log.entries.filter(entry => entry.kind === 'agent')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.agent?.label).toBe('посчитать строки')
    expect(headings[0]?.agent?.role).toBe('EXECUTOR')
  })

  it('indents each level of a deeper tree', () => {
    const log = createLog()
    log.append({
      kind: 'tool',
      name: 'bash',
      status: 'ok',
      text: 'deep',
      agent: badge(2, { label: 'grandchild', sessionId: 'grand' }),
    })
    const line = renderEntries(log.entries, 120).map(plainText)[0] ?? ''
    expect(line.startsWith('  │    │  ')).toBe(true)
  })

  it('folds a finished delegation into its frame plus one count row', () => {
    const log = createLog()
    const child = badge(1, { label: 'Разбор ревью', sessionId: 'child', role: 'EXECUTOR' })
    log.append({ kind: 'agent', text: '', agent: { ...child, state: 'open' } })
    log.append({ kind: 'tool', name: 'grep', status: 'ok', text: 'grep', title: 'Ищет guard.go', agent: child })
    log.append({ kind: 'tool', name: 'read', status: 'ok', text: 'read', title: 'Читает guard.go', agent: child })
    const closed = log.append({ kind: 'agent', text: '', agent: { ...child, state: 'done' } })
    const joined = renderEntries(log.entries, 120).map(plainText).join('\n')
    // The work of a finished branch is behind one row, and that row carries the
    // entry a click expands.
    expect(joined).not.toContain('Ищет guard.go')
    expect(joined).toContain('2 шагов этой ветки')
    const marker = renderEntries(log.entries, 120).find(line => line.collapsed === true)
    expect(marker?.entryId).toBe(closed)
    log.patch(closed, { expanded: true })
    const opened = renderEntries(log.entries, 120).map(plainText).join('\n')
    expect(opened).toContain('Ищет guard.go')
    expect(opened).not.toContain('2 шагов этой ветки')
  })

  it('opens one heading per agent and closes the branch below its work', () => {
    const log = createLog()
    const renderer = createLogRenderer({ log })
    renderer.agent?.(badge(1, { label: 'executor' }), 'grep')
    renderer.toolCall('grep', 'pattern', undefined)
    renderer.agent?.(badge(1, { label: 'executor' }), 'read_file')
    renderer.agentDone?.(badge(1, { label: 'executor' }), 'три проблемы')
    const agents = log.entries.filter(entry => entry.kind === 'agent')
    // The heading keeps its activity, and the close is its own row after the work.
    expect(agents).toHaveLength(2)
    expect(agents[0]?.agent?.state).toBe('open')
    expect(agents[0]?.text).toBe('read_file')
    expect(agents[1]?.agent?.state).toBe('done')
    expect(agents[1]?.text).toBe('три проблемы')
    const tool = log.entries.find(entry => entry.kind === 'tool')
    expect(tool?.agent?.depth).toBe(1)
    // The close comes after the work it closes.
    const at = (entry: unknown): number => log.entries.indexOf(entry as never)
    expect(at(tool)).toBeLessThan(at(agents[1]))
  })
})

describe('transcript windows', () => {
  it('takes the same rows a flat render would show', () => {
    const log = createLog()
    for (let index = 0; index < 40; index += 1) log.append({ kind: 'tool', text: `arg ${String(index)}`, name: 'bash', status: 'ok' })
    const flat = renderEntries(log.entries, 80, { version: log.version })
    const transcript = renderTranscript(log.entries, 80, { version: log.version })
    expect(transcript.total).toBe(flat.length)
    for (const offset of [0, 7, 40]) {
      const start = clampScroll(offset, transcript.total, 10)
      expect(transcriptWindow(transcript, 10, offset).map(plainText))
        .toEqual(flat.slice(start, start + 10).map(plainText))
    }
  })

  it('rebuilds the transcript when the model changes and keeps its rows in step', () => {
    const log = createLog()
    log.append({ kind: 'tool', text: 'one', name: 'bash', status: 'ok' })
    const first = renderTranscript(log.entries, 80, { version: log.version })
    const rowsBefore = first.total
    const second = renderTranscript(log.entries, 80, { version: log.version })
    expect(second.total).toBe(rowsBefore)
    log.append({ kind: 'tool', text: 'two', name: 'bash', status: 'ok' })
    const third = renderTranscript(log.entries, 80, { version: log.version })
    expect(third.total).toBeGreaterThan(rowsBefore)
    expect(third.tops.length).toBe(third.parts.length + 1)
  })

  it('reports the version of every change to the model', () => {
    const log = createLog()
    const id = log.append({ kind: 'tool', text: 'one', name: 'bash', status: 'ok' })
    const afterAppend = log.version
    log.patch(id, { status: 'ok', output: 'done' })
    expect(log.version).toBeGreaterThan(afterAppend)
    const afterPatch = log.version
    log.remove(id)
    expect(log.version).toBeGreaterThan(afterPatch)
  })
})
