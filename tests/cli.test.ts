import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "..", "src", "index.ts");

function run(args: string, cwd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI} ${args}`, {
      cwd,
      encoding: "utf-8",
      timeout: 15000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.status || 1,
    };
  }
}

describe("CLI", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "refdocs-cli-"));
    mkdirSync(join(tmpDir, "docs"), { recursive: true });

    writeFileSync(
      join(tmpDir, ".refdocs.json"),
      JSON.stringify({ paths: ["docs"] })
    );

    writeFileSync(
      join(tmpDir, "docs", "api.md"),
      [
        "# API Reference",
        "",
        "The API provides RESTful endpoints for managing resources.",
        "",
        "## Authentication",
        "",
        "Use Bearer tokens for authentication. Include the token in the Authorization header.",
        "Tokens expire after 24 hours. Use the refresh endpoint to obtain a new token.",
        "",
        "## Rate Limiting",
        "",
        "Rate limits are applied per API key. The default limit is 100 requests per minute.",
        "Exceeding the limit returns a 429 status code with a Retry-After header.",
        "",
      ].join("\n")
    );

    writeFileSync(
      join(tmpDir, "docs", "guide.md"),
      [
        "# Getting Started",
        "",
        "Welcome to the getting started guide.",
        "",
        "## Installation",
        "",
        "Install the package using npm:",
        "",
        "```bash",
        "npm install my-package",
        "```",
        "",
        "## Configuration",
        "",
        "Create a `.env` file with your database URL and API key.",
        "The following environment variables are supported:",
        "",
        "- `DATABASE_URL` — connection string",
        "- `API_KEY` — your API key",
        "",
      ].join("\n")
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("refdocs index", () => {
    it("indexes files and prints summary", () => {
      const { stdout, exitCode } = run("index", tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Indexed 2 files");
      expect(stdout).toContain("chunks");
      expect(stdout).toContain("KB");
      expect(stdout).toContain("Done in");
    });
  });

  describe("refdocs search", () => {
    it("returns relevant results", () => {
      run("index", tmpDir);
      const { stdout, exitCode } = run('search "authentication"', tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Bearer tokens");
    });

    it("shows formatted output with file and line info", () => {
      const { stdout } = run('search "rate limiting"', tmpDir);
      expect(stdout).toMatch(/# \[\d+\] docs\/api\.md:\d+-\d+/);
    });

    it("supports --json flag", () => {
      const { stdout } = run('search --json "authentication"', tmpDir);
      const results = JSON.parse(stdout);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("score");
      expect(results[0]).toHaveProperty("file");
      expect(results[0]).toHaveProperty("lines");
      expect(results[0]).toHaveProperty("headings");
      expect(results[0]).toHaveProperty("body");
    });

    it("supports --raw flag", () => {
      const { stdout } = run('search --raw "authentication"', tmpDir);
      // Raw output should not contain the metadata header
      expect(stdout).not.toMatch(/^# \[/m);
      expect(stdout).toContain("Bearer tokens");
    });

    it("supports -n flag to limit results", () => {
      const { stdout } = run('search -n 1 --json "api"', tmpDir);
      const results = JSON.parse(stdout);
      expect(results).toHaveLength(1);
    });

    it("supports -f flag to filter by file", () => {
      const { stdout } = run('search -f "docs/guide*" --json "install"', tmpDir);
      const results = JSON.parse(stdout);
      for (const r of results) {
        expect(r.file).toMatch(/^docs\/guide/);
      }
    });

    it("shows message when no results found", () => {
      const { stdout } = run('search "xyznonexistent"', tmpDir);
      expect(stdout).toContain("No results found");
    });
  });

  describe("refdocs list", () => {
    it("lists indexed files with chunk counts", () => {
      const { stdout, exitCode } = run("list", tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("docs/api.md");
      expect(stdout).toContain("docs/guide.md");
      expect(stdout).toContain("chunk");
      expect(stdout).toContain("total");
    });
  });

  describe("refdocs info", () => {
    it("shows chunks for a specific file", () => {
      const { stdout, exitCode } = run("info docs/api.md", tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("docs/api.md");
      expect(stdout).toContain("tokens");
    });

    it("errors for unknown file", () => {
      const { stderr, exitCode } = run("info nonexistent.md", tmpDir);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("No chunks found");
    });
  });

  describe("error handling", () => {
    it("errors when searching without index", () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "refdocs-empty-"));
      try {
        const { stderr, exitCode } = run('search "test"', emptyDir);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Index not found");
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });
});
