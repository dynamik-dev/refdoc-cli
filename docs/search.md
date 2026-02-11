# Search

refdocs uses [MiniSearch](https://lucaong.github.io/minisearch/) for full-text search with fuzzy matching and field boosting.

## How search works

When you run `refdocs search "query"`:

1. The persisted index is loaded from disk (`.refdocs-index.json`)
2. MiniSearch runs the query with fuzzy matching and prefix search
3. Results are scored by relevance with field-level boosting
4. If a file filter is specified, non-matching results are removed
5. The top N results are returned

## Fuzzy matching

Queries use a fuzziness factor of `0.2`, meaning terms can tolerate up to 20% character edits (insertions, deletions, substitutions). This handles typos:

- `"confguration"` matches `"configuration"`
- `"authn"` matches `"authentication"` (via prefix, see below)

## Prefix search

Prefix search is enabled, so partial terms match. Searching for `"auth"` matches chunks containing `"authentication"`, `"authorization"`, `"auth-token"`, etc.

## Field boosting

Each chunk is indexed across three fields with configurable weights:

| Field | Default boost | Contains |
|-------|---------------|----------|
| `title` | 2.0 | The innermost heading of the chunk |
| `headings` | 1.5 | Full heading breadcrumb (`"Config > Database > Connections"`) |
| `body` | 1.0 | The chunk's text content |

A match in the title is weighted twice as heavily as a match in the body. This means a chunk titled "Database Connections" ranks higher for the query "database" than a chunk that merely mentions "database" in passing.

Boost weights are configurable in `.refdocs.json` via the `boostFields` option.

## File filtering

The `-f` flag accepts a glob pattern to restrict results to matching file paths:

```bash
# Only search in API docs
refdocs search "rate limit" -f "api/**/*.md"

# Only a specific file
refdocs search "timeout" -f "config/timeouts.md"
```

Glob matching is powered by [picomatch](https://github.com/micromatch/picomatch) and supports standard glob syntax including `*`, `**`, `?`, and brace expansion.

## Scoring

Results are ranked by MiniSearch's TF-IDF scoring algorithm, adjusted by field boost weights. The `score` field in JSON output reflects this combined relevance score.

Higher scores mean stronger matches. Scores are not normalized to a fixed range — they depend on the index size and term frequency distribution.

## Result limit

The `-n` flag controls how many results are returned:

- Default: 3
- Minimum: 1
- Maximum: 10

```bash
refdocs search "config" -n 5
```

## Output formats

### Default (human-readable)

```
# [1] config/database.md:12-34
# Configuration > Database > Connections

Connection pooling is configured via the `connections` key...

---

# [2] guides/setup.md:5-18
# Setup > Database

Before running the app, configure your database...
```

### JSON (`--json`)

```json
[
  {
    "score": 14.23,
    "file": "config/database.md",
    "lines": [12, 34],
    "headings": ["Configuration", "Database", "Connections"],
    "body": "Connection pooling is configured via the `connections` key..."
  }
]
```

### Raw (`--raw`)

Outputs only the body text of each result, separated by blank lines. Useful for piping into other tools or LLM prompts:

```bash
refdocs search "auth" --raw | pbcopy
```

## Index persistence

The search index is serialized to JSON with the following structure:

```json
{
  "version": 1,
  "createdAt": "2025-01-15T10:30:00.000Z",
  "miniSearchIndex": "...",
  "chunks": [...]
}
```

The `version` field ensures compatibility. If the index format changes, refdocs will prompt you to rebuild:

```
Index version mismatch (found v0, expected v1). Run `refdocs index` to rebuild.
```

Rebuilding the index is fast (typically under 1 second for ~50 files) and is required whenever your documentation changes.
