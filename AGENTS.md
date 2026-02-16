# AGENTS.md — Claude Session Search

> Agentic coding guide for this repository.

## Project Overview

**Name:** `@angel-studios/claude-session-search`  
**Type:** MCP (Model Context Protocol) Server  
**Purpose:** Search and browse Claude Code session history  
**Language:** TypeScript (ES2022, ESNext modules)  
**Runtime:** Node.js  
**Package Manager:** Yarn (Berry/v3+)  
**Lines of Code:** ~2,235 LOC  
**Owner:** TheTechChild

This MCP server provides tools for searching Claude Code's session history stored in `~/.claude/`. It exposes 11 tools for querying prompts, listing sessions, retrieving transcripts, analyzing agent activity, and comparing sessions.

### Key Features
- **Fuzzy search** across all user prompts in `~/.claude/history.jsonl`
- **Session browsing** with filters (project, date range, sorting)
- **Full transcript retrieval** in JSON or Markdown formats
- **Session analytics** (agent activity, tool usage stats, timelines)
- **File/branch tracking** to find sessions that touched specific files or branches

## Build & Run Commands

### Installation
```bash
yarn install
```

### Development
```bash
yarn dev          # Run with tsx (hot reload)
```

### Build
```bash
yarn build        # Compile TypeScript to dist/
```

### Production
```bash
yarn start        # Run compiled dist/index.js
./start-mcp.sh    # Alternative: shell script wrapper
```

### Testing
No test framework configured. Manual testing via MCP client required.

## Project Structure

```
claude-session-search/
├── src/
│   ├── index.ts                    # MCP server entry point (stdio transport)
│   ├── types.ts                    # Shared TypeScript interfaces
│   ├── parsers/
│   │   ├── history-parser.ts       # Parse ~/.claude/history.jsonl
│   │   └── session-parser.ts       # Parse session .jsonl files
│   └── tools/
│       ├── index.ts                # Tool registry and exports
│       ├── search-prompts.ts       # Search global prompt index
│       ├── list-sessions.ts        # List sessions with filters
│       ├── get-session.ts          # Retrieve full session transcript
│       ├── get-session-summary.ts  # Get session metadata
│       ├── search-session-content.ts
│       ├── find-sessions-by-file.ts
│       ├── find-sessions-by-branch.ts
│       ├── get-agent-activity.ts
│       ├── get-tool-usage-stats.ts
│       ├── get-session-timeline.ts
│       └── compare-sessions.ts
├── dist/                           # Compiled output (gitignored)
├── package.json
├── tsconfig.json
├── start-mcp.sh                    # Production startup script
└── .yarnrc.yml                     # Yarn Berry config
```

### Architecture

**Two-tier session storage:**
1. **Global Prompt Index:** `~/.claude/history.jsonl` — One-line JSON entries with `display`, `timestamp`, `project`
2. **Full Session Transcripts:** `~/.claude/projects/{encoded-path}/{session-uuid}.jsonl` — Multi-line JSONL with messages, summaries, metadata

**Tool Registration Pattern:**
- Each tool exports `{name}Definition` (schema) and `{name}Handler` (implementation)
- `tools/index.ts` maintains a `toolRegistry` mapping tool names to definitions/handlers
- Server calls `getAllToolDefinitions()` for `ListTools` and `getToolHandler()` for `CallTool`

**Response Format:**
- All tools return `ToolResult` with `content: [{ type: 'text', text: string }]`
- Use `successResponse(data)` for JSON serialization
- Use `errorResponse(message)` for errors with `isError: true`

## Code Style Guidelines

### TypeScript Configuration
- **Target:** ES2022
- **Module:** ESNext with `bundler` resolution
- **Strict mode:** Enabled
- **Source maps:** Enabled
- **Declarations:** Generated (`.d.ts` files)

### Naming Conventions
- **Files:** kebab-case (`session-parser.ts`, `get-session-summary.ts`)
- **Interfaces:** PascalCase (`SessionMessage`, `ToolDefinition`)
- **Functions:** camelCase (`getSessionInfo`, `extractContentText`)
- **Constants:** SCREAMING_SNAKE_CASE (`CLAUDE_HOME`)

### Import Style
- Use `.js` extensions in imports (required for ESNext modules)
- Example: `import { ToolDefinition } from '../types.js'`

### Error Handling
- Use try-catch blocks for file I/O operations
- Continue on parse errors (skip malformed JSONL lines)
- Throw descriptive errors for user-facing failures
- Return `errorResponse()` for tool errors

## Conventions

### Environment Variables
- **`CLAUDE_HOME`**: Override default `~/.claude` location (optional)
- **`HOME`**: Used as fallback for default Claude home path

### Project Path Encoding
- Project paths are encoded by replacing `/` with `-`
- Example: `/home/user/projects/foo` → `-home-user-projects-foo`
- Decoding: Strip leading `-`, replace `-` with `/`

### Session File Naming
- Session files: `{session-uuid}.jsonl`
- Agent session files: `agent-{uuid}.jsonl` (excluded from listing)

### JSONL Parsing
- Use `createReadStream` + `readline.createInterface` for streaming
- Skip empty lines with `if (!line.trim()) continue`
- Wrap `JSON.parse()` in try-catch to handle malformed lines

### Message Types
- **`user`**: User prompts
- **`assistant`**: Assistant responses
- **`summary`**: Session summaries (generated by Claude)
- **`file-history-snapshot`**: Git/file state snapshots (ignored by most tools)

### Content Extraction
- Content can be `string` or `any[]` (structured blocks)
- Use `extractContentText()` to flatten to plain text
- Tool calls have `type: 'tool_use'` with `name` and `input`
- Tool results have `type: 'tool_result'`

### Pagination
- Default limit: 50 items
- Support `offset` and `limit` parameters
- Return `total` count and `hasMore` boolean

### Output Formats
- **`json`**: Legacy format (text-only, no tool calls)
- **`markdown`**: Human-readable session transcript
- **`full`**: Raw content blocks (includes all structured data)
- **`standard`**: Text + tool call names
- **`minimal`**: Metadata only (content length, tool call names)

## Known Limitations / Gotchas

### 1. No Session ID Validation
- Session IDs are UUIDs but not validated before lookup
- Invalid UUIDs will scan all project directories before failing

### 2. Project Path Encoding Ambiguity
- Encoding is lossy: `-home-user` could be `/home/user` or `-home/user`
- Leading `-` is stripped during decode, but original path may have started with `-`

### 3. No Caching
- Every query re-scans filesystem and re-parses JSONL files
- Large session histories (1000+ sessions) may be slow

### 4. Timestamp Parsing
- Assumes ISO 8601 timestamps in session files
- No timezone handling — all dates treated as-is

### 5. Tool Call Filtering
- `includeToolCalls=false` filters by checking if content includes `[Tool`
- Fragile: breaks if tool call text changes or appears in user messages

### 6. No Concurrent Write Safety
- Assumes Claude Code is the only writer to session files
- No file locking or atomic reads

### 7. Memory Usage
- `listSessions` loads up to `limit * 10` sessions into memory before sorting
- Large limits (500+) may cause high memory usage

### 8. Error Handling in Loops
- Parse errors in JSONL files are silently skipped with `continue`
- No logging or error reporting for malformed entries

### 9. Git Branch Detection
- Only captures first `gitBranch` field encountered in session
- If branch changes mid-session, only initial branch is recorded

### 10. No MCP Resource Support
- Only implements `tools` capability
- Could expose sessions as MCP resources for direct URI access

### 11. Hardcoded Paths
- `~/.claude` path structure is hardcoded
- Breaking changes to Claude Code's storage format will break this server

### 12. No Incremental Search
- Prompt search reads entire `history.jsonl` file sequentially
- No indexing or binary search optimization
