# Configuration

refdocs is configured via a `.refdocs/config.json` file at your project root.

## Config file resolution

When you run any `refdocs` command, the tool walks up the directory tree from your current working directory looking for a `.refdocs/` directory containing `config.json`. The first one found is used. If no config file is found, defaults are applied and the current directory is treated as the project root.

This means you can run `refdocs` from any subdirectory and it will find the project-level config.

## Full example

```json
{
  "paths": ["docs"],
  "manifest": "manifest.json",
  "sources": [
    {
      "type": "github",
      "url": "https://github.com/laravel/docs/tree/11.x",
      "owner": "laravel",
      "repo": "docs",
      "branch": "11.x",
      "subpath": "",
      "localPath": "docs/laravel/docs",
      "addedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

## Options

### `paths`

- **Type:** `string[]`
- **Default:** `["docs"]`

Directories to scan for markdown files, relative to the `.refdocs/` directory. All `.md` and `.mdx` files within these directories (including subdirectories) are cataloged in the manifest.

```json
{
  "paths": ["docs", "api-reference", "guides"]
}
```

### `manifest`

- **Type:** `string`
- **Default:** `"manifest.json"`

Filename for the generated manifest, relative to the `.refdocs/` directory. This file is written by `refdocs manifest` and read by `refdocs list`.

The entire `.refdocs/` directory should be added to `.gitignore`:

```
.refdocs/
```

### `sources`

- **Type:** `Source[]`
- **Default:** `[]`

Tracks GitHub repositories added via `refdocs add`. Each entry records the original URL, owner, repo, branch, subpath, local storage path, and when it was added. This is managed automatically by `refdocs add` — you don't need to edit it manually.

Each source object has the following fields:

| Field | Description |
|-------|-------------|
| `type` | Source type (`"github"` or `"file"`) |
| `url` | Original URL passed to `refdocs add` |
| `owner` | GitHub repository owner |
| `repo` | GitHub repository name |
| `branch` | Branch or ref that was downloaded |
| `subpath` | Subdirectory filter within the repo (empty string for whole repo) |
| `localPath` | Where the files were saved, relative to `.refdocs/` |
| `addedAt` | ISO 8601 timestamp of when the source was added |

## Validation

refdocs validates the config file on every command. If validation fails, you get a specific error message:

```
Invalid .refdocs/config.json: "paths" must be an array of strings
```

All fields are optional. Any omitted field uses its default value.

## Minimal config

The simplest useful config just specifies where your docs live:

```json
{
  "paths": ["docs"]
}
```
