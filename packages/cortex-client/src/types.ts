/**
 * Core types for the Cortex client.
 * Represents the Memory and Synapse tables and all API request/response shapes.
 */

// ============================================================================
// Memory Types
// ============================================================================

export interface Entity {
	people?: string[];
	projects?: string[];
	technologies?: string[];
	topics?: string[];
	dates?: string[];
}

export interface MemoryRecord {
	id?: string;
	rawText: string;
	source: string;
	sourceType?: string;
	channelId?: string;
	channelName?: string;
	authorId?: string;
	authorName?: string;
	classification?: string;
	entities?: Entity;
	embedding?: number[];
	summary?: string;
	timestamp?: Date | string;
	threadTs?: string;
	metadata?: Record<string, any>;
}

export interface MemorySearchResult {
	id: string;
	rawText: string;
	source: string;
	sourceType?: string;
	channelId?: string;
	channelName?: string;
	authorId?: string;
	authorName?: string;
	classification?: string;
	entities?: Entity;
	summary?: string;
	timestamp?: Date | string;
	threadTs?: string;
	$distance?: number;
	similarity?: number; // normalized 0-1
}

export interface MemorySearchRequest {
	query: string;
	limit?: number;
	filters?: {
		source?: string;
		sourceType?: string;
		channelId?: string;
		authorId?: string;
		classification?: string;
		[key: string]: any;
	};
}

export interface MemorySearchResponse {
	results: MemorySearchResult[];
	count: number;
}

export interface MemoryStoreRequest {
	text: string;
	source?: string;
	sourceType?: string;
	channelId?: string;
	channelName?: string;
	authorId?: string;
	authorName?: string;
	classification?: string;
	entities?: Entity;
	summary?: string;
	timestamp?: Date | string;
	threadTs?: string;
	metadata?: Record<string, any>;
	dedupThreshold?: number;
}

export interface MemoryCountRequest {
	filters?: {
		source?: string;
		sourceType?: string;
		channelId?: string;
		authorId?: string;
		classification?: string;
		[key: string]: any;
	};
}

export interface MemoryCountResponse {
	count: number;
}

export interface MemoryVectorSearchRequest {
	vector: number[];
	limit?: number;
	filter?: Record<string, any>;
}

export interface MemoryBatchUpsertResponse {
	upserted: number;
	failed: number;
	errors?: Array<{ index: number; error: string }>;
}

// ============================================================================
// Synapse Types
// ============================================================================

export type SynapseType = 'intent' | 'constraint' | 'artifact' | 'history';
export type SynapseSource = 'claude_code' | 'cursor' | 'windsurf' | 'copilot' | 'manual' | 'slack';
export type SynapseEmitTarget = 'claude_code' | 'cursor' | 'windsurf' | 'copilot' | 'markdown';

export interface SynapseEntity {
	people?: string[];
	projects?: string[];
	technologies?: string[];
	topics?: string[];
}

export interface SynapseEntryRecord {
	id?: string;
	projectId: string;
	type?: SynapseType;
	content: string;
	source?: SynapseSource;
	sourceFormat?: string;
	embedding?: number[];
	summary?: string;
	status?: 'active' | 'archived' | 'deleted';
	references?: string[];
	tags?: string[];
	entities?: SynapseEntity;
	parentId?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	metadata?: Record<string, any>;
}

export interface SynapseSearchResult {
	id: string;
	projectId: string;
	type: SynapseType;
	content: string;
	source: SynapseSource;
	sourceFormat?: string;
	summary: string;
	status: string;
	references?: string[];
	tags?: string[];
	entities?: SynapseEntity;
	parentId?: string;
	createdAt?: Date | string;
	updatedAt?: Date | string;
	$distance?: number;
	similarity?: number; // normalized 0-1
}

export interface SynapseSearchRequest {
	query: string;
	projectId: string;
	limit?: number;
	filters?: {
		type?: SynapseType;
		source?: SynapseSource;
		status?: string;
		[key: string]: any;
	};
}

export interface SynapseSearchResponse {
	results: SynapseSearchResult[];
	count: number;
}

export interface SynapseIngestRequest {
	source: SynapseSource;
	content: string;
	projectId: string;
	parentId?: string;
	references?: string[];
}

export interface SynapseIngestResponse {
	stored: Array<{ summary: string; type: SynapseType }>;
	count: number;
}

export interface SynapseEmitRequest {
	target: SynapseEmitTarget;
	projectId: string;
	types?: SynapseType[];
	limit?: number;
}

export interface SynapseEmitResponse {
	target: SynapseEmitTarget;
	projectId: string;
	entryCount: number;
	output: string | { format: string; files: Array<{ filename: string; content: string }> };
}

// ============================================================================
// Client Configuration
// ============================================================================

export interface CortexClientConfig {
	/** The base URL of the Cortex instance (e.g., https://my-instance.harpercloud.com) */
	instanceUrl: string;
	/** Optional authentication token (Basic or Bearer format) */
	token?: string;
	/**
	 * Optional schema prefix for URL construction.
	 * Defaults to empty string for Harper Fabric Custom Resources (mounts at /{ClassName}).
	 * Override with 'data' or other schema name for non-Fabric deployments that use /{schema}/{table} paths.
	 * @default ""
	 */
	schema?: string;
}

// ============================================================================
// HTTP Error Type
// ============================================================================

export class CortexError extends Error {
	public readonly status?: number;
	public readonly response?: any;

	constructor(message: string, status?: number, response?: any) {
		super(message);
		this.name = 'CortexError';
		this.status = status;
		this.response = response;
	}
}
