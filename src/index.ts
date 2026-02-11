#!/usr/bin/env node

import { Command } from "commander";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { buildIndex, loadPersistedIndex } from "./indexer.js";
import { search } from "./search.js";
import type { SearchResult } from "./types.js";

const program = new Command();

program
  .name("refdocs")
  .description("Local CLI tool for indexing and searching markdown documentation")
  .version("0.1.0");

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
