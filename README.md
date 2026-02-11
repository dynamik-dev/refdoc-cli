# refdocs

Index your markdown docs. Search them fast. Get back only what matters.

Built for LLM coding agents that need token-conscious access to project documentation — no network calls, no API keys, no MCP servers. Just a single binary and a JSON index file.

```bash
$ refdocs search "database connections"

# [1] config/database.md:12-34
# Configuration > Database > Connections

Connection pooling is configured via the `pool` key in your
database config. Each connection type supports `min`, `max`,
and `idle_timeout` options...

---

# [2] guides/troubleshooting.md:88-104
# Troubleshooting > Database > Connection Refused

If you see "ECONNREFUSED", check that your database server
is running and the host/port in your config matches...
```

refdocs chunks markdown at heading boundaries into 100-800 token pieces, indexes them with fuzzy search, and returns only the relevant chunks — not entire files.

## Install

```bash
npm install -g @dynamik-dev/refdocs
```

Or build from source:

```bash
bun install && bun run build
```

Produces a standalone `./refdocs` binary. Or run directly:

```bash
bun src/index.ts <command>
```

## Usage

```bash
# Point at your docs directory
echo '{ "paths": ["docs"] }' > .refdocs.json

# Build the index
refdocs index
# Indexed 42 files -> 156 chunks (45.2 KB, 320ms)

# Search
refdocs search "authentication"
refdocs search "config" -n 5              # top 5 results
refdocs search "api" -f "api/**/*.md"     # filter by file glob
refdocs search "hooks" --json             # structured output
refdocs search "auth" --raw               # body only, for piping

# Inspect the index
refdocs list                              # files and chunk counts
refdocs info "api/auth.md"               # chunks in a specific file
```

## How it works

1. **Index** — parses each `.md` file into an AST, splits at h1/h2/h3 boundaries, merges small sections, splits large ones at paragraph breaks. Each chunk keeps its full heading breadcrumb (`Config > Database > Connections`).

2. **Search** — fuzzy matching (20% edit tolerance) with prefix search and field boosting. Titles weighted 2x, headings 1.5x, body 1x. Results ranked by TF-IDF. File-level glob filtering via `-f`.

3. **Output** — human-readable by default, `--json` for structured consumption, `--raw` for piping. Each result includes source file, line range, and heading trail.

## Configuration

`.refdocs.json` at project root:

```json
{
  "paths": ["docs"],
  "index": ".refdocs-index.json",
  "chunkMaxTokens": 800,
  "chunkMinTokens": 100,
  "boostFields": { "title": 2, "headings": 1.5, "body": 1 }
}
```

All fields optional. See [Configuration](docs/configuration.md) for details.

## Documentation

- [Getting Started](docs/getting-started.md) — installation, quick start, and overview
- [CLI Reference](docs/cli-reference.md) — commands, flags, output formats, and exit codes
- [Configuration](docs/configuration.md) — `.refdocs.json` options with defaults and examples
- [Chunking](docs/chunking.md) — the 3-pass splitting algorithm and chunk structure
- [Search](docs/search.md) — fuzzy matching, boosting, scoring, and index persistence

## Tech

| Dependency | Role |
|------------|------|
| [MiniSearch](https://github.com/lucaong/minisearch) | Full-text fuzzy search (~7kb, pure JS) |
| [Commander](https://github.com/tj/commander.js) | CLI framework |
| [mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown) | Markdown AST parsing |
| [picomatch](https://github.com/micromatch/picomatch) | Glob pattern matching |

Zero external services. Works offline, in containers, on planes.
