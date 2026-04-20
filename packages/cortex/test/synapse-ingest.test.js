import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const { MockMemory, mockSynapsePut, MockSynapseEntry, mockCreate, mockExtractor } = vi.hoisted(() => {
	const mockSynapsePut = vi.fn();
	const mockCreate = vi.fn();
	const mockExtractor = vi.fn();
	class MockMemory {
		static put = vi.fn();
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	class MockSynapseEntry {
		static put = mockSynapsePut;
		static search = vi.fn(function*() {});
		static get = vi.fn();
	}
	return { MockMemory, mockSynapsePut, MockSynapseEntry, mockCreate, mockExtractor };
});

vi.mock('harper', () => ({
	Resource: class Resource {},
	tables: { Memory: MockMemory, SynapseEntry: MockSynapseEntry },
}));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class Anthropic {
		constructor() {
			this.messages = { create: mockCreate };
		}
	},
}));

vi.mock('@huggingface/transformers', () => ({
	pipeline: vi.fn(async () => mockExtractor),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { SynapseIngest } = await import('../resources.js');

describe('SynapseIngest', () => {
	beforeEach(() => {
		mockCreate.mockClear();
		mockExtractor.mockClear();
		mockSynapsePut.mockClear();

		mockCreate.mockImplementation(async () => ({
			content: [{
				text: JSON.stringify({
					type: 'intent',
					entities: { people: [], projects: [], technologies: [], topics: [] },
					summary: 'Test summary',
					tags: ['test'],
				}),
			}],
		}));

		mockExtractor.mockImplementation(async () => ({
			data: new Float32Array(384).fill(0.1),
		}));

		mockSynapsePut.mockImplementation(async () => {});
	});

	it('returns error for missing content', async () => {
		const ingest = new SynapseIngest();
		const result = await ingest.post({ source: 'claude_code', projectId: 'proj-1' });

		assert.ok(result.error);
		assert.ok(result.error.includes('content is required'));
	});

	it('returns error for missing projectId', async () => {
		const ingest = new SynapseIngest();
		const result = await ingest.post({ source: 'claude_code', content: 'some content' });

		assert.ok(result.error);
		assert.ok(result.error.includes('projectId is required'));
	});

	it('returns error for invalid source', async () => {
		const ingest = new SynapseIngest();
		const result = await ingest.post({ source: 'invalid_tool', content: 'some content', projectId: 'proj-1' });

		assert.ok(result.error);
		assert.ok(result.error.includes('source must be one of'));
	});

	it('returns error for missing source', async () => {
		const ingest = new SynapseIngest();
		const result = await ingest.post({ content: 'some content', projectId: 'proj-1' });

		assert.ok(result.error);
	});

	it('stores parsed entries and returns count', async () => {
		const ingest = new SynapseIngest();
		const result = await ingest.post({
			source: 'copilot',
			content: 'Always use TypeScript. Never use any.',
			projectId: 'my-project',
		});

		assert.equal(result.count, 1);
		assert.ok(Array.isArray(result.stored));
		assert.equal(mockSynapsePut.mock.calls.length, 1);
	});

	it('stores each entry with correct fields', async () => {
		const ingest = new SynapseIngest();
		await ingest.post({
			source: 'copilot',
			content: 'Always write tests.',
			projectId: 'my-project',
		});

		const storedRecord = mockSynapsePut.mock.calls[0][0];
		assert.equal(storedRecord.projectId, 'my-project');
		assert.equal(storedRecord.source, 'copilot');
		assert.equal(storedRecord.status, 'active');
		assert.ok(Array.isArray(storedRecord.embedding));
	});

	it('generates deterministic IDs for deduplication', async () => {
		const ingest = new SynapseIngest();
		const payload = { source: 'copilot', content: 'Always write tests.', projectId: 'my-project' };

		await ingest.post(payload);
		const firstId = mockSynapsePut.mock.calls[0][0].id;

		mockSynapsePut.mockClear();
		await ingest.post(payload);
		const secondId = mockSynapsePut.mock.calls[0][0].id;

		assert.equal(firstId, secondId);
		assert.equal(typeof firstId, 'string');
		assert.ok(firstId.length > 0);
	});

	describe('parsers', () => {
		it('parseClaudeCode splits content on ## headings', async () => {
			const claudeMd = `## Architecture\n\nUse Harper for storage.\n\n## Testing\n\nAlways run npm test.`;
			const ingest = new SynapseIngest();
			const result = await ingest.post({
				source: 'claude_code',
				content: claudeMd,
				projectId: 'proj-1',
			});

			assert.equal(result.count, 2);
			assert.equal(mockSynapsePut.mock.calls.length, 2);
		});

		it('parseClaudeCode preserves preamble before first heading', async () => {
			const claudeMd = `# Cortex\n\nIntro text here.\n\n## Architecture\n\nUse Harper for storage.`;
			const ingest = new SynapseIngest();
			const result = await ingest.post({
				source: 'claude_code',
				content: claudeMd,
				projectId: 'proj-1',
			});

			assert.equal(result.count, 2);
			assert.equal(mockSynapsePut.mock.calls.length, 2);
			// First entry is the preamble
			const preamble = mockSynapsePut.mock.calls[0][0];
			assert.ok(preamble.content.includes('Intro text here'));
			assert.ok(!preamble.content.startsWith('## '));
		});

		it('parseClaudeCode falls back to single entry when no headings', async () => {
			const ingest = new SynapseIngest();
			const result = await ingest.post({
				source: 'claude_code',
				content: 'This is a plain instruction without headings.',
				projectId: 'proj-1',
			});

			assert.equal(result.count, 1);
		});

		it('parseCursor extracts frontmatter and body as mdc format', async () => {
			const mdc =
				`---\ndescription: Use TypeScript everywhere\nglobs: **/*.ts\n---\n\nAlways prefer TypeScript over JavaScript.`;
			const ingest = new SynapseIngest();
			const result = await ingest.post({
				source: 'cursor',
				content: mdc,
				projectId: 'proj-1',
			});

			assert.equal(result.count, 1);
			const stored = mockSynapsePut.mock.calls[0][0];
			assert.equal(stored.sourceFormat, 'mdc');
		});

		it('parseCursor falls back to single entry without frontmatter', async () => {
			const ingest = new SynapseIngest();
			const result = await ingest.post({
				source: 'cursor',
				content: 'Plain rule text without frontmatter.',
				projectId: 'proj-1',
			});

			assert.equal(result.count, 1);
		});

		it('parseWindsurf splits on ## headings', async () => {
			const rules = `## Naming\n\nUse camelCase.\n\n## Structure\n\nOne component per file.`;
			const ingest = new SynapseIngest();
			const result = await ingest.post({
				source: 'windsurf',
				content: rules,
				projectId: 'proj-1',
			});

			assert.equal(result.count, 2);
		});

		it('parseCopilot passes through as single entry', async () => {
			const ingest = new SynapseIngest();
			const result = await ingest.post({
				source: 'copilot',
				content: 'Always use British English in comments.',
				projectId: 'proj-1',
			});

			assert.equal(result.count, 1);
		});

		it('manual source passes through as single entry', async () => {
			const ingest = new SynapseIngest();
			const result = await ingest.post({
				source: 'manual',
				content: 'A manually entered context note.',
				projectId: 'proj-1',
			});

			assert.equal(result.count, 1);
		});
	});
});
