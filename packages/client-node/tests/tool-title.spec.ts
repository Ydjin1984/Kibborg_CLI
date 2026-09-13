import { describe, expect, it } from 'vitest'
import { toolTitle } from '../src/arguments.ts'

describe('toolTitle', () => {
  it('says what each tool does instead of repeating its name', () => {
    expect(toolTitle('bash', '{"command":"go test ./..."}')).toBe('Запускает go test ./...')
    expect(toolTitle('read', '{"file_path":"engine-go/guard.go"}')).toBe('Читает engine-go/guard.go')
    expect(toolTitle('edit', '{"file_path":"a.ts","old_string":"x","new_string":"y"}')).toBe('Правит a.ts')
    expect(toolTitle('write', '{"path":"new.md","content":"..."}')).toBe('Создаёт new.md')
    expect(toolTitle('grep', '{"pattern":"run_command"}')).toBe('Ищет run_command')
    expect(toolTitle('glob', '{"pattern":"**/*.go"}')).toBe('Ищет файлы **/*.go')
    expect(toolTitle('executor', '{"description":"Разбор ревью","prompt":"..."}')).toBe('Делегирует: Разбор ревью')
    expect(toolTitle('create_goal', '{"objective":"Исправить замечания","max_goal_rounds":12}')).toBe('Ставит цель: Исправить замечания')
    expect(toolTitle('skill', '{"name":"orchestrator-head"}')).toBe('Загружает навык orchestrator-head')
    expect(toolTitle('web_search', '{"query":"go vet"}')).toBe('Ищет в интернете: go vet')
    expect(toolTitle('todo_write', '{}')).toBe('Обновляет список задач')
  })

  it('keeps an unknown tool named, and never invents an argument', () => {
    expect(toolTitle('my_plugin_tool', '{"x":1}')).toBe('my_plugin_tool')
    expect(toolTitle('read', 'не json')).toBe('Читает файл')
    expect(toolTitle('bash', '{"command":""}')).toBe('Запускает команду')
  })

  it('shortens a long argument so the row keeps its shape', () => {
    const long = 'x'.repeat(200)
    const title = toolTitle('bash', JSON.stringify({ command: long }))
    expect(title.length).toBeLessThan(90)
    expect(title.endsWith('…')).toBe(true)
  })
})
