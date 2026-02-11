export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  branch: string | null;
  subpath: string;
}

export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  let cleaned = url.trim().replace(/\/+$/, "");
  if (cleaned.endsWith(".git")) {
    cleaned = cleaned.slice(0, -4);
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error(`Invalid URL: "${url}". Expected a GitHub URL like https://github.com/owner/repo`);
  }

  if (parsed.hostname !== "github.com") {
    throw new Error(`Only GitHub URLs are supported. Got: "${parsed.hostname}"`);
  }

  const parts = parsed.pathname.split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new Error(`Could not parse owner/repo from URL: "${url}"`);
  }

  const owner = parts[0];
  const repo = parts[1];
  let branch: string | null = null;
  let subpath = "";

  if (parts.length >= 4 && parts[2] === "tree") {
    branch = parts[3];
    if (parts.length > 4) {
      subpath = parts.slice(4).join("/");
    }
  }

  return { owner, repo, branch, subpath };
}

export async function downloadTarball(
  owner: string,
  repo: string,
  ref?: string,
  token?: string,
): Promise<ArrayBuffer> {
  const refPart = ref ? `/${ref}` : "";
  const url = `https://api.github.com/repos/${owner}/${repo}/tarball${refPart}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "refdocs-cli",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Repository not found: ${owner}/${repo}${ref ? ` (ref: ${ref})` : ""}. Check the URL and ensure the repo is public or GITHUB_TOKEN is set.`
      );
    }
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
}
