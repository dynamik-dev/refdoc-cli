# CLI Reference

## Global options

```
refdocs --help     Show help
refdocs --version  Show version number
```

---

## `refdocs index`

Build the search index from all markdown files in configured paths.

```bash
refdocs index
```

Walks every directory listed in `paths` (from `.refdocs.json`), parses each `.md` file into chunks, builds a MiniSearch index, and persists it to disk.

**Output:**

```
Indexed 42 files -> 156 chunks
Index size: 45.2 KB
Done in 320ms
```

**Behavior:**

- Recursively finds all `.md` files in configured directories
- Overwrites any existing index file
- Config is resolved by walking up the directory tree from `cwd`
- Falls back to defaults if no `.refdocs.json` is found

---

## `refdocs search <query>`

Fuzzy search the index and return the top matching chunks.

```bash
refdocs search "database connections"
refdocs search "auth" -n 5
refdocs search "config" -f "api/**/*.md"
refdocs search "middleware" --json
refdocs search "hooks" --raw
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `query` | Search query string (required) |

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `-n, --results <count>` | `3` | Number of results to return (max: 10) |
| `-f, --file <pattern>` | — | Glob pattern to filter results by file path |
| `--json` | `false` | Output results as a JSON array |
| `--raw` | `false` | Output chunk body only, no metadata headers |

**Default output format:**

```
# [1] spatie-laravel-data/transformers.md:15-48
# Transformers > Built-in Transformers

Transformers are used to convert data properties when...

---

# [2] spatie-laravel-data/creating-data-objects.md:72-95
# Creating Data Objects > Casting and Transforming

When creating a data object from a request...
```

Each result shows:
- Result number, source file, and line range
- Full heading breadcrumb
- Chunk body text

**JSON output** (`--json`):

```json
[
  {
    "score": 12.45,
    "file": "spatie-laravel-data/transformers.md",
    "lines": [15, 48],
    "headings": ["Transformers", "Built-in Transformers"],
    "body": "Transformers are used to convert data properties when..."
  }
]
```

**Raw output** (`--raw`):

Prints only the chunk body text, one per result, separated by blank lines. Useful for piping into other tools.

**Errors:**

- If the index doesn't exist: `Index not found. Run 'refdocs index' first.`
- If no results match: `No results found.`

---

## `refdocs list`

List all indexed files and their chunk counts.

```bash
refdocs list
```

**Output:**

```
api/authentication.md (3 chunks)
api/webhooks.md (5 chunks)
getting-started.md (2 chunks)

3 files, 10 chunks total
```

Files are sorted alphabetically.

---

## `refdocs info <file>`

Show all chunks for a specific indexed file.

```bash
refdocs info "api/authentication.md"
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `file` | Relative file path as shown by `refdocs list` (required) |

**Output:**

```
api/authentication.md: 3 chunks

  [1-15] Authentication > Basic Auth (~50 tokens)
  [16-45] Authentication > Bearer Tokens (~120 tokens)
  [46-78] Authentication > OAuth (~180 tokens)
```

Each line shows the line range, heading breadcrumb, and estimated token count.

**Errors:**

- If the file isn't in the index: `No chunks found for "path". Run 'refdocs list' to see indexed files.`

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid config, missing index, file not found) |
