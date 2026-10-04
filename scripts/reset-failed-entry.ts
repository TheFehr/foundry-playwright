import fs from "fs";
import path from "path";

/**
 * Resets one "failed" registry entry back to "pending" so the next
 * verification run actually retries it - see
 * .github/workflows/reset-verification.yml, which runs this when a
 * collaborator checks the reset checkbox close-resolved-issues.ts posts on
 * a failed entry's issue (see that script's own comment on why a "failed"
 * entry is otherwise a dead end: no automated path ever revisits it).
 *
 * Inputs via env vars (set by the workflow, not CLI flags - this only ever
 * runs from there): RESET_FVTT, RESET_SYSTEM, RESET_SYSTEM_VERSION identify
 * the row the same way its issue title does; RESET_ACTOR and RESET_ISSUE
 * are only used to write a clear, attributable note.
 *
 * Deliberately a no-op (exit 0, not an error) rather than failing the
 * workflow run when the row is missing or already moved on from "failed" -
 * e.g. a normal nightly run already re-verified it between the comment
 * being posted and someone checking the box. The workflow's own "did the
 * file actually change" check is what decides whether to open a PR, not
 * this script's exit code.
 */

interface RegistryEntry {
  fvtt: string;
  system: string;
  systemMinor: string;
  systemVersion: string;
  status: "stable" | "pending" | "incompatible" | "failed";
  timestamp: string;
  notes: string;
  verifiedWith?: string;
  [key: string]: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function run() {
  const fvtt = requireEnv("RESET_FVTT");
  const system = requireEnv("RESET_SYSTEM");
  const systemVersion = requireEnv("RESET_SYSTEM_VERSION");
  const actor = process.env.RESET_ACTOR || "unknown";
  const issueNumber = process.env.RESET_ISSUE || "unknown";

  const registryPath = path.join(process.cwd(), "verified-versions.json");
  const registry: RegistryEntry[] = JSON.parse(fs.readFileSync(registryPath, "utf8"));

  const entry = registry.find(
    (e) => e.fvtt === fvtt && e.system === system && e.systemVersion === systemVersion,
  );

  if (!entry) {
    console.log(
      `[reset-failed-entry] No registry row for FVTT ${fvtt} + ${system} v${systemVersion} - nothing to reset.`,
    );
    return;
  }

  if (entry.status !== "failed") {
    console.log(
      `[reset-failed-entry] FVTT ${fvtt} + ${system} v${systemVersion} is already "${entry.status}", not "failed" - leaving it as-is.`,
    );
    return;
  }

  entry.status = "pending";
  entry.timestamp = new Date().toISOString();
  entry.notes = `Manually reset to pending via issue #${issueNumber} by @${actor} on ${
    new Date().toISOString().split("T")[0]
  }.`;
  // A stale verifiedWith would otherwise make this row look like it still
  // needs resweeping against the version that just failed it - pending
  // entries aren't swept by that logic at all (see verify-local.ts), so
  // this is mostly for a clean read, not correctness.
  delete entry.verifiedWith;

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
  console.log(
    `[reset-failed-entry] Reset FVTT ${fvtt} + ${system} v${systemVersion} to "pending".`,
  );
}

run();
