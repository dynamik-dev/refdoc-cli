#!/usr/bin/env node

import { Command } from "commander";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { loadConfig, configExists, initConfig, CONFIG_DIR_NAME, CONFIG_FILENAME } from "./config.js";
import { buildAndPersistManifest, findMarkdownFiles, loadManifest } from "./manifest.js";
import { addFromGitHub, addLocalPath, removePath, updateSources } from "./add.js";
import type { Source, Manifest } from "./types.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("refdocs")
  .description("Local CLI tool for fetching, organizing, and cataloging markdown documentation")
  .version(version);

program
  .command("init")
  .description("Create .refdocs/config.json with defaults")
  .action(() => {
    try {
      initConfig(process.cwd());
      console.log(`Created ${CONFIG_DIR_NAME}/${CONFIG_FILENAME} with default configuration.`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("manifest")
  .description("Generate the documentation manifest")
  .action(() => {
    try {
      const { config, configDir } = loadConfig();
      const manifest = buildAndPersistManifest(config, configDir);
      printManifestSummary(manifest);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List all documented files and their heading counts")
  .action(() => {
    try {
      const { config, configDir } = loadConfig();
      const manifestPath = join(configDir, config.manifest);

      let entries: Manifest["entries"];
      try {
        const manifest = loadManifest(manifestPath);
        entries = manifest.entries;
      } catch {
        // No manifest yet — scan filesystem directly
        const files = findMarkdownFiles(config.paths, configDir);
        entries = files.map((f) => ({ file: f, headings: [], lines: 0, summary: "" }));
      }

      for (const entry of entries) {
        const detail = entry.headings.length > 0
          ? ` (${entry.headings.length} heading${entry.headings.length !== 1 ? "s" : ""}, ${entry.lines} lines)`
          : "";
        console.log(`${entry.file}${detail}`);
      }
      console.log(`\n${entries.length} files total`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

interface AddOpts {
  path?: string;
  branch?: string;
  manifest: boolean;
}

program
  .command("add <source>")
  .description("Add docs from a local path or GitHub URL")
  .option("--path <dir>", "override local storage directory")
  .option("--branch <branch>", "override branch detection from URL")
  .option("--no-manifest", "skip auto manifest generation after download")
  .action(async (source: string, opts: AddOpts) => {
    try {
      const isUrl = source.startsWith("http://") || source.startsWith("https://");

      const cwd = process.cwd();
      if (!configExists(cwd)) {
        initConfig(cwd);
        console.log(`Initialized ${CONFIG_DIR_NAME}/${CONFIG_FILENAME} with default configuration.`);
      }
      const { config, configDir } = loadConfig();

      if (isUrl) {
        const result = await addFromGitHub(
          source,
          { path: opts.path, branch: opts.branch },
          configDir,
          config,
        );

        console.log(`Downloaded ${result.filesWritten} markdown files → ${result.localPath}/`);
        if (result.source.type === "github") {
          console.log(`Source: ${result.source.owner}/${result.source.repo} (${result.source.branch})`);
        }

        if (opts.manifest && result.filesWritten > 0) {
          regenerateManifest();
        }
      } else {
        const result = addLocalPath(source, configDir, config, cwd);
        console.log(`Added ${result.localPath} to paths`);

        if (opts.manifest) {
          regenerateManifest();
        }
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("update")
  .description("Re-pull all tracked sources and regenerate manifest")
  .option("--no-manifest", "skip auto manifest generation after update")
  .action(async (opts: { manifest: boolean }) => {
    try {
      const { config, configDir } = loadConfig();
      const token = process.env.GITHUB_TOKEN ?? undefined;
      const results = await updateSources(config, configDir, token);

      for (const r of results) {
        const desc = formatSourceDescription(r.source);
        console.log(`Updated ${desc} → ${r.filesWritten} files`);
      }

      const totalFiles = results.reduce((sum, r) => sum + r.filesWritten, 0);
      console.log(`\n${results.length} source${results.length !== 1 ? "s" : ""} updated (${totalFiles} files total)`);

      if (opts.manifest && totalFiles > 0) {
        regenerateManifest();
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("remove <path>")
  .description("Remove a path from the configuration")
  .option("--no-manifest", "skip auto manifest generation after removal")
  .action((path: string, opts: { manifest: boolean }) => {
    try {
      const { config, configDir } = loadConfig();
      const projectDir = dirname(configDir);
      const result = removePath(path, configDir, config, projectDir);

      if (!result.removed) {
        console.error(`Path "${path}" not found in configured paths.`);
        process.exit(1);
      }

      console.log(`Removed ${path} from paths`);
      if (result.sourceRemoved) {
        console.log("Removed associated source");
      }

      if (opts.manifest) {
        regenerateManifest();
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

function printManifestSummary(manifest: Manifest) {
  console.log(`Manifest: ${manifest.files} files, ${manifest.sources} sources`);
}

function regenerateManifest() {
  const { config: freshConfig, configDir: freshDir } = loadConfig();
  const manifest = buildAndPersistManifest(freshConfig, freshDir);
  printManifestSummary(manifest);
}

function formatSourceDescription(source: Source): string {
  switch (source.type) {
    case "github":
      return `${source.owner}/${source.repo}`;
    case "file":
      return source.url;
  }
}

program.parse();
