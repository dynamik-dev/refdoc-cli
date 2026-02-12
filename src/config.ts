import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { RefdocsConfig, Source } from "./types.js";

export const CONFIG_FILENAME = ".refdocs.json";

const DEFAULT_CONFIG: RefdocsConfig = {
  paths: ["ref-docs"],
  index: ".refdocs-index.json",
  chunkMaxTokens: 800,
  chunkMinTokens: 100,
  boostFields: {
    title: 2,
    headings: 1.5,
    body: 1,
  },
};

export interface ConfigResult {
  config: RefdocsConfig;
  configDir: string;
}

function mergeWithDefaults(raw: Record<string, unknown>): RefdocsConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    boostFields: { ...DEFAULT_CONFIG.boostFields, ...(raw.boostFields as Partial<RefdocsConfig["boostFields"]>) },
  } as RefdocsConfig;
}

export function loadConfig(cwd?: string): ConfigResult {
  const startDir = resolve(cwd ?? process.cwd());
  let dir = startDir;

  while (true) {
    const configPath = join(dir, CONFIG_FILENAME);
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      const errors = validateConfig(raw);
      if (errors.length > 0) {
        throw new Error(
          `Invalid ${CONFIG_FILENAME}: ${errors.join("; ")}`
        );
      }
      return {
        config: mergeWithDefaults(raw),
        configDir: dir,
      };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { config: DEFAULT_CONFIG, configDir: startDir };
}

export function validateConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return ["Config must be a JSON object"];
  }

  const obj = raw as Record<string, unknown>;

  if (obj.paths !== undefined) {
    if (!Array.isArray(obj.paths) || !obj.paths.every((p) => typeof p === "string")) {
      errors.push('"paths" must be an array of strings');
    }
  }

  if (obj.index !== undefined && typeof obj.index !== "string") {
    errors.push('"index" must be a string');
  }

  if (obj.chunkMaxTokens !== undefined) {
    if (typeof obj.chunkMaxTokens !== "number" || obj.chunkMaxTokens <= 0) {
      errors.push('"chunkMaxTokens" must be a positive number');
    }
  }

  if (obj.chunkMinTokens !== undefined) {
    if (typeof obj.chunkMinTokens !== "number" || obj.chunkMinTokens <= 0) {
      errors.push('"chunkMinTokens" must be a positive number');
    }
  }

  if (obj.boostFields !== undefined) {
    if (typeof obj.boostFields !== "object" || obj.boostFields === null || Array.isArray(obj.boostFields)) {
      errors.push('"boostFields" must be an object');
    } else {
      const bf = obj.boostFields as Record<string, unknown>;
      for (const key of ["title", "headings", "body"]) {
        if (bf[key] !== undefined && typeof bf[key] !== "number") {
          errors.push(`"boostFields.${key}" must be a number`);
        }
      }
    }
  }

  if (obj.sources !== undefined) {
    if (!Array.isArray(obj.sources)) {
      errors.push('"sources" must be an array');
    } else {
      for (let i = 0; i < obj.sources.length; i++) {
        const s = obj.sources[i] as Record<string, unknown>;
        if (typeof s !== "object" || s === null || Array.isArray(s)) {
          errors.push(`"sources[${i}]" must be an object`);
        }
      }
    }
  }

  return errors;
}

export function configExists(configDir: string): boolean {
  return existsSync(join(configDir, CONFIG_FILENAME));
}

export function initConfig(configDir: string): void {
  const configPath = join(configDir, CONFIG_FILENAME);
  if (existsSync(configPath)) {
    throw new Error(`${CONFIG_FILENAME} already exists in ${configDir}`);
  }
  writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
}

export function saveConfig(config: Partial<RefdocsConfig>, configDir: string): void {
  const configPath = join(configDir, CONFIG_FILENAME);
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    existing = JSON.parse(readFileSync(configPath, "utf-8"));
  }
  const merged = { ...existing, ...config };
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

export function getGlobalConfigDir(globalDir?: string): string {
  return globalDir ?? join(homedir(), ".refdocs");
}

export function initGlobalConfig(globalDir?: string): void {
  const dir = getGlobalConfigDir(globalDir);
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, CONFIG_FILENAME);
  if (existsSync(configPath)) return;
  const globalDefault: RefdocsConfig = {
    ...DEFAULT_CONFIG,
    paths: ["docs"],
  };
  writeFileSync(configPath, JSON.stringify(globalDefault, null, 2) + "\n", "utf-8");
}

export function loadGlobalConfig(globalDir?: string): ConfigResult | null {
  const dir = getGlobalConfigDir(globalDir);
  const configPath = join(dir, CONFIG_FILENAME);
  if (!existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const errors = validateConfig(raw);
    if (errors.length > 0) return null;
    return {
      config: mergeWithDefaults(raw),
      configDir: dir,
    };
  } catch {
    return null;
  }
}
