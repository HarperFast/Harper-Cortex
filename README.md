# Cortex

A persistent, agent-agnostic AI memory system powered by [Harper Fabric](https://harper.fast). Clone, configure your API keys, deploy, and give all your AI tools a shared brain.

## The Problem

When you use Claude, ChatGPT, or Cursor, your conversation history and learned context are siloed inside each platform. Switch tools, and your AI gets amnesia. This is **context rot**.

## The Solution

Deploy a centralized vector database on Harper Fabric and connect it to your AI agents via [MCP (Model Context Protocol)](https://modelcontextprotocol.io). All your tools read and write to the same unified memory pool.

```
Slack / GitHub / ...     ──webhook──┐
                                    ├──▶  Harper Fabric  ◀──MCP──▶  Claude Desktop / Cursor / ...
CLAUDE.md / .cursor/ ... ──CLI/API──┘      (vector DB)
```

## Architecture

```
INGESTION SOURCES              HARPER FABRIC CLUSTER
┌──────────────┐
│ Slack        │ ──▶ ┌──────────────────────────────────────────────────┐
│ Events API   │     │  SlackWebhook (classify + embed)                 │
└──────────────┘     │              │                                   │
┌──────────────┐     │  ┌───────────▼────────────────────────────────┐  │
│ GitHub / ... │ ──▶ │  │  Memory Table (HNSW vector index)          │  │
│ LangChain    │     │  │  ├─ agentId (namespace isolation)          │  │
│ cortex-client│     │  │  ├─ contentHash (exact dedup)              │  │
└──────────────┘     │  │  └─ supersedes (provenance chain)          │  │
                     │  └────────────────────────────────────────────┘  │
                     │                                                  │
                     │  Memory Endpoints:                               │
                     │  ├─ MemorySearch (semantic + attribute filters)  │
                     │  ├─ VectorSearch (pre-computed embeddings)       │
                     │  ├─ BatchUpsert (bulk operations)                │
                     │  ├─ MemoryStore (dedup-aware storage)            │
                     │  ├─ MemoryCount (filtered counts)                │
                     │  └─ DELETE /Memory/{id}                          │
                     │                                                  │
┌──────────────┐     │  SynapseIngest (parse + classify + embed)       │
│ CLAUDE.md    │     │              │                                   │
│ .cursor/rules│ ──▶ │  ┌───────────▼────────────────────────────────┐  │
│ .windsurf/   │     │  │  SynapseEntry Table (HNSW idx)             │  │
│ copilot-inst │     │  └───────────┬────────────────────────────────┘  │
└──────────────┘     │              │                                   │
(synapse CLI/API)    │  ┌───────────▼────────────────────────────────┐  │
                     │  │  MCP Server (7 tools + 6 admin tools)      │  │
                     │  └───────────┬────────────────────────────────┘  │
                     └──────────────┼───────────────────────────────────┘
                                    │ MCP JSON-RPC
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
       Claude Desktop            Cursor            Any MCP Client
```

## Prerequisites

- **Node.js** 22+ (recommended: 24 LTS)

## Quick Start

### 1. Sign up for Harper Fabric

Create your free cluster at [fabric.harper.fast](https://fabric.harper.fast):

1. Create an account and verify your email
2. Create an organization
3. Create a cluster (free tier, no credit card required)
4. Note your **cluster URL**, **username**, and **password**

### 2. Clone and install

```bash
git clone https://github.com/HarperFast/Cortex.git
cd Cortex
npm install -g harperdb   # Install the Harper runtime (one-time)
npm install               # Install project dependencies
```

### 3. Create your API accounts

Sign up for these services and grab your API keys. All have free tiers.

| Service       | Sign Up                                                 | What You Need                                                                                        |
| ------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com/) | API key (used for message classification)                                                            |
| **Slack**     | [api.slack.com/apps](https://api.slack.com/apps)        | Create a Slack app. See [docs/slack-app-setup.md](docs/slack-app-setup.md) for the full walkthrough. |

### 4. Configure environment

```bash
cp .env.example .env
```

Open `.env` and paste in your Harper Fabric credentials from Step 1 and the API keys from Step 3. See [Environment Variables](#environment-variables) for details on each variable.

### 5. Run locally

```bash
npm run dev
```

This starts Harper locally on `http://localhost:9926` with the Memory table, vector index, and all endpoints ready. Test it:

```bash
curl -X POST http://localhost:9926/MemorySearch/ \
  -H "Content-Type: application/json" \
  -d '{"query": "test search"}'
```

For Slack webhook testing during local development, use a tunnel:

```bash
ngrok http 9926   # Then use the ngrok URL as your Slack Events API request URL
```

### 6. Deploy to Harper Fabric

```bash
npm run deploy
```

Once deployed, update your Slack Events API request URL to point at your cluster: `https://your-cluster.harperfabric.com/SlackWebhook`

### 7. Connect Claude Desktop via MCP

See [docs/mcp-setup.md](docs/mcp-setup.md) for configuration instructions.

## Environment Variables

| Variable                  | Required        | Description                                                                                                                                                    |
| ------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | Optional        | Anthropic API key for Claude (default classification provider). Not required if using a different `CLASSIFICATION_PROVIDER` or running without classification. |
| `SLACK_SIGNING_SECRET`    | For Slack       | Slack app signing secret (webhook verification)                                                                                                                |
| `SLACK_BOT_TOKEN`         | For Slack       | Slack bot user OAuth token (`xoxb-...`)                                                                                                                        |
| `CLI_TARGET`              | For deploy      | Harper Fabric cluster URL (e.g., `https://cluster.org.harperfabric.com`)                                                                                       |
| `CLI_TARGET_USERNAME`     | For deploy      | Harper cluster admin username                                                                                                                                  |
| `CLI_TARGET_PASSWORD`     | For deploy      | Harper cluster admin password                                                                                                                                  |
| `SYNAPSE_ENDPOINT`        | For Synapse CLI | Base URL of Cortex deployment                                                                                                                                  |
| `SYNAPSE_PROJECT`         | For Synapse CLI | Project ID to scope context entries                                                                                                                            |
| `SYNAPSE_AUTH`            | For Synapse CLI | Authorization header (e.g. `Basic dXNlcjpwYXNz`)                                                                                                               |
| `CLASSIFICATION_PROVIDER` | Optional        | Classification LLM provider: `anthropic` (default), `openai`, `google`, `ollama`, `openai-compatible`, or `local`                                              |
| `CLASSIFICATION_API_KEY`  | Optional        | API key for the chosen classification provider (falls back to `ANTHROPIC_API_KEY` for Anthropic)                                                               |
| `CLASSIFICATION_MODEL`    | Optional        | Model ID for classification (defaults vary by provider)                                                                                                        |
| `CLASSIFICATION_BASE_URL` | Optional        | Base URL for `ollama` or `openai-compatible` providers                                                                                                         |
| `EMBEDDING_MODEL`         | Optional        | HuggingFace model for embeddings (default: `Xenova/all-MiniLM-L6-v2`)                                                                                          |
| `REQUIRE_AGENT_NAMESPACE` | Optional        | Set to `true` to require `agentId` on all search/count requests (multi-tenant enforcement)                                                                     |

## Schema

The Memory table stores all ingested content with HNSW vector indexing for semantic search:

| Field            | Type    | Description                                                  |
| ---------------- | ------- | ------------------------------------------------------------ |
| `id`             | ID      | Primary key                                                  |
| `rawText`        | String  | Original content                                             |
| `source`         | String  | Origin platform (e.g. `slack`) — indexed                     |
| `sourceType`     | String  | Content type (e.g. `message`) — indexed                      |
| `channelId`      | String  | Source channel — indexed                                     |
| `channelName`    | String  | Human-readable channel name                                  |
| `authorId`       | String  | Author identifier — indexed                                  |
| `authorName`     | String  | Human-readable author name                                   |
| `agentId`        | String  | Namespace for multi-agent isolation — indexed                |
| `classification` | String  | AI-assigned category (decision, action_item, etc.) — indexed |
| `entities`       | Any     | Extracted entities (people, projects, technologies, topics)  |
| `embedding`      | [Float] | 384-dim vector — HNSW indexed (cosine distance)              |
| `contentHash`    | String  | SHA-256 hash of normalized text — indexed (exact dedup)      |
| `supersedes`     | String  | ID of the memory this record replaces (provenance chain)     |
| `summary`        | String  | AI-generated summary                                         |
| `timestamp`      | Date    | When the content was created — indexed                       |
| `threadTs`       | String  | Thread identifier (for threaded conversations)               |
| `metadata`       | Any     | Arbitrary metadata                                           |

## API Endpoints

### Memory Endpoints

| Endpoint        | Method | Description                                                                    |
| --------------- | ------ | ------------------------------------------------------------------------------ |
| `/SlackWebhook` | POST   | Receives Slack Events API payloads. Classifies, embeds, and stores messages.   |
| `/MemorySearch` | POST   | Semantic search with attribute filters and score normalization (0-1)           |
| `/VectorSearch` | POST   | Search with a pre-computed embedding vector (for LangChain / server-to-server) |
| `/BatchUpsert`  | POST   | Insert or update multiple memory records in a single request                   |
| `/MemoryStore`  | POST   | Dedup-aware storage: SHA-256 hash + vector similarity dedup before insert      |
| `/MemoryCount`  | POST   | Count memories with optional filters (source, classification, agentId, etc.)   |
| `/Memory/`      | GET    | List all memories (with pagination)                                            |
| `/Memory/{id}`  | GET    | Get a single memory by ID                                                      |
| `/Memory/{id}`  | DELETE | Delete a memory by ID                                                          |

### MemorySearch Request

```json
{
	"query": "Why did we change the caching strategy?",
	"limit": 10,
	"filters": {
		"classification": "decision",
		"source": "slack",
		"channelId": "C0123456",
		"authorId": "U0123456",
		"agentId": "my-agent"
	}
}
```

Results include a normalized `similarity` score (0-1, where 1 = exact match) alongside the raw `$distance` value for backwards compatibility.

### VectorSearch Request

For clients that handle their own embeddings (e.g. LangChain with a custom embedding model):

```json
{
	"vector": [0.1, -0.2, 0.3, "... (384 floats)"],
	"limit": 10,
	"filter": { "classification": "decision" }
}
```

### MemoryStore Request (with dedup)

Two-phase deduplication: (1) SHA-256 content hash for exact matches, (2) vector similarity for semantic near-duplicates. Duplicates are updated in-place rather than creating new records.

```json
{
	"text": "We decided to use Redis for the caching layer",
	"agentId": "my-agent",
	"dedupThreshold": 0.95
}
```

Response: `{ "action": "created" | "deduplicated", "id": "..." }`

### BatchUpsert Request

```json
{
	"table": "Memory",
	"records": [
		{ "rawText": "First memory", "source": "api" },
		{ "rawText": "Second memory", "source": "api", "embedding": [0.1, ...] }
	]
}
```

Records without an `embedding` field are embedded server-side automatically.

## Scripts

| Command                 | Description                          |
| ----------------------- | ------------------------------------ |
| `npm run dev`           | Start Harper locally for development |
| `npm run deploy`        | Deploy to Harper Fabric              |
| `npm test`              | Run all tests (Vitest)               |
| `npm run test:watch`    | Run tests in watch mode              |
| `npm run test:coverage` | Run tests with coverage report       |
| `npm run format:check`  | Check formatting (dprint)            |
| `npm run format:fix`    | Auto-fix formatting                  |
| `npm run lint:check`    | Lint with oxlint                     |
| `npm run lint:fix`      | Auto-fix lint issues                 |
| `npm start`             | Start Harper in production mode      |

## Testing

```bash
npm test
```

Tests use [Vitest](https://vitest.dev/) with module mocking via `vi.mock()` / `vi.hoisted()`.

## Project Structure

```
├── config.yaml         # Harper application configuration
├── schema.graphql      # Database schema (Memory + SynapseEntry tables)
├── resources.js        # Barrel re-export (imports from resources/)
├── resources/          # Core logic (split modules)
│   ├── shared.js       # Embedding model, constants, generateEmbedding()
│   ├── memory.js       # MemorySearch, MemoryStore, MemoryCount, VectorSearch, BatchUpsert
│   ├── synapse.js      # SynapseIngest, SynapseSearch, SynapseEmit, SynapseEntry
│   ├── slack-webhook.js        # SlackWebhook + HMAC signature verification
│   └── classification-provider.js  # 6-provider classification (Anthropic, OpenAI, Google, Ollama, etc.)
├── package.json        # Dependencies and scripts
├── .env.example        # Environment variable template
├── .nvmrc              # Node.js version (24 LTS)
├── bin/
│   └── synapse.js      # Synapse CLI (sync, emit, search, watch, status)
├── test/               # Test suite (142 tests, Vitest)
│   ├── batch-upsert.test.js
│   ├── classify.test.js
│   ├── dedup-store.test.js
│   ├── embedding.test.js
│   ├── generic-filtering.test.js
│   ├── memory-count.test.js
│   ├── namespace.test.js
│   ├── score-normalization.test.js
│   ├── search.test.js
│   ├── synapse-classify.test.js
│   ├── synapse-emit.test.js
│   ├── synapse-ingest.test.js
│   ├── synapse-search.test.js
│   ├── vector-search.test.js
│   └── webhook.test.js
└── docs/               # Guides
    ├── architecture.md
    ├── synapse-design.md
    ├── slack-app-setup.md
    └── mcp-setup.md
```

## How It Works

### Conversational memory (Slack / webhooks)

1. **A source sends an event** via webhook (e.g. Slack message, GitHub issue, Linear task)
2. **Classification**: Claude Haiku categorizes the content (decision, action_item, knowledge, etc.) and extracts entities (people, projects, technologies)
3. **Embedding**: A local ONNX model (`all-MiniLM-L6-v2`) generates a 384-dimensional vector embedding — no API key required
4. **Storage**: Raw text, classification, entities, and embedding are stored in the Memory table with HNSW vector indexing
5. **Retrieval**: Any MCP-connected AI client queries the Memory table using hybrid search (vector similarity + attribute filters). Results include normalized similarity scores (0-1) and can be filtered by `agentId` for multi-agent isolation

### Synapse: coding context (CLI / API)

1. **Ingest**: `synapse sync` reads your tool context files (CLAUDE.md, `.cursor/rules/`, `.windsurf/rules/`, `copilot-instructions.md`) and POSTs them to `/SynapseIngest`
2. **Parse**: Each source format is split into discrete entries; duplicate content is deduplicated via content hash
3. **Classify + embed**: Each entry is classified into a type (`intent`, `constraint`, `artifact`, `history`) and embedded locally with `all-MiniLM-L6-v2`
4. **Storage**: Entries are stored in the SynapseEntry table with HNSW vector indexing, scoped by `projectId`
5. **Retrieval**: `synapse search` or any MCP client queries `/SynapseSearch`; `synapse emit` formats entries back into any target tool's native format

## Supported Integrations

This repo ships with Slack + Anthropic + local ONNX embeddings as the default stack. The architecture is designed to be swappable — add a new webhook resource class for any ingestion source, or change the LLM/embedding provider in `resources.js`.

### Ingestion Sources

The system ingests data via webhooks. Add new sources by creating a new Resource class following the same pattern as `SlackWebhook`.

| Platform            | Webhook Support           | Good For                                           |
| ------------------- | ------------------------- | -------------------------------------------------- |
| **Slack**           | Events API                | Team conversations, decisions, standups (included) |
| **GitHub**          | Webhooks                  | Issues, PRs, code reviews, commit messages         |
| **Linear**          | Webhooks                  | Task tracking, sprint decisions, bug reports       |
| **Jira**            | Webhooks                  | Project management, issue tracking                 |
| **Notion**          | API polling               | Wiki pages, meeting notes, documentation           |
| **Discord**         | Gateway / Webhooks        | Community discussions, support threads             |
| **Google Drive**    | Push notifications        | Shared docs, spreadsheets, presentations           |
| **Email**           | Forwarding / SMTP webhook | Client communications, vendor threads              |
| **Microsoft Teams** | Webhooks                  | Enterprise team conversations                      |

### Classification LLMs

Configure the classification provider via environment variables (`CLASSIFICATION_PROVIDER`, `CLASSIFICATION_API_KEY`, `CLASSIFICATION_MODEL`, `CLASSIFICATION_BASE_URL`). The provider-agnostic classification system in `resources/classification-provider.js` supports 6 backends. If no provider is configured, classification is skipped and memories are stored with `classification: null`.

| Provider                   | `CLASSIFICATION_PROVIDER` | Recommended Model | Trade-off                                      |
| -------------------------- | ------------------------- | ----------------- | ---------------------------------------------- |
| **Anthropic** (default)    | `anthropic`               | Claude Haiku 3.5  | Best structured JSON output                    |
| **OpenAI**                 | `openai`                  | GPT-4o-mini       | Cheapest, fast, good at JSON                   |
| **Google**                 | `google`                  | Gemini 2.0 Flash  | Generous free tier                             |
| **Ollama** (local)         | `ollama`                  | Llama 3 / Mistral | Full privacy, no API costs, requires local GPU |
| **OpenAI-compatible**      | `openai-compatible`       | Any               | For vLLM, Together, Fireworks, etc.            |
| **Local keyword fallback** | `local`                   | N/A               | No LLM needed, pattern-based classification    |

### Embedding Providers

The default embedding model can be changed via the `EMBEDDING_MODEL` environment variable (see `resources/shared.js`). If you change the vector dimensions, re-embed all existing records.

| Provider                      | Recommended Model      | Dimensions | Trade-off                        |
| ----------------------------- | ---------------------- | ---------- | -------------------------------- |
| **@huggingface/transformers** | all-MiniLM-L6-v2       | 384        | Local ONNX, no API key (default) |
| **Voyage AI**                 | voyage-3               | 1024       | High quality, requires API key   |
| **OpenAI**                    | text-embedding-3-small | 1536       | Most widely adopted              |
| **Cohere**                    | embed-v4               | 1024       | Strong multilingual support      |
| **Ollama** (local)            | nomic-embed-text       | 768        | Full privacy, zero API cost      |

### MCP Clients (Retrieval)

Any MCP-compliant AI client can connect to the Harper MCP Server and query your memory pool.

| Client                | Status                                        |
| --------------------- | --------------------------------------------- |
| **Claude Desktop**    | Fully supported (default)                     |
| **Cursor**            | Fully supported (same MCP config)             |
| **Windsurf**          | MCP-compatible                                |
| **Claude Code** (CLI) | MCP-compatible                                |
| **Any MCP client**    | Open standard - works with any compliant tool |

## Synapse: Universal Context Broker

Synapse extends Cortex into a **Universal Context Broker** — a system that bridges context across AI development tools. When you switch from Claude Code to Cursor, or add a new team member, the "Why" behind architectural decisions is normally lost. Synapse captures it.

```
  INGEST (Tool → Harper)              EMIT (Harper → Tool)

  CLAUDE.md ──────┐                  ┌──▶ CLAUDE.md / SYNAPSE.md
  .cursor/rules/ ─┤  ┌────────────┐  ├──▶ .cursor/rules/*.mdc
  .windsurf/     ─┤─▶│  Synapse   │  ├──▶ .windsurf/rules/*.md
  copilot-inst.  ─┤  │  Ingest    │  └──▶ copilot-instructions.md
  Manual / Slack ─┘  └─────┬──────┘
                            │               ┌──────────────────┐
                    ┌───────▼────────┐      │   SynapseEmit    │
                    │ SynapseEntry   │◀─────│   query → format │
                    │ (HNSW indexed) │      └──────────────────┘
                    └───────┬────────┘
                            │ MCP JSON-RPC
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
       Claude Desktop    Cursor    Any MCP Client
```

### Context Types

| Type         | Purpose             | Example                                            |
| ------------ | ------------------- | -------------------------------------------------- |
| `intent`     | The "Why"           | "Chose HarperDB for HNSW vector search"            |
| `constraint` | Must/Must-Not rules | "Never use an ORM — raw SQL only"                  |
| `artifact`   | References          | "Architecture diagram at docs/arch.png"            |
| `history`    | Failed paths        | "Tried Redis Streams, abandoned due to durability" |

### Synapse CLI

```bash
# Install globally after cloning
npm install -g .

# Sync your context files to Cortex
SYNAPSE_PROJECT=my-app synapse sync

# Search across all context
SYNAPSE_PROJECT=my-app synapse search "why did we choose postgres"

# Emit context in Cursor's native format (writes .mdc files)
SYNAPSE_PROJECT=my-app synapse emit --target cursor --write

# Watch context files and auto-sync on change
SYNAPSE_PROJECT=my-app synapse watch

# Show entry counts by type and source
SYNAPSE_PROJECT=my-app synapse status
```

### Synapse API Endpoints

| Endpoint         | Method | Description                                                           |
| ---------------- | ------ | --------------------------------------------------------------------- |
| `/SynapseIngest` | POST   | Ingest context from any tool. Parses, classifies, embeds, and stores. |
| `/SynapseSearch` | POST   | Semantic search scoped to a project.                                  |
| `/SynapseEmit`   | POST   | Emit context formatted for a target tool.                             |
| `/SynapseEntry/` | GET    | List/browse all context entries.                                      |

See [docs/synapse-design.md](docs/synapse-design.md) for full architecture details.

## Client Libraries & Integrations

Official packages for integrating with Cortex from your applications:

| Package                           | Description                                                                                                                                                  | Repo                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **@harperfast/cortex-client**     | Lightweight HTTP-only TypeScript client. Zero dependencies, dual ESM/CJS. Flair-style namespaced API (`client.memory.search`, `client.synapse.ingest`, etc.) | [HarperFast/cortex-client](https://github.com/HarperFast/cortex-client)         |
| **@langchain/harper**             | LangChain.js VectorStore and Retriever backed by Cortex. Drop-in integration for any LangChain RAG pipeline.                                                 | [HarperFast/langchain-harper](https://github.com/HarperFast/langchain-harper)   |
| **@harper/openclaw-memory**       | OpenClaw/NemoClaw memory plugin. Auto-recall and auto-capture lifecycle hooks, remember/recall/forget/count agent tools.                                     | [HarperFast/openclaw-memory](https://github.com/HarperFast/openclaw-memory)     |
| **@harperfast/cortex-mcp-server** | Remote MCP server exposing Cortex to Claude, Cursor, Windsurf. 7 standard tools + 6 admin tools. Standalone or Harper deployment modes.                      | [HarperFast/cortex-mcp-server](https://github.com/HarperFast/cortex-mcp-server) |

## Agent Skills

This project uses [Harper Agent Skills](https://github.com/harperfast/skills) — reusable AI agent instructions that guide Claude and other AI tools to follow Harper best practices when contributing code. Skills are tracked in `skills-lock.json` and installed into `.agents/skills/` (excluded from version control).

### Installed Skills

| Skill                   | Description                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `harper-best-practices` | Schema design, automatic APIs, authentication, custom resources, caching, vector indexing, and deployment patterns for Harper applications |

AI agents (Claude Code, Cursor, etc.) load skills automatically from `.agents/skills/` and apply the relevant guidelines when making changes to the codebase.

## License

MIT
