# MCP Server & Claude Desktop Setup

This guide covers deploying the Harper MCP Server and connecting it to Claude Desktop.

## Step 1: Deploy the Harper MCP Server

The official `@harperdb/mcp-server` runs as a component inside your Harper cluster. Deploy it using the Harper CLI:

```bash
harperdb deploy_component package=@harperdb/mcp-server
```

This creates a `/mcp` endpoint on your cluster that exposes all tables (including the Memory table) as MCP resources.

## Step 2: Verify the MCP Endpoint

Generate your Basic Auth token:

```bash
echo -n "YOUR_USERNAME:YOUR_PASSWORD" | base64
```

Then test the endpoint:

```bash
curl https://YOUR_CLUSTER.harperfabric.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic <base64_token>" \
  -d '{"jsonrpc": "2.0", "method": "resources/list", "id": 1}'
```

You should see the Memory table listed as an available resource.

## Step 3: Configure Claude Desktop

Edit the Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Option A: Basic Auth (username + password)

```json
{
	"mcpServers": {
		"cortex": {
			"command": "npx",
			"args": [
				"-y",
				"mcp-remote",
				"https://YOUR_CLUSTER.harperfabric.com/mcp",
				"--header",
				"Authorization: Basic <base64_token>"
			]
		}
	}
}
```

### Option B: JWT Bearer Token (recommended for production)

First, issue a JWT from your cluster:

```bash
curl -X POST https://YOUR_CLUSTER.harperfabric.com/IssueTokens \
  -H "Content-Type: application/json" \
  -d '{"username": "YOUR_USERNAME", "password": "YOUR_PASSWORD"}'
```

This returns `{ "jwt": "...", "refreshToken": "..." }`. Use the JWT in your config:

```json
{
	"mcpServers": {
		"cortex": {
			"command": "npx",
			"args": [
				"-y",
				"mcp-remote",
				"https://YOUR_CLUSTER.harperfabric.com/mcp",
				"--header",
				"Authorization: Bearer YOUR_JWT"
			]
		}
	}
}
```

> **Note**: JWTs are short-lived. When one expires, re-issue via `POST /IssueTokens` with your `refreshToken`. `mcp-remote` bridges Harper's HTTP-based MCP endpoint to the stdio transport that Claude Desktop expects.

## Step 4: Restart Claude Desktop

1. Fully quit Claude Desktop (**Cmd+Q** on macOS, not just close the window)
2. Relaunch Claude Desktop
3. In a new conversation, look for the MCP tools icon to confirm the server is connected

## Step 5: Test It

Try asking Claude Desktop:

> "What recent discussions happened in my team's Slack?"

Claude should query the Memory table via MCP and return relevant results.

## Cursor Setup

The same MCP configuration works with Cursor:

1. Open **Cursor Settings**
2. Navigate to the **MCP** section
3. Add the same server configuration as above

## Troubleshooting

- **MCP server not showing up**: Make sure you fully quit and restarted Claude Desktop
- **Authentication errors**: Verify your base64 token or JWT is correct and not expired
- **No results**: Check that the Memory table has records (send a test Slack message first)
- **Connection timeout**: Verify your cluster URL is correct and the cluster is running
