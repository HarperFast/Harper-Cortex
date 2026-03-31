/**
 * Memory namespace — CRUD and semantic search for memories.
 */

import { HttpClient } from './client.js';
import {
	MemoryBatchUpsertResponse,
	MemoryCountRequest,
	MemoryCountResponse,
	MemoryRecord,
	MemorySearchRequest,
	MemorySearchResponse,
	MemoryStoreRequest,
	MemoryVectorSearchRequest,
} from './types.js';

/**
 * Memory namespace for the Cortex client.
 * Provides search, store, CRUD, count, and vector search operations.
 */
export class Memory {
	private http: HttpClient;

	constructor(http: HttpClient) {
		this.http = http;
	}

	/**
	 * Search memories by semantic query.
	 * Embedding is generated server-side; results include similarity scores.
	 *
	 * @param query - Text query to search for
	 * @param options - Search limit and attribute filters
	 * @returns Promise with results and count
	 *
	 * @example
	 * const result = await cortex.memory.search('caching strategy', {
	 *   limit: 5,
	 *   filters: { classification: 'decision' }
	 * });
	 */
	async search(query: string, options?: Partial<MemorySearchRequest>): Promise<MemorySearchResponse> {
		const body: MemorySearchRequest = {
			query,
			limit: options?.limit,
			filters: options?.filters,
		};
		const response = await this.http.post<any>('MemorySearch', undefined, body);
		return this.normalizeSearchResponse(response);
	}

	/**
	 * Store a memory record.
	 * Server-side embedding generation is optional; you can pass an embedding.
	 *
	 * @param record - Memory record with required text field
	 * @returns Promise with the stored record (including server-assigned ID)
	 *
	 * @example
	 * const memory = await cortex.memory.store({
	 *   text: 'We chose Redis for caching',
	 *   source: 'slack',
	 *   classification: 'decision'
	 * });
	 */
	async store(record: MemoryStoreRequest): Promise<MemoryRecord> {
		return this.http.post<MemoryRecord>('MemoryStore', undefined, record);
	}

	/**
	 * Get a memory by ID.
	 *
	 * @param id - Memory record ID
	 * @returns Promise with the memory record (embedding stripped server-side)
	 *
	 * @example
	 * const memory = await cortex.memory.get('memory-abc123');
	 */
	async get(id: string): Promise<MemoryRecord> {
		return this.http.get<MemoryRecord>('MemoryTable', id);
	}

	/**
	 * Delete a memory by ID.
	 *
	 * @param id - Memory record ID
	 * @returns Promise with the deletion result
	 *
	 * @example
	 * await cortex.memory.delete('memory-abc123');
	 */
	async delete(id: string): Promise<any> {
		return this.http.delete<any>('MemoryTable', id);
	}

	/**
	 * Count memories matching optional filters.
	 * Useful for pagination or monitoring total memory size.
	 *
	 * @param request - Count request with optional filters
	 * @returns Promise with count result
	 *
	 * @example
	 * const { count } = await cortex.memory.count({
	 *   filters: { source: 'slack' }
	 * });
	 */
	async count(request?: MemoryCountRequest): Promise<MemoryCountResponse> {
		return this.http.post<MemoryCountResponse>('MemoryCount', undefined, request || {});
	}

	/**
	 * Search memories by raw vector (skips embedding generation).
	 * Use when you have a pre-computed embedding or custom embeddings.
	 *
	 * @param vector - Embedding vector (matching Cortex's embedding dimension)
	 * @param options - Search limit and filters
	 * @returns Promise with results and count
	 * @throws {CortexError} If VectorSearch endpoint is not available
	 *
	 * @example
	 * const results = await cortex.memory.vectorSearch(
	 *   [0.1, 0.2, 0.3, ...], // your embedding
	 *   { limit: 10, filter: { source: 'slack' } }
	 * );
	 */
	async vectorSearch(vector: number[], options?: Partial<MemoryVectorSearchRequest>): Promise<MemorySearchResponse> {
		const body: MemoryVectorSearchRequest = {
			vector,
			limit: options?.limit,
			filter: options?.filter,
		};
		try {
			const response = await this.http.post<any>('VectorSearch', undefined, body);
			return this.normalizeSearchResponse(response);
		} catch (err: any) {
			if (err.status === 404) {
				err.message =
					'VectorSearch endpoint not available — ensure your Cortex instance has the VectorSearch resource deployed.';
			}
			throw err;
		}
	}

	/**
	 * Bulk store memory records.
	 * Useful for bulk imports or syncs from external sources.
	 * Uses individual PUT requests for reliability and detailed error tracking.
	 *
	 * @param records - Array of memory records to store
	 * @returns Promise with store statistics
	 *
	 * @example
	 * const result = await cortex.memory.bulkStore([
	 *   { rawText: 'Decision 1', source: 'slack' },
	 *   { rawText: 'Decision 2', source: 'api' }
	 * ]);
	 */
	async bulkStore(records: MemoryRecord[]): Promise<MemoryBatchUpsertResponse> {
		// Use individual PUT requests to the MemoryTable for each record
		let upserted = 0;
		let failed = 0;
		const errors: Array<{ index: number; error: string }> = [];

		for (let i = 0; i < records.length; i++) {
			try {
				const record = records[i];
				const id = record.id || crypto.randomUUID();
				await this.http.put('MemoryTable', id, { ...record, id });
				upserted++;
			} catch (err: any) {
				failed++;
				errors.push({ index: i, error: err.message });
			}
		}

		return { upserted, failed, ...(errors.length > 0 ? { errors } : {}) } as MemoryBatchUpsertResponse;
	}

	/**
	 * Normalize search response to include similarity (0-1) alongside raw distance.
	 * Harper returns $distance in cosine space; we normalize it to similarity.
	 */
	private normalizeSearchResponse(response: any): MemorySearchResponse {
		const results = (response.results || []).map((result: any) => {
			const distance = result.$distance ?? 0;
			// Cosine distance to similarity: similarity = 1 - distance
			return {
				...result,
				similarity: Math.max(0, Math.min(1, 1 - distance)),
			};
		});
		return {
			results,
			count: response.count || results.length,
		};
	}
}
