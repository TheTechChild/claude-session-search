import { ToolDefinition, ToolHandler } from '../types.js'

import { searchPromptsDefinition, searchPromptsHandler } from './search-prompts.js'
import { listSessionsDefinition, listSessionsHandler } from './list-sessions.js'
import { getSessionDefinition, getSessionHandler } from './get-session.js'
import { getSessionSummaryDefinition, getSessionSummaryHandler } from './get-session-summary.js'
import { searchSessionContentDefinition, searchSessionContentHandler } from './search-session-content.js'
import { findSessionsByFileDefinition, findSessionsByFileHandler } from './find-sessions-by-file.js'
import { findSessionsByBranchDefinition, findSessionsByBranchHandler } from './find-sessions-by-branch.js'
import { getAgentActivityDefinition, getAgentActivityHandler } from './get-agent-activity.js'
import { getToolUsageStatsDefinition, getToolUsageStatsHandler } from './get-tool-usage-stats.js'
import { getSessionTimelineDefinition, getSessionTimelineHandler } from './get-session-timeline.js'
import { compareSessionsDefinition, compareSessionsHandler } from './compare-sessions.js'

export interface ToolRegistry {
  definition: ToolDefinition
  handler: ToolHandler
}

export const toolRegistry: Record<string, ToolRegistry> = {
  search_prompts: {
    definition: searchPromptsDefinition,
    handler: searchPromptsHandler,
  },
  list_sessions: {
    definition: listSessionsDefinition,
    handler: listSessionsHandler,
  },
  get_session: {
    definition: getSessionDefinition,
    handler: getSessionHandler,
  },
  get_session_summary: {
    definition: getSessionSummaryDefinition,
    handler: getSessionSummaryHandler,
  },
  search_session_content: {
    definition: searchSessionContentDefinition,
    handler: searchSessionContentHandler,
  },
  find_sessions_by_file: {
    definition: findSessionsByFileDefinition,
    handler: findSessionsByFileHandler,
  },
  find_sessions_by_branch: {
    definition: findSessionsByBranchDefinition,
    handler: findSessionsByBranchHandler,
  },
  get_agent_activity: {
    definition: getAgentActivityDefinition,
    handler: getAgentActivityHandler,
  },
  get_tool_usage_stats: {
    definition: getToolUsageStatsDefinition,
    handler: getToolUsageStatsHandler,
  },
  get_session_timeline: {
    definition: getSessionTimelineDefinition,
    handler: getSessionTimelineHandler,
  },
  compare_sessions: {
    definition: compareSessionsDefinition,
    handler: compareSessionsHandler,
  },
}

export function getAllToolDefinitions(): ToolDefinition[] {
  return Object.values(toolRegistry).map(t => t.definition)
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return toolRegistry[name]?.handler
}
