import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

const { mockSearch, MockMemory, MockSynapseEntry, mockExtractor } = vi.hoisted(() => {
	const mockSearch = vi.fn(function*() {});
	class MockMemory {
		static put = vi.fn();
		static search = mockSearch;
		static get = vi.fn();
	}
	class MockSynapseEntry {
		static put = vi.fn();
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	const mockExtractor = vi.fn();
	return { mockSearch, MockMemory, MockSynapseEntry, mockExtractor };
});

vi.mock('harper', () => ({
	Resource: class Resource {},
	tables: { Memory: MockMemory, SynapseEntry: MockSynapseEntry },
	default: { transaction: async (cb) => cb() },
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class Anthropic {
		constructor() {
			this.messages = { create: vi.fn() };
		}
	},
}));

vi.mock('@huggingface/transformers', () => ({
	pipeline: vi.fn(async () => mockExtractor),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { MemorySearch } = await import('../resources.js');

describe('MemorySearch', () => {
	it('returns error for missing query', async () => {
		const search = new MemorySearch();
		const result = await search.post({});

		assert.ok(result.error);
		assert.ok(result.error.includes('query is required'));
	});

	it('returns error for empty string query', async () => {
		const search = new MemorySearch();
		const result = await search.post({ query: '' });

		assert.ok(result.error);
	});

	it('returns error for null data', async () => {
		const search = new MemorySearch();
		const result = await search.post(null);

		assert.ok(result.error);
	});

	it('performs vector search with valid query', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		const fakeResult = {
			id: 'test-id',
			rawText: 'We decided to use Redis',
			classification: 'decision',
			summary: 'Team chose Redis',
			$distance: 0.15,
		};

		mockSearch.mockImplementation(function*() {
			yield fakeResult;
		});

		const search = new MemorySearch();
		const result = await search.post({ query: 'caching decision' });

		assert.ok(result.results);
		assert.equal(result.count, 1);
		assert.equal(result.results[0].id, 'test-id');
		assert.equal(result.results[0].$distance, 0.15);
	});

	it('respects the limit parameter', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({ query: 'test', limit: 5 });

		assert.equal(capturedParams.limit, 5);
	});

	it('caps limit at 100', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({ query: 'test', limit: 500 });

		assert.equal(capturedParams.limit, 100);
	});

	it('applies classification filter for hybrid search', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { classification: 'decision' },
		});

		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'classification');
		assert.equal(capturedParams.conditions.value, 'decision');
	});

	it('applies multiple filters as array', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { classification: 'decision', source: 'slack' },
		});

		assert.ok(Array.isArray(capturedParams.conditions));
		assert.equal(capturedParams.conditions.length, 2);
	});

	it('defaults limit to 10 for invalid values', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({ query: 'test', limit: 'invalid' });

		assert.equal(capturedParams.limit, 10);
	});
});
