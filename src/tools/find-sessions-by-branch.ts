import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { createInterface } from 'readline'
import { ToolDefinition, ToolHandler, successResponse, errorResponse, SessionMessage, SessionInfo } from '../types.js'

const CLAUDE_HOME = process.env.CLAUDE_HOME || `${process.env.HOME}/.claude`

export const findSessionsByBranchDefinition: ToolDefinition = {
  name: 'find_sessions_by_branch',
  description: 'Find sessions that were active on a specific git branch',
  inputSchema: {
    type: 'object',
    properties: {
      branch: {
        type: 'string',
        description: 'Git branch name or partial name to search for',
      },
      project: {
        type: 'string',
        description: 'Filter by project path (partial match)',
      },
      exactMatch: {
        type: 'boolean',
        description: 'Require exact branch name match (default: false, allows partial)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of sessions to return (default: 20)',
      },
    },
    required: ['branch'],
  },
}

interface BranchSessionResult {
  sessionId: string
  project: string
  summary?: string
  gitBranch: string
  messageCount: number
  startedAt: string
  lastActivityAt: string
  sizeBytes: number
}

export const findSessionsByBranchHandler: ToolHandler = async (args) => {
  try {
    const { branch, project, exactMatch = false, limit = 20 } = args

    if (!branch || typeof branch !== 'string') {
      return errorResponse('branch parameter is required and must be a string')
    }

    const branchLower = branch.toLowerCase()
    const results: BranchSessionResult[] = []

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

        const sessionId = file.replace('.jsonl', '')
        const sessionFilePath = `${sessionDir}/${file}`

        try {
          const stats = await stat(sessionFilePath)
          const fileStream = createReadStream(sessionFilePath, { encoding: 'utf-8' })
          const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity,
          })

          let messageCount = 0
          let startedAt: string | null = null
          let lastActivityAt: string | null = null
          let summary: string | null = null
          let gitBranch: string | null = null

          for await (const line of rl) {
            if (!line.trim()) continue

            try {
              const msg: SessionMessage = JSON.parse(line)

              if (msg.type === 'user' || msg.type === 'assistant') {
                messageCount++

                if (msg.timestamp) {
                  if (!startedAt) startedAt = msg.timestamp
                  lastActivityAt = msg.timestamp
                }

                if (msg.gitBranch && !gitBranch) {
                  gitBranch = msg.gitBranch
                }
              }

              if (msg.type === 'summary' && msg.summary) {
                summary = msg.summary
              }
            } catch (error) {
              continue
            }
          }

          if (gitBranch && startedAt) {
            const branchMatches = exactMatch
              ? gitBranch.toLowerCase() === branchLower
              : gitBranch.toLowerCase().includes(branchLower)

            if (branchMatches) {
              results.push({
                sessionId,
                project: projectPath,
                summary: summary || undefined,
                gitBranch,
                messageCount,
                startedAt,
                lastActivityAt: lastActivityAt || startedAt,
                sizeBytes: stats.size,
              })
            }
          }
        } catch (error) {
          continue
        }

        if (results.length >= limit * 2) break
      }
    }

    results.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

    return successResponse({
      results: results.slice(0, limit),
      total: results.length,
      searchedBranch: branch,
      exactMatch,
    })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
