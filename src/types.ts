export interface HistoryEntry {
  display: string
  pastedContents: Record<string, any>
  timestamp: number
  project: string
}

export interface SessionMessage {
  type: 'user' | 'assistant' | 'summary' | 'file-history-snapshot'
  parentUuid?: string
  sessionId?: string
  message?: {
    role: string
    content: string | any[]
  }
  timestamp?: string
  uuid?: string
  cwd?: string
  gitBranch?: string
  version?: string
  summary?: string
  leafUuid?: string
  messageId?: string
  snapshot?: any
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

export interface ToolResult {
  content: Array<{
    type: 'text'
    text: string
  }>
  isError?: boolean
  [key: string]: unknown
}

export type ToolHandler = (args: Record<string, any>) => Promise<ToolResult>

export function successResponse(data: any): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  }
}

export function errorResponse(message: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: message }),
      },
    ],
    isError: true,
  }
}

export interface SearchPromptResult {
  prompt: string
  timestamp: string
  project: string
  sessionId?: string
}

export interface SessionInfo {
  sessionId: string
  project: string
  summary?: string
  messageCount: number
  startedAt: string
  lastActivityAt: string
  sizeBytes: number
  gitBranch?: string
}

export interface SessionMessage_Output {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}
