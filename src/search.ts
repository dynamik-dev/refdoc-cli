import MiniSearch from "minisearch";
import picomatch from "picomatch";
import type { Chunk, RefdocsConfig, SearchOptions, SearchResult } from "./types.js";

const INDEX_VERSION = 1;

interface SerializedIndex {
  version: number;
  createdAt: string;
  miniSearchIndex: string;
  chunks: Chunk[];
}

export function createSearchIndex(config: RefdocsConfig): MiniSearch<Chunk> {
  return new MiniSearch<Chunk>({
    fields: ["title", "headings", "body"],
    storeFields: ["id", "file", "title", "headings", "body", "startLine", "endLine", "tokenEstimate"],
    searchOptions: {
      boost: config.boostFields,
      fuzzy: 0.2,
      prefix: true,
    },
  });
}

export function indexChunks(index: MiniSearch<Chunk>, chunks: Chunk[]): void {
  index.addAll(chunks);
}

export function serializeIndex(index: MiniSearch<Chunk>, chunks: Chunk[]): string {
  const data: SerializedIndex = {
    version: INDEX_VERSION,
    createdAt: new Date().toISOString(),
    miniSearchIndex: JSON.stringify(index),
    chunks,
  };
  return JSON.stringify(data);
}

export function loadIndex(
  json: string,
  config: RefdocsConfig
): { index: MiniSearch<Chunk>; chunks: Chunk[] } {
  const data: SerializedIndex = JSON.parse(json);

  if (data.version !== INDEX_VERSION) {
    throw new Error(
      `Index version mismatch (found v${data.version}, expected v${INDEX_VERSION}). Run \`refdocs index\` to rebuild.`
    );
  }

  const index = MiniSearch.loadJSON<Chunk>(data.miniSearchIndex, {
    fields: ["title", "headings", "body"],
    storeFields: ["id", "file", "title", "headings", "body", "startLine", "endLine", "tokenEstimate"],
    searchOptions: {
      boost: config.boostFields,
      fuzzy: 0.2,
      prefix: true,
    },
  });

  return { index, chunks: data.chunks };
}

export function search(
  index: MiniSearch<Chunk>,
  query: string,
  options: SearchOptions
): SearchResult[] {
  let results = index.search(query);

  if (options.fileFilter) {
    const isMatch = picomatch(options.fileFilter);
    results = results.filter((r) => {
      const file = (r as unknown as { file: string }).file;
      return isMatch(file);
    });
  }

  return results.slice(0, options.maxResults).map((r) => {
    const stored = r as unknown as Chunk;
    return {
      score: r.score,
      file: stored.file,
      lines: [stored.startLine, stored.endLine] as [number, number],
      headings: stored.headings.split(" > "),
      body: stored.body,
    };
  });
}
