import MiniSearch from "minisearch";
import picomatch from "picomatch";
import type { Chunk, RefdocsConfig, SearchOptions, SearchResult } from "./types.js";

const INDEX_VERSION = 3;
const RERANK_POOL_MULTIPLIER = 6;
const RERANK_POOL_MIN = 20;
const DEFAULT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

interface EnrichedResult {
  searchResult: { id: string; score: number };
  chunk: Chunk;
}

interface QuerySignals {
  facets: string[];
  symbols: string[];
}

interface Candidate {
  chunk: Chunk;
  result: SearchResult;
  staticRelevance: number;
  matchedFacets: Set<string>;
  matchedSymbols: Set<string>;
  signatureTokens: Set<string>;
}

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
  const poolSize = Math.max(options.maxResults * RERANK_POOL_MULTIPLIER, RERANK_POOL_MIN);
  const enriched = searchEnriched(index, chunkMap, query, options.fileFilter);
  if (enriched.length === 0) {
    return [];
  }

  const candidates = buildCandidates(enriched.slice(0, poolSize), query);
  const reranked = rerankCandidates(candidates, options.maxResults, query);
  return reranked.map((c) => ({ ...c.result, score: c.result.score }));
}

export function searchBaseline(
  index: MiniSearch<Chunk>,
  chunkMap: Map<string, Chunk>,
  query: string,
  options: SearchOptions
): SearchResult[] {
  const enriched = searchEnriched(index, chunkMap, query, options.fileFilter);
  return enriched.slice(0, options.maxResults).map(toSearchResult);
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
  return searchAllIndexesWith(sources, query, options, search);
}

export function searchAllIndexesBaseline(
  sources: IndexSource[],
  query: string,
  options: SearchOptions,
): SearchResult[] {
  return searchAllIndexesWith(sources, query, options, searchBaseline);
}

type SearchFn = (
  index: MiniSearch<Chunk>,
  chunkMap: Map<string, Chunk>,
  query: string,
  options: SearchOptions,
) => SearchResult[];

function searchAllIndexesWith(
  sources: IndexSource[],
  query: string,
  options: SearchOptions,
  searchFn: SearchFn,
): SearchResult[] {
  if (sources.length === 0) {
    throw new Error("Index not found. Run `refdocs index` first.");
  }

  const allResults: SearchResult[] = [];
  for (const source of sources) {
    const results = searchFn(source.index, source.chunkMap, query, options);
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

function searchEnriched(
  index: MiniSearch<Chunk>,
  chunkMap: Map<string, Chunk>,
  query: string,
  fileFilter?: string,
): EnrichedResult[] {
  const results = index.search(query);
  const enriched = results
    .map((r) => {
      const chunk = chunkMap.get(r.id as string);
      if (!chunk) return null;
      return { searchResult: { id: r.id as string, score: r.score }, chunk };
    })
    .filter((e): e is EnrichedResult => e !== null);

  if (!fileFilter) return enriched;
  const isMatch = picomatch(fileFilter);
  return enriched.filter((e) => isMatch(e.chunk.file));
}

function toSearchResult(entry: EnrichedResult): SearchResult {
  return {
    score: entry.searchResult.score,
    file: entry.chunk.file,
    lines: [entry.chunk.startLine, entry.chunk.endLine] as [number, number],
    headings: entry.chunk.headings.split(" > "),
    body: entry.chunk.body,
    tokenEstimate: entry.chunk.tokenEstimate,
  };
}

function normalizeText(text: string): string {
  return text.toLowerCase();
}

function tokenizeWords(text: string): string[] {
  return normalizeText(text).split(/[^a-z0-9_./[\]():-]+/g).filter(Boolean);
}

function extractSymbols(query: string): string[] {
  const raw = query.match(/[A-Za-z0-9_./[\]():-]{3,}/g) ?? [];
  const symbols = new Set<string>();
  for (const token of raw) {
    const hasSeparator = /[._/:[\]():-]/.test(token);
    const hasCamelCase = /[a-z][A-Z]/.test(token);
    if (hasSeparator || hasCamelCase) {
      symbols.add(token.toLowerCase());
    }
  }
  return [...symbols];
}

function buildQuerySignals(query: string): QuerySignals {
  const words = tokenizeWords(query);
  const facets = [...new Set(
    words.filter((word) => word.length >= 3 && !DEFAULT_STOP_WORDS.has(word))
  )];
  return {
    facets: facets.slice(0, 16),
    symbols: extractSymbols(query).slice(0, 12),
  };
}

function buildCandidates(enriched: EnrichedResult[], query: string): Candidate[] {
  const signals = buildQuerySignals(query);
  const maxBase = Math.max(...enriched.map((e) => e.searchResult.score), 1);

  return enriched.map((entry) => {
    const result = toSearchResult(entry);
    const text = normalizeText(`${entry.chunk.file}\n${entry.chunk.headings}\n${entry.chunk.title}\n${entry.chunk.body}`);
    const facetHits = new Set(signals.facets.filter((facet) => text.includes(facet)));
    const symbolHits = new Set(signals.symbols.filter((symbol) => text.includes(symbol)));
    const normalizedBaseScore = entry.searchResult.score / maxBase;
    const facetCoverage = signals.facets.length > 0 ? facetHits.size / signals.facets.length : 0;
    const symbolCoverage = signals.symbols.length > 0 ? symbolHits.size / signals.symbols.length : 0;
    const tokenPenalty = Math.min(1, (entry.chunk.tokenEstimate || 0) / 500);
    const staticRelevance = (
      normalizedBaseScore * 0.66
      + facetCoverage * 0.2
      + symbolCoverage * 0.14
      - tokenPenalty * 0.08
    );

    return {
      chunk: entry.chunk,
      result,
      staticRelevance,
      matchedFacets: facetHits,
      matchedSymbols: symbolHits,
      signatureTokens: buildSignatureTokenSet(entry.chunk),
    };
  });
}

function rerankCandidates(candidates: Candidate[], maxResults: number, query: string): Candidate[] {
  if (candidates.length <= 1) return candidates.slice(0, maxResults);

  const signals = buildQuerySignals(query);
  if (signals.facets.length === 0 && signals.symbols.length === 0) {
    return candidates.slice(0, maxResults);
  }

  const remaining = [...candidates];
  const selected: Candidate[] = [];
  const coveredFacets = new Set<string>();
  const coveredSymbols = new Set<string>();

  while (selected.length < maxResults && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];

      const newFacetHits = countNewHits(candidate.matchedFacets, coveredFacets);
      const newSymbolHits = countNewHits(candidate.matchedSymbols, coveredSymbols);
      const facetGain = signals.facets.length > 0 ? newFacetHits / signals.facets.length : 0;
      const symbolGain = signals.symbols.length > 0 ? newSymbolHits / signals.symbols.length : 0;
      const overlapPenalty = maxSimilarity(candidate, selected) * 0.22;
      const sameFilePenalty = selected.some((s) => s.chunk.file === candidate.chunk.file) ? 0.08 : 0;

      const marginalHits = newFacetHits + (newSymbolHits * 1.5);
      const tokenEfficiency = Math.min(1, (marginalHits * 80) / Math.max(80, candidate.chunk.tokenEstimate || 1));

      const score = (
        candidate.staticRelevance
        + facetGain * 0.5
        + symbolGain * 0.35
        + tokenEfficiency * 0.18
        - overlapPenalty
        - sameFilePenalty
      );

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const [best] = remaining.splice(bestIndex, 1);
    selected.push({
      ...best,
      result: {
        ...best.result,
        score: bestScore,
      },
    });
    for (const facet of best.matchedFacets) coveredFacets.add(facet);
    for (const symbol of best.matchedSymbols) coveredSymbols.add(symbol);
  }

  return selected;
}

function countNewHits(values: Set<string>, covered: Set<string>): number {
  let count = 0;
  for (const value of values) {
    if (!covered.has(value)) count++;
  }
  return count;
}

function buildSignatureTokenSet(chunk: Chunk): Set<string> {
  const signature = tokenizeWords(`${chunk.file} ${chunk.title} ${chunk.headings}`);
  const set = new Set<string>();
  for (const token of signature) {
    if (token.length >= 3 && !DEFAULT_STOP_WORDS.has(token)) {
      set.add(token);
    }
    if (set.size >= 32) break;
  }
  return set;
}

function maxSimilarity(candidate: Candidate, selected: Candidate[]): number {
  if (selected.length === 0) return 0;
  let max = 0;
  for (const prior of selected) {
    const overlap = jaccard(candidate.signatureTokens, prior.signatureTokens);
    if (overlap > max) max = overlap;
  }
  return max;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
