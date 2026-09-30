import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import {
  minorOf,
  compareVersions,
  isCompatibleWithFvtt,
  fetchCompatRange,
  formatCompatRange,
} from "./version-utils.js";

/**
 * Release Monitoring Script
 *
 * Tracks the latest 3 minor versions of each supported system across all stable
 * Foundry versions. Adds a pending entry whenever a new patch is released within
 * a tracked minor, or when a new minor version appears (sliding the window).
 */

interface RegistryEntry {
  fvtt: string;
  system: string;
  systemMinor: string;
  systemVersion: string;
  modules?: { id: string; version: string }[];
  status: "stable" | "pending" | "incompatible" | "failed";
  timestamp: string;
  notes: string;
}

interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
}

const SYSTEM_REPOS: Record<string, string> = {
  dnd5e: "foundryvtt/dnd5e",
  pf2e: "foundryvtt/pf2e",
};

const TRACKED_MINOR_COUNT = 3;

function extractVersion(tag: string, systemId: string): string | null {
  if (systemId === "dnd5e") {
    const m = tag.match(/^release-(\d+\.\d+\.\d+)$/);
    return m ? m[1] : null;
  }
  if (systemId === "pf2e") {
    // Tags are "pf2e-X.Y.Z" (current) or bare "X.Y.Z" (legacy)
    const m = tag.match(/^(?:pf2e-)?(\d+\.\d+\.\d+)$/);
    return m ? m[1] : null;
  }
  if (/^\d+\.\d+\.\d+$/.test(tag)) return tag;
  return null;
}

function getGithubAuthHeader(): string {
  try {
    const token = execSync("gh auth token", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token) return `-H "Authorization: Bearer ${token}"`;
  } catch {
    console.warn(
      "[monitor] gh not available or not logged in — using unauthenticated GitHub API (60 req/hr limit).",
    );
  }
  return "";
}

async function fetchLatestByMinor(systemId: string): Promise<Map<string, string>> {
  const repo = SYSTEM_REPOS[systemId];
  if (!repo) throw new Error(`Unknown system: ${systemId}`);
  console.log(`[monitor] Fetching releases for ${systemId} from GitHub...`);
  const authHeader = getGithubAuthHeader();
  const json = execSync(
    `curl -sf ${authHeader} -H "Accept: application/vnd.github.v3+json" -H "User-Agent: foundry-playwright/monitor" "https://api.github.com/repos/${repo}/releases?per_page=100"`,
    { encoding: "utf8" },
  );
  const releases: GithubRelease[] = JSON.parse(json);
  const latestByMinor = new Map<string, string>();
  for (const release of releases) {
    if (release.prerelease || release.draft) continue;
    const version = extractVersion(release.tag_name, systemId);
    if (!version) continue;
    const minor = minorOf(version);
    const existing = latestByMinor.get(minor);
    if (!existing || compareVersions(version, existing) > 0) {
      latestByMinor.set(minor, version);
    }
  }
  return latestByMinor;
}

function topMinors(latestByMinor: Map<string, string>, count = TRACKED_MINOR_COUNT): string[] {
  return [...latestByMinor.keys()]
    .sort((a, b) => compareVersions(b + ".0", a + ".0"))
    .slice(0, count);
}

async function fetchFoundryVersion(): Promise<string> {
  console.log("[monitor] Fetching latest Foundry VTT version...");
  const html = execSync("curl -sf https://foundryvtt.com/releases/", { encoding: "utf8" });
  const stableMatch = html.match(
    /<a href="\/releases\/([\d.]+)"[^>]*>Release [\d.]+<\/a>[\s\S]{0,500}?<span class="release-tag stable">Stable<\/span>/,
  );
  if (stableMatch) return stableMatch[1];
  const fallbackMatch = html.match(/Version ([\d.]+)/);
  if (!fallbackMatch) throw new Error("Failed to parse Foundry version from releases page.");
  return fallbackMatch[1];
}

async function run() {
  try {
    const registryPath = path.join(process.cwd(), "verified-versions.json");
    let registry: RegistryEntry[] = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    const retiredPath = path.join(process.cwd(), "retired-versions.json");
    const retired: RegistryEntry[] = fs.existsSync(retiredPath)
      ? JSON.parse(fs.readFileSync(retiredPath, "utf8"))
      : [];

    const foundryLatest = await fetchFoundryVersion();
    const systems = ["dnd5e", "pf2e"];
    let updated = false;

    const stableFvttVersions = [
      ...new Set(registry.filter((e) => e.status === "stable").map((e) => e.fvtt)),
    ];

    // Always include the current latest build alongside every historically-
    // stable one, not just as a one-time gate for a brand-new generation -
    // otherwise, once a generation's first build goes stable, later patches
    // within that same generation (e.g. 14.360 -> 14.365) never get checked
    // again, silently missing any system that bumps its minimum FVTT build
    // requirement past the one we happen to be pinned on. A build fully
    // retired by retire-superseded.ts (no live stable row left for any
    // minor) drops out of stableFvttVersions and stops being scanned
    // entirely - accepted, since the always-current latest build already
    // provides equivalent forward-looking signal. A build with at least one
    // live minor stays in fvttToCheck; hasExistingEntry below also checks
    // retired-versions.json so a retired (fvtt, system, minor) triple isn't
    // mistaken for "never checked" and re-queued as pending, which would
    // otherwise re-verify it at real cost only to have it immediately
    // re-retired the next night.
    const majorFoundry = foundryLatest.split(".")[0];
    const hasGenerationStable = registry.some(
      (e) => e.status === "stable" && e.fvtt.startsWith(`${majorFoundry}.`),
    );
    if (!hasGenerationStable) {
      console.log(`[monitor] New Foundry generation detected: ${foundryLatest}`);
    }
    const fvttToCheck = [...new Set([...stableFvttVersions, foundryLatest])];

    console.log(
      `[monitor] FVTT latest: ${foundryLatest} | Checking ${fvttToCheck.length} version(s)`,
    );

    for (const systemId of systems) {
      const latestByMinor = await fetchLatestByMinor(systemId);
      const minors = topMinors(latestByMinor);
      console.log(`[monitor] ${systemId} top ${TRACKED_MINOR_COUNT} minors: ${minors.join(", ")}`);

      for (const fvtt of fvttToCheck) {
        for (const minor of minors) {
          const latestPatch = latestByMinor.get(minor)!;

          // Registry key is (fvtt, system, systemMinor) — one entry per minor.
          // Any existing stable, pending, or incompatible row suppresses a new
          // entry - checking retired-versions.json too means a row
          // retire-superseded.ts already archived still suppresses it.
          const hasExistingEntry =
            registry.some(
              (e) => e.fvtt === fvtt && e.system === systemId && e.systemMinor === minor,
            ) ||
            retired.some(
              (e) => e.fvtt === fvtt && e.system === systemId && e.systemMinor === minor,
            );
          if (hasExistingEntry) continue;

          if (!isCompatibleWithFvtt(systemId, latestPatch, fvtt)) {
            const rangeNote = formatCompatRange(fetchCompatRange(systemId, latestPatch));
            console.log(
              `[monitor] Incompatible: ${systemId} v${latestPatch} (${rangeNote}) with FVTT ${fvtt}`,
            );
            registry.push({
              fvtt,
              system: systemId,
              systemMinor: minor,
              systemVersion: latestPatch,
              status: "incompatible",
              timestamp: new Date().toISOString(),
              notes: `System declares compatibility ${rangeNote}; incompatible with FVTT ${fvtt}.`,
            });
            updated = true;
            continue;
          }

          console.log(
            `[monitor] Queuing: ${systemId} v${latestPatch} (minor ${minor}) for FVTT ${fvtt}`,
          );
          const verifyCmd = `npm run verify:local -- --docker --version ${fvtt} --system ${systemId} --system-minor ${minor} --update-registry --git-commit`;
          registry.push({
            fvtt,
            system: systemId,
            systemMinor: minor,
            systemVersion: latestPatch,
            status: "pending",
            timestamp: new Date().toISOString(),
            notes: `Automated detection. Run verification: \`${verifyCmd}\``,
          });
          updated = true;
        }
      }
    }

    if (updated) {
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      console.log("[monitor] Registry updated with pending entries.");
    } else {
      console.log("[monitor] No new releases detected.");
    }
  } catch (error: unknown) {
    console.error("[monitor] Error:", (error as Error).message);
    process.exit(1);
  }
}

run();
