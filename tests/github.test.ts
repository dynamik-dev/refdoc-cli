import { describe, it, expect } from "vitest";
import { parseGitHubUrl } from "../src/github.js";

describe("parseGitHubUrl", () => {
  it("parses owner/repo URL", () => {
    const result = parseGitHubUrl("https://github.com/laravel/docs");
    expect(result).toEqual({
      owner: "laravel",
      repo: "docs",
      branch: null,
      subpath: "",
    });
  });

  it("parses URL with branch", () => {
    const result = parseGitHubUrl("https://github.com/laravel/docs/tree/11.x");
    expect(result).toEqual({
      owner: "laravel",
      repo: "docs",
      branch: "11.x",
      subpath: "",
    });
  });

  it("parses URL with branch and subpath", () => {
    const result = parseGitHubUrl("https://github.com/statamic/docs/tree/6.x/content");
    expect(result).toEqual({
      owner: "statamic",
      repo: "docs",
      branch: "6.x",
      subpath: "content",
    });
  });

  it("parses URL with deep subpath", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/tree/main/docs/en/guide");
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "main",
      subpath: "docs/en/guide",
    });
  });

  it("handles trailing slash", () => {
    const result = parseGitHubUrl("https://github.com/laravel/docs/");
    expect(result).toEqual({
      owner: "laravel",
      repo: "docs",
      branch: null,
      subpath: "",
    });
  });

  it("strips .git suffix", () => {
    const result = parseGitHubUrl("https://github.com/laravel/docs.git");
    expect(result).toEqual({
      owner: "laravel",
      repo: "docs",
      branch: null,
      subpath: "",
    });
  });

  it("rejects non-GitHub URLs", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/owner/repo")).toThrow(
      "Only GitHub URLs are supported"
    );
  });

  it("rejects invalid URLs", () => {
    expect(() => parseGitHubUrl("not-a-url")).toThrow("Invalid URL");
  });

  it("rejects URL with only owner", () => {
    expect(() => parseGitHubUrl("https://github.com/owner")).toThrow(
      "Could not parse owner/repo"
    );
  });

  it("handles http URLs", () => {
    const result = parseGitHubUrl("http://github.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
  });
});
