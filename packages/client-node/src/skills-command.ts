/**
 * `kibborg skills` — the managed skill catalog and its lifecycle.
 *
 * Every method here drives the same `skill.*` domain the Web Skills Manager
 * uses, so the trash, the version history, and the enable switch are one state
 * with one owner. Skill BODIES travel on stdin, which keeps a large SKILL.md out
 * of the command line and out of the shell history.
 * @module @kibborg/client-node/skills-command
 */

import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { ModelRouteView, SecurityVerdictView } from '@deepseek-ai/dsh-host-apiproxy/api'
import { padRight } from '@kibborg/tui'
import type { ClientIntent } from './types.ts'
import { formatSkills, readSkills } from './registries.ts'

/** Print a failure and return the matching exit code. */
function complain(what: string, message: string): number {
  process.stderr.write(`kibborg: ${what} failed: ${message}\n`)
  return 1
}

/** Read a skill body from stdin. */
async function readBody(): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of process.stdin) chunks.push(String(chunk))
  return chunks.join('')
}

/** Parse `provider/model` into a benchmark route. */
function routeOf(value: string | undefined): ModelRouteView | undefined {
  if (value === undefined || value === '') return undefined
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

/** List the project's skills with their managed state. */
async function list(client: IApiClient, sessionId: Parameters<typeof readSkills>[1], asJson: boolean): Promise<number> {
  const view = await readSkills(client, sessionId)
  if (asJson) {
    process.stdout.write(`${JSON.stringify(view, undefined, 2)}\n`)
    return 0
  }
  process.stdout.write(formatSkills(view).join(''))
  return 0
}

/** Show one managed skill: summary, body, and version history. */
async function show(client: IApiClient, intent: ClientIntent, sessionId: Parameters<typeof readSkills>[1]): Promise<number> {
  const name = intent.name ?? ''
  if (name === '') {
    process.stderr.write('kibborg: skills show needs a skill name\n')
    return 2
  }
  const read = await client.skills.read({ sessionId, name })
  if (!read.result.ok) return complain('skill.read', read.result.error.message)
  const skill = read.result.value.skill
  if (skill === undefined) {
    process.stderr.write(`kibborg: no skill named ${name}\n`)
    return 1
  }
  if (intent.json === true) {
    process.stdout.write(`${JSON.stringify(skill, undefined, 2)}\n`)
    return 0
  }
  process.stdout.write(`  ${skill.name}  (${skill.scope}, ${skill.status}, ${skill.version}, ${String(skill.versionsCount)} versions)\n`)
  if (skill.path !== undefined) process.stdout.write(`  ${skill.path}\n`)
  process.stdout.write(`${skill.content}\n`)
  for (const version of skill.versions.slice(0, 10)) {
    process.stdout.write(`  ${padRight(version.id, 10)} ${version.createdAt}  ${version.reason}\n`)
  }
  return 0
}

/** Write a skill body from stdin into a managed scope. */
async function save(client: IApiClient, intent: ClientIntent, sessionId: Parameters<typeof readSkills>[1]): Promise<number> {
  const name = intent.name ?? ''
  if (name === '') {
    process.stderr.write('kibborg: skills save needs a skill name\n')
    return 2
  }
  const content = await readBody()
  if (content.trim() === '') {
    process.stderr.write('kibborg: skills save reads the SKILL.md body from stdin\n')
    return 2
  }
  const scope = intent.scope ?? 'project'
  if (scope !== 'user' && scope !== 'project' && scope !== 'agents') {
    process.stderr.write('kibborg: skills save takes --scope user|project|agents\n')
    return 2
  }
  const saved = await client.skills.save({
    sessionId,
    name,
    content,
    scope,
    ...(intent.replace === true ? { replace: true } : {}),
    ...(intent.force === true ? { force: true } : {}),
  })
  if (!saved.result.ok) return complain('skill.save', saved.result.error.message)
  const result = saved.result.value.result
  if (intent.json === true) {
    process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
    return 0
  }
  process.stdout.write(`  ${name} saved\n`)
  return 0
}

/** Move a skill to the trash, restore it, or delete it permanently. */
async function lifecycle(client: IApiClient, intent: ClientIntent, sessionId: Parameters<typeof readSkills>[1]): Promise<number> {
  const name = intent.name ?? ''
  if (name === '') {
    process.stderr.write(`kibborg: skills ${intent.sub ?? ''} needs a skill name\n`)
    return 2
  }
  const call = intent.sub === 'restore'
    ? client.skills.restore({ sessionId, name })
    : intent.sub === 'delete'
      ? client.skills.permanentDelete({ sessionId, name })
      : client.skills.remove({ sessionId, name })
  const done = await call
  if (!done.result.ok) return complain(`skill.${intent.sub ?? ''}`, done.result.error.message)
  process.stdout.write(`  ${name} ${intent.sub === 'restore' ? 'restored' : intent.sub === 'delete' ? 'deleted' : 'trashed'}\n`)
  return 0
}

/** List the trashed skills. */
async function trash(client: IApiClient, sessionId: Parameters<typeof readSkills>[1], asJson: boolean): Promise<number> {
  const listed = await client.skills.trash({ sessionId })
  if (!listed.result.ok) return complain('skill.trash', listed.result.error.message)
  const entries = listed.result.value.entries
  if (asJson) {
    process.stdout.write(`${JSON.stringify(entries, undefined, 2)}\n`)
    return 0
  }
  if (entries.length === 0) {
    process.stdout.write('  trash is empty\n')
    return 0
  }
  const width = entries.reduce((max, entry) => Math.max(max, entry.name.length), 0)
  for (const entry of entries) process.stdout.write(`  ${padRight(entry.name, width)}  ${entry.scope}  ${entry.path}\n`)
  return 0
}

/** Turn one managed skill on or off. */
async function setEnabled(client: IApiClient, intent: ClientIntent, sessionId: Parameters<typeof readSkills>[1]): Promise<number> {
  const name = intent.name ?? ''
  if (name === '') {
    process.stderr.write('kibborg: skills enable/disable needs a skill name\n')
    return 2
  }
  const changed = await client.skills.setEnabled({ sessionId, name, enabled: intent.sub === 'enable' })
  if (!changed.result.ok) return complain('skill.setEnabled', changed.result.error.message)
  process.stdout.write(`  ${name} ${intent.sub === 'enable' ? 'enabled' : 'disabled'}\n`)
  return 0
}

/** Print one skill's version history, or roll it back to a version. */
async function versions(client: IApiClient, intent: ClientIntent, sessionId: Parameters<typeof readSkills>[1]): Promise<number> {
  const name = intent.name ?? ''
  if (name === '') {
    process.stderr.write('kibborg: skills versions/rollback needs a skill name\n')
    return 2
  }
  if (intent.sub === 'rollback') {
    const version = intent.version ?? ''
    if (version === '') {
      process.stderr.write('kibborg: skills rollback needs a version id\n')
      return 2
    }
    const rolled = await client.skills.rollback({ sessionId, name, version })
    if (!rolled.result.ok) return complain('skill.rollback', rolled.result.error.message)
    process.stdout.write(`  ${name} active version ${rolled.result.value.activeVersion}\n`)
    return 0
  }
  const listed = await client.skills.versions({ sessionId, name })
  if (!listed.result.ok) return complain('skill.versions', listed.result.error.message)
  const entries = listed.result.value.versions
  if (intent.json === true) {
    process.stdout.write(`${JSON.stringify(entries, undefined, 2)}\n`)
    return 0
  }
  const width = entries.reduce((max, entry) => Math.max(max, entry.id.length), 0)
  for (const entry of entries) process.stdout.write(`  ${padRight(entry.id, width)}  ${entry.createdAt}  ${entry.reason}\n`)
  return 0
}

/** Validate a SKILL.md body from stdin, with or without the security check. */
async function inspect(client: IApiClient, intent: ClientIntent): Promise<number> {
  const content = await readBody()
  if (content.trim() === '') {
    // Both methods require a non-empty body, and the schema's refusal would
    // read as a host fault rather than as the empty pipe it is.
    process.stderr.write('kibborg: skills validate/check reads the SKILL.md body from stdin\n')
    return 2
  }
  if (intent.sub === 'check') {
    const verdict = await client.skills.securityCheck({ content })
    if (!verdict.result.ok) return complain('skill.securityCheck', verdict.result.error.message)
    const value: SecurityVerdictView = verdict.result.value
    process.stdout.write(`  ${value.status}\n`)
    for (const finding of value.findings) {
      process.stdout.write(`  ${finding.severity}  ${finding.rule}  ${finding.message}\n`)
    }
    return value.status === 'blocked' ? 1 : 0
  }
  const validated = await client.skills.validate({ content })
  if (!validated.result.ok) return complain('skill.validate', validated.result.error.message)
  const value = validated.result.value
  process.stdout.write(value.ok ? '  valid\n' : `  invalid: ${value.reason ?? 'unknown reason'}\n`)
  return value.ok ? 0 : 1
}

/** Start, poll, or cancel a benchmark run. */
async function benchmark(client: IApiClient, intent: ClientIntent, sessionId: Parameters<typeof readSkills>[1]): Promise<number> {
  if (intent.sub === 'benchmark-status' || intent.sub === 'benchmark-cancel') {
    const runId = intent.runId ?? ''
    if (runId === '') {
      process.stderr.write('kibborg: a benchmark run id is required\n')
      return 2
    }
    const polled = intent.sub === 'benchmark-cancel'
      ? await client.skills.benchmarkCancel({ runId })
      : await client.skills.benchmarkPoll({ runId })
    if (!polled.result.ok) return complain(`skill.${intent.sub}`, polled.result.error.message)
    const run = polled.result.value.run
    if (intent.json === true) {
      process.stdout.write(`${JSON.stringify(run, undefined, 2)}\n`)
      return 0
    }
    process.stdout.write(`  ${run.skillName}  ${run.status}  ${run.phase}  ${String(run.progress.case)}/${String(run.progress.total)}\n`)
    if (run.result !== undefined) {
      process.stdout.write(`  baseline ${String(run.result.summary.baselineScore)} → skill ${String(run.result.summary.skillScore)} (${run.result.summary.improvementPercent.toFixed(1)}%)\n`)
    }
    if (run.error !== undefined) process.stdout.write(`  error: ${run.error}\n`)
    return run.status === 'failed' ? 1 : 0
  }
  const name = intent.name ?? ''
  const taskModel = routeOf(intent.model)
  if (name === '' || taskModel === undefined) {
    process.stderr.write('kibborg: skills benchmark needs a skill name and --model provider/model\n')
    return 2
  }
  const evaluatorModel = routeOf(intent.evaluator)
  const started = await client.skills.benchmarkStart({
    sessionId,
    name,
    taskModel,
    ...(evaluatorModel === undefined ? {} : { evaluatorModel }),
    ...(intent.cases === undefined ? {} : { caseCount: intent.cases }),
  })
  if (!started.result.ok) return complain('skill.benchmarkStart', started.result.error.message)
  const run = started.result.value.run
  process.stdout.write(intent.json === true
    ? `${JSON.stringify(run, undefined, 2)}\n`
    : `  ${run.id}  ${run.status}  ${run.phase}\n`)
  return 0
}

/**
 * Run one skills command.
 * @param client - the in-process API client.
 * @param intent - the resolved invocation intent.
 * @param sessionId - the session whose project owns the catalog.
 * @returns the process exit code.
 */
export async function runSkillsCommand(
  client: IApiClient,
  intent: ClientIntent,
  sessionId: Parameters<typeof readSkills>[1],
): Promise<number> {
  const asJson = intent.json === true
  switch (intent.sub) {
    case undefined:
    case 'list': return await list(client, sessionId, asJson)
    case 'show': return await show(client, intent, sessionId)
    case 'save': return await save(client, intent, sessionId)
    case 'remove':
    case 'restore':
    case 'delete': return await lifecycle(client, intent, sessionId)
    case 'trash': return await trash(client, sessionId, asJson)
    case 'enable':
    case 'disable': return await setEnabled(client, intent, sessionId)
    case 'versions':
    case 'rollback': return await versions(client, intent, sessionId)
    case 'validate':
    case 'check': return await inspect(client, intent)
    case 'benchmark':
    case 'benchmark-status':
    case 'benchmark-cancel': return await benchmark(client, intent, sessionId)
    default:
      process.stderr.write(`kibborg: unknown skills subcommand: ${intent.sub}\n`)
      return 2
  }
}
