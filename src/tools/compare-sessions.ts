import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { createInterface } from 'readline'
import { ToolDefinition, ToolHandler, successResponse, errorResponse, SessionMessage } from '../types.js'

const CLAUDE_HOME = process.env.CLAUDE_HOME || `${process.env.HOME}/.claude`

export const compareSessionsDefinition: ToolDefinition = {
  name: 'compare_sessions',
  description: 'Compare two sessions side by side - duration, tools used, message counts, and patterns',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId1: {
        type: 'string',
        description: 'First session ID to compare',
      },
      sessionId2: {
        type: 'string',
        description: 'Second session ID to compare',
      },
      includeFiles: {
        type: 'boolean',
        description: 'Include filesAccessed arrays in response (default: false)',
      },
    },
    required: ['sessionId1', 'sessionId2'],
  },
}

interface SessionStats {
  sessionId: string
  project: string
  summary?: string
  gitBranch?: string
  startedAt: string
  endedAt: string
  durationMs: number
  durationFormatted: string
  messageCount: { user: number; assistant: number; total: number }
  toolsUsed: Record<string, number>
  uniqueToolCount: number
  totalToolCalls: number
  agentSpawns: Array<{ type: string; description: string }>
  filesAccessed?: string[]
}

interface SessionComparison {
  session1: SessionStats
  session2: SessionStats
  comparison: {
    longerSession: string
    durationDifference: string
    moreMessages: string
    messageDifference: number
    moreToolCalls: string
    toolCallDifference: number
    sharedTools: string[]
    uniqueToSession1: string[]
    uniqueToSession2: string[]
    sharedFiles: string[]
  }
}

function extractToolCalls(content: string | any[]): Array<{ name: string; input: any }> {
  if (!Array.isArray(content)) return []

  return content
    .filter(item => item.type === 'tool_use')
    .map(item => ({ name: item.name, input: item.input || {} }))
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

async function getSessionStats(sessionId: string, includeFiles: boolean): Promise<SessionStats | null> {
  const projectsDir = `${CLAUDE_HOME}/projects`
  let projectDirs: string[]

  try {
    projectDirs = await readdir(projectsDir)
  } catch (error) {
    return null
  }

  for (const projectDir of projectDirs) {
    const sessionFilePath = `${projectsDir}/${projectDir}/${sessionId}.jsonl`

    try {
      await stat(sessionFilePath)
    } catch (error) {
      continue
    }

    const projectPath = projectDir.replace(/^-/, '').replace(/-/g, '/')
    const fileStream = createReadStream(sessionFilePath, { encoding: 'utf-8' })
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    })

    let summary: string | undefined
    let gitBranch: string | undefined
    let startedAt: string | undefined
    let endedAt: string | undefined
    let userMessages = 0
    let assistantMessages = 0
    const toolsUsed: Record<string, number> = {}
    const agentSpawns: Array<{ type: string; description: string }> = []
    const filesAccessed = new Set<string>()

    for await (const line of rl) {
      if (!line.trim()) continue

      try {
        const msg: SessionMessage = JSON.parse(line)

        if (msg.type === 'summary' && msg.summary) {
          summary = msg.summary
        }

        if (msg.gitBranch && !gitBranch) {
          gitBranch = msg.gitBranch
        }

        if (msg.timestamp) {
          if (!startedAt) startedAt = msg.timestamp
          endedAt = msg.timestamp
        }

        if (msg.type === 'user') {
          userMessages++
        }

        if (msg.type === 'assistant' && msg.message) {
          assistantMessages++
          const toolCalls = extractToolCalls(msg.message.content)

          for (const tool of toolCalls) {
            toolsUsed[tool.name] = (toolsUsed[tool.name] || 0) + 1

            if (tool.name === 'Task') {
              agentSpawns.push({
                type: tool.input?.subagent_type || 'unknown',
                description: tool.input?.description || '',
              })
            }

            const filePath = tool.input?.file_path || tool.input?.path
            if (filePath && ['Read', 'Write', 'Edit'].includes(tool.name)) {
              filesAccessed.add(filePath)
            }
          }
        }
      } catch (error) {
        continue
      }
    }

    if (!startedAt) return null

    const durationMs = endedAt
      ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
      : 0

    const stats: SessionStats = {
      sessionId,
      project: projectPath,
      summary,
      gitBranch,
      startedAt,
      endedAt: endedAt || startedAt,
      durationMs,
      durationFormatted: formatDuration(durationMs),
      messageCount: {
        user: userMessages,
        assistant: assistantMessages,
        total: userMessages + assistantMessages,
      },
      toolsUsed,
      uniqueToolCount: Object.keys(toolsUsed).length,
      totalToolCalls: Object.values(toolsUsed).reduce((a, b) => a + b, 0),
      agentSpawns,
    }

    if (includeFiles) {
      stats.filesAccessed = Array.from(filesAccessed)
    }

    return stats
  }

  return null
}

export const compareSessionsHandler: ToolHandler = async (args) => {
  try {
    const { sessionId1, sessionId2, includeFiles = false } = args

    if (!sessionId1 || typeof sessionId1 !== 'string') {
      return errorResponse('sessionId1 parameter is required and must be a string')
    }

    if (!sessionId2 || typeof sessionId2 !== 'string') {
      return errorResponse('sessionId2 parameter is required and must be a string')
    }

    const [stats1, stats2] = await Promise.all([
      getSessionStats(sessionId1, includeFiles),
      getSessionStats(sessionId2, includeFiles),
    ])

    if (!stats1) {
      return errorResponse(`Session ${sessionId1} not found`)
    }

    if (!stats2) {
      return errorResponse(`Session ${sessionId2} not found`)
    }

    const tools1 = new Set(Object.keys(stats1.toolsUsed))
    const tools2 = new Set(Object.keys(stats2.toolsUsed))

    const sharedTools = [...tools1].filter(t => tools2.has(t))
    const uniqueToSession1 = [...tools1].filter(t => !tools2.has(t))
    const uniqueToSession2 = [...tools2].filter(t => !tools1.has(t))

    const durationDiffMs = Math.abs(stats1.durationMs - stats2.durationMs)
    const messageDiff = Math.abs(stats1.messageCount.total - stats2.messageCount.total)
    const toolCallDiff = Math.abs(stats1.totalToolCalls - stats2.totalToolCalls)

    const comparison: SessionComparison['comparison'] = {
      longerSession: stats1.durationMs > stats2.durationMs ? sessionId1 : sessionId2,
      durationDifference: formatDuration(durationDiffMs),
      moreMessages: stats1.messageCount.total > stats2.messageCount.total ? sessionId1 : sessionId2,
      messageDifference: messageDiff,
      moreToolCalls: stats1.totalToolCalls > stats2.totalToolCalls ? sessionId1 : sessionId2,
      toolCallDifference: toolCallDiff,
      sharedTools,
      uniqueToSession1,
      uniqueToSession2,
      sharedFiles: [],
    }

    if (includeFiles && stats1.filesAccessed && stats2.filesAccessed) {
      const files1 = new Set(stats1.filesAccessed)
      const files2 = new Set(stats2.filesAccessed)
      comparison.sharedFiles = [...files1].filter(f => files2.has(f))
    }

    const result: SessionComparison = {
      session1: stats1,
      session2: stats2,
      comparison,
    }

    return successResponse(result)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
