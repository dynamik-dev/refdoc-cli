import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractMarkdownFiles, updateSources, addLocalPath, removePath } from "../src/add.js";
import type { RefdocsConfig } from "../src/types.js";

const FIXTURE_PATH = join(import.meta.dirname, "fixtures", "test-repo.tar.gz");

describe("extractMarkdownFiles", () => {
  let tmpDir: string;
  let tarball: Buffer;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-add-"));
    tarball = readFileSync(FIXTURE_PATH);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts all .md files when no subpath filter", async () => {
    const count = await extractMarkdownFiles(tarball, "", join(tmpDir, "out"));
    expect(count).toBe(4);

    expect(existsSync(join(tmpDir, "out", "README.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "docs", "guide.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "docs", "api.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "docs", "nested", "advanced.md"))).toBe(true);
  });

  it("filters to subpath", async () => {
    const count = await extractMarkdownFiles(tarball, "docs", join(tmpDir, "out"));
    expect(count).toBe(3);

    expect(existsSync(join(tmpDir, "out", "guide.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "api.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "nested", "advanced.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "README.md"))).toBe(false);
  });

  it("filters nested subpath", async () => {
    const count = await extractMarkdownFiles(tarball, "docs/nested", join(tmpDir, "out"));
    expect(count).toBe(1);

    expect(existsSync(join(tmpDir, "out", "advanced.md"))).toBe(true);
  });

  it("excludes non-.md files", async () => {
    await extractMarkdownFiles(tarball, "", join(tmpDir, "out"));

    expect(existsSync(join(tmpDir, "out", "src", "code.ts"))).toBe(false);
    expect(existsSync(join(tmpDir, "out", "notes.txt"))).toBe(false);
  });

  it("preserves file content", async () => {
    await extractMarkdownFiles(tarball, "docs", join(tmpDir, "out"));

    const content = readFileSync(join(tmpDir, "out", "guide.md"), "utf-8");
    expect(content).toBe("# Guide\n\nA user guide.\n");
  });

  it("returns 0 for subpath with no .md files", async () => {
    const count = await extractMarkdownFiles(tarball, "src", join(tmpDir, "out"));
    expect(count).toBe(0);
  });

  it("returns 0 for nonexistent subpath", async () => {
    const count = await extractMarkdownFiles(tarball, "nonexistent", join(tmpDir, "out"));
    expect(count).toBe(0);
  });
});

vi.mock("../src/github.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/github.js")>();
  return {
    ...actual,
    downloadTarball: vi.fn(async () => {
      return readFileSync(FIXTURE_PATH).buffer;
    }),
  };
});

describe("updateSources", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-update-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("re-downloads files for all configured sources", async () => {
    const config: RefdocsConfig = {
      paths: ["ref-docs/test-repo"],
      index: ".refdocs-index.json",
      chunkMaxTokens: 800,
      chunkMinTokens: 100,
      boostFields: { title: 2, headings: 1.5, body: 1 },
      sources: [
        {
          url: "https://github.com/test/repo",
          owner: "test",
          repo: "repo",
          branch: "main",
          subpath: "docs",
          localPath: "ref-docs/test-repo",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };

    const results = await updateSources(config, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].filesWritten).toBe(3);
    expect(results[0].source.owner).toBe("test");

    expect(existsSync(join(tmpDir, "ref-docs/test-repo", "guide.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "ref-docs/test-repo", "api.md"))).toBe(true);
  });

  it("handles multiple sources", async () => {
    const config: RefdocsConfig = {
      paths: ["ref-docs/a", "ref-docs/b"],
      index: ".refdocs-index.json",
      chunkMaxTokens: 800,
      chunkMinTokens: 100,
      boostFields: { title: 2, headings: 1.5, body: 1 },
      sources: [
        {
          url: "https://github.com/test/a",
          owner: "test",
          repo: "a",
          branch: "HEAD",
          subpath: "",
          localPath: "ref-docs/a",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          url: "https://github.com/test/b",
          owner: "test",
          repo: "b",
          branch: "main",
          subpath: "docs",
          localPath: "ref-docs/b",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };

    const results = await updateSources(config, tmpDir);
    expect(results).toHaveLength(2);
    expect(results[0].filesWritten).toBe(4);
    expect(results[1].filesWritten).toBe(3);
  });

  it("throws when no sources are configured", async () => {
    const config: RefdocsConfig = {
      paths: [],
      index: ".refdocs-index.json",
      chunkMaxTokens: 800,
      chunkMinTokens: 100,
      boostFields: { title: 2, headings: 1.5, body: 1 },
    };

    await expect(updateSources(config, tmpDir)).rejects.toThrow("No sources configured");
  });
});

describe("config updates via addFromUrl", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-add-cfg-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveConfig merges into existing config", async () => {
    const { saveConfig } = await import("../src/config.js");

    writeFileSync(
      join(tmpDir, ".refdocs.json"),
      JSON.stringify({ paths: ["docs"], chunkMaxTokens: 500 }),
    );

    saveConfig({ paths: ["docs", "ref-docs/laravel"] }, tmpDir);

    const result = JSON.parse(readFileSync(join(tmpDir, ".refdocs.json"), "utf-8"));
    expect(result.paths).toEqual(["docs", "ref-docs/laravel"]);
    expect(result.chunkMaxTokens).toBe(500);
  });

  it("saveConfig creates config if none exists", async () => {
    const { saveConfig } = await import("../src/config.js");

    saveConfig({ paths: ["ref-docs/test"] }, tmpDir);

    const result = JSON.parse(readFileSync(join(tmpDir, ".refdocs.json"), "utf-8"));
    expect(result.paths).toEqual(["ref-docs/test"]);
  });
});

describe("addLocalPath", () => {
  let tmpDir: string;

  const baseConfig: RefdocsConfig = {
    paths: ["existing-docs"],
    index: ".refdocs-index.json",
    chunkMaxTokens: 800,
    chunkMinTokens: 100,
    boostFields: { title: 2, headings: 1.5, body: 1 },
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-addlocal-"));
    writeFileSync(join(tmpDir, ".refdocs.json"), JSON.stringify(baseConfig));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds a local path to config", () => {
    const docsDir = join(tmpDir, "my-docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "readme.md"), "# Hello");

    const result = addLocalPath("my-docs", tmpDir, baseConfig);
    expect(result.localPath).toBe("my-docs");

    const saved = JSON.parse(readFileSync(join(tmpDir, ".refdocs.json"), "utf-8"));
    expect(saved.paths).toEqual(["existing-docs", "my-docs"]);
  });

  it("skips duplicate paths", () => {
    const docsDir = join(tmpDir, "existing-docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "readme.md"), "# Hello");

    const result = addLocalPath("existing-docs", tmpDir, baseConfig);
    expect(result.localPath).toBe("existing-docs");

    const saved = JSON.parse(readFileSync(join(tmpDir, ".refdocs.json"), "utf-8"));
    expect(saved.paths).toEqual(["existing-docs"]);
  });

  it("throws for nonexistent directory", () => {
    expect(() => addLocalPath("nope", tmpDir, baseConfig)).toThrow("Directory not found: nope");
  });

  it("throws if directory has no .md files", () => {
    const emptyDir = join(tmpDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    writeFileSync(join(emptyDir, "data.json"), "{}");

    expect(() => addLocalPath("empty", tmpDir, baseConfig)).toThrow("No .md files found");
  });

  it("finds .md files in subdirectories", () => {
    const parentDir = join(tmpDir, "parent");
    const childDir = join(parentDir, "child");
    mkdirSync(childDir, { recursive: true });
    writeFileSync(join(childDir, "nested.md"), "# Nested");

    const result = addLocalPath("parent", tmpDir, baseConfig);
    expect(result.localPath).toBe("parent");
  });
});

describe("removePath", () => {
  let tmpDir: string;

  const baseConfig: RefdocsConfig = {
    paths: ["docs", "ref-docs/laravel"],
    index: ".refdocs-index.json",
    chunkMaxTokens: 800,
    chunkMinTokens: 100,
    boostFields: { title: 2, headings: 1.5, body: 1 },
    sources: [
      {
        url: "https://github.com/laravel/docs",
        owner: "laravel",
        repo: "docs",
        branch: "11.x",
        subpath: "",
        localPath: "ref-docs/laravel",
        addedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-remove-"));
    writeFileSync(join(tmpDir, ".refdocs.json"), JSON.stringify(baseConfig));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes a path from config", () => {
    const result = removePath("docs", tmpDir, baseConfig);
    expect(result.removed).toBe(true);
    expect(result.sourceRemoved).toBe(false);

    const saved = JSON.parse(readFileSync(join(tmpDir, ".refdocs.json"), "utf-8"));
    expect(saved.paths).toEqual(["ref-docs/laravel"]);
  });

  it("also removes matching source", () => {
    const result = removePath("ref-docs/laravel", tmpDir, baseConfig);
    expect(result.removed).toBe(true);
    expect(result.sourceRemoved).toBe(true);

    const saved = JSON.parse(readFileSync(join(tmpDir, ".refdocs.json"), "utf-8"));
    expect(saved.paths).toEqual(["docs"]);
    expect(saved.sources).toEqual([]);
  });

  it("returns removed: false for unknown path", () => {
    const result = removePath("nonexistent", tmpDir, baseConfig);
    expect(result.removed).toBe(false);
    expect(result.sourceRemoved).toBe(false);
  });
});
