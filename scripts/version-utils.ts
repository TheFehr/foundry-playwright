import { execSync } from "child_process";

export function minorOf(version: string): string {
  const [major, minor] = version.split(".");
  return major && minor ? `${major}.${minor}` : "unknown";
}

export function majorOf(version: string): string {
  return version.split(".")[0] ?? "unknown";
}

export function compareVersions(a: string, b: string): number {
  const ap = a.split(".").map(Number);
  const bp = b.split(".").map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const diff = (ap[i] ?? 0) - (bp[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function buildManifestUrl(systemId: string, version: string): string | null {
  switch (systemId) {
    case "dnd5e":
      return `https://github.com/foundryvtt/dnd5e/releases/download/release-${version}/system.json`;
    case "pf2e":
      return `https://github.com/foundryvtt/pf2e/releases/download/pf2e-${version}/system.json`;
    default:
      return null;
  }
}

export interface CompatRange {
  minimum?: string;
  maximum?: string;
}

const compatCache = new Map<string, CompatRange>();

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

// Fetches systemId@version's manifest and reads its declared compatibility
// range. Cached per (systemId, version) for the process's lifetime - a
// published version's compatibility range is immutable, and both
// monitor-releases.ts and verify-local.ts can end up checking the same
// (systemId, version) more than once in a single run.
export function fetchCompatRange(systemId: string, version: string): CompatRange {
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

export function isCompatibleWithFvtt(
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

// Formats a compat range as "minimum: X, maximum: Y" (only the bounds that
// are actually declared) for registry notes - shared so verify-local.ts's
// incompatible-skip note reads identically to monitor-releases.ts's.
export function formatCompatRange(range: CompatRange): string {
  return [
    range.minimum !== undefined ? `minimum: ${range.minimum}` : null,
    range.maximum !== undefined ? `maximum: ${range.maximum}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
