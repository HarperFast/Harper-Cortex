# Harper Vector Memory System

A persistent, agent-agnostic AI memory system powered by [Harper Fabric](https://harper.fast). Clone, configure your API keys, deploy, and give all your AI tools a shared brain.

## The Problem

When you use Claude, ChatGPT, or Cursor, your conversation history and learned context are siloed inside each platform. Switch tools, and your AI gets amnesia. This is **context rot**.

## The Solution

Deploy a centralized vector database on Harper Fabric and connect it to your AI agents via [MCP (Model Context Protocol)](https://modelcontextprotocol.io). All your tools read and write to the same unified memory pool.

```
Slack Messages ──webhook──▶ Harper Fabric ◀──MCP──▶ Claude Desktop
                           (vector DB)              (or Cursor, etc.)
```

## Architecture

```
┌─────────────┐     POST     ┌──────────────────────────────────────┐
│   Slack      │ ──────────▶ │  Harper Fabric Cluster               │
│   Events API │             │                                      │
└─────────────┘             │  ┌─────────────┐  ┌───────────────┐  │
                             │  │ SlackWebhook │  │ MemorySearch  │  │
                             │  │ (classify +  │  │ (hybrid       │  │
                             │  │  embed +     │  │  vector +     │  │
                             │  │  store)      │  │  tag search)  │  │
                             │  └──────┬───────┘  └───────────────┘  │
                             │         │                              │
                             │  ┌──────▼───────────────────────────┐ │
                             │  │ Memory Table (HNSW vector index) │ │
                             │  └──────────────────────────────────┘ │
                             │                                      │
                             │  ┌──────────────────────────────────┐ │
                             │  │ MCP Server (/mcp endpoint)       │ │
                             │  └──────────────┬───────────────────┘ │
                             └─────────────────┼────────────────────┘
                                               │
                              ┌─────────────────▼──────────────────┐
                              │  Claude Desktop / Cursor / Any     │
                              │  MCP-compliant AI client           │
                              └────────────────────────────────────┘
```

## Prerequisites

- **Node.js** 20+ (recommended: 24 LTS)

## Quick Start

### 1. Create your accounts

Sign up for these services and grab your API keys. All have free tiers.

| Service | Sign Up | What You Need |
|---------|---------|---------------|
| **Harper Fabric** | [fabric.harper.fast](https://fabric.harper.fast) | Create an account, organization, and cluster. Note your cluster URL, username, and password. |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com/) | Get an API key (used for message classification) |
| **Voyage AI** | [dash.voyageai.com](https://dash.voyageai.com/) | Get an API key (used for vector embeddings) |
| **Slack** | [api.slack.com/apps](https://api.slack.com/apps) | Create a Slack app. See [docs/slack-app-setup.md](docs/slack-app-setup.md) for the full walkthrough. |

### 2. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/HarperVectorMemorySystem.git
cd HarperVectorMemorySystem
npm install -g harperdb   # Install the Harper runtime (one-time)
npm install               # Install project dependencies
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and paste in the API keys and cluster credentials from Step 1. See [Environment Variables](#environment-variables) for details on each variable.

### 4. Run locally

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

### 5. Deploy to Harper Fabric

```bash
npm run deploy
```

Once deployed, update your Slack Events API request URL to point at your cluster: `https://your-cluster.harperfabric.com/SlackWebhook`

### 6. Connect Claude Desktop via MCP

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

1. **Slack sends a message** via webhook to `/SlackWebhook`
2. **Classification**: Claude Haiku categorizes the message (decision, action_item, knowledge, etc.) and extracts entities (people, projects, technologies)
3. **Embedding**: Voyage AI generates a 1024-dimensional vector embedding
4. **Storage**: Raw text, classification, entities, and embedding are stored in the Memory table with HNSW vector indexing
5. **Retrieval**: Any MCP-connected AI client queries the Memory table using hybrid search (vector similarity + attribute filters)

## License

MIT
