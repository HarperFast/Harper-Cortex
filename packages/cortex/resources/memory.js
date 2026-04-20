import { Resource, tables, transaction } from 'harper';
import { createHash, randomUUID } from 'node:crypto';
import { classifyMemory } from './classification-provider.js';
import {
	cortexError,
	DEFAULT_SEARCH_LIMIT,
	EMBEDDING_MODEL,
	generateEmbedding,
	log,
	MAX_SEARCH_LIMIT,
	VALID_CATEGORIES,
} from './shared.js';

const { Memory, SynapseEntry } = tables;

// Legacy Anthropic classification (used when CLASSIFICATION_PROVIDER is unset)

const CLASSIFICATION_MODEL = 'claude-haiku-3-5-20241022';

const CLASSIFICATION_SYSTEM_PROMPT =
	`You are a message classifier for a team memory system. Classify each message into exactly ONE category and extract key entities.

Categories: decision, action_item, knowledge, question, announcement, discussion, reference, status_update, feedback

Respond with valid JSON only, in this exact format:
{
  "category": "<category>",
  "entities": {
    "people": [],
    "projects": [],
    "technologies": [],
    "topics": [],
    "dates": []
  },
  "summary": "<one sentence summary>"
}`;

let anthropicClient;
async function getAnthropicClient() {
	if (!anthropicClient) {
		if (!process.env.ANTHROPIC_API_KEY) {
			throw new Error('ANTHROPIC_API_KEY environment variable is required');
		}
		const { default: Anthropic } = await import('@anthropic-ai/sdk');
		anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
	}
	return anthropicClient;
}

async function classifyWithLegacyAnthropic(text) {
	const client = await getAnthropicClient();
	const message = await client.messages.create({
		model: CLASSIFICATION_MODEL,
		max_tokens: 512,
		system: CLASSIFICATION_SYSTEM_PROMPT,
		messages: [
			{
				role: 'user',
				content: `Classify this Slack message:\n\n"${text}"`,
			},
		],
	});

	const parsed = JSON.parse(message.content[0].text);

	if (!parsed.category || !VALID_CATEGORIES.has(parsed.category)) {
		log('warn', 'LLM returned invalid category, using fallback', {
			returnedCategory: parsed.category,
		});
		parsed.category = 'discussion';
	}

	return {
		category: parsed.category,
		entities: parsed.entities || { people: [], projects: [], technologies: [], topics: [], dates: [] },
		summary: parsed.summary || text.substring(0, 100),
	};
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

export async function classifyMessage(text) {
	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		return createFallbackClassification(text);
	}

	try {
		// Try classification-provider first (supports multiple providers)
		const result = await classifyMemory(text);

		if (result) {
			// Map classification-provider's 'classification' field to our 'category' field
			const category = result.classification || 'discussion';
			if (!VALID_CATEGORIES.has(category)) {
				return createFallbackClassification(text);
			}
			return {
				category,
				entities: result.entities || { people: [], projects: [], technologies: [], topics: [], dates: [] },
				summary: result.summary || text.substring(0, 100),
			};
		}

		// classifyMemory returned null (no provider configured).
		// Fall back to legacy Anthropic SDK if ANTHROPIC_API_KEY is available.
		if (process.env.ANTHROPIC_API_KEY) {
			return await classifyWithLegacyAnthropic(text);
		}

		return createFallbackClassification(text);
	} catch (err) {
		log('error', 'Classification failed, using fallback', {
			error: err.message,
		});
		return createFallbackClassification(text);
	}
}

function createFallbackClassification(text) {
	return {
		category: 'discussion',
		entities: { people: [], projects: [], technologies: [], topics: [], dates: [] },
		summary: String(text || '').substring(0, 100),
	};
}

// ---------------------------------------------------------------------------
// MemorySearch - Semantic search endpoint
// ---------------------------------------------------------------------------

export class MemorySearch extends Resource {
	static async post(_req, data) {
		const { query, limit, filters } = data || {};

		if (!query || typeof query !== 'string' || query.trim().length === 0) {
			return cortexError(
				'missing-query',
				'Missing required field: query',
				400,
				'query is required and must be a non-empty string',
			);
		}

		if (process.env.REQUIRE_AGENT_NAMESPACE === 'true' && !filters?.agentId) {
			return cortexError(
				'missing-agent-id',
				'Missing required field: agentId',
				400,
				'agentId is required when REQUIRE_AGENT_NAMESPACE is enabled',
			);
		}

		const searchLimit = Math.min(
			Math.max(1, parseInt(limit, 10) || DEFAULT_SEARCH_LIMIT),
			MAX_SEARCH_LIMIT,
		);

		log('info', 'Memory search requested', { query, limit: searchLimit, filters });

		const queryEmbedding = await generateEmbedding(query);

		const searchParams = {
			select: [
				'id',
				'rawText',
				'source',
				'sourceType',
				'channelId',
				'channelName',
				'authorId',
				'authorName',
				'classification',
				'entities',
				'summary',
				'timestamp',
				'threadTs',
				'$distance',
			],
			sort: {
				attribute: 'embedding',
				target: queryEmbedding,
			},
			limit: searchLimit,
		};

		if (filters && typeof filters === 'object') {
			const conditions = [];

			if (filters.source) {
				conditions.push({ attribute: 'source', comparator: 'equals', value: filters.source });
			}
			if (filters.classification) {
				conditions.push({ attribute: 'classification', comparator: 'equals', value: filters.classification });
			}
			if (filters.channelId) {
				conditions.push({ attribute: 'channelId', comparator: 'equals', value: filters.channelId });
			}
			if (filters.authorId) {
				conditions.push({ attribute: 'authorId', comparator: 'equals', value: filters.authorId });
			}
			if (filters.agentId) {
				conditions.push({ attribute: 'agentId', comparator: 'equals', value: filters.agentId });
			}
			if (filters.sourceType) {
				conditions.push({ attribute: 'sourceType', comparator: 'equals', value: filters.sourceType });
			}

			if (conditions.length === 1) {
				searchParams.conditions = conditions[0];
			} else if (conditions.length > 1) {
				searchParams.conditions = conditions;
			}
		}

		const results = [];
		for await (const record of Memory.search(searchParams)) {
			// Normalize cosine distance to similarity score (0-1)
			const similarity = Math.max(0, 1 - (record.$distance || 0) / 2);
			results.push({
				...record,
				similarity,
			});
		}

		return { results, count: results.length };
	}
}

// ---------------------------------------------------------------------------
// Memory Count - Count memories with optional filtering
// ---------------------------------------------------------------------------

export class MemoryCount extends Resource {
	static async post(_req, data) {
		const { filters } = data || {};

		if (process.env.REQUIRE_AGENT_NAMESPACE === 'true' && !filters?.agentId) {
			return cortexError(
				'missing-agent-id',
				'Missing required field: agentId',
				400,
				'agentId is required when REQUIRE_AGENT_NAMESPACE is enabled',
			);
		}

		log('info', 'Memory count requested', { filters });

		const searchParams = {
			select: ['id'],
		};

		if (filters && typeof filters === 'object') {
			const conditions = [];

			if (filters.source) {
				conditions.push({ attribute: 'source', comparator: 'equals', value: filters.source });
			}
			if (filters.classification) {
				conditions.push({ attribute: 'classification', comparator: 'equals', value: filters.classification });
			}
			if (filters.channelId) {
				conditions.push({ attribute: 'channelId', comparator: 'equals', value: filters.channelId });
			}
			if (filters.authorId) {
				conditions.push({ attribute: 'authorId', comparator: 'equals', value: filters.authorId });
			}
			if (filters.agentId) {
				conditions.push({ attribute: 'agentId', comparator: 'equals', value: filters.agentId });
			}

			if (conditions.length === 1) {
				searchParams.conditions = conditions[0];
			} else if (conditions.length > 1) {
				searchParams.conditions = conditions;
			}
		}

		let count = 0;
		for await (const _record of Memory.search(searchParams)) {
			count++;
		}

		log('info', 'Memory count complete', { count, filters });
		return { count };
	}
}

// ---------------------------------------------------------------------------
// MemoryStore - Dedup-aware storage (SHA-256 hash + vector similarity)
// ---------------------------------------------------------------------------

export class MemoryStore extends Resource {
	static async post(_req, data) {
		const { text, dedupThreshold, agentId, channelId, authorId, sourceType, threadTs, supersedes } = data || {};

		if (!text || typeof text !== 'string' || text.trim().length === 0) {
			return cortexError(
				'missing-text',
				'Missing required field: text',
				400,
				'text is required and must be a non-empty string',
			);
		}

		log('info', 'Memory store requested', { dedupThreshold, hasDedup: !!dedupThreshold });

		const contentHash = createHash('sha256').update(text.trim().toLowerCase()).digest('hex');

		// Fast path: exact content hash match
		for await (
			const existing of Memory.search({
				select: ['id', 'summary', 'rawText'],
				conditions: { attribute: 'contentHash', comparator: 'equals', value: contentHash },
				limit: 1,
			})
		) {
			log('info', 'Exact duplicate detected via content hash', { existingId: existing.id });
			return {
				stored: false,
				deduplicated: true,
				action: 'exact_match',
				id: existing.id,
				summary: existing.summary,
			};
		}

		const embedding = await generateEmbedding(text);

		if (dedupThreshold && typeof dedupThreshold === 'number' && dedupThreshold > 0) {
			const searchParams = {
				select: ['id', 'rawText', 'summary', '$distance'],
				sort: {
					attribute: 'embedding',
					target: embedding,
				},
				limit: 5,
			};

			// Optionally filter by agentId or channelId to scope dedup
			if (agentId) {
				searchParams.conditions = { attribute: 'agentId', comparator: 'equals', value: agentId };
			}

			const potentialDupes = [];
			for await (const record of Memory.search(searchParams)) {
				const similarity = Math.max(0, 1 - (record.$distance || 0) / 2);
				if (similarity >= dedupThreshold) {
					potentialDupes.push({ ...record, similarity });
				}
			}

			if (potentialDupes.length > 0) {
				const duplicate = potentialDupes[0]; // Highest similarity (first result from HNSW)
				log('info', 'Memory deduplicated', {
					dedupId: duplicate.id,
					similarity: duplicate.similarity,
					threshold: dedupThreshold,
				});
				return {
					stored: false,
					deduplicated: true,
					action: 'fuzzy_match',
					id: duplicate.id,
					summary: duplicate.summary,
					similarity: duplicate.similarity,
					supersedes: null,
				};
			}
		}

		const classification = await classifyMessage(text);

		const memoryRecord = {
			id: randomUUID(),
			rawText: text,
			contentHash,
			source: 'api',
			sourceType: sourceType || 'direct',
			channelId: channelId || '',
			channelName: '',
			authorId: authorId || '',
			authorName: '',
			agentId: agentId || null,
			classification: classification.category,
			entities: classification.entities,
			embedding,
			summary: classification.summary,
			timestamp: new Date(),
			threadTs: threadTs || null,
			supersedes: supersedes || null,
			metadata: {
				embedding_model: EMBEDDING_MODEL,
				stored_via: 'memory_store',
				dedup_threshold: dedupThreshold || null,
			},
		};

		await Memory.put(memoryRecord);

		log('info', 'Memory stored', {
			classification: classification.category,
			dedupThreshold,
			contentHash,
		});

		return {
			stored: true,
			deduplicated: false,
			id: memoryRecord.id || 'generated',
			summary: memoryRecord.summary,
		};
	}
}

// ---------------------------------------------------------------------------
// Memory Table Extension - Strip embeddings from GET responses
// ---------------------------------------------------------------------------

export class MemoryTable extends Memory {
	async get(target) {
		const record = await super.get(target);
		if (record && typeof record === 'object') {
			return {
				id: record.id,
				rawText: record.rawText,
				source: record.source,
				sourceType: record.sourceType,
				channelId: record.channelId,
				channelName: record.channelName,
				authorId: record.authorId,
				authorName: record.authorName,
				agentId: record.agentId,
				classification: record.classification,
				entities: record.entities,
				contentHash: record.contentHash,
				supersedes: record.supersedes,
				summary: record.summary,
				timestamp: record.timestamp,
				threadTs: record.threadTs,
				metadata: record.metadata,
			};
		}
		return record;
	}
}

// ---------------------------------------------------------------------------
// VectorSearch - Raw vector similarity search with pre-computed embeddings
// ---------------------------------------------------------------------------

export class VectorSearch extends Resource {
	static async post(_req, data) {
		const { vector, limit, filter } = data || {};

		if (!vector) {
			return cortexError('missing-vector', 'Missing required field: vector', 400, 'vector is required');
		}
		if (!Array.isArray(vector)) {
			return cortexError('invalid-vector', 'Invalid field: vector', 422, 'vector must be an array');
		}
		if (vector.some((v) => typeof v !== 'number' || isNaN(v))) {
			return cortexError('invalid-vector', 'Invalid field: vector', 422, 'vector must contain only numeric values');
		}

		const searchLimit = Math.min(
			Math.max(1, parseInt(limit, 10) || DEFAULT_SEARCH_LIMIT),
			MAX_SEARCH_LIMIT,
		);

		const searchParams = {
			sort: {
				attribute: 'embedding',
				target: vector,
			},
			limit: searchLimit,
		};

		if (filter && typeof filter === 'object') {
			const conditions = Object.entries(filter).map(([attribute, value]) => ({
				attribute,
				comparator: 'equals',
				value,
			}));
			if (conditions.length === 1) {
				searchParams.conditions = conditions[0];
			} else if (conditions.length > 1) {
				searchParams.conditions = conditions;
			}
		}

		log('info', 'Vector search requested', { dimensions: vector.length, limit: searchLimit });

		const results = [];
		for await (const record of Memory.search(searchParams)) {
			results.push(record);
		}

		return { results, count: results.length };
	}
}

// ---------------------------------------------------------------------------
// BatchUpsert - Bulk insert/update records into Memory or SynapseEntry tables
// ---------------------------------------------------------------------------

const BATCH_ALLOWED_TABLES = { Memory, SynapseEntry };

export class BatchUpsert extends Resource {
	static async post(_req, data) {
		const { table, records } = data || {};

		if (!table) {
			return cortexError('missing-table', 'Missing required field: table', 400, 'table is required');
		}
		if (!records) {
			return cortexError('missing-records', 'Missing required field: records', 400, 'records is required');
		}
		if (!Array.isArray(records)) {
			return cortexError('invalid-records', 'Invalid field: records', 422, 'records must be an array');
		}
		if (!BATCH_ALLOWED_TABLES[table]) {
			return cortexError('invalid-table', 'Invalid field: table', 422, 'table must be one of: Memory, SynapseEntry');
		}

		const tableRef = BATCH_ALLOWED_TABLES[table];
		let stored = 0;
		const errors = [];

		for (let i = 0; i < records.length; i++) {
			const record = records[i];

			if (!record || typeof record !== 'object' || Array.isArray(record)) {
				errors.push({ index: i, record: `record-${i}`, error: 'record must be an object' });
				continue;
			}

			try {
				await transaction(() => tableRef.put(record));
				stored++;
			} catch (err) {
				errors.push({ index: i, record: record.id || `record-${i}`, error: err.message });
			}
		}

		log('info', 'Batch upsert complete', { table, stored, errorCount: errors.length });

		return { stored, errors };
	}
}
