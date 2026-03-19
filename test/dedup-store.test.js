import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

const mockSearch = mock.fn(function*() {});

class MockMemory {
	static put = mock.fn();
	static search = mockSearch;
	static get = mock.fn();
}

mock.module('harperdb', {
	namedExports: {
		Resource: class Resource {},
		tables: { Memory: MockMemory, SynapseEntry: class {} },
	},
});

let mockClassifyFn;
mock.module('@anthropic-ai/sdk', {
	defaultExport: class Anthropic {
		constructor() {
			this.messages = {
				create: mockClassifyFn || mock.fn(),
			};
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

const { MemoryStore } = await import('../resources.js');

describe('MemoryStore with Deduplication', () => {
	it('returns error for missing text', async () => {
		const store = new MemoryStore();
		const result = await store.post({});

		assert.ok(result.error);
		assert.ok(result.error.includes('text is required'));
	});

	it('returns error for empty text', async () => {
		const store = new MemoryStore();
		const result = await store.post({ text: '' });

		assert.ok(result.error);
	});

	it('stores memory without dedup threshold', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		mockSearch.mock.mockImplementation(function*() {});

		mockClassifyFn = mock.fn(async () => ({
			messages: {
				create: mock.fn(async () => ({
					content: [
						{
							text: JSON.stringify({
								category: 'decision',
								entities: { people: [], projects: [], technologies: [], topics: [] },
								summary: 'Test decision',
							}),
						},
					],
				})),
			},
		}));

		const store = new MemoryStore();
		const result = await store.post({ text: 'This is a new memory' });

		assert.equal(result.stored, true);
		assert.equal(result.deduplicated, false);
		assert.ok(result.summary);
	});

	it('deduplicates when similarity exceeds threshold', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		const existingRecord = {
			id: 'existing-1',
			rawText: 'Similar memory',
			summary: 'Similar decision',
			$distance: 0.1, // High similarity: 1 - 0.1/2 = 0.95
		};

		mockSearch.mock.mockImplementation(function*() {
			yield existingRecord;
		});

		const store = new MemoryStore();
		const result = await store.post({
			text: 'Very similar memory',
			dedupThreshold: 0.9,
		});

		assert.equal(result.stored, false);
		assert.equal(result.deduplicated, true);
		assert.equal(result.id, 'existing-1');
		assert.ok(result.similarity >= 0.9);
	});

	it('stores when similarity is below threshold', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		const dissimilarRecord = {
			id: 'different-1',
			rawText: 'Different memory',
			summary: 'Completely different',
			$distance: 1.5, // Low similarity: 1 - 1.5/2 = 0.25
		};

		mockSearch.mock.mockImplementation(function*() {
			yield dissimilarRecord;
		});

		mockClassifyFn = mock.fn(async () => ({
			messages: {
				create: mock.fn(async () => ({
					content: [
						{
							text: JSON.stringify({
								category: 'question',
								entities: { people: [], projects: [], technologies: [], topics: [] },
								summary: 'New question',
							}),
						},
					],
				})),
			},
		}));

		const store = new MemoryStore();
		const result = await store.post({
			text: 'Unrelated memory',
			dedupThreshold: 0.9,
		});

		assert.equal(result.stored, true);
		assert.equal(result.deduplicated, false);
	});

	it('filters dedup search by agentId when provided', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const store = new MemoryStore();
		await store.post({
			text: 'Test memory',
			dedupThreshold: 0.9,
			agentId: 'agent-xyz',
		});

		assert.ok(capturedParams);
		assert.equal(capturedParams.conditions.attribute, 'agentId');
		assert.equal(capturedParams.conditions.value, 'agent-xyz');
	});

	it('stores metadata including dedup threshold', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		mockSearch.mock.mockImplementation(function*() {});

		mockClassifyFn = mock.fn(async () => ({
			messages: {
				create: mock.fn(async () => ({
					content: [
						{
							text: JSON.stringify({
								category: 'knowledge',
								entities: { people: [], projects: [], technologies: [], topics: [] },
								summary: 'Stored knowledge',
							}),
						},
					],
				})),
			},
		}));

		const store = new MemoryStore();
		await store.post({
			text: 'Knowledge to store',
			dedupThreshold: 0.95,
			agentId: 'agent-123',
		});

		const callArgs = MockMemory.put.mock.calls[0]?.[0];
		assert.ok(callArgs);
		assert.equal(callArgs.metadata.dedup_threshold, 0.95);
		assert.equal(callArgs.agentId, 'agent-123');
		assert.equal(callArgs.metadata.stored_via, 'memory_store');
	});

	it('respects dedup search limit of 5', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const store = new MemoryStore();
		await store.post({
			text: 'Test memory',
			dedupThreshold: 0.5,
		});

		assert.equal(capturedParams.limit, 5);
	});
});
