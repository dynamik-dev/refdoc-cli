# refdocs

A local CLI tool that fetches, organizes, and catalogs markdown documentation. Generates a compact manifest that gives LLM coding agents efficient, token-conscious access to project documentation without MCP servers, network calls, or full-file context dumps.

## Architecture

```
refdocs/
├── src/
│   ├── index.ts          # CLI entrypoint (commander)
│   ├── manifest.ts       # Walks target dirs, extracts headings/summaries, builds manifest
│   ├── config.ts         # Reads/writes .refdocs/config.json
│   ├── github.ts         # GitHub URL parsing + tarball download
│   ├── add.ts            # Orchestration for `refdocs add` (download, extract, config update)
│   └── types.ts          # Shared TypeScript interfaces
├── .refdocs/
│   ├── config.json        # Project config
│   ├── manifest.json      # Generated manifest
│   └── docs/              # Downloaded docs
├── package.json
├── tsconfig.json
└── README.md
```

## Tech Stack

- **Runtime**: Node/Bun (target `bun build --compile` for single binary)
- **Language**: TypeScript, strict mode
- **CLI framework**: Commander
- **Zero external services** — no network calls at runtime, no API keys, everything local

## Config

`.refdocs/config.json` at project root:

```json
{
  "paths": ["docs"],
  "manifest": "manifest.json"
}
```

- `paths` — array of directories to catalog (relative to `.refdocs/`)
- `manifest` — where to persist the generated manifest (relative to `.refdocs/`)
- `sources` — (managed by `refdocs add`) tracks GitHub repos added for future updates

## Manifest

The manifest is a compact JSON file that summarizes all documented files. It replaces the old search index with a lightweight catalog that LLM agents can read directly.

`.refdocs/manifest.json` structure:

```json
{
  "generated": "2025-01-01T00:00:00.000Z",
  "sources": 1,
  "files": 12,
  "entries": [
    {
      "file": "docs/owner/repo/guide.md",
      "headings": ["Guide", "Installation", "Configuration"],
      "lines": 85,
      "summary": "Getting started with the project."
    }
  ]
}
```

Each entry contains:
- `file` — relative path to the markdown file
- `headings` — h1-h3 headings extracted from the content
- `lines` — total line count
- `summary` — frontmatter description or first paragraph

Target: entire manifest for 50 files should be ~500-800 tokens.

## CLI Commands

### `refdocs init`

Create a `.refdocs/config.json` config file with full defaults. Errors if the file already exists. Also auto-runs when `refdocs add` is called without an existing config.

### `refdocs manifest`

Walk all configured paths, extract headings and summaries from every markdown file, and generate the manifest.

- Parse each markdown file for h1-h3 headings via regex
- Extract frontmatter `description` or first paragraph as summary
- Count lines per file
- Write to `.refdocs/manifest.json`
- Print summary: files cataloged, sources tracked

### `refdocs add <source>`

Add a local path or download markdown docs from a GitHub repository.

- If source is a URL (`http://` or `https://`), download from GitHub
- If source is a local path, verify it exists with `.md` files and add to `paths`
- Update `.refdocs/config.json`: add path to `paths`, track source in `sources` (GitHub only)
- Auto regenerate manifest unless `--no-manifest` is passed

**Flags:**
- `--path <dir>` — override local storage directory (default: `docs/{repo}`, GitHub only)
- `--branch <branch>` — override branch detection from URL (GitHub only)
- `--no-manifest` — skip auto manifest generation after adding

Auth via `GITHUB_TOKEN` env var for private repos.

### `refdocs remove <path>`

Remove a path from the configuration.

- Remove path from `paths` in `.refdocs/config.json`
- If path has an associated source, remove from `sources` too
- Auto regenerate manifest unless `--no-manifest` is passed
- Does not delete files on disk

**Flags:**
- `--no-manifest` — skip auto manifest generation after removal

### `refdocs list`

List all documented files and their heading counts. Loads from manifest if available, otherwise scans filesystem directly.

### `refdocs update`

Re-pull all tracked sources from GitHub and regenerate manifest.

- Iterates over `sources` in `.refdocs/config.json`
- Downloads each repo tarball and extracts `.md` files, overwriting local copies
- Auto regenerate manifest unless `--no-manifest` is passed

**Flags:**
- `--no-manifest` — skip auto manifest generation after update

## Design Principles

- **No runtime dependencies beyond the binary** — everything bundles into one file
- **Fast** — manifest generation for a typical doc folder (50 files) should take <1s
- **Deterministic** — same docs, same manifest. No embeddings, no ML, no probabilistic retrieval
- **Composable** — output is plain text or JSON. Pipe it wherever you want
- **Offline** — works air-gapped, on a plane, in a container with no egress
- **Get out of the way** — fetch, organize, catalog, then let the agent read files directly

## Code Style

- Prefer fixing root causes over patching symptoms. If a workaround is needed, explain why the structural fix isn't feasible.
- TypeScript strict mode, no `any`
- Pure functions where possible, side effects at the edges (CLI entrypoint, file I/O)
- No classes unless genuinely needed — prefer modules with exported functions
- Error messages should be actionable: "Manifest not found. Run `refdocs manifest` first."
- Tests with Vitest, focus on manifest generation and file discovery

## Future Considerations (not MVP)

- `refdocs watch` — regenerate manifest on file change
- MCP server mode — expose manifest as an MCP tool for editors that prefer it
- Token counting with tiktoken instead of chars/4 estimate
