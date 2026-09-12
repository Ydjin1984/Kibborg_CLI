import { describe, expect, it } from 'vitest'
import type { ConfigurableProviderView, ManagedSkillSummaryView, McpServerView, SkillEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import { formatMcpServers, formatModelRegistry, formatSkills } from '../src/registries.ts'

const provider: ConfigurableProviderView = {
  provider: 'deepseek-official',
  displayName: 'DeepSeek',
  settingsNs: 'llm',
  settingsPath: [],
  active: true,
}

describe('formatModelRegistry', () => {
  it('prints each provider with its live model count', () => {
    const lines = formatModelRegistry({
      providers: [provider, { ...provider, provider: 'kibborg', displayName: 'Kibborg', active: false }],
      groups: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: ['low', 'high'] } }],
      }],
      failures: [],
    }).join('')

    expect(lines).toContain('deepseek-official')
    expect(lines).toContain('active, 1 model(s)')
    expect(lines).toContain('dormant')
    expect(lines).toContain('deepseek-chat')
    expect(lines).toContain('[low, high]')
  })

  it('reports an empty directory instead of an empty table', () => {
    expect(formatModelRegistry({ providers: [], groups: [], failures: [] }).join('')).toContain('(none)')
  })

  it('shows the per-provider lookup failure text', () => {
    const lines = formatModelRegistry({
      providers: [provider],
      groups: [],
      failures: [{ id: 'kibborg', name: 'Kibborg', message: 'connect ECONNREFUSED' }],
    }).join('')

    expect(lines).toContain('kibborg: connect ECONNREFUSED')
  })
})

describe('formatMcpServers', () => {
  const server: McpServerView = {
    name: 'playwright',
    source: 'user',
    kind: 'stdio',
    enabled: true,
    command: 'npx @playwright/mcp',
    state: 'connected',
    toolCount: 12,
  }

  it('prints the target and tool count of a connected server', () => {
    const lines = formatMcpServers([server]).join('')

    expect(lines).toContain('playwright')
    expect(lines).toContain('stdio')
    expect(lines).toContain('connected')
    expect(lines).toContain('npx @playwright/mcp')
  })

  it('marks a disabled server and shows the failure text of a broken one', () => {
    const lines = formatMcpServers([
      { ...server, enabled: false },
      { ...server, name: 'broken', kind: undefined, state: 'error', error: 'command not found', toolCount: 0 },
    ]).join('')

    expect(lines).toContain('(disabled)')
    expect(lines).toContain('error: command not found')
  })

  it('says so when nothing is declared', () => {
    expect(formatMcpServers([]).join('')).toContain('no MCP servers declared')
  })
})

describe('formatSkills', () => {
  const skill: SkillEntry = { name: 'tdd', description: 'Test-driven development', modelInvocable: true }
  const managed: ManagedSkillSummaryView = {
    name: 'tdd',
    description: 'Test-driven development',
    invocation: { modelInvocable: true, userInvocable: true },
    status: 'enabled',
  }

  it('joins the managed state onto the user-invocable row', () => {
    const lines = formatSkills({ user: [skill], managed: [managed] }).join('')

    expect(lines).toContain('tdd')
    expect(lines).toContain('enabled')
    expect(lines).toContain('Test-driven development')
  })

  it('marks a skill the manager does not know as unmanaged', () => {
    expect(formatSkills({ user: [skill], managed: [] }).join('')).toContain('unmanaged')
  })

  it('says so when the project offers none', () => {
    expect(formatSkills({ user: [], managed: [] }).join('')).toContain('no skills in this project')
  })
})
