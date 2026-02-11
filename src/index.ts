#!/usr/bin/env node

import { Command } from "commander";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig, configExists, initConfig, loadGlobalConfig, initGlobalConfig, getGlobalConfigDir } from "./config.js";
import { buildIndex, loadPersistedIndex } from "./indexer.js";
import { search, mergeSearchResults } from "./search.js";
import { addFromGitHub, addFromFileUrl, addFromCrawl, addLocalPath, removePath, updateSources } from "./add.js";
import { isGitHubUrl, isTextFileUrl } from "./crawl.js";
import type { SearchResult } from "./types.js";

const program = new Command();

program
  .name("refdocs")
  .description("Local CLI tool for indexing and searching markdown documentation")
  .version("0.5.1");

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
  .action((opts: { global?: boolean }) => {
    try {
      if (opts.global) {
        const globalResult = loadGlobalConfig();
        if (!globalResult) {
          console.error("No global config found. Run `refdocs init --global` first.");
          process.exit(1);
        }
        const summary = buildIndex(globalResult.config, globalResult.configDir);
        console.log(`[global] Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
        console.log(`Index size: ${(summary.indexSizeBytes / 1024).toFixed(1)} KB`);
        console.log(`Done in ${summary.elapsedMs}ms`);
      } else {
        const { config, configDir } = loadConfig();
        const summary = buildIndex(config, configDir);
        console.log(`Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
        console.log(`Index size: ${(summary.indexSizeBytes / 1024).toFixed(1)} KB`);
        console.log(`Done in ${summary.elapsedMs}ms`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("search <query>")
  .description("Fuzzy search the index and return top chunks")
  .option("-n, --results <count>", "number of results", "3")
  .option("-f, --file <pattern>", "filter results to files matching glob")
  .option("--json", "output as JSON")
  .option("--raw", "output chunk body only, no metadata")
  .action((query: string, opts: { results: string; file?: string; json?: boolean; raw?: boolean }) => {
    try {
      const maxResults = Math.min(Math.max(1, parseInt(opts.results, 10) || 3), 10);
      let localResults: SearchResult[] = [];
      let hasLocalIndex = false;
      let localError: Error | null = null;

      try {
        const { config, configDir } = loadConfig();
        const indexPath = join(configDir, config.index);
        const { index } = loadPersistedIndex(indexPath, config);
        hasLocalIndex = true;
        localResults = search(index, query, { maxResults, fileFilter: opts.file });
      } catch (err) {
        localError = err as Error;
      }

      let globalResults: SearchResult[] = [];
      let hasGlobalIndex = false;
      const globalConfig = loadGlobalConfig();
      if (globalConfig) {
        const globalIndexPath = join(globalConfig.configDir, globalConfig.config.index);
        if (existsSync(globalIndexPath)) {
          try {
            const { index: globalIndex } = loadPersistedIndex(globalIndexPath, globalConfig.config);
            hasGlobalIndex = true;
            globalResults = search(globalIndex, query, { maxResults, fileFilter: opts.file });
            globalResults = globalResults.map((r) => ({
              ...r,
              file: `[global] ${r.file}`,
            }));
          } catch {
            // Global index exists but failed to load, skip
          }
        }
      }

      if (!hasLocalIndex && !hasGlobalIndex) {
        throw localError ?? new Error("Index not found. Run `refdocs index` first.");
      }

      const results = mergeSearchResults(localResults, globalResults, maxResults);

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
  crawl?: boolean;
  maxPages?: string;
  depth?: string;
}

program
  .command("add <source>")
  .description("Add docs from a local path, GitHub URL, file URL, or crawled website")
  .option("--path <dir>", "override local storage directory")
  .option("--branch <branch>", "override branch detection from URL")
  .option("--no-index", "skip auto re-indexing after download")
  .option("-g, --global", "store docs in global ~/.refdocs/ directory")
  .option("--crawl", "crawl a website and convert pages to markdown")
  .option("--max-pages <count>", "max pages to crawl (default: 200)")
  .option("--depth <levels>", "max crawl depth (default: 3)")
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

      if (isUrl && opts.crawl) {
        // Crawl mode: spider the site and convert to markdown
        const maxPages = opts.maxPages ? parseInt(opts.maxPages, 10) : undefined;
        const depth = opts.depth ? parseInt(opts.depth, 10) : undefined;

        console.log(`Crawling ${source}...`);
        const result = await addFromCrawl(
          source,
          { path: opts.path, maxPages, depth },
          configDir,
          config,
        );

        console.log(`${label}Converted ${result.filesWritten} pages → ${result.localPath}/`);

        if (opts.index && result.filesWritten > 0) {
          reindex(opts.global, label);
        }
      } else if (isUrl && isGitHubUrl(source)) {
        // GitHub mode: download tarball
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
      } else if (isUrl) {
        // Single file URL mode
        const result = await addFromFileUrl(
          source,
          { path: opts.path },
          configDir,
          config,
        );

        console.log(`${label}Downloaded 1 file → ${result.localPath}`);

        if (opts.index && result.filesWritten > 0) {
          reindex(opts.global, label);
        }
      } else {
        // Local path mode
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

function reindex(global: boolean | undefined, label: string) {
  if (global) {
    const freshGlobal = loadGlobalConfig();
    if (freshGlobal) {
      const summary = buildIndex(freshGlobal.config, freshGlobal.configDir);
      console.log(`${label}Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
    }
  } else {
    const { config: freshConfig, configDir: freshDir } = loadConfig();
    const summary = buildIndex(freshConfig, freshDir);
    console.log(`Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
  }
}

import type { Source } from "./types.js";

function formatSourceDescription(source: Source): string {
  switch (source.type) {
    case "github":
      return `${source.owner}/${source.repo}`;
    case "file":
      return source.url;
    case "crawl":
      return source.url;
  }
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

program.parse();
