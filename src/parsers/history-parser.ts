import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { HistoryEntry, SearchPromptResult } from '../types.js'

const CLAUDE_HOME = process.env.CLAUDE_HOME || `${process.env.HOME}/.claude`

export async function searchPrompts(options: {
  query: string
  project?: string
  since?: string
  until?: string
  limit?: number
}): Promise<{ results: SearchPromptResult[]; total: number }> {
  const { query, project, since, until, limit = 50 } = options

  const historyPath = `${CLAUDE_HOME}/history.jsonl`
  const results: SearchPromptResult[] = []

  const sinceTimestamp = since ? new Date(since).getTime() : 0
  const untilTimestamp = until ? new Date(until).getTime() : Infinity

  const queryLower = query.toLowerCase()

  try {
    const fileStream = createReadStream(historyPath, { encoding: 'utf-8' })
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.trim()) continue

      try {
        const entry: HistoryEntry = JSON.parse(line)

        if (entry.timestamp < sinceTimestamp || entry.timestamp > untilTimestamp) {
          continue
        }

        if (project && !entry.project.includes(project)) {
          continue
        }

        if (!entry.display.toLowerCase().includes(queryLower)) {
          continue
        }

        results.push({
          prompt: entry.display,
          timestamp: new Date(entry.timestamp).toISOString(),
          project: entry.project,
        })

        if (results.length >= limit) {
          break
        }
      } catch (error) {
        continue
      }
    }

    return {
      results: results.reverse(),
      total: results.length,
    }
  } catch (error) {
    throw new Error(`Failed to read history file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
