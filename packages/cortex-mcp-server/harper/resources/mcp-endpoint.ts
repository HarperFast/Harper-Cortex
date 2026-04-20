/**
 * MCP Endpoint — Harper Custom Resource
 *
 * Exposes the Cortex MCP server as a Harper REST endpoint.
 * When deployed on Harper, the MCP tools call Cortex tables directly
 * via the `tables` import rather than making HTTP requests to localhost.
 *
 * Endpoint: POST /McpEndpoint/
 *
 * This resource handles the MCP Streamable HTTP transport protocol:
 * - POST with MCP JSON-RPC messages
 * - Responds with MCP tool results
 *
 * Usage:
 *   Claude Desktop / Cursor config:
 *   { "url": "https://my-instance.harpercloud.com/McpEndpoint/" }
 */

import { Resource, tables } from 'harper';

const { Memory, SynapseEntry } = tables;

// ---------------------------------------------------------------------------
// Safety Functions (inline implementations)
// ---------------------------------------------------------------------------

/**
 * Detect injection patterns in text
 */
function detectInjectionPatterns(text: string): { detected: boolean; patterns: string[] } {
	const patterns: string[] = [];

	const injectionPatterns = [
		{ pattern: /\{system.*?\}/gi, description: '{system...} markers' },
		{ pattern: /ignore.*?previous.*?instructions/gi, description: 'Ignore instructions' },
		{ pattern: /forget.*?(?:all|previous|prior)/gi, description: 'Forget instructions' },
		{ pattern: /as an? ai/gi, description: 'AI role claim' },
		{ pattern: /user jailbreak/gi, description: 'Jailbreak attempt' },
		{ pattern: /['"];?.*?(?:drop|delete|insert|update|union|select)/gi, description: 'SQL-like injection' },
		{ pattern: /<script[^>]*>.*?<\/script>/gi, description: 'Script tags' },
		{ pattern: /javascript:/gi, description: 'JavaScript protocol' },
		{ pattern: /<\|.*?\|>/g, description: 'Delimiter injection (MCP markers)' },
		{ pattern: /\[INST\].*?\[\/INST\]/gi, description: 'Instruction tags' },
		{ pattern: /\bsystem:\s/gi, description: 'Role prefix injection' },
	];

	for (const { pattern, description } of injectionPatterns) {
		if (pattern.test(text)) {
			patterns.push(description);
		}
	}

	return { detected: patterns.length > 0, patterns };
}

/**
 * Filter content for safety and quality
 */
function filterContent(text: string): string {
	let filtered = text.replace(/\0/g, '');
	filtered = filtered.replace(/\s+/g, ' ').trim();
	filtered = filtered.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
	filtered = filtered.normalize('NFKC');
	if (filtered.length > 16000) {
		filtered = filtered.substring(0, 16000).trim();
	}
	return filtered;
}

/**
 * Sanitize text for storage (combines injection detection and filtering)
 */
function sanitizeForStorage(text: string): { sanitized: string; blocked: boolean; warnings: string[] } {
	const warnings: string[] = [];
	const injection = detectInjectionPatterns(text);

	let cleaned = text;
	if (injection.detected) {
		warnings.push(`Injection detected and removed: ${injection.patterns.join(', ')}`);
		// Remove injection patterns
		const injectionPatterns = [
			/\{system.*?\}/gi,
			/ignore.*?previous.*?instructions/gi,
			/forget.*?(?:all|previous|prior)/gi,
			/as an? ai/gi,
			/user jailbreak/gi,
			/['"];?.*?(?:drop|delete|insert|update|union|select)/gi,
			/<script[^>]*>.*?<\/script>/gi,
			/javascript:/gi,
			/<\|.*?\|>/g,
			/\[INST\].*?\[\/INST\]/gi,
			/\bsystem:\s/gi,
		];
		for (const pattern of injectionPatterns) {
			cleaned = cleaned.replace(pattern, '');
		}
	}

	const filtered = filterContent(cleaned);

	if (filtered.length === 0) {
		warnings.push('Memory content was empty or entirely filtered');
	}
	if (filtered.length < 10) {
		warnings.push('Memory content is very short (< 10 chars)');
	}

	return { sanitized: filtered, blocked: injection.detected, warnings };
}

/**
 * Sanitize text for retrieval (lighter pass for client responses)
 */
function sanitizeForRetrieval(text: string): string {
	let sanitized = text;
	sanitized = sanitized.replace(/<[^>]*>/g, '');
	sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '');
	sanitized = sanitized.replace(/javascript:/gi, '');
	sanitized = sanitized.replace(/\s+/g, ' ').trim();
	sanitized = sanitized.replace(/\0/g, '');
	sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
	sanitized = sanitized.normalize('NFKC');
	return sanitized;
}

// ---------------------------------------------------------------------------
// Tool Implementations (direct table access — no HTTP round-trip)
// ---------------------------------------------------------------------------

async function memorySearch(params: { query: string; limit?: number; filters?: Record<string, any> }) {
	const { generateEmbedding } = await import('../../resources.js');

	const queryEmbedding = await generateEmbedding(params.query);
	const limit = Math.min(Math.max(1, params.limit || 5), 100);

	const searchParams: any = {
		select: ['id', 'rawText', 'source', 'classification', 'summary', 'timestamp', '$distance'],
		sort: { attribute: 'embedding', target: queryEmbedding },
		limit,
	};

	if (params.filters && typeof params.filters === 'object') {
		const conditions = [];
		for (const [key, value] of Object.entries(params.filters)) {
			if (value != null) {
				conditions.push({ attribute: key, comparator: 'equals', value });
			}
		}
		if (conditions.length === 1) { searchParams.conditions = conditions[0]; }
		else if (conditions.length > 1) { searchParams.conditions = conditions; }
	}

	const results = [];
	for await (const record of Memory.search(searchParams)) {
		results.push({
			id: record.id,
			text: sanitizeForRetrieval(record.rawText),
			source: record.source,
			classification: record.classification,
			summary: record.summary,
			similarity: record.$distance != null ? Math.max(0, 1 - record.$distance / 2) : 0,
			timestamp: record.timestamp,
		});
	}

	return { count: results.length, results };
}

async function memoryStore(params: { text: string; source?: string; classification?: string; agentId?: string }) {
	const { classifyMessage, generateEmbedding } = await import('../../resources.js');

	// Sanitize input before storage
	const sanitized = sanitizeForStorage(params.text);

	// If blocked, return rejection
	if (sanitized.blocked) {
		return {
			stored: false,
			blocked: true,
			reason: `Content rejected: ${sanitized.warnings.join('; ')}`,
		};
	}

	const [classification, embedding] = await Promise.all([
		classifyMessage(sanitized.sanitized),
		generateEmbedding(sanitized.sanitized),
	]);

	const record = {
		rawText: sanitized.sanitized,
		source: params.source || 'mcp',
		sourceType: 'mcp_tool',
		classification: params.classification || classification.category,
		entities: classification.entities,
		embedding,
		summary: classification.summary,
		timestamp: new Date(),
		agentId: params.agentId,
		metadata: {
			ingested_via: 'mcp-server',
			...(sanitized.warnings.length > 0 ? { sanitization_warnings: sanitized.warnings } : {}),
		},
	};

	const result = await Memory.put(record);
	return {
		id: result?.id,
		status: 'stored',
		...(sanitized.warnings.length > 0 ? { warnings: sanitized.warnings } : {}),
	};
}

async function memoryRecall(params: { id: string }) {
	const record = await Memory.get(params.id);
	if (!record) { return { error: 'Memory not found' }; }
	return {
		id: record.id,
		text: sanitizeForRetrieval(record.rawText),
		source: record.source,
		classification: record.classification,
		summary: record.summary,
		timestamp: record.timestamp,
	};
}

async function memoryForget(params: { id: string }) {
	await Memory.delete(params.id);
	return { id: params.id, status: 'deleted' };
}

async function synapseSearch(
	params: { query: string; projectId: string; limit?: number; filters?: Record<string, any> },
) {
	const { generateEmbedding } = await import('../../resources.js');

	const queryEmbedding = await generateEmbedding(params.query);
	const limit = Math.min(Math.max(1, params.limit || 5), 100);

	const conditions: any[] = [
		{ attribute: 'projectId', comparator: 'equals', value: params.projectId },
		{ attribute: 'status', comparator: 'equals', value: params.filters?.status || 'active' },
	];

	if (params.filters?.type) {
		conditions.push({ attribute: 'type', comparator: 'equals', value: params.filters.type });
	}

	const results = [];
	for await (
		const record of SynapseEntry.search({
			select: ['id', 'type', 'content', 'source', 'summary', 'createdAt', '$distance'],
			sort: { attribute: 'embedding', target: queryEmbedding },
			conditions,
			limit,
		})
	) {
		results.push({
			id: record.id,
			type: record.type,
			content: record.content,
			source: record.source,
			summary: record.summary,
			similarity: record.$distance != null ? Math.max(0, 1 - record.$distance / 2) : 0,
			createdAt: record.createdAt,
		});
	}

	return { count: results.length, projectId: params.projectId, results };
}

async function memoryCount(params: { filters?: Record<string, any> }) {
	const searchParams: any = { select: ['id'] };

	if (params.filters && typeof params.filters === 'object') {
		const conditions = [];
		for (const [key, value] of Object.entries(params.filters)) {
			if (value != null) {
				conditions.push({ attribute: key, comparator: 'equals', value });
			}
		}
		if (conditions.length === 1) { searchParams.conditions = conditions[0]; }
		else if (conditions.length > 1) { searchParams.conditions = conditions; }
	}

	let count = 0;
	for await (const _ of Memory.search(searchParams)) {
		count++;
	}
	return { count };
}

async function synapseIngest(
	params: { source: string; content: string; projectId: string; parentId?: string; references?: string[] },
) {
	const { classifySynapseEntry, generateEmbedding } = await import('../../resources.js');
	const { randomUUID } = await import('node:crypto');
	const { createHash } = await import('node:crypto');

	if (!params.projectId) { return { error: 'projectId is required' }; }
	if (!params.content) { return { error: 'content is required' }; }

	const validSources = ['claude_code', 'cursor', 'windsurf', 'copilot', 'manual', 'slack'];
	if (!validSources.includes(params.source)) {
		return { error: `source must be one of: ${validSources.join(', ')}` };
	}

	const contentHash = createHash('sha256').update(params.content).digest('hex');
	const deterministicId = createHash('sha256')
		.update(`${params.projectId}:${params.source}:${contentHash}`)
		.digest('hex')
		.substring(0, 32);

	const [classification, embedding] = await Promise.all([
		classifySynapseEntry(params.content),
		generateEmbedding(params.content),
	]);

	const entry = {
		id: deterministicId,
		projectId: params.projectId,
		type: classification?.category || 'context',
		content: params.content,
		source: params.source,
		sourceFormat: params.source,
		embedding,
		summary: classification?.summary || params.content.substring(0, 100),
		status: 'active',
		references: params.references || [],
		parentId: params.parentId || null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	await SynapseEntry.put(entry);
	return { count: 1, stored: [{ id: deterministicId, type: entry.type }] };
}

async function synapseEmit(params: { target: string; projectId: string; types?: string[]; limit?: number }) {
	const validTargets = ['cursor', 'windsurf', 'markdown', 'claude_code', 'copilot'];
	if (!validTargets.includes(params.target)) {
		return { error: `target must be one of: ${validTargets.join(', ')}` };
	}
	if (!params.projectId) { return { error: 'projectId is required' }; }

	const conditions: any[] = [
		{ attribute: 'projectId', comparator: 'equals', value: params.projectId },
		{ attribute: 'status', comparator: 'equals', value: 'active' },
	];

	const entries = [];
	for await (const record of SynapseEntry.search({ conditions, limit: params.limit || 50 })) {
		entries.push(record);
	}

	if (entries.length === 0) {
		return { target: params.target, projectId: params.projectId, entryCount: 0, output: '' };
	}

	// Format based on target
	if (params.target === 'markdown' || params.target === 'claude_code' || params.target === 'copilot') {
		const lines = ['# Synapse Context:', ''];
		for (const e of entries) {
			lines.push(`## ${e.type || 'context'}`);
			lines.push(e.content || e.summary || '');
			lines.push('');
		}
		return { target: params.target, projectId: params.projectId, entryCount: entries.length, output: lines.join('\n') };
	}

	if (params.target === 'cursor') {
		const files = entries.map((e, i) => ({
			filename: `synapse-${i}.mdc`,
			content: `---\ndescription: ${e.summary || e.type}\n---\n\n${e.content || ''}`,
		}));
		return {
			target: 'cursor',
			projectId: params.projectId,
			entryCount: entries.length,
			output: { format: 'cursor_rules', files },
		};
	}

	if (params.target === 'windsurf') {
		const files = entries.map((e, i) => ({
			filename: `synapse-${i}.md`,
			content: `# ${e.type || 'context'}\n\n${e.content || ''}`,
		}));
		return {
			target: 'windsurf',
			projectId: params.projectId,
			entryCount: entries.length,
			output: { format: 'windsurf_rules', files },
		};
	}

	return { error: 'Unsupported target' };
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

const TOOLS: Record<string, { description: string; inputSchema: any; handler: (params: any) => Promise<any> }> = {
	memory_search: {
		description: 'Search memories by semantic similarity',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Natural language search query' },
				limit: { type: 'number', description: 'Max results (default 5)' },
				filters: { type: 'object', description: 'Optional metadata filters' },
			},
			required: ['query'],
		},
		handler: memorySearch,
	},
	memory_store: {
		description: 'Store a new memory',
		inputSchema: {
			type: 'object',
			properties: {
				text: { type: 'string', description: 'Memory content to store' },
				source: { type: 'string', description: 'Source (e.g., "claude", "api")' },
				classification: { type: 'string', description: 'Classification tag' },
				agentId: { type: 'string', description: 'Agent/user namespace' },
			},
			required: ['text'],
		},
		handler: memoryStore,
	},
	memory_recall: {
		description: 'Retrieve a specific memory by ID',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string', description: 'Memory ID' } },
			required: ['id'],
		},
		handler: memoryRecall,
	},
	memory_forget: {
		description: 'Delete a memory by ID',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string', description: 'Memory ID to delete' } },
			required: ['id'],
		},
		handler: memoryForget,
	},
	memory_count: {
		description: 'Count stored memories',
		inputSchema: {
			type: 'object',
			properties: {
				filters: { type: 'object', description: 'Optional metadata filters' },
			},
		},
		handler: memoryCount,
	},
	synapse_search: {
		description: 'Search development context by semantic similarity',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Natural language search query' },
				projectId: { type: 'string', description: 'Project ID to search within' },
				limit: { type: 'number', description: 'Max results (default 5)' },
				filters: { type: 'object', description: 'Optional filters' },
			},
			required: ['query', 'projectId'],
		},
		handler: synapseSearch,
	},
	synapse_ingest: {
		description: 'Ingest development context from a tool',
		inputSchema: {
			type: 'object',
			properties: {
				source: { type: 'string', description: 'Source tool (claude_code, cursor, windsurf, copilot, manual, slack)' },
				content: { type: 'string', description: 'Context content to ingest' },
				projectId: { type: 'string', description: 'Project ID' },
				parentId: { type: 'string', description: 'Parent entry ID' },
				references: { type: 'array', items: { type: 'string' }, description: 'Related entry IDs' },
			},
			required: ['source', 'content', 'projectId'],
		},
		handler: synapseIngest,
	},
	synapse_emit: {
		description: 'Export Synapse entries in a tool-native format',
		inputSchema: {
			type: 'object',
			properties: {
				target: { type: 'string', description: 'Target format (cursor, windsurf, markdown, claude_code, copilot)' },
				projectId: { type: 'string', description: 'Project ID' },
				types: { type: 'array', items: { type: 'string' }, description: 'Filter by entry types' },
				limit: { type: 'number', description: 'Max entries (default 50)' },
			},
			required: ['target', 'projectId'],
		},
		handler: synapseEmit,
	},
};

// ---------------------------------------------------------------------------
// MCP JSON-RPC Handler
// ---------------------------------------------------------------------------

export class McpEndpoint extends Resource {
	/**
	 * Handle MCP JSON-RPC requests over Streamable HTTP.
	 * Supports: tools/list, tools/call, initialize
	 */
	async post(data: any) {
		const { method, params, id } = data || {};

		// MCP initialize handshake
		if (method === 'initialize') {
			return {
				jsonrpc: '2.0',
				id,
				result: {
					protocolVersion: '2025-03-26',
					capabilities: { tools: {} },
					serverInfo: {
						name: 'cortex-mcp-server',
						version: '1.0.1',
					},
				},
			};
		}

		// List available tools
		if (method === 'tools/list') {
			const tools = Object.entries(TOOLS).map(([name, tool]) => ({
				name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			}));
			return { jsonrpc: '2.0', id, result: { tools } };
		}

		// Call a tool
		if (method === 'tools/call') {
			const toolName = params?.name;
			const toolArgs = params?.arguments || {};

			const tool = TOOLS[toolName];
			if (!tool) {
				return {
					jsonrpc: '2.0',
					id,
					result: {
						content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
						isError: true,
					},
				};
			}

			try {
				const result = await tool.handler(toolArgs);
				return {
					jsonrpc: '2.0',
					id,
					result: {
						content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					jsonrpc: '2.0',
					id,
					result: {
						content: [{ type: 'text', text: `Error: ${message}` }],
						isError: true,
					},
				};
			}
		}

		// Unknown method
		return {
			jsonrpc: '2.0',
			id,
			error: { code: -32601, message: `Method not found: ${method}` },
		};
	}
}
