import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { RefdocsConfig } from "./types.js";

export const CONFIG_DIR_NAME = ".refdocs";
export const CONFIG_FILENAME = "config.json";

const DEFAULT_CONFIG: RefdocsConfig = {
  paths: ["docs"],
  manifest: "manifest.json",
};

export interface ConfigResult {
  config: RefdocsConfig;
  configDir: string;
}

function mergeWithDefaults(raw: Record<string, unknown>): RefdocsConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
  } as RefdocsConfig;
}

export function loadConfig(cwd?: string): ConfigResult {
  const startDir = resolve(cwd ?? process.cwd());
  let dir = startDir;

  while (true) {
    const configDir = join(dir, CONFIG_DIR_NAME);
    const configPath = join(configDir, CONFIG_FILENAME);
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      const errors = validateConfig(raw);
      if (errors.length > 0) {
        throw new Error(
          `Invalid ${CONFIG_DIR_NAME}/${CONFIG_FILENAME}: ${errors.join("; ")}`
        );
      }
      return {
        config: mergeWithDefaults(raw),
        configDir,
      };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { config: DEFAULT_CONFIG, configDir: join(startDir, CONFIG_DIR_NAME) };
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

  if (obj.manifest !== undefined && typeof obj.manifest !== "string") {
    errors.push('"manifest" must be a string');
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

export function configExists(projectDir: string): boolean {
  return existsSync(join(projectDir, CONFIG_DIR_NAME, CONFIG_FILENAME));
}

export function initConfig(projectDir: string): void {
  const configDir = join(projectDir, CONFIG_DIR_NAME);
  const configPath = join(configDir, CONFIG_FILENAME);
  if (existsSync(configPath)) {
    throw new Error(`${CONFIG_DIR_NAME}/${CONFIG_FILENAME} already exists in ${projectDir}`);
  }
  mkdirSync(configDir, { recursive: true });
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
