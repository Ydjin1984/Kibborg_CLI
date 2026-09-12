# @kibborg/tui

English | [中文](README.zh.md)

The terminal surface's renderer. It is a library of pure presentation functions plus one stateful facade, `createTurnRenderer`; the package owns no cordis service, reads no configuration, and performs no I/O of its own, so the caller decides where text goes and whether color is available.

`Kibborg_CLI/UI.md` is the design spec this package implements, and `Kibborg_CLI/demo/kibborg-demo.bat` is its frozen visual golden: a rendering change is verified against that spec, not invented here.

## What the package provides

| Module | Responsibility |
|---|---|
| `src/tokens.ts` | The theme's color vocabulary and the three palettes: plain (no color), true color (24-bit), and the 16-color fallback. `paletteFor()` picks by terminal capability and `NO_COLOR`/`TERM=dumb`. |
| `src/width.ts` | `displayWidth` (CSI sequences, combining marks, wide CJK and emoji, surrogate pairs, tab) and the padding helpers built on it. |
| `src/status.ts` | `statusLine` (composition by terminal width), `contextBar`, `turnFooter`, and `formatTokens`. |
| `src/composer.ts` | The input area: `makeDash`, `composerView`, `composerCursorColumn`, `composerLines`. |
| `src/render.ts` | `createTurnRenderer`: user message, tool calls and failures, streamed assistant text, notices, errors, the turn footer, and the status line. |

The renderer exposes no method for model reasoning: hidden reasoning is not a user-facing artifact, so a reasoning chunk has nowhere to go (`PLAN.md` R10).

## Example

```ts
import { createTurnRenderer, paletteFor } from '@kibborg/tui'

const renderer = createTurnRenderer({
  palette: paletteFor(),
  sink: { write: chunk => process.stdout.write(chunk) },
  cols: process.stdout.columns ?? 88,
})

renderer.user('проанализируй проект')
renderer.toolCall('read', 'README.md')
renderer.text('Ответ модели')
renderer.closeAnswer()
renderer.finish({ tokens: 12400, costUsd: 0.07, seconds: 18.4 })
renderer.status({ model: 'DeepSeek V4 Flash', contextPercent: 18, mode: 'Agent' })
```

## Model Experience

None, as the package renders strings from caller-supplied values and registers no prompt, tool, or session event. It never sees a model request and never influences one.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The composer is rendered, not driven.** Input handling (raw mode, key events, history, completion) belongs to the interactive phase; this package only lays the zone out.
- **Fullscreen composition is not implemented.** Panel layout, alt-screen handling, and resize repainting arrive with the fullscreen phase; today the renderer appends to the scrollback.
- **No terminal-query fallback for cell size.** The width table is a static range table, not a query of the terminal's own width data.
