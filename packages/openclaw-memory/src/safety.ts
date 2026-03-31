/**
 * Safety utilities: injection detection, content filtering, deduplication
 */

import type { InjectionDetectionResult } from './types.js';

/**
 * Detects common injection patterns in memory content.
 * Prevents prompt injection, SQL injection-like attacks, and other malicious content.
 */
export function detectInjection(text: string): InjectionDetectionResult {
	const patterns: string[] = [];
	let cleaned = text;

	// List of injection patterns to detect
	const injectionPatterns = [
		// Prompt injection markers
		{
			pattern: /\{system.*?\}/gi,
			description: '{system...} markers',
		},
		{
			pattern: /ignore.*?previous.*?instructions/gi,
			description: 'Ignore instructions',
		},
		{
			pattern: /forget.*?(?:all|previous|prior)/gi,
			description: 'Forget instructions',
		},
		{
			pattern: /as an? ai/gi,
			description: 'AI role claim',
		},
		{
			pattern: /user jailbreak/gi,
			description: 'Jailbreak attempt',
		},
		// SQL-like injection (though we're not using SQL)
		{
			pattern: /['"];?.*?(?:drop|delete|insert|update|union|select)/gi,
			description: 'SQL-like injection',
		},
		// Suspicious script markers
		{
			pattern: /<script[^>]*>.*?<\/script>/gi,
			description: 'Script tags',
		},
		{
			pattern: /javascript:/gi,
			description: 'JavaScript protocol',
		},
	];

	// Check for each pattern
	for (const { pattern, description } of injectionPatterns) {
		if (pattern.test(text)) {
			patterns.push(description);
			// Remove the matching content
			cleaned = cleaned.replace(pattern, '');
		}
	}

	return {
		detected: patterns.length > 0,
		patterns,
		cleaned: cleaned.trim(),
	};
}

/**
 * Filter content for safety and quality.
 * Removes or normalizes problematic characters and content.
 */
export function filterContent(text: string): string {
	// Remove null bytes
	let filtered = text.replace(/\0/g, '');

	// Remove excessive whitespace
	filtered = filtered.replace(/\s+/g, ' ').trim();

	// Remove control characters except newlines and tabs
	filtered = filtered.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

	// Normalize Unicode (NFKC normalization)
	filtered = filtered.normalize('NFKC');

	// Truncate if too long (16KB soft limit)
	if (filtered.length > 16000) {
		filtered = filtered.substring(0, 16000).trim();
	}

	return filtered;
}

/**
 * Sanitize memory text for storage.
 * Combines injection detection and content filtering.
 */
export function sanitizeMemory(text: string): {
	sanitized: string;
	injectionDetected: boolean;
	warnings: string[];
} {
	const warnings: string[] = [];

	// Run injection detection
	const injection = detectInjection(text);
	if (injection.detected) {
		warnings.push(
			`Injection detected and removed: ${injection.patterns.join(', ')}`,
		);
	}

	// Run content filtering
	const filtered = filterContent(injection.cleaned);

	// Validate output
	if (filtered.length === 0) {
		warnings.push('Memory content was empty or entirely filtered');
	}

	if (filtered.length < 10) {
		warnings.push('Memory content is very short (< 10 chars)');
	}

	return {
		sanitized: filtered,
		injectionDetected: injection.detected,
		warnings,
	};
}

/** Calculate similarity between two texts (0-1 score). */
export function calculateSimilarity(text1: string, text2: string): number {
	// Normalize and lowercase
	const normalized1 = text1.toLowerCase().trim();
	const normalized2 = text2.toLowerCase().trim();

	// Exact match
	if (normalized1 === normalized2) {
		return 1.0;
	}

	const shorter = Math.min(normalized1.length, normalized2.length);
	const longer = Math.max(normalized1.length, normalized2.length);

	if (shorter === 0) {
		return 0;
	}

	let matches = 0;
	for (let i = 0; i < shorter; i++) {
		if (normalized1[i] === normalized2[i]) {
			matches++;
		}
	}

	return matches / longer;
}

/**
 * Validate memory entry for completeness and correctness.
 */
export function validateMemoryEntry(entry: {
	text?: string;
	importance?: number;
	category?: string;
}): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!entry.text || entry.text.trim().length === 0) {
		errors.push('Memory text is required and cannot be empty');
	}

	if (entry.text && entry.text.length > 16000) {
		errors.push('Memory text exceeds maximum length (16000 characters)');
	}

	if (
		entry.importance !== undefined
		&& (entry.importance < 0 || entry.importance > 1)
	) {
		errors.push('Importance must be between 0 and 1');
	}

	if (entry.category) {
		const validCategories = ['fact', 'preference', 'procedure', 'event'];
		if (!validCategories.includes(entry.category)) {
			errors.push(
				`Category must be one of: ${validCategories.join(', ')}, got "${entry.category}"`,
			);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Rate limit helpers for API calls.
 */
export class RateLimiter {
	private requestTimes: number[] = [];
	private readonly windowMs: number;
	private readonly maxRequests: number;

	constructor(maxRequests: number = 100, windowMs: number = 60000) {
		this.maxRequests = maxRequests;
		this.windowMs = windowMs;
	}

	/**
	 * Check if a request is allowed.
	 * Returns true if within rate limit, false otherwise.
	 */
	isAllowed(): boolean {
		const now = Date.now();
		// Remove old requests outside the window
		this.requestTimes = this.requestTimes.filter((t) => now - t < this.windowMs);

		if (this.requestTimes.length < this.maxRequests) {
			this.requestTimes.push(now);
			return true;
		}

		return false;
	}

	/**
	 * Get current request count in the window.
	 */
	getRequestCount(): number {
		const now = Date.now();
		return this.requestTimes.filter((t) => now - t < this.windowMs).length;
	}

	/**
	 * Reset the rate limiter.
	 */
	reset(): void {
		this.requestTimes = [];
	}
}
