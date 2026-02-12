import MiniSearch from "minisearch";
import picomatch from "picomatch";
import type { Chunk, RefdocsConfig, SearchOptions, SearchResult } from "./types.js";

const INDEX_VERSION = 3;

interface SerializedIndex {
  version: number;
  createdAt: string;
  miniSearchIndex: string;
  chunks: Chunk[];
  fileHashes?: Record<string, string>;
  configHash?: string;
}

export function createSearchIndex(config: RefdocsConfig): MiniSearch<Chunk> {
  return new MiniSearch<Chunk>({
    fields: ["title", "headings", "body"],
    searchOptions: {
      boost: config.boostFields,
      fuzzy: 0.2,
      prefix: true,
    },
  });
}

export function buildChunkMap(chunks: Chunk[]): Map<string, Chunk> {
  const map = new Map<string, Chunk>();
  for (const chunk of chunks) {
    map.set(chunk.id, chunk);
  }
  return map;
}

export function indexChunks(index: MiniSearch<Chunk>, chunks: Chunk[]): void {
  index.addAll(chunks);
}

export function serializeIndex(
  index: MiniSearch<Chunk>,
  chunks: Chunk[],
  options?: { fileHashes?: Record<string, string>; configHash?: string },
): string {
  const data: SerializedIndex = {
    version: INDEX_VERSION,
    createdAt: new Date().toISOString(),
    miniSearchIndex: JSON.stringify(index),
    chunks,
    fileHashes: options?.fileHashes,
    configHash: options?.configHash,
  };
  return JSON.stringify(data);
}

export function loadIndex(
  json: string,
  config: RefdocsConfig
): {
  index: MiniSearch<Chunk>;
  chunks: Chunk[];
  chunkMap: Map<string, Chunk>;
  fileHashes: Record<string, string>;
  configHash: string;
} {
  const data: SerializedIndex = JSON.parse(json);

  if (data.version !== INDEX_VERSION) {
    throw new Error(
      `Index version mismatch (found v${data.version}, expected v${INDEX_VERSION}). Run \`refdocs index\` to rebuild.`
    );
  }

  const index = MiniSearch.loadJSON<Chunk>(data.miniSearchIndex, {
    fields: ["title", "headings", "body"],
    searchOptions: {
      boost: config.boostFields,
      fuzzy: 0.2,
      prefix: true,
    },
  });

  const chunkMap = buildChunkMap(data.chunks);
  return {
    index,
    chunks: data.chunks,
    chunkMap,
    fileHashes: data.fileHashes ?? {},
    configHash: data.configHash ?? "",
  };
}

export function search(
  index: MiniSearch<Chunk>,
  chunkMap: Map<string, Chunk>,
  query: string,
  options: SearchOptions
): SearchResult[] {
  let results = index.search(query);

  // Look up chunk data by ID from the chunk map
  const enriched = results.map((r) => {
    const chunk = chunkMap.get(r.id as string);
    return { searchResult: r, chunk };
  }).filter((e): e is { searchResult: typeof results[0]; chunk: Chunk } => e.chunk !== undefined);

  if (options.fileFilter) {
    const isMatch = picomatch(options.fileFilter);
    return enriched
      .filter((e) => isMatch(e.chunk.file))
      .slice(0, options.maxResults)
      .map((e) => ({
        score: e.searchResult.score,
        file: e.chunk.file,
        lines: [e.chunk.startLine, e.chunk.endLine] as [number, number],
        headings: e.chunk.headings.split(" > "),
        body: e.chunk.body,
      }));
  }

  return enriched.slice(0, options.maxResults).map((e) => ({
    score: e.searchResult.score,
    file: e.chunk.file,
    lines: [e.chunk.startLine, e.chunk.endLine] as [number, number],
    headings: e.chunk.headings.split(" > "),
    body: e.chunk.body,
  }));
}

export interface IndexSource {
  label: string;
  index: MiniSearch<Chunk>;
  chunkMap: Map<string, Chunk>;
}

export function searchAllIndexes(
  sources: IndexSource[],
  query: string,
  options: SearchOptions,
): SearchResult[] {
  if (sources.length === 0) {
    throw new Error("Index not found. Run `refdocs index` first.");
  }

  const allResults: SearchResult[] = [];
  for (const source of sources) {
    const results = search(source.index, source.chunkMap, query, options);
    if (source.label) {
      for (const r of results) {
        r.file = `${source.label}${r.file}`;
      }
    }
    allResults.push(...results);
  }

  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, options.maxResults);
}

export function mergeSearchResults(
  local: SearchResult[],
  global: SearchResult[],
  maxResults: number,
): SearchResult[] {
  const combined = [...local, ...global];
  combined.sort((a, b) => b.score - a.score);
  return combined.slice(0, maxResults);
}
