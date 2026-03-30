import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCountCache, COUNT_TTL_MS, getCachedCount, getCacheEntry, invalidateCountCache } from '../quota.js';
import { getQuotaLimits } from '../rate-limiter.js';

// ---------------------------------------------------------------------------
// Quota tier config
// ---------------------------------------------------------------------------

describe('getQuotaLimits', () => {
	it('returns free tier limits', () => {
		const limits = getQuotaLimits('free');
		expect(limits.maxMemories).toBe(10_000);
		expect(limits.maxSynapseEntries).toBe(5_000);
	});

	it('returns team tier limits', () => {
		const limits = getQuotaLimits('team');
		expect(limits.maxMemories).toBe(100_000);
		expect(limits.maxSynapseEntries).toBe(50_000);
	});

	it('returns enterprise tier limits', () => {
		const limits = getQuotaLimits('enterprise');
		expect(limits.maxMemories).toBe(1_000_000);
		expect(limits.maxSynapseEntries).toBe(500_000);
	});

	it('defaults to free tier for unknown tier', () => {
		const limits = getQuotaLimits('unknown');
		expect(limits.maxMemories).toBe(10_000);
	});

	it('defaults to free tier when tier is undefined', () => {
		const limits = getQuotaLimits(undefined);
		expect(limits.maxMemories).toBe(10_000);
	});
});

// ---------------------------------------------------------------------------
// Count cache
// ---------------------------------------------------------------------------

describe('getCachedCount', () => {
	const CORTEX_URL = 'https://test.cortex.example.com';
	const TOKEN = 'Basic dXNlcjpwYXNz';
	const NS = 'test-agent-ns';

	beforeEach(() => {
		clearCountCache();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('fetches count from Cortex and caches it', async () => {
		global.fetch = vi.fn().mockResolvedValueOnce({
			json: async () => ({ count: 42 }),
		} as any);

		const count = await getCachedCount(CORTEX_URL, TOKEN, NS);
		expect(count).toBe(42);
		expect(fetch).toHaveBeenCalledOnce();
		expect((fetch as any).mock.calls[0][0]).toBe(`${CORTEX_URL}/MemoryCount`);
	});

	it('returns cached value within TTL without refetching', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			json: async () => ({ count: 7 }),
		} as any);

		await getCachedCount(CORTEX_URL, TOKEN, NS);
		await getCachedCount(CORTEX_URL, TOKEN, NS);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('refetches after TTL expires', async () => {
		global.fetch = vi.fn()
			.mockResolvedValueOnce({ json: async () => ({ count: 5 }) } as any)
			.mockResolvedValueOnce({ json: async () => ({ count: 6 }) } as any);

		await getCachedCount(CORTEX_URL, TOKEN, NS);
		vi.advanceTimersByTime(COUNT_TTL_MS + 1);
		const second = await getCachedCount(CORTEX_URL, TOKEN, NS);
		expect(second).toBe(6);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('sends agentId filter in request body', async () => {
		global.fetch = vi.fn().mockResolvedValueOnce({
			json: async () => ({ count: 0 }),
		} as any);

		await getCachedCount(CORTEX_URL, TOKEN, 'my-agent');
		const body = JSON.parse((fetch as any).mock.calls[0][1].body);
		expect(body.filters.agentId).toBe('my-agent');
	});

	it('formats Basic auth token correctly (base64-encoded)', async () => {
		global.fetch = vi.fn().mockResolvedValueOnce({
			json: async () => ({ count: 0 }),
		} as any);

		await getCachedCount(CORTEX_URL, 'rawtoken', NS);
		const headers = (fetch as any).mock.calls[0][1].headers;
		expect(headers['Authorization']).toBe(`Basic ${Buffer.from('rawtoken').toString('base64')}`);
	});
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe('invalidateCountCache', () => {
	beforeEach(() => clearCountCache());

	it('removes cached entry so next call refetches', async () => {
		global.fetch = vi.fn()
			.mockResolvedValueOnce({ json: async () => ({ count: 100 }) } as any)
			.mockResolvedValueOnce({ json: async () => ({ count: 101 }) } as any);

		vi.useFakeTimers();
		const NS = 'inv-test';

		await getCachedCount('https://c.example.com', undefined, NS);
		expect(getCacheEntry(NS)?.count).toBe(100);

		invalidateCountCache(NS);
		expect(getCacheEntry(NS)).toBeUndefined();

		const refreshed = await getCachedCount('https://c.example.com', undefined, NS);
		expect(refreshed).toBe(101);
		expect(fetch).toHaveBeenCalledTimes(2);

		vi.useRealTimers();
		vi.restoreAllMocks();
	});
});
