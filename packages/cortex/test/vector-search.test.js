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
	transaction: async (cb) => cb(),
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

const { VectorSearch } = await import('../resources.js');

describe('VectorSearch', () => {
	it('returns error for missing vector', async () => {
		const result = await VectorSearch.post(null, {});

		assert.ok(result.type);
		assert.ok(result.detail.includes('vector is required'));
	});

	it('returns error for non-array vector', async () => {
		const result = await VectorSearch.post(null, { vector: 'not-an-array' });

		assert.ok(result.type);
		assert.ok(result.detail.includes('array'));
	});

	it('returns error for vector with non-numeric values', async () => {
		const result = await VectorSearch.post(null, { vector: [0.1, 'not-a-number', 0.3] });

		assert.ok(result.type);
		assert.ok(result.detail.includes('numeric'));
	});

	it('performs vector search with valid vector', async () => {
		const fakeResult = {
			id: 'test-id',
			rawText: 'We decided to use Redis',
			classification: 'decision',
			summary: 'Team chose Redis',
			$distance: 0.12,
		};

		mockSearch.mockImplementation(function*() {
			yield fakeResult;
		});

		const testVector = Array(384).fill(0.5);
		const result = await VectorSearch.post(null, { vector: testVector });

		assert.ok(result.results);
		assert.equal(result.count, 1);
		assert.equal(result.results[0].id, 'test-id');
		assert.equal(result.results[0].$distance, 0.12);
	});

	it('respects the limit parameter', async () => {
		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const testVector = Array(384).fill(0.5);
		await VectorSearch.post(null, { vector: testVector, limit: 7 });

		assert.equal(capturedParams.limit, 7);
	});

	it('caps limit at 100', async () => {
		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const testVector = Array(384).fill(0.5);
		await VectorSearch.post(null, { vector: testVector, limit: 500 });

		assert.equal(capturedParams.limit, 100);
	});

	it('uses provided vector as search target', async () => {
		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const testVector = Array(384).fill(0.25);
		await VectorSearch.post(null, { vector: testVector });

		assert.deepEqual(capturedParams.sort.target, testVector);
		assert.equal(capturedParams.sort.attribute, 'embedding');
	});

	it('applies classification filter', async () => {
		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const testVector = Array(384).fill(0.5);
		await VectorSearch.post(null, {
			vector: testVector,
			filter: { classification: 'action_item' },
		});

		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'classification');
		assert.equal(capturedParams.conditions.value, 'action_item');
	});

	it('applies multiple filters as array', async () => {
		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const testVector = Array(384).fill(0.5);
		await VectorSearch.post(null, {
			vector: testVector,
			filter: { source: 'slack', channelId: 'C1234' },
		});

		assert.ok(Array.isArray(capturedParams.conditions));
		assert.equal(capturedParams.conditions.length, 2);
	});

	it('defaults limit to 10 for invalid values', async () => {
		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const testVector = Array(384).fill(0.5);
		await VectorSearch.post(null, { vector: testVector, limit: 'invalid' });

		assert.equal(capturedParams.limit, 10);
	});

	it('handles multiple search results', async () => {
		const results = [
			{
				id: 'result-1',
				rawText: 'First result',
				$distance: 0.1,
			},
			{
				id: 'result-2',
				rawText: 'Second result',
				$distance: 0.15,
			},
			{
				id: 'result-3',
				rawText: 'Third result',
				$distance: 0.2,
			},
		];

		mockSearch.mockImplementation(function*() {
			for (const r of results) {
				yield r;
			}
		});

		const testVector = Array(384).fill(0.5);
		const result = await VectorSearch.post(null, { vector: testVector });

		assert.equal(result.count, 3);
		assert.equal(result.results.length, 3);
		assert.deepEqual(result.results, results);
	});
});
