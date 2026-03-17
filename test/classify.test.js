import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

// Memory must be a class since resources.js extends it
class MockMemory {
	static put = mock.fn();
	static search = mock.fn(function*() {});
	static get = mock.fn();
}

class MockSynapseEntry {
	static put = mock.fn();
	static search = mock.fn(function*() {});
	static get = mock.fn();
}

mock.module('harperdb', {
	namedExports: {
		Resource: class Resource {},
		tables: { Memory: MockMemory, SynapseEntry: MockSynapseEntry },
	},
});

const mockCreate = mock.fn();
mock.module('@anthropic-ai/sdk', {
	defaultExport: class Anthropic {
		constructor() {
			this.messages = { create: mockCreate };
		}
	},
});

mock.module('@xenova/transformers', {
	namedExports: {
		pipeline: mock.fn(async () => async () => ({ data: new Float32Array(384).fill(0.1) })),
	},
});

process.env.ANTHROPIC_API_KEY = 'test-key';

const { classifyMessage } = await import('../resources.js');

describe('classifyMessage', () => {
	beforeEach(() => {
		mockCreate.mock.resetCalls();
	});

	it('returns a valid classification for normal text', async () => {
		mockCreate.mock.mockImplementation(async () => ({
			content: [{
				text: JSON.stringify({
					category: 'decision',
					entities: {
						people: ['Alice'],
						projects: ['Memory System'],
						technologies: ['HarperDB'],
						topics: ['architecture'],
						dates: [],
					},
					summary: 'Team decided to use HarperDB for the memory system.',
				}),
			}],
		}));

		const result = await classifyMessage('We decided to use HarperDB for the memory system');

		assert.equal(result.category, 'decision');
		assert.ok(Array.isArray(result.entities.people));
		assert.ok(Array.isArray(result.entities.technologies));
		assert.equal(typeof result.summary, 'string');
	});

	it('returns fallback classification for empty text', async () => {
		const result = await classifyMessage('');

		assert.equal(result.category, 'discussion');
		assert.deepEqual(result.entities, {
			people: [],
			projects: [],
			technologies: [],
			topics: [],
			dates: [],
		});
	});

	it('returns fallback classification for null text', async () => {
		const result = await classifyMessage(null);
		assert.equal(result.category, 'discussion');
	});

	it('returns fallback classification for non-string text', async () => {
		const result = await classifyMessage(42);
		assert.equal(result.category, 'discussion');
	});

	it('handles malformed JSON from LLM gracefully', async () => {
		mockCreate.mock.mockImplementation(async () => ({
			content: [{ text: 'this is not json' }],
		}));

		const result = await classifyMessage('some message');

		assert.equal(result.category, 'discussion');
		assert.ok(result.summary);
	});

	it('falls back when LLM returns an invalid category', async () => {
		mockCreate.mock.mockImplementation(async () => ({
			content: [{
				text: JSON.stringify({
					category: 'invalid_category',
					entities: { people: [], projects: [], technologies: [], topics: [], dates: [] },
					summary: 'A summary',
				}),
			}],
		}));

		const result = await classifyMessage('some message');

		assert.equal(result.category, 'discussion');
		assert.equal(result.summary, 'A summary');
	});

	it('handles API errors gracefully', async () => {
		mockCreate.mock.mockImplementation(async () => {
			throw new Error('API rate limited');
		});

		const result = await classifyMessage('some message');

		assert.equal(result.category, 'discussion');
		assert.ok(result.summary);
	});
});
