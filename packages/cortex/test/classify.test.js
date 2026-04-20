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

const { classifyMessage } = await import('../resources.js');

describe('classifyMessage', () => {
	beforeEach(() => {
		mockCreate.mockClear();
	});

	it('returns a valid classification for normal text', async () => {
		mockCreate.mockImplementation(async () => ({
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
		mockCreate.mockImplementation(async () => ({
			content: [{ text: 'this is not json' }],
		}));

		const result = await classifyMessage('some message');

		assert.equal(result.category, 'discussion');
		assert.ok(result.summary);
	});

	it('falls back when LLM returns an invalid category', async () => {
		mockCreate.mockImplementation(async () => ({
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
		mockCreate.mockImplementation(async () => {
			throw new Error('API rate limited');
		});

		const result = await classifyMessage('some message');

		assert.equal(result.category, 'discussion');
		assert.ok(result.summary);
	});
});
