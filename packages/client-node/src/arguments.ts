/**
 * Argument rendering for the transcript.
 *
 * A tool call arrives as raw JSON, where a file body or a script is one escaped
 * line. Printing that verbatim is correct and unreadable, so the values that carry
 * newlines are written out as indented blocks while the argument structure stays
 * visible.
 * @module kibborg/arguments
 */

/**
 * Pretty-print an argument JSON string.
 * @param raw - the argument text exactly as the model produced it.
 * @returns the pretty-printed document, or the trimmed original when it is not JSON.
 */
export function prettyArguments(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  try {
    return expandMultilineValues(JSON.stringify(JSON.parse(trimmed), undefined, 2))
  } catch {
    return trimmed
  }
}

/**
 * Expand multi-line string values into real lines.
 * @param json - pretty-printed argument JSON.
 * @returns the same document with multi-line values written out.
 */
export function expandMultilineValues(json: string): string {
  const out: string[] = []
  for (const line of json.split('\n')) {
    const match = /^(\s*)"([^"]*)":\s*"((?:[^"\\]|\\.)*)"(,?)$/u.exec(line)
    if (match === null) {
      out.push(line)
      continue
    }
    const indent = match[1] ?? ''
    const key = match[2] ?? ''
    const rawValue = match[3] ?? ''
    const trailing = match[4] ?? ''
    let value: string
    try {
      value = JSON.parse(`"${rawValue}"`) as string
    } catch {
      out.push(line)
      continue
    }
    if (!value.includes('\n')) {
      out.push(line)
      continue
    }
    const inner = `${indent}  `
    const body = value.split('\n')
    out.push(`${indent}"${key}":`)
    for (const [index, part] of body.entries()) {
      out.push(`${inner}${part}${index === body.length - 1 ? trailing : ''}`)
    }
  }
  return out.join('\n')
}
