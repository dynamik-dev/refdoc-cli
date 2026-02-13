import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findMarkdownFiles, buildIndex, buildAndPersistIndex, loadPersistedIndex, hashFileContent, hashConfig } from "../src/indexer.js";
import { search, buildChunkMap, loadIndex } from "../src/search.js";
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

  it("ignores non-md/mdx/txt files but includes .txt", () => {
    writeFileSync(join(tmpDir, "docs", "readme.md"), "# Hello");
    writeFileSync(join(tmpDir, "docs", "notes.txt"), "not markdown");
    writeFileSync(join(tmpDir, "docs", "data.json"), "{}");
    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toEqual(["docs/notes.txt", "docs/readme.md"]);
  });

  it("finds .mdx files", () => {
    writeFileSync(join(tmpDir, "docs", "readme.md"), "# Hello");
    writeFileSync(join(tmpDir, "docs", "component.mdx"), "# Component\n\nSome MDX content.");
    const files = findMarkdownFiles(["docs"], tmpDir);
    expect(files).toEqual(["docs/component.mdx", "docs/readme.md"]);
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

describe("buildIndex (pure)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-build-pure-"));
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns summary and serialized data without writing to disk", () => {
    writeFileSync(
      join(tmpDir, "docs", "api.md"),
      "# API\n\n## Authentication\n\nUse JWT tokens for auth.\n"
    );
    const { summary, serialized } = buildIndex(testConfig, tmpDir);
    expect(summary.filesIndexed).toBe(1);
    expect(summary.chunksCreated).toBeGreaterThanOrEqual(1);
    expect(summary.indexSizeBytes).toBeGreaterThan(0);
    expect(serialized.length).toBeGreaterThan(0);
    // Should NOT write to disk
    expect(existsSync(join(tmpDir, ".refdocs-index.json"))).toBe(false);
  });
});

describe("buildAndPersistIndex", () => {
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
    const summary = buildAndPersistIndex(testConfig, tmpDir);
    expect(summary.filesIndexed).toBe(1);
    expect(summary.chunksCreated).toBeGreaterThanOrEqual(1);
    expect(summary.indexSizeBytes).toBeGreaterThan(0);
    expect(summary.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(existsSync(join(tmpDir, ".refdocs-index.json"))).toBe(true);
  });

  it("indexes multiple files", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent A about authentication and tokens.\n");
    writeFileSync(join(tmpDir, "docs", "b.md"), "# File B\n\nContent B about configuration and setup.\n");
    const summary = buildAndPersistIndex(testConfig, tmpDir);
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

    const summary = buildAndPersistIndex(overlappingConfig, tmpDir);
    expect(summary.filesIndexed).toBe(2);
    expect(summary.chunksCreated).toBeGreaterThanOrEqual(2);
  });

  it("produces searchable index", () => {
    writeFileSync(
      join(tmpDir, "docs", "guide.md"),
      "# Setup Guide\n\n## Database\n\nConfigure PostgreSQL connection string in your .env file.\n\n## Cache\n\nRedis is used for caching session data.\n"
    );
    buildAndPersistIndex(testConfig, tmpDir);
    const { index, chunkMap } = loadPersistedIndex(join(tmpDir, ".refdocs-index.json"), testConfig);
    const results = search(index, chunkMap, "PostgreSQL", { maxResults: 3 });
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
      buildAndPersistIndex(testConfig, tmpDir);
      const { index, chunks, chunkMap } = loadPersistedIndex(
        join(tmpDir, ".refdocs-index.json"),
        testConfig
      );
      expect(chunks.length).toBeGreaterThan(0);
      const results = search(index, chunkMap, "widgets", { maxResults: 3 });
      expect(results.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("incremental indexing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-incr-"));
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports all unchanged when no files change", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent about authentication.\n");
    writeFileSync(join(tmpDir, "docs", "b.md"), "# File B\n\nContent about configuration.\n");

    const summary1 = buildAndPersistIndex(testConfig, tmpDir);
    expect(summary1.filesIndexed).toBe(2);
    // First build is full — no incremental stats
    expect(summary1.unchanged).toBeUndefined();

    const summary2 = buildAndPersistIndex(testConfig, tmpDir);
    expect(summary2.unchanged).toBe(2);
    expect(summary2.changed).toBe(0);
    expect(summary2.added).toBe(0);
    expect(summary2.removed).toBe(0);
    expect(summary2.chunksCreated).toBe(summary1.chunksCreated);
  });

  it("detects modified files", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nOriginal content about widgets.\n");
    writeFileSync(join(tmpDir, "docs", "b.md"), "# File B\n\nContent about configuration.\n");

    buildAndPersistIndex(testConfig, tmpDir);

    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nUpdated content about gadgets.\n");
    const summary2 = buildAndPersistIndex(testConfig, tmpDir);

    expect(summary2.changed).toBe(1);
    expect(summary2.unchanged).toBe(1);
    expect(summary2.added).toBe(0);
    expect(summary2.removed).toBe(0);
  });

  it("detects new files", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent about authentication.\n");
    const summary1 = buildAndPersistIndex(testConfig, tmpDir);
    const originalChunks = summary1.chunksCreated;

    writeFileSync(join(tmpDir, "docs", "b.md"), "# File B\n\nNew content about databases.\n");
    const summary2 = buildAndPersistIndex(testConfig, tmpDir);

    expect(summary2.added).toBe(1);
    expect(summary2.unchanged).toBe(1);
    expect(summary2.changed).toBe(0);
    expect(summary2.removed).toBe(0);
    expect(summary2.chunksCreated).toBeGreaterThan(originalChunks);
  });

  it("detects deleted files", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent about authentication.\n");
    writeFileSync(join(tmpDir, "docs", "b.md"), "# File B\n\nContent about configuration.\n");

    const summary1 = buildAndPersistIndex(testConfig, tmpDir);

    rmSync(join(tmpDir, "docs", "b.md"));
    const summary2 = buildAndPersistIndex(testConfig, tmpDir);

    expect(summary2.removed).toBe(1);
    expect(summary2.unchanged).toBe(1);
    expect(summary2.changed).toBe(0);
    expect(summary2.added).toBe(0);
    expect(summary2.chunksCreated).toBeLessThan(summary1.chunksCreated);
  });

  it("falls back to full rebuild on config change", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent about authentication.\n");
    buildAndPersistIndex(testConfig, tmpDir);

    const changedConfig: RefdocsConfig = {
      ...testConfig,
      chunkMaxTokens: 400,
    };
    const summary2 = buildAndPersistIndex(changedConfig, tmpDir);

    // Full rebuild — no incremental stats
    expect(summary2.unchanged).toBeUndefined();
    expect(summary2.filesIndexed).toBe(1);
  });

  it("search finds new content after incremental update", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent about widgets and sprockets.\n");
    buildAndPersistIndex(testConfig, tmpDir);

    // Modify file: change widgets to gadgets
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent about gadgets and sprockets.\n");
    buildAndPersistIndex(testConfig, tmpDir);

    const { index, chunkMap } = loadPersistedIndex(join(tmpDir, ".refdocs-index.json"), testConfig);
    const gadgetResults = search(index, chunkMap, "gadgets", { maxResults: 3 });
    expect(gadgetResults.length).toBeGreaterThan(0);
    expect(gadgetResults[0].body).toContain("gadgets");

    const widgetResults = search(index, chunkMap, "widgets", { maxResults: 3 });
    expect(widgetResults).toHaveLength(0);
  });

  it("force flag triggers full rebuild", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent about authentication.\n");
    buildAndPersistIndex(testConfig, tmpDir);

    const summary2 = buildAndPersistIndex(testConfig, tmpDir, { force: true });
    // Full rebuild — no incremental stats
    expect(summary2.unchanged).toBeUndefined();
    expect(summary2.filesIndexed).toBe(1);
  });

  it("v2 index triggers automatic full rebuild", () => {
    writeFileSync(join(tmpDir, "docs", "a.md"), "# File A\n\nContent about authentication.\n");
    buildAndPersistIndex(testConfig, tmpDir);

    // Tamper with version to simulate old v2 index
    const indexPath = join(tmpDir, ".refdocs-index.json");
    const data = JSON.parse(readFileSync(indexPath, "utf-8"));
    data.version = 2;
    writeFileSync(indexPath, JSON.stringify(data), "utf-8");

    const summary = buildAndPersistIndex(testConfig, tmpDir);
    // Should be a full rebuild (version mismatch caught + fallback)
    expect(summary.unchanged).toBeUndefined();
    expect(summary.filesIndexed).toBe(1);
  });
});

describe("hash utilities", () => {
  it("hashFileContent returns consistent hashes", () => {
    const hash1 = hashFileContent("hello world");
    const hash2 = hashFileContent("hello world");
    const hash3 = hashFileContent("hello world!");
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("hashConfig returns consistent hashes for same config", () => {
    const hash1 = hashConfig(testConfig);
    const hash2 = hashConfig(testConfig);
    expect(hash1).toBe(hash2);
  });

  it("hashConfig changes when chunking config changes", () => {
    const hash1 = hashConfig(testConfig);
    const hash2 = hashConfig({ ...testConfig, chunkMaxTokens: 400 });
    expect(hash1).not.toBe(hash2);
  });

  it("hashConfig ignores non-chunking fields", () => {
    const hash1 = hashConfig(testConfig);
    const hash2 = hashConfig({ ...testConfig, paths: ["other-dir"] });
    expect(hash1).toBe(hash2);
  });
});
