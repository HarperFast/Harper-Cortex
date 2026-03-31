/**
 * @harperfast/cortex-client
 *
 * Lightweight HTTP-only TypeScript client for Harper Cortex.
 * No Harper runtime required, no embeddings, just fetch + auth.
 *
 * @example
 * ```typescript
 * import { CortexClient } from '@harperfast/cortex-client';
 *
 * const cortex = new CortexClient({
 *   instanceUrl: 'https://my-instance.harpercloud.com',
 *   token: 'optional-bearer-token',
 * });
 *
 * // Search memories by semantic query
 * const memories = await cortex.memory.search('caching decision', { limit: 5 });
 *
 * // Store a memory
 * const stored = await cortex.memory.store({
 *   text: 'We chose Redis for caching',
 *   source: 'slack',
 *   classification: 'decision',
 * });
 *
 * // Ingest Synapse context from Claude Code
 * const synapse = await cortex.synapse.ingest({
 *   source: 'claude_code',
 *   content: '## Decision\nUse Redis',
 *   projectId: 'my-project',
 * });
 *
 * // Emit context for Cursor
 * const emitted = await cortex.synapse.emit({
 *   target: 'cursor',
 *   projectId: 'my-project',
 *   types: ['intent', 'constraint'],
 * });
 * ```
 */

import { HttpClient } from './client.js';
import { Memory } from './memory.js';
import { Synapse } from './synapse.js';
import { CortexClientConfig, CortexError } from './types.js';

/**
 * Main Cortex client.
 * Provides namespaced access to Memory and Synapse APIs.
 */
export class CortexClient {
	readonly memory: Memory;
	readonly synapse: Synapse;
	private http: HttpClient;

	/**
	 * Initialize a new Cortex client.
	 *
	 * @param config - Client configuration with instanceUrl and optional token
	 *
	 * @example
	 * const cortex = new CortexClient({
	 *   instanceUrl: 'https://my-instance.harpercloud.com',
	 *   token: 'optional-auth-token',
	 *   // schema defaults to empty string for Harper Fabric Custom Resources
	 *   // override with schema: 'data' for non-Fabric deployments
	 * });
	 */
	constructor(config: CortexClientConfig) {
		const schema = config.schema ?? '';
		this.http = new HttpClient({
			instanceUrl: config.instanceUrl,
			token: config.token,
			schema,
		});

		this.memory = new Memory(this.http);
		this.synapse = new Synapse(this.http);
	}
}

// Re-export all public types and errors
export type {
	CortexClientConfig,
	MemoryBatchUpsertResponse,
	MemoryCountRequest,
	MemoryCountResponse,
	MemoryRecord,
	MemorySearchRequest,
	MemorySearchResponse,
	MemorySearchResult,
	MemoryStoreRequest,
	MemoryVectorSearchRequest,
	SynapseEmitRequest,
	SynapseEmitResponse,
	SynapseEmitTarget,
	SynapseEntryRecord,
	SynapseIngestRequest,
	SynapseIngestResponse,
	SynapseSearchRequest,
	SynapseSearchResponse,
	SynapseSearchResult,
	SynapseSource,
	SynapseType,
} from './types.js';

export { CortexError };
