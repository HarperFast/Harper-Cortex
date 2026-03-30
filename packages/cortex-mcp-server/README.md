# @harperfast/cortex-mcp-server

A remote MCP (Model Context Protocol) server that exposes [Harper Cortex](https://github.com/HarperFast/Cortex) memory and development context as tools to Claude, Cursor, Windsurf, Copilot, and any MCP-compatible client.

This is the lowest-friction entry point into the Harper ecosystem. Users can add persistent, distributed memory to any AI tool by pointing it at a public URL — no local installation, no CLI, no code required.

## Features

- **Persistent Memory** — Store and retrieve facts, decisions, and context using semantic search
- **Multi-Client Support** — Works with Claude (web, desktop, mobile), Claude Code, Cursor, Windsurf, Copilot, and any MCP-compatible client
- **Server-Side Embeddings** — No API keys needed on the client; Cortex handles all embedding with ONNX
- **Multi-Agent Sharing** — Share memory across agents and users with namespace isolation
- **Self-Hosted** — Deploy on your own infrastructure or Harper Cloud
- **Production-Ready** — Real database with ACID guarantees, no local files or SQLite limitations

## Quick Start

### 1. Claude Desktop / Claude.ai

1. Open Settings → Connectors → Add custom connector
2. Enter the URL: `https://my-instance.harpercloud.com/mcp`
3. (Optional) Authenticate with Bearer token if required
4. You now have persistent memory tools available in Claude

### 2. Claude Code

```bash
# Add it as an MCP server (use port 9926 for Harper Fabric REST endpoints)
claude mcp add cortex -- npx @harperfast/cortex-mcp-server \
  --url https://my-instance.harperfabric.com:9926 \
  --token "user@example.com:password"
```

> **Port note:** Harper Fabric exposes custom resource endpoints (MemorySearch, MemoryStore, etc.) on port **9926**. Port 9925 is the operations API and will return 404 for MCP requests.

### 3. Cursor / Windsurf

Add to your MCP configuration file (`.cursor/mcp.json` or similar):

```json
{
	"mcpServers": {
		"cortex": {
			"url": "https://my-instance.harpercloud.com/mcp",
			"env": {
				"CORTEX_TOKEN": "your-bearer-token"
			}
		}
	}
}
```

### 4. Local Development

```bash
# Clone the repo
git clone https://github.com/HarperFast/cortex-mcp-server.git
cd cortex-mcp-server

# Install dependencies
npm install

# Start in HTTP mode
npm run dev

# Or use npx directly
npx @harperfast/cortex-mcp-server --url https://my-cortex.harpercloud.com --port 3000
```

## Configuration

### Environment Variables

- `CORTEX_URL` (required) — URL of your Cortex instance (e.g., `https://my-instance.harpercloud.com`)
- `CORTEX_TOKEN` (optional) — Bearer token for authentication
- `CORTEX_SCHEMA` (optional) — Schema name in Cortex (default: `data`)
- `PORT` (optional) — Port to listen on for HTTP server (default: `3000`)
- `HOST` (optional) — Host to bind to (default: `0.0.0.0`)
- `AUTH_REQUIRED` (optional) — Require authentication (default: `true`)
- `HTTP_SERVER` (optional) — Use HTTP transport instead of stdio (default: `false`)
- `MULTI_TENANT` (optional) — Set to "true" to enable multi-tenant mode (JWT auth, namespace enforcement, rate limiting)
- `JWKS_URL` (optional) — JWKS endpoint for JWT validation (required in multi-tenant mode)
- `ADMIN_TOKEN` (optional) — Static token for admin API access

### Command-Line Arguments

```bash
cortex-mcp-server \
  --url https://my-cortex.harpercloud.com \
  --token your-bearer-token \
  --port 3000 \
  --host localhost \
  --no-auth \
  --multi-tenant \
  --jwks-url <url> \
  --admin-token <token>
```

**WARNING:** Running with `--no-auth` exposes all memory data without authentication. Only use in isolated development environments.

## Available Tools

### Standard Tools (always available)

| Tool             | Description                            | Input                                                        | Output                         |
| ---------------- | -------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| `memory_search`  | Search memories by semantic similarity | `query`, `limit?`, `filters?`                                | Results with similarity scores |
| `memory_store`   | Store a new memory                     | `text`, `source?`, `classification?`, `metadata?`            | Memory ID and timestamp        |
| `memory_recall`  | Retrieve a specific memory by ID       | `id`                                                         | Full memory record             |
| `memory_forget`  | Delete a memory                        | `id`                                                         | Deletion confirmation          |
| `memory_count`   | Count stored memories                  | `filters?`                                                   | Total count                    |
| `synapse_search` | Search development context             | `query`, `projectId`, `limit?`, `filters?`                   | Context entries with scores    |
| `synapse_ingest` | Ingest context from a tool             | `source`, `content`, `projectId`, `parentId?`, `references?` | Stored entries and count       |

### Admin Tools (multi-tenant mode only)

| Tool                  | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `admin_create_tenant` | Create a new tenant with namespace and security policy |
| `admin_list_tenants`  | List all tenants, optionally filtered by status        |
| `admin_get_tenant`    | Get details for a specific tenant                      |
| `admin_update_tenant` | Update tenant name, tier, status, or quotas            |
| `admin_issue_token`   | Generate JWT claims for a tenant                       |
| `admin_revoke_token`  | Revoke a specific JWT token                            |

## Usage Examples

### In Claude

```
You: "Remember that we use event-driven architecture for our order service"
Claude: [Uses memory_store] "Stored. I've saved that your order service uses event-driven architecture."

You: "What's the architecture for the order service?"
Claude: [Uses memory_search] "Based on our notes, your order service uses event-driven architecture."
```

### In Claude Code or Cursor

When ingesting context from your codebase:

```
[Claude/Cursor detects you're working on authentication]
[Uses synapse_ingest] Stores: "Intent: Implement JWT-based auth"

Later:
[Uses synapse_search] Retrieves: "Previous decision: JWT-based auth with 24h expiry"
```

## Deployment Options

### Option 1: Standalone (npx)

```bash
npx @harperfast/cortex-mcp-server --url https://my-cortex.harpercloud.com --port 3000
```

Runs on any Node.js host (VPS, laptop, container orchestration).

### Option 2: Docker

```bash
# Build
docker build -t cortex-mcp-server:latest .

# Run
docker run \
  -e CORTEX_URL=https://my-cortex.harpercloud.com \
  -e CORTEX_TOKEN=your-token \
  -p 3000:3000 \
  cortex-mcp-server:latest
```

### Option 3: Harper Cloud (Custom Functions)

Deploy directly on Harper:

```bash
harper deploy cortex-mcp-server
```

The MCP server runs in the same instance as your Cortex data, with zero additional infrastructure.

### Option 4: Docker Compose

```yaml
version: '3.8'
services:
  cortex-mcp:
    image: harperfast/cortex-mcp-server:latest
    environment:
      CORTEX_URL: https://my-cortex.harpercloud.com
      CORTEX_TOKEN: ${CORTEX_TOKEN}
      PORT: 3000
    ports:
      - "3000:3000"
    restart: unless-stopped
```

## Authentication

The server supports two authentication modes:

**Basic Auth (Harper Fabric):** Pass credentials as `user:password` via `--token` or `CORTEX_TOKEN`. The server automatically Base64-encodes them for HTTP Basic Auth:

```bash
cortex-mcp-server --url https://my-cortex.harperfabric.com:9926 --token "user@example.com:password"
```

**Bearer Auth:** Pass a pre-formatted Bearer token:

```bash
cortex-mcp-server --url https://my-cortex.harpercloud.com --token "Bearer eyJhbG..."
```

In multi-tenant setups, include the user ID in the token:

```
Authorization: Bearer user-123:secret-token
```

The server extracts `user-123` and scopes all memory operations to that user's namespace.

**Auth Layering:** Cortex relies on Harper/Fabric platform authentication. Ensure `authentication.requireAuthentication` is enabled in your Harper config to enforce security at the instance level.

## Architecture

```
┌─────────────────────────────────────┐
│  Claude / Cursor / Windsurf / etc.  │
│  (MCP-compatible client)            │
└────────────┬────────────────────────┘
             │
             │ Streamable HTTP or Stdio
             │ MCP Protocol
             │
┌────────────▼────────────────────────┐
│  cortex-mcp-server                  │
│                                     │
│  ├─ memory_search                   │
│  ├─ memory_store                    │
│  ├─ memory_recall                   │
│  ├─ memory_forget                   │
│  ├─ memory_count                    │
│  ├─ synapse_search                  │
│  └─ synapse_ingest                  │
└────────────┬────────────────────────┘
             │
             │ HTTP + Bearer auth
             │ @harperfast/cortex-client
             │
┌────────────▼────────────────────────┐
│  Harper Cortex                      │
│  (Memory + Synapse database)        │
│                                     │
│  ├─ Vector Search (ONNX)            │
│  ├─ Metadata Filtering              │
│  ├─ Multi-agent Namespaces          │
│  └─ ACID Transactions               │
└─────────────────────────────────────┘
```

## Development

### Build from source

```bash
git clone https://github.com/HarperFast/cortex-mcp-server.git
cd cortex-mcp-server

npm install
npm run build
```

### Run tests

```bash
npm test
```

### Local development with live reload

```bash
npm run dev
```

This starts the server in HTTP mode with hot reload. By default, it connects to `http://localhost:8000` for Cortex.

## Troubleshooting

### "Connection refused" or 404 errors

- Check that `CORTEX_URL` is correct and the Cortex instance is running
- **Harper Fabric users:** Use port **9926** (REST endpoints), not 9925 (operations API)
- Verify network connectivity: `curl https://my-cortex.harperfabric.com:9926/MemoryCount -X POST -H "Content-Type: application/json" -d '{}'`

### "Authentication failed" or "Invalid character" error

- Ensure `CORTEX_TOKEN` is set correctly if your Cortex instance requires auth
- For Harper Fabric, use `user:password` format — the server handles Base64 encoding automatically
- If passing a pre-formatted header, prefix with `Basic ` or `Bearer ` (e.g., `Basic dXNlcjpwYXNz`)
- Check that the token hasn't expired

### Memory not persisting

- Verify Cortex is using a persistent database (not in-memory)
- Check that the `CORTEX_SCHEMA` matches your Cortex configuration

### Tool not appearing in client

- Restart your MCP client after deploying a new version
- Check that the server is running and reachable: `curl http://localhost:3000/health`

### MCP connection fails silently

If the MCP connection fails, Claude may silently fall back to local file-based memory. Verify the connection is active by:

```bash
curl http://localhost:3000/mcp/health
```

Or use Claude's built-in diagnostic:

```
/mcp
```

This shows all connected MCP servers and their status.

## API Reference

For detailed API specifications, see [cortex-client](../cortex-client/).

## Data Handling & Compliance

Operators are responsible for ensuring **Prohibited Data** (PII, PHI, government IDs) is not stored unless covered by their Harper Order. This is specified in PaaS ToS Section 3.3.

All memory storage operations are protected by content sanitization that detects and blocks or sanitizes injection patterns, control characters, and oversized payloads. However, this protection assumes legitimate data. Do not store sensitive personal information without explicit legal coverage.

---

## Security Model

### Single-Tenant (Default)

The MCP server is designed for single-tenant deployment: one Cortex instance per team. Auth is handled by Harper's native HTTP auth layer (Basic auth or Bearer tokens configured at the instance level). The MCP server inherits this — no additional auth is needed beyond what Harper provides.

**VectorSearch is intentionally excluded from MCP.** The `VectorSearch` endpoint accepts pre-computed embedding vectors and is available for trusted server-to-server paths (e.g., LangChain running in your backend). It is not exposed through MCP because untrusted clients could craft adversarial vectors to poison the vector space or trick dedup into overwriting legitimate memories.

### Multi-Tenant

For multi-tenant deployments where multiple users share a single Cortex instance, the server implements:

- **JWT auth with RS256 JWKS validation** — Tokens validated against JWKS endpoint for secure, stateless auth
- **Server-side namespace enforcement** — agentId bound from JWT ns claim, client values overwritten
- **Per-tenant rate limiting** with 3 tiers:
  - Free: 60 reads/20 writes per minute
  - Team: 300/100 per minute
  - Enterprise: 1000/500 per minute
- **Scope-based access control** — memory:read, memory:write, synapse:read, synapse:write
- **Token revocation** with 60s cache TTL
- **Content audit logging** — All operations logged for compliance

**Important:** Ensure all tenants are provisioned as authorized Users under your Harper subscription (per PaaS ToS Section 3.2).

See `docs/multi-tenant-design.md` for the full architecture proposal.

### Content Safety

All memory storage operations pass through content sanitization that:

- Detects and strips prompt injection patterns (system markers, instruction overrides, delimiter injection)
- Removes script tags, SQL-like injection, and control characters
- Enforces content length limits (16KB)
- Normalizes Unicode (NFKC)
- Blocks content with detected injection patterns (configurable: block vs. sanitize-and-store)

Retrieval also applies a lighter sanitization pass to prevent stored payloads from reaching LLM clients.

## Production Deployment

### Rate Limiting

Embedding generation and vector search are compute-intensive. In production:

- **Harper deployment**: Configure rate limits at the Harper instance level via `config.yaml` or Fabric policies
- **Standalone deployment**: Place an HTTP rate limiter (nginx, Cloudflare, express-rate-limit) in front of the MCP server
- Rate limits should be per-tenant for multi-tenant deployments, with separate budgets for reads vs. writes

### Network Placement

- **Internal/team use**: Deploy alongside Cortex in your private network. No DMZ needed.
- **Public-facing**: Place the MCP server in a DMZ with strict ingress controls. Cortex must NOT be directly accessible from the internet. The MCP server acts as the auth boundary.
- **OpenShell/NemoClaw**: These environments block internal IPs by default. Cortex must be reachable at a routable HTTPS address. Use the standalone deployment mode with `CORTEX_URL` pointing to your public Cortex endpoint.

### Harper Deployment (Recommended)

When deployed as a Harper component, the MCP endpoint runs inside the Cortex process with direct table access. This eliminates network round-trips and inherits Harper's auth, TLS, and rate limiting automatically. See the `harper/` directory.

## License

MIT

## Contributing

Contributions welcome! Please open issues and PRs on [GitHub](https://github.com/HarperFast/cortex-mcp-server).

## Related Projects

- [Harper Cortex](https://github.com/HarperFast/Cortex) — The memory database powering this server
- [cortex-client](../cortex-client/) — TypeScript SDK for Cortex
- [LangChain Harper Integration](../langchain-harperdb-integration/) — Production RAG with Cortex
- [OpenClaw](https://github.com/harperfast/openclaw) — Multi-agent orchestration with shared memory

## Support

- Docs: https://harperdb.io/docs
- Discord: https://discord.gg/harperdb
- Email: support@harperfast.io
