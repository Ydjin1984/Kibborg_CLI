/**
 * Argument rendering for the transcript.
 *
 * A tool call arrives as raw JSON, where a file body or a script is one escaped
 * line. Printing that verbatim is correct and unreadable, so the values that carry
 * newlines are written out as indented blocks while the argument structure stays
 * visible.
 *
 * The same arguments also yield the one line a reader needs: what the agent is
 * doing, in words, with the JSON kept for the expandable detail layer.
 * @module kibborg/arguments
 */

/** Tools that read a file, whatever they call the path field. */
const READ_TOOLS: readonly string[] = ['read', 'read_file', 'readfile', 'cat', 'view']
/** Tools that write a file. */
const WRITE_TOOLS: readonly string[] = ['write', 'create', 'write_file']
/** Tools that change a file in place. */
const EDIT_TOOLS: readonly string[] = ['edit', 'str_replace', 'str_replace_editor', 'multi_edit', 'apply_patch']
/** Tools that run a command. */
const SHELL_TOOLS: readonly string[] = ['bash', 'pwsh', 'powershell', 'shell', 'exec', 'run_command', 'run']
/** Tools that look for text. */
const SEARCH_TOOLS: readonly string[] = ['grep', 'rg', 'search', 'find_in_files']
/** Tools that look for files. */
const GLOB_TOOLS: readonly string[] = ['glob', 'find', 'list_files', 'ls']

/** One argument value, read without trusting its type. */
function valueOf(parsed: Record<string, unknown>, ...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim() !== '') return value.replace(/\s+/gu, ' ').trim()
  }
  return undefined
}

/** Shorten one argument value so a title stays on one line. */
function short(value: string, limit = 72): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

/**
 * Say what a tool call does, in one line.
 *
 * The transcript shows this instead of the argument JSON: a reader wants to know
 * that the agent is running the tests, not the shape of the request. Unknown tools
 * keep their own name, so a plugin's tool is never described as something else.
 * @param name - the tool's name as the host reports it.
 * @param raw - the argument text exactly as the model produced it.
 * @returns the sentence to show, with the argument detail appended when it helps.
 */
export function toolTitle(name: string, raw: string | undefined): string {
  const trimmed = (raw ?? '').trim()
  let parsed: Record<string, unknown> = {}
  if (trimmed.startsWith('{')) {
    try {
      const value = JSON.parse(trimmed) as unknown
      if (typeof value === 'object' && value !== null) parsed = value as Record<string, unknown>
    } catch {
      // A malformed argument is not a reason to lose the title: the fallback below
      // names the tool, and the raw text stays in the detail layer.
    }
  }
  const path = valueOf(parsed, 'file_path', 'path', 'filepath', 'file', 'target')
  if (READ_TOOLS.includes(name)) return path === undefined ? 'Читает файл' : `Читает ${short(path)}`
  if (WRITE_TOOLS.includes(name)) return path === undefined ? 'Создаёт файл' : `Создаёт ${short(path)}`
  if (EDIT_TOOLS.includes(name)) return path === undefined ? 'Правит файл' : `Правит ${short(path)}`
  if (SHELL_TOOLS.includes(name)) {
    const command = valueOf(parsed, 'command', 'cmd', 'script', 'command_line')
    return command === undefined ? 'Запускает команду' : `Запускает ${short(command, 64)}`
  }
  if (SEARCH_TOOLS.includes(name)) {
    const pattern = valueOf(parsed, 'pattern', 'query', 'regex', 'search')
    return pattern === undefined ? 'Ищет по содержимому' : `Ищет ${short(pattern, 48)}`
  }
  if (GLOB_TOOLS.includes(name)) {
    const pattern = valueOf(parsed, 'pattern', 'glob', 'path', 'query')
    return pattern === undefined ? 'Ищет файлы' : `Ищет файлы ${short(pattern, 48)}`
  }
  if (name === 'executor' || name === 'subagent' || name === 'task' || name === 'delegate') {
    const task = valueOf(parsed, 'description', 'prompt', 'task')
    return task === undefined ? 'Делегирует задачу' : `Делегирует: ${short(task, 64)}`
  }
  if (name === 'create_goal' || name === 'goal') {
    const objective = valueOf(parsed, 'objective', 'goal')
    return objective === undefined ? 'Ставит цель' : `Ставит цель: ${short(objective, 64)}`
  }
  if (name === 'skill') {
    const skill = valueOf(parsed, 'name', 'skill')
    return skill === undefined ? 'Загружает навык' : `Загружает навык ${skill}`
  }
  if (name === 'web_search' || name === 'web_fetch') {
    const query = valueOf(parsed, 'query', 'url', 'prompt')
    return query === undefined ? 'Ищет в интернете' : `Ищет в интернете: ${short(query, 56)}`
  }
  if (name === 'todo_write' || name === 'todo') return 'Обновляет список задач'
  if (name === 'job_kill' || name === 'job_output' || name === 'job_list') return 'Работает с фоновой задачей'
  const summary = valueOf(parsed, 'description', 'query', 'prompt')
  return summary === undefined ? name : `${name}: ${short(summary, 56)}`
}

/**
 * Pretty-print an argument JSON string.
 * @param raw - the argument text exactly as the model produced it.
 * @returns the pretty-printed document, or the trimmed original when it is not JSON.
 */
export function prettyArguments(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  try {
    return expandMultilineValues(JSON.stringify(JSON.parse(trimmed), undefined, 2))
  } catch {
    return trimmed
  }
}

/**
 * Expand multi-line string values into real lines.
 * @param json - pretty-printed argument JSON.
 * @returns the same document with multi-line values written out.
 */
export function expandMultilineValues(json: string): string {
  const out: string[] = []
  for (const line of json.split('\n')) {
    const match = /^(\s*)"([^"]*)":\s*"((?:[^"\\]|\\.)*)"(,?)$/u.exec(line)
    if (match === null) {
      out.push(line)
      continue
    }
    const indent = match[1] ?? ''
    const key = match[2] ?? ''
    const rawValue = match[3] ?? ''
    const trailing = match[4] ?? ''
    let value: string
    try {
      value = JSON.parse(`"${rawValue}"`) as string
    } catch {
      out.push(line)
      continue
    }
    if (!value.includes('\n')) {
      out.push(line)
      continue
    }
    const inner = `${indent}  `
    const body = value.split('\n')
    out.push(`${indent}"${key}":`)
    for (const [index, part] of body.entries()) {
      out.push(`${inner}${part}${index === body.length - 1 ? trailing : ''}`)
    }
  }
  return out.join('\n')
}
