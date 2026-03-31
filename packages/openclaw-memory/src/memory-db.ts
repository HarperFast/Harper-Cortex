/**
 * CortexMemoryDB — thin wrapper around CortexClient for OpenClaw compatibility
 *
 * Maps between OpenClaw's MemoryEntry interface and Cortex's MemoryRecord,
 * using @harperfast/cortex-client for all HTTP operations.
 */

import { CortexClient } from '@harperfast/cortex-client';
import { v4 as uuid } from 'uuid';
import type { HarperMemoryConfig, MemoryEntry, MemorySearchResult } from './types.js';

export class CortexMemoryDB {
	private cortex: CortexClient;
	private agentId?: string;

	constructor(config: HarperMemoryConfig) {
		if (!config.instanceUrl) {
			throw new Error('instanceUrl is required');
		}

		this.cortex = new CortexClient({
			instanceUrl: config.instanceUrl,
			token: config.token,
			schema: config.schema ?? 'data',
		});

		this.agentId = config.agentId;
	}

	/**
	 * Store a new memory entry.
	 * Cortex handles embedding server-side via cortex.memory.store().
	 */
	async store(
		entry: Omit<MemoryEntry, 'id' | 'createdAt'>,
	): Promise<string> {
		const record = await this.cortex.memory.store({
			text: entry.text,
			source: 'openclaw',
			sourceType: entry.category,
			classification: entry.category,
			authorId: this.agentId,
			metadata: {
				importance: entry.importance,
				category: entry.category,
			},
		});

		return record.id || uuid();
	}

	/**
	 * Search memories by semantic similarity.
	 * Uses cortex.memory.search() with server-side embedding.
	 */
	async search(
		query: string,
		limit: number = 5,
		agentId?: string,
	): Promise<MemorySearchResult[]> {
		const response = await this.cortex.memory.search(query, {
			limit,
			filters: agentId ? { authorId: agentId } : undefined,
		});

		return response.results.map((r: any) => ({
			entry: {
				id: r.id ?? uuid(),
				text: r.rawText,
				importance: (r.metadata?.importance as number) ?? 1,
				category: (r.sourceType as string) ?? 'fact',
				agentId: r.authorId,
				createdAt: new Date(r.timestamp ?? Date.now()).getTime(),
			},
			score: r.similarity ?? 0,
		}));
	}

	/**
	 * Delete a memory by ID.
	 */
	async delete(id: string): Promise<void> {
		// Validate UUID format for safety
		if (!/^[0-9a-f-]{36}$/i.test(id)) {
			throw new Error('Invalid memory ID format');
		}

		await this.cortex.memory.delete(id);
	}

	/**
	 * Count total stored memories.
	 */
	async count(agentId?: string): Promise<number> {
		const response = await this.cortex.memory.count({
			filters: agentId ? { authorId: agentId } : undefined,
		});
		return response.count ?? 0;
	}

	/** Batch store multiple memory entries. */
	async storeBatch(
		entries: Omit<MemoryEntry, 'id' | 'createdAt'>[],
	): Promise<string[]> {
		const records = entries.map((entry) => ({
			id: uuid(),
			rawText: entry.text,
			source: 'openclaw',
			sourceType: entry.category,
			classification: entry.category,
			authorId: this.agentId,
			metadata: {
				importance: entry.importance,
				category: entry.category,
			},
		}));

		const result = await this.cortex.memory.bulkStore(records);
		return records.map((r) => r.id);
	}

	/**
	 * Retrieve a single memory by ID.
	 */
	async get(id: string): Promise<MemoryEntry | null> {
		try {
			const record = await this.cortex.memory.get(id);
			return {
				id: record.id ?? id,
				text: record.rawText,
				importance: (record.metadata?.importance as number) ?? 1,
				category: (record.sourceType as string) ?? 'fact',
				agentId: record.authorId,
				createdAt: new Date(record.timestamp ?? Date.now()).getTime(),
			};
		} catch (error) {
			// Cortex returns error if not found; return null for consistency
			return null;
		}
	}
}
