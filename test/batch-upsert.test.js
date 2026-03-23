import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

const { mockMemoryPut, mockSynapseEntryPut, MockMemory, MockSynapseEntry } = vi.hoisted(() => {
	const mockMemoryPut = vi.fn();
	const mockSynapseEntryPut = vi.fn();
	class MockMemory { static put = mockMemoryPut; static search = vi.fn(function*() {}); static get = vi.fn(); }
	class MockSynapseEntry { static put = mockSynapseEntryPut; static search = vi.fn(function*() {}); static get = vi.fn(); }
	return { mockMemoryPut, mockSynapseEntryPut, MockMemory, MockSynapseEntry };
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

const { mockExtractor } = vi.hoisted(() => ({ mockExtractor: vi.fn() }));
vi.mock('@xenova/transformers', () => ({
	pipeline: vi.fn(async () => mockExtractor),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { BatchUpsert } = await import('../resources.js');

describe('BatchUpsert', () => {
	it('returns error for missing table', async () => {
		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({ records: [] });

		assert.ok(result.error);
		assert.ok(result.error.includes('table is required'));
	});

	it('returns error for missing records', async () => {
		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({ table: 'Memory' });

		assert.ok(result.error);
		assert.ok(result.error.includes('records is required'));
	});

	it('returns error for non-array records', async () => {
		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'Memory',
			records: 'not-an-array',
		});

		assert.ok(result.error);
		assert.ok(result.error.includes('array'));
	});

	it('returns error for invalid table name', async () => {
		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'InvalidTable',
			records: [{ id: 'test' }],
		});

		assert.ok(result.error);
		assert.ok(result.error.includes('Memory') && result.error.includes('SynapseEntry'));
	});

	it('returns success with zero records', async () => {
		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'Memory',
			records: [],
		});

		assert.equal(result.stored, 0);
		assert.deepEqual(result.errors, []);
	});

	it('upserts records to Memory table', async () => {
		mockMemoryPut.mockImplementation(async () => {});

		const records = [
			{ id: 'mem-1', rawText: 'First memory', classification: 'decision' },
			{ id: 'mem-2', rawText: 'Second memory', classification: 'action_item' },
		];

		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'Memory',
			records,
		});

		assert.equal(result.stored, 2);
		assert.deepEqual(result.errors, []);
		assert.equal(mockMemoryPut.mock.calls.length, 2);
	});

	it('upserts records to SynapseEntry table', async () => {
		mockSynapseEntryPut.mockImplementation(async () => {});

		const records = [
			{ id: 'syn-1', projectId: 'proj-1', type: 'intent', content: 'First entry' },
			{ id: 'syn-2', projectId: 'proj-1', type: 'constraint', content: 'Second entry' },
		];

		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'SynapseEntry',
			records,
		});

		assert.equal(result.stored, 2);
		assert.deepEqual(result.errors, []);
		assert.equal(mockSynapseEntryPut.mock.calls.length, 2);
	});

	it('handles individual record failures gracefully', async () => {
		const callCount = { count: 0 };
		mockMemoryPut.mockImplementation(async (record) => {
			callCount.count++;
			if (callCount.count === 2) {
				throw new Error('Database constraint violation');
			}
		});

		const records = [
			{ id: 'mem-1', rawText: 'First' },
			{ id: 'mem-2', rawText: 'Second' },
			{ id: 'mem-3', rawText: 'Third' },
		];

		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'Memory',
			records,
		});

		assert.equal(result.stored, 2);
		assert.equal(result.errors.length, 1);
		assert.equal(result.errors[0].index, 1);
		assert.ok(result.errors[0].error.includes('constraint'));
	});

	it('validates individual records are objects', async () => {
		mockMemoryPut.mockImplementation(async () => {});

		const records = [
			{ id: 'mem-1', rawText: 'Valid' },
			null,
			'not-an-object',
		];

		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'Memory',
			records,
		});

		assert.equal(result.stored, 1);
		assert.equal(result.errors.length, 2);
		assert.equal(result.errors[0].index, 1);
		assert.equal(result.errors[1].index, 2);
	});

	it('processes large batches', async () => {
		mockMemoryPut.mockImplementation(async () => {});

		const records = Array.from({ length: 100 }, (_, i) => ({
			id: `mem-${i}`,
			rawText: `Memory ${i}`,
		}));

		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'Memory',
			records,
		});

		assert.equal(result.stored, 100);
		assert.deepEqual(result.errors, []);
		assert.equal(mockMemoryPut.mock.calls.length, 100);
	});

	it('stores records without requiring id field', async () => {
		mockMemoryPut.mockImplementation(async () => {});

		const records = [
			{ rawText: 'First memory', classification: 'decision' },
			{ rawText: 'Second memory', classification: 'action_item' },
		];

		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'Memory',
			records,
		});

		assert.equal(result.stored, 2);
		assert.deepEqual(result.errors, []);
	});

	it('uses fallback names in error messages for records without id', async () => {
		const callCount = { count: 0 };
		mockMemoryPut.mockImplementation(async () => {
			callCount.count++;
			if (callCount.count === 2) {
				throw new Error('Test error');
			}
		});

		const records = [
			{ rawText: 'First' },
			{ rawText: 'Second' },
		];

		const batchUpsert = new BatchUpsert();
		const result = await batchUpsert.post({
			table: 'Memory',
			records,
		});

		assert.equal(result.stored, 1);
		assert.equal(result.errors.length, 1);
		assert.equal(result.errors[0].index, 1);
		assert.equal(result.errors[0].record, 'record-1');
	});
});
