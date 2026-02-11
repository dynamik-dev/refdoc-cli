# Chunking

The chunking algorithm is the core of refdocs. It splits markdown files into semantically coherent pieces that are right-sized for LLM context windows.

## Design goals

1. **Semantically coherent** - chunks never split mid-section. Heading boundaries are the primary split points.
2. **Right-sized** - 100-800 tokens by default. Large enough to contain useful context, small enough to not waste tokens.
3. **Hierarchical** - each chunk carries its full heading breadcrumb so the consumer understands where the content fits within the document structure.

## Algorithm

The chunker runs three passes over each markdown file:

### Pass 1: Extract sections

The file is parsed into a markdown AST using `mdast-util-from-markdown`. The AST is walked and split at h1, h2, and h3 heading boundaries (h4-h6 are treated as body content, not split points).

A heading stack tracks the breadcrumb trail. When a new heading is encountered, the stack pops back to a depth less than the new heading, then pushes the new one. This builds correct breadcrumbs like `Configuration > Database > Connections`.

Content before the first heading (preamble) is captured as its own section.

**YAML frontmatter** (delimited by `---`) is stripped before parsing, with line offsets preserved so chunk line numbers still map correctly to the original file.

### Pass 2: Merge small sections

Sections with fewer tokens than `chunkMinTokens` (default: 100) are merged with the previous sibling section at the same heading depth. This prevents tiny, low-value chunks.

The merged section retains the original heading as an inline markdown heading within the body, keeping the structure readable.

### Pass 3: Split oversized sections

Sections with more tokens than `chunkMaxTokens` (default: 800) are split at paragraph boundaries (double newlines). Each sub-section inherits the parent's heading metadata.

The splitter accumulates paragraphs until adding the next one would exceed the limit, then flushes and starts a new sub-section.

## Chunk structure

Each chunk produced by the algorithm has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier: `{filePath}:{index}` |
| `file` | `string` | Relative path to the source file |
| `title` | `string` | Innermost heading (last in the breadcrumb) |
| `headings` | `string` | Full heading breadcrumb, joined with ` > ` |
| `body` | `string` | The chunk's text content |
| `startLine` | `number` | First line in the source file |
| `endLine` | `number` | Last line in the source file |
| `tokenEstimate` | `number` | Estimated token count (`ceil(chars / 4)`) |

## Token estimation

Tokens are estimated as `Math.ceil(text.length / 4)`. This is a rough heuristic that works well enough for chunking decisions. It slightly overestimates for English prose and underestimates for code blocks, but the variance is acceptable for choosing split points.

## Edge cases

| Scenario | Behavior |
|----------|----------|
| Empty file | Returns no chunks |
| File with no headings | Entire file becomes a single chunk |
| YAML frontmatter | Stripped before parsing, line offsets preserved |
| Content before first heading | Captured as a preamble chunk |
| Very long section with no paragraphs | Stays as a single chunk (no split points available) |

## Example

Given this markdown:

```markdown
# Authentication

Overview of auth methods.

## Basic Auth

Send credentials in the Authorization header.
Username and password are base64 encoded.

## OAuth

OAuth 2.0 flow for third-party access.

### Authorization Code

The most common OAuth grant type...
(long section with many paragraphs)
```

The chunker produces:

1. **Chunk 1** - `Authentication` - "Overview of auth methods."
2. **Chunk 2** - `Authentication > Basic Auth` - "Send credentials..."
3. **Chunk 3** - `Authentication > OAuth` - "OAuth 2.0 flow..."
4. **Chunk 4** - `Authentication > OAuth > Authorization Code` - "The most common..." (or multiple chunks if the section exceeds `chunkMaxTokens`)

Small sections like chunk 1 may be merged into chunk 2 if they fall below `chunkMinTokens`.
