/**
 * Multi-tenant authentication for cortex-mcp-server
 *
 * Supports two modes:
 * - Single-tenant: Bearer token pass-through (existing behavior)
 * - Multi-tenant: JWT validation with JWKS, namespace binding, revocation
 */

import { createPublicKey, createVerify } from 'node:crypto';
import type { AuthContext, JWTClaims, ServerConfig, TenantContext } from './types.js';

// JWKS cache
let jwksCache: { keys: any[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL = 3600_000; // 1 hour

// Revocation list cache
let revocationCache: { tokens: Set<string>; fetchedAt: number } = {
	tokens: new Set(),
	fetchedAt: 0,
};
const REVOCATION_CACHE_TTL = 60_000; // 60 seconds

/**
 * Extract Bearer token from Authorization header
 */
export function extractToken(authHeader?: string): string | undefined {
	if (!authHeader) { return undefined; }
	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	return match ? match[1] : undefined;
}

/**
 * Build an Authorization header value from a raw token.
 * If already prefixed with "Basic " or "Bearer ", pass through as-is.
 * Otherwise treat as user:password credentials and Base64-encode for HTTP Basic Auth.
 */
export function formatAuthHeader(token: string): string {
	if (token.startsWith('Basic ') || token.startsWith('Bearer ')) {
		return token;
	}
	return `Basic ${Buffer.from(token).toString('base64')}`;
}

/**
 * Single-tenant auth (backward compatible)
 */
export function validateAuth(token?: string): AuthContext {
	if (!token) { return { isValid: false }; }
	if (typeof token !== 'string' || token.trim().length === 0) { return { isValid: false }; }
	const parts = token.split(':');
	const userId = parts.length > 1 ? parts[0] : undefined;
	return { token, userId, isValid: true };
}

/**
 * Decode JWT without verification (to read header for kid)
 */
function decodeJWT(token: string): { header: any; payload: any; signature: string } {
	const parts = token.split('.');
	if (parts.length !== 3) { throw new Error('Invalid JWT format'); }

	const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
	const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

	return { header, payload, signature: parts[2] };
}

/**
 * Fetch JWKS from Harper instance (with caching)
 */
async function fetchJWKS(jwksUrl: string): Promise<any[]> {
	const now = Date.now();
	if (jwksCache && (now - jwksCache.fetchedAt) < JWKS_CACHE_TTL) {
		return jwksCache.keys;
	}

	const response = await fetch(jwksUrl);
	if (!response.ok) {
		throw new Error(`Failed to fetch JWKS from ${jwksUrl}: ${response.status}`);
	}

	const data = await response.json() as { keys: any[] };
	jwksCache = { keys: data.keys, fetchedAt: now };
	return data.keys;
}

/**
 * Verify JWT signature using RS256
 */
function verifyRS256(token: string, publicKeyJwk: any): boolean {
	const [headerB64, payloadB64, signatureB64] = token.split('.');
	const signedData = `${headerB64}.${payloadB64}`;
	const signature = Buffer.from(signatureB64, 'base64url');

	const publicKey = createPublicKey({ key: publicKeyJwk, format: 'jwk' });
	const verifier = createVerify('RSA-SHA256');
	verifier.update(signedData);

	return verifier.verify(publicKey, signature);
}

/**
 * Check if a token has been revoked
 */
async function checkRevocation(jti: string | undefined, config: ServerConfig): Promise<boolean> {
	if (!jti) { return false; }

	const now = Date.now();
	if ((now - revocationCache.fetchedAt) > REVOCATION_CACHE_TTL) {
		// Refresh revocation list from Cortex
		try {
			const schema = config.cortexSchema || 'data';
			const response = await fetch(
				new URL(`/${schema}/TokenRevocation`, config.cortexUrl).toString(),
				{
					headers: {
						'Content-Type': 'application/json',
						...(config.cortexToken ? { 'Authorization': `Bearer ${config.cortexToken}` } : {}),
					},
				},
			);
			if (response.ok) {
				const revocations = await response.json() as any[];
				revocationCache = {
					tokens: new Set(revocations.map((r: any) => r.tokenJti)),
					fetchedAt: now,
				};
			}
		} catch {
			// On failure, keep stale cache (fail-open for availability, fail-closed would reject all)
			// In production, you might want fail-closed behavior
		}
	}

	return revocationCache.tokens.has(jti);
}

/**
 * Multi-tenant JWT validation
 * Returns TenantContext on success, throws on failure
 */
export async function validateJWT(token: string, config: ServerConfig): Promise<TenantContext> {
	if (!config.jwksUrl) {
		throw new Error('JWKS URL not configured for multi-tenant mode');
	}

	// 1. Decode token
	const { header, payload } = decodeJWT(token);

	// 2. Validate algorithm
	if (header.alg !== 'RS256') {
		throw new Error(`Unsupported algorithm: ${header.alg}`);
	}

	// 3. Fetch JWKS and find matching key
	const keys = await fetchJWKS(config.jwksUrl);
	const key = header.kid
		? keys.find(k => k.kid === header.kid)
		: keys[0]; // Fall back to first key if no kid

	if (!key) {
		throw new Error('No matching signing key found');
	}

	// 4. Verify signature
	if (!verifyRS256(token, key)) {
		throw new Error('Invalid token signature');
	}

	// 5. Validate claims
	const now = Math.floor(Date.now() / 1000);

	if (payload.exp && payload.exp < now) {
		throw new Error('Token expired');
	}

	if (payload.aud !== 'cortex-mcp') {
		throw new Error(`Invalid audience: ${payload.aud}`);
	}

	if (!payload.sub || !payload.ns) {
		throw new Error('Missing required claims (sub, ns)');
	}

	// 6. Check revocation
	const isRevoked = await checkRevocation(payload.jti, config);
	if (isRevoked) {
		throw new Error('Token has been revoked');
	}

	// 7. Return tenant context
	return {
		tenantId: payload.sub,
		namespace: payload.ns,
		scopes: payload.scopes || [],
		token,
		tier: payload.tier,
	};
}

/**
 * Scope requirements per MCP tool
 */
const SCOPE_REQUIREMENTS: Record<string, string[]> = {
	memory_search: ['memory:read'],
	memory_store: ['memory:write'],
	memory_recall: ['memory:read'],
	memory_forget: ['memory:write'],
	memory_count: ['memory:read'],
	synapse_search: ['synapse:read'],
	synapse_ingest: ['synapse:write'],
};

/**
 * Validate that the tenant has the required scope for a tool
 */
export function validateScope(toolName: string, scopes: string[]): boolean {
	const required = SCOPE_REQUIREMENTS[toolName];
	if (!required) { return true; // Unknown tool, allow (fail-open)
	 }
	return required.every(scope => scopes.includes(scope));
}

/**
 * Clear caches (for testing)
 */
export function clearAuthCaches(): void {
	jwksCache = null;
	revocationCache = { tokens: new Set(), fetchedAt: 0 };
}
