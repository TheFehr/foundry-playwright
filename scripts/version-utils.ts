export function minorOf(version: string): string {
  const [major, minor] = version.split(".");
  return major && minor ? `${major}.${minor}` : "unknown";
}
