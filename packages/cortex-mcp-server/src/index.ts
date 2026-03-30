#!/usr/bin/env node

/**
 * @harperfast/cortex-mcp-server
 *
 * Remote MCP server that exposes Harper Cortex memory as tools to Claude, Cursor, Windsurf, and any MCP-compatible client.
 *
 * Supports two modes:
 * - Single-tenant (default): Bearer token auth, no namespace enforcement
 * - Multi-tenant: JWT auth with JWKS, server-side namespace binding, per-tenant rate limiting
 *
 * Usage:
 *   npx @harperfast/cortex-mcp-server --url https://my-cortex.harperfabric.com:9926 --token "user:pass"
 *   npx @harperfast/cortex-mcp-server --url https://my-cortex.harperfabric.com:9926 --multi-tenant --jwks-url https://my-cortex.harperfabric.com/.well-known/jwks.json
 *   docker run -e CORTEX_URL=https://my-cortex.harperfabric.com:9926 harperfast/cortex-mcp-server
 *   claude mcp add cortex -- npx @harperfast/cortex-mcp-server --url https://my-cortex.harperfabric.com:9926 --token "user:pass"
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'http';
import { z } from 'zod';

import { extractToken, formatAuthHeader, validateAuth, validateJWT, validateScope } from './auth.js';
import { bindNamespace } from './namespace.js';
import { getCachedCount, invalidateCountCache } from './quota.js';
import { checkRateLimit, getMetricForTool, getQuotaLimits } from './rate-limiter.js';
import {
	createTenantSchema,
	getTenantSchema,
	handleCreateTenant,
	handleGetTenant,
	handleIssueToken,
	handleListTenants,
	handleRevokeToken,
	handleUpdateTenant,
	issueTokenSchema,
	listTenantsSchema,
	revokeTokenSchema,
	updateTenantSchema,
} from './tools/admin.js';
import {
	handleMemoryCount,
	handleMemoryForget,
	handleMemoryRecall,
	handleMemorySearch,
	handleMemoryStore,
	memoryCountSchema,
	memoryForgetSchema,
	memoryRecallSchema,
	memorySearchSchema,
	memoryStoreSchema,
} from './tools/memory.js';
import { handleSynapseIngest, handleSynapseSearch, synapseIngestSchema, synapseSearchSchema } from './tools/synapse.js';
import type { ServerConfig, TenantContext } from './types.js';

/**
 * Parse command-line arguments and environment variables
 */
function parseConfig(): ServerConfig {
	const args = process.argv.slice(2);

	let cortexUrl = process.env.CORTEX_URL || '';
	let cortexToken = process.env.CORTEX_TOKEN;
	let cortexSchema = process.env.CORTEX_SCHEMA || 'data';
	let port = parseInt(process.env.PORT || '3000', 10);
	let host = process.env.HOST || '0.0.0.0';
	let authRequired = process.env.AUTH_REQUIRED !== 'false';
	let multiTenant = process.env.MULTI_TENANT === 'true';
	let jwksUrl = process.env.JWKS_URL;
	let adminToken = process.env.ADMIN_TOKEN;

	for (let i = 0; i < args.length; i++) {
		if ((args[i] === '--url' || args[i] === '-u') && args[i + 1]) {
			cortexUrl = args[++i];
		} else if ((args[i] === '--token' || args[i] === '-t') && args[i + 1]) {
			cortexToken = args[++i];
		} else if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
			port = parseInt(args[++i], 10);
		} else if ((args[i] === '--host' || args[i] === '-h') && args[i + 1]) {
			host = args[++i];
		} else if (args[i] === '--no-auth') {
			authRequired = false;
		} else if (args[i] === '--multi-tenant') {
			multiTenant = true;
		} else if (args[i] === '--jwks-url' && args[i + 1]) {
			jwksUrl = args[++i];
		} else if (args[i] === '--admin-token' && args[i + 1]) {
			adminToken = args[++i];
		}
	}

	if (!cortexUrl) {
		console.error('Error: CORTEX_URL is required. Set via --url or CORTEX_URL env var.');
		process.exit(1);
	}

	if (multiTenant && !jwksUrl) {
		console.error('Error: JWKS_URL is required in multi-tenant mode. Set via --jwks-url or JWKS_URL env var.');
		process.exit(1);
	}

	return {
		cortexUrl: cortexUrl.replace(/\/$/, ''),
		cortexToken,
		cortexSchema,
		port,
		host,
		authRequired,
		multiTenant,
		jwksUrl,
		adminToken,
	};
}

// ---------------------------------------------------------------------------
// Multi-tenant request context (set per-request via closure)
// In single-tenant mode, this is always null.
// ---------------------------------------------------------------------------

let currentTenant: TenantContext | null = null;

/**
 * Build a tool context, applying namespace binding in multi-tenant mode
 */
function getToolContext(config: ServerConfig) {
	const base = {
		cortexUrl: config.cortexUrl,
		cortexToken: config.cortexToken,
		cortexSchema: config.cortexSchema,
	};

	if (config.multiTenant && currentTenant) {
		return bindNamespace(base, currentTenant);
	}

	return base;
}

/**
 * Wrap a tool handler with multi-tenant middleware:
 * rate limiting, scope validation, namespace binding
 */
function wrapToolHandler(
	config: ServerConfig,
	toolName: string,
	handler: (toolContext: any, input: any) => Promise<string>,
) {
	return async (input: any) => {
		try {
			// Multi-tenant checks
			if (config.multiTenant && currentTenant) {
				// Scope validation
				if (!validateScope(toolName, currentTenant.scopes)) {
					return {
						content: [{
							type: 'text' as const,
							text: `Error: Permission denied. Required scope for ${toolName} not granted.`,
						}],
						isError: true,
					};
				}

				// Rate limiting
				const metric = getMetricForTool(toolName);
				const rateResult = checkRateLimit(currentTenant.tenantId, metric, currentTenant.tier);
				if (!rateResult.allowed) {
					return {
						content: [{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Rate limit exceeded',
								bucket: rateResult.bucket,
								limit: rateResult.limit,
								retryAfterMs: rateResult.resetMs,
							}),
						}],
						isError: true,
					};
				}

				// Storage quota check (writes only)
				if (toolName === 'memory_store' || toolName === 'synapse_ingest') {
					const quotaLimits = getQuotaLimits(currentTenant.tier);
					const storageLimit = toolName === 'memory_store'
						? quotaLimits.maxMemories
						: quotaLimits.maxSynapseEntries;
					const currentCount = await getCachedCount(
						config.cortexUrl,
						config.cortexToken,
						currentTenant.namespace,
					);
					if (currentCount >= storageLimit) {
						return {
							content: [{
								type: 'text' as const,
								text: JSON.stringify({
									error: 'Storage quota exceeded',
									used: currentCount,
									limit: storageLimit,
									tier: currentTenant.tier || 'free',
								}),
							}],
							isError: true,
						};
					}
				}
			}

			const toolContext = getToolContext(config);
			const result = await handler(toolContext, input);

			// Invalidate count cache after any write so the next quota check is fresh
			if (
				config.multiTenant
				&& currentTenant
				&& (toolName === 'memory_store' || toolName === 'memory_forget' || toolName === 'synapse_ingest')
			) {
				invalidateCountCache(currentTenant.namespace);
			}

			return {
				content: [{ type: 'text' as const, text: result }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: 'text' as const, text: `Error: ${message}` }],
				isError: true,
			};
		}
	};
}

/**
 * Main server setup
 */
async function main() {
	const config = parseConfig();
	const useHttp = process.env.HTTP_SERVER === 'true' || process.argv.includes('--http');

	const server = new McpServer({
		name: '@harperfast/cortex-mcp-server',
		version: '0.2.0',
	});

	// ========================================================================
	// Memory Tools
	//
	// NOTE: VectorSearch is intentionally excluded from MCP.
	// The VectorSearch endpoint accepts pre-computed embedding vectors and is
	// available for trusted server-to-server paths (e.g., LangChain running
	// in your backend). It is NOT exposed through MCP because untrusted clients
	// could craft adversarial vectors to poison the vector space or trick dedup
	// into overwriting legitimate memories.
	// ========================================================================

	server.tool(
		'memory_search',
		'Search memories by semantic similarity',
		{
			query: z.string().describe('Natural language search query'),
			limit: z.number().optional().describe('Maximum number of results (default: 5)'),
			filters: z.record(z.any()).optional().describe('Optional metadata filters'),
		},
		wrapToolHandler(config, 'memory_search', handleMemorySearch),
	);

	server.tool(
		'memory_store',
		'Store a new memory',
		{
			text: z.string().describe('Memory content to store'),
			source: z.string().optional().describe('Source of the memory (e.g., "claude", "api")'),
			classification: z
				.string()
				.optional()
				.describe('Classification tag (e.g., "decision", "fact")'),
			metadata: z.record(z.any()).optional().describe('Additional metadata'),
		},
		wrapToolHandler(config, 'memory_store', handleMemoryStore),
	);

	server.tool(
		'memory_recall',
		'Retrieve a specific memory by ID',
		{
			id: z.string().describe('Memory ID to retrieve'),
		},
		wrapToolHandler(config, 'memory_recall', handleMemoryRecall),
	);

	server.tool(
		'memory_forget',
		'Delete a memory by ID',
		{
			id: z.string().describe('Memory ID to delete'),
		},
		wrapToolHandler(config, 'memory_forget', handleMemoryForget),
	);

	server.tool(
		'memory_count',
		'Count stored memories',
		{
			filters: z.record(z.any()).optional().describe('Optional metadata filters'),
		},
		wrapToolHandler(config, 'memory_count', handleMemoryCount),
	);

	// ========================================================================
	// Synapse Tools
	// ========================================================================

	server.tool(
		'synapse_search',
		'Search development context by semantic similarity',
		{
			query: z.string().describe('Natural language search query'),
			projectId: z.string().describe('Project ID to search within'),
			limit: z.number().optional().describe('Maximum number of results (default: 5)'),
			filters: z.record(z.any()).optional().describe('Optional filters (type, source, status)'),
		},
		wrapToolHandler(config, 'synapse_search', handleSynapseSearch),
	);

	server.tool(
		'synapse_ingest',
		'Ingest development context from a tool',
		{
			source: z
				.enum(['claude_code', 'cursor', 'windsurf', 'copilot', 'manual', 'slack'] as const)
				.describe('Source of the synapse entry'),
			content: z.string().describe('Context content to ingest'),
			projectId: z.string().describe('Project ID for context'),
			parentId: z.string().optional().describe('Parent entry ID (for nested context)'),
			references: z.array(z.string()).optional().describe('Related entry IDs'),
		},
		wrapToolHandler(config, 'synapse_ingest', handleSynapseIngest),
	);

	// ========================================================================
	// Memory Dashboard (MCP App / A2UI)
	// ========================================================================

	server.tool(
		'memory_dashboard',
		'Get a visual overview of stored memories — recent entries, search, and statistics',
		{
			query: z.string().optional().describe('Optional search query to find specific memories'),
			limit: z.number().optional().default(10).describe('Number of recent memories to show'),
		},
		async (input) => {
			try {
				const baseUrl = config.cortexUrl;
				const headers: Record<string, string> = { 'Content-Type': 'application/json' };
				if (config.cortexToken) {
					headers['Authorization'] = formatAuthHeader(config.cortexToken);
				}

				// Get total count
				const countRes = await fetch(`${baseUrl}/MemoryCount`, {
					method: 'POST',
					headers,
					body: JSON.stringify({}),
				});
				const countData = await countRes.json() as any;
				const totalCount = countData?.count ?? 0;

				// Get count by source
				const sourceCountRes = await fetch(`${baseUrl}/MemoryCount`, {
					method: 'POST',
					headers,
					body: JSON.stringify({ filters: { source: 'api' } }),
				});
				const apiCount = ((await sourceCountRes.json()) as any)?.count ?? 0;

				const slackCountRes = await fetch(`${baseUrl}/MemoryCount`, {
					method: 'POST',
					headers,
					body: JSON.stringify({ filters: { source: 'slack' } }),
				});
				const slackCount = ((await slackCountRes.json()) as any)?.count ?? 0;

				// Search or get recent memories
				const searchQuery = (input as any).query || 'recent context';
				const searchLimit = (input as any).limit || 10;
				const searchRes = await fetch(`${baseUrl}/MemorySearch`, {
					method: 'POST',
					headers,
					body: JSON.stringify({ query: searchQuery, limit: searchLimit }),
				});
				const searchData = await searchRes.json() as any;
				const memories = searchData?.results || [];

				// Format dashboard output
				const lines: string[] = [];
				lines.push('# Cortex Memory Dashboard');
				lines.push('');
				lines.push('## Storage Statistics');
				lines.push(`- **Total memories:** ${totalCount}`);
				lines.push(`- **API-sourced:** ${apiCount}`);
				lines.push(`- **Slack-sourced:** ${slackCount}`);
				lines.push(`- **Other sources:** ${totalCount - apiCount - slackCount}`);
				lines.push('');

				// Show quota bar in multi-tenant mode
				if (config.multiTenant && currentTenant) {
					const quotaLimits = getQuotaLimits(currentTenant.tier);
					const storageLimit = quotaLimits.maxMemories;
					const pct = Math.min(1, totalCount / storageLimit);
					const filled = Math.round(pct * 10);
					const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
					const pctLabel = (pct * 100).toFixed(0);
					const tierLabel = currentTenant.tier || 'free';
					lines.push('## Storage Quota');
					lines.push(
						`${bar}  ${totalCount.toLocaleString()} / ${storageLimit.toLocaleString()} memories (${pctLabel}%) — ${tierLabel} tier`,
					);
					if (pct >= 0.9) {
						const nextTier = tierLabel === 'free' ? 'team' : tierLabel === 'team' ? 'enterprise' : null;
						const upgradeHint = nextTier
							? ` Upgrade to ${nextTier} tier for ${getQuotaLimits(nextTier).maxMemories.toLocaleString()} memories.`
							: '';
						lines.push(`> Warning: approaching storage limit.${upgradeHint}`);
					}
					lines.push('');
				}

				if (memories.length > 0) {
					lines.push(`## ${(input as any).query ? 'Search Results' : 'Recent Memories'} (${memories.length})`);
					lines.push('');

					for (const mem of memories) {
						const similarity = typeof mem.similarity === 'number'
							? `${(mem.similarity * 100).toFixed(0)}%`
							: typeof mem.$distance === 'number'
							? `${((1 - mem.$distance / 2) * 100).toFixed(0)}%`
							: 'N/A';
						const bar = typeof mem.similarity === 'number'
							? '█'.repeat(Math.round(mem.similarity * 10)) + '░'.repeat(10 - Math.round(mem.similarity * 10))
							: '';

						lines.push(`### ${mem.classification || 'unclassified'} | ${similarity} ${bar}`);
						lines.push(
							`> ${(mem.rawText || mem.text || '').substring(0, 120)}${(mem.rawText || '').length > 120 ? '...' : ''}`,
						);
						lines.push(
							`- **ID:** \`${mem.id}\` | **Source:** ${mem.source || 'unknown'} | **Date:** ${
								mem.timestamp ? new Date(mem.timestamp).toLocaleDateString() : 'N/A'
							}`,
						);
						lines.push('');
					}
				} else {
					lines.push('## No memories found');
					lines.push('Store your first memory with the `memory_store` tool.');
				}

				return {
					content: [{ type: 'text' as const, text: lines.join('\n') }],
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: 'text' as const, text: `Dashboard error: ${message}` }],
					isError: true,
				};
			}
		},
	);

	// ========================================================================
	// Admin Tools (multi-tenant only)
	// ========================================================================

	if (config.multiTenant) {
		const adminContext = {
			cortexUrl: config.cortexUrl,
			cortexToken: config.cortexToken,
			cortexSchema: config.cortexSchema,
		};

		server.tool(
			'admin_create_tenant',
			'Create a new tenant (admin only)',
			{
				name: z.string().describe('Tenant display name'),
				tier: z.enum(['free', 'team', 'enterprise']).default('free').describe('Rate limit tier'),
				maxMemories: z.number().optional().describe('Override max memories quota'),
				maxSynapseEntries: z.number().optional().describe('Override max synapse entries quota'),
			},
			async (input) => {
				try {
					const result = await handleCreateTenant(adminContext, input as any);
					return { content: [{ type: 'text' as const, text: result }] };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
				}
			},
		);

		server.tool(
			'admin_list_tenants',
			'List all tenants (admin only)',
			{
				status: z.enum(['active', 'suspended', 'archived']).optional().describe('Filter by status'),
			},
			async (input) => {
				try {
					const result = await handleListTenants(adminContext, input as any);
					return { content: [{ type: 'text' as const, text: result }] };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
				}
			},
		);

		server.tool(
			'admin_get_tenant',
			'Get tenant details (admin only)',
			{
				tenantId: z.string().describe('Tenant ID'),
			},
			async (input) => {
				try {
					const result = await handleGetTenant(adminContext, input as any);
					return { content: [{ type: 'text' as const, text: result }] };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
				}
			},
		);

		server.tool(
			'admin_update_tenant',
			'Update a tenant (admin only)',
			{
				tenantId: z.string().describe('Tenant ID'),
				name: z.string().optional().describe('Updated display name'),
				tier: z.enum(['free', 'team', 'enterprise']).optional().describe('Updated tier'),
				status: z.enum(['active', 'suspended', 'archived']).optional().describe('Updated status'),
				maxMemories: z.number().optional().describe('Updated max memories'),
				maxSynapseEntries: z.number().optional().describe('Updated max synapse entries'),
			},
			async (input) => {
				try {
					const result = await handleUpdateTenant(adminContext, input as any);
					return { content: [{ type: 'text' as const, text: result }] };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
				}
			},
		);

		server.tool(
			'admin_issue_token',
			'Issue a JWT token for a tenant (admin only)',
			{
				tenantId: z.string().describe('Tenant ID to issue token for'),
				scopes: z.array(z.string()).optional().describe('Token scopes'),
				expiresInHours: z.number().optional().describe('Token lifetime in hours (default: 1)'),
			},
			async (input) => {
				try {
					const result = await handleIssueToken(adminContext, input as any);
					return { content: [{ type: 'text' as const, text: result }] };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
				}
			},
		);

		server.tool(
			'admin_revoke_token',
			'Revoke a JWT token (admin only)',
			{
				tenantId: z.string().describe('Tenant ID'),
				tokenJti: z.string().describe('Token JTI to revoke'),
				reason: z.string().optional().describe('Reason for revocation'),
			},
			async (input) => {
				try {
					const result = await handleRevokeToken(adminContext, input as any);
					return { content: [{ type: 'text' as const, text: result }] };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
				}
			},
		);

		console.error(`Multi-tenant mode enabled. JWKS URL: ${config.jwksUrl}`);
		console.error(`Admin tools registered (6 tools). Total tools: 13`);
	}

	// ========================================================================
	// Start Server
	// ========================================================================

	if (useHttp) {
		const { randomUUID } = await import('node:crypto');

		// Create transport with session management for stateful connections
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
		});

		const httpServer = createServer(async (req, res) => {
			const url = req.url || '';

			// Health endpoint
			if (req.method === 'GET' && url === '/mcp/health') {
				let cortexConnected = false;

				try {
					const healthCheckUrl = new URL('/', config.cortexUrl);
					const response = await fetch(healthCheckUrl.toString(), {
						method: 'HEAD',
					});
					cortexConnected = response.ok || response.status < 500;
				} catch {
					cortexConnected = false;
				}

				const toolList = [
					'memory_search',
					'memory_store',
					'memory_recall',
					'memory_forget',
					'memory_count',
					'memory_dashboard',
					'synapse_search',
					'synapse_ingest',
				];

				if (config.multiTenant) {
					toolList.push(
						'admin_create_tenant',
						'admin_list_tenants',
						'admin_get_tenant',
						'admin_update_tenant',
						'admin_issue_token',
						'admin_revoke_token',
					);
				}

				const healthResponse = {
					status: 'ok',
					version: '0.2.0',
					cortexUrl: config.cortexUrl,
					transport: 'http',
					multiTenant: config.multiTenant,
					tools: toolList,
					cortexConnected,
				};

				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(healthResponse, null, 2));
				return;
			}

			// RFC 9728: OAuth Protected Resource Metadata
			if (req.method === 'GET' && url === '/.well-known/oauth-protected-resource') {
				const metadata = {
					resource: config.cortexUrl,
					authorization_servers: [config.cortexUrl],
					bearer_methods_supported: ['header'],
					resource_documentation: 'https://github.com/HarperFast/cortex-mcp-server',
				};
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(metadata, null, 2));
				return;
			}

			// MCP endpoint — delegate to StreamableHTTPServerTransport
			if (url === '/mcp' || url.startsWith('/mcp?')) {
				try {
					await transport.handleRequest(req, res);
				} catch (error) {
					console.error('MCP transport error:', error);
					if (!res.headersSent) {
						res.writeHead(500, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'Internal server error' }));
					}
				}
				return;
			}

			// Unknown path
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Not found. MCP endpoint is at /mcp' }));
		});

		httpServer.listen(config.port, config.host, () => {
			console.log(
				`cortex-mcp-server listening on http://${config.host}:${config.port}/mcp`,
			);
			console.log(`Cortex URL: ${config.cortexUrl}`);
			console.log(`Mode: ${config.multiTenant ? 'multi-tenant' : 'single-tenant'}`);
			console.log(`Auth required: ${config.authRequired}`);
			console.log(`Health endpoint: http://${config.host}:${config.port}/mcp/health`);
			console.log(`CIMD metadata: http://${config.host}:${config.port}/.well-known/oauth-protected-resource`);
		});

		await server.connect(transport);
	} else {
		const transport = new StdioServerTransport();
		await server.connect(transport);
		console.error('cortex-mcp-server connected via stdio');
	}
}

// Run the server
main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
