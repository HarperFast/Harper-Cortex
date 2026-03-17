import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

class MockMemory {
	static put = mock.fn();
	static search = mock.fn(function*() {});
	static get = mock.fn();
}

const mockSynapseSearch = mock.fn(function*() {});

class MockSynapseEntry {
	static put = mock.fn();
	static search = mockSynapseSearch;
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

mock.module('@xenova/transformers', {
	namedExports: {
		pipeline: mock.fn(async () => async () => ({ data: new Float32Array(384).fill(0.1) })),
	},
});

process.env.ANTHROPIC_API_KEY = 'test-key';

const { SynapseEmit } = await import('../resources.js');

const fakeEntries = [
	{ id: 'abc12345', type: 'intent', content: 'Use Harper for storage.', summary: 'Harper for storage', metadata: {} },
	{ id: 'def67890', type: 'constraint', content: 'Never use ORMs.', summary: 'No ORMs', metadata: {} },
];

describe('SynapseEmit', () => {
	beforeEach(() => {
		mockSynapseSearch.mock.resetCalls();
	});

	it('returns error for missing target', async () => {
		const emit = new SynapseEmit();
		const result = await emit.post({ projectId: 'proj-1' });

		assert.ok(result.error);
		assert.ok(result.error.includes('target must be one of'));
	});

	it('returns error for invalid target', async () => {
		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'vscode', projectId: 'proj-1' });

		assert.ok(result.error);
	});

	it('rejects slack as an emit target', async () => {
		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'slack', projectId: 'proj-1' });

		assert.ok(result.error);
		assert.ok(result.error.includes('target must be one of'));
	});

	it('accepts markdown as an emit target', async () => {
		mockSynapseSearch.mock.mockImplementation(function*() {});

		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'markdown', projectId: 'proj-1' });

		assert.ok(!result.error);
		assert.equal(result.target, 'markdown');
	});

	it('returns error for missing projectId', async () => {
		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'claude_code' });

		assert.ok(result.error);
		assert.ok(result.error.includes('projectId is required'));
	});

	it('returns error for null data', async () => {
		const emit = new SynapseEmit();
		const result = await emit.post(null);

		assert.ok(result.error);
	});

	it('queries only active entries for the project', async () => {
		let capturedParams;
		mockSynapseSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
		});

		const emit = new SynapseEmit();
		await emit.post({ target: 'claude_code', projectId: 'my-project' });

		assert.ok(Array.isArray(capturedParams.conditions));
		const projectCond = capturedParams.conditions.find(c => c.attribute === 'projectId');
		const statusCond = capturedParams.conditions.find(c => c.attribute === 'status');
		assert.ok(projectCond);
		assert.equal(projectCond.value, 'my-project');
		assert.ok(statusCond);
		assert.equal(statusCond.value, 'active');
	});

	it('emits claude_code format as markdown string', async () => {
		mockSynapseSearch.mock.mockImplementation(function*() {
			for (const e of fakeEntries) { yield e; }
		});

		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'claude_code', projectId: 'my-project' });

		assert.equal(result.target, 'claude_code');
		assert.equal(result.entryCount, 2);
		assert.equal(typeof result.output, 'string');
		assert.ok(result.output.includes('## Intents'));
		assert.ok(result.output.includes('## Constraints'));
	});

	it('emits cursor format as object with .mdc files', async () => {
		mockSynapseSearch.mock.mockImplementation(function*() {
			for (const e of fakeEntries) { yield e; }
		});

		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'cursor', projectId: 'my-project' });

		assert.equal(result.output.format, 'cursor_rules');
		assert.ok(Array.isArray(result.output.files));
		assert.equal(result.output.files.length, 2);
		assert.ok(result.output.files[0].filename.endsWith('.mdc'));
		assert.ok(result.output.files[0].content.includes('---'));
	});

	it('emits windsurf format as object with .md files', async () => {
		mockSynapseSearch.mock.mockImplementation(function*() {
			for (const e of fakeEntries) { yield e; }
		});

		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'windsurf', projectId: 'my-project' });

		assert.equal(result.output.format, 'windsurf_rules');
		assert.ok(Array.isArray(result.output.files));
		assert.equal(result.output.files.length, 2);
		assert.ok(result.output.files[0].filename.endsWith('.md'));
	});

	it('pushes single-type filter to search conditions', async () => {
		let capturedParams;
		mockSynapseSearch.mock.mockImplementation(function*(params) {
			capturedParams = params;
			for (const e of fakeEntries.filter(e => e.type === 'intent')) { yield e; }
		});

		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'claude_code', projectId: 'my-project', types: ['intent'] });

		assert.equal(result.entryCount, 1);
		const typeCondition = capturedParams.conditions.find(c => c.attribute === 'type');
		assert.ok(typeCondition);
		assert.equal(typeCondition.value, 'intent');
	});

	it('post-filters when multiple types provided', async () => {
		mockSynapseSearch.mock.mockImplementation(function*() {
			for (const e of fakeEntries) { yield e; }
		});

		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'claude_code', projectId: 'my-project', types: ['intent', 'constraint'] });

		assert.equal(result.entryCount, 2);
	});

	it('returns entryCount of 0 when no entries exist', async () => {
		mockSynapseSearch.mock.mockImplementation(function*() {});

		const emit = new SynapseEmit();
		const result = await emit.post({ target: 'claude_code', projectId: 'empty-project' });

		assert.equal(result.entryCount, 0);
		assert.equal(typeof result.output, 'string');
	});
});
