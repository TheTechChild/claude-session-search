import { ToolDefinition, ToolHandler, successResponse, errorResponse } from '../types.js'
import { listSessions } from '../parsers/session-parser.js'

export const listSessionsDefinition: ToolDefinition = {
  name: 'list_sessions',
  description: 'Browse Claude Code sessions with filters',
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Filter by project path (partial match)',
      },
      since: {
        type: 'string',
        description: 'ISO date - only sessions after this date',
      },
      until: {
        type: 'string',
        description: 'ISO date - only sessions before this date',
      },
      sortBy: {
        type: 'string',
        enum: ['date', 'size'],
        description: 'Sort by date or size (default: date)',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort order (default: desc)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
      },
    },
  },
}

export const listSessionsHandler: ToolHandler = async (args) => {
  try {
    const { project, since, until, sortBy, sortOrder, limit } = args

    const result = await listSessions({
      project,
      since,
      until,
      sortBy,
      sortOrder,
      limit,
    })

    return successResponse(result)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
