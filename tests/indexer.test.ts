import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findMarkdownFiles, buildIndex, loadPersistedIndex } from "../src/indexer.js";
import { search } from "../src/search.js";
import type { RefdocsConfig } from "../src/types.js";

const testConfig: RefdocsConfig = {
  paths: ["docs"],
  index: ".refdocs-index.json",
  chunkMaxTokens: 800,
  chunkMinTokens: 100,
  boostFields: { title: 2, headings: 1.5, body: 1 },
};

describe("findMarkdownFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-idx-"));
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds .md files in configured paths", () => {
    writeFileSync(join(tmpDir, "docs", "readme.md"), "# Hello");
    writeFileSync(join(tmpDir, "docs", "guide.md"), "# Guide");
    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toEqual(["docs/guide.md", "docs/readme.md"]);
  });

  it("finds files recursively", () => {
    mkdirSync(join(tmpDir, "docs", "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "root.md"), "# Root");
    writeFileSync(join(tmpDir, "docs", "sub", "nested.md"), "# Nested");
    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toContain("docs/root.md");
    expect(files).toContain("docs/sub/nested.md");
  });

  it("ignores non-md/txt files but includes .txt", () => {
    writeFileSync(join(tmpDir, "docs", "readme.md"), "# Hello");
    writeFileSync(join(tmpDir, "docs", "notes.txt"), "not markdown");
    writeFileSync(join(tmpDir, "docs", "data.json"), "{}");
    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toEqual(["docs/notes.txt", "docs/readme.md"]);
  });

  it("returns empty array for missing directory", () => {
    const files = findMarkdownFiles(["nonexistent"], tmpDir);
    expect(files).toEqual([]);
  });

  it("returns sorted list", () => {
    writeFileSync(join(tmpDir, "docs", "z-file.md"), "# Z");
    writeFileSync(join(tmpDir, "docs", "a-file.md"), "# A");
    writeFileSync(join(tmpDir, "docs", "m-file.md"), "# M");
    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toEqual(["docs/a-file.md", "docs/m-file.md", "docs/z-file.md"]);
  });

  it("deduplicates files from overlapping paths", () => {
    mkdirSync(join(tmpDir, "docs", "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "root.md"), "# Root");
    writeFileSync(join(tmpDir, "docs", "sub", "nested.md"), "# Nested");
    const files = findMarkdownFiles(["docs", "docs/sub"], tmpDir);
    expect(files).toEqual(["docs/root.md", "docs/sub/nested.md"]);
  });
});

describe("buildIndex", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-build-"));
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds index and writes to disk", () => {
    writeFileSync(
      join(tmpDir, "docs", "api.md"),
      "# API\n\n## Authentication\n\nUse JWT tokens for auth.\n\n## Rate Limiting\n\nDefault is 100 req/min.\n"
    );
    const summary = buildIndex(testConfig, tmpDir);
    expect(summary.filesIndexed).toBe(1);
    expect(summary.chunksCreated).toBeGreaterThanOrEqual(1);
    expect(summary.indexSizeBytes).toBeGreaterThan(0);
    expect(summary.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(existsSync(join(tmpDir, ".refdocs-index.json"))).toBe(true);
  });

  it("indexes multiple files", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent A about authentication and tokens.\n");
    writeFileSync(join(tmpDir, "docs", "b.md"), "# File B\n\nContent B about configuration and setup.\n");
    const summary = buildIndex(testConfig, tmpDir);
    expect(summary.filesIndexed).toBe(2);
  });

  it("handles overlapping paths without duplicate ID errors", () => {
    mkdirSync(join(tmpDir, "docs", "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "root.md"), "# Root\n\nRoot content about widgets.\n");
    writeFileSync(join(tmpDir, "docs", "sub", "nested.md"), "# Nested\n\nNested content about gadgets.\n");

    const overlappingConfig: RefdocsConfig = {
      ...testConfig,
      paths: ["docs", "docs/sub"],
    };

    const summary = buildIndex(overlappingConfig, tmpDir);
    expect(summary.filesIndexed).toBe(2);
    expect(summary.chunksCreated).toBeGreaterThanOrEqual(2);
  });

  it("produces searchable index", () => {
    writeFileSync(
      join(tmpDir, "docs", "guide.md"),
      "# Setup Guide\n\n## Database\n\nConfigure PostgreSQL connection string in your .env file.\n\n## Cache\n\nRedis is used for caching session data.\n"
    );
    buildIndex(testConfig, tmpDir);
    const { index } = loadPersistedIndex(join(tmpDir, ".refdocs-index.json"), testConfig);
    const results = search(index, "PostgreSQL", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].body).toContain("PostgreSQL");
  });
});

describe("loadPersistedIndex", () => {
  it("throws with actionable error when index does not exist", () => {
    expect(() => loadPersistedIndex("/nonexistent/path.json", testConfig)).toThrow(
      "Index not found. Run `refdocs index` first."
    );
  });

  it("round-trips build + load successfully", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "refdocs-rt-"));
    try {
      mkdirSync(join(tmpDir, "docs"), { recursive: true });
      writeFileSync(
        join(tmpDir, "docs", "test.md"),
        "# Test Doc\n\nThis is test content about widgets and gadgets.\n"
      );
      buildIndex(testConfig, tmpDir);
      const { index, chunks } = loadPersistedIndex(
        join(tmpDir, ".refdocs-index.json"),
        testConfig
      );
      expect(chunks.length).toBeGreaterThan(0);
      const results = search(index, "widgets", { maxResults: 3 });
      expect(results.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
