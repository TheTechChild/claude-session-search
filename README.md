# Claude Session Search MCP Server

MCP server for searching and browsing Claude Code session history.

## Features

### Tier 1 Tools

1. **search_prompts** - Fuzzy search across all user prompts
2. **list_sessions** - Browse sessions with filters and sorting
3. **get_session** - Retrieve full session transcript (JSON or Markdown)
4. **get_session_summary** - Get session summary and metadata

## Installation

```bash
cd ~/angel-studios/.claude/mcp-servers/claude-session-search
yarn install
yarn build
```

## Development

```bash
yarn dev
```

## Configuration

Set `CLAUDE_HOME` environment variable to override the default `~/.claude` location.

## Session History Architecture

Claude Code stores session history in two tiers:

### Global Prompt Index
- **Location**: `~/.claude/history.jsonl`
- **Format**: One JSON object per line with prompt, timestamp, and project

### Full Session Transcripts
- **Location**: `~/.claude/projects/{encoded-path}/{session-uuid}.jsonl`
- **Format**: One JSON object per line with messages, summaries, and metadata

## Tool Usage Examples

### Search Prompts
```typescript
mcp__claude-session-search__search_prompts({
  query: "GraphQL",
  project: "angel-studios",
  limit: 10
})
```

### List Sessions
```typescript
mcp__claude-session-search__list_sessions({
  project: "angel-studios",
  sortBy: "date",
  sortOrder: "desc",
  limit: 20
})
```

### Get Session
```typescript
mcp__claude-session-search__get_session({
  sessionId: "01d8a33b-7ac1-48bb-83cc-56ec4a9167b1",
  format: "markdown"
})
```

### Get Session Summary
```typescript
mcp__claude-session-search__get_session_summary({
  sessionId: "01d8a33b-7ac1-48bb-83cc-56ec4a9167b1"
})
```
