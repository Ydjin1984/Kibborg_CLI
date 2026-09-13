/**
 * `@kibborg/tui` — the terminal surface's renderer.
 *
 * The package is a library of pure presentation functions plus one stateful
 * facade ({@link createTurnRenderer}); it owns no cordis service, reads no
 * configuration, and performs no I/O of its own, so the caller decides where
 * text goes and whether color is available.
 * @module @kibborg/tui
 */

export type { Palette, TokenName, TokenStyle } from './tokens.ts'
export { agentToken, fallbackPalette, paletteFor, paletteForTheme, plainPalette, trueColorPalette } from './tokens.ts'

export { displayWidth, padLeft, padRight, takeHeadWidth, takeTailWidth } from './width.ts'

export type { FooterInput, StatusInput } from './status.ts'
export { contextBar, formatTokens, statusLine, thinkingToken, turnFooter } from './status.ts'

export type { ComposerInput, ComposerView } from './composer.ts'
export { COMPOSER_PREFIX, composerCursorColumn, composerLines, composerView, makeDash } from './composer.ts'

export type { RenderSink, ToolCallDetail, ToolResultDetail, TurnRenderer, TurnRendererOptions } from './render.ts'
export { createTurnRenderer } from './render.ts'

export type { KeyEvent, KeyParseResult } from './input.ts'
export { isInsertion, parseKeys } from './input.ts'

export { HISTORY_LIMIT, appendHistory, historyPath, loadHistory, saveHistory } from './history.ts'

export type { ZoneState } from './zone.ts'
export { cursorColumn, cursorTo, cursorUp, ERASE_DOWN, zoneHeight, zoneLines } from './zone.ts'

export type { SessionRow, SessionTableOptions } from './session-table.ts'
export { relativeAge, sessionTable } from './session-table.ts'

export type { CompletionResult, CompletionSources } from './completion.ts'
export { COMMAND_PREFIX, completeDraft, completionHint, FILE_PREFIX, SESSION_PREFIX } from './completion.ts'

export type { PanelTab, PanelView } from './panel.ts'
export { columns, moveSelection, moveTab, PANEL_MAX_ROWS, PANEL_MAX_WIDTH, panelBodyLines, panelLines } from './panel.ts'

export type { Cell, CellBuffer } from './framebuffer.ts'
export { copyBuffer, createBuffer, diffBuffers, EMPTY_CELL } from './framebuffer.ts'

export type { TerminalCaps, Screen, ScreenOptions } from './screen.ts'
export { detectCaps, createScreen } from './screen.ts'

export type { MouseAction, MouseEvent } from './mouse.ts'
export { decodeSgrMouse, decodeX10Mouse, wheelDelta } from './mouse.ts'

export type { AgentBadge, LogEntry, LogKind, LogModel, RenderOptions, Span, StyledLine, ToolStatus, Transcript } from './log.ts'
export {
  clampScroll,
  createLog,
  lineWidth,
  plainText,
  renderEntries,
  renderTranscript,
  scrollIndicator,
  transcriptWindow,
  visibleLines,
  wrapText,
} from './log.ts'

export type { LogSource, LogViewResult, LogViewState } from './logview.ts'
export { drawLogView, firstVisibleText, paintStyledLine } from './logview.ts'

export type { HeaderState } from './header.ts'
export { drawHeader, HEADER_HEIGHT, renderHeader } from './header.ts'

export type { WelcomeRecent, WelcomeState } from './welcome.ts'
export { overflowWidth, renderWelcome } from './welcome.ts'

export type {
  DialogView,
  MenuItem,
  MenuState,
  MenuView,
  PermissionInput,
  QuestionInput,
  ResumeRow,
} from './menus.ts'
export {
  commandMenuItems,
  filterMenu,
  fuzzyMatch,
  modalDialog,
  permissionDialog,
  planReviewDialog,
  questionDialog,
  renderMenu,
  resumeDialog,
} from './menus.ts'

export type { LogRendererOptions } from './log-renderer.ts'
export { createLogRenderer } from './log-renderer.ts'

export type { App, AppOptions, AppStatus } from './app.ts'
export { createApp } from './app.ts'

export type { BorderKind, Rect } from './box.ts'
export { drawBox, dashedLine, boxWidths } from './box.ts'

export type { Density } from './layout.ts'
export { densityFor, computeLayout } from './layout.ts'

export { spinnerFrame, bandWave, progressBar, elapsedLabel, createTicker } from './anim.ts'
