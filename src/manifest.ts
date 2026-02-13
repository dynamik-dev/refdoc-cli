import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Manifest, ManifestEntry, RefdocsConfig } from "./types.js";

export function findMarkdownFiles(dirs: string[], baseDir: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".md") || entry.endsWith(".mdx") || entry.endsWith(".txt")) {
        files.push(relative(baseDir, fullPath));
      }
    }
  }

  for (const dir of dirs) {
    walk(join(baseDir, dir));
  }

  return [...new Set(files)].sort();
}

export function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^#{1,3}\s+(.+)/);
    if (match) {
      headings.push(match[1].trim());
    }
  }
  return headings;
}

export function extractSummary(content: string): string {
  // Try frontmatter description first
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const descMatch = fmMatch[1].match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) {
      return descMatch[1].trim();
    }
  }

  // Fall back to first non-empty, non-heading paragraph
  const lines = content.split("\n");
  let inFrontmatter = false;
  for (const line of lines) {
    if (line.trim() === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    // Return first meaningful line, truncated if long
    return trimmed.length > 200 ? trimmed.slice(0, 200) + "..." : trimmed;
  }

  return "";
}

export function buildManifestEntry(file: string, content: string): ManifestEntry {
  return {
    file,
    headings: extractHeadings(content),
    lines: content.split("\n").length,
    summary: extractSummary(content),
  };
}

export function buildManifest(config: RefdocsConfig, configDir: string): Manifest {
  const files = findMarkdownFiles(config.paths, configDir);
  const entries: ManifestEntry[] = [];

  for (const file of files) {
    const content = readFileSync(join(configDir, file), "utf-8");
    entries.push(buildManifestEntry(file, content));
  }

  return {
    generated: new Date().toISOString(),
    sources: (config.sources ?? []).length,
    files: entries.length,
    entries,
  };
}

export function buildAndPersistManifest(config: RefdocsConfig, configDir: string): Manifest {
  const manifest = buildManifest(config, configDir);
  const manifestPath = join(configDir, config.manifest);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return manifest;
}

export function loadManifest(manifestPath: string): Manifest {
  if (!existsSync(manifestPath)) {
    throw new Error("Manifest not found. Run `refdocs manifest` first.");
  }
  return JSON.parse(readFileSync(manifestPath, "utf-8"));
}
