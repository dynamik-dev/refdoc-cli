import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { loadConfig, validateConfig, configExists, initConfig, CONFIG_FILENAME } from "../src/config.js";

describe("validateConfig", () => {
  it("returns no errors for valid config", () => {
    expect(
      validateConfig({
        paths: ["docs"],
        index: ".index.json",
        chunkMaxTokens: 800,
        chunkMinTokens: 100,
        boostFields: { title: 2, headings: 1.5, body: 1 },
      })
    ).toEqual([]);
  });

  it("returns no errors for empty object (all optional)", () => {
    expect(validateConfig({})).toEqual([]);
  });

  it("rejects non-object config", () => {
    expect(validateConfig("string")).toEqual(["Config must be a JSON object"]);
    expect(validateConfig(null)).toEqual(["Config must be a JSON object"]);
    expect(validateConfig([])).toEqual(["Config must be a JSON object"]);
  });

  it("rejects invalid paths", () => {
    const errors = validateConfig({ paths: "not-array" });
    expect(errors).toContain('"paths" must be an array of strings');
  });

  it("rejects non-string items in paths", () => {
    const errors = validateConfig({ paths: [123] });
    expect(errors).toContain('"paths" must be an array of strings');
  });

  it("rejects non-string index", () => {
    const errors = validateConfig({ index: 123 });
    expect(errors).toContain('"index" must be a string');
  });

  it("rejects non-positive chunkMaxTokens", () => {
    expect(validateConfig({ chunkMaxTokens: -1 })).toContain(
      '"chunkMaxTokens" must be a positive number'
    );
    expect(validateConfig({ chunkMaxTokens: "abc" })).toContain(
      '"chunkMaxTokens" must be a positive number'
    );
  });

  it("rejects non-positive chunkMinTokens", () => {
    expect(validateConfig({ chunkMinTokens: 0 })).toContain(
      '"chunkMinTokens" must be a positive number'
    );
  });

  it("rejects invalid boostFields", () => {
    expect(validateConfig({ boostFields: "not-object" })).toContain(
      '"boostFields" must be an object'
    );
  });

  it("rejects non-number boost field values", () => {
    const errors = validateConfig({ boostFields: { title: "high" } });
    expect(errors).toContain('"boostFields.title" must be a number');
  });
});

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const { config, configDir } = loadConfig(tmpDir);
    expect(config.paths).toEqual(["ref-docs"]);
    expect(config.index).toBe(".refdocs-index.json");
    expect(config.chunkMaxTokens).toBe(800);
    expect(config.chunkMinTokens).toBe(100);
    expect(configDir).toBe(tmpDir);
  });

  it("loads config from given directory", () => {
    writeFileSync(
      join(tmpDir, ".refdocs.json"),
      JSON.stringify({ paths: ["docs"], chunkMaxTokens: 500 })
    );
    const { config } = loadConfig(tmpDir);
    expect(config.paths).toEqual(["docs"]);
    expect(config.chunkMaxTokens).toBe(500);
    expect(config.chunkMinTokens).toBe(100); // default preserved
  });

  it("walks up directories to find config", () => {
    writeFileSync(
      join(tmpDir, ".refdocs.json"),
      JSON.stringify({ paths: ["custom-docs"] })
    );
    const subDir = join(tmpDir, "sub", "deep");
    mkdirSync(subDir, { recursive: true });
    const { config, configDir } = loadConfig(subDir);
    expect(config.paths).toEqual(["custom-docs"]);
    expect(configDir).toBe(tmpDir);
  });

  it("merges boostFields with defaults", () => {
    writeFileSync(
      join(tmpDir, ".refdocs.json"),
      JSON.stringify({ boostFields: { title: 5 } })
    );
    const { config } = loadConfig(tmpDir);
    expect(config.boostFields.title).toBe(5);
    expect(config.boostFields.headings).toBe(1.5);
    expect(config.boostFields.body).toBe(1);
  });

  it("throws on invalid config", () => {
    writeFileSync(
      join(tmpDir, ".refdocs.json"),
      JSON.stringify({ paths: "not-an-array" })
    );
    expect(() => loadConfig(tmpDir)).toThrow("Invalid .refdocs.json");
  });
});

describe("configExists", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when no config file exists", () => {
    expect(configExists(tmpDir)).toBe(false);
  });

  it("returns true when config file exists", () => {
    writeFileSync(join(tmpDir, CONFIG_FILENAME), "{}");
    expect(configExists(tmpDir)).toBe(true);
  });
});

describe("initConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .refdocs.json with full defaults", () => {
    initConfig(tmpDir);
    const configPath = join(tmpDir, CONFIG_FILENAME);
    expect(existsSync(configPath)).toBe(true);

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.paths).toEqual(["ref-docs"]);
    expect(written.index).toBe(".refdocs-index.json");
    expect(written.chunkMaxTokens).toBe(800);
    expect(written.chunkMinTokens).toBe(100);
    expect(written.boostFields).toEqual({ title: 2, headings: 1.5, body: 1 });
  });

  it("throws if config already exists", () => {
    writeFileSync(join(tmpDir, CONFIG_FILENAME), "{}");
    expect(() => initConfig(tmpDir)).toThrow(".refdocs.json already exists");
  });
});
