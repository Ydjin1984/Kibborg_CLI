/**
 * `kibborg doctor` — read-only diagnostics of this installation, plus the
 * explicit `--fix` repair pass.
 *
 * The read-only pass never writes: it inspects the runtime, the built
 * artifacts, the `kibborg` profile and its module fallback, the provider
 * credential, and the optional integrations. `--fix` applies only the safe
 * repairs (profile creation and its module fallback) and prints every change;
 * a missing build is reported as the exact command instead of being started
 * from a diagnostic run.
 * @module @kibborg/cli/doctor
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { healProfilesModuleFallback, initProfile } from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR, PROFILE_BUNDLES, prepareProfile, profileDir } from './profile-boot.ts'

/** Repository root: this file sits at `<root>/Kibborg_CLI/apps/cli/src`. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** Packages that must be linked into the profile's flat module fallback. */
const REQUIRED_PROFILE_LINKS: readonly string[] = ['cli', 'cli-bundle', 'client-node']

/** Built entries the CLI cannot run without. */
const REQUIRED_ARTIFACTS: readonly string[] = [
  'Kibborg_CLI/apps/cli/lib/bin.js',
  'Kibborg_CLI/packages/cli-bundle/lib/index.js',
  'Kibborg_CLI/packages/client-node/lib/index.js',
]

/** The provider credential this deployment expects. */
const PROVIDER_KEY = 'DEEPSEEK_API_KEY'

/** Chrome's DevTools endpoint, used by the browser tooling. */
const CDP_PORT = 9222

/** One diagnostic result. */
export interface DoctorCheck {
  /** Stable check id, used by `--json` consumers. */
  readonly id: string
  /** Human-readable check name. */
  readonly title: string
  /** `fail` makes the whole report not ok; `warn` is informational. */
  readonly status: 'ok' | 'warn' | 'fail'
  /** What was observed, with the concrete path or version when one applies. */
  readonly detail: string
  /** One actionable line; absent when the check passed. */
  readonly hint?: string
}

/** The complete diagnostic result. */
export interface DoctorReport {
  /** Every check, in report order. */
  readonly checks: readonly DoctorCheck[]
  /** True when no check is in the `fail` status. */
  readonly ok: boolean
}

/** Build one check, omitting an absent hint so `exactOptionalPropertyTypes` holds. */
function check(
  id: string,
  title: string,
  status: DoctorCheck['status'],
  detail: string,
  hint?: string,
): DoctorCheck {
  return hint === undefined ? { id, title, status, detail } : { id, title, status, detail, hint }
}

/** The Harness home directory, honouring `DSH_HOME` before the platform default. */
function dshHome(): string {
  const configured = process.env.DSH_HOME
  return configured === undefined || configured === '' ? join(homedir(), '.dsh') : configured
}

/** Read a file as UTF-8, or `undefined` when it does not exist or cannot be read. */
function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Whether the running Node version satisfies the workspace engine range. */
function nodeVersionSatisfied(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(part => Number.parseInt(part, 10))
  return (major === 22 && minor >= 19) || major >= 24
}

/** Probe one loopback TCP port. */
function probePort(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (open: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** The profile manifest's declared bundle list, or `undefined` when unreadable. */
function declaredBundles(): readonly string[] | undefined {
  const raw = readText(join(profileDir(), 'package.json'))
  if (raw === undefined) return undefined
  try {
    const manifest = JSON.parse(raw) as { dsh?: { profile?: { bundles?: unknown } } }
    const bundles = manifest.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.map(String) : []
  } catch {
    return []
  }
}

/** Whether the profile declares exactly this CLI's bundle stack, in order. */
function bundlesMatch(declared: readonly string[]): boolean {
  return declared.length === PROFILE_BUNDLES.length
    && declared.every((value, index) => value === PROFILE_BUNDLES[index])
}

/** Where the provider credential was found, without ever reading its value. */
function credentialSource(): 'env' | 'credentials-file' | undefined {
  const fromEnv = process.env[PROVIDER_KEY]
  if (fromEnv !== undefined && fromEnv !== '') return 'env'
  const raw = readText(join(dshHome(), '.credentials.yaml'))
  if (raw === undefined) return undefined
  const declared = raw.split(/\r?\n/u).some(line => line.trimStart().startsWith(`${PROVIDER_KEY}:`))
  return declared ? 'credentials-file' : undefined
}

/** How many MCP servers the registry file declares, or `undefined` when unreadable. */
function mcpServerCount(): number | undefined {
  const raw = readText(join(dshHome(), 'mcpServers.json'))
  if (raw === undefined) return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const nested = parsed['mcpServers']
    const table = typeof nested === 'object' && nested !== null && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : parsed
    return Object.keys(table).length
  } catch {
    return undefined
  }
}

/**
 * Collect every diagnostic check without touching the filesystem.
 * @returns the complete report.
 */
export async function collectDiagnostics(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = []

  checks.push(nodeVersionSatisfied()
    ? check('node-version', 'Node runtime', 'ok', `v${process.versions.node}`)
    : check('node-version', 'Node runtime', 'fail', `v${process.versions.node}`, 'Install Node ^22.19.0 or >=24.0.0'))

  const pnpmProgram = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const pnpm = spawnSync(pnpmProgram, ['--version'], { encoding: 'utf8' })
  checks.push(pnpm.status === 0
    ? check('pnpm-available', 'pnpm', 'ok', String(pnpm.stdout).trim() || 'available')
    : check('pnpm-available', 'pnpm', 'warn', 'pnpm is not on PATH', 'Install pnpm 11.x (corepack enable)'))

  const harnessEntry = join(REPO_ROOT, 'packages', 'bundle', 'base', 'lib', 'index.js')
  checks.push(existsSync(harnessEntry)
    ? check('harness-build', 'Harness build', 'ok', harnessEntry)
    : check('harness-build', 'Harness build', 'fail', `missing ${harnessEntry}`, 'Run `pnpm run build` from the repository root'))

  const declared = declaredBundles()
  checks.push(declared !== undefined && bundlesMatch(declared)
    ? check('profile-manifest', 'Profile manifest', 'ok', `${profileDir()} — ${PROFILE_BUNDLES.join(', ')}`)
    : check(
      'profile-manifest',
      'Profile manifest',
      'fail',
      declared === undefined ? `missing ${join(profileDir(), 'package.json')}` : `declared bundles: ${declared.join(', ') || '(none)'}`,
      'Run `kibborg doctor --fix`',
    ))

  const linksDir = join(dshHome(), 'profiles', 'node_modules', '@kibborg')
  const missingLinks = REQUIRED_PROFILE_LINKS.filter(name => !existsSync(join(linksDir, name)))
  checks.push(missingLinks.length === 0
    ? check('profile-links', 'Profile module links', 'ok', linksDir)
    : check('profile-links', 'Profile module links', 'fail', `missing: ${missingLinks.join(', ')}`, 'Run `kibborg doctor --fix`'))

  const missingArtifacts = REQUIRED_ARTIFACTS.filter(relative => !existsSync(join(REPO_ROOT, relative)))
  checks.push(missingArtifacts.length === 0
    ? check('cli-artifacts', 'CLI artifacts', 'ok', REQUIRED_ARTIFACTS.join(', '))
    : check(
      'cli-artifacts',
      'CLI artifacts',
      'fail',
      `missing: ${missingArtifacts.join(', ')}`,
      'Build: `pnpm exec tsc -b Kibborg_CLI/packages/client-node/tsconfig.json Kibborg_CLI/packages/cli-bundle/tsconfig.json Kibborg_CLI/apps/cli/tsconfig.json`, then `pnpm exec tsdown --config tsdown.config.ts` from Kibborg_CLI',
    ))

  const source = credentialSource()
  checks.push(source === undefined
    ? check('provider-key', 'Provider credential', 'fail', `${PROVIDER_KEY} is not set`, 'Set it in the environment or in $DSH_HOME/.credentials.yaml')
    : check('provider-key', 'Provider credential', 'ok', source === 'env' ? 'set in the environment' : 'set in credentials.yaml'))

  const cdp = await probePort(CDP_PORT, 700)
  checks.push(cdp
    ? check('chrome-cdp', 'Chrome DevTools', 'ok', `127.0.0.1:${String(CDP_PORT)} accepts connections`)
    : check('chrome-cdp', 'Chrome DevTools', 'warn', `127.0.0.1:${String(CDP_PORT)} is closed`, 'Optional: browser tooling needs Chrome with --remote-debugging-port=9222'))

  const servers = mcpServerCount()
  checks.push(servers === undefined
    ? check('mcp-registry', 'MCP registry', 'warn', `no readable ${join(dshHome(), 'mcpServers.json')}`)
    : check('mcp-registry', 'MCP registry', 'ok', `${String(servers)} server(s) declared`))

  return { checks, ok: checks.every(item => item.status !== 'fail') }
}

/** Print one report in the readable layout. */
function printReadable(report: DoctorReport): void {
  const mark = { ok: '[ok]  ', warn: '[warn]', fail: '[fail]' } as const
  for (const item of report.checks) {
    process.stdout.write(`${mark[item.status]} ${item.id}: ${item.detail}\n`)
    if (item.hint !== undefined) process.stdout.write(`       hint: ${item.hint}\n`)
  }
  const failures = report.checks.filter(item => item.status === 'fail').length
  process.stdout.write(`kibborg doctor: ${String(report.checks.length)} checks, ${String(failures)} failing\n`)
}

/**
 * Repair the profile and its module fallback, printing every change.
 * @returns the changes applied, one line each.
 */
async function applyFixes(): Promise<string[]> {
  const changes: string[] = []
  const dir = profileDir()
  if (!existsSync(join(dir, 'package.json'))) {
    initProfile(dir, PROFILE_BUNDLES)
    changes.push(`created profile ${dir} with bundles ${PROFILE_BUNDLES.join(', ')}`)
  }
  const declared = declaredBundles()
  if (declared === undefined || !bundlesMatch(declared)) {
    initProfile(dir, PROFILE_BUNDLES)
    prepareProfile()
    changes.push(`repaired bundle list in ${join(dir, 'package.json')}`)
  }
  healProfilesModuleFallback(INSTALL_ANCHOR)
  changes.push(`healed module fallback ${join(dshHome(), 'profiles', 'node_modules')}`)
  return changes
}

/**
 * Run the diagnostics, optionally repair, and report.
 * @param options - `json` selects the machine-readable report; `fix` applies the safe repairs first.
 * @returns the process exit code: 0 when the report is ok, 1 otherwise.
 */
export async function runDoctor(options: { json: boolean; fix: boolean }): Promise<number> {
  const changes = options.fix ? await applyFixes() : []
  const report = await collectDiagnostics()
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ok: report.ok,
      ...(changes.length === 0 ? {} : { changes }),
      checks: report.checks,
    }, undefined, 2)}\n`)
    return report.ok ? 0 : 1
  }
  if (changes.length > 0) {
    process.stdout.write('kibborg doctor --fix: applied\n')
    for (const change of changes) process.stdout.write(`  ${change}\n`)
  }
  printReadable(report)
  return report.ok ? 0 : 1
}
