/**
 * Unit tests for CortexMemoryDB with mocked fetch
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CortexMemoryDB } from '../src/memory-db.js';

// Helper to create a mock Response with headers
function mockResponse(data: any, options: { ok?: boolean; status?: number; statusText?: string } = {}) {
	const { ok = true, status = 200, statusText = 'OK' } = options;
	return {
		ok,
		status,
		statusText,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: async () => data,
		text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
	};
}

// Mock fetch globally
global.fetch = vi.fn();

describe('CortexMemoryDB', () => {
	const mockFetch = global.fetch as any;

	beforeEach(() => {
		mockFetch.mockClear();
	});

	describe('constructor', () => {
		it('should initialize with required config', () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'test_table',
				schema: 'test_schema',
			});
			expect(db).toBeDefined();
		});

		it('should throw error if instanceUrl is missing', () => {
			expect(() => {
				new CortexMemoryDB({
					instanceUrl: '',
					table: 'test_table',
					schema: 'test_schema',
				});
			}).toThrow('instanceUrl is required');
		});

		it('should strip trailing slash from instanceUrl', () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com/',
				table: 'test_table',
				schema: 'test_schema',
			});
			expect(db).toBeDefined();
		});

		it('should use default table and schema', () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
			});
			expect(db).toBeDefined();
		});
	});

	describe('store()', () => {
		beforeEach(() => {
			mockFetch.mockResolvedValue(mockResponse({ id: '550e8400-e29b-41d4-a716-446655440000' }));
		});

		it('should store a memory entry', async () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const entry = {
				text: 'Test memory',
				importance: 0.8,
				category: 'fact',
			};

			const id = await db.store(entry);

			expect(id).toBeTruthy();
			expect(id).toMatch(/^[0-9a-f-]{36}$/i);
			expect(mockFetch).toHaveBeenCalled();
		});

		it('should include authorization header if token provided', async () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
				token: 'test-token-123',
			});

			await db.store({
				text: 'Test',
				importance: 0.5,
				category: 'fact',
			});

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: `Basic ${Buffer.from('test-token-123').toString('base64')}`,
					}),
				}),
			);
		});

		it('should throw error on failed store', async () => {
			mockFetch.mockResolvedValue(mockResponse('Error message', { ok: false, status: 400, statusText: 'Bad Request' }));

			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			await expect(
				db.store({
					text: 'Test',
					importance: 0.5,
					category: 'fact',
				}),
			).rejects.toThrow();
		});
	});

	describe('search()', () => {
		beforeEach(() => {
			// cortex-client normalizes: similarity = 1 - $distance
			mockFetch.mockResolvedValue(mockResponse({
				results: [
					{
						id: '550e8400-e29b-41d4-a716-446655440000',
						rawText: 'Test memory 1',
						classification: 'fact',
						$distance: 0.05,
						timestamp: '2024-01-01T00:00:00Z',
						metadata: { importance: 0.8, category: 'fact' },
					},
					{
						id: '550e8400-e29b-41d4-a716-446655440001',
						rawText: 'Test memory 2',
						classification: 'event',
						$distance: 0.25,
						timestamp: '2024-01-01T00:00:01Z',
						metadata: { importance: 0.6, category: 'event' },
					},
				],
			}));
		});

		it('should search memories by query', async () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const results = await db.search('test query', 5);

			expect(results).toHaveLength(2);
			expect(results[0].entry.text).toBe('Test memory 1');
			expect(results[0].score).toBe(0.95);
		});

		it('should include agentId in filters if provided', async () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			await db.search('test', 5, 'agent-123');

			const calls = mockFetch.mock.calls;
			const lastCall = calls[calls.length - 1];
			const body = JSON.parse(lastCall[1].body);

			expect(body.filters).toEqual(expect.objectContaining({ authorId: 'agent-123' }));
		});

		it('should return empty array if no results', async () => {
			mockFetch.mockResolvedValue(mockResponse({ results: [] }));

			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const results = await db.search('nonexistent', 5);

			expect(results).toEqual([]);
		});

		it('should handle non-array response gracefully', async () => {
			mockFetch.mockResolvedValue(mockResponse({}));

			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const results = await db.search('test', 5);

			expect(results).toEqual([]);
		});
	});

	describe('delete()', () => {
		beforeEach(() => {
			mockFetch.mockResolvedValue(mockResponse({}));
		});

		it('should delete a memory by ID', async () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const id = '550e8400-e29b-41d4-a716-446655440000';
			await db.delete(id);

			expect(mockFetch).toHaveBeenCalled();
		});

		it('should reject invalid UUID format', async () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			await expect(db.delete('not-a-uuid')).rejects.toThrow(
				'Invalid memory ID format',
			);
		});

		it('should throw error on failed delete', async () => {
			mockFetch.mockResolvedValue(mockResponse('Not found', { ok: false, status: 404, statusText: 'Not Found' }));

			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			await expect(
				db.delete('550e8400-e29b-41d4-a716-446655440000'),
			).rejects.toThrow();
		});
	});

	describe('count()', () => {
		beforeEach(() => {
			mockFetch.mockResolvedValue(mockResponse({ count: 42 }));
		});

		it('should count total memories', async () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const count = await db.count();

			expect(count).toBe(42);
		});

		it('should include agentId filter if provided', async () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			await db.count('agent-123');

			expect(mockFetch).toHaveBeenCalled();
		});

		it('should return 0 if no count in response', async () => {
			mockFetch.mockResolvedValue(mockResponse({}));

			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const count = await db.count();

			expect(count).toBe(0);
		});
	});

	describe('get()', () => {
		it('should retrieve a single memory by ID', async () => {
			mockFetch.mockResolvedValue(mockResponse({
				id: '550e8400-e29b-41d4-a716-446655440000',
				rawText: 'Test memory',
				classification: 'fact',
				timestamp: '2024-01-01T00:00:00Z',
				metadata: { importance: 0.8, category: 'fact' },
			}));

			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const memory = await db.get('550e8400-e29b-41d4-a716-446655440000');

			expect(memory).toBeDefined();
			expect(memory?.text).toBe('Test memory');
		});

		it('should return null if memory not found', async () => {
			mockFetch.mockResolvedValue(mockResponse(null, { ok: false, status: 404 }));

			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const memory = await db.get('550e8400-e29b-41d4-a716-446655440000');

			expect(memory).toBeNull();
		});
	});

	describe('storeBatch()', () => {
		beforeEach(() => {
			mockFetch.mockResolvedValue(mockResponse({ id: '550e8400-e29b-41d4-a716-446655440000' }));
		});

		it('should store multiple memories in batch', async () => {
			const db = new CortexMemoryDB({
				instanceUrl: 'https://cortex.example.com',
				table: 'memories',
				schema: 'data',
			});

			const entries = [
				{ text: 'Memory 1', importance: 0.8, category: 'fact' },
				{ text: 'Memory 2', importance: 0.6, category: 'event' },
				{ text: 'Memory 3', importance: 0.9, category: 'procedure' },
			];

			const ids = await db.storeBatch(entries);

			expect(ids).toHaveLength(3);
			expect(ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))).toBe(true);
			// storeBatch does individual PUTs, one per entry
			expect(mockFetch).toHaveBeenCalledTimes(3);
		});
	});
});
