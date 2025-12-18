import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { createInterface } from 'readline'
import { SessionMessage, SessionInfo, SessionMessage_Output } from '../types.js'

const CLAUDE_HOME = process.env.CLAUDE_HOME || `${process.env.HOME}/.claude`

function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-')
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
        if (item.type === 'tool_use' && item.name) return `[Tool: ${item.name}]`
        if (item.type === 'tool_result') return '[Tool Result]'
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

export async function listSessions(options: {
  project?: string
  since?: string
  until?: string
  sortBy?: 'date' | 'size'
  sortOrder?: 'asc' | 'desc'
  limit?: number
}): Promise<{ sessions: SessionInfo[]; total: number }> {
  const { project, since, until, sortBy = 'date', sortOrder = 'desc', limit = 50 } = options

  const projectsDir = `${CLAUDE_HOME}/projects`
  const projectDirs = await readdir(projectsDir)

  const sessions: SessionInfo[] = []
  const sinceDate = since ? new Date(since) : new Date(0)
  const untilDate = until ? new Date(until) : new Date()

  for (const projectDir of projectDirs) {
    const projectPath = projectDir.replace(/^-/, '').replace(/-/g, '/')

    if (project && !projectPath.includes(project)) {
      continue
    }

    const sessionDir = `${projectsDir}/${projectDir}`
    const files = await readdir(sessionDir)

    for (const file of files) {
      if (!file.endsWith('.jsonl') || file.startsWith('agent-')) {
        continue
      }

      const sessionId = file.replace('.jsonl', '')
      const filePath = `${sessionDir}/${file}`

      try {
        const stats = await stat(filePath)
        const sessionInfo = await getSessionInfo(filePath, sessionId, projectPath)

        if (!sessionInfo) continue

        const sessionDate = new Date(sessionInfo.startedAt)
        if (sessionDate < sinceDate || sessionDate > untilDate) {
          continue
        }

        sessionInfo.sizeBytes = stats.size
        sessions.push(sessionInfo)

        if (sessions.length >= limit * 10) {
          break
        }
      } catch (error) {
        continue
      }
    }
  }

  sessions.sort((a, b) => {
    let comparison = 0

    if (sortBy === 'date') {
      comparison = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    } else {
      comparison = a.sizeBytes - b.sizeBytes
    }

    return sortOrder === 'desc' ? -comparison : comparison
  })

  return {
    sessions: sessions.slice(0, limit),
    total: sessions.length,
  }
}

async function getSessionInfo(
  filePath: string,
  sessionId: string,
  projectPath: string
): Promise<SessionInfo | null> {
  try {
    const fileStream = createReadStream(filePath, { encoding: 'utf-8' })
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
            if (!startedAt) {
              startedAt = msg.timestamp
            }
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

    if (!startedAt) {
      return null
    }

    return {
      sessionId,
      project: projectPath,
      summary: summary || undefined,
      messageCount,
      startedAt,
      lastActivityAt: lastActivityAt || startedAt,
      sizeBytes: 0,
      gitBranch: gitBranch || undefined,
    }
  } catch (error) {
    return null
  }
}

export async function getSession(options: {
  sessionId: string
  format?: 'json' | 'markdown' | 'full' | 'standard' | 'minimal'
  includeToolCalls?: boolean
  limit?: number
  offset?: number
}): Promise<{
  sessionId: string
  project: string
  summary?: string
  gitBranch?: string
  startedAt: string
  lastActivityAt: string
  data: SessionMessage_Output[] | string | any[]
  total: number
  hasMore: boolean
}> {
  const { sessionId, format = 'standard', includeToolCalls = false, limit = 50, offset = 0 } = options

  const projectsDir = `${CLAUDE_HOME}/projects`
  const projectDirs = await readdir(projectsDir)

  for (const projectDir of projectDirs) {
    const sessionPath = `${projectsDir}/${projectDir}/${sessionId}.jsonl`

    try {
      await stat(sessionPath)
      const projectPath = projectDir.replace(/^-/, '').replace(/-/g, '/')

      return await parseSessionFile(sessionPath, sessionId, projectPath, format, includeToolCalls, limit, offset)
    } catch (error) {
      continue
    }
  }

  throw new Error(`Session ${sessionId} not found`)
}

function extractToolCallsFromContent(content: string | any[]): Array<{ name: string; input?: any }> {
  if (!Array.isArray(content)) return []

  return content
    .filter(item => item.type === 'tool_use')
    .map(item => ({ name: item.name, input: item.input }))
}

async function parseSessionFile(
  filePath: string,
  sessionId: string,
  projectPath: string,
  format: 'json' | 'markdown' | 'full' | 'standard' | 'minimal',
  includeToolCalls: boolean,
  limit: number,
  offset: number
): Promise<{
  sessionId: string
  project: string
  summary?: string
  gitBranch?: string
  startedAt: string
  lastActivityAt: string
  data: SessionMessage_Output[] | string | any[]
  total: number
  hasMore: boolean
}> {
  const fileStream = createReadStream(filePath, { encoding: 'utf-8' })
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  })

  const allMessages: any[] = []
  let summary: string | null = null
  let gitBranch: string | null = null
  let startedAt: string | null = null
  let lastActivityAt: string | null = null

  for await (const line of rl) {
    if (!line.trim()) continue

    try {
      const msg: SessionMessage = JSON.parse(line)

      if (msg.type === 'user' || msg.type === 'assistant') {
        if (msg.timestamp) {
          if (!startedAt) {
            startedAt = msg.timestamp
          }
          lastActivityAt = msg.timestamp
        }

        if (msg.gitBranch && !gitBranch) {
          gitBranch = msg.gitBranch
        }

        if (msg.message) {
          allMessages.push({
            role: msg.type,
            rawContent: msg.message.content,
            timestamp: msg.timestamp || '',
          })
        }
      }

      if (msg.type === 'summary' && msg.summary) {
        summary = msg.summary
      }
    } catch (error) {
      continue
    }
  }

  if (!startedAt) {
    throw new Error('Invalid session file: no timestamps found')
  }

  const total = allMessages.length
  const paginatedMessages = allMessages.slice(offset, offset + limit)
  const hasMore = offset + limit < total

  let formattedMessages: any[] | string

  if (format === 'markdown' || format === 'json') {
    const legacyMessages: SessionMessage_Output[] = paginatedMessages.map(msg => ({
      role: msg.role,
      content: extractContentText(msg.rawContent),
      timestamp: msg.timestamp,
    })).filter(msg => includeToolCalls || !msg.content.includes('[Tool'))

    if (format === 'markdown') {
      const mdLines: string[] = []
      mdLines.push(`# Session: ${sessionId}`)
      mdLines.push(`**Project:** ${projectPath}`)
      if (summary) mdLines.push(`**Summary:** ${summary}`)
      if (gitBranch) mdLines.push(`**Branch:** ${gitBranch}`)
      mdLines.push(`**Started:** ${startedAt}`)
      mdLines.push(`**Last Activity:** ${lastActivityAt}`)
      mdLines.push('')

      for (const msg of legacyMessages) {
        mdLines.push(`## ${msg.role === 'user' ? 'User' : 'Assistant'} (${msg.timestamp})`)
        mdLines.push(msg.content)
        mdLines.push('')
      }

      formattedMessages = mdLines.join('\n')
    } else {
      formattedMessages = legacyMessages
    }
  } else if (format === 'full') {
    formattedMessages = paginatedMessages.map(msg => ({
      role: msg.role,
      timestamp: msg.timestamp,
      content: msg.rawContent,
    }))
  } else if (format === 'standard') {
    formattedMessages = paginatedMessages.map(msg => {
      const textContent = extractContentText(msg.rawContent)
      const toolCalls = extractToolCallsFromContent(msg.rawContent)

      return {
        role: msg.role,
        timestamp: msg.timestamp,
        text: textContent || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls.map(t => t.name) : undefined,
      }
    })
  } else if (format === 'minimal') {
    formattedMessages = paginatedMessages.map(msg => {
      const textContent = extractContentText(msg.rawContent)
      const toolCalls = extractToolCallsFromContent(msg.rawContent)

      return {
        role: msg.role,
        timestamp: msg.timestamp,
        contentLength: textContent.length,
        toolCalls: toolCalls.length > 0 ? toolCalls.map(t => t.name) : undefined,
      }
    })
  } else {
    formattedMessages = paginatedMessages
  }

  return {
    sessionId,
    project: projectPath,
    summary: summary || undefined,
    gitBranch: gitBranch || undefined,
    startedAt,
    lastActivityAt: lastActivityAt || startedAt,
    data: formattedMessages,
    total,
    hasMore,
  }
}

export async function getSessionSummary(sessionId: string): Promise<{
  sessionId: string
  summary: string
  project: string
  messageCount: number
  startedAt: string
  lastActivityAt: string
  topics?: string[]
}> {
  const projectsDir = `${CLAUDE_HOME}/projects`
  const projectDirs = await readdir(projectsDir)

  for (const projectDir of projectDirs) {
    const sessionPath = `${projectsDir}/${projectDir}/${sessionId}.jsonl`

    try {
      await stat(sessionPath)
      const projectPath = projectDir.replace(/^-/, '').replace(/-/g, '/')

      const info = await getSessionInfo(sessionPath, sessionId, projectPath)
      if (!info) {
        throw new Error('Failed to parse session')
      }

      let summaryText = info.summary

      if (!summaryText) {
        const session = await parseSessionFile(sessionPath, sessionId, projectPath, 'json', false, 1, 0)
        const firstUserMessage = (session.data as SessionMessage_Output[]).find(
          m => m.role === 'user'
        )
        summaryText = firstUserMessage?.content.substring(0, 200) || 'No summary available'
      }

      return {
        sessionId,
        summary: summaryText,
        project: info.project,
        messageCount: info.messageCount,
        startedAt: info.startedAt,
        lastActivityAt: info.lastActivityAt,
      }
    } catch (error) {
      continue
    }
  }

  throw new Error(`Session ${sessionId} not found`)
}
