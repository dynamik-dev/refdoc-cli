# refdocs

![refdoc-cli](refdoc-cli.png)

[![Tests](https://github.com/dynamik-dev/refdoc-cli/actions/workflows/test.yml/badge.svg)](https://github.com/dynamik-dev/refdoc-cli/actions/workflows/test.yml)
[![Publish to npm](https://github.com/dynamik-dev/refdoc-cli/actions/workflows/publish.yml/badge.svg)](https://github.com/dynamik-dev/refdoc-cli/actions/workflows/publish.yml)
[![npm](https://img.shields.io/npm/v/@dynamik-dev/refdocs)](https://www.npmjs.com/package/@dynamik-dev/refdocs)

Fetch, organize, and catalog markdown docs. Get a compact manifest. Let your agent read the files directly.

Built for LLM coding agents that need token-conscious access to project documentation — no network calls, no API keys, no MCP servers. Just a local CLI and a JSON manifest.

## Install

```bash
npm install -g @dynamik-dev/refdocs
```

## Quick start

```bash
# Initialize config in your project
cd your-project
refdocs init

# Add docs from anywhere
refdocs add ./docs                                        # local directory
refdocs add https://github.com/laravel/docs --branch 11.x # GitHub repo

# Generate the manifest
refdocs manifest

# See what's cataloged
refdocs list
```

The manifest (`.refdocs/manifest.json`) gives your agent a ~500 token map of all your docs — file paths, headings, line counts, and summaries. The agent then reads the specific files it needs directly, skipping the discovery cost entirely.

## Commands

```bash
# Setup
refdocs init                              # create .refdocs/config.json with defaults

# Add sources
refdocs add ./docs                        # local directory
refdocs add https://github.com/org/repo   # GitHub repo (downloads markdown files)

# Catalog
refdocs manifest                          # generate the manifest
refdocs list                              # files and heading counts

# Manage
refdocs update                            # re-pull all tracked sources
refdocs remove docs/laravel               # remove a path from config
```

## How it works

1. **Fetch** — `refdocs add` downloads markdown files from GitHub repos (via tarball) or registers local directories.

2. **Organize** — docs land in `.refdocs/docs/` by default, organized by owner/repo. Paths are tracked in `.refdocs/config.json`.

3. **Catalog** — `refdocs manifest` scans all configured paths, extracts h1-h3 headings and summaries, and writes a compact JSON manifest.

4. **Get out of the way** — your agent reads the manifest to discover what's available, then reads the specific files it needs. No search engine in the middle.

## Manifest format

`.refdocs/manifest.json`:

```json
{
  "generated": "2025-01-01T00:00:00.000Z",
  "sources": 1,
  "files": 12,
  "entries": [
    {
      "file": "docs/laravel/docs/database.md",
      "headings": ["Database", "Configuration", "Connections", "Read & Write Connections"],
      "lines": 245,
      "summary": "Laravel makes interacting with databases extremely simple."
    }
  ]
}
```

## Adding sources

`refdocs add` supports two source types:

| Source | Behavior |
|--------|----------|
| Local path (`./docs`) | Adds directory to config |
| GitHub URL | Downloads `.md` files from the repo tarball |

GitHub sources are tracked in `.refdocs/config.json` and can be re-pulled with `refdocs update`.

## Configuration

`.refdocs/config.json` at project root:

```json
{
  "paths": ["docs"],
  "manifest": "manifest.json"
}
```

- `paths` — directories to catalog (relative to `.refdocs/`)
- `manifest` — where to write the manifest file (relative to `.refdocs/`)
- `sources` — (managed automatically) tracks GitHub repos for `refdocs update`

## Tech

| Dependency | Role |
|------------|------|
| [Commander](https://github.com/tj/commander.js) | CLI framework |
| [tar-stream](https://github.com/mafintosh/tar-stream) | Tarball extraction for GitHub sources |

Zero external services. Works offline, in containers, on planes.
