/**
 * Composer completion: the pure decision behind the Tab key.
 *
 * The loop owns the keyboard and the terminal, so the interesting part — what a
 * prefix completes to — lives here as a function of the draft and the candidate
 * sources. A single candidate replaces the token; several are returned so the
 * surface can list them without guessing which one the user meant.
 * @module @kibborg/tui/completion
 */

/** Prefixes that switch the composer into a completion source. */
export const COMMAND_PREFIX = '/'
export const FILE_PREFIX = '@'
export const SESSION_PREFIX = '#'

/** The candidate sets a completion can draw from. */
export interface CompletionSources {
  /** Slash command names, without the leading slash. */
  readonly commands: readonly string[]
  /** File paths relative to the working directory. */
  readonly files: readonly string[]
  /** Session ids or titles the `#` prefix addresses. */
  readonly sessions: readonly string[]
}

/** What the Tab key should do with the current draft. */
export interface CompletionResult {
  /** The draft after completion; unchanged when nothing matched or several did. */
  readonly draft: string
  /** Matching candidates, empty when nothing matched but the prefix was active. */
  readonly candidates: readonly string[]
  /** Whether the draft's active token was a completion prefix at all. */
  readonly active: boolean
}

/** Locate the token a completion would replace: the head, or the last word. */
function activeToken(draft: string): { readonly start: number; readonly text: string } {
  const match = /(?:^|\s)([/@#][^\s]*)$/.exec(draft)
  if (match === null) return { start: draft.length, text: '' }
  const text = match[1] ?? ''
  return { start: draft.length - text.length, text }
}

/** Match candidates against a prefix, case-insensitively for names and exactly for paths. */
function match(candidates: readonly string[], prefix: string, options: { readonly insensitive: boolean }): readonly string[] {
  const needle = options.insensitive ? prefix.toLowerCase() : prefix
  return candidates
    .filter(candidate => (options.insensitive ? candidate.toLowerCase() : candidate).startsWith(needle))
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Decide what the Tab key completes the draft to.
 * @param draft - the composer's current text.
 * @param sources - the candidate sets.
 * @returns the completed draft, the matches, and whether a prefix was active.
 */
export function completeDraft(draft: string, sources: CompletionSources): CompletionResult {
  const token = activeToken(draft)
  if (token.text === '') return { draft, candidates: [], active: false }
  const prefix = token.text.slice(0, 1)
  const rest = token.text.slice(1)
  const candidates = prefix === COMMAND_PREFIX
    ? match(sources.commands, rest, { insensitive: true })
    : prefix === FILE_PREFIX
      ? match(sources.files, rest, { insensitive: false })
      : prefix === SESSION_PREFIX
        ? match(sources.sessions, rest, { insensitive: true })
        : []
  if (prefix !== COMMAND_PREFIX && prefix !== FILE_PREFIX && prefix !== SESSION_PREFIX) {
    return { draft, candidates: [], active: false }
  }
  const only = candidates.length === 1 ? candidates[0] : undefined
  if (only === undefined) return { draft, candidates, active: true }
  const replacement = `${prefix}${only}${prefix === COMMAND_PREFIX ? '' : ' '}`
  return {
    draft: `${draft.slice(0, token.start)}${replacement}`,
    candidates,
    active: true,
  }
}

/**
 * Render the candidates as one line the surface can print above the composer.
 * @param candidates - the matches to show.
 * @param limit - how many to show before eliding the rest.
 * @returns the hint line, or an empty string when there is nothing to show.
 */
export function completionHint(candidates: readonly string[], limit = 8): string {
  if (candidates.length === 0) return ''
  const shown = candidates.slice(0, limit).join('  ')
  const rest = candidates.length > limit ? `  (+${candidates.length - limit} more)` : ''
  return `${shown}${rest}`
}
