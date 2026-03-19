import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

const mockSearch = mock.fn(function*() {});

class MockMemory {
	static put = mock.fn();
	static search = mockSearch;
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

mock.module('@anthropic-ai/sdk', {
	defaultExport: class Anthropic {
		constructor() {
			this.messages = { create: mock.fn() };
		}
	},
});

const mockExtractor = mock.fn();
mock.module('@xenova/transformers', {
	namedExports: {
		pipeline: mock.fn(async () => mockExtractor),
	},
});

process.env.ANTHROPIC_API_KEY = 'test-key';

const { MemorySearch } = await import('../resources.js');

describe('MemorySearch - Generic Metadata Filtering', () => {
	beforeEach(() => {
		mockSearch.mock.resetCalls();
	});

	it('supports backward-compatible indexed field: source', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { source: 'slack' },
		});

		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'source');
		assert.equal(capturedParams.conditions.value, 'slack');
		assert.equal(capturedParams.conditions.comparator, 'equals');
	});

	it('supports indexed field: sourceType', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { sourceType: 'thread_reply' },
		});

		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'sourceType');
		assert.equal(capturedParams.conditions.value, 'thread_reply');
	});

	it('supports indexed field: classification', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
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

	it('supports indexed field: channelId', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { channelId: 'C123456' },
		});

		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'channelId');
		assert.equal(capturedParams.conditions.value, 'C123456');
	});

	it('supports indexed field: authorId', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { authorId: 'U123456' },
		});

		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'authorId');
		assert.equal(capturedParams.conditions.value, 'U123456');
	});

	it('combines multiple indexed filters as array', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: {
				source: 'slack',
				classification: 'action_item',
				channelId: 'C123',
			},
		});

		assert.ok(Array.isArray(capturedParams.conditions));
		assert.equal(capturedParams.conditions.length, 3);
		const attributes = capturedParams.conditions.map(c => c.attribute);
		assert.ok(attributes.includes('source'));
		assert.ok(attributes.includes('classification'));
		assert.ok(attributes.includes('channelId'));
	});

	it('ignores null and undefined filter values', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: {
				source: 'slack',
				classification: null,
				channelId: undefined,
			},
		});

		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'source');
		// Only source should be applied, not null/undefined fields
	});

	it('iterates dynamically over filter keys', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: {
				source: 'slack',
				authorId: 'U456',
				sourceType: 'message',
			},
		});

		assert.ok(Array.isArray(capturedParams.conditions));
		assert.equal(capturedParams.conditions.length, 3);
		const attributes = new Set(capturedParams.conditions.map(c => c.attribute));
		assert.ok(attributes.has('source'));
		assert.ok(attributes.has('authorId'));
		assert.ok(attributes.has('sourceType'));
	});

	it('skips non-indexed fields with warning log', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: {
				source: 'slack',
				customField: 'custom-value',
			},
		});

		// Only indexed field should be applied
		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'source');
	});

	it('handles empty filter object gracefully', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: {},
		});

		// Should not set conditions for empty filter object
		assert.equal(capturedParams.conditions, undefined);
	});

	it('returns results when filters are applied', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		const fakeResults = [
			{
				id: 'mem-1',
				rawText: 'Action item in general channel',
				source: 'slack',
				classification: 'action_item',
				channelId: 'C123',
				$distance: 0.08,
			},
			{
				id: 'mem-2',
				rawText: 'Another action item',
				source: 'slack',
				classification: 'action_item',
				channelId: 'C123',
				$distance: 0.12,
			},
		];

		mockSearch.mock.mockImplementation(function*() {
			for (const r of fakeResults) {
				yield r;
			}
		});

		const search = new MemorySearch();
		const result = await search.post({
			query: 'what action items',
			filters: {
				source: 'slack',
				classification: 'action_item',
				channelId: 'C123',
			},
		});

		assert.equal(result.count, 2);
		assert.equal(result.results.length, 2);
		assert.deepEqual(result.results, fakeResults);
	});

	it('applies single indexed filter without wrapping in array', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { source: 'slack' },
		});

		// Single condition should not be wrapped in array
		assert.ok(!Array.isArray(capturedParams.conditions));
		assert.equal(capturedParams.conditions.attribute, 'source');
	});

	it('maintains backward compatibility with old filter behavior', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		// Simulate old-style usage with only known fields
		await search.post({
			query: 'test',
			filters: {
				source: 'slack',
				classification: 'decision',
				channelId: 'C123',
				authorId: 'U456',
			},
		});

		assert.ok(Array.isArray(capturedParams.conditions));
		assert.equal(capturedParams.conditions.length, 4);
		// All four should be present with equals comparator
		for (const cond of capturedParams.conditions) {
			assert.equal(cond.comparator, 'equals');
		}
	});
});
