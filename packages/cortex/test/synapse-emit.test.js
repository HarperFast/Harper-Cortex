import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const { MockMemory, mockSynapseSearch, MockSynapseEntry } = vi.hoisted(() => {
	const mockSynapseSearch = vi.fn(function*() {});
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
	return { MockMemory, mockSynapseSearch, MockSynapseEntry };
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
	pipeline: vi.fn(async () => async () => ({ data: new Float32Array(384).fill(0.1) })),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

const { SynapseEmit } = await import('../resources.js');

const fakeEntries = [
	{ id: 'abc12345', type: 'intent', content: 'Use Harper for storage.', summary: 'Harper for storage', metadata: {} },
	{ id: 'def67890', type: 'constraint', content: 'Never use ORMs.', summary: 'No ORMs', metadata: {} },
];

describe('SynapseEmit', () => {
	beforeEach(() => {
		mockSynapseSearch.mockClear();
	});

	it('returns error for missing target', async () => {
		const result = await SynapseEmit.post(null, { projectId: 'proj-1' });

		assert.ok(result.type);
		assert.ok(result.detail.includes('target must be one of'));
	});

	it('returns error for invalid target', async () => {
		const result = await SynapseEmit.post(null, { target: 'vscode', projectId: 'proj-1' });

		assert.ok(result.type);
	});

	it('rejects slack as an emit target', async () => {
		const result = await SynapseEmit.post(null, { target: 'slack', projectId: 'proj-1' });

		assert.ok(result.type);
		assert.ok(result.detail.includes('target must be one of'));
	});

	it('accepts markdown as an emit target', async () => {
		mockSynapseSearch.mockImplementation(function*() {});

		const result = await SynapseEmit.post(null, { target: 'markdown', projectId: 'proj-1' });

		assert.ok(!result.type);
		assert.equal(result.target, 'markdown');
	});

	it('returns error for missing projectId', async () => {
		const result = await SynapseEmit.post(null, { target: 'claude_code' });

		assert.ok(result.type);
		assert.ok(result.detail.includes('projectId is required'));
	});

	it('returns error for null data', async () => {
		const result = await SynapseEmit.post(null, null);

		assert.ok(result.type);
	});

	it('queries only active entries for the project', async () => {
		let capturedParams;
		mockSynapseSearch.mockImplementation(function*(params) {
			capturedParams = params;
		});

		await SynapseEmit.post(null, { target: 'claude_code', projectId: 'my-project' });

		assert.ok(Array.isArray(capturedParams.conditions));
		const projectCond = capturedParams.conditions.find(c => c.attribute === 'projectId');
		const statusCond = capturedParams.conditions.find(c => c.attribute === 'status');
		assert.ok(projectCond);
		assert.equal(projectCond.value, 'my-project');
		assert.ok(statusCond);
		assert.equal(statusCond.value, 'active');
	});

	it('emits claude_code format as markdown string', async () => {
		mockSynapseSearch.mockImplementation(function*() {
			for (const e of fakeEntries) { yield e; }
		});

		const result = await SynapseEmit.post(null, { target: 'claude_code', projectId: 'my-project' });

		assert.equal(result.target, 'claude_code');
		assert.equal(result.entryCount, 2);
		assert.equal(typeof result.output, 'string');
		assert.ok(result.output.includes('## Intents'));
		assert.ok(result.output.includes('## Constraints'));
	});

	it('emits cursor format as object with .mdc files', async () => {
		mockSynapseSearch.mockImplementation(function*() {
			for (const e of fakeEntries) { yield e; }
		});

		const result = await SynapseEmit.post(null, { target: 'cursor', projectId: 'my-project' });

		assert.equal(result.output.format, 'cursor_rules');
		assert.ok(Array.isArray(result.output.files));
		assert.equal(result.output.files.length, 2);
		assert.ok(result.output.files[0].filename.endsWith('.mdc'));
		assert.ok(result.output.files[0].content.includes('---'));
	});

	it('emits windsurf format as object with .md files', async () => {
		mockSynapseSearch.mockImplementation(function*() {
			for (const e of fakeEntries) { yield e; }
		});

		const result = await SynapseEmit.post(null, { target: 'windsurf', projectId: 'my-project' });

		assert.equal(result.output.format, 'windsurf_rules');
		assert.ok(Array.isArray(result.output.files));
		assert.equal(result.output.files.length, 2);
		assert.ok(result.output.files[0].filename.endsWith('.md'));
	});

	it('pushes single-type filter to search conditions', async () => {
		let capturedParams;
		mockSynapseSearch.mockImplementation(function*(params) {
			capturedParams = params;
			for (const e of fakeEntries.filter(e => e.type === 'intent')) { yield e; }
		});

		const result = await SynapseEmit.post(null, { target: 'claude_code', projectId: 'my-project', types: ['intent'] });

		assert.equal(result.entryCount, 1);
		const typeCondition = capturedParams.conditions.find(c => c.attribute === 'type');
		assert.ok(typeCondition);
		assert.equal(typeCondition.value, 'intent');
	});

	it('post-filters when multiple types provided', async () => {
		mockSynapseSearch.mockImplementation(function*() {
			for (const e of fakeEntries) { yield e; }
		});

		const result = await SynapseEmit.post(null, {
			target: 'claude_code',
			projectId: 'my-project',
			types: ['intent', 'constraint'],
		});

		assert.equal(result.entryCount, 2);
	});

	it('returns entryCount of 0 when no entries exist', async () => {
		mockSynapseSearch.mockImplementation(function*() {});

		const result = await SynapseEmit.post(null, { target: 'claude_code', projectId: 'empty-project' });

		assert.equal(result.entryCount, 0);
		assert.equal(typeof result.output, 'string');
	});
});
