import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { majorOf, compareVersions } from "./version-utils.js";

/**
 * Archives "stable" registry rows superseded by a newer FVTT build within
 * the same major generation, for the same (system, systemMinor) - see
 * docs/rfcs/continuous-verification.md. Run before `npm run verify`, not
 * after: the entries this retires are typically already "stable" from past
 * runs, so pruning first shrinks the set an upcoming sweep is about to
 * target instead of tidying up too late to help that sweep's own duration.
 *
 * Scoped to "stable" only - "incompatible"/"failed" rows cost nothing at
 * sweep time (nothing ever sweeps them), so they aren't part of the
 * accumulation problem this exists to fix.
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

interface RetiredEntry extends RegistryEntry {
  retiredAt: string;
  supersededBy: string;
}

function run() {
  const registryPath = path.join(process.cwd(), "verified-versions.json");
  const retiredPath = path.join(process.cwd(), "retired-versions.json");

  const registry: RegistryEntry[] = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const retired: RetiredEntry[] = fs.existsSync(retiredPath)
    ? JSON.parse(fs.readFileSync(retiredPath, "utf8"))
    : [];

  const groups = new Map<string, RegistryEntry[]>();
  for (const entry of registry) {
    if (entry.status !== "stable") continue;
    const key = `${majorOf(entry.fvtt)}|${entry.system}|${entry.systemMinor}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const supersededBy = new Map<RegistryEntry, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => compareVersions(a.fvtt, b.fvtt));
    const keep = sorted[sorted.length - 1]!;
    for (const entry of sorted.slice(0, -1)) {
      supersededBy.set(entry, keep.fvtt);
    }
  }

  if (supersededBy.size === 0) {
    console.log("[retire-superseded] Nothing superseded.");
    return;
  }

  const now = new Date().toISOString();
  for (const [entry, keptFvtt] of supersededBy) {
    // A crash between the two writes below can leave this run's retirements
    // already archived but not yet removed from the active registry - a
    // retry would then recompute the same supersession and land here again.
    // Skip re-archiving anything already recorded, so a retry can't pile up
    // duplicate rows for the same (fvtt, system, systemMinor).
    const alreadyArchived = retired.some(
      (r) =>
        r.fvtt === entry.fvtt && r.system === entry.system && r.systemMinor === entry.systemMinor,
    );
    if (alreadyArchived) {
      console.log(
        `[retire-superseded] ${entry.fvtt} ${entry.system} v${entry.systemVersion} already archived - removing from the active registry only.`,
      );
      continue;
    }
    console.log(
      `[retire-superseded] Retiring ${entry.fvtt} ${entry.system} v${entry.systemVersion} (superseded by ${keptFvtt}).`,
    );
    retired.push({ ...entry, retiredAt: now, supersededBy: keptFvtt });
  }
  const remaining = registry.filter((e) => !supersededBy.has(e));

  // Archive first, then shrink the active registry: an interruption between
  // the two writes then leaves an entry temporarily duplicated in both files
  // rather than lost from both (the dedup check above keeps a retry from
  // double-archiving it either way).
  fs.writeFileSync(retiredPath, JSON.stringify(retired, null, 2) + "\n");
  fs.writeFileSync(registryPath, JSON.stringify(remaining, null, 2) + "\n");

  try {
    execFileSync("git", ["add", "verified-versions.json", "retired-versions.json"]);
    execFileSync("git", [
      "commit",
      "-m",
      `chore(registry): retire ${supersededBy.size} superseded stable entr${supersededBy.size === 1 ? "y" : "ies"}`,
      "--",
      "verified-versions.json",
      "retired-versions.json",
    ]);
    console.log("[retire-superseded] Committed.");
  } catch (e) {
    console.error(`[retire-superseded] Failed to commit: ${(e as Error).message}`);
    process.exit(1);
  }
}

run();
