/**
 * Synapse namespace — context broker for multi-tool workflows.
 */

import { HttpClient } from './client.js';
import {
	SynapseEmitRequest,
	SynapseEmitResponse,
	SynapseEntryRecord,
	SynapseIngestRequest,
	SynapseIngestResponse,
	SynapseSearchRequest,
	SynapseSearchResponse,
} from './types.js';

/**
 * Synapse namespace for the Cortex client.
 * Provides cross-tool context ingestion, search, and emission.
 */
export class Synapse {
	private http: HttpClient;

	constructor(http: HttpClient) {
		this.http = http;
	}

	/**
	 * Search Synapse entries across a project.
	 * Semantic search with optional type and source filters.
	 *
	 * @param query - Text query for semantic search
	 * @param request - Search configuration (projectId required)
	 * @returns Promise with results and count
	 *
	 * @example
	 * const results = await cortex.synapse.search('architecture decisions', {
	 *   projectId: 'my-project',
	 *   limit: 5,
	 *   filters: { type: 'intent' }
	 * });
	 */
	async search(
		query: string,
		request: Partial<SynapseSearchRequest> & { projectId: string },
	): Promise<SynapseSearchResponse> {
		const body: SynapseSearchRequest = {
			query,
			projectId: request.projectId,
			limit: request.limit,
			filters: request.filters,
		};
		const response = await this.http.post<any>('SynapseSearch', undefined, body);
		return this.normalizeSearchResponse(response);
	}

	/**
	 * Ingest context from a tool-native format (CLAUDE.md, .mdc rules, etc.).
	 * Parses and classifies entries server-side.
	 *
	 * @param request - Ingest request with source, content, projectId
	 * @returns Promise with stored entries and count
	 *
	 * @example
	 * const result = await cortex.synapse.ingest({
	 *   source: 'claude_code',
	 *   content: '## Decision\nUse Redis for caching',
	 *   projectId: 'my-project'
	 * });
	 */
	async ingest(request: SynapseIngestRequest): Promise<SynapseIngestResponse> {
		return this.http.post<SynapseIngestResponse>('SynapseIngest', undefined, request);
	}

	/**
	 * Emit Synapse entries in a target tool's native format.
	 * Returns CLAUDE.md, .mdc rules, markdown, etc. based on target.
	 *
	 * @param request - Emit request with target, projectId, optional types and limit
	 * @returns Promise with formatted output string or files
	 *
	 * @example
	 * const result = await cortex.synapse.emit({
	 *   target: 'cursor',
	 *   projectId: 'my-project',
	 *   types: ['intent', 'constraint']
	 * });
	 * // result.output is an object with { format, files: [...] }
	 */
	async emit(request: SynapseEmitRequest): Promise<SynapseEmitResponse> {
		return this.http.post<SynapseEmitResponse>('SynapseEmit', undefined, request);
	}

	/**
	 * Get a Synapse entry by ID.
	 *
	 * @param id - Entry record ID
	 * @returns Promise with the entry record
	 *
	 * @example
	 * const entry = await cortex.synapse.get('entry-abc123');
	 */
	async get(id: string): Promise<SynapseEntryRecord> {
		return this.http.get<SynapseEntryRecord>('SynapseEntry', id);
	}

	/**
	 * Delete a Synapse entry by ID.
	 *
	 * @param id - Entry record ID
	 * @returns Promise with the deletion result
	 *
	 * @example
	 * await cortex.synapse.delete('entry-abc123');
	 */
	async delete(id: string): Promise<any> {
		return this.http.delete<any>('SynapseEntry', id);
	}

	/**
	 * Normalize search response to include similarity (0-1) alongside raw distance.
	 */
	private normalizeSearchResponse(response: any): SynapseSearchResponse {
		const results = (response.results || []).map((result: any) => {
			const distance = result.$distance ?? 0;
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
