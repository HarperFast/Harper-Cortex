/**
 * Synapse tools for cortex-mcp-server
 * Exposes: synapse_search, synapse_ingest
 */

import { z } from 'zod';
import { cortexFetch, type ToolContext } from './cortex-fetch.js';

/**
 * synapse_search: Search development context by semantic similarity
 */
export const synapseSearchSchema = z.object({
	query: z.string().describe('Natural language search query'),
	projectId: z.string().describe('Project ID to search within'),
	limit: z.number().optional().describe('Maximum number of results (default: 5)'),
	filters: z.record(z.any()).optional().describe('Optional filters (type, source, status)'),
});

export async function handleSynapseSearch(
	context: ToolContext,
	input: z.infer<typeof synapseSearchSchema>,
): Promise<string> {
	const endpoint = `/SynapseSearch`;
	const body = {
		query: input.query,
		projectId: input.projectId,
		limit: input.limit || 5,
		filters: input.filters || {},
	};

	const response = await cortexFetch(context, endpoint, {
		method: 'POST',
		body: JSON.stringify(body),
	});

	const results = response.results || [];
	return JSON.stringify(
		{
			count: results.length,
			projectId: input.projectId,
			results: results.map((r: any) => ({
				id: r.id,
				type: r.type,
				content: r.content,
				source: r.source,
				summary: r.summary,
				similarity: r.similarity || 0,
				createdAt: r.createdAt,
			})),
		},
		null,
		2,
	);
}

/**
 * synapse_ingest: Ingest development context from a tool/source
 */
export const synapseIngestSchema = z.object({
	source: z
		.enum(['claude_code', 'cursor', 'windsurf', 'copilot', 'manual', 'slack'] as const)
		.describe('Source of the synapse entry'),
	content: z.string().describe('Context content to ingest'),
	projectId: z.string().describe('Project ID for context'),
	parentId: z.string().optional().describe('Parent entry ID (for nested context)'),
	references: z.array(z.string()).optional().describe('Related entry IDs'),
});

export async function handleSynapseIngest(
	context: ToolContext,
	input: z.infer<typeof synapseIngestSchema>,
): Promise<string> {
	const endpoint = `/SynapseIngest`;
	const body = {
		source: input.source,
		content: input.content,
		projectId: input.projectId,
		parentId: input.parentId,
		references: input.references,
	};

	const response = await cortexFetch(context, endpoint, {
		method: 'POST',
		body: JSON.stringify(body),
	});

	const stored = response.stored || [];
	return JSON.stringify(
		{
			count: stored.length,
			projectId: input.projectId,
			stored: stored.map((entry: any) => ({
				summary: entry.summary,
				type: entry.type,
			})),
			timestamp: new Date().toISOString(),
		},
		null,
		2,
	);
}
