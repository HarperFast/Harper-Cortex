import { Resource, tables } from 'harper';
import { createHash } from 'node:crypto';
import { classifyMemory } from './classification-provider.js';
import { cortexError, DEFAULT_SEARCH_LIMIT, generateEmbedding, log, MAX_SEARCH_LIMIT } from './shared.js';

const { SynapseEntry: SynapseEntryBase } = tables;

// ---------------------------------------------------------------------------
// Synapse Constants
// ---------------------------------------------------------------------------

export const SYNAPSE_TYPES = new Set(['intent', 'constraint', 'artifact', 'history']);
export const SYNAPSE_SOURCES = new Set(['claude_code', 'cursor', 'windsurf', 'copilot', 'manual', 'slack']);
export const SYNAPSE_TARGETS = new Set(['claude_code', 'cursor', 'windsurf', 'copilot', 'markdown']);

const CLASSIFICATION_MODEL = 'claude-haiku-3-5-20241022';

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

// Legacy Anthropic classification fallback

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
		system: SYNAPSE_CLASSIFICATION_PROMPT,
		messages: [
			{
				role: 'user',
				content: `Classify this development context:\n\n"${text}"`,
			},
		],
	});

	const parsed = JSON.parse(message.content[0].text);

	if (!parsed.type || !SYNAPSE_TYPES.has(parsed.type)) {
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
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

export async function classifySynapseEntry(text) {
	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		return createFallbackSynapseClassification(text);
	}

	try {
		// Try classification-provider first (supports multiple providers)
		const result = await classifyMemory(text);

		if (result) {
			// The classification-provider returns memory categories; map to synapse types
			const type = mapToSynapseType(result.classification);
			return {
				type,
				entities: result.entities || { people: [], projects: [], technologies: [], topics: [] },
				summary: result.summary || text.substring(0, 120),
				tags: [],
			};
		}

		// classifyMemory returned null (no provider configured).
		// Fall back to legacy Anthropic SDK if ANTHROPIC_API_KEY is available.
		if (process.env.ANTHROPIC_API_KEY) {
			return await classifyWithLegacyAnthropic(text);
		}

		return createFallbackSynapseClassification(text);
	} catch (err) {
		log('error', 'Synapse classification failed, using fallback', {
			error: err.message,
		});
		return createFallbackSynapseClassification(text);
	}
}

// Map memory classification categories to synapse types
function mapToSynapseType(classification) {
	// If it's already a valid synapse type, use it directly
	if (SYNAPSE_TYPES.has(classification)) {
		return classification;
	}

	// Map memory categories to synapse types
	const mapping = {
		decision: 'intent',
		action_item: 'intent',
		knowledge: 'intent',
		question: 'intent',
		announcement: 'intent',
		discussion: 'intent',
		reference: 'artifact',
		status_update: 'history',
		feedback: 'intent',
	};

	return mapping[classification] || 'intent';
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
	 * Parse CLAUDE.md -- split on ## headings, each section becomes one entry.
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
	 * Parse Cursor .mdc rule files -- extract YAML frontmatter + markdown body.
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
	 * Parse Windsurf .md rule files -- split on ## headings like Claude Code.
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
	 * Parse GitHub Copilot instructions -- pass through as a single entry.
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
	 * Emit as Cursor .mdc rule files -- one file per entry with YAML frontmatter.
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
	 * Emit as Windsurf .md rule files -- one file per entry.
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
	 * Emit as Copilot instructions -- same grouped markdown as Claude Code.
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
// SynapseEntry Table Extension - Strip embeddings from GET responses
// ---------------------------------------------------------------------------

export class SynapseEntry extends SynapseEntryBase {
	async get(target) {
		const record = super.get(target);
		if (record && typeof record === 'object') {
			return {
				id: record.id,
				projectId: record.projectId,
				type: record.type,
				content: record.content,
				source: record.source,
				sourceFormat: record.sourceFormat,
				summary: record.summary,
				status: record.status,
				references: record.references,
				tags: record.tags,
				entities: record.entities,
				parentId: record.parentId,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
				metadata: record.metadata,
			};
		}
		return record;
	}
}

// ---------------------------------------------------------------------------
// SynapseSearch - Semantic search across context entries
// ---------------------------------------------------------------------------

export class SynapseSearch extends Resource {
	static async post(_req, data) {
		data = await data;
		const { query, projectId, limit, filters } = data || {};

		if (!query || typeof query !== 'string' || query.trim().length === 0) {
			return cortexError(
				'missing-query',
				'Missing required field: query',
				400,
				'query is required and must be a non-empty string',
			);
		}
		if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
			return cortexError(
				'missing-project-id',
				'Missing required field: projectId',
				400,
				'projectId is required and must be a non-empty string',
			);
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
			if (filters.type && SYNAPSE_TYPES.has(filters.type)) {
				conditions.push({ attribute: 'type', comparator: 'equals', value: filters.type });
			}
			if (filters.source && SYNAPSE_SOURCES.has(filters.source)) {
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
// SynapseIngest - Ingest context from any tool format
// ---------------------------------------------------------------------------

export class SynapseIngest extends Resource {
	static async post(_req, data) {
		data = await data;
		const { source, content, projectId, parentId, references } = data || {};

		if (!content || typeof content !== 'string' || content.trim().length === 0) {
			return cortexError(
				'missing-content',
				'Missing required field: content',
				400,
				'content is required and must be a non-empty string',
			);
		}
		if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
			return cortexError(
				'missing-project-id',
				'Missing required field: projectId',
				400,
				'projectId is required and must be a non-empty string',
			);
		}
		if (!source || !SYNAPSE_SOURCES.has(source)) {
			return cortexError(
				'invalid-source',
				'Invalid field: source',
				422,
				`source must be one of: ${[...SYNAPSE_SOURCES].join(', ')}`,
			);
		}

		log('info', 'Synapse ingest requested', { source, projectId });

		const entries = SynapseIngest._parseContent(source, content);
		const stored = [];

		for (const entry of entries) {
			try {
				// Deterministic ID from content hash for idempotent upserts
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

	static _parseContent(source, content) {
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
// SynapseEmit - Emit context in a target tool's native format
// ---------------------------------------------------------------------------

export class SynapseEmit extends Resource {
	static async post(_req, data) {
		data = await data;
		const { target, projectId, types, limit } = data || {};

		if (!target || !SYNAPSE_TARGETS.has(target)) {
			return cortexError(
				'invalid-target',
				'Invalid field: target',
				422,
				`target must be one of: ${[...SYNAPSE_TARGETS].join(', ')}`,
			);
		}
		if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
			return cortexError(
				'missing-project-id',
				'Missing required field: projectId',
				400,
				'projectId is required and must be a non-empty string',
			);
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

		// Single-type filters go in search conditions; multi-type filters applied post-query
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

		const output = SynapseEmit._emitForTarget(target, entries, projectId);
		return { target, projectId, entryCount: entries.length, output };
	}

	static _emitForTarget(target, entries, projectId) {
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
