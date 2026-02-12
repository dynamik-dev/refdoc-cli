import { describe, it, expect } from "vitest";
import {
  createSearchIndex,
  indexChunks,
  serializeIndex,
  loadIndex,
  search,
  searchAllIndexes,
  buildChunkMap,
} from "../src/search.js";
import type { Chunk, RefdocsConfig } from "../src/types.js";

const testConfig: RefdocsConfig = {
  paths: ["docs"],
  index: ".refdocs-index.json",
  chunkMaxTokens: 800,
  chunkMinTokens: 100,
  boostFields: { title: 2, headings: 1.5, body: 1 },
};

function makeChunk(overrides: Partial<Chunk> & { id: string }): Chunk {
  return {
    file: "test.md",
    title: "Test",
    headings: "Test",
    body: "test body",
    startLine: 1,
    endLine: 10,
    tokenEstimate: 10,
    ...overrides,
  };
}

const sampleChunks: Chunk[] = [
  makeChunk({
    id: "api.md:0",
    file: "api.md",
    title: "Authentication",
    headings: "API > Authentication",
    body: "Use JWT tokens for authentication. Include the token in the Authorization header.",
    startLine: 1,
    endLine: 5,
  }),
  makeChunk({
    id: "api.md:1",
    file: "api.md",
    title: "Rate Limiting",
    headings: "API > Rate Limiting",
    body: "Rate limits are applied per API key. Default limit is 100 requests per minute.",
    startLine: 6,
    endLine: 10,
  }),
  makeChunk({
    id: "guide.md:0",
    file: "guide.md",
    title: "Getting Started",
    headings: "Getting Started",
    body: "Install the package and configure your environment. Run npm install to get started.",
    startLine: 1,
    endLine: 8,
  }),
  makeChunk({
    id: "guide.md:1",
    file: "guide.md",
    title: "Configuration",
    headings: "Getting Started > Configuration",
    body: "Create a .env file with your database URL and API key for authentication.",
    startLine: 9,
    endLine: 15,
  }),
];

describe("createSearchIndex and indexChunks", () => {
  it("creates an index and adds chunks without error", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    expect(index.documentCount).toBe(sampleChunks.length);
  });
});

describe("search", () => {
  it("finds relevant results for a query", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    const results = search(index, chunkMap, "authentication", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe("api.md");
    expect(results[0].body).toContain("JWT tokens");
  });

  it("respects maxResults", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    const results = search(index, chunkMap, "api", { maxResults: 1 });
    expect(results).toHaveLength(1);
  });

  it("returns empty array for no matches", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    const results = search(index, chunkMap, "xyznonexistent", { maxResults: 3 });
    expect(results).toHaveLength(0);
  });

  it("includes score, file, lines, headings, body in results", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    const results = search(index, chunkMap, "rate limiting", { maxResults: 3 });
    const result = results[0];
    expect(result.score).toBeGreaterThan(0);
    expect(result.file).toBe("api.md");
    expect(result.lines).toEqual([6, 10]);
    expect(result.headings).toEqual(["API", "Rate Limiting"]);
    expect(result.body).toContain("100 requests per minute");
  });

  it("boosts title matches over body matches", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    // "Authentication" appears in title of api.md:0 and body of guide.md:1
    const results = search(index, chunkMap, "authentication", { maxResults: 4 });
    expect(results[0].file).toBe("api.md");
    expect(results[0].headings).toContain("Authentication");
  });

  it("supports fuzzy matching", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    // Misspelling
    const results = search(index, chunkMap, "authenication", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
  });

  it("supports prefix matching", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    const results = search(index, chunkMap, "auth", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
  });

  it("filters by file glob", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    const results = search(index, chunkMap, "authentication", {
      maxResults: 10,
      fileFilter: "guide.*",
    });
    for (const r of results) {
      expect(r.file).toMatch(/^guide/);
    }
  });
});

describe("serialization", () => {
  it("round-trips through serialize and load", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const json = serializeIndex(index, sampleChunks);

    const { index: loaded, chunks, chunkMap } = loadIndex(json, testConfig);
    expect(chunks).toEqual(sampleChunks);

    const results = search(loaded, chunkMap, "authentication", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].body).toContain("JWT");
  });

  it("includes version and createdAt in serialized output", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const json = serializeIndex(index, sampleChunks);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(3);
    expect(parsed.createdAt).toBeDefined();
  });

  it("throws on version mismatch", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const json = serializeIndex(index, sampleChunks);
    const parsed = JSON.parse(json);
    parsed.version = 999;
    expect(() => loadIndex(JSON.stringify(parsed), testConfig)).toThrow(
      "Index version mismatch"
    );
  });
});

describe("searchAllIndexes", () => {
  it("throws when no sources are provided", () => {
    expect(() => searchAllIndexes([], "test", { maxResults: 3 })).toThrow(
      "Index not found"
    );
  });

  it("searches a single source with empty label", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    const results = searchAllIndexes(
      [{ label: "", index, chunkMap }],
      "authentication",
      { maxResults: 3 },
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe("api.md");
  });

  it("prefixes files with source label", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const chunkMap = buildChunkMap(sampleChunks);
    const results = searchAllIndexes(
      [{ label: "[global] ", index, chunkMap }],
      "authentication",
      { maxResults: 3 },
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toMatch(/^\[global\] /);
  });

  it("merges results from multiple sources sorted by score", () => {
    const localIndex = createSearchIndex(testConfig);
    const localChunks = [
      makeChunk({
        id: "local.md:0",
        file: "local.md",
        title: "Auth",
        headings: "Auth",
        body: "Local authentication with JWT tokens.",
        startLine: 1,
        endLine: 5,
      }),
    ];
    indexChunks(localIndex, localChunks);
    const localChunkMap = buildChunkMap(localChunks);

    const globalIndex = createSearchIndex(testConfig);
    const globalChunks = [
      makeChunk({
        id: "global.md:0",
        file: "global.md",
        title: "Auth",
        headings: "Auth",
        body: "Global authentication with OAuth2.",
        startLine: 1,
        endLine: 5,
      }),
    ];
    indexChunks(globalIndex, globalChunks);
    const globalChunkMap = buildChunkMap(globalChunks);

    const results = searchAllIndexes(
      [
        { label: "", index: localIndex, chunkMap: localChunkMap },
        { label: "[global] ", index: globalIndex, chunkMap: globalChunkMap },
      ],
      "authentication",
      { maxResults: 10 },
    );
    expect(results.length).toBe(2);
    const files = results.map((r) => r.file);
    expect(files.some((f) => f === "local.md")).toBe(true);
    expect(files.some((f) => f === "[global] global.md")).toBe(true);
  });

  it("respects maxResults across multiple sources", () => {
    const index1 = createSearchIndex(testConfig);
    indexChunks(index1, sampleChunks);
    const chunkMap1 = buildChunkMap(sampleChunks);

    const index2 = createSearchIndex(testConfig);
    const moreChunks = [
      makeChunk({
        id: "extra.md:0",
        file: "extra.md",
        title: "Auth Extra",
        headings: "Auth Extra",
        body: "Extra authentication content.",
        startLine: 1,
        endLine: 5,
      }),
    ];
    indexChunks(index2, moreChunks);
    const chunkMap2 = buildChunkMap(moreChunks);

    const results = searchAllIndexes(
      [
        { label: "", index: index1, chunkMap: chunkMap1 },
        { label: "[global] ", index: index2, chunkMap: chunkMap2 },
      ],
      "authentication",
      { maxResults: 2 },
    );
    expect(results).toHaveLength(2);
  });
});
