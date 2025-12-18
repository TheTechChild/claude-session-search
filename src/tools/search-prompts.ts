import { ToolDefinition, ToolHandler, successResponse, errorResponse } from '../types.js'
import { searchPrompts } from '../parsers/history-parser.js'

export const searchPromptsDefinition: ToolDefinition = {
  name: 'search_prompts',
  description: 'Fuzzy search across all user prompts in Claude Code session history',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term (fuzzy match against prompt text)',
      },
      project: {
        type: 'string',
        description: 'Filter by project path (partial match)',
      },
      since: {
        type: 'string',
        description: 'ISO date - only prompts after this date',
      },
      until: {
        type: 'string',
        description: 'ISO date - only prompts before this date',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
      },
    },
    required: ['query'],
  },
}

export const searchPromptsHandler: ToolHandler = async (args) => {
  try {
    const { query, project, since, until, limit } = args

    if (!query || typeof query !== 'string') {
      return errorResponse('query parameter is required and must be a string')
    }

    const result = await searchPrompts({
      query,
      project,
      since,
      until,
      limit,
    })

    return successResponse(result)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
