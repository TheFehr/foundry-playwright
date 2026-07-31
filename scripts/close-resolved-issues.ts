import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/**
 * Reconciles verification-required GitHub issues against verified-versions.json.
 *
 * Run after a verification pass: any entry that has left "pending" gets its
 * matching issue commented on and closed (or, for "failed", relabeled
 * needs-investigation so a human looks at the real regression instead of it
 * being silently retried forever).
 */

interface RegistryEntry {
  fvtt: string;
  system: string;
  systemVersion: string;
  status: "stable" | "pending" | "incompatible" | "failed";
  notes: string;
}

interface GhIssue {
  number: number;
  title: string;
}

function getGithubToken(): string {
  try {
    const token = execSync("gh auth token", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token) return token;
  } catch {
    console.warn("[close-resolved-issues] gh not available or not logged in.");
  }
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken;
  throw new Error(
    "No GitHub token available (`gh auth token` failed and GITHUB_TOKEN/GH_TOKEN are unset).",
  );
}

function repoSlug(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const url: string = pkg.repository?.url ?? "";
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!m)
    throw new Error(`Could not determine owner/repo from package.json repository.url: "${url}"`);
  return `${m[1]}/${m[2]}`;
}

async function githubRequest<T>(
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
      "User-Agent": "foundry-playwright/close-resolved-issues",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${urlPath} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function run() {
  const registryPath = path.join(process.cwd(), "verified-versions.json");
  const registry: RegistryEntry[] = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const resolved = registry.filter((e) => e.status !== "pending");

  if (resolved.length === 0) {
    console.log("[close-resolved-issues] No resolved entries to reconcile.");
    return;
  }

  const token = getGithubToken();
  const repo = repoSlug();

  const openIssues = await githubRequest<GhIssue[]>(
    token,
    "GET",
    `/repos/${repo}/issues?labels=verification-required&state=open&per_page=100`,
  );

  for (const entry of resolved) {
    const title = `Verification Required: FVTT ${entry.fvtt} + ${entry.system} v${entry.systemVersion}`;
    const issue = openIssues.find((i) => i.title === title);
    if (!issue) continue;

    const outcome =
      entry.status === "stable"
        ? `✅ Verified stable.\n\n${entry.notes}`
        : entry.status === "incompatible"
          ? `❌ Confirmed incompatible.\n\n${entry.notes}`
          : `⚠️ Automated verification failed and needs investigation.\n\n${entry.notes}`;

    console.log(`[close-resolved-issues] #${issue.number}: ${title} -> ${entry.status}`);
    await githubRequest(token, "POST", `/repos/${repo}/issues/${issue.number}/comments`, {
      body: outcome,
    });

    if (entry.status === "failed") {
      await githubRequest(token, "POST", `/repos/${repo}/issues/${issue.number}/labels`, {
        labels: ["needs-investigation"],
      });
      // Drop the label this query selects on, or a "failed" entry (which
      // stays "failed" forever - it's not re-verified by --all-pending)
      // would get re-commented and re-labeled every single night.
      await githubRequest(
        token,
        "DELETE",
        `/repos/${repo}/issues/${issue.number}/labels/verification-required`,
      );
    } else {
      await githubRequest(token, "PATCH", `/repos/${repo}/issues/${issue.number}`, {
        state: "closed",
      });
    }
  }
}

run();
