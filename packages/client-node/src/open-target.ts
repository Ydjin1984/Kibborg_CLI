/**
 * Opening a link or file the user Ctrl+clicked in the transcript.
 *
 * The surface resolves the target under the pointer (a hyperlink cell or a
 * path-shaped run of text) and hands it here; the platform's own opener then
 * decides what "open" means, so a Markdown link goes to the browser and a path
 * goes to the editor or file manager the user configured.
 * @module kibborg/open-target
 */

import { spawn } from 'node:child_process'

/** Turn a `file://` URL back into a local path. */
function localPathOf(target: string): string {
  if (!/^file:\/\//iu.test(target)) return target
  const withoutScheme = target.replace(/^file:\/\//iu, '')
  const decoded = decodeURIComponent(withoutScheme)
  // Windows paths arrive as `/D:/dir/file`, which the opener does not accept.
  return /^\/[A-Za-z]:/u.test(decoded) ? decoded.slice(1) : decoded
}

/**
 * Open a target with the platform's opener.
 *
 * The child is detached on purpose: the opener outlives this process and must
 * never block the terminal.
 * @param target - a URL, an absolute path, or a `file://` URL.
 * @returns whether an opener was started.
 */
export function openTarget(target: string): boolean {
  const value = localPathOf(target)
  if (value.trim() === '') return false
  const [command, args] = process.platform === 'win32'
    // `start` is a cmd builtin; the empty string is the window title it expects.
    ? ['cmd', ['/c', 'start', '', value]]
    : process.platform === 'darwin'
      ? ['open', [value]]
      : ['xdg-open', [value]]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return true
  } catch {
    return false
  }
}
