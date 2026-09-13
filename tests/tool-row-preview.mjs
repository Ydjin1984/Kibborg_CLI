/**
 * Печать строк инструментов на разной ширине.
 *
 * Обрезка строки инструмента считается по колонкам кадра, а не по числу символов,
 * поэтому её вид зависит от терминала. Скрипт печатает одни и те же записи на
 * широком и узком экране: `node tests/tool-row-preview.mjs`.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tui = pathToFileURL(join(here, '..', 'packages', 'tui', 'lib', 'index.js')).href
const { createLog, plainText, renderEntries } = await import(tui)

const path = `C:/Users/lex66/AppData/Roaming/tabby/plugins/node_modules/${'tabby-ai-agent/'.repeat(8)}dist/index.js`
const command = `cd D:\\Deepseec_DaVinchi; Get-ChildItem -Recurse -File -Include ${'*.ts,*.js,*.json,'.repeat(12)} -Depth 6`

const log = createLog()
log.append({ kind: 'tool', text: 'read', name: 'read', status: 'done', title: `Читает ${path}`, durationMs: 1240 })
log.append({ kind: 'tool', text: 'edit', name: 'edit', status: 'done', title: `Правит ${path}`, added: 12, removed: 3 })
log.append({ kind: 'tool', text: 'pwsh', name: 'pwsh', status: 'done', title: `Запускает ${command}` })

for (const width of [114, 60]) {
  console.log(`--- ${String(width)} колонок ---`)
  for (const line of renderEntries(log.entries, width).map(plainText)) console.log(line)
}
