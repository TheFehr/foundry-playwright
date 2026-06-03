import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

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
  status: "stable" | "pending" | "incompatible";
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
  // pf2e: tag is bare version number
  if (/^\d+\.\d+\.\d+$/.test(tag)) return tag;
  return null;
}

function minorOf(version: string): string {
  const [major, minor] = version.split(".");
  return `${major}.${minor}`;
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
      return `https://github.com/foundryvtt/pf2e/releases/download/${version}/system.json`;
    default:
      return null;
  }
}

interface CompatRange {
  minimum?: number;
  maximum?: number;
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
    if (compat["minimum"]) result.minimum = parseInt(String(compat["minimum"]).split(".")[0], 10);
    if (compat["maximum"]) result.maximum = parseInt(String(compat["maximum"]).split(".")[0], 10);
    compatCache.set(key, result);
    return result;
  } catch {
    compatCache.set(key, {});
    return {};
  }
}

function isCompatibleWithFvtt(
  systemId: string,
  systemVersion: string,
  fvttVersion: string,
): boolean {
  const fvttMajor = parseInt(fvttVersion.split(".")[0], 10);
  const { minimum, maximum } = fetchCompatRange(systemId, systemVersion);
  if (minimum !== undefined && fvttMajor < minimum) return false;
  if (maximum !== undefined && fvttMajor > maximum) return false;
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

    // Include new Foundry generation if not yet tracked
    const majorFoundry = foundryLatest.split(".")[0];
    const hasGeneration = registry.some((e) => e.fvtt.startsWith(`${majorFoundry}.`));
    const fvttToCheck = hasGeneration ? stableFvttVersions : [...stableFvttVersions, foundryLatest];

    if (!hasGeneration) {
      console.log(`[monitor] New Foundry generation detected: ${foundryLatest}`);
    }

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

          const hasCurrentStable = registry.some(
            (e) =>
              e.fvtt === fvtt &&
              e.system === systemId &&
              e.systemMinor === minor &&
              e.status === "stable" &&
              e.systemVersion === latestPatch,
          );
          if (hasCurrentStable) continue;

          const hasCurrentPending = registry.some(
            (e) =>
              e.fvtt === fvtt &&
              e.system === systemId &&
              e.systemMinor === minor &&
              e.status === "pending" &&
              e.systemVersion === latestPatch,
          );
          if (hasCurrentPending) continue;

          if (!isCompatibleWithFvtt(systemId, latestPatch, fvtt)) {
            const alreadyIncompatible = registry.some(
              (e) =>
                e.fvtt === fvtt &&
                e.system === systemId &&
                e.systemMinor === minor &&
                e.status === "incompatible" &&
                e.systemVersion === latestPatch,
            );
            if (alreadyIncompatible) continue;

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
              notes: `System declares compatibility ${rangeNote}; incompatible with FVTT ${fvtt.split(".")[0]}.`,
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
