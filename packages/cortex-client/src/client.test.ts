import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './client.js';

describe('HttpClient', () => {
	describe('Authorization headers', () => {
		it('should base64-encode raw credentials for Basic Auth', async () => {
			const client = new HttpClient({
				instanceUrl: 'https://test.harpercloud.com',
				token: 'user:pass',
			});

			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: async () => ({}),
			});
			vi.stubGlobal('fetch', fetchMock);

			await client.post('Memory', 'search', { query: 'test' });

			const headers = fetchMock.mock.calls[0][1].headers;
			const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`;
			expect(headers['Authorization']).toBe(expected);
		});

		it('should pass through pre-formatted Basic header as-is', async () => {
			const preFormatted = `Basic ${Buffer.from('user:pass').toString('base64')}`;
			const client = new HttpClient({
				instanceUrl: 'https://test.harpercloud.com',
				token: preFormatted,
			});

			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: async () => ({}),
			});
			vi.stubGlobal('fetch', fetchMock);

			await client.post('Memory', 'search', { query: 'test' });

			const headers = fetchMock.mock.calls[0][1].headers;
			expect(headers['Authorization']).toBe(preFormatted);
		});

		it('should pass through Bearer token as-is', async () => {
			const client = new HttpClient({
				instanceUrl: 'https://test.harpercloud.com',
				token: 'Bearer eyJhbGciOiJIUzI1NiJ9.test',
			});

			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: async () => ({}),
			});
			vi.stubGlobal('fetch', fetchMock);

			await client.post('Memory', 'search', { query: 'test' });

			const headers = fetchMock.mock.calls[0][1].headers;
			expect(headers['Authorization']).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.test');
		});

		it('should not include Authorization header when no token is set', async () => {
			const client = new HttpClient({
				instanceUrl: 'https://test.harpercloud.com',
			});

			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: async () => ({}),
			});
			vi.stubGlobal('fetch', fetchMock);

			await client.post('Memory', 'search', { query: 'test' });

			const headers = fetchMock.mock.calls[0][1].headers;
			expect(headers['Authorization']).toBeUndefined();
		});
	});

	describe('URL building', () => {
		it('should strip trailing slash from instanceUrl', async () => {
			const client = new HttpClient({
				instanceUrl: 'https://test.harpercloud.com/',
			});

			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: async () => ({}),
			});
			vi.stubGlobal('fetch', fetchMock);

			await client.post('Memory', 'search', { query: 'test' });

			const url = fetchMock.mock.calls[0][0];
			expect(url).toBe('https://test.harpercloud.com/Memory/search');
		});

		it('should include schema when provided', async () => {
			const client = new HttpClient({
				instanceUrl: 'https://test.harpercloud.com',
				schema: 'data',
			});

			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: async () => ({}),
			});
			vi.stubGlobal('fetch', fetchMock);

			await client.post('Memory', 'search', { query: 'test' });

			const url = fetchMock.mock.calls[0][0];
			expect(url).toBe('https://test.harpercloud.com/data/Memory/search');
		});
	});

	describe('error handling', () => {
		it('should throw CortexError on non-ok response', async () => {
			const client = new HttpClient({
				instanceUrl: 'https://test.harpercloud.com',
			});

			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({
					ok: false,
					status: 401,
					headers: new Headers({ 'content-type': 'application/json' }),
					json: async () => ({ error: 'Unauthorized' }),
				}),
			);

			await expect(client.post('Memory', 'search', { query: 'test' }))
				.rejects.toThrow('Unauthorized');
		});
	});
});
