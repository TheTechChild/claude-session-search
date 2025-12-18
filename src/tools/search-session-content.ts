import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { createInterface } from 'readline'
import { ToolDefinition, ToolHandler, successResponse, errorResponse, SessionMessage } from '../types.js'

const CLAUDE_HOME = process.env.CLAUDE_HOME || `${process.env.HOME}/.claude`

export const searchSessionContentDefinition: ToolDefinition = {
  name: 'search_session_content',
  description: 'Full-text search within all message content across sessions',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term (case-insensitive substring match)',
      },
      project: {
        type: 'string',
        description: 'Filter by project path (partial match)',
      },
      role: {
        type: 'string',
        description: 'Filter by message role: user, assistant, or both (default)',
        enum: ['user', 'assistant', 'both'],
      },
      since: {
        type: 'string',
        description: 'ISO date - only messages after this date',
      },
      until: {
        type: 'string',
        description: 'ISO date - only messages before this date',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 20)',
      },
    },
    required: ['query'],
  },
}

interface ContentSearchResult {
  sessionId: string
  project: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  matchContext: string
}

function extractContentText(content: string | any[]): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (item.type === 'text' && item.text) return item.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

function getMatchContext(content: string, query: string, contextLength: number = 100): string {
  const lowerContent = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerContent.indexOf(lowerQuery)

  if (matchIndex === -1) return content.substring(0, 200)

  const start = Math.max(0, matchIndex - contextLength)
  const end = Math.min(content.length, matchIndex + query.length + contextLength)

  let context = content.substring(start, end)
  if (start > 0) context = '...' + context
  if (end < content.length) context = context + '...'

  return context
}

export const searchSessionContentHandler: ToolHandler = async (args) => {
  try {
    const { query, project, role = 'both', since, until, limit = 20 } = args

    if (!query || typeof query !== 'string') {
      return errorResponse('query parameter is required and must be a string')
    }

    const queryLower = query.toLowerCase()
    const results: ContentSearchResult[] = []
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

        const sessionId = file.replace('.jsonl', '')
        const filePath = `${sessionDir}/${file}`

        try {
          const fileStream = createReadStream(filePath, { encoding: 'utf-8' })
          const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity,
          })

          for await (const line of rl) {
            if (!line.trim()) continue
            if (results.length >= limit) break

            try {
              const msg: SessionMessage = JSON.parse(line)

              if (msg.type !== 'user' && msg.type !== 'assistant') continue
              if (role !== 'both' && msg.type !== role) continue

              if (msg.timestamp) {
                const msgDate = new Date(msg.timestamp)
                if (msgDate < sinceDate || msgDate > untilDate) continue
              }

              if (msg.message) {
                const contentText = extractContentText(msg.message.content)

                if (contentText.toLowerCase().includes(queryLower)) {
                  results.push({
                    sessionId,
                    project: projectPath,
                    role: msg.type,
                    content: contentText.substring(0, 500),
                    timestamp: msg.timestamp || '',
                    matchContext: getMatchContext(contentText, query),
                  })
                }
              }
            } catch (error) {
              continue
            }
          }
        } catch (error) {
          continue
        }

        if (results.length >= limit) break
      }

      if (results.length >= limit) break
    }

    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return successResponse({
      results: results.slice(0, limit),
      total: results.length,
      query,
    })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
