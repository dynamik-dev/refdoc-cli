import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getGlobalConfigDir,
  initGlobalConfig,
  loadGlobalConfig,
  CONFIG_FILENAME,
} from "../src/config.js";
import { mergeSearchResults } from "../src/search.js";
import { buildAndPersistIndex, loadPersistedIndex } from "../src/indexer.js";
import { search, buildChunkMap } from "../src/search.js";
import type { SearchResult, RefdocsConfig } from "../src/types.js";

describe("getGlobalConfigDir", () => {
  it("returns ~/.refdocs by default", () => {
    const dir = getGlobalConfigDir();
    expect(dir).toMatch(/\.refdocs$/);
  });

  it("returns override when provided", () => {
    expect(getGlobalConfigDir("/tmp/test-global-refdocs")).toBe("/tmp/test-global-refdocs");
  });
});

describe("initGlobalConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-global-init-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates directory and config file", () => {
    // Use a subdirectory so mkdirSync recursive is actually tested
    const subDir = join(tmpDir, "nested");
    initGlobalConfig(subDir);
    expect(existsSync(join(subDir, CONFIG_FILENAME))).toBe(true);

    const config = JSON.parse(readFileSync(join(subDir, CONFIG_FILENAME), "utf-8"));
    expect(config.paths).toEqual(["docs"]);
    expect(config.index).toBe(".refdocs-index.json");
  });

  it("does not overwrite existing config", () => {
    const configPath = join(tmpDir, CONFIG_FILENAME);
    writeFileSync(configPath, JSON.stringify({ paths: ["custom"] }, null, 2) + "\n");
    initGlobalConfig(tmpDir);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.paths).toEqual(["custom"]);
  });
});

describe("loadGlobalConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-global-load-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no config exists", () => {
    expect(loadGlobalConfig(tmpDir)).toBeNull();
  });

  it("loads valid config", () => {
    writeFileSync(
      join(tmpDir, CONFIG_FILENAME),
      JSON.stringify({ paths: ["my-docs"], chunkMaxTokens: 600 }),
    );
    const result = loadGlobalConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.config.paths).toEqual(["my-docs"]);
    expect(result!.config.chunkMaxTokens).toBe(600);
    expect(result!.configDir).toBe(tmpDir);
  });

  it("returns null for invalid config", () => {
    writeFileSync(join(tmpDir, CONFIG_FILENAME), JSON.stringify({ paths: 123 }));
    expect(loadGlobalConfig(tmpDir)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    writeFileSync(join(tmpDir, CONFIG_FILENAME), "not json at all{{{");
    expect(loadGlobalConfig(tmpDir)).toBeNull();
  });
});

describe("mergeSearchResults", () => {
  const makeResult = (score: number, file: string): SearchResult => ({
    score,
    file,
    lines: [1, 10],
    headings: ["Test"],
    body: `Content from ${file}`,
  });

  it("merges and sorts by score descending", () => {
    const local = [makeResult(10, "local-a.md"), makeResult(5, "local-b.md")];
    const global = [makeResult(8, "global-a.md"), makeResult(3, "global-b.md")];
    const merged = mergeSearchResults(local, global, 10);
    expect(merged.map((r) => r.score)).toEqual([10, 8, 5, 3]);
  });

  it("respects maxResults", () => {
    const local = [makeResult(10, "a.md"), makeResult(9, "b.md")];
    const global = [makeResult(8, "c.md"), makeResult(7, "d.md")];
    const merged = mergeSearchResults(local, global, 2);
    expect(merged).toHaveLength(2);
    expect(merged[0].score).toBe(10);
    expect(merged[1].score).toBe(9);
  });

  it("handles empty local results", () => {
    const global = [makeResult(5, "g.md")];
    const merged = mergeSearchResults([], global, 10);
    expect(merged).toHaveLength(1);
    expect(merged[0].file).toBe("g.md");
  });

  it("handles empty global results", () => {
    const local = [makeResult(5, "l.md")];
    const merged = mergeSearchResults(local, [], 10);
    expect(merged).toHaveLength(1);
    expect(merged[0].file).toBe("l.md");
  });

  it("handles both empty", () => {
    expect(mergeSearchResults([], [], 10)).toEqual([]);
  });
});

describe("local + global search integration", () => {
  let localDir: string;
  let globalDir: string;

  const baseConfig: RefdocsConfig = {
    paths: ["docs"],
    index: ".refdocs-index.json",
    chunkMaxTokens: 800,
    chunkMinTokens: 100,
    boostFields: { title: 2, headings: 1.5, body: 1 },
  };

  beforeEach(() => {
    localDir = mkdtempSync(join(tmpdir(), "refdocs-local-int-"));
    globalDir = mkdtempSync(join(tmpdir(), "refdocs-global-int-"));

    // Set up local docs
    mkdirSync(join(localDir, "docs"), { recursive: true });
    writeFileSync(
      join(localDir, "docs", "local-guide.md"),
      "# Local Guide\n\n## Authentication\n\nLocal authentication uses JWT tokens for secure access.\n",
    );

    // Set up global docs
    mkdirSync(join(globalDir, "docs"), { recursive: true });
    writeFileSync(
      join(globalDir, "docs", "global-reference.md"),
      "# Global Reference\n\n## Authentication\n\nGlobal authentication reference with OAuth2 and SAML support.\n",
    );
  });

  afterEach(() => {
    rmSync(localDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  });

  it("merges results from local and global indexes", () => {
    buildAndPersistIndex(baseConfig, localDir);
    buildAndPersistIndex(baseConfig, globalDir);

    const { index: localIndex, chunkMap: localChunkMap } = loadPersistedIndex(
      join(localDir, baseConfig.index),
      baseConfig,
    );
    const { index: globalIndex, chunkMap: globalChunkMap } = loadPersistedIndex(
      join(globalDir, baseConfig.index),
      baseConfig,
    );

    const localResults = search(localIndex, localChunkMap, "authentication", { maxResults: 5 });
    const globalResults = search(globalIndex, globalChunkMap, "authentication", { maxResults: 5 }).map((r) => ({
      ...r,
      file: `[global] ${r.file}`,
    }));

    const merged = mergeSearchResults(localResults, globalResults, 5);
    expect(merged.length).toBeGreaterThanOrEqual(2);

    const files = merged.map((r) => r.file);
    expect(files.some((f) => !f.startsWith("[global]"))).toBe(true);
    expect(files.some((f) => f.startsWith("[global]"))).toBe(true);
  });
});
