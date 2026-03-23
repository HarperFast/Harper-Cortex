import { pipeline } from '@xenova/transformers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
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

// ---------------------------------------------------------------------------
// Helper: Generate embedding using local ONNX model (Harper-native, no API key)
// ---------------------------------------------------------------------------

let embeddingPipeline;
async function getEmbeddingPipeline() {
	if (!embeddingPipeline) {
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
