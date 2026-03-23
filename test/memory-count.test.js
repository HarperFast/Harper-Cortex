import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

const { mockSearch, MockMemory } = vi.hoisted(() => {
	const mockSearch = vi.fn(function*() {});
	class MockMemory { static put = vi.fn(); static search = mockSearch; static get = vi.fn(); }
	return { mockSearch, MockMemory };
});

vi.mock('harperdb', () => ({
	Resource: class Resource {},
	tables: { Memory: MockMemory, SynapseEntry: class {} },
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class Anthropic {
		constructor() {
			this.messages = { create: vi.fn() };
		}
	},
}));

const { mockExtractor } = vi.hoisted(() => ({ mockExtractor: vi.fn() }));
vi.mock('@xenova/transformers', () => ({
	pipeline: vi.fn(async () => mockExtractor),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { MemoryCount } = await import('../resources.js');

describe('MemoryCount', () => {
	it('returns 0 for no memories', async () => {
		mockSearch.mockImplementation(function*() {});

		const counter = new MemoryCount();
		const result = await counter.post({});

		assert.equal(result.count, 0);
	});

	it('counts all memories without filters', async () => {
		mockSearch.mockImplementation(function*() {
			yield { id: '1' };
			yield { id: '2' };
			yield { id: '3' };
		});

		const counter = new MemoryCount();
		const result = await counter.post({});

		assert.equal(result.count, 3);
	});

	it('applies source filter', async () => {
		mockSearch.mockImplementation(function*() {
			yield { id: '1' };
			yield { id: '2' };
		});

		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
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
		mockSearch.mockImplementation(function*() {
			yield { id: '1' };
		});

		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
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
		mockSearch.mockImplementation(function*() {
			yield { id: '1' };
		});

		let capturedParams;
		mockSearch.mockImplementation(function*(params) {
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
		mockSearch.mockImplementation(function*(params) {
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
