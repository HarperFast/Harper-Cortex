# Harper Cortex

A persistent, agent-agnostic AI memory system powered by [Harper Fabric](https://harper.fast). Clone, configure your API keys, deploy, and give all your AI tools a shared brain.

## The Problem

When you use Claude, ChatGPT, or Cursor, your conversation history and learned context are siloed inside each platform. Switch tools, and your AI gets amnesia. This is **context rot**.

## The Solution

Deploy a centralized vector database on Harper Fabric and connect it to your AI agents via [MCP (Model Context Protocol)](https://modelcontextprotocol.io). All your tools read and write to the same unified memory pool.

```
Slack / GitHub / Linear / ...  ──webhook──▶  Harper Fabric  ◀──MCP──▶  Claude Desktop / Cursor / ...
                                              (vector DB)
```

## Architecture

```
INGESTION SOURCES              HARPER FABRIC CLUSTER
┌──────────────┐
│ Slack        │ ──▶ ┌───────────────────────────────────────────┐
│ Events API   │     │  Webhook Resource (e.g. SlackWebhook)     │
└──────────────┘     │                                           │
                     │  classify (Claude) + embed (Voyage AI)    │
┌──────────────┐     │              │                            │
│ GitHub       │ ──▶ │  ┌───────────▼──────────────────────────┐ │
│ Webhooks     │     │  │  Memory Table (HNSW vector index)    │ │
└──────────────┘     │  └───────────┬──────────────────────────┘ │
                     │              │                            │
┌──────────────┐     │  ┌───────────▼──────────────────────────┐ │
│ Linear / ... │ ──▶ │  │  MCP Server + MemorySearch endpoint  │ │
└──────────────┘     │  └───────────┬──────────────────────────┘ │
                     └─────────────┼─────────────────────────────┘
                                   │ MCP JSON-RPC
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       Claude Desktop           Cursor           Any MCP Client
```

## Prerequisites

- **Node.js** 20+ (recommended: 24 LTS)

## Quick Start

### 1. Sign up for Harper Fabric

Create your free cluster at [fabric.harper.fast](https://fabric.harper.fast):

1. Create an account and verify your email
2. Create an organization
3. Create a cluster (free tier, no credit card required)
4. Note your **cluster URL**, **username**, and **password**

### 2. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/HarperCortex.git
cd HarperCortex
npm install -g harperdb   # Install the Harper runtime (one-time)
npm install               # Install project dependencies
```

### 3. Create your API accounts

Sign up for these services and grab your API keys. All have free tiers.

| Service | Sign Up | What You Need |
|---------|---------|---------------|
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com/) | API key (used for message classification) |
| **Voyage AI** | [dash.voyageai.com](https://dash.voyageai.com/) | API key (used for vector embeddings) |
| **Slack** | [api.slack.com/apps](https://api.slack.com/apps) | Create a Slack app. See [docs/slack-app-setup.md](docs/slack-app-setup.md) for the full walkthrough. |

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

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude (message classification) |
| `VOYAGE_API_KEY` | Yes | Voyage AI API key (vector embedding generation) |
| `SLACK_SIGNING_SECRET` | For Slack | Slack app signing secret (webhook verification) |
| `SLACK_BOT_TOKEN` | For Slack | Slack bot user OAuth token (`xoxb-...`) |
| `CLI_TARGET` | For deploy | Harper Fabric cluster URL (e.g., `https://cluster.org.harperfabric.com`) |
| `CLI_TARGET_USERNAME` | For deploy | Harper cluster admin username |
| `CLI_TARGET_PASSWORD` | For deploy | Harper cluster admin password |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/SlackWebhook` | POST | Receives Slack Events API payloads. Classifies, embeds, and stores messages. |
| `/MemorySearch` | POST | Semantic search. Send `{ "query": "...", "limit": 10, "filters": {} }` |
| `/Memory/` | GET | List all memories (with pagination) |
| `/Memory/{id}` | GET | Get a single memory by ID |

### MemorySearch Request

```json
{
  "query": "Why did we change the caching strategy?",
  "limit": 10,
  "filters": {
    "classification": "decision",
    "source": "slack",
    "channelId": "C0123456",
    "authorId": "U0123456"
  }
}
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Harper locally for development |
| `npm run deploy` | Deploy to Harper Fabric |
| `npm test` | Run all tests |
| `npm start` | Start Harper in production mode |

## Testing

```bash
npm test
```

Tests use Node.js built-in test runner with module mocking. No extra test dependencies required.

## Project Structure

```
├── config.yaml         # Harper application configuration
├── schema.graphql      # Database schema (Memory table with HNSW vector index)
├── resources.js        # Core application logic (webhook, search, table extension)
├── package.json        # Dependencies and scripts
├── .env.example        # Environment variable template
├── .nvmrc              # Node.js version
├── test/               # Test suite
│   ├── classify.test.js
│   ├── embedding.test.js
│   ├── webhook.test.js
│   └── search.test.js
└── docs/               # Guides
    ├── architecture.md
    ├── slack-app-setup.md
    └── mcp-setup.md
```

## How It Works

1. **A source sends an event** via webhook (e.g. Slack message, GitHub issue, Linear task)
2. **Classification**: Claude Haiku categorizes the content (decision, action_item, knowledge, etc.) and extracts entities (people, projects, technologies)
3. **Embedding**: Voyage AI generates a 1024-dimensional vector embedding
4. **Storage**: Raw text, classification, entities, and embedding are stored in the Memory table with HNSW vector indexing
5. **Retrieval**: Any MCP-connected AI client queries the Memory table using hybrid search (vector similarity + attribute filters)

## Supported Integrations

This repo ships with Slack + Anthropic + Voyage AI as the default stack. The architecture is designed to be swappable - add a new webhook resource class for any ingestion source, or change the LLM/embedding provider in `resources.js`.

### Ingestion Sources

The system ingests data via webhooks. Add new sources by creating a new Resource class following the same pattern as `SlackWebhook`.

| Platform | Webhook Support | Good For |
|----------|----------------|----------|
| **Slack** | Events API | Team conversations, decisions, standups (included) |
| **GitHub** | Webhooks | Issues, PRs, code reviews, commit messages |
| **Linear** | Webhooks | Task tracking, sprint decisions, bug reports |
| **Jira** | Webhooks | Project management, issue tracking |
| **Notion** | API polling | Wiki pages, meeting notes, documentation |
| **Discord** | Gateway / Webhooks | Community discussions, support threads |
| **Google Drive** | Push notifications | Shared docs, spreadsheets, presentations |
| **Email** | Forwarding / SMTP webhook | Client communications, vendor threads |
| **Microsoft Teams** | Webhooks | Enterprise team conversations |

### Classification LLMs

Swap the classification model by changing `CLASSIFICATION_MODEL` in `resources.js` and updating the SDK import.

| Provider | Recommended Model | Trade-off |
|----------|-------------------|-----------|
| **Anthropic** | Claude Haiku 3.5 | Best structured JSON output (default) |
| **OpenAI** | GPT-4o-mini | Cheapest, fast, good at JSON |
| **Google** | Gemini 2.0 Flash | Generous free tier |
| **Ollama** (local) | Llama 3 / Mistral | Full privacy, no API costs, requires local GPU |

### Embedding Providers

Swap the embedding provider by changing `generateEmbedding()` in `resources.js`. If you change the vector dimensions, re-embed all existing records.

| Provider | Recommended Model | Dimensions | Trade-off |
|----------|-------------------|------------|-----------|
| **Voyage AI** | voyage-3 | 1024 | Anthropic-recommended (default) |
| **OpenAI** | text-embedding-3-small | 1536 | Most widely adopted |
| **Cohere** | embed-v4 | 1024 | Strong multilingual support |
| **Ollama** (local) | nomic-embed-text | 768 | Full privacy, zero API cost |

### MCP Clients (Retrieval)

Any MCP-compliant AI client can connect to the Harper MCP Server and query your memory pool.

| Client | Status |
|--------|--------|
| **Claude Desktop** | Fully supported (default) |
| **Cursor** | Fully supported (same MCP config) |
| **Windsurf** | MCP-compatible |
| **Claude Code** (CLI) | MCP-compatible |
| **Any MCP client** | Open standard - works with any compliant tool |

## License

MIT
