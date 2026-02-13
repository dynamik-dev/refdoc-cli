import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "..", "src", "index.ts");
const TSX_IMPORT = join(import.meta.dirname, "..", "node_modules", "tsx", "dist", "loader.mjs");

function run(args: string, cwd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node --import "${TSX_IMPORT}" ${CLI} ${args}`, {
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
    mkdirSync(join(tmpDir, ".refdocs", "docs"), { recursive: true });

    writeFileSync(
      join(tmpDir, ".refdocs", "config.json"),
      JSON.stringify({ paths: ["docs"] })
    );

    writeFileSync(
      join(tmpDir, ".refdocs", "docs", "api.md"),
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
      join(tmpDir, ".refdocs", "docs", "guide.md"),
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

  describe("refdocs manifest", () => {
    it("generates manifest and prints summary", () => {
      const { stdout, exitCode } = run("manifest", tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Manifest:");
      expect(stdout).toContain("2 files");
    });

    it("creates manifest file on disk", () => {
      run("manifest", tmpDir);
      expect(existsSync(join(tmpDir, ".refdocs", "manifest.json"))).toBe(true);
    });
  });

  describe("refdocs list", () => {
    it("lists files with heading counts", () => {
      run("manifest", tmpDir);
      const { stdout, exitCode } = run("list", tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("docs/api.md");
      expect(stdout).toContain("docs/guide.md");
      expect(stdout).toContain("heading");
      expect(stdout).toContain("total");
    });
  });

  describe("refdocs init", () => {
    it("creates config file", () => {
      const initDir = mkdtempSync(join(tmpdir(), "refdocs-init-"));
      try {
        const { exitCode } = run("init", initDir);
        expect(exitCode).toBe(0);
        expect(existsSync(join(initDir, ".refdocs", "config.json"))).toBe(true);
      } finally {
        rmSync(initDir, { recursive: true, force: true });
      }
    });
  });
});
