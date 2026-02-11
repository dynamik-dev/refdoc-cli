import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { JSDOM } from "jsdom";

export interface CrawlOptions {
  maxPages: number;
  depth: number;
  delayMs: number;
}

export interface CrawlResult {
  filesWritten: number;
  pages: string[];
}

export interface FetchFileResult {
  content: string;
  contentType: string;
}

const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  maxPages: 200,
  depth: 3,
  delayMs: 150,
};

const USER_AGENT = "refdocs-cli/0.4.0";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // Strip trailing slash unless it's the root
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function isSubPath(candidate: string, scope: string): boolean {
  const candidateUrl = new URL(candidate);
  const scopeUrl = new URL(scope);
  if (candidateUrl.origin !== scopeUrl.origin) return false;
  const scopePath = scopeUrl.pathname.endsWith("/")
    ? scopeUrl.pathname
    : scopeUrl.pathname + "/";
  return (
    candidateUrl.pathname === scopeUrl.pathname ||
    candidateUrl.pathname.startsWith(scopePath)
  );
}

function urlToFilePath(pageUrl: string): string {
  const u = new URL(pageUrl);
  let path = u.pathname;
  if (path.endsWith("/")) path = path + "index";
  if (path === "") path = "/index";
  // Strip leading slash
  path = path.replace(/^\//, "");
  // If it already has an extension, keep it but ensure .md for HTML pages
  const ext = extname(path);
  if (!ext || ext === ".html" || ext === ".htm") {
    path = path.replace(/\.(html|htm)$/, "") + ".md";
  }
  // Ensure .md extension for extensionless paths
  if (!extname(path)) {
    path = path + ".md";
  }
  return path;
}

function htmlToMarkdown(html: string, url: string): string {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  if (article?.content) {
    let md = turndown.turndown(article.content);
    // Prepend the title as an h1 if readability extracted one
    if (article.title) {
      md = `# ${article.title}\n\n${md}`;
    }
    return md;
  }

  // Fallback: convert the whole body
  return turndown.turndown(html);
}

function discoverLinks(html: string, pageUrl: string, scope: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const base = new URL(pageUrl);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Skip anchors, javascript:, mailto:, etc.
    if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      return;
    }

    try {
      const resolved = new URL(href, base).toString();
      const normalized = normalizeUrl(resolved);

      // Only follow links within scope and same origin
      if (isSubPath(normalized, scope)) {
        // Skip common non-page extensions
        const ext = extname(new URL(normalized).pathname).toLowerCase();
        if (ext && ![".html", ".htm", ""].includes(ext)) return;
        links.push(normalized);
      }
    } catch {
      // Invalid URL, skip
    }
  });

  return [...new Set(links)];
}

async function fetchPage(url: string): Promise<{ html: string; contentType: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,text/plain,text/markdown,*/*",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const html = await response.text();
  return { html, contentType };
}

export function isTextFileUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith(".txt") || pathname.endsWith(".md");
  } catch {
    return false;
  }
}

export function isGitHubUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "github.com";
  } catch {
    return false;
  }
}

export function deriveLocalPath(url: string): string {
  const u = new URL(url);
  const hostname = u.hostname;
  let path = u.pathname.replace(/^\//, "");
  if (!path) path = "index";
  return `ref-docs/${hostname}/${path}`;
}

export function deriveCrawlDir(url: string): string {
  const u = new URL(url);
  const hostname = u.hostname;
  let path = u.pathname.replace(/^\//, "").replace(/\/+$/, "");
  if (!path) path = "root";
  return `ref-docs/${hostname}/${path}`;
}

export async function fetchSingleFile(url: string): Promise<FetchFileResult> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const content = await response.text();
  return { content, contentType };
}

export async function crawlSite(
  startUrl: string,
  outputDir: string,
  options?: Partial<CrawlOptions>,
): Promise<CrawlResult> {
  const opts: CrawlOptions = {
    maxPages: options?.maxPages ?? DEFAULT_CRAWL_OPTIONS.maxPages,
    depth: options?.depth ?? DEFAULT_CRAWL_OPTIONS.depth,
    delayMs: options?.delayMs ?? DEFAULT_CRAWL_OPTIONS.delayMs,
  };
  const scope = normalizeUrl(startUrl);
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: scope, depth: 0 }];
  const pages: string[] = [];
  let filesWritten = 0;

  while (queue.length > 0 && filesWritten < opts.maxPages) {
    const item = queue.shift()!;
    const normalized = normalizeUrl(item.url);

    if (visited.has(normalized)) continue;
    visited.add(normalized);

    try {
      const { html, contentType } = await fetchPage(normalized);

      // Only process HTML pages
      if (!contentType.includes("text/html")) continue;

      const markdown = htmlToMarkdown(html, normalized);
      const filePath = urlToFilePath(normalized);
      const fullPath = join(outputDir, filePath);

      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, markdown, "utf-8");
      filesWritten++;
      pages.push(normalized);

      // Discover links if we haven't hit max depth
      if (item.depth < opts.depth) {
        const links = discoverLinks(html, normalized, scope);
        for (const link of links) {
          if (!visited.has(normalizeUrl(link))) {
            queue.push({ url: link, depth: item.depth + 1 });
          }
        }
      }

      // Throttle between requests
      if (queue.length > 0) {
        await sleep(opts.delayMs);
      }
    } catch (err) {
      // Log but don't fail the whole crawl for one bad page
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Warning: skipping ${normalized} (${msg})\n`);
    }
  }

  const hitLimit = filesWritten >= opts.maxPages && queue.length > 0;
  if (hitLimit) {
    process.stderr.write(
      `Reached ${opts.maxPages} page limit. Use --max-pages to increase.\n`,
    );
  }

  return { filesWritten, pages };
}
