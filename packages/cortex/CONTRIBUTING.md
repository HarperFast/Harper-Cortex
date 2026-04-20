# Contributing to Cortex

Thanks for your interest in contributing. This guide covers how to get set up, make changes, and submit a pull request.

## Getting Started

1. Fork the repository and clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Cortex.git
   cd Cortex
   ```

2. Install dependencies:
   ```bash
   npm install -g harper
   npm install
   ```

3. Copy the environment template and fill in your API keys:
   ```bash
   cp .env.example .env
   ```

See the [Quick Start](README.md#quick-start) in the README for full setup instructions.

## Development

```bash
npm run dev   # Start Harper locally on http://localhost:9926
npm test      # Run the test suite (requires Node 20+)
```

> **Note**: Tests use `--experimental-test-module-mocks`. Node 24 is recommended (see `.nvmrc`). If you use nvm: `nvm use`.

## Making Changes

- **Core logic**: `resources.js` — SlackWebhook, MemorySearch, MemoryTable classes
- **Schema**: `schema.graphql` — Memory table definition and indexes
- **Config**: `config.yaml` — Harper app configuration

When modifying any of these files, follow the `harper-best-practices` Agent Skill guidelines (see [Agent Skills](README.md#agent-skills)).

## Code Style

- ES module syntax (`import`/`export`) throughout
- Structured JSON logging via the `log()` helper — no bare `console.log()`
- Async processing for all webhook handlers (return 200 fast, process in background)
- No `@export` on tables that are extended in `resources.js`

## Tests

All changes must include tests. The test suite uses Node.js built-in `node:test` with module mocking — no extra test dependencies needed.

```bash
npm test
```

Tests live in `test/` alongside the code they cover:

| File                | Covers                                   |
| ------------------- | ---------------------------------------- |
| `classify.test.js`  | `classifyMessage()`                      |
| `embedding.test.js` | `generateEmbedding()`                    |
| `webhook.test.js`   | `SlackWebhook`, `verifySlackSignature()` |
| `search.test.js`    | `MemorySearch`                           |

## Submitting a Pull Request

1. Create a branch: `git checkout -b your-feature`
2. Make your changes and add tests
3. Verify all tests pass: `npm test`
4. Push and open a pull request against `main`

Please keep PRs focused — one feature or fix per PR.

## Reporting Issues

Open an issue on GitHub with:

- A clear description of the problem
- Steps to reproduce
- Your Node.js version (`node --version`)
- Any relevant error output

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
