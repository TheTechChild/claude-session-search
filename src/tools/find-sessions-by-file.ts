import { createReadStream } from 'fs'
import { readdir } from 'fs/promises'
import { createInterface } from 'readline'
import { ToolDefinition, ToolHandler, successResponse, errorResponse, SessionMessage } from '../types.js'

const CLAUDE_HOME = process.env.CLAUDE_HOME || `${process.env.HOME}/.claude`

export const findSessionsByFileDefinition: ToolDefinition = {
  name: 'find_sessions_by_file',
  description: 'Find sessions that touched a specific file (Read, Write, Edit operations)',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'File path or partial path to search for',
      },
      operation: {
        type: 'string',
        description: 'Filter by operation type: Read, Write, Edit, or all (default)',
        enum: ['Read', 'Write', 'Edit', 'all'],
      },
      project: {
        type: 'string',
        description: 'Filter by project path (partial match)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of sessions to return (default: 20)',
      },
    },
    required: ['filePath'],
  },
}

interface FileAccessResult {
  sessionId: string
  project: string
  summary?: string
  filePath: string
  operation: string
  timestamp: string
  gitBranch?: string
}

const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep']

function extractToolCalls(content: string | any[]): Array<{ name: string; input: any }> {
  if (!Array.isArray(content)) return []

  return content
    .filter(item => item.type === 'tool_use' && FILE_TOOLS.includes(item.name))
    .map(item => ({ name: item.name, input: item.input || {} }))
}

export const findSessionsByFileHandler: ToolHandler = async (args) => {
  try {
    const { filePath, operation = 'all', project, limit = 20 } = args

    if (!filePath || typeof filePath !== 'string') {
      return errorResponse('filePath parameter is required and must be a string')
    }

    const filePathLower = filePath.toLowerCase()
    const results: FileAccessResult[] = []
    const seenSessions = new Set<string>()

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
        if (seenSessions.has(sessionId)) continue

        const sessionFilePath = `${sessionDir}/${file}`
        let summary: string | undefined
        let gitBranch: string | undefined
        let foundMatch = false
        let matchedFile = ''
        let matchedOp = ''
        let matchedTimestamp = ''

        try {
          const fileStream = createReadStream(sessionFilePath, { encoding: 'utf-8' })
          const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity,
          })

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

              if (msg.type === 'assistant' && msg.message && !foundMatch) {
                const toolCalls = extractToolCalls(msg.message.content)

                for (const tool of toolCalls) {
                  if (operation !== 'all' && tool.name !== operation) continue

                  const toolFilePath = tool.input?.file_path || tool.input?.path || ''

                  if (toolFilePath.toLowerCase().includes(filePathLower)) {
                    foundMatch = true
                    matchedFile = toolFilePath
                    matchedOp = tool.name
                    matchedTimestamp = msg.timestamp || ''
                    break
                  }
                }
              }
            } catch (error) {
              continue
            }
          }

          if (foundMatch) {
            seenSessions.add(sessionId)
            results.push({
              sessionId,
              project: projectPath,
              summary,
              filePath: matchedFile,
              operation: matchedOp,
              timestamp: matchedTimestamp,
              gitBranch,
            })
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
      searchedFile: filePath,
    })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
