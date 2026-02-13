import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractMarkdownFiles, updateSources, addLocalPath, removePath, isPathCovered } from "../src/add.js";
import type { RefdocsConfig } from "../src/types.js";

const FIXTURE_PATH = join(import.meta.dirname, "fixtures", "test-repo.tar.gz");
const MDX_FIXTURE_PATH = join(import.meta.dirname, "fixtures", "test-repo-mdx.tar.gz");

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

  it("extracts .mdx files alongside .md files", async () => {
    const mdxTarball = readFileSync(MDX_FIXTURE_PATH);
    const count = await extractMarkdownFiles(mdxTarball, "", join(tmpDir, "out"));
    expect(count).toBe(3);

    expect(existsSync(join(tmpDir, "out", "docs", "guide.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "docs", "component.mdx"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "docs", "page.mdx"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "package.json"))).toBe(false);
  });

  it("filters .mdx files by subpath", async () => {
    const mdxTarball = readFileSync(MDX_FIXTURE_PATH);
    const count = await extractMarkdownFiles(mdxTarball, "docs", join(tmpDir, "out"));
    expect(count).toBe(3);

    expect(existsSync(join(tmpDir, "out", "guide.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "component.mdx"))).toBe(true);
    expect(existsSync(join(tmpDir, "out", "page.mdx"))).toBe(true);
  });
});

vi.mock("../src/github.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/github.js")>();
  return {
    ...actual,
    downloadTarball: vi.fn(async () => {
      const buf = readFileSync(FIXTURE_PATH);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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
      paths: ["docs/test-repo"],
      manifest: "manifest.json",
      sources: [
        {
          type: "github",
          url: "https://github.com/test/repo",
          owner: "test",
          repo: "repo",
          branch: "main",
          subpath: "docs",
          localPath: "docs/test-repo",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };

    const results = await updateSources(config, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].filesWritten).toBe(3);
    expect(results[0].source.type).toBe("github");
    if (results[0].source.type === "github") {
      expect(results[0].source.owner).toBe("test");
    }

    expect(existsSync(join(tmpDir, "docs/test-repo", "guide.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "docs/test-repo", "api.md"))).toBe(true);
  });

  it("handles multiple sources", async () => {
    const config: RefdocsConfig = {
      paths: ["docs/a", "docs/b"],
      manifest: "manifest.json",
      sources: [
        {
          type: "github",
          url: "https://github.com/test/a",
          owner: "test",
          repo: "a",
          branch: "HEAD",
          subpath: "",
          localPath: "docs/a",
          addedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          type: "github",
          url: "https://github.com/test/b",
          owner: "test",
          repo: "b",
          branch: "main",
          subpath: "docs",
          localPath: "docs/b",
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
      manifest: "manifest.json",
    };

    await expect(updateSources(config, tmpDir)).rejects.toThrow("No sources configured");
  });
});

describe("config updates via addFromGitHub", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-add-cfg-"));
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveConfig merges into existing config", async () => {
    const { saveConfig } = await import("../src/config.js");

    writeFileSync(
      join(tmpDir, "config.json"),
      JSON.stringify({ paths: ["docs"], chunkMaxTokens: 500 }),
    );

    saveConfig({ paths: ["docs", "docs/laravel"] }, tmpDir);

    const result = JSON.parse(readFileSync(join(tmpDir, "config.json"), "utf-8"));
    expect(result.paths).toEqual(["docs", "docs/laravel"]);
    expect(result.chunkMaxTokens).toBe(500);
  });

  it("saveConfig creates config if none exists", async () => {
    const { saveConfig } = await import("../src/config.js");

    saveConfig({ paths: ["docs/test"] }, tmpDir);

    const result = JSON.parse(readFileSync(join(tmpDir, "config.json"), "utf-8"));
    expect(result.paths).toEqual(["docs/test"]);
  });
});

describe("addLocalPath", () => {
  let tmpDir: string;
  let configDir: string;

  const baseConfig: RefdocsConfig = {
    paths: ["existing-docs"],
    manifest: "manifest.json",
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-addlocal-"));
    configDir = join(tmpDir, ".refdocs");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify(baseConfig));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds a local path to config", () => {
    const docsDir = join(tmpDir, "my-docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "readme.md"), "# Hello");

    const result = addLocalPath("my-docs", configDir, baseConfig, tmpDir);
    expect(result.localPath).toBe("../my-docs");

    const saved = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
    expect(saved.paths).toEqual(["existing-docs", "../my-docs"]);
  });

  it("skips duplicate paths", () => {
    const docsDir = join(tmpDir, ".refdocs", "existing-docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "readme.md"), "# Hello");

    // "existing-docs" resolves to .refdocs/existing-docs relative to configDir
    // When projectDir is tmpDir and inputPath is ".refdocs/existing-docs", it resolves to the same
    const result = addLocalPath(".refdocs/existing-docs", configDir, baseConfig, tmpDir);
    expect(result.localPath).toBe("existing-docs");

    const saved = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
    expect(saved.paths).toEqual(["existing-docs"]);
  });

  it("throws for nonexistent directory", () => {
    expect(() => addLocalPath("nope", configDir, baseConfig, tmpDir)).toThrow("Directory not found: nope");
  });

  it("throws if directory has no .md/.mdx files", () => {
    const emptyDir = join(tmpDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    writeFileSync(join(emptyDir, "data.json"), "{}");

    expect(() => addLocalPath("empty", configDir, baseConfig, tmpDir)).toThrow("No .md/.mdx files found");
  });

  it("accepts a directory with only .mdx files", () => {
    const mdxDir = join(tmpDir, "mdx-docs");
    mkdirSync(mdxDir, { recursive: true });
    writeFileSync(join(mdxDir, "page.mdx"), "# MDX Page");

    const result = addLocalPath("mdx-docs", configDir, baseConfig, tmpDir);
    expect(result.localPath).toBe("../mdx-docs");
  });

  it("finds .md files in subdirectories", () => {
    const parentDir = join(tmpDir, "parent");
    const childDir = join(parentDir, "child");
    mkdirSync(childDir, { recursive: true });
    writeFileSync(join(childDir, "nested.md"), "# Nested");

    const result = addLocalPath("parent", configDir, baseConfig, tmpDir);
    expect(result.localPath).toBe("../parent");
  });
});

describe("removePath", () => {
  let tmpDir: string;
  let configDir: string;

  const baseConfig: RefdocsConfig = {
    paths: ["../my-docs", "docs/laravel"],
    manifest: "manifest.json",
    sources: [
      {
        type: "github",
        url: "https://github.com/laravel/docs",
        owner: "laravel",
        repo: "docs",
        branch: "11.x",
        subpath: "",
        localPath: "docs/laravel",
        addedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-remove-"));
    configDir = join(tmpDir, ".refdocs");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify(baseConfig));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes a path from config", () => {
    const result = removePath("my-docs", configDir, baseConfig, tmpDir);
    expect(result.removed).toBe(true);
    expect(result.sourceRemoved).toBe(false);

    const saved = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
    expect(saved.paths).toEqual(["docs/laravel"]);
  });

  it("also removes matching source", () => {
    // "docs/laravel" relative to configDir is ".refdocs/docs/laravel"
    // When input is ".refdocs/docs/laravel" relative to projectDir, it resolves correctly
    const result = removePath(".refdocs/docs/laravel", configDir, baseConfig, tmpDir);
    expect(result.removed).toBe(true);
    expect(result.sourceRemoved).toBe(true);

    const saved = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
    expect(saved.paths).toEqual(["../my-docs"]);
    expect(saved.sources).toEqual([]);
  });

  it("returns removed: false for unknown path", () => {
    const result = removePath("nonexistent", configDir, baseConfig, tmpDir);
    expect(result.removed).toBe(false);
    expect(result.sourceRemoved).toBe(false);
  });
});

describe("isPathCovered", () => {
  it("returns true for exact match", () => {
    expect(isPathCovered(["docs"], "docs")).toBe(true);
  });

  it("returns true when new path is a subdirectory of existing", () => {
    expect(isPathCovered(["docs"], "docs/honojs/website/docs")).toBe(true);
  });

  it("returns false when new path is not covered", () => {
    expect(isPathCovered(["my-docs"], "docs/honojs")).toBe(false);
  });

  it("returns false when new path is a parent of existing", () => {
    expect(isPathCovered(["docs/honojs"], "docs")).toBe(false);
  });

  it("returns false for shared prefix that is not parent-child", () => {
    expect(isPathCovered(["docs-v2"], "docs")).toBe(false);
    expect(isPathCovered(["docs"], "docs-v2")).toBe(false);
  });

  it("returns false for empty paths array", () => {
    expect(isPathCovered([], "docs")).toBe(false);
  });
});

describe("addFromGitHub overlapping paths", () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-overlap-"));
    configDir = join(tmpDir, ".refdocs");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify({
      paths: ["docs"],
      manifest: "manifest.json",
    }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not add subpath when parent is already in paths", async () => {
    const { addFromGitHub } = await import("../src/add.js");

    const config: RefdocsConfig = {
      paths: ["docs"],
      manifest: "manifest.json",
    };

    await addFromGitHub(
      "https://github.com/honojs/website/tree/main/docs",
      { path: "docs/honojs/website/docs" },
      configDir,
      config,
    );

    const saved = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
    expect(saved.paths).toEqual(["docs"]);
  });

  it("adds path when not covered by existing paths", async () => {
    const { addFromGitHub } = await import("../src/add.js");

    const config: RefdocsConfig = {
      paths: ["my-docs"],
      manifest: "manifest.json",
    };

    writeFileSync(join(configDir, "config.json"), JSON.stringify(config));

    await addFromGitHub(
      "https://github.com/honojs/website/tree/main/docs",
      { path: "docs/honojs/website/docs" },
      configDir,
      config,
    );

    const saved = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
    expect(saved.paths).toContain("docs/honojs/website/docs");
  });
});
