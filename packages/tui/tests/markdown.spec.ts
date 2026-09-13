/**
 * Markdown rendering of an answer.
 *
 * The answer is the artifact a user reads, so its shape has to survive: a table
 * stays a table, a list stays a list, code stays code, and a link or path stays
 * clickable. These tests pin that shape, not the exact colors.
 */
import { describe, expect, it } from 'vitest'
import { markdownPlainText, renderMarkdown } from '../src/markdown.ts'

/** Render an answer and return its visible text, one row per line. */
function rows(text: string, width = 60): string[] {
  return renderMarkdown(text, { width, hyperlinks: true }).map(line => markdownPlainText(line))
}

describe('renderMarkdown', () => {
  it('keeps a table aligned with a rule under its header', () => {
    const text = ['| ID | Статус | Задача |', '|---|---|---|', '| K8.1 | done | Сборка |', '| K8.2 | done | Установка |'].join('\n')
    const lines = rows(text)
    expect(lines[0]).toContain('ID')
    expect(lines[0]).toContain('Статус')
    expect(lines[1]).toContain('┼')
    expect(lines[2]).toContain('K8.1')
    expect(lines[3]).toContain('Установка')
    // Every row uses the same column geometry, so the table reads as columns.
    const columnOfStatus = (line: string): number => line.indexOf('│')
    expect(columnOfStatus(lines[0] ?? '')).toBe(columnOfStatus(lines[2] ?? ''))
  })

  it('sets code apart from prose and keeps it verbatim', () => {
    const lines = rows(['```ts', 'const a = 1', 'return a', '```', 'после блока'].join('\n'))
    expect(lines.some(line => line.includes('│ const a = 1'))).toBe(true)
    expect(lines.some(line => line.includes('│ return a'))).toBe(true)
    expect(lines.some(line => line.includes('после блока'))).toBe(true)
    // The fence markers themselves never reach the screen.
    expect(lines.some(line => line.includes('```'))).toBe(false)
  })

  it('numbers and bullets list items, marking each level', () => {
    const lines = rows(['- один', '  - вложенный', '1. первый', '2. второй'].join('\n'))
    expect(lines[0]).toContain('• один')
    // A nested item carries its own marker, so the two levels are distinguishable
    // without counting leading spaces.
    expect(lines[1]).toContain('◦ вложенный')
    expect(lines[2]).toContain('1. первый')
    expect(lines[3]).toContain('2. второй')
  })

  it('sets every block off from the prose around it', () => {
    const lines = rows(['Проза.', '# Заголовок', 'Ещё проза.', '```sh', 'go test ./...', '```', '- пункт'].join('\n'))
    // Each block starts after a blank row, so nothing runs together.
    expect(lines[1]).toBe('')
    expect(lines.join('\n')).toContain('┌─ sh')
    expect(lines.join('\n')).toContain('└─')
    const beforeBullet = lines[lines.findIndex(line => line.includes('• пункт')) - 1]
    expect(beforeBullet).toBe('')
  })

  it('marks a link as a hyperlink target instead of inlining escape codes', () => {
    const rendered = renderMarkdown('см. [документацию](https://example.com/docs) и всё', { width: 60, hyperlinks: true })
    const link = rendered.flatMap(line => line.spans).find(span => span.url !== undefined)
    expect(link?.url).toBe('https://example.com/docs')
    expect(link?.text).toBe('документацию')
    expect(link?.underline).toBe(true)
    // The target is metadata: the visible text stays clean for width maths.
    expect(rendered.map(line => markdownPlainText(line)).join('')).not.toContain('\u001B')
  })

  it('keeps a bold instruction bold and a heading bold', () => {
    const rendered = renderMarkdown('# Итог\n\n**важно** сделать', { width: 60 })
    const heading = rendered[0]?.spans.find(span => span.text === 'Итог')
    expect(heading?.bold).toBe(true)
    const bold = rendered.flatMap(line => line.spans).find(span => span.text === 'важно')
    expect(bold?.bold).toBe(true)
  })

  it('renders a bare path as an openable target', () => {
    const rendered = renderMarkdown('файл D:\\Deepseec_DaVinchi\\Kibborg_CLI\\README.md обновлён', { width: 80, hyperlinks: true })
    const target = rendered.flatMap(line => line.spans).find(span => span.url !== undefined)
    expect(target?.url).toContain('README.md')
  })

  it('wraps a long paragraph instead of cutting it', () => {
    const text = 'слово '.repeat(40).trim()
    const lines = rows(text, 40)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(40)
    expect(lines.join(' ')).toContain('слово слово')
  })
})
