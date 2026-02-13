#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { loadConfig, configExists, initConfig, loadGlobalConfig, initGlobalConfig, getGlobalConfigDir } from "./config.js";
import { buildAndPersistIndex, loadPersistedIndex } from "./indexer.js";
import { searchAllIndexes } from "./search.js";
import type { IndexSource } from "./search.js";
import { addFromGitHub, addLocalPath, removePath, updateSources } from "./add.js";
import { loadEvalSuite, runEvalSuite } from "./eval.js";
import type { SearchResult } from "./types.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("refdocs")
  .description("Local CLI tool for indexing and searching markdown documentation")
  .version(version);

program
  .command("init")
  .description("Create a .refdocs.json config file with defaults")
  .option("-g, --global", "initialize global config at ~/.refdocs/")
  .action((opts: { global?: boolean }) => {
    try {
      if (opts.global) {
        initGlobalConfig();
        console.log(`Created global config at ${getGlobalConfigDir()}/.refdocs.json`);
      } else {
        initConfig(process.cwd());
        console.log("Created .refdocs.json with default configuration.");
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("index")
  .description("Index all markdown files in configured paths")
  .option("-g, --global", "index the global config")
  .option("--full", "force a full rebuild (skip incremental)")
  .action((opts: { global?: boolean; full?: boolean }) => {
    try {
      if (opts.global) {
        const globalResult = loadGlobalConfig();
        if (!globalResult) {
          console.error("No global config found. Run `refdocs init --global` first.");
          process.exit(1);
        }
        const summary = buildAndPersistIndex(globalResult.config, globalResult.configDir, { force: opts.full });
        printIndexSummary(summary, "[global] ");
      } else {
        const { config, configDir } = loadConfig();
        const summary = buildAndPersistIndex(config, configDir, { force: opts.full });
        printIndexSummary(summary, "");
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("search <query>")
  .description("Fuzzy search the index and return top chunks")
  .option("-n, --results <count>", "number of results (1-10)", (value: string) => {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 1 || n > 10) {
      throw new InvalidArgumentError(`Invalid value "${value}". Must be a number between 1 and 10.`);
    }
    return n;
  }, 3)
  .option("-f, --file <pattern>", "filter results to files matching glob")
  .option("--json", "output as JSON")
  .option("--raw", "output chunk body only, no metadata")
  .action((query: string, opts: { results: number; file?: string; json?: boolean; raw?: boolean }) => {
    try {
      const sources = resolveIndexSources();
      const results = searchAllIndexes(sources, query, {
        maxResults: opts.results,
        fileFilter: opts.file,
      });

      if (results.length === 0) {
        console.log("No results found.");
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else if (opts.raw) {
        for (const r of results) {
          console.log(r.body);
          console.log("");
        }
      } else {
        formatResults(results);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("eval <suite>")
  .description("Evaluate search relevance/token efficiency against an eval suite JSON file")
  .option("-n, --results <count>", "default results per query (1-20)", (value: string) => {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 1 || n > 20) {
      throw new InvalidArgumentError(`Invalid value "${value}". Must be a number between 1 and 20.`);
    }
    return n;
  })
  .option("--json", "output eval report as JSON")
  .action((suitePath: string, opts: { results?: number; json?: boolean }) => {
    try {
      const suite = loadEvalSuite(suitePath);
      const sources = resolveIndexSources();
      const report = runEvalSuite(sources, suite, {
        maxResults: opts.results,
      });

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        formatEvalReport(report);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List all indexed files and their chunk counts")
  .option("-g, --global", "list global indexed files")
  .action((opts: { global?: boolean }) => {
    try {
      let config, configDir;
      if (opts.global) {
        const globalResult = loadGlobalConfig();
        if (!globalResult) {
          console.error("No global config found. Run `refdocs init --global` first.");
          process.exit(1);
        }
        config = globalResult.config;
        configDir = globalResult.configDir;
      } else {
        ({ config, configDir } = loadConfig());
      }

      const indexPath = join(configDir, config.index);
      const { chunks } = loadPersistedIndex(indexPath, config);

      const byFile = new Map<string, number>();
      for (const chunk of chunks) {
        byFile.set(chunk.file, (byFile.get(chunk.file) || 0) + 1);
      }

      const label = opts.global ? "[global] " : "";
      for (const [file, count] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`${label}${file} (${count} chunk${count !== 1 ? "s" : ""})`);
      }
      console.log(`\n${byFile.size} files, ${chunks.length} chunks total`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("info <file>")
  .description("Show all chunks for a specific file")
  .option("-g, --global", "show info from global index")
  .action((file: string, opts: { global?: boolean }) => {
    try {
      let config, configDir;
      if (opts.global) {
        const globalResult = loadGlobalConfig();
        if (!globalResult) {
          console.error("No global config found. Run `refdocs init --global` first.");
          process.exit(1);
        }
        config = globalResult.config;
        configDir = globalResult.configDir;
      } else {
        ({ config, configDir } = loadConfig());
      }

      const indexPath = join(configDir, config.index);
      const { chunks } = loadPersistedIndex(indexPath, config);

      const fileChunks = chunks.filter((c) => c.file === file);
      if (fileChunks.length === 0) {
        console.error(`No chunks found for "${file}". Run \`refdocs list\` to see indexed files.`);
        process.exit(1);
      }

      console.log(`${file}: ${fileChunks.length} chunk${fileChunks.length !== 1 ? "s" : ""}\n`);
      for (const chunk of fileChunks) {
        console.log(`  [${chunk.startLine}-${chunk.endLine}] ${chunk.headings} (~${chunk.tokenEstimate} tokens)`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

interface AddOpts {
  path?: string;
  branch?: string;
  index: boolean;
  global?: boolean;
}

program
  .command("add <source>")
  .description("Add docs from a local path or GitHub URL")
  .option("--path <dir>", "override local storage directory")
  .option("--branch <branch>", "override branch detection from URL")
  .option("--no-index", "skip auto re-indexing after download")
  .option("-g, --global", "store docs in global ~/.refdocs/ directory")
  .action(async (source: string, opts: AddOpts) => {
    try {
      const isUrl = source.startsWith("http://") || source.startsWith("https://");

      if (opts.global && !isUrl) {
        console.error("The --global flag can only be used with URLs, not local paths.");
        process.exit(1);
      }

      let configDir: string;
      let config;

      if (opts.global) {
        initGlobalConfig();
        const globalResult = loadGlobalConfig();
        if (!globalResult) {
          console.error("Failed to initialize global config.");
          process.exit(1);
        }
        configDir = globalResult.configDir;
        config = globalResult.config;
      } else {
        const cwd = process.cwd();
        if (!configExists(cwd)) {
          initConfig(cwd);
          console.log("Initialized .refdocs.json with default configuration.");
        }
        ({ config, configDir } = loadConfig());
      }

      const label = opts.global ? "[global] " : "";

      if (isUrl) {
        const result = await addFromGitHub(
          source,
          { path: opts.path, branch: opts.branch },
          configDir,
          config,
        );

        console.log(`${label}Downloaded ${result.filesWritten} markdown files → ${result.localPath}/`);
        if (result.source.type === "github") {
          console.log(`Source: ${result.source.owner}/${result.source.repo} (${result.source.branch})`);
        }

        if (opts.index && result.filesWritten > 0) {
          reindex(opts.global, label);
        }
      } else {
        const result = addLocalPath(source, configDir, config);
        console.log(`Added ${result.localPath} to paths`);

        if (opts.index) {
          reindex(opts.global, label);
        }
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("update")
  .description("Re-pull all tracked sources and re-index")
  .option("--no-index", "skip auto re-indexing after update")
  .option("-g, --global", "update global sources")
  .action(async (opts: { index: boolean; global?: boolean }) => {
    try {
      let config, configDir;
      if (opts.global) {
        const globalResult = loadGlobalConfig();
        if (!globalResult) {
          console.error("No global config found. Run `refdocs init --global` first.");
          process.exit(1);
        }
        config = globalResult.config;
        configDir = globalResult.configDir;
      } else {
        ({ config, configDir } = loadConfig());
      }

      const token = process.env.GITHUB_TOKEN ?? undefined;
      const results = await updateSources(config, configDir, token);

      const label = opts.global ? "[global] " : "";
      for (const r of results) {
        const desc = formatSourceDescription(r.source);
        console.log(`${label}Updated ${desc} → ${r.filesWritten} files`);
      }

      const totalFiles = results.reduce((sum, r) => sum + r.filesWritten, 0);
      console.log(`\n${results.length} source${results.length !== 1 ? "s" : ""} updated (${totalFiles} files total)`);

      if (opts.index && totalFiles > 0) {
        reindex(opts.global, label);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("remove <path>")
  .description("Remove a path from the index configuration")
  .option("--no-index", "skip auto re-indexing after removal")
  .option("-g, --global", "remove from global config")
  .action((path: string, opts: { index: boolean; global?: boolean }) => {
    try {
      let config, configDir;
      if (opts.global) {
        const globalResult = loadGlobalConfig();
        if (!globalResult) {
          console.error("No global config found. Run `refdocs init --global` first.");
          process.exit(1);
        }
        config = globalResult.config;
        configDir = globalResult.configDir;
      } else {
        ({ config, configDir } = loadConfig());
      }

      const result = removePath(path, configDir, config);

      if (!result.removed) {
        console.error(`Path "${path}" not found in configured paths.`);
        process.exit(1);
      }

      const label = opts.global ? "[global] " : "";
      console.log(`${label}Removed ${path} from paths`);
      if (result.sourceRemoved) {
        console.log(`${label}Removed associated source`);
      }

      if (opts.index) {
        reindex(opts.global, label);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

import type { IndexSummary } from "./types.js";

function printIndexSummary(summary: IndexSummary, label: string) {
  console.log(`${label}Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
  if (summary.unchanged !== undefined) {
    console.log(`${label}(${summary.unchanged} unchanged, ${summary.changed} changed, ${summary.added} added, ${summary.removed} removed)`);
  }
  console.log(`Index size: ${(summary.indexSizeBytes / 1024).toFixed(1)} KB`);
  console.log(`Done in ${summary.elapsedMs}ms`);
}

function reindex(global: boolean | undefined, label: string) {
  if (global) {
    const freshGlobal = loadGlobalConfig();
    if (freshGlobal) {
      const summary = buildAndPersistIndex(freshGlobal.config, freshGlobal.configDir);
      printIndexSummary(summary, label);
    }
  } else {
    const { config: freshConfig, configDir: freshDir } = loadConfig();
    const summary = buildAndPersistIndex(freshConfig, freshDir);
    printIndexSummary(summary, "");
  }
}

import type { Source } from "./types.js";

function formatSourceDescription(source: Source): string {
  switch (source.type) {
    case "github":
      return `${source.owner}/${source.repo}`;
    case "file":
      return source.url;
  }
}

function resolveIndexSources(): IndexSource[] {
  const sources: IndexSource[] = [];

  try {
    const { config, configDir } = loadConfig();
    const indexPath = join(configDir, config.index);
    const { index, chunkMap } = loadPersistedIndex(indexPath, config);
    sources.push({ label: "", index, chunkMap });
  } catch {
    // Local index not available
  }

  const globalConfig = loadGlobalConfig();
  if (globalConfig) {
    const globalIndexPath = join(globalConfig.configDir, globalConfig.config.index);
    if (existsSync(globalIndexPath)) {
      try {
        const { index, chunkMap } = loadPersistedIndex(globalIndexPath, globalConfig.config);
        sources.push({ label: "[global] ", index, chunkMap });
      } catch {
        // Global index failed to load
      }
    }
  }

  return sources;
}

function formatResults(results: SearchResult[]) {
  results.forEach((r, i) => {
    console.log(`# [${i + 1}] ${r.file}:${r.lines[0]}-${r.lines[1]}`);
    console.log(`# ${r.headings.join(" > ")}`);
    console.log("");
    console.log(r.body);
    if (i < results.length - 1) {
      console.log("\n---\n");
    }
  });
}

function formatEvalReport(report: ReturnType<typeof runEvalSuite>) {
  console.log(`Eval suite: ${report.suite.name ?? "unnamed"} (${report.summary.totalCases} case${report.summary.totalCases !== 1 ? "s" : ""})`);
  if (report.suite.description) {
    console.log(report.suite.description);
  }
  console.log(`Results/query: ${report.maxResults}`);
  console.log("");
  console.log("Summary");
  console.log("Metric                          Baseline     Reranked");
  console.log(`Full coverage rate             ${formatPercent(report.summary.baseline.fullCoverageRate).padEnd(12)} ${formatPercent(report.summary.reranked.fullCoverageRate)}`);
  console.log(`Average coverage ratio         ${formatPercent(report.summary.baseline.averageCoverageRatio).padEnd(12)} ${formatPercent(report.summary.reranked.averageCoverageRatio)}`);
  console.log(`Avg tokens to first facet      ${formatNumber(report.summary.baseline.averageTokensToFirstFacet).padEnd(12)} ${formatNumber(report.summary.reranked.averageTokensToFirstFacet)}`);
  console.log(`Avg tokens to full coverage    ${formatNumber(report.summary.baseline.averageTokensToFullCoverage).padEnd(12)} ${formatNumber(report.summary.reranked.averageTokensToFullCoverage)}`);
  console.log(`Median tokens to full coverage ${formatNumber(report.summary.baseline.medianTokensToFullCoverage).padEnd(12)} ${formatNumber(report.summary.reranked.medianTokensToFullCoverage)}`);
  console.log("");
  console.log(`Verdict (reranked vs baseline): ${report.summary.wins} win / ${report.summary.ties} tie / ${report.summary.losses} loss`);
  console.log("");
  console.log("Per-case");
  for (const caseResult of report.cases) {
    const bCoverage = `${Math.round(caseResult.baseline.coverageRatio * 100)}%`;
    const rCoverage = `${Math.round(caseResult.reranked.coverageRatio * 100)}%`;
    const bTokens = formatNumber(caseResult.baseline.tokensToFullCoverage);
    const rTokens = formatNumber(caseResult.reranked.tokensToFullCoverage);
    console.log(
      `- ${caseResult.id}: ${caseResult.verdict} | coverage ${bCoverage} -> ${rCoverage} | tokens_to_full ${bTokens} -> ${rTokens}`
    );
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }
  return Math.round(value).toString();
}

program.parse();
