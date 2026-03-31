/**
 * Core HTTP client for Cortex.
 */

import { CortexError } from './types.js';

export interface ClientConfig {
	instanceUrl: string;
	token?: string;
	schema?: string;
}

/** Low-level HTTP client. Use CortexClient instead. */
export class HttpClient {
	private instanceUrl: string;
	private token?: string;
	private schema: string;

	constructor(config: ClientConfig) {
		this.instanceUrl = config.instanceUrl.replace(/\/$/, ''); // strip trailing slash
		this.token = config.token;
		this.schema = config.schema ?? '';
	}

	/** Build a full URL: {instanceUrl}/{schema?}/{table}/{endpoint?} */
	private buildUrl(table: string, endpoint?: string): string {
		const parts = [this.instanceUrl];
		if (this.schema) {
			parts.push(this.schema);
		}
		parts.push(table);
		if (endpoint) {
			parts.push(endpoint);
		}
		return parts.join('/');
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this.token) {
			// Support pre-formatted headers ("Basic xxx", "Bearer xxx") or raw credentials
			if (this.token.startsWith('Basic ') || this.token.startsWith('Bearer ')) {
				headers['Authorization'] = this.token;
			} else {
				// Base64-encode raw credentials for Basic Auth (e.g. "user:pass")
				headers['Authorization'] = `Basic ${Buffer.from(this.token).toString('base64')}`;
			}
		}
		return headers;
	}

	/**
	 * Make a POST request.
	 */
	async post<T = any>(table: string, endpoint: string | undefined, body: any): Promise<T> {
		const url = this.buildUrl(table, endpoint);
		const response = await fetch(url, {
			method: 'POST',
			headers: this.buildHeaders(),
			body: JSON.stringify(body),
		});

		return this.handleResponse<T>(response);
	}

	/**
	 * Make a GET request.
	 */
	async get<T = any>(table: string, id: string): Promise<T> {
		const url = `${this.buildUrl(table)}/${id}`;
		const response = await fetch(url, {
			method: 'GET',
			headers: this.buildHeaders(),
		});

		return this.handleResponse<T>(response);
	}

	/** Make a PUT request. */
	async put<T = any>(table: string, id: string, body: any): Promise<T> {
		const url = `${this.buildUrl(table)}/${id}`;
		const response = await fetch(url, {
			method: 'PUT',
			headers: this.buildHeaders(),
			body: JSON.stringify(body),
		});

		return this.handleResponse<T>(response);
	}

	/**
	 * Make a DELETE request.
	 */
	async delete<T = any>(table: string, id: string): Promise<T> {
		const url = `${this.buildUrl(table)}/${id}`;
		const response = await fetch(url, {
			method: 'DELETE',
			headers: this.buildHeaders(),
		});

		return this.handleResponse<T>(response);
	}

	private async handleResponse<T>(response: Response): Promise<T> {
		const contentType = response.headers.get('content-type');
		const isJson = contentType?.includes('application/json');
		const data = isJson ? await response.json() : await response.text();

		if (!response.ok) {
			let message = `HTTP ${response.status}`;
			if (isJson && typeof data === 'object' && data !== null) {
				const errData = data as Record<string, any>;
				message = errData.error || errData.message || message;
			} else if (typeof data === 'string') {
				message = data || message;
			}

			if (response.status === 404) {
				if (message.includes('VectorSearch')) {
					message =
						'VectorSearch endpoint not available — ensure your Cortex instance has the VectorSearch resource deployed.';
				} else {
					message =
						`Endpoint not found (404): ${message}. Ensure the Cortex instance has all required resources deployed.`;
				}
			}

			throw new CortexError(message, response.status, data);
		}

		return data as T;
	}
}
