# Cortex

Open-source AI memory system powered by [Harper Fabric](https://www.harperdb.io/). Any AI agent gets persistent, semantic memory backed by a real vector database. Clone, configure, deploy.

## Packages

| Package                                                        | Description                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`@harperfast/cortex`](packages/cortex/)                       | Harper Fabric application — Memory + Synapse tables, classification, embeddings |
| [`@harperfast/cortex-client`](packages/cortex-client/)         | Lightweight TypeScript HTTP client for Cortex                                   |
| [`@harper/openclaw-memory`](packages/openclaw-memory/)         | OpenClaw plugin — auto-recall and auto-capture lifecycle hooks                  |
| [`@harperfast/cortex-mcp-server`](packages/cortex-mcp-server/) | MCP server — bridges AI agents (Claude, Cursor, Windsurf) to Cortex             |

## Quick Start

```bash
# Install all dependencies
npm install

# Start Cortex Core locally (port 9926)
npm run dev -w packages/cortex

# Run all tests (321 across all packages)
npm test
```

## Architecture

```
AI Agents (Claude, Cursor, Windsurf, OpenClaw, LangChain)
    │
    ├─ MCP protocol ──→ cortex-mcp-server (auth, rate limiting, quotas)
    ├─ LangChain ─────→ langchain-harper
    └─ OpenClaw hooks → openclaw-memory
                              │
                     cortex-client (HTTP SDK)
                              │
                        Cortex Core
                  (Harper Fabric application)
                              │
              ┌───────────────┼───────────────┐
         Memory table    SynapseEntry     SlackWebhook
        (HNSW vector)   (HNSW vector)    (ingestion)
```

**Write path:** Slack messages / AI agents / API calls → classify + embed (ONNX, server-side) → store in Memory table with HNSW vector index.

**Read path:** Natural language query → embed → HNSW nearest-neighbor search → ranked results with similarity scores.

## Development

```bash
npm test              # Run all tests
npm run build         # Build TypeScript packages
npm run format:check  # Check formatting (dprint)
npm run lint:check    # Lint all packages (oxlint)
```

See each package's README for package-specific documentation:

- [Cortex Core](packages/cortex/README.md) — schema, endpoints, environment variables, deployment
- [cortex-client](packages/cortex-client/README.md) — SDK usage, API reference
- [openclaw-memory](packages/openclaw-memory/README.md) — plugin configuration, lifecycle hooks
- [cortex-mcp-server](packages/cortex-mcp-server/README.md) — MCP setup, multi-tenant mode, authentication

## License

[MIT](packages/cortex/LICENSE)
