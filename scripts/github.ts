import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export function getGithubToken(): string {
  try {
    const token = execSync("gh auth token", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token) return token;
  } catch {
    console.warn("[github] gh not available or not logged in.");
  }
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken;
  throw new Error(
    "No GitHub token available (`gh auth token` failed and GITHUB_TOKEN/GH_TOKEN are unset).",
  );
}

export function repoSlug(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const url: string = pkg.repository?.url ?? "";
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!m)
    throw new Error(`Could not determine owner/repo from package.json repository.url: "${url}"`);
  return `${m[1]}/${m[2]}`;
}

export async function githubRequest<T>(
  token: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "foundry-playwright/scripts",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${urlPath} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// Paginates a GitHub issues-list query - a single page could silently miss
// issues once there are more than 100 matching a filter at once.
export async function listAllIssues(
  token: string,
  repo: string,
  query: string,
): Promise<{ number: number; title: string }[]> {
  const issues: { number: number; title: string }[] = [];
  for (let page = 1; ; page++) {
    const batch = await githubRequest<{ number: number; title: string }[]>(
      token,
      "GET",
      `/repos/${repo}/issues?${query}&per_page=100&page=${page}`,
    );
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  return issues;
}
