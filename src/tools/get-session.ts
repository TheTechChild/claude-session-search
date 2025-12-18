import { ToolDefinition, ToolHandler, successResponse, errorResponse } from '../types.js'
import { getSession } from '../parsers/session-parser.js'

export const getSessionDefinition: ToolDefinition = {
  name: 'get_session',
  description: 'Retrieve full Claude Code session transcript',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session UUID',
      },
      format: {
        type: 'string',
        enum: ['json', 'markdown', 'full', 'standard', 'minimal'],
        description: 'Output format: json/markdown (legacy), or full/standard/minimal (default: standard)',
      },
      includeToolCalls: {
        type: 'boolean',
        description: 'Include tool calls in output (default: false)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of messages to return (default: 50, max: 200)',
      },
      offset: {
        type: 'number',
        description: 'Number of messages to skip for pagination (default: 0)',
      },
    },
    required: ['sessionId'],
  },
}

export const getSessionHandler: ToolHandler = async (args) => {
  try {
    const { sessionId, format, includeToolCalls, limit = 50, offset = 0 } = args

    if (!sessionId || typeof sessionId !== 'string') {
      return errorResponse('sessionId parameter is required and must be a string')
    }

    const validatedLimit = Math.min(Math.max(1, limit), 200)
    const validatedOffset = Math.max(0, offset)

    const result = await getSession({
      sessionId,
      format,
      includeToolCalls,
      limit: validatedLimit,
      offset: validatedOffset,
    })

    return successResponse(result)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
