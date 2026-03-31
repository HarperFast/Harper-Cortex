/**
 * Lifecycle hooks for auto-recall and auto-capture
 */

import type { CortexMemoryDB } from './memory-db.js';
import type { AutoCaptureOptions, AutoRecallOptions, ContextInjection, MemoryEntry } from './types.js';

/**
 * Create the auto-recall hook.
 * Fires before each agent turn to inject relevant memories as context.
 */
export function createAutoRecallHook(
	db: CortexMemoryDB,
	opts: AutoRecallOptions,
) {
	return async (context: {
		prompt: string;
		agentId?: string;
	}): Promise<ContextInjection | void> => {
		try {
			// Search for relevant memories
			const results = await db.search(
				context.prompt,
				opts.maxResults,
				context.agentId,
			);

			// Filter by similarity threshold
			const relevant = results.filter((r) => r.score >= opts.minSimilarity);

			if (relevant.length === 0) {
				return;
			}

			// Format memories as readable context block
			const memoryBlock = relevant
				.map((r) => `- [${r.entry.category}] ${r.entry.text}`)
				.join('\n');

			return {
				contextInjection: `<relevant-memories>\n${memoryBlock}\n</relevant-memories>`,
			};
		} catch (error) {
			console.error('Auto-recall failed:', error);
			// Don't break the agent on memory retrieval errors
			return;
		}
	};
}

/**
 * Create the auto-capture hook.
 * Fires after each agent turn to extract and store new facts.
 */
export function createAutoCaptureHook(
	db: CortexMemoryDB,
	opts: AutoCaptureOptions,
) {
	return async (context: {
		conversationHistory?: string;
		lastMessage?: string;
		agentId?: string;
	}): Promise<void> => {
		try {
			// Extract facts from the conversation
			const facts = await extractFacts(
				context.lastMessage || context.conversationHistory || '',
				opts.maxCaptures,
			);

			if (facts.length === 0) {
				return;
			}

			// Check for duplicates in existing memories
			const deduped = await dedupFacts(
				facts,
				db,
				opts.dedupThreshold,
				context.agentId,
			);

			// Store non-duplicate facts
			for (const fact of deduped) {
				await db.store({
					text: fact.text,
					importance: fact.importance,
					category: fact.category,
					agentId: context.agentId,
				});
			}
		} catch (error) {
			console.error('Auto-capture failed:', error);
			// Don't break the agent on memory storage errors
		}
	};
}

/** Extract facts from conversation text using simple heuristics. */
async function extractFacts(
	text: string,
	maxFacts: number,
): Promise<Array<{ text: string; importance: number; category: string }>> {
	if (!text || text.length === 0) {
		return [];
	}

	// Simple heuristic: split on sentences and filter for interesting ones
	const sentences = text
		.split(/[.!?]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 20 && s.length < 500);

	// For now, just return the longest sentences as "facts"
	// In production, run through an LLM or ML model
	const facts = sentences.slice(0, maxFacts).map((sentence) => ({
		text: sentence,
		importance: 0.7,
		category: 'fact',
	}));

	return facts;
}

/**
 * Deduplicate facts against existing memories.
 * Uses similarity scoring to avoid storing near-duplicates.
 */
async function dedupFacts(
	facts: Array<{ text: string; importance: number; category: string }>,
	db: CortexMemoryDB,
	threshold: number,
	agentId?: string,
): Promise<Array<{ text: string; importance: number; category: string }>> {
	const deduped: Array<{
		text: string;
		importance: number;
		category: string;
	}> = [];

	for (const fact of facts) {
		// Search for similar existing memories
		const similar = await db.search(fact.text, 1, agentId);

		// If no similar memory found, or similarity below threshold, add the fact
		if (similar.length === 0 || similar[0].score < threshold) {
			deduped.push(fact);
		}
	}

	return deduped;
}

export interface LifecycleContext {
	/** The user's input prompt */
	prompt?: string;

	/** Conversation history */
	conversationHistory?: string;

	/** Last message/response */
	lastMessage?: string;

	/** Agent identifier for multi-agent isolation */
	agentId?: string;
}
