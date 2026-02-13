# Getting Started

refdocs is a local CLI tool that fetches, organizes, and catalogs markdown documentation. It generates a compact manifest that gives LLM coding agents efficient, token-conscious access to project documentation without network calls or full-file context dumps.

## Installation

### From npm

```bash
npm install -g @dynamik-dev/refdocs
```

The `refdocs` command is then available globally, or use `npx @dynamik-dev/refdocs` without installing.

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

## Quick start

### Option A: Add docs from GitHub

The fastest way to get started — pull docs directly from a GitHub repo:

```bash
refdocs add https://github.com/laravel/docs --branch 11.x
```

This downloads all markdown files, saves them to `.refdocs/docs/laravel/docs/`, updates `.refdocs/config.json`, and generates the manifest automatically. Then check what's available:

```bash
refdocs list
```

### Option B: Use local docs

1. **Create a config file** in your project root:

```bash
refdocs init
```

2. **Place markdown files** in the configured directory (default: `.refdocs/docs/`), or add an existing docs directory:

```bash
refdocs add ./docs
```

3. **Generate the manifest:**

```bash
refdocs manifest
```

Output:

```
Manifest: 12 files, 0 sources
```

4. **List what's cataloged:**

```bash
refdocs list
```

Output:

```
docs/api.md (3 headings, 45 lines)
docs/guide.md (5 headings, 82 lines)

2 files total
```

## What it does

refdocs solves a specific problem: when an LLM coding agent needs to discover what documentation exists, scanning every file wastes tokens. refdocs instead:

1. **Fetches** markdown docs from GitHub repos or registers local directories
2. **Catalogs** those files into a compact manifest with headings, summaries, and line counts
3. **Gets out of the way** — the agent reads the manifest (~500 tokens for 50 files) to discover what's available, then reads specific files directly

Everything runs locally. No API keys, no network calls, no external services.

## Next steps

- [Configuration](./configuration.md) — customize paths and manifest location
- [CLI Reference](./cli-reference.md) — full command and flag documentation
