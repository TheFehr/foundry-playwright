import "dotenv/config";
import fs from "fs";
import path from "path";
import { getGithubToken, repoSlug, githubRequest, listAllIssues } from "./github.js";

/**
 * Reconciles verification-required GitHub issues against verified-versions.json.
 *
 * Run after a verification pass: any entry that has left "pending" gets its
 * matching issue commented on and closed (or, for "failed", relabeled
 * needs-investigation so a human looks at the real regression instead of it
 * being silently retried forever). This also reconciles issues that
 * report-regressions.ts opened directly with the verification-required
 * label (see that script) - they flow through the exact same lifecycle from
 * here on.
 */

interface RegistryEntry {
  fvtt: string;
  system: string;
  systemVersion: string;
  status: "stable" | "pending" | "incompatible" | "failed";
  notes: string;
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

  const openIssues = await listAllIssues(token, repo, "labels=verification-required&state=open");

  for (const entry of resolved) {
    const title = `Verification Required: FVTT ${entry.fvtt} + ${entry.system} v${entry.systemVersion}`;
    try {
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
    } catch (e) {
      // One entry's GitHub API call failing (rate limit, deleted issue,
      // transient network error) shouldn't abort reconciliation for every
      // other independent entry in this run.
      console.error(
        `[close-resolved-issues] Failed to reconcile "${title}": ${(e as Error).message}`,
      );
    }
  }
}

run();
