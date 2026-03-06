# Synapse: Universal Context Broker for Harper-Cortex

## Context

AI development tools (Claude Code, Cursor, Windsurf, Copilot) each build their own "contextual debt" — session history, rules files, memory banks — that is invisible to other tools. When engineers switch harnesses, the "Why" behind architectural decisions is lost.

Synapse transforms Harper-Cortex into a **Universal Context Broker**: any tool can write structured context to Harper, and any other tool can read it in its native format. Harper becomes the single source of truth for development context.

## Architecture Overview

```
  INGEST (Tool → Harper)                       EMIT (Harper → Tool)

  CLAUDE.md ──────┐                             ┌──▶ CLAUDE.md
  .cursor/rules/ ─┤    ┌─────────────────┐      ├──▶ .cursor/rules/*.mdc
  .windsurf/     ─┤──▶ │  SynapseIngest  │      ├──▶ .windsurf/rules/*.md
  copilot-inst.  ─┤    │  parse →        │      ├──▶ copilot-instructions.md
  Manual / Slack ─┘    │  classify →     │      │
                       │  embed →        │      │    ┌──────────────┐
                       │  store          │      └────│  SynapseEmit │
                       └──────┬──────────┘           │  query →     │
                              │                      │  group →     │
                              ▼                      │  format      │
                   ┌────────────────────────┐        └──────┬───────┘
                   │   SynapseEntry Table   │◀──────────────┘
                   │   (HNSW vector idx)    │
                   │                        │
                   │   Types: intent |      │
                   │     constraint |       │
                   │     artifact | history │
                   └───────────┬────────────┘
                               │
                   ┌───────────▼────────────┐
                   │     SynapseSearch      │
                   │    (semantic query)    │
                   └───────────┬────────────┘
                               │ MCP JSON-RPC
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
       Claude Desktop       Cursor       Any MCP Client

  CLI:  synapse sync   ──▶ SynapseIngest
        synapse emit   ──▶ SynapseEmit
        synapse search ──▶ SynapseSearch
```

## Schema: `SynapseEntry` Table

Single table with `type` discriminator (same pattern as Memory's `classification` field). Enables cross-type vector search and simple MCP exposure.

```graphql
type SynapseEntry @table {
  id: ID @primaryKey
  projectId: String @indexed          # Scopes entries to a project
  type: String @indexed               # intent | constraint | artifact | history
  content: String                     # Full context text
  source: String @indexed             # claude_code | cursor | windsurf | copilot | manual | slack
  sourceFormat: String                # markdown | mdc | json
  embedding: [Float] @indexed(type: "HNSW", distance: "cosine")
  summary: String                     # LLM-generated one-liner
  status: String @indexed             # active | superseded | archived
  references: [String]                # Memory record IDs this traces back to
  tags: [String]                      # Freeform labels
  entities: Any                       # { people, projects, technologies, topics }
  parentId: String @indexed           # Self-referential: constraint → intent it serves
  createdAt: Date @indexed
  updatedAt: Date @indexed
  metadata: Any                       # Tool-specific data (filePath, globs, etc.)
}
```

### The Four Context Types

| Type | Purpose | Example |
|------|---------|---------|
| `intent` | The "Why" | "Chose PostgreSQL over DynamoDB for complex joins in reporting" |
| `constraint` | Musts / Must-Nots | "MUST NOT use any ORM — raw SQL only" |
| `artifact` | References | "Architecture diagram at docs/arch.png" |
| `history` | Failed paths | "Tried Redis Streams for event sourcing, abandoned due to durability" |

## Resource Classes

All added to `resources.js` following existing patterns.

### 1. `SynapseEntry` — Table extension (strips embeddings from GET)

Same pattern as existing `MemoryTable`. Uses renamed import to avoid naming conflict:
```js
const { SynapseEntry: SynapseEntryBase } = tables;
export class SynapseEntry extends SynapseEntryBase { ... }
```

### 2. `SynapseSearch` — Semantic search (POST)

Mirrors `MemorySearch`. Key differences:
- **Requires `projectId`** (mandatory scoping)
- **Defaults to `status: 'active'`** (excludes superseded/archived)
- Filters on `type` and `source`

### 3. `SynapseIngest` — Context ingestion (POST)

Accepts `{ source, content, projectId, parentId?, references? }`:
1. Validates input
2. Calls source-specific **parser** to split content into entries
3. For each entry: classify (Claude Haiku) + embed (Voyage AI) in parallel
4. Stores as SynapseEntry records

**Parsers** (one per tool):
- `parseClaudeCode(content)` — splits CLAUDE.md on `##` headings
- `parseCursor(content)` — extracts YAML frontmatter + markdown body from .mdc
- `parseWindsurf(content)` — splits .md rules on `##` headings
- `parseCopilot(content)` — passes through as single entry
- Default — passes through unchanged

### 4. `SynapseEmit` — Context emission (POST)

Accepts `{ target, projectId, types?, limit? }`:
1. Queries active SynapseEntry records for the project
2. Calls target-specific **emitter** to format output

**Emitters** (one per tool):
- `emitClaudeCode(entries)` — grouped markdown with `## Intents`, `## Constraints`, etc.
- `emitCursor(entries)` — array of `{ filename, content }` with YAML frontmatter per file
- `emitWindsurf(entries)` — array of `{ filename, content }` as plain .md files
- `emitCopilot(entries)` — same as Claude Code format
- `emitMarkdown(entries)` — generic markdown (default)

## Classification

New `classifySynapseEntry(text)` function using same pattern as `classifyMessage()`:
- Model: Claude Haiku 3.5
- Prompt classifies into `intent | constraint | artifact | history`
- Extracts entities and tags
- Fallback type: `intent` (broadest category)

## CLI: `bin/synapse.js`

Zero-dependency Node.js CLI using `process.argv` and `fetch`:

| Command | Action |
|---------|--------|
| `synapse sync` | Discovers CLAUDE.md, .cursor/rules/, .windsurf/rules/, etc. and POSTs each to `/SynapseIngest` |
| `synapse emit --target cursor` | POSTs to `/SynapseEmit` and writes files to disk |
| `synapse search <query>` | POSTs to `/SynapseSearch` and displays results |
| `synapse watch` | Watches context files via `fs.watch` and auto-syncs on change (2s debounce) |
| `synapse status` | Shows entry counts by type and source |

**Env vars**: `SYNAPSE_ENDPOINT`, `SYNAPSE_PROJECT`, `SYNAPSE_AUTH`

## MCP Integration

No additional work needed. Harper MCP server auto-exposes the SynapseEntry table. Any MCP client can immediately:
- List/read entries via `resources/list` and `resources/read`
- Semantic search via `POST /SynapseSearch`
- Ingest context via `POST /SynapseIngest`

## Relationship to Memory

Soft reference via `references: [String]` field (array of Memory IDs). Not a Harper `@relationship` — keeps schemas decoupled. A Synapse intent might reference the Slack messages (Memory records) that informed the decision.

## Files to Modify/Create

| File | Action |
|------|--------|
| `schema.graphql` | Add SynapseEntry type definition |
| `resources.js` | Add SynapseEntry table ext, SynapseSearch, SynapseIngest, SynapseEmit, classifySynapseEntry, parsers, emitters (~350 lines) |
| `bin/synapse.js` | Create CLI (new file) |
| `package.json` | Add `"bin"` field |
| `.env.example` | Add `SYNAPSE_ENDPOINT`, `SYNAPSE_PROJECT`, `SYNAPSE_AUTH` |
| `test/synapse-classify.test.js` | New — tests for classifySynapseEntry |
| `test/synapse-search.test.js` | New — tests for SynapseSearch |
| `test/synapse-ingest.test.js` | New — tests for SynapseIngest + parsers |
| `test/synapse-emit.test.js` | New — tests for SynapseEmit + emitters |

## Implementation Order

### Phase 1: Schema + Table Foundation
1. Add SynapseEntry type to `schema.graphql`
2. Add table destructure and SynapseEntry table extension to `resources.js`
3. Verify with `npm run dev` — `/SynapseEntry/` endpoint responds

### Phase 2: Classification + Search
4. Add Synapse constants, `classifySynapseEntry()`, fallback function
5. Add `SynapseSearch` resource class
6. Write `test/synapse-classify.test.js` and `test/synapse-search.test.js`

### Phase 3: Ingest + Emit
7. Add parsers object (all tool-specific parsers)
8. Add `SynapseIngest` resource class
9. Add emitters object (all tool-specific emitters)
10. Add `SynapseEmit` resource class
11. Write `test/synapse-ingest.test.js` and `test/synapse-emit.test.js`

### Phase 4: CLI
12. Create `bin/synapse.js` with sync, emit, search, watch, status commands
13. Add `bin` field to `package.json`
14. Add Synapse env vars to `.env.example`

### Phase 5: Documentation
15. Update README.md with Synapse section
16. Update docs/architecture.md with Synapse data flow
17. Update CLAUDE.md with new files and conventions

## Verification

After each phase:
- `npm test` — all existing + new tests pass
- `npm run dev` — endpoints respond at `localhost:9926`
- Manual: POST to `/SynapseIngest` with a CLAUDE.md, then `/SynapseSearch` to retrieve, then `/SynapseEmit --target cursor` to format
- After Phase 4: `synapse sync && synapse search "architecture" && synapse emit --target cursor` in the Harper-Cortex project itself
