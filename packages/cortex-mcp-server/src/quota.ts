/**
 * Storage quota helpers for cortex-mcp-server
 *
 * Provides a short-lived in-memory cache of per-namespace memory counts
 * to avoid a Cortex round-trip on every memory_store call.
 *
 * Cache entries expire after COUNT_TTL_MS and are invalidated immediately
 * after any successful write or delete so counts stay accurate.
 */

import { formatAuthHeader } from './auth.js';

export const COUNT_TTL_MS = 60_000;

export interface CountCacheEntry {
	count: number;
	expiresAt: number;
}

const countCache = new Map<string, CountCacheEntry>();

/**
 * Get the current memory count for a namespace, using the cache when fresh.
 */
export async function getCachedCount(
	cortexUrl: string,
	cortexToken: string | undefined,
	namespace: string,
): Promise<number> {
	const cached = countCache.get(namespace);
	if (cached && cached.expiresAt > Date.now()) { return cached.count; }

	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (cortexToken) {
		headers['Authorization'] = formatAuthHeader(cortexToken);
	}

	const res = await fetch(`${cortexUrl}/MemoryCount`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ filters: { agentId: namespace } }),
	});
	const data = (await res.json()) as any;
	const count: number = data?.count ?? 0;
	countCache.set(namespace, { count, expiresAt: Date.now() + COUNT_TTL_MS });
	return count;
}

/**
 * Remove the cached count for a namespace (call after any write or delete).
 */
export function invalidateCountCache(namespace: string): void {
	countCache.delete(namespace);
}

/**
 * Peek at a cache entry without triggering a fetch (used in tests).
 */
export function getCacheEntry(namespace: string): CountCacheEntry | undefined {
	return countCache.get(namespace);
}

/**
 * Clear the entire cache (used in tests).
 */
export function clearCountCache(): void {
	countCache.clear();
}
