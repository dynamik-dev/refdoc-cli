# refdocs

A local CLI tool that indexes markdown documentation and exposes fast fuzzy search with intelligent chunking. Designed to give LLM coding agents efficient, token-conscious access to project documentation without MCP servers, network calls, or full-file context dumps.

## Architecture

```
refdocs/
├── src/
│   ├── index.ts          # CLI entrypoint (commander)
│   ├── indexer.ts         # Walks target dir, chunks md files, builds search index
│   ├── chunker.ts         # Splits markdown by heading hierarchy into right-sized chunks
│   ├── search.ts          # MiniSearch wrapper, query + rank + format results
│   ├── config.ts          # Reads/writes .refdocs.json config
│   ├── github.ts          # GitHub URL parsing + tarball download
│   ├── add.ts             # Orchestration for `refdocs add` (download, extract, config update)
│   └── types.ts           # Shared TypeScript interfaces
├── .refdocs.json          # Example config
├── package.json
├── tsconfig.json
└── README.md
```

## Tech Stack

- **Runtime**: Node/Bun (target `bun build --compile` for single binary)
- **Language**: TypeScript, strict mode
- **Search engine**: MiniSearch — pure JS, ~7kb, fuzzy matching, field boosting, prefix search
- **CLI framework**: Commander
- **Markdown parsing**: markdown-it or remark for heading extraction (evaluate which is lighter)
- **Zero external services** — no network calls, no API keys, everything local

## Config

`.refdocs.json` at project root:

```json
{
  "paths": ["ref-docs"],
  "index": ".refdocs-index.json",
  "chunkMaxTokens": 800,
  "chunkMinTokens": 100,
  "boostFields": {
    "title": 2,
    "headings": 1.5,
    "body": 1
  }
}
```

- `paths` — array of directories to index (relative to project root)
- `index` — where to persist the serialized search index (gitignored)
- `chunkMaxTokens` — upper bound for chunk size, rough estimate (chars / 4)
- `chunkMinTokens` — minimum chunk size; merge small sections with their parent
- `boostFields` — field relevance weights for search ranking
- `sources` — (managed by `refdocs add`) tracks GitHub repos added for future updates

## CLI Commands

### `refdocs init`

Create a `.refdocs.json` config file with full defaults. Errors if the file already exists. Also auto-runs when `refdocs add` is called without an existing config.

### `refdocs index`

Walk all configured paths, chunk every `.md` file, build and persist the MiniSearch index.

- Parse each markdown file into chunks split by heading boundaries (h1 > h2 > h3)
- Each chunk gets metadata: `{ id, file, title, headings, body, startLine, endLine }`
- Small sections (below `chunkMinTokens`) merge into their parent heading's chunk
- Large sections (above `chunkMaxTokens`) split at paragraph boundaries
- Serialize index to `.refdocs-index.json`
- Print summary: files indexed, chunks created, index size

### `refdocs search <query>`

Fuzzy search the index and return the top chunks.

- Load persisted index (error if not built yet)
- Run MiniSearch with fuzzy matching (fuzzy: 0.2), prefix search enabled
- Return top 3 results by default
- Output format: each chunk preceded by a comment with source file and line range

**Flags:**
- `-n, --results <count>` — number of results (default: 3, max: 10)
- `-f, --file <pattern>` — filter results to files matching glob
- `--json` — output results as JSON array instead of formatted text
- `--raw` — output chunk body only, no metadata header (for piping)

### `refdocs add <source>`

Add a local path or download markdown docs from a GitHub repository.

- If source is a URL (`http://` or `https://`), download from GitHub as before
- If source is a local path, verify it exists with `.md` files and add to `paths`
- Update `.refdocs.json`: add path to `paths`, track source in `sources` (GitHub only)
- Auto re-index unless `--no-index` is passed

**Flags:**
- `--path <dir>` — override local storage directory (default: `ref-docs/{repo}`, GitHub only)
- `--branch <branch>` — override branch detection from URL (GitHub only)
- `--no-index` — skip auto re-indexing after adding

Auth via `GITHUB_TOKEN` env var for private repos.

### `refdocs remove <path>`

Remove a path from the index configuration.

- Remove path from `paths` in `.refdocs.json`
- If path has an associated source, remove from `sources` too
- Auto re-index unless `--no-index` is passed
- Does not delete files on disk

**Flags:**
- `--no-index` — skip auto re-indexing after removal

### `refdocs list`

List all indexed files and their chunk counts. Useful for verifying what's in the index.

### `refdocs info <file>`

Show all chunks for a specific file with their headings and token estimates.

### `refdocs update`

Re-pull all tracked sources from GitHub and re-index.

- Iterates over `sources` in `.refdocs.json`
- Downloads each repo tarball and extracts `.md` files, overwriting local copies
- Auto re-index unless `--no-index` is passed

**Flags:**
- `--no-index` — skip auto re-indexing after update

## Chunking Strategy

This is the core value of the tool. Chunks must be:

1. **Semantically coherent** — never split mid-section. Heading boundaries are the primary split points.
2. **Right-sized for LLM context** — 100-800 tokens. Big enough to be useful, small enough to not waste context.
3. **Hierarchical** — each chunk carries its full heading breadcrumb (e.g. `Configuration > Database > Connections`) so the LLM understands where the chunk fits.

Algorithm:
1. Parse markdown into AST
2. Walk AST and split at heading nodes (h1, h2, h3)
3. Each section becomes a candidate chunk with its heading breadcrumb
4. If chunk < minTokens, merge with previous sibling or parent
5. If chunk > maxTokens, split at paragraph boundaries (double newline)
6. Attach metadata: source file path, line range, heading trail

## Output Format

Default output for `refdocs search "data transformers"`:

```
# [1] spatie-laravel-data/transformers.md:15-48
# Transformers > Built-in Transformers

Transformers are used to convert data properties when...
<chunk body here>

---

# [2] spatie-laravel-data/creating-data-objects.md:72-95
# Creating Data Objects > Casting and Transforming

When creating a data object from a request...
<chunk body here>
```

JSON output (`--json`) returns:

```json
[
  {
    "score": 12.45,
    "file": "spatie-laravel-data/transformers.md",
    "lines": [15, 48],
    "headings": ["Transformers", "Built-in Transformers"],
    "body": "..."
  }
]
```

## Design Principles

- **No runtime dependencies beyond the binary** — everything bundles into one file
- **Fast** — indexing a typical ref-docs folder (50 files) should take <1s. Search should be <50ms.
- **Deterministic** — same docs, same index. No embeddings, no ML, no probabilistic retrieval.
- **Composable** — output is plain text or JSON. Pipe it wherever you want.
- **Offline** — works air-gapped, on a plane, in a container with no egress

## Code Style

- Prefer fixing root causes over patching symptoms. If a workaround is needed, explain why the structural fix isn't feasible.
- TypeScript strict mode, no `any`
- Pure functions where possible, side effects at the edges (CLI entrypoint, file I/O)
- No classes unless genuinely needed — prefer modules with exported functions
- Error messages should be actionable: "Index not found. Run `refdocs index` first."
- Tests with Vitest, focus on chunker logic and search relevance

## Future Considerations (not MVP)

- `refdocs watch` — rebuild index on file change
- MCP server mode — expose search as an MCP tool for editors that prefer it
- Token counting with tiktoken instead of chars/4 estimate
- Embedding-based search as optional mode (would require onnxruntime or similar)