/**
 * Memory tools for cortex-mcp-server
 * Exposes: memory_search, memory_store, memory_recall, memory_forget, memory_count
 */

import { z } from 'zod';
import { verifyRecordOwnership } from '../namespace.js';
import { sanitizeForRetrieval, sanitizeForStorage } from '../safety.js';
import { cortexFetch, type ToolContext } from './cortex-fetch.js';

/**
 * memory_search: Search memories by semantic similarity
 */
export const memorySearchSchema = z.object({
	query: z.string().describe('Natural language search query'),
	limit: z.number().optional().describe('Maximum number of results (default: 5)'),
	filters: z.record(z.any()).optional().describe('Optional metadata filters'),
});

export async function handleMemorySearch(
	context: ToolContext,
	input: z.infer<typeof memorySearchSchema>,
): Promise<string> {
	const endpoint = `/MemorySearch`;
	const body = {
		query: input.query,
		limit: input.limit || 5,
		filters: {
			...(input.filters || {}),
			...(context.userId ? { agentId: context.userId } : {}),
		},
	};

	const response = await cortexFetch(context, endpoint, {
		method: 'POST',
		body: JSON.stringify(body),
	});

	const results = response.results || [];
	return JSON.stringify(
		{
			count: results.length,
			results: results.map((r: any) => ({
				id: r.id,
				text: sanitizeForRetrieval(r.rawText),
				source: r.source,
				classification: r.classification,
				similarity: r.similarity || 0,
				timestamp: r.timestamp,
			})),
		},
		null,
		2,
	);
}

/**
 * memory_store: Store a new memory
 */
export const memoryStoreSchema = z.object({
	text: z.string().describe('Memory content to store'),
	source: z.string().optional().describe('Source of the memory (e.g., "claude", "api")'),
	classification: z
		.string()
		.optional()
		.describe('Classification tag (e.g., "decision", "fact")'),
	metadata: z.record(z.any()).optional().describe('Additional metadata'),
});

export async function handleMemoryStore(
	context: ToolContext,
	input: z.infer<typeof memoryStoreSchema>,
): Promise<string> {
	// Sanitize input before storage
	const sanitized = sanitizeForStorage(input.text);

	// If blocked, return rejection response
	if (sanitized.blocked) {
		return JSON.stringify(
			{
				stored: false,
				blocked: true,
				reason: `Content rejected: ${sanitized.warnings.join('; ')}`,
			},
			null,
			2,
		);
	}

	const endpoint = `/MemoryStore`;
	const body = {
		text: sanitized.sanitized,
		source: input.source || 'mcp',
		classification: input.classification,
		metadata: input.metadata,
		...(context.userId ? { agentId: context.userId } : {}),
	};

	const response = await cortexFetch(context, endpoint, {
		method: 'POST',
		body: JSON.stringify(body),
	});

	const result: any = {
		id: response.id,
		status: 'stored',
		timestamp: new Date().toISOString(),
	};

	// Include warnings if any
	if (sanitized.warnings.length > 0) {
		result.warnings = sanitized.warnings;
	}

	return JSON.stringify(result, null, 2);
}

/**
 * memory_recall: Retrieve a specific memory by ID
 */
export const memoryRecallSchema = z.object({
	id: z.string().describe('Memory ID to retrieve'),
});

export async function handleMemoryRecall(
	context: ToolContext,
	input: z.infer<typeof memoryRecallSchema>,
): Promise<string> {
	const endpoint = `/MemoryTable/${input.id}`;

	const response = await cortexFetch(context, endpoint, {
		method: 'GET',
	});

	// Verify ownership if userId is set
	if (context.userId && !verifyRecordOwnership(response, context.userId)) {
		return JSON.stringify(
			{
				error: 'Memory not found',
			},
			null,
			2,
		);
	}

	return JSON.stringify(
		{
			id: response.id,
			text: response.rawText,
			source: response.source,
			classification: response.classification,
			timestamp: response.timestamp,
			metadata: response.metadata,
		},
		null,
		2,
	);
}

/**
 * memory_forget: Delete a memory by ID
 */
export const memoryForgetSchema = z.object({
	id: z.string().describe('Memory ID to delete'),
});

export async function handleMemoryForget(
	context: ToolContext,
	input: z.infer<typeof memoryForgetSchema>,
): Promise<string> {
	const endpoint = `/MemoryTable/${input.id}`;

	// First GET the record to verify ownership
	const record = await cortexFetch(context, endpoint, {
		method: 'GET',
	});

	// Verify ownership if userId is set
	if (context.userId && !verifyRecordOwnership(record, context.userId)) {
		return JSON.stringify(
			{
				error: 'Memory not found',
			},
			null,
			2,
		);
	}

	await cortexFetch(context, endpoint, {
		method: 'DELETE',
	});

	return JSON.stringify(
		{
			id: input.id,
			status: 'deleted',
			timestamp: new Date().toISOString(),
		},
		null,
		2,
	);
}

/**
 * memory_count: Count memories, optionally filtered
 */
export const memoryCountSchema = z.object({
	filters: z.record(z.any()).optional().describe('Optional metadata filters'),
});

export async function handleMemoryCount(
	context: ToolContext,
	input: z.infer<typeof memoryCountSchema>,
): Promise<string> {
	const endpoint = `/MemoryCount`;
	const body = {
		filters: {
			...(input.filters || {}),
			...(context.userId ? { agentId: context.userId } : {}),
		},
	};

	const response = await cortexFetch(context, endpoint, {
		method: 'POST',
		body: JSON.stringify(body),
	});

	return JSON.stringify(
		{
			count: response.count || 0,
			timestamp: new Date().toISOString(),
		},
		null,
		2,
	);
}
