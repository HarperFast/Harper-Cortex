/**
 * Tool definitions for memory_recall, memory_store, and memory_forget
 */

import type { CortexMemoryDB } from './memory-db.js';
import { sanitizeMemory, validateMemoryEntry } from './safety.js';
import type { ToolContext } from './types.js';

/**
 * Define memory tools that agents can call
 */
export function createMemoryTools(db: CortexMemoryDB, context: ToolContext) {
	return {
		memory_recall: {
			description: 'Search and recall relevant memories by semantic similarity',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Search query to find relevant memories',
					},
					limit: {
						type: 'number',
						description: 'Maximum number of results to return (default: 5, max: 20)',
						default: 5,
					},
					minSimilarity: {
						type: 'number',
						description: 'Minimum similarity score for results (0-1, default: 0.3)',
						default: 0.3,
					},
				},
				required: ['query'],
			},
			handler: async (input: {
				query: string;
				limit?: number;
				minSimilarity?: number;
			}) => {
				try {
					const limit = Math.min(input.limit || 5, 20);
					const minSim = input.minSimilarity || 0.3;

					const results = await db.search(input.query, limit, context.agentId);
					const filtered = results.filter((r) => r.score >= minSim);

					if (filtered.length === 0) {
						return {
							success: true,
							results: [],
							message: 'No memories found matching the query.',
						};
					}

					return {
						success: true,
						results: filtered.map((r) => ({
							text: r.entry.text,
							importance: r.entry.importance,
							category: r.entry.category,
							similarity: parseFloat(r.score.toFixed(3)),
							createdAt: new Date(r.entry.createdAt).toISOString(),
						})),
						count: filtered.length,
					};
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error',
					};
				}
			},
		},

		memory_store: {
			description: 'Store a new fact or observation in long-term memory',
			parameters: {
				type: 'object',
				properties: {
					text: {
						type: 'string',
						description: 'The memory content to store',
					},
					category: {
						type: 'string',
						enum: ['fact', 'preference', 'procedure', 'event'],
						description: 'Type of memory',
						default: 'fact',
					},
					importance: {
						type: 'number',
						description: 'Importance score (0-1, default: 0.7)',
						default: 0.7,
					},
				},
				required: ['text'],
			},
			handler: async (input: {
				text: string;
				category?: string;
				importance?: number;
			}) => {
				try {
					// Validate input
					const validation = validateMemoryEntry({
						text: input.text,
						category: input.category || 'fact',
						importance: input.importance || 0.7,
					});

					if (!validation.valid) {
						return {
							success: false,
							errors: validation.errors,
						};
					}

					// Sanitize the memory content
					const sanitized = sanitizeMemory(input.text);
					if (sanitized.warnings.length > 0) {
						console.warn('Memory sanitization warnings:', sanitized.warnings);
					}

					// Store the memory
					const id = await db.store({
						text: sanitized.sanitized,
						category: input.category || 'fact',
						importance: input.importance || 0.7,
						agentId: context.agentId,
					});

					return {
						success: true,
						id,
						message: `Memory stored successfully (ID: ${id})`,
						warnings: sanitized.warnings,
					};
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error',
					};
				}
			},
		},

		memory_forget: {
			description: 'Delete a memory by ID (GDPR compliance, corrections)',
			parameters: {
				type: 'object',
				properties: {
					id: {
						type: 'string',
						description: 'The UUID of the memory to delete',
					},
				},
				required: ['id'],
			},
			handler: async (input: { id: string }) => {
				try {
					// Validate UUID format
					if (!/^[0-9a-f-]{36}$/i.test(input.id)) {
						return {
							success: false,
							error: 'Invalid memory ID format (expected UUID)',
						};
					}

					// Delete the memory
					await db.delete(input.id);

					return {
						success: true,
						id: input.id,
						message: `Memory ${input.id} deleted successfully`,
					};
				} catch (error) {
					return {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error',
					};
				}
			},
		},
	};
}

export interface MemoryRecallResult {
	success: boolean;
	results?: Array<{
		text: string;
		importance: number;
		category: string;
		similarity: number;
		createdAt: string;
	}>;
	count?: number;
	message?: string;
	error?: string;
}

export interface MemoryStoreResult {
	success: boolean;
	id?: string;
	message?: string;
	warnings?: string[];
	errors?: string[];
	error?: string;
}

export interface MemoryForgetResult {
	success: boolean;
	id?: string;
	message?: string;
	error?: string;
}
