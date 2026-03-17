# Architecture

## Data Flow

```
  INGESTION SOURCES                  INGESTION LAYER
┌─────────────────┐
│  Slack          │ ──▶ ┌─────────────────────────────────────┐
│  Events API     │     │  Webhook Resource                   │
└─────────────────┘     │  (e.g. SlackWebhook)                │
                        │                                     │
┌─────────────────┐     │  1. Verify signature                │
│  GitHub         │ ──▶ │  2. Filter bots/dupes               │
│  Webhooks       │     │  3. Return 200 immediately          │
└─────────────────┘     │  4. Async process:                  │
                        │                                     │
┌─────────────────┐     │     ┌─────────────────────────┐    │
│  Linear         │ ──▶ │     │ classifyMsg (Claude API) │    │
│  Webhooks       │     │     └────────────┬────────────┘    │
└─────────────────┘     │     ┌────────────▼────────────┐    │
                        │     │ genEmbedding (ONNX local) │    │
┌─────────────────┐     │     └────────────┬────────────┘    │
│  Other Sources  │ ──▶ │     ┌────────────▼────────────┐    │
│  (Discord, etc) │     │     │      Memory.put()        │    │
└─────────────────┘     │     └─────────────────────────┘    │
                        └──────────────────┬──────────────────┘
                                           │
                                  ┌────────▼─────────┐
                                  │   Memory Table   │
                                  │   (HNSW index)   │
                                  └────────┬─────────┘
                                           │
                                  ┌──────────────────┐
  QUERY LAYER                    │  Harper MCP      │
                                 │  Server (/mcp)   │
┌─────────────────┐              │                  │
│  Claude Desktop │ ◀──────────▶ │  resources/list  │
└─────────────────┘              │  resources/read  │
                     MCP         │                  │
┌─────────────────┐  JSON-RPC    │                  │
│  Cursor         │ ◀──────────▶ │                  │
└─────────────────┘              │                  │
                                 │                  │
┌─────────────────┐              │                  │
│  Other MCP      │ ◀──────────▶ │                  │
│  Clients        │              └──────────────────┘
└─────────────────┘
```

## Memory Table Schema

| Field            | Type       | Indexed     | Purpose                                       |
| ---------------- | ---------- | ----------- | --------------------------------------------- |
| `id`             | ID         | Primary Key | Unique identifier                             |
| `rawText`        | String     | No          | Original message text                         |
| `source`         | String     | Yes         | Platform (e.g., "slack")                      |
| `sourceType`     | String     | Yes         | Content type (message, thread_reply)          |
| `channelId`      | String     | Yes         | Slack channel ID                              |
| `channelName`    | String     | No          | Human-readable channel name                   |
| `authorId`       | String     | Yes         | Slack user ID                                 |
| `authorName`     | String     | No          | Human-readable author name                    |
| `classification` | String     | Yes         | LLM category (decision, action_item, etc.)    |
| `entities`       | Any (JSON) | No          | Extracted entities (people, projects, tech)   |
| `embedding`      | [Float]    | HNSW/cosine | 384-dim vector from all-MiniLM-L6-v2 (local)  |
| `summary`        | String     | No          | LLM-generated one-line summary                |
| `timestamp`      | Date       | Yes         | When the original message was sent            |
| `threadTs`       | String     | No          | Slack thread timestamp for grouping           |
| `metadata`       | Any (JSON) | No          | Extra data (team_id, event_id, model version) |

## Classification Categories

| Category        | Description                             |
| --------------- | --------------------------------------- |
| `decision`      | Team made a choice or reached consensus |
| `action_item`   | Task assigned or committed to           |
| `knowledge`     | Technical explanation or insight shared |
| `question`      | Someone asked for help or information   |
| `announcement`  | News, update, or broadcast              |
| `discussion`    | General conversation or debate          |
| `reference`     | Link, doc, or resource shared           |
| `status_update` | Progress report or standup update       |
| `feedback`      | Review, suggestion, or critique         |

## Search: Hybrid Approach

The `MemorySearch` endpoint combines two search strategies:

1. **Vector similarity**: Compares the query embedding against stored embeddings using cosine distance (HNSW index)
2. **Attribute filtering**: Narrows results by classification, source, channel, or author

This hybrid approach gives better results than pure vector search alone.

## Synapse: Universal Context Broker

Synapse adds a second data layer alongside Memory — the `SynapseEntry` table — for storing structured development context from AI tool rule files.

```
  INGEST                           SYNAPSE LAYER                     EMIT
┌──────────────────┐
│ CLAUDE.md        │ ──▶ ┌──────────────────────────────────────┐ ──▶ CLAUDE.md
│ .cursor/rules/   │     │  SynapseIngest                       │ ──▶ .cursor/*.mdc
│ .windsurf/rules/ │     │  1. Parse (tool-specific parser)     │ ──▶ .windsurf/*.md
│ copilot-inst.    │     │  2. Classify (Claude Haiku)          │ ──▶ copilot-inst.
│ manual / slack   │     │  3. Embed (ONNX local)               │
└──────────────────┘     │  4. Store → SynapseEntry             │
                         └──────────────────┬───────────────────┘
                                            │
                               ┌────────────▼─────────────┐
                               │   SynapseEntry Table     │
                               │   HNSW vector index      │
                               │                          │
                               │   Types:                 │
                               │     intent | constraint  │
                               │     artifact | history   │
                               └────────────┬─────────────┘
                                            │
                               ┌────────────▼─────────────┐
                               │   SynapseSearch          │
                               │   (semantic query,       │
                               │    scoped by projectId)  │
                               └────────────┬─────────────┘
                                            │ MCP JSON-RPC
              ┌─────────────────────────────┼──────────────────────────┐
              ▼                             ▼                          ▼
       Claude Desktop                    Cursor                Any MCP Client
```

### SynapseEntry Schema

| Field          | Type     | Indexed     | Purpose                                                           |
| -------------- | -------- | ----------- | ----------------------------------------------------------------- |
| `id`           | ID       | Primary Key | Unique identifier                                                 |
| `projectId`    | String   | Yes         | Scopes entries to a project                                       |
| `type`         | String   | Yes         | `intent \| constraint \| artifact \| history`                     |
| `content`      | String   | No          | Full context text                                                 |
| `source`       | String   | Yes         | `claude_code \| cursor \| windsurf \| copilot \| manual \| slack` |
| `sourceFormat` | String   | No          | `markdown \| mdc \| json`                                         |
| `embedding`    | [Float]  | HNSW/cosine | 384-dim vector from all-MiniLM-L6-v2 (local)                      |
| `summary`      | String   | No          | LLM one-liner                                                     |
| `status`       | String   | Yes         | `active \| superseded \| archived`                                |
| `references`   | [String] | No          | Memory record IDs this traces back to                             |
| `tags`         | [String] | No          | Freeform labels                                                   |
| `entities`     | Any      | No          | `{ people, projects, technologies, topics }`                      |
| `parentId`     | String   | Yes         | Self-referential: constraint → intent                             |
| `createdAt`    | Date     | Yes         | Creation timestamp                                                |
| `updatedAt`    | Date     | Yes         | Last update timestamp                                             |
| `metadata`     | Any      | No          | Tool-specific data (filePath, globs, etc.)                        |

## Extensibility

The system is designed to be swappable at each layer:

- **Ingestion**: Add new webhook Resource classes for any platform (GitHub, Linear, Notion, Discord, etc.) following the `SlackWebhook` pattern. Each source writes to the same `Memory` table with `source` set to the platform name.
- **Classification LLM**: Swap `CLASSIFICATION_MODEL` and the SDK in `resources.js`. The classification prompt and JSON schema are provider-agnostic.
- **Embedding provider**: Swap `generateEmbedding()`. If you change vector dimensions, all existing records must be re-embedded.
- **MCP clients**: Any MCP-compliant tool connects to the same `/mcp` endpoint. No per-client configuration needed on the server side.
