import "dotenv/config";
import fs from "fs";
import path from "path";
import { getGithubToken, repoSlug, githubRequest, listAllIssues } from "./github.js";

/**
 * Opens an issue for any registry entry stuck at "failed" that isn't
 * already tracked by one.
 *
 * close-resolved-issues.ts only ever updates an *existing* issue - it has
 * nothing to find for a "stable" entry that a re-verify run (see
 * --if-release-pending in verify-local.ts) just flipped straight to
 * "failed", since no verification-required issue was ever opened for it
 * (unlike a "pending" entry, which monitor-releases.yml always files one
 * for up front). Run this after close-resolved-issues.ts so a "pending"
 * entry that failed on its first check gets reconciled onto its existing
 * issue rather than getting a duplicate here.
 *
 * Issues opened here carry the same title format and the
 * verification-required label as monitor-releases.yml's pending issues, so
 * they're picked up by close-resolved-issues.ts's normal lifecycle (relabel
 * to needs-investigation, close on recovery) without any special-casing.
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
  const failed = registry.filter((e) => e.status === "failed");

  if (failed.length === 0) {
    console.log("[report-regressions] No failed entries.");
    return;
  }

  const token = getGithubToken();
  const repo = repoSlug();

  // Union of both labels a failed entry's issue could currently carry:
  // verification-required (not yet reconciled tonight) or
  // needs-investigation (already reconciled on a previous run and still
  // open). Missing either would risk filing a duplicate.
  const [required, investigating] = await Promise.all([
    listAllIssues(token, repo, "labels=verification-required&state=open"),
    listAllIssues(token, repo, "labels=needs-investigation&state=open"),
  ]);
  const openTitles = new Set([...required, ...investigating].map((i) => i.title));

  for (const entry of failed) {
    const title = `Verification Required: FVTT ${entry.fvtt} + ${entry.system} v${entry.systemVersion}`;
    if (openTitles.has(title)) continue;

    try {
      console.log(`[report-regressions] Filing: ${title}`);
      await githubRequest(token, "POST", `/repos/${repo}/issues`, {
        title,
        body: `Automated verification for this combination is currently failing and had no open verification-required/needs-investigation issue tracking it.\n\n**FVTT:** ${entry.fvtt}\n**System:** ${entry.system} v${entry.systemVersion}\n\n${entry.notes}`,
        labels: ["verification-required"],
      });
    } catch (e) {
      // One entry's GitHub API call failing shouldn't abort reporting for
      // every other independent entry in this run.
      console.error(`[report-regressions] Failed to file "${title}": ${(e as Error).message}`);
    }
  }
}

run();
