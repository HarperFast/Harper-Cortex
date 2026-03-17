#!/usr/bin/env node
/**
 * Synapse CLI — Universal Context Broker for Cortex
 *
 * Commands:
 *   synapse sync              Discover and ingest context files
 *   synapse emit              Emit context in a target tool's format
 *   synapse search <query>    Semantic search across context entries
 *   synapse watch             Watch context files and auto-sync on change
 *   synapse status            Show entry counts by type and source
 *
 * Environment:
 *   SYNAPSE_ENDPOINT   Base URL of your Cortex deployment
 *   SYNAPSE_PROJECT    Project ID to scope entries
 *   SYNAPSE_AUTH       Authorization header value (e.g. "Basic dXNlcjpwYXNz")
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ENDPOINT = process.env.SYNAPSE_ENDPOINT || 'http://localhost:9926';
const PROJECT = process.env.SYNAPSE_PROJECT;
const AUTH = process.env.SYNAPSE_AUTH;

function requireProject() {
	if (!PROJECT) {
		console.error('Error: SYNAPSE_PROJECT environment variable is required');
		process.exit(1);
	}
}

function getHeaders() {
	const headers = { 'Content-Type': 'application/json' };
	if (AUTH) { headers['Authorization'] = AUTH; }
	return headers;
}

async function apiPost(path, body) {
	const res = await fetch(`${ENDPOINT}${path}`, {
		method: 'POST',
		headers: getHeaders(),
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HTTP ${res.status}: ${text}`);
	}
	return res.json();
}

// ---------------------------------------------------------------------------
// Context file discovery
// ---------------------------------------------------------------------------

function listFilesWithExt(dir, ext, source) {
	if (!existsSync(dir)) { return []; }
	const results = [];
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...listFilesWithExt(full, ext, source));
			} else if (entry.name.endsWith(ext)) {
				results.push({ filePath: full, source });
			}
		}
	} catch {}
	return results;
}

function discoverContextFiles(cwd) {
	const files = [];

	// Single-file candidates
	for (
		const { rel, source } of [
			{ rel: 'CLAUDE.md', source: 'claude_code' },
			{ rel: 'claude.md', source: 'claude_code' },
			{ rel: 'copilot-instructions.md', source: 'copilot' },
			{ rel: '.github/copilot-instructions.md', source: 'copilot' },
		]
	) {
		const full = join(cwd, rel);
		if (existsSync(full)) { files.push({ filePath: full, source }); }
	}

	// .cursor/rules/*.mdc
	files.push(...listFilesWithExt(join(cwd, '.cursor', 'rules'), '.mdc', 'cursor'));

	// .windsurf/rules/*.md or .windsurf/*.md
	const wsRules = join(cwd, '.windsurf', 'rules');
	const wsRoot = join(cwd, '.windsurf');
	files.push(...listFilesWithExt(existsSync(wsRules) ? wsRules : wsRoot, '.md', 'windsurf'));

	return files;
}

// ---------------------------------------------------------------------------
// sync command
// ---------------------------------------------------------------------------

async function cmdSync() {
	requireProject();
	const cwd = process.cwd();
	const files = discoverContextFiles(cwd);

	if (files.length === 0) {
		console.log(
			'No context files found. Looked for CLAUDE.md, .cursor/rules/*.mdc, .windsurf/rules/*.md, copilot-instructions.md',
		);
		return;
	}

	console.log(`Found ${files.length} context file(s):`);
	let totalStored = 0;

	for (const { filePath, source } of files) {
		const rel = filePath.replace(cwd + '/', '');
		try {
			const content = readFileSync(filePath, 'utf8');
			process.stdout.write(`  Syncing ${rel} (${source})... `);
			const result = await apiPost('/SynapseIngest', { source, content, projectId: PROJECT });
			if (result.error) {
				console.log(`✗ ${result.error}`);
			} else {
				const n = result.count;
				console.log(`✓ ${n} entr${n === 1 ? 'y' : 'ies'} stored`);
				totalStored += n;
			}
		} catch (err) {
			console.log(`✗ ${err.message}`);
		}
	}

	console.log(`\nDone. ${totalStored} total entries stored for project "${PROJECT}".`);
}

// ---------------------------------------------------------------------------
// emit command
// ---------------------------------------------------------------------------

async function cmdEmit(args) {
	requireProject();

	const targetIdx = args.indexOf('--target');
	const target = targetIdx !== -1 ? args[targetIdx + 1] : 'claude_code';
	const shouldWrite = args.includes('--write');

	const typesIdx = args.indexOf('--types');
	const types = typesIdx !== -1 ? args[typesIdx + 1]?.split(',') : undefined;

	const result = await apiPost('/SynapseEmit', { target, projectId: PROJECT, types });

	if (result.error) {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}

	console.log(`Emitting ${result.entryCount} entries for project "${PROJECT}" as ${target}:`);

	if (typeof result.output === 'string') {
		if (shouldWrite) {
			const filename = target === 'claude_code' ? 'SYNAPSE.md' : `synapse-${target}.md`;
			writeFileSync(filename, result.output, 'utf8');
			console.log(`  Written to ${filename}`);
		} else {
			console.log('\n' + result.output);
		}
	} else if (result.output?.files) {
		const baseDir = target === 'cursor' ? join('.cursor', 'rules') : join('.windsurf', 'rules');
		for (const { filename, content } of result.output.files) {
			if (shouldWrite) {
				mkdirSync(baseDir, { recursive: true });
				const filePath = join(baseDir, filename);
				writeFileSync(filePath, content, 'utf8');
				console.log(`  Written to ${filePath}`);
			} else {
				console.log(`\n--- ${filename} ---\n${content}`);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// search command
// ---------------------------------------------------------------------------

async function cmdSearch(args) {
	requireProject();

	// Collect positional args (skip --flag value pairs)
	const queryParts = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith('--')) {
			i++;
			continue;
		}
		queryParts.push(args[i]);
	}
	const query = queryParts.join(' ');

	if (!query) {
		console.error('Usage: synapse search <query>');
		process.exit(1);
	}

	const limitIdx = args.indexOf('--limit');
	const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 10;

	const typeIdx = args.indexOf('--type');
	const filters = typeIdx !== -1 ? { type: args[typeIdx + 1] } : {};

	const result = await apiPost('/SynapseSearch', { query, projectId: PROJECT, limit, filters });

	if (result.error) {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}

	if (result.count === 0) {
		console.log(`No results for: "${query}"`);
		return;
	}

	console.log(`${result.count} result(s) for: "${query}"\n`);
	for (const r of result.results) {
		const score = r.$distance != null ? ` [score: ${(1 - r.$distance).toFixed(3)}]` : '';
		console.log(`[${r.type}]${score} ${r.summary}`);
		console.log(`  ${r.content.substring(0, 120).replace(/\n/g, ' ')}...`);
		console.log(`  Source: ${r.source} | ID: ${r.id}\n`);
	}
}

// ---------------------------------------------------------------------------
// status command
// ---------------------------------------------------------------------------

async function cmdStatus() {
	requireProject();

	// Broad query to approximate entry counts. SynapseSearch requires a
	// vector query so exact counts would need a dedicated endpoint.
	const result = await apiPost('/SynapseSearch', {
		query: '*',
		projectId: PROJECT,
		limit: 100,
	});

	if (result.error) {
		console.error(`Error: ${result.error}`);
		process.exit(1);
	}

	const typeCounts = { intent: 0, constraint: 0, artifact: 0, history: 0 };
	const sourceCounts = {};

	for (const r of result.results) {
		if (typeCounts[r.type] !== undefined) { typeCounts[r.type]++; }
		sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
	}

	console.log(`Synapse Status — Project: ${PROJECT}`);
	console.log(`Endpoint: ${ENDPOINT}\n`);

	console.log('Entry types (sample):');
	for (const [type, count] of Object.entries(typeCounts)) {
		console.log(`  ${type.padEnd(12)} ${count}`);
	}

	if (Object.keys(sourceCounts).length > 0) {
		console.log('\nSources:');
		for (const [source, count] of Object.entries(sourceCounts)) {
			console.log(`  ${source.padEnd(14)} ${count}`);
		}
	}

	console.log(`\nSample size: ${result.count} entries`);
}

// ---------------------------------------------------------------------------
// watch command
// ---------------------------------------------------------------------------

async function cmdWatch() {
	requireProject();
	const cwd = process.cwd();
	const files = discoverContextFiles(cwd);

	if (files.length === 0) {
		console.log('No context files found to watch.');
		return;
	}

	console.log(`Watching ${files.length} file(s) for changes (Ctrl+C to stop):`);
	for (const { filePath, source } of files) {
		console.log(`  ${filePath.replace(cwd + '/', '')} (${source})`);
	}
	console.log('');

	const timers = new Map();

	for (const { filePath, source } of files) {
		watch(filePath, () => {
			clearTimeout(timers.get(filePath));
			timers.set(
				filePath,
				setTimeout(async () => {
					timers.delete(filePath);
					const rel = filePath.replace(cwd + '/', '');
					try {
						const content = readFileSync(filePath, 'utf8');
						process.stdout.write(`  Changed: ${rel}... `);
						const result = await apiPost('/SynapseIngest', { source, content, projectId: PROJECT });
						if (result.error) {
							console.log(`✗ ${result.error}`);
						} else {
							const n = result.count;
							console.log(`✓ ${n} entr${n === 1 ? 'y' : 'ies'} synced`);
						}
					} catch (err) {
						console.log(`✗ ${err.message}`);
					}
				}, 2000),
			);
		});
	}
}

// ---------------------------------------------------------------------------
// help
// ---------------------------------------------------------------------------

function printHelp() {
	console.log(`
Synapse — Universal Context Broker for Cortex

Usage:
  synapse <command> [options]

Commands:
  sync                   Discover and ingest context files from the current directory
  emit [options]         Emit context in a target tool's native format
  search <query>         Semantic search across context entries
  watch                  Watch context files and auto-sync on change (2s debounce)
  status                 Show approximate entry counts by type and source

Emit options:
  --target <tool>        Target tool: claude_code, cursor, windsurf, copilot, markdown (default: claude_code)
  --types <t1,t2>        Filter by entry types: intent,constraint,artifact,history
  --write                Write output files to disk instead of printing

Search options:
  --limit <n>            Max results (default: 10)
  --type <type>          Filter by type: intent, constraint, artifact, history

Environment variables:
  SYNAPSE_ENDPOINT       Cortex base URL (default: http://localhost:9926)
  SYNAPSE_PROJECT        Project ID (required for all commands)
  SYNAPSE_AUTH           Authorization header value (e.g. "Basic dXNlcjpwYXNz")

Examples:
  SYNAPSE_PROJECT=my-app synapse sync
  SYNAPSE_PROJECT=my-app synapse search "why did we choose postgres"
  SYNAPSE_PROJECT=my-app synapse emit --target cursor --write
  SYNAPSE_PROJECT=my-app synapse status
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [, , cmd, ...rest] = process.argv;

try {
	switch (cmd) {
		case 'sync':
			await cmdSync();
			break;
		case 'emit':
			await cmdEmit(rest);
			break;
		case 'search':
			await cmdSearch(rest);
			break;
		case 'watch':
			await cmdWatch();
			break;
		case 'status':
			await cmdStatus();
			break;
		case 'help':
		case '--help':
		case '-h':
			printHelp();
			break;
		default:
			if (cmd) { console.error(`Unknown command: ${cmd}\n`); }
			printHelp();
			if (cmd) { process.exit(1); }
	}
} catch (err) {
	console.error(`Error: ${err.message}`);
	process.exit(1);
}
