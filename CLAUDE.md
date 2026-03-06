# Harper-Cortex

An agent-agnostic AI memory system using Harper Fabric as the vector database and MCP for AI agent connectivity.

## Tech Stack

- **Runtime**: Harper (Node.js-based, ES modules)
- **Database**: Harper Fabric with HNSW vector indexing
- **Classification**: Anthropic Claude Haiku 3.5 (`claude-haiku-3-5-20241022`)
- **Embeddings**: Voyage AI `voyage-3` (1024-dim)
- **Ingestion**: Slack Events API webhooks
- **AI Bridge**: Harper MCP Server + `mcp-remote`
- **Tests**: Node.js built-in test runner (`node:test`)

## Key Files

- `resources.js` - Core application: SlackWebhook, MemorySearch, MemoryTable classes + classifyMessage, generateEmbedding, verifySlackSignature helpers
- `schema.graphql` - Memory table with HNSW vector index (no @export since we extend it)
- `config.yaml` - Harper app config (loadEnv, REST, schema, resource files)
- `.env.example` - All required environment variables documented

## Development

```bash
npm run dev    # Start locally on port 9926
npm test       # Run all 35 tests
npm run deploy # Deploy to Harper Fabric
```

## Architecture

Slack webhook -> classify (Claude) + embed (Voyage AI) -> store in Memory table -> query via MCP from Claude Desktop/Cursor.

## Synapse (feature/synapse branch)

Universal Context Broker — ingests development context from any AI tool (Claude Code, Cursor, Windsurf, Copilot) and emits it in any other tool's native format. Full design spec: `docs/synapse-design.md`.

### New Key Files
- `bin/synapse.js` - CLI: sync, emit, search, watch, status commands
- `test/synapse-*.test.js` - Tests for classify, search, ingest, emit

### New Resource Classes (in resources.js)
- `SynapseEntry` - Table extension (strips embeddings, same pattern as MemoryTable)
- `SynapseSearch` - Semantic search with mandatory `projectId` scoping
- `SynapseIngest` - Parses tool-native formats into SynapseEntry records
- `SynapseEmit` - Formats SynapseEntry records into tool-native output

### Conventions
- SynapseEntry table follows same patterns as Memory (HNSW vector index, classification via Claude Haiku, embeddings via Voyage AI)
- Use renamed import: `const { SynapseEntry: SynapseEntryBase } = tables;`
- All Synapse queries must filter on `projectId`
- Default status filter is `active` (excludes superseded/archived)

## Agent Skills

Skills from `harperfast/skills` are tracked in `skills-lock.json` and installed into `.agents/skills/` (git-ignored). Refer to the relevant skill rules when making changes:

- **`harper-best-practices`** — Apply when modifying `schema.graphql`, `resources.js`, or `config.yaml`. Covers schema design, custom resources, authentication, vector indexing, and deployment.

## Conventions

- ES module syntax (import/export)
- No @export on tables that are extended in resources.js
- Structured JSON logging (info, warn, error)
- Slack signature verification for webhook security
- Async processing to stay within Slack's 3-second timeout
