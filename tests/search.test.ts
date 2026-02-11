import { describe, it, expect } from "vitest";
import {
  createSearchIndex,
  indexChunks,
  serializeIndex,
  loadIndex,
  search,
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
    const results = search(index, "authentication", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe("api.md");
    expect(results[0].body).toContain("JWT tokens");
  });

  it("respects maxResults", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const results = search(index, "api", { maxResults: 1 });
    expect(results).toHaveLength(1);
  });

  it("returns empty array for no matches", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const results = search(index, "xyznonexistent", { maxResults: 3 });
    expect(results).toHaveLength(0);
  });

  it("includes score, file, lines, headings, body in results", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const results = search(index, "rate limiting", { maxResults: 3 });
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
    // "Authentication" appears in title of api.md:0 and body of guide.md:1
    const results = search(index, "authentication", { maxResults: 4 });
    expect(results[0].file).toBe("api.md");
    expect(results[0].headings).toContain("Authentication");
  });

  it("supports fuzzy matching", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    // Misspelling
    const results = search(index, "authenication", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
  });

  it("supports prefix matching", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const results = search(index, "auth", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
  });

  it("filters by file glob", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const results = search(index, "authentication", {
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

    const { index: loaded, chunks } = loadIndex(json, testConfig);
    expect(chunks).toEqual(sampleChunks);

    const results = search(loaded, "authentication", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].body).toContain("JWT");
  });

  it("includes version and createdAt in serialized output", () => {
    const index = createSearchIndex(testConfig);
    indexChunks(index, sampleChunks);
    const json = serializeIndex(index, sampleChunks);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
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
