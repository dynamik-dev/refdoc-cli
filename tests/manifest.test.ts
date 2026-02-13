import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findMarkdownFiles,
  extractHeadings,
  extractSummary,
  buildManifestEntry,
  buildManifest,
  buildAndPersistManifest,
  loadManifest,
} from "../src/manifest.js";
import type { RefdocsConfig } from "../src/types.js";

describe("findMarkdownFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-manifest-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds .md files in configured paths", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "guide.md"), "# Guide");
    writeFileSync(join(tmpDir, "docs", "api.md"), "# API");

    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toEqual(["docs/api.md", "docs/guide.md"]);
  });

  it("finds .mdx files", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "page.mdx"), "# Page");

    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toEqual(["docs/page.mdx"]);
  });

  it("finds .txt files", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "notes.txt"), "Notes");

    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toEqual(["docs/notes.txt"]);
  });

  it("walks nested directories", () => {
    mkdirSync(join(tmpDir, "docs", "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "top.md"), "# Top");
    writeFileSync(join(tmpDir, "docs", "sub", "nested.md"), "# Nested");

    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toContain("docs/top.md");
    expect(files).toContain("docs/sub/nested.md");
  });

  it("deduplicates files from overlapping paths", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "guide.md"), "# Guide");

    const files = findMarkdownFiles(["docs", "docs"], tmpDir);
    expect(files).toEqual(["docs/guide.md"]);
  });

  it("returns empty array for nonexistent paths", () => {
    const files = findMarkdownFiles(["nonexistent"], tmpDir);
    expect(files).toEqual([]);
  });
});

describe("extractHeadings", () => {
  it("extracts h1-h3 headings", () => {
    const content = "# Title\n\nSome text\n\n## Section\n\n### Subsection\n\n#### Too deep\n";
    expect(extractHeadings(content)).toEqual(["Title", "Section", "Subsection"]);
  });

  it("returns empty array for no headings", () => {
    expect(extractHeadings("Just some text\n\nMore text")).toEqual([]);
  });

  it("handles headings with inline formatting", () => {
    const content = "# **Bold Title**\n\n## `Code Heading`\n";
    expect(extractHeadings(content)).toEqual(["**Bold Title**", "`Code Heading`"]);
  });
});

describe("extractSummary", () => {
  it("extracts description from frontmatter", () => {
    const content = '---\ntitle: Test\ndescription: A test document\n---\n\n# Title\n\nBody text.';
    expect(extractSummary(content)).toBe("A test document");
  });

  it("extracts quoted description from frontmatter", () => {
    const content = '---\ndescription: "Quoted description"\n---\n\n# Title\n';
    expect(extractSummary(content)).toBe("Quoted description");
  });

  it("falls back to first paragraph when no frontmatter", () => {
    const content = "# Title\n\nFirst paragraph of text.\n\nSecond paragraph.";
    expect(extractSummary(content)).toBe("First paragraph of text.");
  });

  it("skips headings when finding first paragraph", () => {
    const content = "# Title\n\n## Section\n\nActual content here.";
    expect(extractSummary(content)).toBe("Actual content here.");
  });

  it("truncates long summaries", () => {
    const longText = "A".repeat(250);
    const content = `# Title\n\n${longText}`;
    const summary = extractSummary(content);
    expect(summary.length).toBeLessThanOrEqual(203);
    expect(summary).toContain("...");
  });

  it("returns empty string for empty content", () => {
    expect(extractSummary("")).toBe("");
  });
});

describe("buildManifestEntry", () => {
  it("produces correct entry structure", () => {
    const content = "# API Reference\n\n## Authentication\n\nUse Bearer tokens.\n";
    const entry = buildManifestEntry("docs/api.md", content);
    expect(entry.file).toBe("docs/api.md");
    expect(entry.headings).toEqual(["API Reference", "Authentication"]);
    expect(entry.lines).toBe(6);
    expect(entry.summary).toBe("Use Bearer tokens.");
  });
});

describe("buildManifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-manifest-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds manifest for configured paths", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "guide.md"), "# Guide\n\nIntro text.\n\n## Setup\n\nSetup steps.\n");
    writeFileSync(join(tmpDir, "docs", "api.md"), "# API\n\nAPI overview.\n");

    const config: RefdocsConfig = { paths: ["docs"], manifest: "manifest.json" };
    const manifest = buildManifest(config, tmpDir);

    expect(manifest.files).toBe(2);
    expect(manifest.sources).toBe(0);
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.generated).toBeTruthy();

    const guideEntry = manifest.entries.find((e) => e.file === "docs/guide.md");
    expect(guideEntry).toBeDefined();
    expect(guideEntry!.headings).toEqual(["Guide", "Setup"]);
    expect(guideEntry!.summary).toBe("Intro text.");
  });

  it("counts sources from config", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "test.md"), "# Test\n");

    const config: RefdocsConfig = {
      paths: ["docs"],
      manifest: "manifest.json",
      sources: [
        { type: "github", url: "https://github.com/a/b", owner: "a", repo: "b", branch: "main", subpath: "", localPath: "docs", addedAt: "" },
      ],
    };
    const manifest = buildManifest(config, tmpDir);
    expect(manifest.sources).toBe(1);
  });
});

describe("buildAndPersistManifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-manifest-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes manifest to disk", () => {
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "test.md"), "# Test\n\nContent.\n");

    const config: RefdocsConfig = { paths: ["docs"], manifest: "manifest.json" };
    buildAndPersistManifest(config, tmpDir);

    const manifestPath = join(tmpDir, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);

    const written = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(written.files).toBe(1);
    expect(written.entries[0].file).toBe("docs/test.md");
  });
});

describe("loadManifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-manifest-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads a manifest from disk", () => {
    const manifestPath = join(tmpDir, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
      generated: "2025-01-01T00:00:00.000Z",
      sources: 0,
      files: 1,
      entries: [{ file: "test.md", headings: ["Test"], lines: 3, summary: "A test." }],
    }));

    const manifest = loadManifest(manifestPath);
    expect(manifest.files).toBe(1);
    expect(manifest.entries[0].file).toBe("test.md");
  });

  it("throws when manifest does not exist", () => {
    expect(() => loadManifest(join(tmpDir, "nonexistent.json"))).toThrow("Manifest not found");
  });
});
