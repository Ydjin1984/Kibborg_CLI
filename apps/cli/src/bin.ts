#!/usr/bin/env node
/**
 * kibborg — command-line entry.
 *
 * Process-level commands are answered here (`version`, `doctor`, the config
 * dumps); a task boots the `kibborg` profile and hands the text to the tree
 * through `ctx.cmdlineArgs`, where the in-process client answers it. Dynamic
 * imports keep a diagnostic run out of the boot path and vice versa.
 * @module @kibborg/cli/bin
 */

/* v8 ignore file -- the built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseKiborgArgs } from './args.ts'
import { buildToolOverlay } from './tool-filter.ts'

/** This app's version, read from its checked-in package.json. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

const version = readVersion()
const invocation = parseKiborgArgs(process.argv.slice(2), version)

/**
 * The overlay files this invocation boots with: the caller's `--patch` files
 * plus, when it restricted the tool set, one generated file that disables the
 * rows it did not ask for.
 * @param patches - the `--patch` paths, in argv order.
 * @param intent - this invocation's intent.
 * @returns the patch files to apply, in order.
 */
function patchFilesOf(patches: readonly string[], intent: { tools?: readonly string[]; deny?: readonly string[] }): string[] {
  const files = [...patches]
  const overlay = buildToolOverlay({
    ...(intent.tools === undefined ? {} : { tools: intent.tools }),
    ...(intent.deny === undefined ? {} : { deny: intent.deny }),
  })
  if (overlay === undefined) return files
  const file = join(tmpdir(), `kibborg-tools-${String(process.pid)}.yml`)
  writeFileSync(file, overlay, 'utf8')
  files.push(file)
  return files
}

switch (invocation.mode) {
  case 'version': {
    process.stdout.write(`${version}\n`)
    break
  }
  case 'doctor': {
    const { runDoctor } = await import('./doctor.ts')
    process.exit(await runDoctor({ json: invocation.json, fix: invocation.fix }))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.defaultOnly, patchFilesOf(invocation.patches, invocation))
    break
  }
  case 'serve': {
    const { buildServeOverlay, serveRefusal } = await import('./serve.ts')
    const token = invocation.token ?? process.env['KIBBORG_SERVER_TOKEN'] ?? ''
    const refusal = serveRefusal({ ...invocation, ...(token === '' ? {} : { token }) })
    if (refusal !== undefined) {
      process.stderr.write(`${refusal}\n`)
      process.exit(2)
    }
    const { runProfile } = await import('./profile-boot.ts')
    const overlay = buildServeOverlay({ ...invocation, ...(token === '' ? {} : { token }) })
    const overlayFile = join(tmpdir(), `kibborg-serve-${String(process.pid)}.yml`)
    writeFileSync(overlayFile, overlay, 'utf8')
    if (token !== '') process.env['KIBBORG_SERVER_TOKEN'] = token
    if (invocation.mdns) process.env['KIBBORG_SERVE_MDNS'] = '1'
    if (invocation.instance !== undefined) process.env['KIBBORG_SERVE_INSTANCE'] = invocation.instance
    const ctx = await runProfile({
      environment: loadLayeredEnv('kibborg'),
      patchFiles: [...invocation.patches, overlayFile],
      args: [],
    })
    const display = invocation.host
    process.stderr.write(`kibborg serve: listening on http://${display}:${String(invocation.port)} (token ${token === '' ? 'not required on loopback' : 'required'})\n`)
    process.stderr.write(`kibborg serve: health http://${display}:${String(invocation.port)}/healthz, api ${invocation.host === '0.0.0.0' ? 'http://<this-host>' : `http://${display}`}:${String(invocation.port)}/api\n`)
    void ctx
    break
  }
  case 'discover': {
    const { discoverServers, formatDiscovered } = await import('@kibborg/server/mdns')
    const servers = await discoverServers({ timeoutMs: invocation.timeoutMs })
    process.stdout.write(invocation.json
      ? `${JSON.stringify(servers, undefined, 2)}\n`
      : formatDiscovered(servers).join(''))
    process.exit(servers.length === 0 ? 1 : 0)
    break
  }
  case 'client': {
    const { runProfile } = await import('./profile-boot.ts')
    const intent = invocation.intent
    // Invocation-scoped choices reach the tree as launcher facts: the sandbox
    // and approval rows read DSH_PERMISSION_MODE at mount, the client half reads
    // the model selection and the intent from its own variables.
    if (intent.permissionMode !== undefined) process.env['DSH_PERMISSION_MODE'] = intent.permissionMode
    if (intent.model !== undefined) process.env['KIBBORG_MODEL'] = intent.model
    if (intent.effort !== undefined) process.env['KIBBORG_EFFORT'] = intent.effort
    process.env['KIBBORG_INTENT'] = JSON.stringify(intent)
    if (process.env['KIBBORG_TRACE'] === '1') {
      process.stderr.write(`kibborg[trace]: intent ${JSON.stringify(intent)}\n`)
    }
    // A worktree isolates this invocation before anything else observes the
    // working directory: the profile boots, the session is created, and every
    // tool runs inside the new checkout.
    if (intent.worktree !== undefined) {
      const { createWorktree } = await import('./worktree.ts')
      const created = createWorktree(intent.worktree)
      if (created === undefined) {
        process.stderr.write('kibborg: --worktree needs a git repository and a free branch name\n')
        process.exit(1)
      }
      process.stderr.write(`kibborg: worktree ${created.dir} (branch ${created.branch})\n`)
      process.chdir(created.dir)
    }
    const ctx = await runProfile({
      environment: loadLayeredEnv('kibborg'),
      patchFiles: patchFilesOf(invocation.patches, intent),
      args: intent.task === undefined || intent.task === '' ? [] : [intent.task],
    })
    void ctx
    break
  }
  default:
    invocation satisfies never
    throw new Error(`kibborg: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
