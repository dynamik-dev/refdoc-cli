# Configuration

refdocs is configured via a `.refdocs.json` file at your project root.

## Config file resolution

When you run any `refdocs` command, the tool walks up the directory tree from your current working directory looking for `.refdocs.json`. The first one found is used. If no config file is found, defaults are applied and the current directory is treated as the project root.

This means you can run `refdocs` from any subdirectory and it will find the project-level config.

## Full example

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
  },
  "sources": [
    {
      "url": "https://github.com/laravel/docs/tree/11.x",
      "owner": "laravel",
      "repo": "docs",
      "branch": "11.x",
      "subpath": "",
      "localPath": "ref-docs/docs",
      "addedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

## Options

### `paths`

- **Type:** `string[]`
- **Default:** `["ref-docs"]`

Directories to scan for markdown files, relative to the config file location. All `.md` files within these directories (including subdirectories) are indexed.

```json
{
  "paths": ["docs", "api-reference", "guides"]
}
```

### `index`

- **Type:** `string`
- **Default:** `".refdocs-index.json"`

Filename for the persisted search index, relative to the config file location. This file is written by `refdocs index` and read by all other commands.

Add this file to `.gitignore` since it's a build artifact:

```
.refdocs-index.json
```

### `chunkMaxTokens`

- **Type:** `number`
- **Default:** `800`

Upper bound for chunk size in estimated tokens. Sections larger than this are split at paragraph boundaries. Token estimates use a simple heuristic of `ceil(characters / 4)`.

Lower values produce more granular search results. Higher values keep more context per chunk.

### `chunkMinTokens`

- **Type:** `number`
- **Default:** `100`

Minimum chunk size in estimated tokens. Sections smaller than this are merged with their sibling (a section at the same heading depth).

This prevents trivially small chunks that lack useful context.

### `boostFields`

- **Type:** `{ title: number, headings: number, body: number }`
- **Default:** `{ "title": 2, "headings": 1.5, "body": 1 }`

Search relevance weights for each indexed field. Higher values make matches in that field rank higher.

- **`title`** - the innermost heading of the chunk
- **`headings`** - the full heading breadcrumb (e.g. "Config > Database > Connections")
- **`body`** - the body text of the chunk

Example: to make heading matches even more prominent:

```json
{
  "boostFields": {
    "title": 3,
    "headings": 2,
    "body": 1
  }
}
```

### `sources`

- **Type:** `Source[]`
- **Default:** `[]`

Tracks GitHub repositories added via `refdocs add`. Each entry records the original URL, owner, repo, branch, subpath, local storage path, and when it was added. This is managed automatically by `refdocs add` — you don't need to edit it manually.

Each source object has the following fields:

| Field | Description |
|-------|-------------|
| `url` | Original GitHub URL passed to `refdocs add` |
| `owner` | GitHub repository owner |
| `repo` | GitHub repository name |
| `branch` | Branch or ref that was downloaded |
| `subpath` | Subdirectory filter within the repo (empty string for whole repo) |
| `localPath` | Where the files were saved, relative to config |
| `addedAt` | ISO 8601 timestamp of when the source was added |

## Validation

refdocs validates the config file on every command. If validation fails, you get a specific error message:

```
Invalid .refdocs.json: "paths" must be an array of strings; "chunkMaxTokens" must be a positive number
```

All fields are optional. Any omitted field uses its default value.

## Minimal config

The simplest useful config just specifies where your docs live:

```json
{
  "paths": ["docs"]
}
```
