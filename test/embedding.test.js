import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

class MockMemory {
	static put = mock.fn();
	static search = mock.fn(function*() {});
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

const { generateEmbedding } = await import('../resources.js');

describe('generateEmbedding', () => {
	it('returns a vector array for valid text', async () => {
		mockExtractor.mock.mockImplementation(async () => ({
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
		mockExtractor.mock.mockImplementation(async () => {
			throw new Error('Pipeline error');
		});

		await assert.rejects(
			() => generateEmbedding('valid text'),
			{ message: 'Pipeline error' },
		);
	});

	it('calls pipeline with correct model and extractor with correct options', async () => {
		mockExtractor.mock.resetCalls();
		mockExtractor.mock.mockImplementation(async (_text, opts) => {
			assert.equal(opts.pooling, 'mean');
			assert.equal(opts.normalize, true);
			return { data: new Float32Array(384).fill(0) };
		});

		await generateEmbedding('test message');
		assert.equal(mockExtractor.mock.callCount(), 1);
		assert.equal(mockExtractor.mock.calls[0].arguments[0], 'test message');
	});
});
