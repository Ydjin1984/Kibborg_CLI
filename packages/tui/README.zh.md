# @kibborg/tui

[English](README.md) | 中文

终端表面的渲染器。它是一个纯呈现函数库，外加一个有状态的门面 `createTurnRenderer`；该包不拥有任何 cordis 服务，不读取任何配置，也不执行任何 I/O，因此调用方决定文本输出到哪里以及是否支持颜色。

`Kibborg_CLI/UI.md` 是该包实现的设计规范，`Kibborg_CLI/demo/kibborg-demo.bat` 是其冻结的视觉黄金标准：渲染更改会根据该规范进行验证，而不是自行发明。

## 该包提供的功能

| 模块 | 职责 |
|---|---|
| `src/tokens.ts` | 主题的颜色词汇表和三个调色板：普通（无颜色）、真彩色（24位）和 16 色回退。`paletteFor()` 根据终端功能和 `NO_COLOR`/`TERM=dumb` 进行选择。 |
| `src/width.ts` | `displayWidth`（CSI 序列、组合标记、宽 CJK 和 emoji、代理对、制表符）及其构建的填充助手。 |
| `src/status.ts` | `statusLine`（按终端宽度组合）、`contextBar`、`turnFooter` 和 `formatTokens`。 |
| `src/composer.ts` | 输入区域：`makeDash`、`composerView`、`composerCursorColumn`、`composerLines`。 |
| `src/render.ts` | `createTurnRenderer`：用户消息、工具调用和失败、流式助手文本、通知、错误、回合页脚和状态行。 |

该渲染器不暴露用于模型推理的方法：隐藏的推理不是用户可访问的产物，因此推理块没有地方可去（`PLAN.md` R10）。

## 示例

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

## 模型体验

无，因为该包渲染调用方提供的字符串值，不注册任何提示词、工具或会话事件。它从不看到模型请求，也从不影响模型请求。

#### KV 缓存效果

无；该包既不组装也不发送提供方请求。

## 已知限制和延期工作

- **composer 是被渲染的，而非被驱动的。** 输入处理（原始模式、按键事件、历史、补全）属于交互阶段；该包只布局区域。
- **全屏组合未实现。** 面板布局、备选屏幕处理和调整大小重绘与全屏阶段一同到来；今天渲染器会追加到滚动缓冲区。
- **没有终端查询回退获取单元格大小。** 宽度表是一个静态范围表，而不是查询终端自己的宽度数据。