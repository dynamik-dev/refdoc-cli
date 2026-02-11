import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { RefdocsConfig } from "./types.js";

const CONFIG_FILENAME = ".refdocs.json";

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
        config: { ...DEFAULT_CONFIG, ...raw, boostFields: { ...DEFAULT_CONFIG.boostFields, ...raw.boostFields } },
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

  return errors;
}
