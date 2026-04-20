import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const { mockMemoryPut, mockSynapseEntryPut, MockMemory, MockSynapseEntry, mockTransaction } = vi.hoisted(() => {
	const mockMemoryPut = vi.fn();
	const mockSynapseEntryPut = vi.fn();
	const mockTransaction = vi.fn(async (cb) => cb());
	class MockMemory {
		static put = mockMemoryPut;
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	class MockSynapseEntry {
		static put = mockSynapseEntryPut;
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	return { mockMemoryPut, mockSynapseEntryPut, MockMemory, MockSynapseEntry, mockTransaction };
});

vi.mock('harper', () => ({
	Resource: class Resource {},
	tables: { Memory: MockMemory, SynapseEntry: MockSynapseEntry },
	transaction: mockTransaction,
	default: { transaction: mockTransaction },
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class Anthropic {
		constructor() {
			this.messages = { create: vi.fn() };
		}
	},
}));

const { mockExtractor } = vi.hoisted(() => ({ mockExtractor: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({
	pipeline: vi.fn(async () => mockExtractor),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { BatchUpsert } = await import('../resources.js');

describe('BatchUpsert', () => {
	beforeEach(() => {
		mockMemoryPut.mockClear();
		mockSynapseEntryPut.mockClear();
		mockTransaction.mockClear();
		mockTransaction.mockImplementation(async (cb) => cb());
	});

	it('returns error for missing table', async () => {
		const result = await BatchUpsert.post(null, { records: [] });

		assert.ok(result.type);
		assert.ok(result.detail.includes('table is required'));
	});

	it('returns error for missing records', async () => {
		const result = await BatchUpsert.post(null, { table: 'Memory' });

		assert.ok(result.type);
		assert.ok(result.detail.includes('records is required'));
	});

	it('returns error for non-array records', async () => {
		const result = await BatchUpsert.post(null, {
			table: 'Memory',
			records: 'not-an-array',
		});

		assert.ok(result.type);
		assert.ok(result.detail.includes('array'));
	});

	it('returns error for invalid table name', async () => {
		const result = await BatchUpsert.post(null, {
			table: 'InvalidTable',
			records: [{ id: 'test' }],
		});

		assert.ok(result.type);
		assert.ok(result.detail.includes('Memory') && result.detail.includes('SynapseEntry'));
	});

	it('returns success with zero records', async () => {
		const result = await BatchUpsert.post(null, {
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

		const result = await BatchUpsert.post(null, {
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

		const result = await BatchUpsert.post(null, {
			table: 'SynapseEntry',
			records,
		});

		assert.equal(result.stored, 2);
		assert.deepEqual(result.errors, []);
		assert.equal(mockSynapseEntryPut.mock.calls.length, 2);
	});

	it('handles individual record failures gracefully', async () => {
		const callCount = { count: 0 };
		mockMemoryPut.mockImplementation(async (_record) => {
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

		const result = await BatchUpsert.post(null, {
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

		const result = await BatchUpsert.post(null, {
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

		const result = await BatchUpsert.post(null, {
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

		const result = await BatchUpsert.post(null, {
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

		const result = await BatchUpsert.post(null, {
			table: 'Memory',
			records,
		});

		assert.equal(result.stored, 1);
		assert.equal(result.errors.length, 1);
		assert.equal(result.errors[0].index, 1);
		assert.equal(result.errors[0].record, 'record-1');
	});

	it('wraps each record put in its own transaction (per-record isolation)', async () => {
		// Scenario: middle record throws; surrounding records must still succeed.
		// Each successful put must execute inside its own transaction() call.
		let call = 0;
		mockMemoryPut.mockImplementation(async () => {
			call++;
			if (call === 2) { throw new Error('simulated conflict'); }
		});

		const records = [
			{ id: 'a', rawText: 'First' },
			{ id: 'b', rawText: 'Bad' },
			{ id: 'c', rawText: 'Third' },
		];

		const result = await BatchUpsert.post(null, { table: 'Memory', records });

		assert.equal(result.stored, 2);
		assert.equal(result.errors.length, 1);
		assert.equal(result.errors[0].record, 'b');
		// transaction() called once per record — confirms per-record boundary
		assert.equal(mockTransaction.mock.calls.length, 3);
		// each transaction call received a function
		for (const c of mockTransaction.mock.calls) {
			assert.equal(typeof c[0], 'function');
		}
	});
});
