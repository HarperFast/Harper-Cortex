// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 100;

export const VALID_CATEGORIES = new Set([
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

// ---------------------------------------------------------------------------
// Structured Logger
// ---------------------------------------------------------------------------

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export function log(level, message, context = {}) {
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

// Embedding generation via local ONNX model

let embeddingPipeline;
async function getEmbeddingPipeline() {
	if (!embeddingPipeline) {
		const { pipeline } = await import('@huggingface/transformers');
		embeddingPipeline = await pipeline('feature-extraction', EMBEDDING_MODEL);
	}
	return embeddingPipeline;
}

export async function generateEmbedding(text) {
	if (!text || typeof text !== 'string' || text.trim().length === 0) {
		throw new Error('Cannot generate embedding for empty text');
	}

	const extractor = await getEmbeddingPipeline();
	const output = await extractor(text, { pooling: 'mean', normalize: true });
	return Array.from(output.data);
}

// ---------------------------------------------------------------------------
// RFC 9457 Error Helper
// ---------------------------------------------------------------------------

/**
 * Build an RFC 9457-shaped error response for Cortex endpoints.
 * @param {string} slug   - Short identifier used in the type URI (e.g. 'missing-query')
 * @param {string} title  - Human-readable summary (e.g. 'Missing required field: query')
 * @param {number} status - HTTP status code
 * @param {string} [detail] - Optional longer explanation
 * @param {string} [code]   - Optional short code for programmatic handling
 */
export function cortexError(slug, title, status, detail, code) {
	return {
		type: `https://github.com/HarperFast/cortex/errors/${slug}`,
		title,
		status,
		...(detail != null ? { detail } : {}),
		...(code != null ? { code } : {}),
	};
}
