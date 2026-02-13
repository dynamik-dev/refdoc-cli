import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { estimateTokens } from "./chunker.js";
import { searchAllIndexes, searchAllIndexesBaseline } from "./search.js";
import type { IndexSource } from "./search.js";
import type { SearchResult } from "./types.js";

export interface EvalCase {
  id: string;
  query: string;
  facets: string[];
  maxResults?: number;
}

export interface EvalSuite {
  name?: string;
  description?: string;
  maxResults?: number;
  cases: EvalCase[];
}

interface RankingMetrics {
  fullCoverage: boolean;
  coverageRatio: number;
  coveredFacets: string[];
  rankToFirstFacet: number | null;
  rankToFullCoverage: number | null;
  tokensToFirstFacet: number | null;
  tokensToFullCoverage: number | null;
  tokensInspected: number;
  relevantResults: number;
}

export interface EvalCaseResult {
  id: string;
  query: string;
  facets: string[];
  baseline: RankingMetrics;
  reranked: RankingMetrics;
  verdict: "win" | "tie" | "loss";
}

interface AggregateMetrics {
  fullCoverageRate: number;
  averageCoverageRatio: number;
  averageTokensToFirstFacet: number | null;
  averageTokensToFullCoverage: number | null;
  medianTokensToFullCoverage: number | null;
}

export interface EvalSummary {
  totalCases: number;
  wins: number;
  ties: number;
  losses: number;
  baseline: AggregateMetrics;
  reranked: AggregateMetrics;
}

export interface EvalReport {
  suite: EvalSuite;
  maxResults: number;
  cases: EvalCaseResult[];
  summary: EvalSummary;
}

interface RawEvalCase {
  id?: unknown;
  query?: unknown;
  facets?: unknown;
  maxResults?: unknown;
}

interface RawEvalSuite {
  name?: unknown;
  description?: unknown;
  maxResults?: unknown;
  cases?: unknown;
}

export function loadEvalSuite(filePath: string): EvalSuite {
  const absolute = resolve(filePath);
  const rawText = readFileSync(absolute, "utf-8");
  const parsed = JSON.parse(rawText) as RawEvalSuite;
  return normalizeSuite(parsed, absolute);
}

export function runEvalSuite(
  sources: IndexSource[],
  suite: EvalSuite,
  options?: { maxResults?: number },
): EvalReport {
  const defaultMaxResults = options?.maxResults ?? suite.maxResults ?? 5;
  const caseResults: EvalCaseResult[] = [];

  for (const testCase of suite.cases) {
    const perCaseMax = testCase.maxResults ?? defaultMaxResults;
    const baselineResults = searchAllIndexesBaseline(sources, testCase.query, { maxResults: perCaseMax });
    const rerankedResults = searchAllIndexes(sources, testCase.query, { maxResults: perCaseMax });

    const baseline = scoreRanking(baselineResults, testCase.facets);
    const reranked = scoreRanking(rerankedResults, testCase.facets);
    const verdict = compareRankings(baseline, reranked);

    caseResults.push({
      id: testCase.id,
      query: testCase.query,
      facets: testCase.facets,
      baseline,
      reranked,
      verdict,
    });
  }

  return {
    suite,
    maxResults: defaultMaxResults,
    cases: caseResults,
    summary: summarize(caseResults),
  };
}

function normalizeSuite(raw: RawEvalSuite, source: string): EvalSuite {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid eval suite at ${source}: expected a JSON object.`);
  }

  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    throw new Error(`Invalid eval suite at ${source}: "cases" must be a non-empty array.`);
  }

  if (raw.maxResults !== undefined && (!Number.isInteger(raw.maxResults) || (raw.maxResults as number) <= 0)) {
    throw new Error(`Invalid eval suite at ${source}: "maxResults" must be a positive integer.`);
  }

  const normalizedCases = raw.cases.map((item, index) => normalizeCase(item as RawEvalCase, index, source));

  return {
    name: typeof raw.name === "string" ? raw.name : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    maxResults: typeof raw.maxResults === "number" ? raw.maxResults : undefined,
    cases: normalizedCases,
  };
}

function normalizeCase(raw: RawEvalCase, index: number, source: string): EvalCase {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid eval suite at ${source}: case ${index + 1} must be an object.`);
  }

  if (typeof raw.query !== "string" || raw.query.trim().length === 0) {
    throw new Error(`Invalid eval suite at ${source}: case ${index + 1} is missing a non-empty "query".`);
  }

  if (!Array.isArray(raw.facets) || raw.facets.length === 0 || !raw.facets.every((f) => typeof f === "string" && f.trim().length > 0)) {
    throw new Error(
      `Invalid eval suite at ${source}: case ${index + 1} requires a non-empty string array in "facets".`
    );
  }

  if (raw.maxResults !== undefined && (!Number.isInteger(raw.maxResults) || (raw.maxResults as number) <= 0)) {
    throw new Error(`Invalid eval suite at ${source}: case ${index + 1} has invalid "maxResults".`);
  }

  const normalizedId = typeof raw.id === "string" && raw.id.trim().length > 0
    ? raw.id
    : `case-${index + 1}`;

  return {
    id: normalizedId,
    query: raw.query,
    facets: raw.facets.map((facet) => facet.toLowerCase()),
    maxResults: typeof raw.maxResults === "number" ? raw.maxResults : undefined,
  };
}

function scoreRanking(results: SearchResult[], facets: string[]): RankingMetrics {
  const covered = new Set<string>();
  let tokensRunning = 0;
  let rankToFirstFacet: number | null = null;
  let rankToFullCoverage: number | null = null;
  let tokensToFirstFacet: number | null = null;
  let tokensToFullCoverage: number | null = null;
  let relevantResults = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const resultTokens = result.tokenEstimate ?? estimateTokens(result.body);
    tokensRunning += resultTokens;

    const haystack = `${result.file}\n${result.headings.join(" ")}\n${result.body}`.toLowerCase();
    let matchedAny = false;
    for (const facet of facets) {
      if (haystack.includes(facet)) {
        covered.add(facet);
        matchedAny = true;
      }
    }

    if (matchedAny) {
      relevantResults++;
      if (rankToFirstFacet === null) {
        rankToFirstFacet = i + 1;
        tokensToFirstFacet = tokensRunning;
      }
    }

    if (rankToFullCoverage === null && covered.size === facets.length) {
      rankToFullCoverage = i + 1;
      tokensToFullCoverage = tokensRunning;
    }
  }

  return {
    fullCoverage: covered.size === facets.length,
    coverageRatio: facets.length > 0 ? covered.size / facets.length : 0,
    coveredFacets: [...covered].sort(),
    rankToFirstFacet,
    rankToFullCoverage,
    tokensToFirstFacet,
    tokensToFullCoverage,
    tokensInspected: tokensRunning,
    relevantResults,
  };
}

function compareRankings(baseline: RankingMetrics, reranked: RankingMetrics): "win" | "tie" | "loss" {
  if (reranked.coverageRatio > baseline.coverageRatio) return "win";
  if (reranked.coverageRatio < baseline.coverageRatio) return "loss";

  const baselineTokens = baseline.tokensToFullCoverage ?? Number.POSITIVE_INFINITY;
  const rerankedTokens = reranked.tokensToFullCoverage ?? Number.POSITIVE_INFINITY;
  if (rerankedTokens < baselineTokens) return "win";
  if (rerankedTokens > baselineTokens) return "loss";

  const baselineFirst = baseline.tokensToFirstFacet ?? Number.POSITIVE_INFINITY;
  const rerankedFirst = reranked.tokensToFirstFacet ?? Number.POSITIVE_INFINITY;
  if (rerankedFirst < baselineFirst) return "win";
  if (rerankedFirst > baselineFirst) return "loss";

  return "tie";
}

function summarize(results: EvalCaseResult[]): EvalSummary {
  let wins = 0;
  let ties = 0;
  let losses = 0;
  for (const result of results) {
    if (result.verdict === "win") wins++;
    else if (result.verdict === "loss") losses++;
    else ties++;
  }

  return {
    totalCases: results.length,
    wins,
    ties,
    losses,
    baseline: aggregate(results.map((r) => r.baseline)),
    reranked: aggregate(results.map((r) => r.reranked)),
  };
}

function aggregate(metrics: RankingMetrics[]): AggregateMetrics {
  const total = metrics.length;
  const fullCoverageCount = metrics.filter((m) => m.fullCoverage).length;
  const coverageSum = metrics.reduce((sum, m) => sum + m.coverageRatio, 0);

  const firstFacetTokens = metrics
    .map((m) => m.tokensToFirstFacet)
    .filter((v): v is number => typeof v === "number");
  const fullCoverageTokens = metrics
    .map((m) => m.tokensToFullCoverage)
    .filter((v): v is number => typeof v === "number");

  return {
    fullCoverageRate: total > 0 ? fullCoverageCount / total : 0,
    averageCoverageRatio: total > 0 ? coverageSum / total : 0,
    averageTokensToFirstFacet: average(firstFacetTokens),
    averageTokensToFullCoverage: average(fullCoverageTokens),
    medianTokensToFullCoverage: median(fullCoverageTokens),
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

