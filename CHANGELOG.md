# Changelog

## 2.0.0 — Harper 5.0 Compatibility (2026-04-20)

Cortex 2.0 is a major release aligned with Harper 5.0 ("Lincoln"). It
renames the underlying Harper package, adopts Harper 5's Resource
patterns, aligns Cortex's error surface with RFC 9457, and brings the
embeddings pipeline into compatibility with Harper 5's module loader.

### Breaking changes

- **Requires Harper 5.0 or later.** Cortex 1.x remains available for
  Harper 4 deployments.
- **Package dependency renamed** from `harperdb` to `harper`.
- **All Cortex `Resource` endpoints now use static methods** per Harper
  5's `jsResource` loader requirements (`static async post(_req, data)`).
  Any code that imported a Cortex `Resource` class and called instance
  methods directly will need to update.
- **Error response shape changed** from `{ error: "message string" }` to
  RFC 9457 problem details `{ type, title, status, detail }`. Clients
  that parsed the old shape will need to update.

### New

- `@export` directives on `Memory` and `SynapseEntry` tables for Harper
  5 REST exposure.
- `cortexError(slug, title, status, detail?)` helper in `shared.js` for
  consistent RFC 9457 error construction across all endpoints. Error
  type URIs use `https://github.com/HarperFast/cortex/errors/<slug>`.
- `SlackWebhook` returns plain `{ status, message }` objects for
  Harper 5's response handling.

### Fixed

- Awaited singular CRUD calls (`Memory.get`, etc.) that Harper 5's
  Promise-returning semantics surfaced as a latent bug in 1.x.
- Named import of `transaction` from `'harper'` for Harper 5 VM loader
  compatibility (default import resolves to `undefined` in the v5 VM
  context).
- Per-record transaction wrapping in `BatchUpsert` for improved error
  isolation under Harper 5's transaction semantics.
- Static-method conversion for private helpers
  (`SynapseIngest._parseContent`, `SynapseEmit._emitForTarget`) to
  match their owning classes.
- Resource `post` methods now `await` their `data` argument. Harper 5's
  REST layer passes `request.data` as an unresolved Promise from the
  streaming deserializer.
- `@huggingface/transformers` dynamic import resolves `pipeline` as
  `hft.pipeline ?? hft.default?.pipeline` so it works both in plain
  Node ESM and under Harper 5's module loader, which places named
  exports on `.default`.

### Migration from 1.x

1. Update the Harper package: remove `harperdb`, add `harper` at the
   version pinned in `package.json`.
2. If you extended or directly instantiated any Cortex `Resource`
   subclass, update call sites to static form:
   `ClassName.post(req, data)` instead of `new ClassName().post(data)`.
3. Update any client code that checks `response.error` to check
   `response.type` (presence) and `response.detail` (message content).
4. LMDB is still supported in Harper 5; existing deployments can
   upgrade Harper to 5.0 before upgrading Cortex to 2.0. RocksDB
   becomes the default storage engine for new databases created
   under Harper 5.

### Deployment requirements

Cortex 2.0 requires the following Harper server configuration in
`harper-config.yaml`:

```yaml
applications:
  moduleLoader: node
  dependencyLoader: native
```

Without `moduleLoader: node`, `@huggingface/transformers` dynamic
imports return a VM-wrapped module where named exports are
inaccessible. Without `dependencyLoader: native`, sharp's native
bindings fail to load under Harper 5's VM sandbox.

Cortex's own `config.yaml` sets `allowInstallScripts: true` so that
native dependencies (sharp, onnxruntime-node) complete their postinstall
steps during Harper's deploy.
