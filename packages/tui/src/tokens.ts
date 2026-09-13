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
  /** Identity of an agent, so the same agent keeps the same color everywhere. */
  | 'AgentKibborg'
  | 'AgentDeepSeek'
  | 'AgentGrok'
  | 'AgentFlash'
  | 'AgentCodex'
  | 'AgentClaude'
  /** The role an agent runs in: muted by design, never the agent's own color. */
  | 'RoleBadge'
  /** What kind of work a row reports, independent of who did it. */
  | 'ActionThink'
  | 'ActionTool'
  | 'ActionFile'
  | 'ActionDelegate'

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

/** True-color values of the GrokNight palette. */
const TRUE_COLOR: Readonly<Record<TokenName, readonly [number, number, number]>> = {
  // One accent carries attention: the prompt, the chosen row, a link. Everything
  // else is neutral text, a border, or one of the three semantic states.
  Accent: [122, 162, 247],
  Shimmer: [153, 186, 255],
  Success: [126, 201, 154],
  Warn: [214, 178, 106],
  Error: [226, 116, 133],
  Muted: [138, 143, 152],
  Subtle: [70, 75, 85],
  Text: [220, 223, 228],
  Surface: [22, 24, 28],
  BashPink: [206, 145, 190],
  PermLav: [166, 173, 200],
  DiffAdd: [126, 201, 154],
  DiffRemove: [226, 116, 133],
  Orange: [214, 178, 106],
  Answer: [226, 230, 236],
  // Agents are told apart by name, model, and role, not by color: six hues made the
  // transcript look like a chart, and the same model changed color between builds.
  AgentKibborg: [220, 223, 228],
  AgentDeepSeek: [220, 223, 228],
  AgentGrok: [220, 223, 228],
  AgentFlash: [220, 223, 228],
  AgentCodex: [220, 223, 228],
  AgentClaude: [220, 223, 228],
  RoleBadge: [138, 143, 152],
  // What a row reports is stated by its glyph and its words; color stays with the
  // outcome, so a failed call is the only loud thing on the line.
  ActionThink: [138, 143, 152],
  ActionTool: [138, 143, 152],
  ActionFile: [138, 143, 152],
  ActionDelegate: [138, 143, 152],
}

/** 16-color fallbacks, preserving the meaning of each token. */
const FALLBACK: Readonly<Record<TokenName, string>> = {
  Accent: '94',
  Shimmer: '94',
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
  AgentKibborg: '97',
  AgentDeepSeek: '97',
  AgentGrok: '97',
  AgentFlash: '97',
  AgentCodex: '97',
  AgentClaude: '97',
  RoleBadge: '90',
  ActionThink: '90',
  ActionTool: '90',
  ActionFile: '90',
  ActionDelegate: '90',
}

/** No-op palette for plain output. */
export const plainPalette: Palette = { paint: text => text, sgr: () => '' }

/**
 * Palette that keeps the terminal's own colors.
 *
 * No color is emitted at all: text inherits the profile's foreground, and only the
 * bold and dim attributes carry emphasis. A terminal whose palette is already
 * chosen — a themed emulator, a color scheme the user likes — then shows Kibborg
 * in it instead of fighting it.
 * @returns the palette for the `terminal` theme.
 */
export function terminalPalette(): Palette {
  const sgr = (_token: TokenName, style?: TokenStyle): string => {
    const codes = attributeCodes(style)
    return codes.length === 0 ? '' : `${ESC}[${codes.join(';')}m`
  }
  return {
    sgr,
    paint: (text, token, style) => {
      const prefix = sgr(token, style)
      return prefix === '' ? text : `${prefix}${text}${ESC}[0m`
    },
  }
}

/**
 * Pick the color of one agent.
 *
 * Every agent reads as ordinary text: who is working is stated by its name, its
 * model, and its role, and the transcript stays legible when several agents share
 * a turn. Color is kept for state — success, warning, failure, a change — so a
 * glance finds the outcome rather than the speaker.
 * @param seed - the agent's identity; accepted so callers need not change.
 * @returns the token to draw that agent in.
 */
export function agentToken(seed: string): TokenName {
  return seed === '' ? 'Muted' : 'Text'
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
 * transcript for a bug report wants. `terminal` keeps the profile's own colors and
 * emits only attributes. It is a palette rather than a separate render path, so
 * every widget keeps painting tokens either way.
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
  if (theme === 'mono') return plainPalette
  if (theme === 'terminal') return terminalPalette()
  return paletteFor(environment, interactive)
}
