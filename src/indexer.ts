import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Chunk, RefdocsConfig, IndexSummary } from "./types.js";
import { chunkMarkdown } from "./chunker.js";
import { createSearchIndex, indexChunks, serializeIndex, loadIndex as loadSearchIndex } from "./search.js";
import type MiniSearch from "minisearch";

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
      } else if (entry.endsWith(".md")) {
        files.push(relative(baseDir, fullPath));
      }
    }
  }

  for (const dir of dirs) {
    walk(join(baseDir, dir));
  }

  return [...new Set(files)].sort();
}

export function buildIndex(config: RefdocsConfig, configDir: string): IndexSummary {
  const start = Date.now();

  const files = findMarkdownFiles(config.paths, configDir);
  const allChunks: Chunk[] = [];

  for (const file of files) {
    const content = readFileSync(join(configDir, file), "utf-8");
    const chunks = chunkMarkdown(content, file, {
      maxTokens: config.chunkMaxTokens,
      minTokens: config.chunkMinTokens,
    });
    allChunks.push(...chunks);
  }

  const index = createSearchIndex(config);
  indexChunks(index, allChunks);
  const serialized = serializeIndex(index, allChunks);

  const indexPath = join(configDir, config.index);
  writeFileSync(indexPath, serialized, "utf-8");

  return {
    filesIndexed: files.length,
    chunksCreated: allChunks.length,
    indexSizeBytes: Buffer.byteLength(serialized, "utf-8"),
    elapsedMs: Date.now() - start,
  };
}

export function loadPersistedIndex(
  indexPath: string,
  config: RefdocsConfig
): { index: MiniSearch<Chunk>; chunks: Chunk[] } {
  if (!existsSync(indexPath)) {
    throw new Error("Index not found. Run `refdocs index` first.");
  }
  const json = readFileSync(indexPath, "utf-8");
  return loadSearchIndex(json, config);
}
