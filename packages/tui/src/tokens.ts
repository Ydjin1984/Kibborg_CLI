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
  AgentKibborg: [92, 225, 230],
  AgentDeepSeek: [76, 141, 255],
  AgentGrok: [192, 132, 252],
  AgentFlash: [255, 158, 74],
  AgentCodex: [87, 214, 138],
  AgentClaude: [232, 160, 122],
  RoleBadge: [139, 147, 161],
  ActionThink: [122, 132, 148],
  ActionTool: [92, 225, 230],
  ActionFile: [165, 180, 252],
  ActionDelegate: [232, 121, 249],
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
  AgentKibborg: '96',
  AgentDeepSeek: '94',
  AgentGrok: '95',
  AgentFlash: '33',
  AgentCodex: '92',
  AgentClaude: '33',
  RoleBadge: '90',
  ActionThink: '90',
  ActionTool: '96',
  ActionFile: '94',
  ActionDelegate: '95',
}

/** No-op palette for plain output. */
export const plainPalette: Palette = { paint: text => text, sgr: () => '' }

/**
 * Colors an agent can be drawn in when nothing identifies it.
 *
 * Known agents get a fixed color from {@link AGENT_NAMES}, so the same product
 * reads the same way in every session; an unknown one is placed by its name.
 */
const AGENT_TOKENS: readonly TokenName[] = [
  'AgentKibborg',
  'AgentDeepSeek',
  'AgentGrok',
  'AgentFlash',
  'AgentCodex',
  'AgentClaude',
]

/** Fixed color of the agents a deployment is likely to name. */
const AGENT_NAMES: readonly (readonly [RegExp, TokenName])[] = [
  // The executor route is checked before the product name: `kibborg/Kibborg_Flash`
  // is the local executor, and it has to read as its own agent, not as the head.
  [/flash/i, 'AgentFlash'],
  [/grok/i, 'AgentGrok'],
  [/deepseek/i, 'AgentDeepSeek'],
  [/kibborg/i, 'AgentKibborg'],
  [/codex|openai|gpt/i, 'AgentCodex'],
  [/claude|anthropic/i, 'AgentClaude'],
]

/**
 * Pick the color of one agent.
 *
 * The same name always maps to the same color, so a transcript stays readable
 * while agents come and go, and two agents in one run rarely share a color. The
 * color answers "who", never "what": roles and actions have their own tokens.
 * @param seed - the agent's identity, normally its model or label.
 * @returns the token to draw that agent in.
 */
export function agentToken(seed: string): TokenName {
  for (const [pattern, token] of AGENT_NAMES) {
    if (pattern.test(seed)) return token
  }
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
