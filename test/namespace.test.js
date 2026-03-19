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

describe('MemorySearch with agentId', () => {
	it('accepts agentId in filters', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { agentId: 'agent-123' },
		});

		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'agentId');
		assert.equal(capturedParams.conditions.value, 'agent-123');
	});

	it('combines agentId with other filters', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { agentId: 'agent-123', classification: 'decision' },
		});

		assert.ok(Array.isArray(capturedParams.conditions));
		assert.equal(capturedParams.conditions.length, 2);
		const agentIdCondition = capturedParams.conditions.find(c => c.attribute === 'agentId');
		assert.ok(agentIdCondition);
		assert.equal(agentIdCondition.value, 'agent-123');
	});

	it('works without agentId (optional)', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.5),
		}));

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const search = new MemorySearch();
		await search.post({
			query: 'test',
			filters: { classification: 'knowledge' },
		});

		assert.ok(capturedParams.conditions);
		assert.equal(capturedParams.conditions.attribute, 'classification');
		assert.equal(capturedParams.conditions.value, 'knowledge');
	});
});
