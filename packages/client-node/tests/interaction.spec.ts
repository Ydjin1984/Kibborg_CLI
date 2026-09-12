import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import {
  answerApproval,
  answerQuestions,
  headlessAnswers,
  parseAnswerLine,
  type PendingApproval,
  type PendingQuestion,
} from '../src/interaction.ts'

/** A client stub that records the responses the surface sends. */
function recordingClient(): { client: IApiClient; sent: unknown[] } {
  const sent: unknown[] = []
  const client = {
    respond: vi.fn(async (message: unknown) => {
      sent.push(message)
      return { accepted: true }
    }),
  } as unknown as IApiClient
  return { client, sent }
}

const approval: PendingApproval = {
  rpcId: 'rpc-1',
  sessionId: 'session-1' as never,
  approvalId: 'ap-1' as never,
  toolName: 'write',
}

const question: PendingQuestion = {
  rpcId: 'rpc-2',
  sessionId: 'session-1' as never,
  questions: [{ id: 'q1', question: 'Which scope?' }, { id: 'q2', question: 'Anything else?' }],
}

describe('answerApproval', () => {
  it('echoes the frame id with the decision', async () => {
    const { client, sent } = recordingClient()
    expect(await answerApproval(client, approval, 'allowed-once')).toBe(true)
    expect(sent[0]).toMatchObject({
      type: 'client-response',
      rpcId: 'rpc-1',
      result: { ok: true, value: { approvalId: 'ap-1', outcome: 'allowed-once' } },
    })
  })

  it('reports a refusal as rejected', async () => {
    const { client, sent } = recordingClient()
    await answerApproval(client, approval, 'rejected')
    expect(sent[0]).toMatchObject({ result: { value: { outcome: 'rejected' } } })
  })
})

describe('answerQuestions', () => {
  it('sends the whole batch under the frame id', async () => {
    const { client, sent } = recordingClient()
    await answerQuestions(client, question, [
      { id: 'q1', selected: ['only src'] },
      { id: 'q2', custom: 'no' },
    ])
    expect(sent[0]).toMatchObject({
      rpcId: 'rpc-2',
      result: { value: { answer: { answers: [{ id: 'q1', selected: ['only src'] }, { id: 'q2', custom: 'no' }] } } },
    })
  })
})

describe('parseAnswerLine', () => {
  const options = ['only src', 'whole repo', 'cancel']

  it('maps option numbers onto labels', () => {
    expect(parseAnswerLine('2', options, false)).toEqual({ selected: ['whole repo'] })
    expect(parseAnswerLine('1, 3', options, true)).toEqual({ selected: ['only src', 'cancel'] })
    expect(parseAnswerLine('2 1', options, true)).toEqual({ selected: ['whole repo', 'only src'] })
  })

  it('keeps a single-select answer single', () => {
    expect(parseAnswerLine('1 2', options, false)).toEqual({ selected: ['only src'] })
  })

  it('carries free text behind the custom prefix', () => {
    expect(parseAnswerLine('other: something else', options, false)).toEqual({ selected: [], custom: 'something else' })
  })

  it('rejects what is not an answer', () => {
    expect(parseAnswerLine('', options, false)).toBeUndefined()
    expect(parseAnswerLine('9', options, false)).toBeUndefined()
    expect(parseAnswerLine('other:   ', options, false)).toBeUndefined()
  })
})

describe('headlessAnswers', () => {
  const created: string[] = []
  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('refuses to guess under the fail policy', () => {
    expect(headlessAnswers(question, { policy: 'fail' })).toBeUndefined()
  })

  it('answers every question from the prepared document', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kibborg-answers-'))
    created.push(dir)
    const file = join(dir, 'answers.json')
    writeFileSync(file, JSON.stringify({
      q1: { selected: ['only src'] },
      q2: { custom: 'nothing else' },
    }), 'utf8')
    const answers = headlessAnswers(question, { policy: 'answers-file', answersFile: file })
    expect(answers).toEqual([
      { id: 'q1', selected: ['only src'] },
      { id: 'q2', selected: [], custom: 'nothing else' },
    ])
  })

  it('fails when the document does not answer a question', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kibborg-answers-'))
    created.push(dir)
    const file = join(dir, 'answers.json')
    writeFileSync(file, JSON.stringify({ q1: { selected: ['only src'] } }), 'utf8')
    expect(headlessAnswers(question, { policy: 'answers-file', answersFile: file })).toBeUndefined()
  })

  it('fails on a malformed document instead of sending junk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kibborg-answers-'))
    created.push(dir)
    const file = join(dir, 'answers.json')
    writeFileSync(file, JSON.stringify({ q1: { selected: [] }, q2: { selected: ['x'] } }), 'utf8')
    expect(headlessAnswers(question, { policy: 'answers-file', answersFile: file })).toBeUndefined()
  })
})
