# CLI Reference

## Global options

```
refdocs --help     Show help
refdocs --version  Show version number
```

---

## `refdocs init`

Create a `.refdocs/config.json` config file with default settings.

```bash
refdocs init
refdocs init -g
```

**Options:**

| Flag | Description |
|------|-------------|
| `-g, --global` | Create global config at `~/.refdocs/` |

**Behavior:**

- Creates `.refdocs/config.json` in the current directory (or `~/.refdocs/config.json` with `-g`)
- Includes all default values: `paths`, `manifest`
- If `.refdocs/config.json` already exists, exits with an error

**Note:** Running `refdocs add` will automatically initialize `.refdocs/config.json` if it doesn't exist.

---

## `refdocs manifest`

Generate the documentation manifest from all markdown files in configured paths.

```bash
refdocs manifest
refdocs manifest -g
```

**Options:**

| Flag | Description |
|------|-------------|
| `-g, --global` | Generate manifest for global config |

**Output:**

```
Manifest: 42 files, 2 sources
```

**Behavior:**

- Recursively finds all `.md`, `.mdx`, and `.txt` files in configured directories
- Extracts h1-h3 headings from each file
- Extracts summary from frontmatter `description` or first paragraph
- Counts lines per file
- Writes manifest to `.refdocs/manifest.json` (or configured path)

---

## `refdocs list`

List all documented files and their heading counts.

```bash
refdocs list
refdocs list -g
```

**Options:**

| Flag | Description |
|------|-------------|
| `-g, --global` | List global documented files |

**Output:**

```
docs/api.md (3 headings, 45 lines)
docs/guide.md (5 headings, 82 lines)

2 files total
```

**Behavior:**

- Loads the manifest if available
- Falls back to scanning the filesystem directly if no manifest exists
- Files are sorted alphabetically

---

## `refdocs add <source>`

Add a local directory or download markdown documentation from a GitHub repository.

```bash
# Local paths
refdocs add ./my-docs
refdocs add ./my-docs --no-manifest

# GitHub URLs
refdocs add https://github.com/laravel/docs --branch 11.x
refdocs add https://github.com/statamic/docs/tree/6.x/content
refdocs add https://github.com/owner/repo --path docs/custom --no-manifest

# Global
refdocs add https://github.com/org/docs -g
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `source` | Local directory path or GitHub repository URL (required) |

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--path <dir>` | `docs/{owner}/{repo}` | Override local storage directory (GitHub URLs only) |
| `--branch <branch>` | from URL or `HEAD` | Override branch detection (GitHub URLs only) |
| `--no-manifest` | `false` | Skip auto manifest generation after adding |
| `-g, --global` | `false` | Store docs in global `~/.refdocs/` directory |

**Local paths:**

- The directory must exist and contain at least one `.md` or `.mdx` file (including subdirectories)
- The path is resolved relative to the project root and stored relative to `.refdocs/` in config
- Duplicate paths are silently skipped

**GitHub URL formats:**

- `https://github.com/owner/repo` — downloads all `.md` files from the repo
- `https://github.com/owner/repo/tree/branch` — downloads from a specific branch
- `https://github.com/owner/repo/tree/branch/path` — downloads only `.md` files under a subdirectory

**Output (GitHub URL):**

```
Downloaded 47 markdown files → docs/laravel/docs/
Source: laravel/docs (11.x)
Manifest: 47 files, 1 sources
```

**Authentication (GitHub only):**

For private repositories, set the `GITHUB_TOKEN` environment variable:

```bash
GITHUB_TOKEN=ghp_xxx refdocs add https://github.com/org/private-docs
```

**Errors:**

- Local path not found: `Directory not found: ./nope`
- No markdown files: `No .md/.mdx files found in ./empty`
- Non-GitHub URLs: `Only GitHub URLs are supported. Got: "gitlab.com"`
- Missing repo: `Repository not found: owner/repo. Check the URL and ensure the repo is public or GITHUB_TOKEN is set.`

---

## `refdocs remove <path>`

Remove a path from the configuration.

```bash
refdocs remove docs/laravel
refdocs remove ./my-docs --no-manifest
refdocs remove docs/laravel -g
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `path` | Path to remove from configured paths (required) |

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--no-manifest` | `false` | Skip auto manifest generation after removal |
| `-g, --global` | `false` | Remove from global config |

**Behavior:**

- Removes the path from `paths` in `.refdocs/config.json`
- If the path has an associated entry in `sources`, removes that too
- Automatically regenerates manifest unless `--no-manifest` is passed
- Does **not** delete the files on disk

**Errors:**

- Path not configured: `Path "nope" not found in configured paths.`

---

## `refdocs update`

Re-pull all tracked sources from GitHub and regenerate the manifest.

```bash
refdocs update
refdocs update --no-manifest
refdocs update -g
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--no-manifest` | `false` | Skip auto manifest generation after update |
| `-g, --global` | `false` | Update global sources |

**Output:**

```
Updated laravel/docs → 47 files
Updated spatie/laravel-data → 23 files

2 sources updated (70 files total)
Manifest: 70 files, 2 sources
```

**Behavior:**

- Iterates over all entries in `sources` from `.refdocs/config.json`
- Downloads each repo as a tarball and extracts `.md` files, overwriting local copies
- Automatically regenerates manifest unless `--no-manifest` is passed
- Uses `GITHUB_TOKEN` env var for private repos

**Errors:**

- If no sources are configured: `No sources configured. Add a source first with 'refdocs add <url>'.`

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid config, missing manifest, file not found) |
