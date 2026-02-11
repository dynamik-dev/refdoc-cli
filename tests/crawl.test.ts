import { describe, it, expect } from "vitest";
import { isTextFileUrl, isGitHubUrl, deriveLocalPath, deriveCrawlDir } from "../src/crawl.js";

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
