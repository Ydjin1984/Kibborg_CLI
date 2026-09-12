/**
 * `kibborg settings` and `kibborg auth` — the configuration surface.
 *
 * Both read through the API proxy the browser's Settings pages use, so a value
 * changed here is the same value the Web surface shows. Secrets stay on the
 * write path only: the settings domain redacts them (the descriptor reports
 * whether a slot is set, never its content), and a credential value is read from
 * stdin so it never reaches the command line or the shell history.
 * @module @kibborg/client-node/settings-command
 */

import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-host-apiproxy/api'
import { padRight } from '@kibborg/tui'
import type { ClientIntent } from './types.ts'

/** Settings namespaces whose `apiKeyEnv` fields name the credentials in play. */
const CREDENTIAL_KEY = 'apiKeyEnv'

/** Collect every `apiKeyEnv` string anywhere inside a redacted settings value. */
function credentialRefs(value: unknown, found: Set<string>): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const entry of value) credentialRefs(entry, found)
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === CREDENTIAL_KEY && typeof entry === 'string' && entry !== '') found.add(entry)
    else credentialRefs(entry, found)
  }
}

/** Read every namespace descriptor, or report the failure. */
async function namespaces(client: IApiClient): Promise<readonly SettingsNamespaceView[] | undefined> {
  const described = await client.settings.describe({})
  if (described.result.ok) return described.result.value.namespaces
  process.stderr.write(`kibborg: settings.describe failed: ${described.result.error.message}\n`)
  return undefined
}

/** Print the namespace list with the state of each secret slot. */
async function list(client: IApiClient, asJson: boolean): Promise<number> {
  const described = await client.settings.describe({})
  if (!described.result.ok) {
    process.stderr.write(`kibborg: settings.describe failed: ${described.result.error.message}\n`)
    return 1
  }
  const value = described.result.value
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`)
    return 0
  }
  const width = value.namespaces.reduce((max, entry) => Math.max(max, entry.ns.length), 0)
  process.stdout.write(`  writable ${String(value.writable)} · document ${String(value.hasDocument)}\n`)
  for (const entry of value.namespaces) {
    const overridden = entry.user === undefined ? '' : '  (user)'
    const secrets = entry.secrets.length === 0
      ? ''
      : `  secrets: ${entry.secrets.map(secret => `${secret.path.join('.')}=${secret.set ? 'set' : 'unset'}`).join(', ')}`
    process.stdout.write(`  ${padRight(entry.ns, width)}  ${entry.applies}${overridden}${secrets}\n`)
  }
  return 0
}

/** Print one namespace's redacted value. */
async function show(client: IApiClient, ns: string, asJson: boolean): Promise<number> {
  const all = await namespaces(client)
  if (all === undefined) return 1
  const entry = all.find(candidate => candidate.ns === ns)
  if (entry === undefined) {
    process.stderr.write(`kibborg: no settings namespace named ${ns}\n`)
    return 1
  }
  if (asJson) {
    process.stdout.write(`${JSON.stringify(entry, undefined, 2)}\n`)
    return 0
  }
  process.stdout.write(`  ${entry.ns}  (${entry.applies}, revision ${String(entry.revision)})\n`)
  process.stdout.write(`${JSON.stringify(entry.value, undefined, 2)}\n`)
  for (const secret of entry.secrets) {
    process.stdout.write(`  secret ${secret.path.join('.')}: ${secret.set ? 'set' : 'unset'}\n`)
  }
  if (entry.user !== undefined) process.stdout.write(`${JSON.stringify({ user: entry.user }, undefined, 2)}\n`)
  return 0
}

/** Apply one path-addressed edit to a namespace's user layer. */
async function mutate(
  client: IApiClient,
  intent: ClientIntent,
  op: 'set' | 'unset',
): Promise<number> {
  const ns = intent.ns ?? ''
  if (ns === '') {
    process.stderr.write(`kibborg: settings ${op} needs a namespace\n`)
    return 2
  }
  const path = (intent.path ?? '').split('.').filter(part => part !== '')
  const changed = await client.settings.mutate({
    ns,
    ops: [op === 'set' ? { op: 'set', path, value: intent.value } : { op: 'unset', path }],
  })
  if (!changed.result.ok) {
    process.stderr.write(`kibborg: settings.${op} failed: ${changed.result.error.message}\n`)
    return 1
  }
  process.stdout.write(`  ${ns}  revision ${String(changed.result.value.revision)}\n`)
  return 0
}

/** Report the state of every credential the settings schemas reference. */
async function authList(client: IApiClient, asJson: boolean): Promise<number> {
  const all = await namespaces(client)
  if (all === undefined) return 1
  const refs = new Set<string>()
  for (const entry of all) credentialRefs(entry.value, refs)
  const described = await client.credentials.describe({ refs: [...refs].sort() })
  if (!described.result.ok) {
    process.stderr.write(`kibborg: credentials.describe failed: ${described.result.error.message}\n`)
    return 1
  }
  const credentials = described.result.value.credentials
  if (asJson) {
    process.stdout.write(`${JSON.stringify(credentials, undefined, 2)}\n`)
    return 0
  }
  if (Object.keys(credentials).length === 0) {
    process.stdout.write('  no credential references are declared by the mounted settings\n')
    return 0
  }
  const width = Object.keys(credentials).reduce((max, ref) => Math.max(max, ref.length), 0)
  for (const [ref, view] of Object.entries(credentials)) {
    const state = view.configured ? `set (${view.source ?? 'unknown'})` : 'unset'
    process.stdout.write(`  ${padRight(ref, width)}  ${state}${view.writable ? '' : '  read-only'}\n`)
  }
  return 0
}

/** Store or clear one credential value. */
async function authWrite(client: IApiClient, intent: ClientIntent): Promise<number> {
  const ref = intent.ref ?? ''
  if (ref === '') {
    process.stderr.write('kibborg: auth set/unset needs a credential reference\n')
    return 2
  }
  if (intent.sub === 'unset') {
    const cleared = await client.credentials.unset({ ref })
    if (!cleared.result.ok) {
      process.stderr.write(`kibborg: credentials.unset failed: ${cleared.result.error.message}\n`)
      return 1
    }
    process.stdout.write(`  ${ref} unset\n`)
    return 0
  }
  const value = await readSecret()
  if (value === '') {
    process.stderr.write('kibborg: no value on stdin; pipe the secret in, for example: echo $KEY | kibborg auth set MY_KEY\n')
    return 2
  }
  const stored = await client.credentials.set({ ref, value })
  if (!stored.result.ok) {
    process.stderr.write(`kibborg: credentials.set failed: ${stored.result.error.message}\n`)
    return 1
  }
  process.stdout.write(`  ${ref} set\n`)
  return 0
}

/** Read a secret from stdin: it never becomes a command-line argument. */
async function readSecret(): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of process.stdin) chunks.push(String(chunk))
  return chunks.join('').trim()
}

/**
 * Run one settings or credentials command.
 * @param client - the in-process API client.
 * @param intent - the resolved invocation intent.
 * @returns the process exit code.
 */
export async function runSettingsCommand(client: IApiClient, intent: ClientIntent): Promise<number> {
  const asJson = intent.json === true
  if (intent.kind === 'auth') {
    if (intent.sub === undefined || intent.sub === 'list') return await authList(client, asJson)
    return await authWrite(client, intent)
  }
  switch (intent.sub) {
    case undefined:
    case 'list': return await list(client, asJson)
    case 'show': {
      const ns = intent.ns ?? ''
      if (ns === '') {
        process.stderr.write('kibborg: settings show needs a namespace\n')
        return 2
      }
      return await show(client, ns, asJson)
    }
    case 'set': return await mutate(client, intent, 'set')
    case 'unset': return await mutate(client, intent, 'unset')
    default:
      process.stderr.write(`kibborg: unknown settings subcommand: ${intent.sub}\n`)
      return 2
  }
}
