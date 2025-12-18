import { ToolDefinition, ToolHandler, successResponse, errorResponse } from '../types.js'
import { getSessionSummary } from '../parsers/session-parser.js'

export const getSessionSummaryDefinition: ToolDefinition = {
  name: 'get_session_summary',
  description: 'Get or generate summary for a Claude Code session',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session UUID',
      },
    },
    required: ['sessionId'],
  },
}

export const getSessionSummaryHandler: ToolHandler = async (args) => {
  try {
    const { sessionId } = args

    if (!sessionId || typeof sessionId !== 'string') {
      return errorResponse('sessionId parameter is required and must be a string')
    }

    const result = await getSessionSummary(sessionId)

    return successResponse(result)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
