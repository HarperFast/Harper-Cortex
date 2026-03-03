import { Resource, tables } from 'harperdb';
import Anthropic from '@anthropic-ai/sdk';
import { VoyageAIClient } from 'voyageai';
import { createHmac, timingSafeEqual } from 'node:crypto';

const { Memory } = tables;

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

let voyageClient;
function getVoyageClient() {
	if (!voyageClient) {
		if (!process.env.VOYAGE_API_KEY) {
			throw new Error('VOYAGE_API_KEY environment variable is required');
		}
		voyageClient = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
	}
	return voyageClient;
}

// ---------------------------------------------------------------------------
// Structured Logger
// ---------------------------------------------------------------------------

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level, message, context = {}) {
	if (LOG_LEVELS[level] == null) return;
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
const EMBEDDING_MODEL = 'voyage-3';
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

const CLASSIFICATION_SYSTEM_PROMPT = `You are a message classifier for a team memory system. Classify each message into exactly ONE category and extract key entities.

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
// Helper: Generate embedding using Voyage AI
// ---------------------------------------------------------------------------

export async function generateEmbedding(text) {
	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		throw new Error('Cannot generate embedding for empty text');
	}

	const client = getVoyageClient();
	const response = await client.embed({
		input: [text],
		model: EMBEDDING_MODEL,
	});

	return response.data[0].embedding;
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
		setTimeout(() => this._processMessage(eventData).catch((err) => {
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
		for await (const record of Memory.search({
			conditions: { attribute: 'metadata', value: data.event_id },
			limit: 1,
		})) {
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
			MAX_SEARCH_LIMIT
		);

		log('info', 'Memory search requested', { query, limit: searchLimit, filters });

		const queryEmbedding = await generateEmbedding(query);

		const searchParams = {
			select: [
				'id', 'rawText', 'source', 'sourceType', 'channelId', 'channelName',
				'authorId', 'authorName', 'classification', 'entities', 'summary',
				'timestamp', 'threadTs', '$distance',
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
			const { embedding, ...rest } = record;
			return rest;
		}
		return record;
	}
}
