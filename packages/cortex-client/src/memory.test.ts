import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './client.js';
import { Memory } from './memory.js';

describe('Memory', () => {
	let memory: Memory;
	let httpClient: HttpClient;

	beforeEach(() => {
		httpClient = new HttpClient({
			instanceUrl: 'https://test.harpercloud.com',
			token: 'test-token',
			schema: 'data',
		});
		memory = new Memory(httpClient);
	});

	describe('search', () => {
		it('should perform a semantic search', async () => {
			const mockResponse = {
				results: [
					{
						id: 'mem-1',
						rawText: 'We use Redis for caching',
						source: 'slack',
						classification: 'decision',
						$distance: 0.1,
					},
				],
				count: 1,
			};

			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: async () => mockResponse,
				}),
			);

			const result = await memory.search('caching', { limit: 5 });

			expect(result.count).toBe(1);
			expect(result.results).toHaveLength(1);
			expect(result.results[0].id).toBe('mem-1');
			expect(result.results[0].similarity).toBeCloseTo(0.9); // 1 - 0.1
		});

		it('should include filters in search request', async () => {
			const mockResponse = { results: [], count: 0 };
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: async () => mockResponse,
			});
			vi.stubGlobal('fetch', fetchMock);

			await memory.search('test query', {
				limit: 10,
				filters: { source: 'slack', classification: 'decision' },
			});

			expect(fetchMock).toHaveBeenCalled();
			const call = fetchMock.mock.calls[0];
			const body = JSON.parse(call[1].body);
			expect(body.query).toBe('test query');
			expect(body.filters.source).toBe('slack');
		});
	});

	describe('store', () => {
		it('should store a memory record', async () => {
			const mockResponse = {
				id: 'mem-123',
				rawText: 'We chose Redis',
				source: 'slack',
			};

			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: async () => mockResponse,
				}),
			);

			const result = await memory.store({
				text: 'We chose Redis',
				source: 'slack',
			});

			expect(result.id).toBe('mem-123');
			expect(result.rawText).toBe('We chose Redis');
		});
	});

	describe('get', () => {
		it('should retrieve a memory by ID', async () => {
			const mockResponse = {
				id: 'mem-123',
				rawText: 'We chose Redis',
				source: 'slack',
			};

			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: async () => mockResponse,
				}),
			);

			const result = await memory.get('mem-123');

			expect(result.id).toBe('mem-123');
			expect(result.rawText).toBe('We chose Redis');
		});
	});

	describe('delete', () => {
		it('should delete a memory by ID', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: async () => ({ success: true }),
				}),
			);

			const result = await memory.delete('mem-123');

			expect(result.success).toBe(true);
		});
	});

	describe('count', () => {
		it('should return memory count', async () => {
			const mockResponse = { count: 42 };

			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: async () => mockResponse,
				}),
			);

			const result = await memory.count({ filters: { source: 'slack' } });

			expect(result.count).toBe(42);
		});
	});

	describe('vectorSearch', () => {
		it('should search by raw vector', async () => {
			const mockResponse = {
				results: [
					{
						id: 'mem-1',
						rawText: 'Similar content',
						$distance: 0.05,
					},
				],
				count: 1,
			};

			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: async () => mockResponse,
				}),
			);

			const vector = [0.1, 0.2, 0.3];
			const result = await memory.vectorSearch(vector, { limit: 5 });

			expect(result.results).toHaveLength(1);
			expect(result.results[0].similarity).toBeCloseTo(0.95);
		});
	});

	describe('bulkStore', () => {
		it('should upsert multiple records', async () => {
			const mockResponse = {
				upserted: 2,
				failed: 0,
			};

			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: true,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: async () => mockResponse,
				}),
			);

			const result = await memory.bulkStore([
				{ rawText: 'Record 1', source: 'slack' },
				{ rawText: 'Record 2', source: 'slack' },
			]);

			expect(result.upserted).toBe(2);
			expect(result.failed).toBe(0);
		});
	});
});
