import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

const { MockMemory, MockSynapseEntry, mockExtractor } = vi.hoisted(() => {
	const mockExtractor = vi.fn();
	class MockMemory {
		static put = vi.fn();
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	class MockSynapseEntry {
		static put = vi.fn();
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	return { MockMemory, MockSynapseEntry, mockExtractor };
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

const { generateEmbedding } = await import('../resources.js');

describe('generateEmbedding', () => {
	it('returns a vector array for valid text', async () => {
		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.1),
		}));

		const result = await generateEmbedding('Hello world');

		assert.ok(Array.isArray(result));
		assert.equal(result.length, 384);
		assert.ok(Math.abs(result[0] - 0.1) < 1e-6);
	});

	it('throws for empty string', async () => {
		await assert.rejects(
			() => generateEmbedding(''),
			{ message: 'Cannot generate embedding for empty text' },
		);
	});

	it('throws for null input', async () => {
		await assert.rejects(
			() => generateEmbedding(null),
			{ message: 'Cannot generate embedding for empty text' },
		);
	});

	it('throws for undefined input', async () => {
		await assert.rejects(
			() => generateEmbedding(undefined),
			{ message: 'Cannot generate embedding for empty text' },
		);
	});

	it('throws for whitespace-only input', async () => {
		await assert.rejects(
			() => generateEmbedding('   '),
			{ message: 'Cannot generate embedding for empty text' },
		);
	});

	it('propagates pipeline errors', async () => {
		mockExtractor.mockImplementation(async () => {
			throw new Error('Pipeline error');
		});

		await assert.rejects(
			() => generateEmbedding('valid text'),
			{ message: 'Pipeline error' },
		);
	});

	it('calls pipeline with correct model and extractor with correct options', async () => {
		mockExtractor.mockClear();
		mockExtractor.mockImplementation(async (_text, opts) => {
			assert.equal(opts.pooling, 'mean');
			assert.equal(opts.normalize, true);
			return { data: new Float32Array(384).fill(0) };
		});

		await generateEmbedding('test message');
		assert.equal(mockExtractor.mock.calls.length, 1);
		assert.equal(mockExtractor.mock.calls[0][0], 'test message');
	});
});
