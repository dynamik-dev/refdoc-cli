import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
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
      } else if (entry.endsWith(".md") || entry.endsWith(".txt")) {
        files.push(relative(baseDir, fullPath));
      }
    }
  }

  for (const dir of dirs) {
    walk(join(baseDir, dir));
  }

  return [...new Set(files)].sort();
}

export function hashFileContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashConfig(config: RefdocsConfig): string {
  const relevant = {
    chunkMaxTokens: config.chunkMaxTokens,
    chunkMinTokens: config.chunkMinTokens,
    boostFields: config.boostFields,
  };
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}

export interface BuildIndexResult {
  summary: IndexSummary;
  serialized: string;
}

export function buildIndex(config: RefdocsConfig, configDir: string): BuildIndexResult {
  const start = Date.now();

  const files = findMarkdownFiles(config.paths, configDir);
  const allChunks: Chunk[] = [];
  const fileHashes: Record<string, string> = {};

  for (const file of files) {
    const content = readFileSync(join(configDir, file), "utf-8");
    fileHashes[file] = hashFileContent(content);
    const chunks = chunkMarkdown(content, file, {
      maxTokens: config.chunkMaxTokens,
      minTokens: config.chunkMinTokens,
    });
    allChunks.push(...chunks);
  }

  const index = createSearchIndex(config);
  indexChunks(index, allChunks);
  const serialized = serializeIndex(index, allChunks, {
    fileHashes,
    configHash: hashConfig(config),
  });

  return {
    summary: {
      filesIndexed: files.length,
      chunksCreated: allChunks.length,
      indexSizeBytes: Buffer.byteLength(serialized, "utf-8"),
      elapsedMs: Date.now() - start,
    },
    serialized,
  };
}

function buildIncrementalIndex(
  config: RefdocsConfig,
  configDir: string,
  existingIndex: MiniSearch<Chunk>,
  existingChunks: Chunk[],
  oldFileHashes: Record<string, string>,
): BuildIndexResult {
  const start = Date.now();

  const files = findMarkdownFiles(config.paths, configDir);
  const currentFiles = new Set(files);
  const newFileHashes: Record<string, string> = {};

  // Hash all current files
  const fileContents = new Map<string, string>();
  for (const file of files) {
    const content = readFileSync(join(configDir, file), "utf-8");
    newFileHashes[file] = hashFileContent(content);
    fileContents.set(file, content);
  }

  // Classify files
  const unchangedFiles = new Set<string>();
  const changedFiles = new Set<string>();
  const addedFiles = new Set<string>();
  const deletedFiles = new Set<string>();

  for (const file of files) {
    if (!(file in oldFileHashes)) {
      addedFiles.add(file);
    } else if (oldFileHashes[file] !== newFileHashes[file]) {
      changedFiles.add(file);
    } else {
      unchangedFiles.add(file);
    }
  }

  for (const file of Object.keys(oldFileHashes)) {
    if (!currentFiles.has(file)) {
      deletedFiles.add(file);
    }
  }

  // Discard chunks for changed + deleted files
  const filesToRemove = new Set([...changedFiles, ...deletedFiles]);
  const idsToDiscard: string[] = [];
  const keptChunks: Chunk[] = [];

  for (const chunk of existingChunks) {
    if (filesToRemove.has(chunk.file)) {
      idsToDiscard.push(chunk.id);
    } else {
      keptChunks.push(chunk);
    }
  }

  if (idsToDiscard.length > 0) {
    existingIndex.discardAll(idsToDiscard);
  }

  // Chunk new + changed files
  const newChunks: Chunk[] = [];
  const filesToChunk = [...changedFiles, ...addedFiles];
  for (const file of filesToChunk) {
    const content = fileContents.get(file)!;
    const chunks = chunkMarkdown(content, file, {
      maxTokens: config.chunkMaxTokens,
      minTokens: config.chunkMinTokens,
    });
    newChunks.push(...chunks);
  }

  if (newChunks.length > 0) {
    existingIndex.addAll(newChunks);
  }

  const allChunks = [...keptChunks, ...newChunks];
  const serialized = serializeIndex(existingIndex, allChunks, {
    fileHashes: newFileHashes,
    configHash: hashConfig(config),
  });

  return {
    summary: {
      filesIndexed: files.length,
      chunksCreated: allChunks.length,
      indexSizeBytes: Buffer.byteLength(serialized, "utf-8"),
      elapsedMs: Date.now() - start,
      unchanged: unchangedFiles.size,
      added: addedFiles.size,
      changed: changedFiles.size,
      removed: deletedFiles.size,
    },
    serialized,
  };
}

export function buildAndPersistIndex(
  config: RefdocsConfig,
  configDir: string,
  options?: { force?: boolean },
): IndexSummary {
  const indexPath = join(configDir, config.index);
  const force = options?.force ?? false;

  // Try incremental build if not forced and index exists
  if (!force && existsSync(indexPath)) {
    try {
      const json = readFileSync(indexPath, "utf-8");
      const { index, chunks, fileHashes, configHash } = loadSearchIndex(json, config);

      // Config change means we need a full rebuild
      if (configHash === hashConfig(config)) {
        const { summary, serialized } = buildIncrementalIndex(
          config, configDir, index, chunks, fileHashes,
        );
        writeFileSync(indexPath, serialized, "utf-8");
        return summary;
      }
    } catch {
      // Version mismatch, corrupted index, etc. — fall through to full rebuild
    }
  }

  const { summary, serialized } = buildIndex(config, configDir);
  writeFileSync(indexPath, serialized, "utf-8");
  return summary;
}

export function loadPersistedIndex(
  indexPath: string,
  config: RefdocsConfig
): { index: MiniSearch<Chunk>; chunks: Chunk[]; chunkMap: Map<string, Chunk> } {
  if (!existsSync(indexPath)) {
    throw new Error("Index not found. Run `refdocs index` first.");
  }
  const json = readFileSync(indexPath, "utf-8");
  return loadSearchIndex(json, config);
}
