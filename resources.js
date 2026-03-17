import Anthropic from '@anthropic-ai/sdk';
import { Resource, tables } from 'harperdb';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { pipeline } from '@xenova/transformers';

const { Memory, SynapseEntry: SynapseEntryBase } = tables;

// ---------------------------------------------------------------------------
// API Clients (initialized lazily to fail fast on missing env vars)
// ---------------------------------------------------------------------------

let anthropicClient;
function getAnthropicClient() {
	if (!anthropicClient) {
		if (!process.env.ANTHROPIC_API_KEY) {
			throw new Error('ANTHROPIC_API_KEY environment variable is required');
		}
		anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
	}
	return anthropicClient;
}

let embeddingPipeline;
async function getEmbeddingPipeline() {
	if (!embeddingPipeline) {
		embeddingPipeline = await pipeline('feature-extraction', EMBEDDING_MODEL);
	}
	return embeddingPipeline;
}

// ---------------------------------------------------------------------------
// Structured Logger
// ---------------------------------------------------------------------------

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level, message, context = {}) {
	if (LOG_LEVELS[level] == null) { return; }
	const entry = {
		timestamp: new Date().toISOString(),
		level,
		message,
		...context,
	};
	if (level === 'error') {
		console.error(JSON.stringify(entry));
	} else if (level === 'warn') {
		console.warn(JSON.stringify(entry));
	} else {
		console.log(JSON.stringify(entry));
	}
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLASSIFICATION_MODEL = 'claude-haiku-3-5-20241022';
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 100;

const VALID_CATEGORIES = new Set([
	'decision',
	'action_item',
	'knowledge',
	'question',
	'announcement',
	'discussion',
	'reference',
	'status_update',
	'feedback',
]);

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

// ---------------------------------------------------------------------------
// Helper: Classify a message using Claude API
// ---------------------------------------------------------------------------

export async function classifyMessage(text) {
	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		return createFallbackClassification(text);
	}

	try {
		const client = getAnthropicClient();
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
// Helper: Generate embedding using local ONNX model (Harper-native, no API key)
// ---------------------------------------------------------------------------

export async function generateEmbedding(text) {
	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		throw new Error('Cannot generate embedding for empty text');
	}

	const extractor = await getEmbeddingPipeline();
	const output = await extractor(text, { pooling: 'mean', normalize: true });
	return Array.from(output.data);
}

// ---------------------------------------------------------------------------
// Helper: Verify Slack request signature (HMAC-SHA256)
// ---------------------------------------------------------------------------

export function verifySlackSignature(signingSecret, signature, timestamp, body) {
	if (!signingSecret || !signature || !timestamp || !body) {
		return false;
	}

	// Reject requests older than 5 minutes to prevent replay attacks
	const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
	if (parseInt(timestamp, 10) < fiveMinutesAgo) {
		return false;
	}

	const sigBasestring = `v0:${timestamp}:${body}`;
	const expectedSignature = 'v0=' + createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

	try {
		return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// 1. SlackWebhook - Receives Slack Events API POST requests
// ---------------------------------------------------------------------------

export class SlackWebhook extends Resource {
	async post(data) {
		// Handle Slack URL verification challenge
		if (data?.type === 'url_verification') {
			log('info', 'Slack URL verification challenge received');
			return { challenge: data.challenge };
		}

		// Ignore non-event callbacks
		if (data?.type !== 'event_callback') {
			return { status: 200, message: 'ignored' };
		}

		// Reject Slack retries to prevent duplicate processing
		// Slack sends X-Slack-Retry-Num header on retries, but in Harper
		// custom resources we check the event_id for deduplication
		const event = data.event;
		if (!event) {
			log('warn', 'Event callback received without event payload');
			return { status: 200, message: 'no_event' };
		}

		// Filter: only process human messages (skip bots, subtypes)
		if (event.type !== 'message' || event.subtype || event.bot_id) {
			return { status: 200, message: 'skipped' };
		}

		// Filter: skip empty messages
		if (!event.text || event.text.trim().length === 0) {
			return { status: 200, message: 'empty' };
		}

		// Return 200 immediately and process async to avoid Slack's 3s timeout
		const eventData = { ...data };
		setTimeout(() =>
			this._processMessage(eventData).catch((err) => {
				log('error', 'Async message processing failed', {
					error: err.message,
					eventId: eventData.event_id,
				});
			}), 0);

		return { status: 200, message: 'accepted' };
	}

	async _processMessage(data) {
		const event = data.event;

		log('info', 'Processing Slack message', {
			channel: event.channel,
			user: event.user,
			eventId: data.event_id,
		});

		// Check for duplicate event_id to prevent re-processing
		const existingMemories = [];
		for await (
			const record of Memory.search({
				conditions: { attribute: 'metadata', value: data.event_id },
				limit: 1,
			})
		) {
			existingMemories.push(record);
		}
		if (existingMemories.length > 0) {
			log('info', 'Duplicate event skipped', { eventId: data.event_id });
			return;
		}

		// Classify and embed in parallel
		const [classification, embedding] = await Promise.all([
			classifyMessage(event.text),
			generateEmbedding(event.text),
		]);

		const memoryRecord = {
			rawText: event.text,
			source: 'slack',
			sourceType: event.thread_ts ? 'thread_reply' : 'message',
			channelId: event.channel,
			channelName: event.channel_name || '',
			authorId: event.user,
			authorName: '',
			classification: classification.category,
			entities: classification.entities,
			embedding,
			summary: classification.summary,
			timestamp: new Date(parseFloat(event.ts) * 1000),
			threadTs: event.thread_ts || event.ts,
			metadata: {
				team_id: data.team_id,
				event_id: data.event_id,
				event_ts: event.ts,
				embedding_model: EMBEDDING_MODEL,
			},
		};

		await Memory.put(memoryRecord);

		log('info', 'Memory stored', {
			classification: classification.category,
			channel: event.channel,
			eventId: data.event_id,
		});
	}
}

// ---------------------------------------------------------------------------
// 2. MemorySearch - Semantic search endpoint
// ---------------------------------------------------------------------------

export class MemorySearch extends Resource {
	async post(data) {
		const { query, limit, filters } = data || {};

		if (!query || typeof query !== 'string' || query.trim().length === 0) {
			return { error: 'query is required and must be a non-empty string' };
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

		// Apply optional attribute filters for hybrid search
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

			if (conditions.length === 1) {
				searchParams.conditions = conditions[0];
			} else if (conditions.length > 1) {
				searchParams.conditions = conditions;
			}
		}

		const results = [];
		for await (const record of Memory.search(searchParams)) {
			results.push(record);
		}

		return { results, count: results.length };
	}
}

// ---------------------------------------------------------------------------
// 3. Memory Table Extension - Strip embeddings from GET responses
// ---------------------------------------------------------------------------

export class MemoryTable extends Memory {
	get(target) {
		const record = super.get(target);
		if (record && typeof record === 'object') {
			const { embedding: _, ...rest } = record;
			return rest;
		}
		return record;
	}
}

// ===========================================================================
// SYNAPSE - Universal Context Broker
// ===========================================================================

// ---------------------------------------------------------------------------
// Synapse Constants
// ---------------------------------------------------------------------------

const VALID_SYNAPSE_TYPES = new Set(['intent', 'constraint', 'artifact', 'history']);
const VALID_SYNAPSE_SOURCES = new Set(['claude_code', 'cursor', 'windsurf', 'copilot', 'manual', 'slack']);
const VALID_EMIT_TARGETS = new Set(['claude_code', 'cursor', 'windsurf', 'copilot', 'markdown']);

const SYNAPSE_CLASSIFICATION_PROMPT =
	`You are a context classifier for a software development memory system called Synapse. Given a piece of development context, classify it into exactly ONE type and extract metadata.

Types:
- intent: The high-level "Why" behind a decision. Architectural choices, technology selections, design rationale, trade-off reasoning.
- constraint: A "Must" or "Must-Not" rule. Hard requirements, coding standards, non-negotiable boundaries, technical limitations.
- artifact: A reference to a visual state, recording, code snippet, diagram, or external resource.
- history: A failed path, abandoned approach, or dead end. What was tried, why it did not work, what to avoid repeating.

Respond with valid JSON only, in this exact format:
{
  "type": "<type>",
  "entities": {
    "people": [],
    "projects": [],
    "technologies": [],
    "topics": []
  },
  "summary": "<one sentence summary, max 120 characters>",
  "tags": ["<tag1>", "<tag2>"]
}`;

// ---------------------------------------------------------------------------
// Helper: Classify a Synapse context entry using Claude API
// ---------------------------------------------------------------------------

export async function classifySynapseEntry(text) {
	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		return createFallbackSynapseClassification(text);
	}

	try {
		const client = getAnthropicClient();
		const message = await client.messages.create({
			model: CLASSIFICATION_MODEL,
			max_tokens: 512,
			system: SYNAPSE_CLASSIFICATION_PROMPT,
			messages: [
				{
					role: 'user',
					content: `Classify this development context:\n\n"${text}"`,
				},
			],
		});

		const parsed = JSON.parse(message.content[0].text);

		if (!parsed.type || !VALID_SYNAPSE_TYPES.has(parsed.type)) {
			log('warn', 'Synapse LLM returned invalid type, using fallback', {
				returnedType: parsed.type,
			});
			parsed.type = 'intent';
		}

		return {
			type: parsed.type,
			entities: parsed.entities || { people: [], projects: [], technologies: [], topics: [] },
			summary: parsed.summary || text.substring(0, 120),
			tags: Array.isArray(parsed.tags) ? parsed.tags : [],
		};
	} catch (err) {
		log('error', 'Synapse classification failed, using fallback', {
			error: err.message,
		});
		return createFallbackSynapseClassification(text);
	}
}

function createFallbackSynapseClassification(text) {
	return {
		type: 'intent',
		entities: { people: [], projects: [], technologies: [], topics: [] },
		summary: String(text || '').substring(0, 120),
		tags: [],
	};
}

// ---------------------------------------------------------------------------
// Synapse Parsers - Convert tool-native formats into entry-shaped objects
// ---------------------------------------------------------------------------

const synapseparsers = {
	/**
	 * Parse CLAUDE.md — split on ## headings, each section becomes one entry.
	 * Content before the first ## heading is preserved as a preamble entry.
	 */
	parseClaudeCode(content) {
		const sections = content.split(/^## /m);
		if (sections.length <= 1) {
			return [{ content, sourceFormat: 'markdown', metadata: { filePath: 'CLAUDE.md' } }];
		}
		const entries = [];
		// First element is preamble (content before any ## heading)
		const preamble = sections[0].trim();
		if (preamble) {
			entries.push({ content: preamble, sourceFormat: 'markdown', metadata: { heading: null, filePath: 'CLAUDE.md' } });
		}
		// Remaining elements are ## sections
		for (let i = 1; i < sections.length; i++) {
			const lines = sections[i].split('\n');
			const heading = lines[0].trim();
			const body = lines.slice(1).join('\n').trim();
			if (!body) { continue; }
			entries.push({
				content: `## ${heading}\n\n${body}`,
				sourceFormat: 'markdown',
				metadata: { heading, filePath: 'CLAUDE.md' },
			});
		}
		return entries.length > 0 ? entries : [{ content, sourceFormat: 'markdown', metadata: { filePath: 'CLAUDE.md' } }];
	},

	/**
	 * Parse Cursor .mdc rule files — extract YAML frontmatter + markdown body.
	 */
	parseCursor(content) {
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (frontmatterMatch) {
			const frontmatter = frontmatterMatch[1];
			const body = frontmatterMatch[2].trim();
			const meta = {};
			for (const line of frontmatter.split('\n')) {
				const colonIdx = line.indexOf(':');
				if (colonIdx !== -1) {
					meta[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
				}
			}
			return [{ content: body, sourceFormat: 'mdc', metadata: { frontmatter: meta, format: 'cursor_rule' } }];
		}
		return [{ content, sourceFormat: 'mdc', metadata: { format: 'cursor_rule' } }];
	},

	/**
	 * Parse Windsurf .md rule files — split on ## headings like Claude Code.
	 * Content before the first ## heading is preserved as a preamble entry.
	 */
	parseWindsurf(content) {
		const sections = content.split(/^## /m);
		if (sections.length <= 1) {
			return [{ content, sourceFormat: 'markdown', metadata: { format: 'windsurf_rule' } }];
		}
		const entries = [];
		const preamble = sections[0].trim();
		if (preamble) {
			entries.push({
				content: preamble,
				sourceFormat: 'markdown',
				metadata: { heading: null, format: 'windsurf_rule' },
			});
		}
		for (let i = 1; i < sections.length; i++) {
			const lines = sections[i].split('\n');
			const heading = lines[0].trim();
			const body = lines.slice(1).join('\n').trim();
			if (!body) { continue; }
			entries.push({
				content: `## ${heading}\n\n${body}`,
				sourceFormat: 'markdown',
				metadata: { heading, format: 'windsurf_rule' },
			});
		}
		return entries.length > 0
			? entries
			: [{ content, sourceFormat: 'markdown', metadata: { format: 'windsurf_rule' } }];
	},

	/**
	 * Parse GitHub Copilot instructions — pass through as a single entry.
	 */
	parseCopilot(content) {
		return [{ content, sourceFormat: 'markdown', metadata: { format: 'copilot_instructions' } }];
	},
};

// ---------------------------------------------------------------------------
// Synapse Emitters - Convert SynapseEntry records into tool-native strings
// ---------------------------------------------------------------------------

function groupByType(entries) {
	const grouped = {};
	for (const entry of entries) {
		if (!grouped[entry.type]) { grouped[entry.type] = []; }
		grouped[entry.type].push(entry);
	}
	return grouped;
}

const synapseEmitters = {
	/**
	 * Emit as CLAUDE.md-compatible markdown, grouped by type.
	 */
	emitClaudeCode(entries, projectId) {
		const grouped = groupByType(entries);
		const lines = [
			`# Synapse Context: ${projectId}`,
			``,
			`_Synced from Cortex at ${new Date().toISOString()}_`,
			``,
		];

		if (grouped.intent?.length) {
			lines.push('## Intents (Why)\n');
			for (const e of grouped.intent) {
				lines.push(`### ${e.summary}\n\n${e.content}\n`);
			}
		}
		if (grouped.constraint?.length) {
			lines.push('## Constraints (Musts)\n');
			for (const e of grouped.constraint) {
				lines.push(`- ${e.content}\n`);
			}
		}
		if (grouped.artifact?.length) {
			lines.push('## Artifacts (References)\n');
			for (const e of grouped.artifact) {
				lines.push(`- **${e.summary}**: ${e.content}\n`);
			}
		}
		if (grouped.history?.length) {
			lines.push('## History (Failed Paths)\n');
			for (const e of grouped.history) {
				lines.push(`- ~~${e.summary}~~: ${e.content}\n`);
			}
		}

		return lines.join('\n');
	},

	/**
	 * Emit as Cursor .mdc rule files — one file per entry with YAML frontmatter.
	 */
	emitCursor(entries, _projectId) {
		const files = [];
		for (const entry of entries) {
			const globs = entry.metadata?.frontmatter?.globs || '';
			const mdc = [
				'---',
				`description: ${entry.summary}`,
				`globs: ${globs}`,
				`alwaysApply: ${!globs}`,
				'---',
				'',
				entry.content,
			].join('\n');
			const filename = `synapse-${entry.type}-${String(entry.id).substring(0, 8)}.mdc`;
			files.push({ filename, content: mdc });
		}
		return { format: 'cursor_rules', files };
	},

	/**
	 * Emit as Windsurf .md rule files — one file per entry.
	 */
	emitWindsurf(entries, _projectId) {
		const files = [];
		for (const entry of entries) {
			const md = `# Synapse: ${entry.summary}\n\n${entry.content}\n`;
			const filename = `synapse-${entry.type}-${String(entry.id).substring(0, 8)}.md`;
			files.push({ filename, content: md });
		}
		return { format: 'windsurf_rules', files };
	},

	/**
	 * Emit as Copilot instructions — same grouped markdown as Claude Code.
	 */
	emitCopilot(entries, projectId) {
		return synapseEmitters.emitClaudeCode(entries, projectId);
	},

	/**
	 * Generic markdown output (default).
	 */
	emitMarkdown(entries, projectId) {
		return synapseEmitters.emitClaudeCode(entries, projectId);
	},
};

// ---------------------------------------------------------------------------
// 4. SynapseEntry Table Extension - Strip embeddings from GET responses
// ---------------------------------------------------------------------------

export class SynapseEntry extends SynapseEntryBase {
	get(target) {
		const record = super.get(target);
		if (record && typeof record === 'object') {
			const { embedding: _, ...rest } = record;
			return rest;
		}
		return record;
	}
}

// ---------------------------------------------------------------------------
// 5. SynapseSearch - Semantic search across context entries
// ---------------------------------------------------------------------------

export class SynapseSearch extends Resource {
	async post(data) {
		const { query, projectId, limit, filters } = data || {};

		if (!query || typeof query !== 'string' || query.trim().length === 0) {
			return { error: 'query is required and must be a non-empty string' };
		}
		if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
			return { error: 'projectId is required and must be a non-empty string' };
		}

		const searchLimit = Math.min(
			Math.max(1, parseInt(limit, 10) || DEFAULT_SEARCH_LIMIT),
			MAX_SEARCH_LIMIT,
		);

		log('info', 'Synapse search requested', { query, projectId, limit: searchLimit, filters });

		const queryEmbedding = await generateEmbedding(query);

		const conditions = [
			{ attribute: 'projectId', comparator: 'equals', value: projectId },
			{ attribute: 'status', comparator: 'equals', value: (filters && filters.status) || 'active' },
		];

		if (filters && typeof filters === 'object') {
			if (filters.type && VALID_SYNAPSE_TYPES.has(filters.type)) {
				conditions.push({ attribute: 'type', comparator: 'equals', value: filters.type });
			}
			if (filters.source && VALID_SYNAPSE_SOURCES.has(filters.source)) {
				conditions.push({ attribute: 'source', comparator: 'equals', value: filters.source });
			}
		}

		const searchParams = {
			select: [
				'id',
				'projectId',
				'type',
				'content',
				'source',
				'sourceFormat',
				'summary',
				'status',
				'references',
				'tags',
				'entities',
				'parentId',
				'createdAt',
				'updatedAt',
				'$distance',
			],
			sort: { attribute: 'embedding', target: queryEmbedding },
			conditions,
			limit: searchLimit,
		};

		const results = [];
		for await (const record of SynapseEntryBase.search(searchParams)) {
			results.push(record);
		}

		return { results, count: results.length };
	}
}

// ---------------------------------------------------------------------------
// 6. SynapseIngest - Ingest context from any tool format
// ---------------------------------------------------------------------------

export class SynapseIngest extends Resource {
	async post(data) {
		const { source, content, projectId, parentId, references } = data || {};

		if (!content || typeof content !== 'string' || content.trim().length === 0) {
			return { error: 'content is required and must be a non-empty string' };
		}
		if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
			return { error: 'projectId is required and must be a non-empty string' };
		}
		if (!source || !VALID_SYNAPSE_SOURCES.has(source)) {
			return { error: `source must be one of: ${[...VALID_SYNAPSE_SOURCES].join(', ')}` };
		}

		log('info', 'Synapse ingest requested', { source, projectId });

		const entries = this._parseContent(source, content);
		const stored = [];

		for (const entry of entries) {
			try {
				// Deterministic ID from content hash — re-ingesting the same content
				// upserts the existing record rather than creating duplicates.
				const id = createHash('sha256')
					.update(`${projectId}:${source}:${entry.content}`)
					.digest('hex')
					.substring(0, 32);

				const [classification, embedding] = await Promise.all([
					classifySynapseEntry(entry.content),
					generateEmbedding(entry.content),
				]);

				const record = {
					id,
					projectId,
					type: classification.type,
					content: entry.content,
					source,
					sourceFormat: entry.sourceFormat,
					embedding,
					summary: classification.summary,
					status: 'active',
					references: references || [],
					tags: classification.tags,
					entities: classification.entities,
					parentId: parentId || null,
					createdAt: new Date(),
					updatedAt: new Date(),
					metadata: entry.metadata || {},
				};

				await SynapseEntryBase.put(record);
				stored.push({ summary: record.summary, type: record.type });

				log('info', 'Synapse entry stored', { type: record.type, projectId, source });
			} catch (err) {
				log('error', 'Failed to store Synapse entry', { error: err.message });
			}
		}

		return { stored, count: stored.length };
	}

	_parseContent(source, content) {
		switch (source) {
			case 'claude_code':
				return synapseparsers.parseClaudeCode(content);
			case 'cursor':
				return synapseparsers.parseCursor(content);
			case 'windsurf':
				return synapseparsers.parseWindsurf(content);
			case 'copilot':
				return synapseparsers.parseCopilot(content);
			default:
				return [{ content, sourceFormat: 'markdown', metadata: {} }];
		}
	}
}

// ---------------------------------------------------------------------------
// 7. SynapseEmit - Emit context in a target tool's native format
// ---------------------------------------------------------------------------

export class SynapseEmit extends Resource {
	async post(data) {
		const { target, projectId, types, limit } = data || {};

		if (!target || !VALID_EMIT_TARGETS.has(target)) {
			return { error: `target must be one of: ${[...VALID_EMIT_TARGETS].join(', ')}` };
		}
		if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
			return { error: 'projectId is required and must be a non-empty string' };
		}

		const emitLimit = Math.min(
			Math.max(1, parseInt(limit, 10) || 50),
			MAX_SEARCH_LIMIT,
		);

		log('info', 'Synapse emit requested', { target, projectId });

		const conditions = [
			{ attribute: 'projectId', comparator: 'equals', value: projectId },
			{ attribute: 'status', comparator: 'equals', value: 'active' },
		];

		// Push single-type filter to search conditions for efficiency.
		// Multi-type filters are applied post-query since Harper conditions are AND-joined.
		const singleTypeFilter = Array.isArray(types) && types.length === 1;
		if (singleTypeFilter) {
			conditions.push({ attribute: 'type', comparator: 'equals', value: types[0] });
		}

		const entries = [];
		for await (
			const record of SynapseEntryBase.search({
				select: [
					'id',
					'type',
					'content',
					'summary',
					'status',
					'tags',
					'entities',
					'parentId',
					'createdAt',
					'updatedAt',
					'metadata',
				],
				conditions,
				limit: emitLimit,
			})
		) {
			if (singleTypeFilter || !types || types.includes(record.type)) {
				entries.push(record);
			}
		}

		const output = this._emitForTarget(target, entries, projectId);
		return { target, projectId, entryCount: entries.length, output };
	}

	_emitForTarget(target, entries, projectId) {
		switch (target) {
			case 'claude_code':
				return synapseEmitters.emitClaudeCode(entries, projectId);
			case 'cursor':
				return synapseEmitters.emitCursor(entries, projectId);
			case 'windsurf':
				return synapseEmitters.emitWindsurf(entries, projectId);
			case 'copilot':
				return synapseEmitters.emitCopilot(entries, projectId);
			default:
				return synapseEmitters.emitMarkdown(entries, projectId);
		}
	}
}
