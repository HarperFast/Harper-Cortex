/**
 * OpenClaw Memory Plugin — long-term agent memory backed by Harper Cortex.
 */

import { createAutoCaptureHook, createAutoRecallHook } from './lifecycle.js';
import { CortexMemoryDB } from './memory-db.js';
import { definePluginEntry } from './plugin-sdk.js';
import { createMemoryTools } from './tools.js';
import type { HarperMemoryConfig } from './types.js';

export default definePluginEntry({
	id: 'memory-harper',
	name: 'Memory (Harper Cortex)',
	description: 'Distributed long-term agent memory backed by Harper Cortex. '
		+ 'Server-side embeddings, multi-agent sharing, zero API keys required.',
	kind: 'memory',

	register(api) {
		const config = api.pluginConfig as HarperMemoryConfig;

		// Validate required config
		if (!config.instanceUrl) {
			throw new Error(
				"Harper memory plugin requires 'instanceUrl' in configuration",
			);
		}

		// Initialize the memory wrapper (uses CortexClient internally)
		const db = new CortexMemoryDB({
			instanceUrl: config.instanceUrl,
			token: config.token,
			schema: config.schema ?? 'data',
			agentId: config.agentId,
		});

		// Register auto-recall hook: inject relevant memories before each turn
		api.registerLifecycleHook(
			'before_agent_start',
			createAutoRecallHook(db, {
				maxResults: config.recallLimit ?? 3,
				minSimilarity: config.recallThreshold ?? 0.3,
			}),
		);

		// Register auto-capture hook: extract and store facts after each turn
		api.registerLifecycleHook(
			'agent_end',
			createAutoCaptureHook(db, {
				maxCaptures: config.captureLimit ?? 3,
				dedupThreshold: config.dedupThreshold ?? 0.95,
			}),
		);

		// Register explicit memory tools the agent can invoke
		api.registerTool(
			(ctx) => createMemoryTools(db, ctx),
			{ names: ['memory_recall', 'memory_store', 'memory_forget'] },
		);

		// Register CLI commands
		api.registerCli(({ program }) => {
			const memoryCmd = program
				.command('memory')
				.description('Manage Harper-backed agent memory');

			memoryCmd
				.command('stats')
				.description('Show memory statistics')
				.action(async () => {
					try {
						const count = await db.count(config.agentId);
						console.log(`Memories stored: ${count}`);
					} catch (error) {
						console.error(
							'Failed to get memory stats:',
							error instanceof Error ? error.message : error,
						);
					}
				});

			memoryCmd
				.command('search <query>')
				.option('-n, --limit <n>', 'Max results to return', '5')
				.option('-t, --threshold <t>', 'Minimum similarity threshold', '0.3')
				.description('Search memories by semantic similarity')
				.action(async (query: string, opts: any) => {
					try {
						const limit = parseInt(opts.limit || '5');
						const threshold = parseFloat(opts.threshold || '0.3');

						const results = await db.search(
							query,
							limit,
							config.agentId,
						);

						const filtered = results.filter((r) => r.score >= threshold);

						if (filtered.length === 0) {
							console.log('No matching memories found.');
							return;
						}

						console.log(`Found ${filtered.length} memory(ies):\n`);
						filtered.forEach((result, idx) => {
							console.log(
								`${idx + 1}. [${result.entry.category}] (${result.score.toFixed(3)}) ${result.entry.text}`,
							);
							console.log(
								`   Importance: ${result.entry.importance}, Created: ${new Date(result.entry.createdAt).toISOString()}`,
							);
						});
					} catch (error) {
						console.error(
							'Search failed:',
							error instanceof Error ? error.message : error,
						);
					}
				});

			memoryCmd
				.command('clear')
				.description('⚠️  WARNING: Delete all memories (requires confirmation)')
				.action(async () => {
					console.warn(
						'WARNING: This will delete ALL memories. Use with caution.',
					);
					console.log(
						'This CLI command is a placeholder. Implement with user confirmation.',
					);
				});
		});
	},
});

// Re-export main classes and types
export { createAutoCaptureHook, createAutoRecallHook, type LifecycleContext } from './lifecycle.js';
export { CortexMemoryDB } from './memory-db.js';
export { detectInjection, filterContent, RateLimiter, sanitizeMemory, validateMemoryEntry } from './safety.js';
export { createMemoryTools } from './tools.js';
export type {
	AutoCaptureOptions,
	AutoRecallOptions,
	HarperMemoryConfig,
	MemoryEntry,
	MemorySearchResult,
} from './types.js';
