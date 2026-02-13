import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { loadConfig, validateConfig, configExists, initConfig, CONFIG_FILENAME, CONFIG_DIR_NAME } from "../src/config.js";

describe("validateConfig", () => {
  it("returns no errors for valid config", () => {
    expect(
      validateConfig({
        paths: ["docs"],
        manifest: "manifest.json",
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

  it("rejects non-string manifest", () => {
    const errors = validateConfig({ manifest: 123 });
    expect(errors).toContain('"manifest" must be a string');
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
    expect(config.paths).toEqual(["docs"]);
    expect(config.manifest).toBe("manifest.json");
    expect(configDir).toBe(join(tmpDir, CONFIG_DIR_NAME));
  });

  it("loads config from given directory", () => {
    mkdirSync(join(tmpDir, CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(
      join(tmpDir, CONFIG_DIR_NAME, CONFIG_FILENAME),
      JSON.stringify({ paths: ["my-docs"] })
    );
    const { config, configDir } = loadConfig(tmpDir);
    expect(config.paths).toEqual(["my-docs"]);
    expect(config.manifest).toBe("manifest.json"); // default preserved
    expect(configDir).toBe(join(tmpDir, CONFIG_DIR_NAME));
  });

  it("walks up directories to find config", () => {
    mkdirSync(join(tmpDir, CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(
      join(tmpDir, CONFIG_DIR_NAME, CONFIG_FILENAME),
      JSON.stringify({ paths: ["custom-docs"] })
    );
    const subDir = join(tmpDir, "sub", "deep");
    mkdirSync(subDir, { recursive: true });
    const { config, configDir } = loadConfig(subDir);
    expect(config.paths).toEqual(["custom-docs"]);
    expect(configDir).toBe(join(tmpDir, CONFIG_DIR_NAME));
  });

  it("throws on invalid config", () => {
    mkdirSync(join(tmpDir, CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(
      join(tmpDir, CONFIG_DIR_NAME, CONFIG_FILENAME),
      JSON.stringify({ paths: "not-an-array" })
    );
    expect(() => loadConfig(tmpDir)).toThrow(`Invalid ${CONFIG_DIR_NAME}/${CONFIG_FILENAME}`);
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
    mkdirSync(join(tmpDir, CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(join(tmpDir, CONFIG_DIR_NAME, CONFIG_FILENAME), "{}");
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

  it("creates .refdocs/config.json with full defaults", () => {
    initConfig(tmpDir);
    const configPath = join(tmpDir, CONFIG_DIR_NAME, CONFIG_FILENAME);
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(join(tmpDir, CONFIG_DIR_NAME))).toBe(true);

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.paths).toEqual(["docs"]);
    expect(written.manifest).toBe("manifest.json");
  });

  it("throws if config already exists", () => {
    mkdirSync(join(tmpDir, CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(join(tmpDir, CONFIG_DIR_NAME, CONFIG_FILENAME), "{}");
    expect(() => initConfig(tmpDir)).toThrow(`${CONFIG_DIR_NAME}/${CONFIG_FILENAME} already exists`);
  });
});
