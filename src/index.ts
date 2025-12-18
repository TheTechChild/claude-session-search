#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { getAllToolDefinitions, getToolHandler } from './tools/index.js'
import { errorResponse } from './types.js'

const server = new Server(
  {
    name: 'claude-session-search',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: getAllToolDefinitions(),
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const handler = getToolHandler(name)
  if (!handler) {
    return errorResponse(`Unknown tool: ${name}`)
  }

  try {
    return await handler(args || {})
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(errorMessage)
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Claude Session Search MCP Server v0.1.0 running on stdio')
  console.error('Available tools:', getAllToolDefinitions().map(t => t.name).join(', '))
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
