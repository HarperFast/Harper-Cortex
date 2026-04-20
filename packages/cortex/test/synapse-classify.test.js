import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const { MockMemory, MockSynapseEntry, mockCreate } = vi.hoisted(() => {
	const mockCreate = vi.fn();
	class MockMemory {
		static put = vi.fn();
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	class MockSynapseEntry {
		static put = vi.fn();
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	return { MockMemory, MockSynapseEntry, mockCreate };
});

vi.mock('harper', () => ({
	Resource: class Resource {},
	tables: { Memory: MockMemory, SynapseEntry: MockSynapseEntry },
	default: { transaction: async (cb) => cb() },
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class Anthropic {
		constructor() {
			this.messages = { create: mockCreate };
		}
	},
}));

vi.mock('@huggingface/transformers', () => ({
	pipeline: vi.fn(async () => async () => ({ data: new Float32Array(384).fill(0.1) })),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { classifySynapseEntry } = await import('../resources.js');

describe('classifySynapseEntry', () => {
	beforeEach(() => {
		mockCreate.mockClear();
	});

	it('returns a valid classification for normal text', async () => {
		mockCreate.mockImplementation(async () => ({
			content: [{
				text: JSON.stringify({
					type: 'intent',
					entities: {
						people: [],
						projects: ['Cortex'],
						technologies: ['HarperDB'],
						topics: ['architecture'],
					},
					summary: 'Chose HarperDB for HNSW vector indexing.',
					tags: ['database', 'vector'],
				}),
			}],
		}));

		const result = await classifySynapseEntry('We chose HarperDB for its HNSW vector indexing');

		assert.equal(result.type, 'intent');
		assert.ok(Array.isArray(result.entities.technologies));
		assert.ok(Array.isArray(result.tags));
		assert.equal(typeof result.summary, 'string');
	});

	it('returns fallback classification for empty text', async () => {
		const result = await classifySynapseEntry('');

		assert.equal(result.type, 'intent');
		assert.deepEqual(result.entities, { people: [], projects: [], technologies: [], topics: [] });
	});

	it('returns fallback classification for null text', async () => {
		const result = await classifySynapseEntry(null);
		assert.equal(result.type, 'intent');
	});

	it('returns fallback classification for non-string text', async () => {
		const result = await classifySynapseEntry(42);
		assert.equal(result.type, 'intent');
	});

	it('handles malformed JSON from LLM gracefully', async () => {
		mockCreate.mockImplementation(async () => ({
			content: [{ text: 'this is not json' }],
		}));

		const result = await classifySynapseEntry('some context entry');

		assert.equal(result.type, 'intent');
		assert.ok(result.summary);
	});

	it('falls back when LLM returns an invalid type', async () => {
		mockCreate.mockImplementation(async () => ({
			content: [{
				text: JSON.stringify({
					type: 'invalid_type',
					entities: { people: [], projects: [], technologies: [], topics: [] },
					summary: 'A summary',
					tags: [],
				}),
			}],
		}));

		const result = await classifySynapseEntry('some message');

		assert.equal(result.type, 'intent');
		assert.equal(result.summary, 'A summary');
	});

	it('handles API errors gracefully', async () => {
		mockCreate.mockImplementation(async () => {
			throw new Error('API rate limited');
		});

		const result = await classifySynapseEntry('some context entry');

		assert.equal(result.type, 'intent');
		assert.ok(result.summary);
	});

	it('accepts all four valid types', async () => {
		const types = ['intent', 'constraint', 'artifact', 'history'];
		for (const type of types) {
			mockCreate.mockImplementation(async () => ({
				content: [{
					text: JSON.stringify({
						type,
						entities: { people: [], projects: [], technologies: [], topics: [] },
						summary: `A ${type} summary`,
						tags: [],
					}),
				}],
			}));
			const result = await classifySynapseEntry('some text');
			assert.equal(result.type, type);
		}
	});
});
