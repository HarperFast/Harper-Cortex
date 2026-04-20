import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const { MockMemory, mockSynapseSearch, MockSynapseEntry, mockExtractor } = vi.hoisted(() => {
	const mockSynapseSearch = vi.fn(function*() {});
	const mockExtractor = vi.fn();
	class MockMemory {
		static put = vi.fn();
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	class MockSynapseEntry {
		static put = vi.fn();
		static search = mockSynapseSearch;
		static get = vi.fn();
	}
	return { MockMemory, mockSynapseSearch, MockSynapseEntry, mockExtractor };
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

const { SynapseSearch } = await import('../resources.js');

describe('SynapseSearch', () => {
	beforeEach(() => {
		mockSynapseSearch.mockClear();
		mockExtractor.mockClear();
	});

	it('returns error for missing query', async () => {
		const search = new SynapseSearch();
		const result = await search.post({ projectId: 'proj-1' });

		assert.ok(result.error);
		assert.ok(result.error.includes('query is required'));
	});

	it('returns error for empty string query', async () => {
		const search = new SynapseSearch();
		const result = await search.post({ query: '', projectId: 'proj-1' });

		assert.ok(result.error);
	});

	it('returns error for missing projectId', async () => {
		const search = new SynapseSearch();
		const result = await search.post({ query: 'architecture decision' });

		assert.ok(result.error);
		assert.ok(result.error.includes('projectId is required'));
	});

	it('returns error for null data', async () => {
		const search = new SynapseSearch();
		const result = await search.post(null);

		assert.ok(result.error);
	});

	it('performs vector search with valid query and projectId', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		const fakeResult = {
			id: 'synapse-123',
			type: 'intent',
			content: 'We chose HarperDB for HNSW indexing',
			summary: 'HarperDB chosen for vector search',
			$distance: 0.12,
		};

		mockSynapseSearch.mockImplementation(function*() {
			yield fakeResult;
		});

		const search = new SynapseSearch();
		const result = await search.post({ query: 'architecture decision', projectId: 'my-project' });

		assert.ok(result.results);
		assert.equal(result.count, 1);
		assert.equal(result.results[0].id, 'synapse-123');
		assert.equal(result.results[0].type, 'intent');
	});

	it('always filters by projectId and status: active', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSynapseSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new SynapseSearch();
		await search.post({ query: 'test', projectId: 'my-project' });

		assert.ok(Array.isArray(capturedParams.conditions));
		const projectCondition = capturedParams.conditions.find(c => c.attribute === 'projectId');
		const statusCondition = capturedParams.conditions.find(c => c.attribute === 'status');
		assert.ok(projectCondition);
		assert.equal(projectCondition.value, 'my-project');
		assert.ok(statusCondition);
		assert.equal(statusCondition.value, 'active');
	});

	it('respects the limit parameter', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSynapseSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new SynapseSearch();
		await search.post({ query: 'test', projectId: 'proj-1', limit: 5 });

		assert.equal(capturedParams.limit, 5);
	});

	it('caps limit at 100', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSynapseSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new SynapseSearch();
		await search.post({ query: 'test', projectId: 'proj-1', limit: 500 });

		assert.equal(capturedParams.limit, 100);
	});

	it('applies type filter when valid', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSynapseSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new SynapseSearch();
		await search.post({ query: 'test', projectId: 'proj-1', filters: { type: 'constraint' } });

		const typeCondition = capturedParams.conditions.find(c => c.attribute === 'type');
		assert.ok(typeCondition);
		assert.equal(typeCondition.value, 'constraint');
	});

	it('ignores invalid type filter', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSynapseSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new SynapseSearch();
		await search.post({ query: 'test', projectId: 'proj-1', filters: { type: 'invalid_type' } });

		const typeCondition = capturedParams.conditions.find(c => c.attribute === 'type');
		assert.ok(!typeCondition);
	});

	it('applies source filter when valid', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0),
		}));

		let capturedParams;
		mockSynapseSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new SynapseSearch();
		await search.post({ query: 'test', projectId: 'proj-1', filters: { source: 'cursor' } });

		const sourceCondition = capturedParams.conditions.find(c => c.attribute === 'source');
		assert.ok(sourceCondition);
		assert.equal(sourceCondition.value, 'cursor');
	});
});
