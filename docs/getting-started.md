# Getting Started

refdocs is a local CLI tool that indexes markdown documentation and exposes fast fuzzy search with intelligent chunking. It gives LLM coding agents efficient, token-conscious access to project documentation without network calls or full-file context dumps.

## Installation

### From source (Bun)

```bash
git clone <repo-url>
cd refdoc-cli
bun install
```

Run directly via Bun:

```bash
bun src/index.ts --help
```

### Build a standalone binary

```bash
bun run build
```

This produces a `./refdocs` binary you can place anywhere on your `$PATH`.

### As a project dependency

```bash
bun add refdocs
# or
npm install refdocs
```

The `refdocs` command is then available via `npx refdocs` or in package.json scripts.

## Quick start

### Option A: Add docs from GitHub

The fastest way to get started — pull docs directly from a GitHub repo:

```bash
refdocs add https://github.com/laravel/docs --branch 11.x
```

This downloads all markdown files, saves them to `ref-docs/docs/`, updates `.refdocs.json`, and builds the index automatically. Then search:

```bash
refdocs search "authentication"
```

### Option B: Index local docs

1. **Create a config file** in your project root:

```bash
echo '{
  "paths": ["docs"],
  "index": ".refdocs-index.json"
}' > .refdocs.json
```

2. **Place markdown files** in the configured directory (e.g. `docs/`).

3. **Build the index:**

```bash
refdocs index
# Indexed 12 files -> 47 chunks
# Index size: 23.1 KB
# Done in 84ms
```

4. **Search:**

```bash
refdocs search "authentication"
```

Output:

```
# [1] auth/overview.md:5-32
# Authentication > Overview

Authentication is handled via bearer tokens...

---

# [2] api/endpoints.md:44-67
# API > Authentication Headers

All requests must include an Authorization header...
```

## What it does

refdocs solves a specific problem: when an LLM coding agent needs to reference project documentation, dumping entire files into context wastes tokens and dilutes relevance. refdocs instead:

1. **Chunks** markdown files at heading boundaries into semantically coherent pieces (100-800 tokens each)
2. **Indexes** those chunks with fuzzy search, prefix matching, and field boosting
3. **Returns** only the most relevant chunks for a query

Everything runs locally. No API keys, no network calls, no external services.

## Next steps

- [Configuration](./configuration.md) - customize paths, chunk sizes, and search behavior
- [CLI Reference](./cli-reference.md) - full command and flag documentation
- [Chunking](./chunking.md) - how markdown is split into searchable chunks
- [Search](./search.md) - how queries are matched and ranked
