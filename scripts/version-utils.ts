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
