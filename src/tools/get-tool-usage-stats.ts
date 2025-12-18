import { createReadStream } from 'fs'
import { readdir } from 'fs/promises'
import { createInterface } from 'readline'
import { ToolDefinition, ToolHandler, successResponse, errorResponse, SessionMessage } from '../types.js'

const CLAUDE_HOME = process.env.CLAUDE_HOME || `${process.env.HOME}/.claude`

export const getToolUsageStatsDefinition: ToolDefinition = {
  name: 'get_tool_usage_stats',
  description: 'Analyze tool usage patterns across sessions. Shows which tools are used most frequently.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Analyze a specific session (optional - if omitted, analyzes recent sessions)',
      },
      project: {
        type: 'string',
        description: 'Filter by project path (partial match)',
      },
      since: {
        type: 'string',
        description: 'ISO date - only analyze sessions after this date',
      },
      until: {
        type: 'string',
        description: 'ISO date - only analyze sessions before this date',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of sessions to analyze (default: 10)',
      },
    },
  },
}

interface ToolUsage {
  name: string
  count: number
}

interface ToolUsageStats {
  totalToolCalls: number
  uniqueTools: number
  sessionsAnalyzed: number
  toolUsage: ToolUsage[]
  topTools: Array<{ name: string; count: number; percentage: string }>
  toolsByCategory: Record<string, string[]>
}

const TOOL_CATEGORIES: Record<string, string[]> = {
  'File Operations': ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  'Execution': ['Bash', 'Task'],
  'Web': ['WebFetch', 'WebSearch'],
  'Planning': ['TodoWrite', 'EnterPlanMode', 'ExitPlanMode'],
  'User Interaction': ['AskUserQuestion'],
}

function extractToolNames(content: string | any[]): string[] {
  if (!Array.isArray(content)) return []

  return content
    .filter(item => item.type === 'tool_use' && item.name)
    .map(item => item.name)
}

function categorizeTools(tools: string[]): Record<string, string[]> {
  const categorized: Record<string, string[]> = {}

  for (const [category, categoryTools] of Object.entries(TOOL_CATEGORIES)) {
    const matching = tools.filter(t => categoryTools.includes(t))
    if (matching.length > 0) {
      categorized[category] = [...new Set(matching)]
    }
  }

  const allCategorized = Object.values(TOOL_CATEGORIES).flat()
  const uncategorized = tools.filter(t => !allCategorized.includes(t))
  if (uncategorized.length > 0) {
    categorized['MCP & Other'] = [...new Set(uncategorized)]
  }

  return categorized
}

export const getToolUsageStatsHandler: ToolHandler = async (args) => {
  try {
    const { sessionId, project, since, until, limit = 10 } = args

    const toolCounts: Record<string, { count: number; sessions: Set<string> }> = {}
    let sessionsAnalyzed = 0
    const sinceDate = since ? new Date(since) : new Date(0)
    const untilDate = until ? new Date(until) : new Date()

    const projectsDir = `${CLAUDE_HOME}/projects`
    let projectDirs: string[]

    try {
      projectDirs = await readdir(projectsDir)
    } catch (error) {
      return errorResponse('Could not read Claude projects directory')
    }

    for (const projectDir of projectDirs) {
      const projectPath = projectDir.replace(/^-/, '').replace(/-/g, '/')

      if (project && !projectPath.includes(project)) {
        continue
      }

      const sessionDir = `${projectsDir}/${projectDir}`
      let files: string[]

      try {
        files = await readdir(sessionDir)
      } catch (error) {
        continue
      }

      for (const file of files) {
        if (!file.endsWith('.jsonl') || file.startsWith('agent-')) {
          continue
        }

        const currentSessionId = file.replace('.jsonl', '')

        if (sessionId && currentSessionId !== sessionId) {
          continue
        }

        const sessionFilePath = `${sessionDir}/${file}`

        try {
          const fileStream = createReadStream(sessionFilePath, { encoding: 'utf-8' })
          const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity,
          })

          let sessionStartTime: Date | null = null
          let hasToolCalls = false

          for await (const line of rl) {
            if (!line.trim()) continue

            try {
              const msg: SessionMessage = JSON.parse(line)

              if (msg.timestamp && !sessionStartTime) {
                sessionStartTime = new Date(msg.timestamp)
              }

              if (msg.type === 'assistant' && msg.message) {
                const tools = extractToolNames(msg.message.content)

                for (const tool of tools) {
                  hasToolCalls = true
                  if (!toolCounts[tool]) {
                    toolCounts[tool] = { count: 0, sessions: new Set() }
                  }
                  toolCounts[tool].count++
                  toolCounts[tool].sessions.add(currentSessionId)
                }
              }
            } catch (error) {
              continue
            }
          }

          if (sessionStartTime) {
            if (sessionStartTime >= sinceDate && sessionStartTime <= untilDate) {
              if (hasToolCalls || sessionId) {
                sessionsAnalyzed++
              }
            }
          }
        } catch (error) {
          continue
        }

        if (!sessionId && sessionsAnalyzed >= limit) break
      }

      if (!sessionId && sessionsAnalyzed >= limit) break
    }

    const toolUsage: ToolUsage[] = Object.entries(toolCounts)
      .map(([name, data]) => ({
        name,
        count: data.count,
      }))
      .sort((a, b) => b.count - a.count)

    const totalToolCalls = toolUsage.reduce((sum, t) => sum + t.count, 0)

    const topTools = toolUsage.slice(0, 10).map(t => ({
      name: t.name,
      count: t.count,
      percentage: totalToolCalls > 0 ? ((t.count / totalToolCalls) * 100).toFixed(1) + '%' : '0%',
    }))

    const allToolNames = toolUsage.map(t => t.name)
    const toolsByCategory = categorizeTools(allToolNames)

    const stats: ToolUsageStats = {
      totalToolCalls,
      uniqueTools: toolUsage.length,
      sessionsAnalyzed,
      toolUsage: toolUsage.slice(0, 20),
      topTools,
      toolsByCategory,
    }

    return successResponse(stats)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
