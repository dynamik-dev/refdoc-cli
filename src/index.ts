#!/usr/bin/env node

import { Command } from "commander";
import { join } from "node:path";
import { loadConfig, configExists, initConfig } from "./config.js";
import { buildIndex, loadPersistedIndex } from "./indexer.js";
import { search } from "./search.js";
import { addFromUrl, addLocalPath, removePath, updateSources } from "./add.js";
import type { SearchResult } from "./types.js";

const program = new Command();

program
  .name("refdocs")
  .description("Local CLI tool for indexing and searching markdown documentation")
  .version("0.3.0");

program
  .command("init")
  .description("Create a .refdocs.json config file with defaults")
  .action(() => {
    try {
      initConfig(process.cwd());
      console.log("Created .refdocs.json with default configuration.");
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("index")
  .description("Index all markdown files in configured paths")
  .action(() => {
    try {
      const { config, configDir } = loadConfig();
      const summary = buildIndex(config, configDir);
      console.log(`Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
      console.log(`Index size: ${(summary.indexSizeBytes / 1024).toFixed(1)} KB`);
      console.log(`Done in ${summary.elapsedMs}ms`);
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
      const { config, configDir } = loadConfig();
      const indexPath = join(configDir, config.index);
      const { index } = loadPersistedIndex(indexPath, config);

      const maxResults = Math.min(Math.max(1, parseInt(opts.results, 10) || 3), 10);
      const results = search(index, query, {
        maxResults,
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
  .command("list")
  .description("List all indexed files and their chunk counts")
  .action(() => {
    try {
      const { config, configDir } = loadConfig();
      const indexPath = join(configDir, config.index);
      const { chunks } = loadPersistedIndex(indexPath, config);

      const byFile = new Map<string, number>();
      for (const chunk of chunks) {
        byFile.set(chunk.file, (byFile.get(chunk.file) || 0) + 1);
      }

      for (const [file, count] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`${file} (${count} chunk${count !== 1 ? "s" : ""})`);
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
  .action((file: string) => {
    try {
      const { config, configDir } = loadConfig();
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

program
  .command("add <source>")
  .description("Add a local path or download markdown docs from a GitHub URL")
  .option("--path <dir>", "override local storage directory")
  .option("--branch <branch>", "override branch detection from URL")
  .option("--no-index", "skip auto re-indexing after download")
  .action(async (source: string, opts: { path?: string; branch?: string; index: boolean }) => {
    try {
      const cwd = process.cwd();
      if (!configExists(cwd)) {
        initConfig(cwd);
        console.log("Initialized .refdocs.json with default configuration.");
      }
      const { config, configDir } = loadConfig();
      const isUrl = source.startsWith("http://") || source.startsWith("https://");

      if (isUrl) {
        const result = await addFromUrl(
          source,
          { path: opts.path, branch: opts.branch },
          configDir,
          config,
        );

        console.log(`Downloaded ${result.filesWritten} markdown files → ${result.localPath}/`);
        console.log(`Source: ${result.source.owner}/${result.source.repo} (${result.source.branch})`);

        if (opts.index && result.filesWritten > 0) {
          const { config: freshConfig, configDir: freshDir } = loadConfig();
          const summary = buildIndex(freshConfig, freshDir);
          console.log(`Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
        }
      } else {
        const result = addLocalPath(source, configDir, config);
        console.log(`Added ${result.localPath} to paths`);

        if (opts.index) {
          const { config: freshConfig, configDir: freshDir } = loadConfig();
          const summary = buildIndex(freshConfig, freshDir);
          console.log(`Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
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
  .action(async (opts: { index: boolean }) => {
    try {
      const { config, configDir } = loadConfig();
      const token = process.env.GITHUB_TOKEN ?? undefined;
      const results = await updateSources(config, configDir, token);

      for (const r of results) {
        console.log(`Updated ${r.source.owner}/${r.source.repo} → ${r.filesWritten} files`);
      }

      const totalFiles = results.reduce((sum, r) => sum + r.filesWritten, 0);
      console.log(`\n${results.length} source${results.length !== 1 ? "s" : ""} updated (${totalFiles} files total)`);

      if (opts.index && totalFiles > 0) {
        const { config: freshConfig, configDir: freshDir } = loadConfig();
        const summary = buildIndex(freshConfig, freshDir);
        console.log(`Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
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
  .action((path: string, opts: { index: boolean }) => {
    try {
      const { config, configDir } = loadConfig();
      const result = removePath(path, configDir, config);

      if (!result.removed) {
        console.error(`Path "${path}" not found in configured paths.`);
        process.exit(1);
      }

      console.log(`Removed ${path} from paths`);
      if (result.sourceRemoved) {
        console.log(`Removed associated source`);
      }

      if (opts.index) {
        const { config: freshConfig, configDir: freshDir } = loadConfig();
        const summary = buildIndex(freshConfig, freshDir);
        console.log(`Indexed ${summary.filesIndexed} files → ${summary.chunksCreated} chunks`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

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
