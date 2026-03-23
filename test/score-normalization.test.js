import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

const { mockSearch, MockMemory, MockSynapseEntry, mockExtractor } = vi.hoisted(() => {
	const mockSearch = vi.fn(function*() {});
	class MockMemory { static put = vi.fn(); static search = mockSearch; static get = vi.fn(); }
	class MockSynapseEntry { static put = vi.fn(); static search = mockSearch; static get = vi.fn(); }
	const mockExtractor = vi.fn();
	return { mockSearch, MockMemory, MockSynapseEntry, mockExtractor };
});

vi.mock('harperdb', () => ({
	Resource: class Resource {},
	tables: { Memory: MockMemory, SynapseEntry: MockSynapseEntry },
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class Anthropic {
		constructor() {
			this.messages = { create: vi.fn() };
		}
	},
}));

vi.mock('@xenova/transformers', () => ({
	pipeline: vi.fn(async () => mockExtractor),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { MemorySearch, SynapseSearch } = await import('../resources.js');

describe('Score Normalization', () => {
	describe('MemorySearch', () => {
		it('normalizes distance 0 to similarity 1 (perfect match)', async () => {
			mockExtractor.mockImplementation(async () => ({
				data: new Float32Array(384).fill(0.5),
			}));

			mockSearch.mockImplementation(function*() {
				yield {
					id: 'test-id',
					rawText: 'test message',
					classification: 'decision',
					$distance: 0,
				};
			});

			const search = new MemorySearch();
			const result = await search.post({ query: 'test' });

			assert.equal(result.results[0].similarity, 1);
		});

		it('normalizes distance 1 to similarity 0.5 (moderate match)', async () => {
			mockExtractor.mockImplementation(async () => ({
				data: new Float32Array(384).fill(0.5),
			}));

			mockSearch.mockImplementation(function*() {
				yield {
					id: 'test-id',
					rawText: 'test message',
					classification: 'decision',
					$distance: 1,
				};
			});

			const search = new MemorySearch();
			const result = await search.post({ query: 'test' });

			assert.equal(result.results[0].similarity, 0.5);
		});

		it('normalizes distance 2 to similarity 0 (no match)', async () => {
			mockExtractor.mockImplementation(async () => ({
				data: new Float32Array(384).fill(0.5),
			}));

			mockSearch.mockImplementation(function*() {
				yield {
					id: 'test-id',
					rawText: 'test message',
					classification: 'decision',
					$distance: 2,
				};
			});

			const search = new MemorySearch();
			const result = await search.post({ query: 'test' });

			assert.equal(result.results[0].similarity, 0);
		});

		it('clamps negative similarity to 0', async () => {
			mockExtractor.mockImplementation(async () => ({
				data: new Float32Array(384).fill(0.5),
			}));

			mockSearch.mockImplementation(function*() {
				yield {
					id: 'test-id',
					rawText: 'test message',
					classification: 'decision',
					$distance: 2.5, // edge case beyond 2
				};
			});

			const search = new MemorySearch();
			const result = await search.post({ query: 'test' });

			assert.equal(result.results[0].similarity, 0);
		});

		it('includes similarity alongside $distance in results', async () => {
			mockExtractor.mockImplementation(async () => ({
				data: new Float32Array(384).fill(0.5),
			}));

			mockSearch.mockImplementation(function*() {
				yield {
					id: 'test-id',
					rawText: 'test message',
					classification: 'decision',
					$distance: 0.3,
				};
			});

			const search = new MemorySearch();
			const result = await search.post({ query: 'test' });

			assert.ok(result.results[0].$distance !== undefined);
			assert.ok(result.results[0].similarity !== undefined);
			assert.equal(result.results[0].similarity, 1 - 0.3 / 2);
		});
	});

	describe('SynapseSearch', () => {
		it('normalizes distance for Synapse entries', async () => {
			mockExtractor.mockImplementation(async () => ({
				data: new Float32Array(384).fill(0.5),
			}));

			mockSearch.mockImplementation(function*() {
				yield {
					id: 'synapse-1',
					type: 'intent',
					content: 'design pattern',
					$distance: 0.5,
				};
			});

			const search = new SynapseSearch();
			const result = await search.post({
				query: 'architecture',
				projectId: 'proj-1',
			});

			assert.equal(result.results[0].similarity, 1 - 0.5 / 2);
		});

		it('returns normalized scores for multiple Synapse results', async () => {
			mockExtractor.mockImplementation(async () => ({
				data: new Float32Array(384).fill(0.5),
			}));

			mockSearch.mockImplementation(function*() {
				yield {
					id: 'synapse-1',
					type: 'intent',
					content: 'design pattern',
					$distance: 0.2,
				};
				yield {
					id: 'synapse-2',
					type: 'constraint',
					content: 'must use REST',
					$distance: 0.8,
				};
			});

			const search = new SynapseSearch();
			const result = await search.post({
				query: 'architecture',
				projectId: 'proj-1',
			});

			assert.equal(result.count, 2);
			assert.equal(result.results[0].similarity, 1 - 0.2 / 2);
			assert.equal(result.results[1].similarity, 1 - 0.8 / 2);
		});
	});
});
