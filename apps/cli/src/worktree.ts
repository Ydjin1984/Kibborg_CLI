/**
 * Git worktree support of the launcher.
 *
 * `--worktree` isolates an invocation in its own checkout: the worktree is
 * created from the repository the current directory belongs to, and the rest of
 * the invocation — profile boot, session creation, tools — runs inside it. The
 * worktree is left in place afterwards so its changes stay inspectable; the
 * launcher prints where it is.
 * @module @kibborg/cli/worktree
 */

import { spawnSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'

/** A worktree the launcher created for this invocation. */
export interface CreatedWorktree {
  /** Absolute path of the new checkout. */
  readonly dir: string
  /** Branch the worktree checks out. */
  readonly branch: string
}

/** Run one git command in a directory, returning trimmed stdout or nothing. */
function git(cwd: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' })
  if (result.status !== 0) return undefined
  return String(result.stdout).trim()
}

/** Turn a user-supplied name into a branch name git accepts. */
function branchName(requested: string): string {
  const trimmed = requested.trim()
  if (trimmed !== '') {
    return trimmed.replace(/[^A-Za-z0-9._/-]/gu, '-').replace(/^[-./]+/u, '')
  }
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)
  return `kibborg/${stamp}`
}

/**
 * Create a worktree for this invocation.
 * @param requested - the branch name from `--worktree <name>`, or an empty string for a generated one.
 * @param cwd - the directory the invocation started in; defaults to the process directory.
 * @returns the created worktree, or `undefined` when the directory is not a git repository.
 */
export function createWorktree(requested: string, cwd: string = process.cwd()): CreatedWorktree | undefined {
  const root = git(cwd, ['rev-parse', '--show-toplevel'])
  if (root === undefined || root === '') return undefined
  const branch = branchName(requested)
  if (branch === '') return undefined
  const dir = join(dirname(root), `${basename(root)}-${branch.replace(/[/\\]/gu, '-')}`)
  const created = git(root, ['worktree', 'add', '-b', branch, dir])
  if (created === undefined) {
    // A branch may already exist: check the worktree out on it instead of failing.
    const reused = git(root, ['worktree', 'add', dir, branch])
    if (reused === undefined) return undefined
  }
  return { dir, branch }
}
