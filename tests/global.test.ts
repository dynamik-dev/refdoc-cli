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
import { buildAndPersistManifest } from "../src/manifest.js";
import type { RefdocsConfig } from "../src/types.js";

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
    const subDir = join(tmpDir, "nested");
    initGlobalConfig(subDir);
    expect(existsSync(join(subDir, CONFIG_FILENAME))).toBe(true);

    const config = JSON.parse(readFileSync(join(subDir, CONFIG_FILENAME), "utf-8"));
    expect(config.paths).toEqual(["docs"]);
    expect(config.manifest).toBe("manifest.json");
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
      JSON.stringify({ paths: ["my-docs"] }),
    );
    const result = loadGlobalConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.config.paths).toEqual(["my-docs"]);
    expect(result!.config.manifest).toBe("manifest.json");
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

describe("local + global manifest integration", () => {
  let localDir: string;
  let globalDir: string;

  const baseConfig: RefdocsConfig = {
    paths: ["docs"],
    manifest: "manifest.json",
  };

  beforeEach(() => {
    localDir = mkdtempSync(join(tmpdir(), "refdocs-local-int-"));
    globalDir = mkdtempSync(join(tmpdir(), "refdocs-global-int-"));

    mkdirSync(join(localDir, "docs"), { recursive: true });
    writeFileSync(
      join(localDir, "docs", "local-guide.md"),
      "# Local Guide\n\n## Authentication\n\nLocal authentication uses JWT tokens for secure access.\n",
    );

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

  it("generates manifests for local and global configs", () => {
    const localManifest = buildAndPersistManifest(baseConfig, localDir);
    const globalManifest = buildAndPersistManifest(baseConfig, globalDir);

    expect(localManifest.files).toBe(1);
    expect(localManifest.entries[0].file).toBe("docs/local-guide.md");
    expect(localManifest.entries[0].headings).toContain("Local Guide");
    expect(localManifest.entries[0].headings).toContain("Authentication");

    expect(globalManifest.files).toBe(1);
    expect(globalManifest.entries[0].file).toBe("docs/global-reference.md");
    expect(globalManifest.entries[0].headings).toContain("Global Reference");
  });
});
