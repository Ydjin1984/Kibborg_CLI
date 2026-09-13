/**
 * Theme tokens of the terminal surface.
 *
 * The palette is the interface's only source of color: widgets name a token and
 * the palette decides how to render it for the current terminal, falling back to
 * the 16-color set when true color is unavailable and to plain text when color
 * is refused. `UI.md` §2 owns the token values.
 * @module @kibborg/tui/tokens
 */

/** The theme's color vocabulary. */
export type TokenName =
  | 'Accent'
  | 'Shimmer'
  | 'Success'
  | 'Warn'
  | 'Error'
  | 'Muted'
  | 'Subtle'
  | 'Text'
  | 'Surface'
  | 'BashPink'
  | 'PermLav'
  | 'DiffAdd'
  | 'DiffRemove'
  | 'Orange'
  | 'Answer'

/** Rendering state applied alongside a color. */
export interface TokenStyle {
  /** Emit the bold attribute. */
  readonly bold?: boolean
  /** Emit the dim attribute. */
  readonly dim?: boolean
  /** Emit the underline attribute. */
  readonly underline?: boolean
}

/** Color renderer over the active terminal capability. */
export interface Palette {
  /**
   * Wrap text in the token's color.
   * @param text - the text to paint.
   * @param token - the theme token naming its color.
   * @param style - optional bold/dim attributes.
   * @returns the painted text (or the text unchanged in plain output).
   */
  paint(text: string, token: TokenName, style?: TokenStyle): string
  /**
   * Build the opening SGR sequence for a token, without text or reset.
   *
   * The framebuffer stores this prefix per cell so a repainted frame can compare
   * two cells by their value instead of rebuilding and comparing style objects.
   * @param token - the theme token naming its color.
   * @param style - optional bold/dim attributes.
   * @returns the SGR prefix, or the empty string in plain output.
   */
  sgr(token: TokenName, style?: TokenStyle): string
}

/** Escape character starting every ANSI sequence this module emits. */
const ESC = '\u001B'

/** True-color values for `UI.md` §2. */
const TRUE_COLOR: Readonly<Record<TokenName, readonly [number, number, number]>> = {
  Accent: [92, 225, 230],
  Shimmer: [154, 240, 243],
  Success: [61, 220, 151],
  Warn: [245, 185, 66],
  Error: [255, 92, 122],
  Muted: [122, 132, 148],
  Subtle: [58, 66, 80],
  Text: [214, 222, 235],
  Surface: [22, 27, 34],
  BashPink: [232, 121, 249],
  PermLav: [165, 180, 252],
  DiffAdd: [87, 214, 138],
  DiffRemove: [240, 113, 133],
  Orange: [255, 158, 74],
  Answer: [226, 232, 240],
}

/** 16-color fallbacks, preserving the meaning of each token. */
const FALLBACK: Readonly<Record<TokenName, string>> = {
  Accent: '96',
  Shimmer: '96',
  Success: '92',
  Warn: '93',
  Error: '91',
  Muted: '90',
  Subtle: '90',
  Text: '97',
  Surface: '40',
  BashPink: '95',
  DiffAdd: '92',
  DiffRemove: '91',
  Orange: '33',
  Answer: '97',
  PermLav: '94',
}

/** No-op palette for plain output. */
export const plainPalette: Palette = { paint: text => text, sgr: () => '' }

/**
 * Colors an agent can be drawn in.
 *
 * They are existing theme tokens, chosen for even separation at 16 colors, so a
 * deployment never has to declare a color per agent.
 */
const AGENT_TOKENS: readonly TokenName[] = ['Accent', 'Orange', 'BashPink', 'PermLav', 'Shimmer', 'Warn', 'Answer', 'Success']

/**
 * Pick the color of one agent.
 *
 * The same name always maps to the same color, so a transcript stays readable
 * while agents come and go, and two agents in one run rarely share a color.
 * @param seed - the agent's identity, normally its model or label.
 * @returns the token to draw that agent in.
 */
export function agentToken(seed: string): TokenName {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0
  }
  const slot = Math.abs(hash) % AGENT_TOKENS.length
  return AGENT_TOKENS[slot] as TokenName
}

/** Bold/dim/underline parameters, appended after the color parameters of one SGR sequence. */
function attributeCodes(style: TokenStyle | undefined): readonly string[] {
  const codes: string[] = []
  if (style?.dim === true) codes.push('2')
  if (style?.bold === true) codes.push('1')
  if (style?.underline === true) codes.push('4')
  return codes
}

/** Build a palette that emits 24-bit color. */
export function trueColorPalette(): Palette {
  const sgr = (token: TokenName, style?: TokenStyle): string => {
    const [red, green, blue] = TRUE_COLOR[token]
    const params = [`38;2;${String(red)};${String(green)};${String(blue)}`, ...attributeCodes(style)]
    return `${ESC}[${params.join(';')}m`
  }
  return {
    sgr,
    paint: (text, token, style) => `${sgr(token, style)}${text}${ESC}[0m`,
  }
}

/** Build a palette that emits the 16-color fallback set. */
export function fallbackPalette(): Palette {
  const sgr = (token: TokenName, style?: TokenStyle): string => {
    const params = [FALLBACK[token], ...attributeCodes(style)]
    return `${ESC}[${params.join(';')}m`
  }
  return {
    sgr,
    paint: (text, token, style) => `${sgr(token, style)}${text}${ESC}[0m`,
  }
}

/**
 * Choose the palette for this process.
 * @param environment - the environment to read; defaults to the process environment.
 * @param interactive - whether output is a terminal; a redirect never gets color.
 * @returns the plain, true-color, or fallback palette.
 */
export function paletteFor(
  environment: NodeJS.ProcessEnv = process.env,
  interactive: boolean = process.stdout.isTTY === true,
): Palette {
  const refused = (environment['NO_COLOR'] ?? '') !== '' || environment['TERM'] === 'dumb'
  if (!interactive || refused) return plainPalette
  const capable = environment['COLORTERM'] !== undefined
    || environment['WT_SESSION'] !== undefined
    || environment['TERM_PROGRAM'] !== undefined
  return capable ? trueColorPalette() : fallbackPalette()
}

/**
 * Choose the palette for a named theme preset.
 *
 * `mono` prints without color at all — the shape of the output is then carried
 * by the glyphs and indentation alone, which is what a monochrome terminal or a
 * transcript for a bug report wants. It is a palette rather than a separate
 * render path, so every widget keeps painting tokens either way.
 * @param theme - the preset name from the surface's settings section.
 * @param environment - the environment to read.
 * @param interactive - whether output is a terminal.
 * @returns the palette for that preset.
 */
export function paletteForTheme(
  theme: string,
  environment: NodeJS.ProcessEnv = process.env,
  interactive: boolean = process.stdout.isTTY === true,
): Palette {
  return theme === 'mono' ? plainPalette : paletteFor(environment, interactive)
}
