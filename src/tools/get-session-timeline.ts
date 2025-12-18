import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { createInterface } from 'readline'
import { ToolDefinition, ToolHandler, successResponse, errorResponse, SessionMessage } from '../types.js'

const CLAUDE_HOME = process.env.CLAUDE_HOME || `${process.env.HOME}/.claude`

export const getSessionTimelineDefinition: ToolDefinition = {
  name: 'get_session_timeline',
  description: 'Get a detailed timeline of activity for a session including messages, tool calls, and agent spawns',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The session ID to analyze',
      },
      includeContent: {
        type: 'boolean',
        description: 'Include message content snippets (default: false)',
      },
      format: {
        type: 'string',
        enum: ['full', 'standard', 'minimal'],
        description: 'Response format: full (all details), standard (brief details), minimal (counts only) (default: standard)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of timeline events to return (default: 50, max: 200)',
      },
      offset: {
        type: 'number',
        description: 'Number of timeline events to skip for pagination (default: 0)',
      },
    },
    required: ['sessionId'],
  },
}

interface TimelineEvent {
  timestamp: string
  type: 'user_message' | 'assistant_message' | 'tool_call' | 'agent_spawn' | 'summary_update'
  details: string
  content?: string
}

interface SessionTimeline {
  sessionId: string
  project: string
  summary?: string
  gitBranch?: string
  duration: string
  startedAt: string
  endedAt: string
  eventCount: number
  messageCount: { user: number; assistant: number }
  toolCallCount: number
  agentSpawnCount: number
  data: TimelineEvent[] | Record<string, number>
  total: number
  hasMore: boolean
}

function extractToolCalls(content: string | any[]): Array<{ name: string; input: any }> {
  if (!Array.isArray(content)) return []

  return content
    .filter(item => item.type === 'tool_use')
    .map(item => ({ name: item.name, input: item.input || {} }))
}

function extractTextContent(content: string | any[]): string {
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    return content
      .filter(item => item.type === 'text' && item.text)
      .map(item => item.text)
      .join(' ')
      .substring(0, 150)
  }

  return ''
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

export const getSessionTimelineHandler: ToolHandler = async (args) => {
  try {
    const { sessionId, includeContent = false, format = 'standard', limit = 50, offset = 0 } = args

    if (!sessionId || typeof sessionId !== 'string') {
      return errorResponse('sessionId parameter is required and must be a string')
    }

    const validatedLimit = Math.min(Math.max(1, limit), 200)
    const validatedOffset = Math.max(0, offset)

    const projectsDir = `${CLAUDE_HOME}/projects`
    let projectDirs: string[]

    try {
      projectDirs = await readdir(projectsDir)
    } catch (error) {
      return errorResponse('Could not read Claude projects directory')
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

      const timeline: TimelineEvent[] = []
      let summary: string | undefined
      let gitBranch: string | undefined
      let startedAt: string | undefined
      let endedAt: string | undefined
      let userMessages = 0
      let assistantMessages = 0
      let toolCallCount = 0
      let agentSpawnCount = 0

      for await (const line of rl) {
        if (!line.trim()) continue

        try {
          const msg: SessionMessage = JSON.parse(line)

          if (msg.type === 'summary' && msg.summary) {
            summary = msg.summary
            continue
          }

          if (msg.gitBranch && !gitBranch) {
            gitBranch = msg.gitBranch
          }

          if (msg.timestamp) {
            if (!startedAt) startedAt = msg.timestamp
            endedAt = msg.timestamp
          }

          if (msg.type === 'user' && msg.message) {
            userMessages++
            const textContent = extractTextContent(msg.message.content)

            timeline.push({
              timestamp: msg.timestamp || '',
              type: 'user_message',
              details: `User message (${textContent.length} chars)`,
              content: includeContent ? textContent : undefined,
            })
          }

          if (msg.type === 'assistant' && msg.message) {
            assistantMessages++
            const toolCalls = extractToolCalls(msg.message.content)
            const textContent = extractTextContent(msg.message.content)

            if (textContent) {
              timeline.push({
                timestamp: msg.timestamp || '',
                type: 'assistant_message',
                details: `Assistant response (${textContent.length} chars)`,
                content: includeContent ? textContent : undefined,
              })
            }

            for (const tool of toolCalls) {
              if (tool.name === 'Task') {
                agentSpawnCount++
                const agentType = tool.input?.subagent_type || 'unknown'
                const description = tool.input?.description || ''
                timeline.push({
                  timestamp: msg.timestamp || '',
                  type: 'agent_spawn',
                  details: `Spawned ${agentType}: ${description}`,
                })
              } else {
                toolCallCount++
                let toolDetails = tool.name

                if (tool.name === 'Read' && tool.input?.file_path) {
                  toolDetails = `Read: ${tool.input.file_path.split('/').pop()}`
                } else if (tool.name === 'Write' && tool.input?.file_path) {
                  toolDetails = `Write: ${tool.input.file_path.split('/').pop()}`
                } else if (tool.name === 'Edit' && tool.input?.file_path) {
                  toolDetails = `Edit: ${tool.input.file_path.split('/').pop()}`
                } else if (tool.name === 'Bash' && tool.input?.command) {
                  toolDetails = `Bash: ${tool.input.command.substring(0, 50)}`
                }

                timeline.push({
                  timestamp: msg.timestamp || '',
                  type: 'tool_call',
                  details: toolDetails,
                })
              }
            }
          }
        } catch (error) {
          continue
        }
      }

      if (!startedAt) {
        return errorResponse('Invalid session file: no timestamps found')
      }

      const durationMs = endedAt
        ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
        : 0

      const total = timeline.length
      const paginatedTimeline = timeline.slice(validatedOffset, validatedOffset + validatedLimit)
      const hasMore = validatedOffset + validatedLimit < total

      let formattedData: TimelineEvent[] | Record<string, number>

      if (format === 'minimal') {
        const eventCounts: Record<string, number> = {}
        for (const event of timeline) {
          eventCounts[event.type] = (eventCounts[event.type] || 0) + 1
        }
        formattedData = eventCounts
      } else {
        formattedData = paginatedTimeline
      }

      const result: SessionTimeline = {
        sessionId,
        project: projectPath,
        summary,
        gitBranch,
        duration: formatDuration(durationMs),
        startedAt,
        endedAt: endedAt || startedAt,
        eventCount: total,
        messageCount: { user: userMessages, assistant: assistantMessages },
        toolCallCount,
        agentSpawnCount,
        data: formattedData,
        total,
        hasMore: format === 'minimal' ? false : hasMore,
      }

      return successResponse(result)
    }

    return errorResponse(`Session ${sessionId} not found`)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
