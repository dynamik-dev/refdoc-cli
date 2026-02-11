import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isTextFileUrl,
  isGitHubUrl,
  deriveLocalPath,
  deriveCrawlDir,
  normalizeUrl,
  isSubPath,
  urlToFilePath,
  htmlToMarkdown,
  discoverLinks,
  crawlSite,
} from "../src/crawl.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures", "crawl-site");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

// --- Pure function unit tests ---

describe("isTextFileUrl", () => {
  it("returns true for .txt URLs", () => {
    expect(isTextFileUrl("https://hono.dev/llms.txt")).toBe(true);
    expect(isTextFileUrl("https://example.com/docs/llms-full.txt")).toBe(true);
  });

  it("returns true for .md URLs", () => {
    expect(isTextFileUrl("https://example.com/README.md")).toBe(true);
  });

  it("returns false for HTML pages", () => {
    expect(isTextFileUrl("https://hono.dev/docs")).toBe(false);
    expect(isTextFileUrl("https://hono.dev/docs/getting-started")).toBe(false);
  });

  it("returns false for .html URLs", () => {
    expect(isTextFileUrl("https://example.com/page.html")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isTextFileUrl("not-a-url")).toBe(false);
  });
});

describe("isGitHubUrl", () => {
  it("returns true for github.com URLs", () => {
    expect(isGitHubUrl("https://github.com/honojs/hono")).toBe(true);
    expect(isGitHubUrl("https://github.com/honojs/hono/tree/main/docs")).toBe(true);
  });

  it("returns false for other URLs", () => {
    expect(isGitHubUrl("https://hono.dev/docs")).toBe(false);
    expect(isGitHubUrl("https://gitlab.com/foo/bar")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isGitHubUrl("not-a-url")).toBe(false);
  });
});

describe("deriveLocalPath", () => {
  it("derives path from URL with file", () => {
    expect(deriveLocalPath("https://hono.dev/llms-full.txt")).toBe(
      "ref-docs/hono.dev/llms-full.txt",
    );
  });

  it("derives path from URL with deep path", () => {
    expect(deriveLocalPath("https://example.com/docs/api/reference.md")).toBe(
      "ref-docs/example.com/docs/api/reference.md",
    );
  });

  it("handles root path", () => {
    expect(deriveLocalPath("https://example.com/")).toBe("ref-docs/example.com/index");
    expect(deriveLocalPath("https://example.com")).toBe("ref-docs/example.com/index");
  });
});

describe("deriveCrawlDir", () => {
  it("derives directory from URL path", () => {
    expect(deriveCrawlDir("https://hono.dev/docs")).toBe("ref-docs/hono.dev/docs");
  });

  it("strips trailing slashes", () => {
    expect(deriveCrawlDir("https://hono.dev/docs/")).toBe("ref-docs/hono.dev/docs");
  });

  it("handles deep paths", () => {
    expect(deriveCrawlDir("https://example.com/api/v2/docs")).toBe(
      "ref-docs/example.com/api/v2/docs",
    );
  });

  it("handles root URL", () => {
    expect(deriveCrawlDir("https://example.com")).toBe("ref-docs/example.com/root");
    expect(deriveCrawlDir("https://example.com/")).toBe("ref-docs/example.com/root");
  });
});

describe("normalizeUrl", () => {
  it("strips fragment", () => {
    expect(normalizeUrl("https://example.com/docs#section")).toBe("https://example.com/docs");
  });

  it("strips trailing slash from non-root path", () => {
    expect(normalizeUrl("https://example.com/docs/")).toBe("https://example.com/docs");
  });

  it("preserves trailing slash on root", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("returns input for invalid URLs", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("isSubPath", () => {
  it("returns true for exact match", () => {
    expect(isSubPath("https://example.com/docs", "https://example.com/docs")).toBe(true);
  });

  it("returns true for child path", () => {
    expect(isSubPath("https://example.com/docs/api", "https://example.com/docs")).toBe(true);
  });

  it("returns true for deeply nested child", () => {
    expect(isSubPath("https://example.com/docs/api/auth/jwt", "https://example.com/docs")).toBe(true);
  });

  it("returns false for sibling path", () => {
    expect(isSubPath("https://example.com/blog", "https://example.com/docs")).toBe(false);
  });

  it("returns false for partial prefix match", () => {
    expect(isSubPath("https://example.com/docs-v2", "https://example.com/docs")).toBe(false);
  });

  it("returns false for different origin", () => {
    expect(isSubPath("https://other.com/docs/api", "https://example.com/docs")).toBe(false);
  });

  it("handles root scope", () => {
    expect(isSubPath("https://example.com/anything", "https://example.com/")).toBe(true);
    expect(isSubPath("https://example.com/deep/nested/path", "https://example.com/")).toBe(true);
  });
});

describe("urlToFilePath", () => {
  it("converts extensionless path to .md", () => {
    expect(urlToFilePath("https://example.com/docs/api")).toBe("docs/api.md");
  });

  it("converts .html to .md", () => {
    expect(urlToFilePath("https://example.com/docs/api.html")).toBe("docs/api.md");
  });

  it("converts .htm to .md", () => {
    expect(urlToFilePath("https://example.com/page.htm")).toBe("page.md");
  });

  it("handles trailing slash with index", () => {
    expect(urlToFilePath("https://example.com/docs/")).toBe("docs/index.md");
  });

  it("handles root path", () => {
    expect(urlToFilePath("https://example.com/")).toBe("index.md");
  });

  it("preserves non-html extensions", () => {
    expect(urlToFilePath("https://example.com/data.json")).toBe("data.json");
  });
});

// --- HTML-to-markdown conversion tests ---

describe("htmlToMarkdown", () => {
  it("extracts article content and prepends title", () => {
    const html = loadFixture("getting-started.html");
    const md = htmlToMarkdown(html, "https://example.com/docs/getting-started");

    expect(md).toContain("# Getting Started");
    expect(md).toContain("Install Acme via npm");
    expect(md).toContain("npm install acme");
  });

  it("strips navigation chrome", () => {
    const html = loadFixture("index.html");
    const md = htmlToMarkdown(html, "https://example.com/docs");

    // Readability should strip the nav links
    expect(md).not.toContain("<nav>");
    // But article content should be present
    expect(md).toContain("Acme");
  });

  it("preserves code blocks", () => {
    const html = loadFixture("api-auth.html");
    const md = htmlToMarkdown(html, "https://example.com/docs/api/auth");

    expect(md).toContain("secret");
    expect(md).toContain("authenticate");
  });
});

// --- Link discovery tests ---

describe("discoverLinks", () => {
  it("finds same-origin links within scope", () => {
    const html = loadFixture("index.html");
    const links = discoverLinks(html, "https://example.com/docs", "https://example.com/docs");

    expect(links).toContain("https://example.com/docs/getting-started");
    expect(links).toContain("https://example.com/docs/api");
    expect(links).toContain("https://example.com/docs/api/auth");
  });

  it("excludes external links", () => {
    const html = loadFixture("index.html");
    const links = discoverLinks(html, "https://example.com/docs", "https://example.com/docs");

    const external = links.filter((l) => !l.startsWith("https://example.com"));
    expect(external).toEqual([]);
  });

  it("excludes links outside scope", () => {
    const html = loadFixture("index.html");
    const links = discoverLinks(html, "https://example.com/docs", "https://example.com/docs");

    // /blog is outside /docs scope
    expect(links).not.toContain("https://example.com/blog");
  });

  it("deduplicates links", () => {
    const html = loadFixture("index.html");
    const links = discoverLinks(html, "https://example.com/docs", "https://example.com/docs");

    const unique = new Set(links);
    expect(links.length).toBe(unique.size);
  });

  it("resolves relative links against page URL", () => {
    // The fixture uses absolute paths like /docs/api, which resolve against the origin
    const html = loadFixture("api.html");
    const links = discoverLinks(html, "https://example.com/docs/api", "https://example.com/docs");

    expect(links).toContain("https://example.com/docs/api/auth");
    expect(links).toContain("https://example.com/docs/api/middleware");
  });
});

// --- crawlSite integration tests (mocked fetch) ---

describe("crawlSite", () => {
  let tmpDir: string;

  const SITE_MAP: Record<string, { file: string; contentType: string }> = {
    "https://example.com/docs": { file: "index.html", contentType: "text/html; charset=utf-8" },
    "https://example.com/docs/getting-started": { file: "getting-started.html", contentType: "text/html" },
    "https://example.com/docs/api": { file: "api.html", contentType: "text/html" },
    "https://example.com/docs/api/auth": { file: "api-auth.html", contentType: "text/html" },
    "https://example.com/docs/api/middleware": { file: "api-middleware.html", contentType: "text/html" },
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-crawl-"));

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const normalized = url.replace(/\/$/, "");
      const entry = SITE_MAP[normalized] ?? SITE_MAP[url];
      if (!entry) {
        return { ok: false, status: 404, headers: new Headers() };
      }
      const body = loadFixture(entry.file);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": entry.contentType }),
        text: async () => body,
      };
    }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("crawls all pages within scope", async () => {
    const result = await crawlSite("https://example.com/docs", tmpDir, { delayMs: 0 });

    expect(result.filesWritten).toBe(5);
    expect(result.pages).toContain("https://example.com/docs");
    expect(result.pages).toContain("https://example.com/docs/getting-started");
    expect(result.pages).toContain("https://example.com/docs/api");
    expect(result.pages).toContain("https://example.com/docs/api/auth");
    expect(result.pages).toContain("https://example.com/docs/api/middleware");
  });

  it("writes .md files to correct paths", async () => {
    await crawlSite("https://example.com/docs", tmpDir, { delayMs: 0 });

    expect(existsSync(join(tmpDir, "docs.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "docs", "getting-started.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "docs", "api.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "docs", "api", "auth.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "docs", "api", "middleware.md"))).toBe(true);
  });

  it("produces valid markdown content", async () => {
    await crawlSite("https://example.com/docs", tmpDir, { delayMs: 0 });

    const content = readFileSync(join(tmpDir, "docs", "getting-started.md"), "utf-8");
    expect(content).toContain("# Getting Started");
    expect(content).toContain("npm install acme");
  });

  it("respects maxPages limit", async () => {
    const result = await crawlSite("https://example.com/docs", tmpDir, {
      maxPages: 2,
      delayMs: 0,
    });

    expect(result.filesWritten).toBe(2);
  });

  it("respects depth limit", async () => {
    const result = await crawlSite("https://example.com/docs", tmpDir, {
      depth: 1,
      delayMs: 0,
    });

    // depth 0 = the seed page, depth 1 = direct children
    // Seed (depth 0): /docs → discovers /docs/getting-started, /docs/api, /docs/api/auth
    // Depth 1: /docs/getting-started, /docs/api, /docs/api/auth
    // These pages discover /docs/api/middleware at depth 2, which should NOT be fetched
    expect(result.pages).toContain("https://example.com/docs");
    expect(result.pages).toContain("https://example.com/docs/getting-started");
    expect(result.pages).toContain("https://example.com/docs/api");
    expect(result.pages).not.toContain("https://example.com/docs/api/middleware");
  });

  it("does not visit the same URL twice", async () => {
    await crawlSite("https://example.com/docs", tmpDir, { delayMs: 0 });

    const fetchMock = vi.mocked(fetch);
    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    const unique = new Set(urls);
    expect(urls.length).toBe(unique.size);
  });

  it("skips 404 pages without failing", async () => {
    // Override to make one page 404
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const input = typeof url === "string" ? url : url.toString();
      const normalized = input.replace(/\/$/, "");
      if (normalized === "https://example.com/docs/api") {
        return { ok: false, status: 404, headers: new Headers() } as Response;
      }
      const entry = SITE_MAP[normalized] ?? SITE_MAP[input];
      if (!entry) {
        return { ok: false, status: 404, headers: new Headers() } as Response;
      }
      const body = loadFixture(entry.file);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": entry.contentType }),
        text: async () => body,
      } as unknown as Response;
    });

    const result = await crawlSite("https://example.com/docs", tmpDir, { delayMs: 0 });

    // Should still crawl successfully, just minus the 404 page
    expect(result.filesWritten).toBeGreaterThan(0);
    expect(result.pages).not.toContain("https://example.com/docs/api");
  });

  it("skips non-HTML responses", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const input = typeof url === "string" ? url : url.toString();
      const normalized = input.replace(/\/$/, "");
      if (normalized === "https://example.com/docs/getting-started") {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => "{}",
        } as unknown as Response;
      }
      const entry = SITE_MAP[normalized] ?? SITE_MAP[input];
      if (!entry) {
        return { ok: false, status: 404, headers: new Headers() } as Response;
      }
      const body = loadFixture(entry.file);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": entry.contentType }),
        text: async () => body,
      } as unknown as Response;
    });

    const result = await crawlSite("https://example.com/docs", tmpDir, { delayMs: 0 });

    expect(result.pages).not.toContain("https://example.com/docs/getting-started");
    expect(existsSync(join(tmpDir, "docs", "getting-started.md"))).toBe(false);
  });

  it("applies throttle delay between requests", async () => {
    const start = Date.now();
    await crawlSite("https://example.com/docs", tmpDir, {
      maxPages: 3,
      delayMs: 50,
    });
    const elapsed = Date.now() - start;

    // 3 pages, 2 delays of 50ms each = ~100ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it("defaults work when options are omitted", async () => {
    // This tests the fix for undefined overriding defaults
    const result = await crawlSite("https://example.com/docs", tmpDir, {
      maxPages: undefined,
      depth: undefined,
      delayMs: 0,
    });

    // Should use default maxPages (200) and depth (3), not crash
    expect(result.filesWritten).toBe(5);
  });
});
