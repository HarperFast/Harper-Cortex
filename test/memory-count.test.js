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

const { MemoryCount } = await import('../resources.js');

describe('MemoryCount', () => {
	it('returns 0 for no memories', async () => {
		mockSearch.mock.mockImplementation(function*() {});

		const counter = new MemoryCount();
		const result = await counter.post({});

		assert.equal(result.count, 0);
	});

	it('counts all memories without filters', async () => {
		mockSearch.mock.mockImplementation(function*() {
			yield { id: '1' };
			yield { id: '2' };
			yield { id: '3' };
		});

		const counter = new MemoryCount();
		const result = await counter.post({});

		assert.equal(result.count, 3);
	});

	it('applies source filter', async () => {
		mockSearch.mock.mockImplementation(function*() {
			yield { id: '1' };
			yield { id: '2' };
		});

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
			yield { id: '1' };
			yield { id: '2' };
		});

		const counter = new MemoryCount();
		const result = await counter.post({ filters: { source: 'slack' } });

		assert.equal(result.count, 2);
		assert.equal(capturedParams.conditions.attribute, 'source');
		assert.equal(capturedParams.conditions.value, 'slack');
	});

	it('applies classification filter', async () => {
		mockSearch.mock.mockImplementation(function*() {
			yield { id: '1' };
		});

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
			yield { id: '1' };
		});

		const counter = new MemoryCount();
		const result = await counter.post({ filters: { classification: 'decision' } });

		assert.equal(result.count, 1);
		assert.equal(capturedParams.conditions.attribute, 'classification');
		assert.equal(capturedParams.conditions.value, 'decision');
	});

	it('combines multiple filters', async () => {
		mockSearch.mock.mockImplementation(function*() {
			yield { id: '1' };
		});

		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
			yield { id: '1' };
		});

		const counter = new MemoryCount();
		const result = await counter.post({
			filters: { source: 'slack', channelId: '#engineering' },
		});

		assert.equal(result.count, 1);
		assert.ok(Array.isArray(capturedParams.conditions));
		assert.equal(capturedParams.conditions.length, 2);
	});

	it('applies agentId filter', async () => {
		let capturedParams;
		mockSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
			yield { id: '1' };
			yield { id: '2' };
			yield { id: '3' };
		});

		const counter = new MemoryCount();
		const result = await counter.post({ filters: { agentId: 'agent-456' } });

		assert.equal(result.count, 3);
		assert.equal(capturedParams.conditions.attribute, 'agentId');
		assert.equal(capturedParams.conditions.value, 'agent-456');
	});
});
