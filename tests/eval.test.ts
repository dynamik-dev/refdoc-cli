import { describe, it, expect } from "vitest";
import { runEvalSuite } from "../src/eval.js";
import {
  createSearchIndex,
  indexChunks,
  buildChunkMap,
  search,
  searchBaseline,
} from "../src/search.js";
import type { Chunk, RefdocsConfig } from "../src/types.js";

const config: RefdocsConfig = {
  paths: ["docs"],
  index: ".refdocs-index.json",
  chunkMaxTokens: 800,
  chunkMinTokens: 100,
  boostFields: { title: 2, headings: 1.5, body: 1 },
};

function makeChunk(overrides: Partial<Chunk> & { id: string }): Chunk {
  return {
    id: overrides.id,
    file: "docs/astro.mdx",
    title: "Chunk",
    headings: "Guide > Chunk",
    body: "placeholder",
    startLine: 1,
    endLine: 10,
    tokenEstimate: 120,
    ...overrides,
  };
}

describe("eval harness + reranker", () => {
  it("improves tokens-to-full-coverage on multi-facet queries", () => {
    const chunks: Chunk[] = [
      makeChunk({
        id: "schema-1",
        file: "docs/schema-a.mdx",
        title: "Schema setup",
        headings: "Content Collections > Schema",
        tokenEstimate: 330,
        body: [
          "In src/content.config.ts define a schema for tags.",
          "Use z.array(z.string()) for tags in the schema.",
          "The schema in src/content.config.ts can include title and tags.",
          "z.array(z.string()) is used again in this schema example.",
        ].join(" "),
      }),
      makeChunk({
        id: "schema-2",
        file: "docs/schema-b.mdx",
        title: "Schema defaults",
        headings: "Content Collections > Schema Defaults",
        tokenEstimate: 310,
        body: [
          "Another src/content.config.ts schema example for tags.",
          "The tags field is z.array(z.string()) with defaults.",
          "This section focuses on schema definitions and tags.",
        ].join(" "),
      }),
      makeChunk({
        id: "schema-3",
        file: "docs/schema-c.mdx",
        title: "Schema deep dive",
        headings: "Content Collections > Schema Deep Dive",
        tokenEstimate: 295,
        body: [
          "Schema guidance in src/content.config.ts for tags.",
          "Use z.array(z.string()) and keep schema strict.",
          "More schema discussion for tags in frontmatter.",
        ].join(" "),
      }),
      makeChunk({
        id: "filter-1",
        file: "docs/filtering.mdx",
        title: "Tag filtering",
        headings: "Querying > Filtering",
        tokenEstimate: 95,
        body: [
          "Use getCollection('blog', ({ data }) => data.tags.includes(tag)).",
          "This shows filtering by tags at query time.",
        ].join(" "),
      }),
      makeChunk({
        id: "snippet-1",
        file: "docs/snippet.mdx",
        title: "Minimal snippet",
        headings: "Recipe > Tags Page",
        tokenEstimate: 110,
        body: [
          "Minimal implementation snippet with getCollection and tags.includes(tag).",
          "Include this in src/pages/blog/tags/[tag].astro.",
        ].join(" "),
      }),
    ];

    const index = createSearchIndex(config);
    indexChunks(index, chunks);
    const chunkMap = buildChunkMap(chunks);

    const query = "src/content.config.ts schema tags z.array(z.string()) getCollection tags.includes";
    const baseline = searchBaseline(index, chunkMap, query, { maxResults: 4 });
    const reranked = search(index, chunkMap, query, { maxResults: 4 });

    const sources = [{ label: "", index, chunkMap }];
    const report = runEvalSuite(sources, {
      name: "synthetic-multi-facet",
      cases: [
        {
          id: "astro-tags",
          query,
          facets: [
            "src/content.config.ts",
            "z.array(z.string())",
            "getcollection",
            "tags.includes",
          ],
        },
      ],
    }, {
      maxResults: 4,
    });

    expect(baseline).toHaveLength(4);
    expect(reranked).toHaveLength(4);
    expect(report.summary.totalCases).toBe(1);
    expect(report.summary.wins).toBe(1);

    const caseResult = report.cases[0];
    expect(caseResult.baseline.tokensToFullCoverage).not.toBeNull();
    expect(caseResult.reranked.tokensToFullCoverage).not.toBeNull();
    expect(caseResult.reranked.tokensToFullCoverage!).toBeLessThan(caseResult.baseline.tokensToFullCoverage!);
    expect(caseResult.reranked.rankToFullCoverage!).toBeLessThan(caseResult.baseline.rankToFullCoverage!);
  });
});

