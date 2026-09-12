/**
 * Import boundaries of the `@kibborg` workspace.
 *
 * The CLI is a separate workspace from the harness: it may import published
 * package names (`@deepseek-ai/*`, `@kibborg/*`, Node builtins) and its own
 * files, but a relative import must not escape the package it belongs to and no
 * file may reach into the harness sources by path. Without this gate a stray
 * `../../packages/core/session/src/...` would compile locally and break every
 * published and installed copy of the CLI.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every `.ts` file under one directory tree. */
function sourcesUnder(directory: string): readonly string[] {
  const found: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib') continue
        walk(path)
      } else if (entry.name.endsWith('.ts')) {
        found.push(path)
      }
    }
  }
  if (statSync(directory, { throwIfNoEntry: false })?.isDirectory() === true) walk(directory)
  return found
}

/** Relative specifiers of every static import and re-export in one file. */
function relativeSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = []
  const pattern = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/gu
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2]
    if (specifier !== undefined && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      specifiers.push(specifier)
    }
  }
  return specifiers
}

/** The package directory an imported file lives in: `packages/<name>` or `apps/<name>`. */
function packageRootOf(file: string): string {
  const parts = relative(root, file).split(/[\\/]/u)
  return resolve(root, parts[0] ?? '', parts[1] ?? '')
}

const files = [
  ...sourcesUnder(join(root, 'packages')),
  ...sourcesUnder(join(root, 'apps')),
]

describe('import boundaries', () => {
  it('finds the workspace sources', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('never imports outside its own package by path', () => {
    const offenders: string[] = []
    for (const file of files) {
      const ownPackage = packageRootOf(file)
      for (const specifier of relativeSpecifiers(readFileSync(file, 'utf8'))) {
        const target = resolve(dirname(file), specifier)
        const inside = relative(ownPackage, target)
        if (inside.startsWith('..')) {
          offenders.push(`${relative(root, file)} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('never reaches the harness sources by path', () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const pattern = /['"]([^'"]*(?:packages|vendor)[\\/][^'"]*\.(?:ts|js))['"]/gu
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1]
        if (specifier !== undefined && (specifier.startsWith('.') || specifier.startsWith('/'))) {
          offenders.push(`${relative(root, file)} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('imports only published names from outside the workspace', () => {
    const allowed = [/^@deepseek-ai\//u, /^@kibborg\//u, /^node:/u, /^[a-z@][^/\\]*$/u, /^[a-z@][^/\\]*\/[^/\\]*$/u]
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const pattern = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/gu
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1] ?? match[2]
        if (specifier === undefined || specifier.startsWith('.') || specifier.startsWith('/')) continue
        if (!allowed.some(rule => rule.test(specifier))) {
          offenders.push(`${relative(root, file)} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
