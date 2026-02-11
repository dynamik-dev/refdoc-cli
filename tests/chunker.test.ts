import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chunkMarkdown, estimateTokens } from "../src/chunker.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

const defaultOpts = { maxTokens: 800, minTokens: 100 };

describe("estimateTokens", () => {
  it("estimates tokens as chars / 4 rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("chunkMarkdown", () => {
  describe("empty file", () => {
    it("returns empty array for empty content", () => {
      expect(chunkMarkdown("", "empty.md", defaultOpts)).toEqual([]);
    });

    it("returns empty array for whitespace-only content", () => {
      expect(chunkMarkdown("   \n\n  ", "empty.md", defaultOpts)).toEqual([]);
    });

    it("returns empty array for empty fixture", () => {
      const content = readFixture("empty.md");
      expect(chunkMarkdown(content, "empty.md", defaultOpts)).toEqual([]);
    });
  });

  describe("simple.md — basic heading hierarchy", () => {
    it("creates chunks at h1/h2/h3 boundaries", () => {
      const content = readFixture("simple.md");
      const chunks = chunkMarkdown(content, "simple.md", defaultOpts);
      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });

    it("includes heading breadcrumbs", () => {
      const content = readFixture("simple.md");
      const chunks = chunkMarkdown(content, "simple.md", defaultOpts);
      const configChunk = chunks.find((c) => c.headings.includes("Configuration"));
      expect(configChunk).toBeDefined();
    });

    it("sets file field on all chunks", () => {
      const content = readFixture("simple.md");
      const chunks = chunkMarkdown(content, "simple.md", defaultOpts);
      for (const chunk of chunks) {
        expect(chunk.file).toBe("simple.md");
      }
    });

    it("assigns unique ids", () => {
      const content = readFixture("simple.md");
      const chunks = chunkMarkdown(content, "simple.md", defaultOpts);
      const ids = chunks.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("has valid line ranges", () => {
      const content = readFixture("simple.md");
      const chunks = chunkMarkdown(content, "simple.md", defaultOpts);
      for (const chunk of chunks) {
        expect(chunk.startLine).toBeGreaterThan(0);
        expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      }
    });

    it("includes token estimates", () => {
      const content = readFixture("simple.md");
      const chunks = chunkMarkdown(content, "simple.md", defaultOpts);
      for (const chunk of chunks) {
        expect(chunk.tokenEstimate).toBeGreaterThan(0);
        expect(chunk.tokenEstimate).toBe(estimateTokens(chunk.body));
      }
    });
  });

  describe("no-headings.md — flat text", () => {
    it("creates a single chunk", () => {
      const content = readFixture("no-headings.md");
      const chunks = chunkMarkdown(content, "docs/no-headings.md", defaultOpts);
      expect(chunks).toHaveLength(1);
    });

    it("uses filename as title when no headings", () => {
      const content = readFixture("no-headings.md");
      const chunks = chunkMarkdown(content, "docs/no-headings.md", defaultOpts);
      expect(chunks[0].title).toBe("no-headings");
    });

    it("contains the full body text", () => {
      const content = readFixture("no-headings.md");
      const chunks = chunkMarkdown(content, "no-headings.md", defaultOpts);
      expect(chunks[0].body).toContain("no headings at all");
      expect(chunks[0].body).toContain("bold");
    });
  });

  describe("large-section.md — oversized section splitting", () => {
    it("splits into multiple chunks", () => {
      const content = readFixture("large-section.md");
      const chunks = chunkMarkdown(content, "large-section.md", defaultOpts);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("keeps all chunks within maxTokens", () => {
      const content = readFixture("large-section.md");
      const chunks = chunkMarkdown(content, "large-section.md", defaultOpts);
      for (const chunk of chunks) {
        expect(chunk.tokenEstimate).toBeLessThanOrEqual(defaultOpts.maxTokens);
      }
    });

    it("preserves heading breadcrumbs across splits", () => {
      const content = readFixture("large-section.md");
      const chunks = chunkMarkdown(content, "large-section.md", defaultOpts);
      for (const chunk of chunks) {
        expect(chunk.headings).toContain("API Reference");
      }
    });

    it("covers all body content", () => {
      const content = readFixture("large-section.md");
      const chunks = chunkMarkdown(content, "large-section.md", defaultOpts);
      const combined = chunks.map((c) => c.body).join("\n");
      expect(combined).toContain("createUser");
      expect(combined).toContain("Batch operations");
    });
  });

  describe("tiny-sections.md — small section merging", () => {
    it("merges sections below minTokens", () => {
      const content = readFixture("tiny-sections.md");
      const chunks = chunkMarkdown(content, "tiny-sections.md", defaultOpts);
      // 7 sections (1 h1, 6 h2) — most are tiny and should merge
      expect(chunks.length).toBeLessThan(7);
    });

    it("preserves content from merged sections", () => {
      const content = readFixture("tiny-sections.md");
      const chunks = chunkMarkdown(content, "tiny-sections.md", defaultOpts);
      const allBodies = chunks.map((c) => c.body).join("\n");
      expect(allBodies).toContain("Enable logging");
      expect(allBodies).toContain("Debug mode");
    });
  });

  describe("frontmatter.md — YAML front matter stripping", () => {
    it("strips front matter and still chunks correctly", () => {
      const content = readFixture("frontmatter.md");
      const chunks = chunkMarkdown(content, "frontmatter.md", defaultOpts);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("does not include front matter in any chunk body", () => {
      const content = readFixture("frontmatter.md");
      const chunks = chunkMarkdown(content, "frontmatter.md", defaultOpts);
      for (const chunk of chunks) {
        expect(chunk.body).not.toContain("author: John Doe");
        expect(chunk.body).not.toContain("tags:");
      }
    });

    it("includes actual content after front matter", () => {
      const content = readFixture("frontmatter.md");
      const chunks = chunkMarkdown(content, "frontmatter.md", defaultOpts);
      const allBodies = chunks.map((c) => c.body).join("\n");
      expect(allBodies).toContain("DATABASE_URL");
      const allHeadings = chunks.map((c) => c.headings).join("\n");
      expect(allHeadings).toContain("Environment Variables");
    });
  });

  describe("code-blocks.md — hash characters in code blocks", () => {
    it("does not split on hash characters inside code blocks", () => {
      const content = readFixture("code-blocks.md");
      const chunks = chunkMarkdown(content, "code-blocks.md", defaultOpts);
      // Should only split on actual headings: h1 "Code Examples", h2 "Python Example",
      // h2 "Bash Example", h2 "Markdown in Code Blocks"
      // Code block contents with # should NOT create extra chunks
      const headingsWithCodeComment = chunks.filter((c) =>
        c.headings.includes("This is a comment in Python")
      );
      expect(headingsWithCodeComment).toHaveLength(0);
    });

    it("preserves code block content in chunk bodies", () => {
      const content = readFixture("code-blocks.md");
      const chunks = chunkMarkdown(content, "code-blocks.md", defaultOpts);
      const allBodies = chunks.map((c) => c.body).join("\n");
      expect(allBodies).toContain('print("Hello, world!")');
      expect(allBodies).toContain("npm install");
    });
  });

  describe("heading-jumps.md — non-sequential heading depths", () => {
    it("handles h1 -> h3 jump gracefully", () => {
      const content = readFixture("heading-jumps.md");
      const chunks = chunkMarkdown(content, "heading-jumps.md", defaultOpts);
      const jumpedChunk = chunks.find((c) =>
        c.headings.includes("Jumped to H3")
      );
      expect(jumpedChunk).toBeDefined();
    });

    it("handles h4+ as body content, not split points", () => {
      const content = readFixture("heading-jumps.md");
      const chunks = chunkMarkdown(content, "heading-jumps.md", defaultOpts);
      // h4 "Deep Jump to H4" should appear in body, not as a separate chunk title
      const h4Chunk = chunks.find((c) => c.title === "Deep Jump to H4");
      expect(h4Chunk).toBeUndefined();
      // But the text should be in some chunk's body
      const allBodies = chunks.map((c) => c.body).join("\n");
      expect(allBodies).toContain("Deep Jump to H4");
    });

    it("builds correct breadcrumbs after depth jump", () => {
      const content = readFixture("heading-jumps.md");
      const chunks = chunkMarkdown(content, "heading-jumps.md", defaultOpts);
      const nestedChunk = chunks.find((c) =>
        c.headings.includes("Nested H3 Under H2")
      );
      if (nestedChunk) {
        expect(nestedChunk.headings).toContain("Back to H2");
      }
    });
  });

  describe("custom options", () => {
    it("respects custom maxTokens", () => {
      const content = readFixture("large-section.md");
      const chunks = chunkMarkdown(content, "large-section.md", {
        maxTokens: 200,
        minTokens: 50,
      });
      for (const chunk of chunks) {
        expect(chunk.tokenEstimate).toBeLessThanOrEqual(200);
      }
      expect(chunks.length).toBeGreaterThan(3);
    });

    it("respects large minTokens by merging aggressively", () => {
      const content = readFixture("simple.md");
      const chunksNormal = chunkMarkdown(content, "simple.md", defaultOpts);
      const chunksAggressive = chunkMarkdown(content, "simple.md", {
        maxTokens: 2000,
        minTokens: 500,
      });
      expect(chunksAggressive.length).toBeLessThanOrEqual(chunksNormal.length);
    });
  });

  describe("edge cases", () => {
    it("handles single heading with no body", () => {
      const chunks = chunkMarkdown("# Title\n", "test.md", defaultOpts);
      // A heading with no body produces an empty body section
      expect(chunks.length).toBeLessThanOrEqual(1);
    });

    it("handles content with only inline formatting", () => {
      const content = "**Bold text** and *italic text* and `code`.";
      const chunks = chunkMarkdown(content, "inline.md", defaultOpts);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].body).toContain("Bold text");
    });

    it("generates sequential chunk ids for same file", () => {
      const content = readFixture("simple.md");
      const chunks = chunkMarkdown(content, "simple.md", defaultOpts);
      chunks.forEach((chunk, i) => {
        expect(chunk.id).toBe(`simple.md:${i}`);
      });
    });
  });
});
