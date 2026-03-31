/**
 * Shared HTTP helper for Cortex API calls.
 */

import { formatAuthHeader } from '../auth.js';

export interface ToolContext {
	cortexUrl: string;
	cortexToken?: string;
	cortexSchema?: string;
	userId?: string;
}

export async function cortexFetch(
	context: ToolContext,
	endpoint: string,
	options: RequestInit = {},
): Promise<any> {
	const url = new URL(endpoint, context.cortexUrl);
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(options.headers as Record<string, string>),
	};

	if (context.cortexToken) {
		headers['Authorization'] = formatAuthHeader(context.cortexToken);
	}

	const response = await fetch(url.toString(), {
		...options,
		headers,
	});

	if (!response.ok) {
		const error = await response.text().catch(() => 'Unknown error');
		throw new Error(
			`Cortex API error (${response.status}): ${error}`,
		);
	}

	return response.json();
}
