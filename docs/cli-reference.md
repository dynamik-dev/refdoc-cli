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

## `refdocs add <source>`

Add a local directory or download markdown documentation from a GitHub repository.

```bash
# Local paths
refdocs add ./my-docs
refdocs add ./my-docs --no-index

# GitHub URLs
refdocs add https://github.com/laravel/docs --branch 11.x
refdocs add https://github.com/statamic/docs/tree/6.x/content
refdocs add https://github.com/owner/repo --path ref-docs/custom --no-index
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `source` | Local directory path or GitHub repository URL (required) |

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--path <dir>` | `ref-docs/{repo}` | Override local storage directory (GitHub URLs only) |
| `--branch <branch>` | from URL or `HEAD` | Override branch detection (GitHub URLs only) |
| `--no-index` | `false` | Skip auto re-indexing after adding |

**Local paths:**

- The directory must exist and contain at least one `.md` file (including subdirectories)
- The path is resolved relative to the project root and added to `paths` in `.refdocs.json`
- Duplicate paths are silently skipped

**GitHub URL formats:**

- `https://github.com/owner/repo` — downloads all `.md` files from the repo
- `https://github.com/owner/repo/tree/branch` — downloads from a specific branch
- `https://github.com/owner/repo/tree/branch/path` — downloads only `.md` files under a subdirectory

**Output (local path):**

```
Added my-docs to paths
Indexed 12 files → 45 chunks
```

**Output (GitHub URL):**

```
Downloaded 47 markdown files → ref-docs/docs/
Source: laravel/docs (11.x)
Indexed 47 files → 156 chunks
```

**Behavior:**

- If the source starts with `http://` or `https://`, it is treated as a GitHub URL
- Otherwise, it is treated as a local directory path
- For GitHub URLs: downloads the repo as a tarball, extracts `.md` files, tracks in `sources`
- For local paths: verifies the directory exists with `.md` files, adds to `paths`
- Automatically re-indexes unless `--no-index` is passed

**Authentication (GitHub only):**

For private repositories, set the `GITHUB_TOKEN` environment variable:

```bash
GITHUB_TOKEN=ghp_xxx refdocs add https://github.com/org/private-docs
```

**Errors:**

- Local path not found: `Directory not found: ./nope`
- No markdown files: `No .md files found in ./empty`
- Non-GitHub URLs: `Only GitHub URLs are supported. Got: "gitlab.com"`
- Missing repo: `Repository not found: owner/repo. Check the URL and ensure the repo is public or GITHUB_TOKEN is set.`

---

## `refdocs remove <path>`

Remove a path from the index configuration.

```bash
refdocs remove ref-docs/laravel
refdocs remove ./my-docs --no-index
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `path` | Path to remove from configured paths (required) |

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--no-index` | `false` | Skip auto re-indexing after removal |

**Output:**

```
Removed ref-docs/laravel from paths
Removed associated source
Indexed 12 files → 45 chunks
```

**Behavior:**

- Removes the path from `paths` in `.refdocs.json`
- If the path has an associated entry in `sources`, removes that too
- Automatically re-indexes unless `--no-index` is passed
- Does **not** delete the files on disk

**Errors:**

- Path not configured: `Path "nope" not found in configured paths.`

---

## `refdocs update`

Re-pull all tracked sources from GitHub and re-index.

```bash
refdocs update
refdocs update --no-index
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--no-index` | `false` | Skip auto re-indexing after update |

**Output:**

```
Updated laravel/docs → 47 files
Updated spatie/laravel-data → 23 files

2 sources updated (70 files total)
Indexed 70 files → 245 chunks
```

**Behavior:**

- Iterates over all entries in `sources` from `.refdocs.json`
- Downloads each repo as a tarball and extracts `.md` files, overwriting local copies
- Automatically re-indexes unless `--no-index` is passed
- Uses `GITHUB_TOKEN` env var for private repos

**Errors:**

- If no sources are configured: `No sources configured. Add a source first with 'refdocs add <url>'.`

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid config, missing index, file not found) |
