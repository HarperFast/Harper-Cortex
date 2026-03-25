# @harperfast/openclaw-memory

Distributed long-term agent memory backed by Harper Cortex. Server-side embeddings, multi-agent sharing, zero API keys required.

## Features

- **Distributed persistence** — Memories survive agent restarts and scale horizontally
- **Server-side embeddings** — Cortex handles embedding via ONNX (no API keys needed)
- **Multi-agent sharing** — Multiple agents can query the same memory pool with optional isolation
- **Real database** — ACID guarantees, queryable externally, backed by Harper Cortex
- **Zero configuration** — Unlike LanceDB, no local model downloads or dependency hell
- **Automatic recall** — Relevant memories injected as context before each agent turn
- **Automatic capture** — Facts extracted and stored after each turn
- **Explicit tools** — Agents can manually recall, store, and forget memories

## Installation

```bash
npm install @harperfast/openclaw-memory
```

Then configure in your OpenClaw settings file:

```json
{
	"plugins": {
		"slots": {
			"memory": "@harperfast/openclaw-memory"
		},
		"@harperfast/openclaw-memory": {
			"instanceUrl": "https://my-instance.harpercloud.com",
			"table": "agent_memory",
			"token": "optional-auth-token",
			"recallLimit": 3,
			"recallThreshold": 0.3,
			"captureLimit": 3,
			"dedupThreshold": 0.95
		}
	}
}
```

Or install via OpenClaw's plugin manager:

```bash
openclaw plugins install @harperfast/openclaw-memory
```

## Configuration

### Required

- **`instanceUrl`** — Harper Cortex instance URL (e.g., `https://my-instance.harpercloud.com`)

### Optional

- **`token`** — Authentication token for Cortex (if instance requires auth)
- **`table`** — Cortex table for memory storage (default: `agent_memory`)
- **`schema`** — Cortex schema/database (default: empty string for Fabric deployments; use `"data"` for non-Fabric instances)
- **`agentId`** — Agent identifier for multi-agent isolation (tags all memories)
- **`recallLimit`** — Max memories retrieved per auto-recall (default: `3`)
- **`recallThreshold`** — Minimum similarity for injection (default: `0.3`, range: 0-1)
- **`captureLimit`** — Max facts extracted per turn (default: `3`)
- **`dedupThreshold`** — Similarity threshold for dedup (default: `0.95`, range: 0-1)

## Usage

### Automatic Recall (before_agent_start)

Before each agent turn, relevant memories are automatically searched and injected as context:

```
<relevant-memories>
- [fact] Python was created in 1989
- [preference] User likes concise answers
- [procedure] Always check the documentation first
</relevant-memories>
```

### Automatic Capture (agent_end)

After each turn, the agent's response is analyzed to extract new facts and store them:

```
Agent: "The temperature in New York is 65°F."
→ Captures: [fact] "Temperature in New York is 65°F."
```

### Explicit Tools

Agents can manually recall, store, and forget memories:

#### `memory_recall`

Search the memory pool by semantic similarity:

```
Input: {
  "query": "What's the user's preferred programming language?",
  "limit": 5,
  "minSimilarity": 0.3
}

Output: {
  "success": true,
  "results": [
    {
      "text": "User prefers Python for data analysis",
      "importance": 0.9,
      "category": "preference",
      "similarity": 0.87,
      "createdAt": "2026-03-19T10:30:00Z"
    }
  ],
  "count": 1
}
```

#### `memory_store`

Store a new fact or observation:

```
Input: {
  "text": "The user is interested in machine learning",
  "category": "preference",
  "importance": 0.8
}

Output: {
  "success": true,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Memory stored successfully (ID: 550e8400-e29b-41d4-a716-446655440000)"
}
```

#### `memory_forget`

Delete a memory (GDPR compliance, corrections):

```
Input: {
  "id": "550e8400-e29b-41d4-a716-446655440000"
}

Output: {
  "success": true,
  "message": "Memory 550e8400-e29b-41d4-a716-446655440000 deleted successfully"
}
```

## CLI Commands

### Stats

Show memory statistics:

```bash
openclaw memory stats
```

Output:

```
Memories stored: 42
```

### Search

Search memories by semantic similarity:

```bash
openclaw memory search "Python programming" --limit 10 --threshold 0.5
```

Output:

```
Found 3 memory(ies):

1. [fact] (0.95) Python was created in 1989
   Importance: 0.8, Created: 2026-03-19T10:30:00Z

2. [preference] (0.82) User likes Pythonic code style
   Importance: 0.7, Created: 2026-03-18T14:22:00Z

3. [procedure] (0.78) Python best practice: use type hints
   Importance: 0.6, Created: 2026-03-17T09:15:00Z
```

## Multi-Agent Isolation

The plugin supports three modes for multi-agent memory:

### Option A: Table per agent

Each agent gets its own table:

```json
{
	"table": "agent_memory_{agentId}"
}
```

### Option B: Shared table with namespace (default)

Agents share a table but memories are tagged by agent:

```json
{
	"table": "agent_memory",
	"agentId": "research-bot"
}
```

Cortex filters by `agentId` on search, ensuring isolation.

### Option C: Shared memory pool

All agents read/write the same memories (team knowledge base):

```json
{
	"table": "agent_memory"
}
```

## Architecture

### Core Components

- **CortexMemoryDB** — Low-level REST API client for Cortex
- **Lifecycle Hooks** — Auto-recall and auto-capture event handlers
- **Memory Tools** — Agent-callable functions for explicit memory ops
- **Safety Module** — Injection detection, content filtering, deduplication

### Data Model

Each memory entry has:

```typescript
{
  id: string;              // UUID
  text: string;            // The memory content
  importance: number;      // 0-1 importance score
  category: string;        // "fact" | "preference" | "procedure" | "event"
  agentId?: string;        // For multi-agent isolation
  createdAt: number;       // Timestamp (ms)
}
```

## Security

The plugin includes built-in protections:

- **Injection detection** — Filters prompt injection markers, SQL-like patterns
- **Content filtering** — Removes control characters, normalizes Unicode
- **Rate limiting** — Optional rate limiter for API calls
- **Deduplication** — Avoids storing near-duplicate memories
- **Validation** — Type checks on importance, category, text length

## Comparison with Alternatives

| Feature        | memory-lancedb                                                       | @harperfast/openclaw-memory    |
| -------------- | -------------------------------------------------------------------- | ------------------------------ |
| Embedding      | Requires OpenAI API key                                              | Server-side (Cortex ONNX)      |
| Storage        | Local file                                                           | Distributed service            |
| Multi-agent    | No ([issue #2141](https://github.com/openclaw/openclaw/issues/2141)) | Yes, isolated by `agentId`     |
| Persistence    | Dies with agent                                                      | Survives restarts              |
| External query | No                                                                   | Yes, via Cortex REST API       |
| Scale          | Single node                                                          | Horizontal (Harper clustering) |
| Install        | [Broken npm deps](https://github.com/openclaw/openclaw/issues/28792) | Pure fetch, zero native deps   |

## Notes

**Plugin SDK:** The `plugin-sdk` integration is currently a shim. Validation against a real OpenClaw environment is needed. If you encounter issues integrating with OpenClaw, please open an issue with environment details and logs.

## Development

### Build

```bash
npm run build
```

### Test

```bash
# Unit tests (mocked fetch)
npm test

# Integration tests (requires real Cortex instance)
export CORTEX_INSTANCE_URL=http://localhost:8080
npm run test:integration
```

### Watch mode

```bash
npm run dev
```

## Integration Testing

To run integration tests against a real Cortex instance:

1. Start Cortex:
   ```bash
   docker run -p 8080:8080 harperfast/cortex:latest
   ```

2. Set environment variables:
   ```bash
   export CORTEX_INSTANCE_URL=http://localhost:8080
   export CORTEX_TABLE=test_memories
   ```

3. Run tests:
   ```bash
   npm run test:integration
   ```

## Troubleshooting

### "Failed to store memory: 400 Bad Request"

Check that:

- Cortex instance is running and accessible
- `instanceUrl` is correct
- Table exists in Cortex schema
- Memory entry has `text` field (required)

### "Failed to search memories: 404 Not Found"

Check that:

- MemorySearch endpoint is enabled on Cortex
- Table name matches Cortex schema
- Token is valid (if auth enabled)

### No memories injected into context

Check that:

- Recall similarity threshold isn't too high (`recallThreshold`)
- Memories exist in Cortex table (use `openclaw memory stats`)
- Search results have similarity > threshold

## Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Write tests for new code
4. Run `npm test` and `npm run lint`
5. Submit a pull request

## License

MIT

## References

- [Harper Cortex](https://github.com/HarperFast/Cortex) — Memory backend powering this plugin
- [OpenClaw Plugin Docs](https://docs.openclaw.ai/tools/plugin) — Plugin architecture
- [Harper Fabric](https://harper.com) — The application platform behind Cortex
