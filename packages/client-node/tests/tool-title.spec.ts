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
    // The bound is the title budget; the surface shortens it again to the columns it
    // has, so a wide terminal can show more of the same command.
    expect(title.length).toBeLessThanOrEqual('Запускает '.length + 160)
    expect(title.endsWith('…')).toBe(true)
  })

  it('keeps the file name when a long path has to be cut', () => {
    // Long enough that the surface has to cut it, which is where the file name used
    // to disappear.
    const path = `C:/Users/lex66/AppData/Roaming/tabby/plugins/node_modules/${'tabby-ai-agent/'.repeat(8)}dist/index.js`
    const read = toolTitle('read', JSON.stringify({ file_path: path }))
    expect(read).toContain('…')
    expect(read.endsWith('index.js')).toBe(true)
    expect(read.startsWith('Читает C:/Users/lex66/')).toBe(true)

    // A path that fits is left alone: the surface shortens to the columns it has.
    const config = toolTitle('read', JSON.stringify({ file_path: 'C:/Users/lex66/AppData/Roaming/tabby/config.yaml' }))
    expect(config).toBe('Читает C:/Users/lex66/AppData/Roaming/tabby/config.yaml')

    // A quotation mark and a trailing separator belong to the syntax, not the name.
    const quoted = toolTitle('pwsh', JSON.stringify({ command: `Get-ChildItem -Path "C:\\Users\\lex66\\AppData\\Roaming\\tabby\\plugins\\node_modules\\${'deep\\'.repeat(20)}package.json"` }))
    expect(quoted.endsWith('package.json')).toBe(true)
    expect(quoted).toContain('…')
  })

  it('cuts a long command from its end, where the arguments are', () => {
    const command = `cd D:\\Deepseec_DaVinchi; Get-ChildItem -Recurse -File -Include ${'*.ts,*.js,*.json,'.repeat(12)} -Depth 6`
    const title = toolTitle('pwsh', JSON.stringify({ command }))
    // A command has no file name at the end and its start is what names it, so the
    // tail is dropped instead.
    expect(title.startsWith('Запускает cd D:\\Deepseec_DaVinchi; Get-ChildItem')).toBe(true)
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThan(180)
  })
})
