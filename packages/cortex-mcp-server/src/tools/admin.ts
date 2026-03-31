/**
 * Admin tools for tenant management
 *
 * These tools are only available when the MCP server is in multi-tenant mode
 * and the request includes a valid admin token.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { cortexFetch, type ToolContext } from './cortex-fetch.js';

// ── Tenant CRUD ──

export const createTenantSchema = z.object({
	name: z.string().describe('Tenant display name'),
	tier: z.enum(['free', 'team', 'enterprise']).default('free').describe('Rate limit tier'),
	maxMemories: z.number().optional().describe('Override max memories quota'),
	maxSynapseEntries: z.number().optional().describe('Override max synapse entries quota'),
});

export async function handleCreateTenant(
	context: ToolContext,
	input: z.infer<typeof createTenantSchema>,
): Promise<string> {
	const uuid = randomUUID();
	const namespace = `tenant_${uuid.replace(/-/g, '').slice(0, 16)}`;
	const schema = context.cortexSchema || 'data';

	const tenant = {
		id: uuid,
		name: input.name,
		namespace,
		tier: input.tier,
		status: 'active',
		maxMemories: input.maxMemories ?? getDefaultQuota(input.tier).maxMemories,
		maxSynapseEntries: input.maxSynapseEntries ?? getDefaultQuota(input.tier).maxSynapseEntries,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	await cortexFetch(context, `/${schema}/Tenant`, {
		method: 'POST',
		body: JSON.stringify(tenant),
	});

	// Create default security policy
	const policy = {
		tenantId: uuid,
		injectionBlockPolicy: 'sanitize',
		fuzzyDedupPolicy: 'warn',
		maxContentLength: 16384,
		enableModeration: false,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	await cortexFetch(context, `/${schema}/TenantSecurityPolicy`, {
		method: 'POST',
		body: JSON.stringify(policy),
	});

	return JSON.stringify({ tenant, message: 'Tenant created successfully' }, null, 2);
}

export const listTenantsSchema = z.object({
	status: z.enum(['active', 'suspended', 'archived']).optional().describe('Filter by status'),
});

export async function handleListTenants(
	context: ToolContext,
	input: z.infer<typeof listTenantsSchema>,
): Promise<string> {
	const schema = context.cortexSchema || 'data';
	// Use search with optional status filter
	let endpoint = `/${schema}/Tenant`;
	if (input.status) {
		endpoint += `?status=${input.status}`;
	}
	const tenants = await cortexFetch(context, endpoint, { method: 'GET' });
	return JSON.stringify({ count: Array.isArray(tenants) ? tenants.length : 0, tenants }, null, 2);
}

export const getTenantSchema = z.object({
	tenantId: z.string().describe('Tenant ID'),
});

export async function handleGetTenant(
	context: ToolContext,
	input: z.infer<typeof getTenantSchema>,
): Promise<string> {
	const schema = context.cortexSchema || 'data';
	const tenant = await cortexFetch(context, `/${schema}/Tenant/${input.tenantId}`, { method: 'GET' });
	return JSON.stringify(tenant, null, 2);
}

export const updateTenantSchema = z.object({
	tenantId: z.string().describe('Tenant ID'),
	name: z.string().optional().describe('Updated display name'),
	tier: z.enum(['free', 'team', 'enterprise']).optional().describe('Updated tier'),
	status: z.enum(['active', 'suspended', 'archived']).optional().describe('Updated status'),
	maxMemories: z.number().optional().describe('Updated max memories'),
	maxSynapseEntries: z.number().optional().describe('Updated max synapse entries'),
});

export async function handleUpdateTenant(
	context: ToolContext,
	input: z.infer<typeof updateTenantSchema>,
): Promise<string> {
	const schema = context.cortexSchema || 'data';
	const { tenantId, ...updates } = input;

	// Only include fields that were provided
	const filteredUpdates: Record<string, any> = { updatedAt: new Date().toISOString() };
	for (const [key, value] of Object.entries(updates)) {
		if (value !== undefined) { filteredUpdates[key] = value; }
	}

	await cortexFetch(context, `/${schema}/Tenant/${tenantId}`, {
		method: 'PATCH',
		body: JSON.stringify(filteredUpdates),
	});

	return JSON.stringify({ tenantId, updated: Object.keys(filteredUpdates), message: 'Tenant updated' }, null, 2);
}

// ── Token Management ──

export const issueTokenSchema = z.object({
	tenantId: z.string().describe('Tenant ID to issue token for'),
	scopes: z.array(z.string()).optional().describe('Token scopes (default: all)'),
	expiresInHours: z.number().optional().describe('Token lifetime in hours (default: 1)'),
});

export async function handleIssueToken(
	context: ToolContext,
	input: z.infer<typeof issueTokenSchema>,
): Promise<string> {
	const schema = context.cortexSchema || 'data';

	// Fetch tenant to get namespace
	const tenant = await cortexFetch(context, `/${schema}/Tenant/${input.tenantId}`, { method: 'GET' });

	if (!tenant || tenant.status !== 'active') {
		return JSON.stringify({ error: 'Tenant not found or not active' }, null, 2);
	}

	const now = Math.floor(Date.now() / 1000);
	const expiresIn = (input.expiresInHours || 1) * 3600;
	const jti = randomUUID();

	// Build JWT claims
	const claims = {
		sub: tenant.id,
		ns: tenant.namespace,
		aud: 'cortex-mcp',
		iss: 'harper-auth',
		iat: now,
		exp: now + expiresIn,
		jti,
		scopes: input.scopes || ['memory:read', 'memory:write', 'synapse:read', 'synapse:write'],
		tier: tenant.tier,
	};

	// NOTE: In production, this would use the Harper instance's private key.
	// For now, return the claims as a pre-signed payload that the deployment
	// signing service would sign. The actual signing happens at the Harper level.
	return JSON.stringify(
		{
			message: 'Token claims generated. Sign with Harper instance private key to produce JWT.',
			claims,
			jti,
			expiresAt: new Date((now + expiresIn) * 1000).toISOString(),
			note: 'Use POST /admin/sign-token with these claims and the instance private key',
		},
		null,
		2,
	);
}

export const revokeTokenSchema = z.object({
	tenantId: z.string().describe('Tenant ID'),
	tokenJti: z.string().describe('Token JTI (unique ID) to revoke'),
	reason: z.string().optional().describe('Reason for revocation'),
});

export async function handleRevokeToken(
	context: ToolContext,
	input: z.infer<typeof revokeTokenSchema>,
): Promise<string> {
	const schema = context.cortexSchema || 'data';

	const revocation = {
		id: randomUUID(),
		tenantId: input.tenantId,
		tokenJti: input.tokenJti,
		revokedAt: new Date().toISOString(),
		reason: input.reason || 'manual-revocation',
	};

	await cortexFetch(context, `/${schema}/TokenRevocation`, {
		method: 'POST',
		body: JSON.stringify(revocation),
	});

	return JSON.stringify({ revoked: true, ...revocation }, null, 2);
}

// ── Helpers ──

function getDefaultQuota(tier: string): { maxMemories: number; maxSynapseEntries: number } {
	const quotas: Record<string, { maxMemories: number; maxSynapseEntries: number }> = {
		free: { maxMemories: 10_000, maxSynapseEntries: 5_000 },
		team: { maxMemories: 100_000, maxSynapseEntries: 50_000 },
		enterprise: { maxMemories: 1_000_000, maxSynapseEntries: 500_000 },
	};
	return quotas[tier] || quotas.free;
}
