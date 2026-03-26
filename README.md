# Cortex

**The memory layer for AI agents.** Persistent, distributed, open source.

Cortex gives every AI agent in your stack a shared brain — backed by a real database with built-in vector search, server-side embeddings, and real-time sync. No external API keys for embeddings. No separate infrastructure to manage. One deploy on [Harper Fabric](https://fabric.harper.fast).

🔗 **[Website](https://www.harper.fast/ai/cortex)** · **[Harper Docs](https://docs.harperdb.io)** · **[Discord](https://discord.gg/VzZuaw3Xay)** · **[Deploy Free on Fabric](https://fabric.harper.fast/#/sign-up)**

---

## Why Cortex

Every AI tool today has amnesia. Switch from Claude to Cursor, and your agent forgets everything. Multi-agent systems need shared memory, but building that means stitching together a vector database, an embedding API, a caching layer, and a message broker — four services for one capability.

Cortex collapses all of that into a single runtime:

- **Server-side ONNX embeddings** — text is embedded automatically when stored and searched when queried. No OpenAI key, no Voyage key, nothing to configure.
- **HNSW vector indexing** — 384-dimensional cosine similarity search built into the table layer.
- **Multi-agent isolation** — namespace memories by agent ID, team, or share globally. One config.
- **Real-time propagation (MQTT)** — when one agent learns something, every subscribed agent gets it immediately. No Kafka, no Redis Pub/Sub.
- **Hybrid retrieval** — vector similarity for meaning, structured filters for classification, source, channel, and author. One query, both axes.
- **Distributed via Harper Fabric** — deploy locally for free or replicate globally across regions.

---

## Client Libraries & Integrations

Use Cortex from any agent framework or AI tool:

| Package                                                         | Description                                                                                                               | Install                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **[@harperfast/cortex-client](packages/cortex-client)**         | Lightweight TypeScript HTTP client. Zero dependencies, dual ESM/CJS.                                                      | `npm i @harperfast/cortex-client`                                             |
| **[@harperfast/cortex-mcp-server](packages/cortex-mcp-server)** | MCP server for Claude, Cursor, Windsurf, and any MCP-compatible client. Multi-tenant auth, content safety, rate limiting. | `npm i @harperfast/cortex-mcp-server`                                         |
| **[@harperfast/openclaw-memory](packages/openclaw-memory)**     | OpenClaw / NemoClaw memory plugin. Auto-recall before each turn, auto-capture after. Drop-in LanceDB replacement.         | `npm i @harperfast/openclaw-memory`                                           |
| **@langchain/harper**                                           | LangChain.js VectorStore and Retriever backed by Cortex.                                                                  | [HarperFast/langchain-harper](https://github.com/HarperFast/langchain-harper) |

---

## Quick Start

**Prerequisites:** Node.js 22+ (24 LTS recommended)

### 1. Sign up for Harper Fabric (free)

Create a free cluster at [fabric.harper.fast](https://fabric.harper.fast/#/sign-up). No credit card required. Note your cluster URL, username, and password.

### 2. Clone and install

```bash
git clone https://github.com/HarperFast/Cortex.git
cd Cortex
npm install -g harperdb    # Install the Harper runtime (one-time)
npm install                # Install all dependencies
```

### 3. Configure

```bash
cp .env.example .env
# Add your Fabric cluster URL, username, and password
# Anthropic key optional (for memory classification)
# Embeddings run locally via ONNX — no key needed
```

### 4. Run locally

```bash
npm run dev -w packages/cortex    # Start Cortex Core on port 9926
```

Test it:

```bash
curl -X POST http://localhost:9926/MemorySearch/ \
  -H "Content-Type: application/json" \
  -d '{"query": "why did we change the caching strategy"}'
```

### 5. Deploy to Fabric

```bash
npm run deploy
```

### 6. Connect your AI tools via MCP

See [MCP setup guide](packages/cortex/docs/mcp-setup.md) for Claude Desktop, Cursor, Windsurf, and Claude Code configuration.

---

## Architecture

```
AI Agents (Claude, Cursor, Windsurf, OpenClaw, LangChain)
    │
    ├─ MCP protocol ──→ cortex-mcp-server (multi-tenant auth, content safety)
    ├─ HTTP / SDK ────→ cortex-client
    └─ Plugin hooks ──→ openclaw-memory (auto-recall / auto-capture)
          │
          ▼
    ┌─────────────────────────────────┐
    │         Cortex Core             │
    │  ┌───────────┐  ┌───────────┐  │
    │  │  Memory   │  │  Synapse  │  │
    │  │  Table    │  │  Entry    │  │
    │  │  (HNSW)  │  │  (HNSW)  │  │
    │  └───────────┘  └───────────┘  │
    │  classify → embed (ONNX) → store│
    │  MemorySearch │ REST │ MQTT    │
    └─────────────────────────────────┘
          │
          ▼
    Harper Fabric (distributed, replicated)
```

**Write path:** Slack messages / AI agents / API calls → classify + embed (ONNX, server-side) → store in Memory table with HNSW vector index.

**Read path:** Natural language query → embed → HNSW nearest-neighbor search → ranked results with similarity scores + attribute filters.

---

## Monorepo Packages

| Package                         | Path                                                     | Description                                                                                     |
| ------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@harperfast/cortex`            | [packages/cortex](packages/cortex)                       | Harper Fabric application — Memory + Synapse tables, classification, embeddings, REST endpoints |
| `@harperfast/cortex-client`     | [packages/cortex-client](packages/cortex-client)         | Lightweight TypeScript HTTP client for Cortex                                                   |
| `@harperfast/openclaw-memory`   | [packages/openclaw-memory](packages/openclaw-memory)     | OpenClaw/NemoClaw plugin — auto-recall and auto-capture lifecycle hooks                         |
| `@harperfast/cortex-mcp-server` | [packages/cortex-mcp-server](packages/cortex-mcp-server) | MCP server — bridges AI agents to Cortex with auth, safety, and rate limiting                   |

See each package's README for detailed documentation:

- [Cortex Core](packages/cortex/README.md) — schema, endpoints, environment variables, deployment
- [cortex-client](packages/cortex-client/README.md) — SDK usage, API reference
- [openclaw-memory](packages/openclaw-memory/README.md) — plugin configuration, lifecycle hooks
- [cortex-mcp-server](packages/cortex-mcp-server/README.md) — MCP setup, multi-tenant mode, authentication

---

## Development

```bash
npm test                   # Run all tests (321 across all packages)
npm run build              # Build TypeScript packages
npm run format:check       # Check formatting (dprint)
npm run lint:check         # Lint all packages (oxlint)
```

---

## API Endpoints

### Memory

| Endpoint        | Method     | Description                                                                    |
| --------------- | ---------- | ------------------------------------------------------------------------------ |
| `/MemorySearch` | POST       | Semantic search with attribute filters and score normalization (0-1)           |
| `/VectorSearch` | POST       | Search with a pre-computed embedding vector (for LangChain / server-to-server) |
| `/MemoryStore`  | POST       | Dedup-aware storage: SHA-256 hash + vector similarity dedup before insert      |
| `/MemoryCount`  | POST       | Count memories with optional filters                                           |
| `/BatchUpsert`  | POST       | Insert or update multiple records in a single request                          |
| `/Memory/`      | GET        | List all memories (with pagination)                                            |
| `/Memory/{id}`  | GET/DELETE | Get or delete a single memory by ID                                            |
| `/SlackWebhook` | POST       | Receives Slack Events API payloads, classifies, embeds, and stores             |

### Synapse (Universal Context Broker)

| Endpoint         | Method | Description                                                         |
| ---------------- | ------ | ------------------------------------------------------------------- |
| `/SynapseIngest` | POST   | Ingest context from any tool (CLAUDE.md, .cursor/rules, .windsurf/) |
| `/SynapseSearch` | POST   | Semantic search scoped to a project                                 |
| `/SynapseEmit`   | POST   | Emit context formatted for a target tool                            |
| `/SynapseEntry/` | GET    | List/browse all context entries                                     |

See [Cortex Core README](packages/cortex/README.md) for full request/response examples.

---

## Supported Integrations

### Ingestion Sources

| Platform | Method             | Status                 |
| -------- | ------------------ | ---------------------- |
| Slack    | Events API         | Included               |
| GitHub   | Webhooks           | Add via Resource class |
| Linear   | Webhooks           | Add via Resource class |
| Jira     | Webhooks           | Add via Resource class |
| Discord  | Gateway / Webhooks | Add via Resource class |

### Embedding Providers

| Provider                 | Model                  | Dimensions | Notes                                |
| ------------------------ | ---------------------- | ---------- | ------------------------------------ |
| **@xenova/transformers** | all-MiniLM-L6-v2       | 384        | **Default.** Local ONNX, no API key. |
| Voyage AI                | voyage-3               | 1024       | High quality, requires API key       |
| OpenAI                   | text-embedding-3-small | 1536       | Most widely adopted                  |
| Cohere                   | embed-v4               | 1024       | Strong multilingual support          |
| Ollama (local)           | nomic-embed-text       | 768        | Full privacy, zero API cost          |

### Classification LLMs

| Provider       | Model             | Notes                                           |
| -------------- | ----------------- | ----------------------------------------------- |
| **Anthropic**  | Claude Haiku 3.5  | **Default.** Best structured JSON output        |
| OpenAI         | GPT-4o-mini       | Cheapest, fast                                  |
| Google         | Gemini 2.0 Flash  | Generous free tier                              |
| Ollama (local) | Llama 3 / Mistral | Full privacy                                    |
| None           | Keyword fallback  | Graceful degradation when no API key configured |

### MCP Clients

| Client         | Status          |
| -------------- | --------------- |
| Claude Desktop | Fully supported |
| Claude Code    | Fully supported |
| Cursor         | Fully supported |
| Windsurf       | MCP-compatible  |
| Any MCP client | Open standard   |

---

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](.github/SECURITY.md) for our security policy.

## License

[Apache 2.0](LICENSE)
