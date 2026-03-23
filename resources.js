// Barrel file — re-exports everything from the split resources/ modules
// so that existing test imports (from '../resources.js') continue to work.

export { generateEmbedding, VALID_CATEGORIES, EMBEDDING_MODEL, log } from './resources/shared.js';
export { classifyMessage, MemorySearch, MemoryCount, MemoryStore, MemoryTable, VectorSearch, BatchUpsert } from './resources/memory.js';
export {
	classifySynapseEntry,
	SynapseEntry,
	SynapseSearch,
	SynapseIngest,
	SynapseEmit,
	SYNAPSE_TYPES,
	SYNAPSE_SOURCES,
	SYNAPSE_TARGETS,
} from './resources/synapse.js';
export { verifySlackSignature, SlackWebhook } from './resources/slack-webhook.js';
