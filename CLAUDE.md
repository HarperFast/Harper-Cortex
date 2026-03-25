# Cortex Monorepo

An agent-agnostic AI memory system using Harper Fabric as the vector database and MCP for AI agent connectivity.

## Monorepo Structure

This is an npm workspaces monorepo with 4 packages:

| Package                         | Path                          | Language   | Description                                                             |
| ------------------------------- | ----------------------------- | ---------- | ----------------------------------------------------------------------- |
| `@harperfast/cortex`            | `packages/cortex/`            | JavaScript | Harper Fabric app — Memory + Synapse tables, classification, embeddings |
| `@harperfast/cortex-client`     | `packages/cortex-client/`     | TypeScript | Lightweight HTTP SDK for Cortex                                         |
| `@harperfast/openclaw-memory`   | `packages/openclaw-memory/`   | TypeScript | OpenClaw plugin — auto-recall/capture lifecycle hooks                   |
| `@harperfast/cortex-mcp-server` | `packages/cortex-mcp-server/` | TypeScript | MCP server — bridges AI agents to Cortex                                |

## Tech Stack

- **Runtime**: Harper Fabric (Node.js-based, ES modules)
- **Database**: Harper Fabric with HNSW vector indexing
- **Classification**: Provider-agnostic (Anthropic, OpenAI, Google, Ollama, local fallback)
- **Embeddings**: `@huggingface/transformers` with `all-MiniLM-L6-v2` (384-dim, ONNX)
- **Tests**: Vitest (workspace mode, ~150 tests across all packages)
- **Formatting**: dprint (tabs, preferSingle)
- **Linting**: oxlint

## Development

```bash
npm ci                # Install all workspace dependencies
npm test              # Run all tests across all packages
npm run build         # Build all TypeScript packages
npm run format:check  # Check formatting (dprint)
npm run lint:check    # Lint all packages (oxlint)
```

### Package-specific commands

```bash
# Cortex Core (Harper Fabric app)
cd packages/cortex
npm run dev           # Start Harper dev server on port 9926
npm run deploy        # Deploy to Harper Fabric

# cortex-mcp-server
npm run dev -w packages/cortex-mcp-server   # Start MCP server with HTTP transport
```

## Key Files

### packages/cortex/ (Harper Fabric app)

- `schema.graphql` — Memory + SynapseEntry tables with HNSW vector indexes
- `config.yaml` — Harper app config
- `resources/` — Modular resource classes (memory.js, synapse.js, slack-webhook.js, shared.js, classification-provider.js)
- `resources.js` — Barrel re-export for backward compatibility
- `bin/synapse.js` — Synapse CLI
- `.env.example` — All environment variables documented

### packages/cortex-client/

- `src/client.ts` — HTTP client core
- `src/memory.ts` — Memory API (search, store, recall, forget, count, vectorSearch, batchUpsert)
- `src/synapse.ts` — Synapse API (search, ingest, emit, delete)

### packages/openclaw-memory/

- `src/lifecycle.ts` — auto-recall (before turn) + auto-capture (after turn) hooks
- `src/safety.ts` — Content safety filtering
- `openclaw.plugin.json` — Plugin manifest

### packages/cortex-mcp-server/

- `src/index.ts` — MCP server (stdio + HTTP transport)
- `src/tools/` — Tool implementations (memory, synapse, admin, audit)
- `src/auth.ts` — JWT/JWKS authentication
- `src/quota.ts` — Per-agent storage quota enforcement
- `harper/` — Harper Custom Resource deployment (self-contained)

## Agent Skills

Skills from `harperfast/skills` are tracked in `packages/cortex/skills-lock.json`. Refer to the relevant skill rules when modifying Harper-specific files:

- **`harper-best-practices`** — Apply when modifying `schema.graphql`, `resources.js`, or `config.yaml`

## Conventions

- ES module syntax (import/export)
- No @export on tables that are extended in resources.js
- Shared TypeScript config: `tsconfig.base.json` at root, extended by each TS package
- Shared devDependencies (vitest, typescript, dprint, oxlint) at root
- Package-specific dependencies stay in each package
