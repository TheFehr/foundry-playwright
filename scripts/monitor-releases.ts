import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { minorOf } from "./version-utils.js";

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

function compareVersions(a: string, b: string): number {
  const ap = a.split(".").map(Number);
  const bp = b.split(".").map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const diff = (ap[i] ?? 0) - (bp[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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

function buildManifestUrl(systemId: string, version: string): string | null {
  switch (systemId) {
    case "dnd5e":
      return `https://github.com/foundryvtt/dnd5e/releases/download/release-${version}/system.json`;
    case "pf2e":
      return `https://github.com/foundryvtt/pf2e/releases/download/pf2e-${version}/system.json`;
    default:
      return null;
  }
}

interface CompatRange {
  minimum?: string;
  maximum?: string;
}

const compatCache = new Map<string, CompatRange>();

function fetchCompatRange(systemId: string, version: string): CompatRange {
  const key = `${systemId}@${version}`;
  if (compatCache.has(key)) return compatCache.get(key)!;

  const url = buildManifestUrl(systemId, version);
  if (!url) return {};

  try {
    const json = execSync(`curl -sfL "${url}"`, { encoding: "utf8" });
    const manifest = JSON.parse(json) as { compatibility?: Record<string, string> };
    const compat = manifest.compatibility ?? {};
    const result: CompatRange = {};
    if (compat["minimum"]) result.minimum = String(compat["minimum"]);
    if (compat["maximum"]) result.maximum = String(compat["maximum"]);
    compatCache.set(key, result);
    return result;
  } catch {
    compatCache.set(key, {});
    return {};
  }
}

// A bare-major maximum (e.g. "14") means "compatible through all of 14.x" -
// normalize it to an exclusive ceiling at the next major so a full version
// compare against e.g. "14.360.0" doesn't wrongly treat it as exceeding "14".
// A bare-major minimum needs no such adjustment: compareVersions already
// treats missing components as 0, so "14" naturally floors at 14.0.0.
function normalizeMaximum(bound: string): string {
  const parts = bound.split(".");
  if (parts.length > 1) return bound;
  return `${parseInt(parts[0]!, 10) + 1}.0.0`;
}

function isCompatibleWithFvtt(
  systemId: string,
  systemVersion: string,
  fvttVersion: string,
): boolean {
  const { minimum, maximum } = fetchCompatRange(systemId, systemVersion);
  if (minimum !== undefined && compareVersions(fvttVersion, minimum) < 0) return false;
  if (maximum !== undefined && compareVersions(fvttVersion, normalizeMaximum(maximum)) >= 0)
    return false;
  return true;
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
    // requirement past the one we happen to be pinned on. Old stable rows
    // for superseded builds are untouched history (registry key includes
    // fvtt, so a new build just adds new rows).
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
          // Any existing stable, pending, or incompatible row suppresses a new entry.
          const hasExistingEntry = registry.some(
            (e) => e.fvtt === fvtt && e.system === systemId && e.systemMinor === minor,
          );
          if (hasExistingEntry) continue;

          if (!isCompatibleWithFvtt(systemId, latestPatch, fvtt)) {
            const { minimum, maximum } = fetchCompatRange(systemId, latestPatch);
            const rangeNote = [
              minimum !== undefined ? `minimum: ${minimum}` : null,
              maximum !== undefined ? `maximum: ${maximum}` : null,
            ]
              .filter(Boolean)
              .join(", ");
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
