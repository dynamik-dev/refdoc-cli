import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";
import { parseGitHubUrl, downloadTarball } from "./github.js";
import { saveConfig } from "./config.js";
import type { RefdocsConfig, Source } from "./types.js";

export interface AddOptions {
  path?: string;
  branch?: string;
  token?: string;
}

export interface AddResult {
  filesWritten: number;
  localPath: string;
  source: Source;
}

export interface UpdateResult {
  source: Source;
  filesWritten: number;
}

export async function addFromUrl(
  url: string,
  options: AddOptions,
  configDir: string,
  config: RefdocsConfig,
): Promise<AddResult> {
  const parsed = parseGitHubUrl(url);
  const branch = options.branch ?? parsed.branch ?? undefined;
  const token = options.token ?? process.env.GITHUB_TOKEN ?? undefined;
  const defaultPath = parsed.subpath
    ? `ref-docs/${parsed.owner}/${parsed.repo}/${parsed.subpath}`
    : `ref-docs/${parsed.owner}/${parsed.repo}`;
  const localPath = options.path ?? defaultPath;

  const tarball = await downloadTarball(parsed.owner, parsed.repo, branch, token);

  const filesWritten = await extractMarkdownFiles(
    Buffer.from(tarball),
    parsed.subpath,
    join(configDir, localPath),
  );

  const source: Source = {
    url,
    owner: parsed.owner,
    repo: parsed.repo,
    branch: branch ?? "HEAD",
    subpath: parsed.subpath,
    localPath,
    addedAt: new Date().toISOString(),
  };

  const paths = isPathCovered(config.paths, localPath)
    ? config.paths
    : [...config.paths, localPath];

  const sources = upsertSource(config.sources ?? [], source);

  saveConfig({ paths, sources }, configDir);

  return { filesWritten, localPath, source };
}

export async function updateSources(
  config: RefdocsConfig,
  configDir: string,
  token?: string,
): Promise<UpdateResult[]> {
  const sources = config.sources ?? [];
  if (sources.length === 0) {
    throw new Error("No sources configured. Add a source first with `refdocs add <url>`.");
  }

  const results: UpdateResult[] = [];
  for (const source of sources) {
    const ref = source.branch === "HEAD" ? undefined : source.branch;
    const tarball = await downloadTarball(source.owner, source.repo, ref, token);
    const filesWritten = await extractMarkdownFiles(
      Buffer.from(tarball),
      source.subpath,
      join(configDir, source.localPath),
    );
    results.push({ source, filesWritten });
  }

  return results;
}

export interface AddLocalResult {
  localPath: string;
}

export function addLocalPath(
  inputPath: string,
  configDir: string,
  config: RefdocsConfig,
): AddLocalResult {
  const absolutePath = resolve(configDir, inputPath);

  if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
    throw new Error(`Directory not found: ${inputPath}`);
  }

  if (!hasMarkdownFiles(absolutePath)) {
    throw new Error(`No .md files found in ${inputPath}`);
  }

  const localPath = relative(configDir, absolutePath);

  if (config.paths.includes(localPath)) {
    return { localPath };
  }

  const paths = [...config.paths, localPath];
  saveConfig({ paths }, configDir);

  return { localPath };
}

export interface RemoveResult {
  removed: boolean;
  sourceRemoved: boolean;
}

export function removePath(
  inputPath: string,
  configDir: string,
  config: RefdocsConfig,
): RemoveResult {
  const absolutePath = resolve(configDir, inputPath);
  const normalizedPath = relative(configDir, absolutePath);

  const pathIndex = config.paths.indexOf(normalizedPath);
  if (pathIndex === -1) {
    return { removed: false, sourceRemoved: false };
  }

  const paths = config.paths.filter((p) => p !== normalizedPath);

  const sources = config.sources ?? [];
  const filteredSources = sources.filter((s) => s.localPath !== normalizedPath);
  const sourceRemoved = filteredSources.length < sources.length;

  saveConfig({ paths, sources: filteredSources }, configDir);

  return { removed: true, sourceRemoved };
}

function hasMarkdownFiles(dir: string): boolean {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) return true;
    if (entry.isDirectory()) {
      if (hasMarkdownFiles(join(dir, entry.name))) return true;
    }
  }
  return false;
}

export async function extractMarkdownFiles(
  tarballBuffer: Buffer,
  subpath: string,
  outputDir: string,
): Promise<number> {
  let filesWritten = 0;
  const extract = tar.extract();

  const processEntry = new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        if (header.type === "file" && header.name.endsWith(".md")) {
          const relativePath = stripTarPrefix(header.name);

          if (subpath && !relativePath.startsWith(subpath + "/") && relativePath !== subpath) {
            next();
            return;
          }

          const targetRelative = subpath
            ? relativePath.slice(subpath.length + 1)
            : relativePath;

          if (!targetRelative) {
            next();
            return;
          }

          const targetPath = join(outputDir, targetRelative);
          mkdirSync(dirname(targetPath), { recursive: true });
          writeFileSync(targetPath, Buffer.concat(chunks));
          filesWritten++;
        }
        next();
      });
      stream.on("error", reject);
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
  });

  const gunzip = createGunzip();
  const source = Readable.from(tarballBuffer);
  pipeline(source, gunzip, extract).catch(() => {});
  await processEntry;

  return filesWritten;
}

function stripTarPrefix(entryName: string): string {
  const parts = entryName.split("/");
  return parts.slice(1).join("/");
}

export function isPathCovered(existingPaths: string[], newPath: string): boolean {
  return existingPaths.some(
    (p) => p === newPath || newPath.startsWith(p + "/"),
  );
}

function upsertSource(sources: Source[], newSource: Source): Source[] {
  const key = `${newSource.owner}/${newSource.repo}/${newSource.subpath}`;
  const filtered = sources.filter(
    (s) => `${s.owner}/${s.repo}/${s.subpath}` !== key,
  );
  return [...filtered, newSource];
}
