/**
 * The question card.
 *
 * The card is the only place a model can ask the user to choose, so its shape is
 * pinned: numbered answers with their explanations, a row for a typed answer, and
 * the keys that work. A card that loses the number or the typed-answer row leaves
 * the user unable to answer at all.
 */
import { describe, expect, it } from 'vitest'
import { questionDialog } from '../src/menus.ts'

/** Render a card's rows as plain text. */
function rows(input: Parameters<typeof questionDialog>[0]): string[] {
  return questionDialog(input).lines.map(line => line.spans.map(span => span.text).join(''))
}

describe('questionDialog', () => {
  it('numbers every answer and shows its explanation', () => {
    const lines = rows({
      question: 'Какой вариант?',
      index: 1,
      total: 1,
      options: [
        { label: 'Быстрый', description: 'сразу к результату' },
        { label: 'Аккуратный', description: 'по шагам' },
      ],
      selected: 1,
    })
    expect(lines[0]).toContain('Какой вариант?')
    expect(lines.join('\n')).toContain('1 (○) Быстрый')
    expect(lines.join('\n')).toContain('2 (●) Аккуратный')
    expect(lines.join('\n')).toContain('сразу к результату')
    expect(lines.join('\n')).toContain('по шагам')
  })

  it('offers a row for a typed answer and says how to use it', () => {
    const text = rows({
      question: 'Что делаем?',
      index: 2,
      total: 3,
      options: [{ label: 'Продолжить' }],
      selected: 1,
    }).join('\n')
    expect(text).toContain('z (◉) Свой ответ')
    expect(text).toContain('наберите текст и нажмите Enter')
    expect(text).toContain('[1-9] выбрать сразу')
    expect(text).toContain('[esc] отменить')
  })

  it('marks chosen rows of a multi-select question', () => {
    const text = rows({
      question: 'Что включить?',
      index: 1,
      total: 1,
      options: [{ label: 'Тесты' }, { label: 'Документацию' }],
      selected: 0,
      multi: true,
      chosen: [1],
    }).join('\n')
    expect(text).toContain('1 (○) Тесты')
    expect(text).toContain('2 (◉) Документацию')
    expect(text).toContain('[space] отметить')
  })
})
