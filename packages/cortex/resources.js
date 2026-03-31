// Barrel file — re-exports from split resource modules

export {
	BatchUpsert,
	classifyMessage,
	MemoryCount,
	MemorySearch,
	MemoryStore,
	MemoryTable,
	VectorSearch,
} from './resources/memory.js';
export { EMBEDDING_MODEL, generateEmbedding, log, VALID_CATEGORIES } from './resources/shared.js';
export { SlackWebhook, verifySlackSignature } from './resources/slack-webhook.js';
export {
	classifySynapseEntry,
	SYNAPSE_SOURCES,
	SYNAPSE_TARGETS,
	SYNAPSE_TYPES,
	SynapseEmit,
	SynapseEntry,
	SynapseIngest,
	SynapseSearch,
} from './resources/synapse.js';
