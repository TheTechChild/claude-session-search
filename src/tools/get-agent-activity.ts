import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { createInterface } from 'readline'
import { ToolDefinition, ToolHandler, successResponse, errorResponse, SessionMessage } from '../types.js'

const CLAUDE_HOME = process.env.CLAUDE_HOME || `${process.env.HOME}/.claude`

export const getAgentActivityDefinition: ToolDefinition = {
  name: 'get_agent_activity',
  description: 'Get all subagents spawned in a session, with their types and descriptions',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The session ID to analyze',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of agent spawns to return (default: 20, max: 100)',
      },
      offset: {
        type: 'number',
        description: 'Number of agent spawns to skip for pagination (default: 0)',
      },
    },
    required: ['sessionId'],
  },
}

interface AgentSpawn {
  subagentType: string
  description: string
  timestamp: string
  prompt?: string
}

interface AgentActivityResult {
  sessionId: string
  project: string
  summary?: string
  data: AgentSpawn[]
  total: number
  hasMore: boolean
  uniqueAgentTypes: string[]
  agentTypeCounts: Record<string, number>
}

function extractAgentSpawns(content: string | any[], timestamp: string): AgentSpawn[] {
  if (!Array.isArray(content)) return []

  const spawns: AgentSpawn[] = []

  for (const item of content) {
    if (item.type === 'tool_use' && item.name === 'Task') {
      const input = item.input || {}
      spawns.push({
        subagentType: input.subagent_type || 'unknown',
        description: input.description || '',
        timestamp,
        prompt: input.prompt ? input.prompt.substring(0, 200) : undefined,
      })
    }
  }

  return spawns
}

export const getAgentActivityHandler: ToolHandler = async (args) => {
  try {
    const { sessionId, limit = 20, offset = 0 } = args

    if (!sessionId || typeof sessionId !== 'string') {
      return errorResponse('sessionId parameter is required and must be a string')
    }

    const validatedLimit = Math.min(Math.max(1, limit), 100)
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

      const agentSpawns: AgentSpawn[] = []
      let summary: string | null = null

      for await (const line of rl) {
        if (!line.trim()) continue

        try {
          const msg: SessionMessage = JSON.parse(line)

          if (msg.type === 'summary' && msg.summary) {
            summary = msg.summary
          }

          if (msg.type === 'assistant' && msg.message) {
            const spawns = extractAgentSpawns(msg.message.content, msg.timestamp || '')
            agentSpawns.push(...spawns)
          }
        } catch (error) {
          continue
        }
      }

      const agentTypeCounts: Record<string, number> = {}
      for (const spawn of agentSpawns) {
        agentTypeCounts[spawn.subagentType] = (agentTypeCounts[spawn.subagentType] || 0) + 1
      }

      const total = agentSpawns.length
      const paginatedSpawns = agentSpawns.slice(validatedOffset, validatedOffset + validatedLimit)
      const hasMore = validatedOffset + validatedLimit < total

      const result: AgentActivityResult = {
        sessionId,
        project: projectPath,
        summary: summary || undefined,
        data: paginatedSpawns,
        total,
        hasMore,
        uniqueAgentTypes: Object.keys(agentTypeCounts),
        agentTypeCounts,
      }

      return successResponse(result)
    }

    return errorResponse(`Session ${sessionId} not found`)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
