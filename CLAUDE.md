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

## Conventions

- ES module syntax (import/export)
- No @export on tables that are extended in resources.js
- Structured JSON logging (info, warn, error)
- Slack signature verification for webhook security
- Async processing to stay within Slack's 3-second timeout
