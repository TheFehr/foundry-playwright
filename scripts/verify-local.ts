import { execSync, execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import { DockerFoundryOrchestrator, getHostUidGid, isPodmanRuntime } from "../src/docker.js";
import { Command } from "commander";
import {
  minorOf,
  buildManifestUrl,
  isCompatibleWithFvtt,
  fetchCompatRange,
  formatCompatRange,
} from "./version-utils.js";

/**
 * Local Verification Script
 *
 * Orchestrates a Docker-based Foundry instance and runs the verification suite.
 * Supports pinning a specific system version via --system-minor (resolves latest
 * patch for that minor from GitHub) or --system-version (exact version).
 */

interface TestFailure {
  title: string;
  error?: string;
}

// The single source of truth for "what library version is this run
// verifying with" - release.yml bumps this same field in the same commit
// it bumps CHANGELOG.md/package-lock.json, so reading it live here means
// nothing else needs to separately track or shadow it.
function getPackageVersion(): string {
  const pkgPath = path.join(process.cwd(), "package.json");
  return (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string }).version;
}

function formatFailures(failures: TestFailure[]): string {
  return failures.map((f) => (f.error ? `${f.title} (${f.error})` : f.title)).join("; ");
}

const SYSTEM_REPOS: Record<string, string> = {
  dnd5e: "foundryvtt/dnd5e",
  pf2e: "foundryvtt/pf2e",
};

function extractVersionTag(tag: string, systemId: string): string | null {
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

/**
 * Applies one consistent trust rule for both the success and failure
 * registry-write paths: only ever record a system version we actually know,
 * either from validated captured metadata, or from the originally-requested
 * systemVersion when it was actually pinned via a manifest URL this run
 * (manifestUrl only supports dnd5e/pf2e - for any other system, or no
 * version requested at all, Foundry just installs whatever "latest" its own
 * resolver picks, which may have no relation to the requested version at
 * all). Returns "unknown" when neither source establishes it.
 */
function resolveVerifiedSystemVersion(
  capturedVersion: string,
  manifestUrl: string | null,
  requestedSystemVersion: string | undefined,
): string {
  if (capturedVersion !== "unknown") return capturedVersion;
  return manifestUrl ? (requestedSystemVersion ?? "unknown") : "unknown";
}

function filterRealModules(
  modules: { id: string; version: string }[],
): { id: string; version: string }[] {
  return modules.filter((m) => m.id !== "fake-module");
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
      "[verify] gh not available or not logged in — using unauthenticated GitHub API (60 req/hr limit).",
    );
  }
  return "";
}

async function resolveLatestPatch(systemId: string, minor: string): Promise<string> {
  const repo = SYSTEM_REPOS[systemId];
  if (!repo) throw new Error(`Cannot resolve patch for unknown system: ${systemId}`);
  console.log(`[verify] Resolving latest patch for ${systemId} minor ${minor}...`);
  const authHeader = getGithubAuthHeader();
  const json = execSync(
    `curl -sf ${authHeader} -H "Accept: application/vnd.github.v3+json" -H "User-Agent: foundry-playwright/verify" "https://api.github.com/repos/${repo}/releases?per_page=100"`,
    { encoding: "utf8" },
  );
  const releases: { tag_name: string; prerelease: boolean; draft: boolean }[] = JSON.parse(json);
  let latest: string | null = null;
  for (const release of releases) {
    if (release.prerelease || release.draft) continue;
    const version = extractVersionTag(release.tag_name, systemId);
    if (!version || !version.startsWith(`${minor}.`)) continue;
    if (!latest || compareVersions(version, latest) > 0) latest = version;
  }
  if (!latest) throw new Error(`No release found for ${systemId} minor ${minor}`);
  console.log(`[verify] Resolved ${systemId} minor ${minor} → v${latest}`);
  return latest;
}

interface RegistryEntryWrite {
  fvtt: string;
  system: string;
  systemMinor: string;
  systemVersion: string;
  modules?: { id: string; version: string }[];
  status: "stable" | "failed" | "incompatible";
  timestamp: string;
  notes: string;
  // The foundry-playwright version this entry was actually tested under -
  // lets a later run tell "verified, but against older library code" apart
  // from "verified against what's on disk right now" without a separate
  // cross-run state file. See docs/rfcs/continuous-verification.md.
  verifiedWith: string;
}

function upsertRegistryEntry(entry: RegistryEntryWrite): void {
  const registryPath = path.join(process.cwd(), "verified-versions.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

  if (!Array.isArray(registry)) {
    throw new Error(
      `${registryPath} does not contain a JSON array (got ${typeof registry}); refusing to overwrite it with an empty registry. Fix the file manually.`,
    );
  }

  const entryIdx = (registry as Record<string, unknown>[]).findIndex(
    (e) =>
      e["fvtt"] === entry.fvtt &&
      e["system"] === entry.system &&
      e["systemMinor"] === entry.systemMinor,
  );
  if (entryIdx !== -1) {
    registry[entryIdx] = entry;
  } else {
    registry.push(entry);
  }

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

interface MarkdownSummaryRow {
  version: string;
  system: string;
  modules: string;
  status: string;
  date: string;
  docker: string;
  notes?: string;
}

// "|" would otherwise break table row parsing/rendering if a raw error
// message happens to contain one (e.g. a CSS attribute selector). Backslash-
// escaping it (the usual Markdown convention) doesn't work here because the
// row parser below does a plain split("|") with no escape awareness - an
// escaped "\|" still contains a literal "|" that gets split on and silently
// truncates the cell on the very next read/write round-trip. An HTML numeric
// entity survives that split intact and is reversible (unlike a lookalike
// character substitution), so long as "&" is encoded first/decoded last -
// otherwise a literal "&" in the source text would corrupt the "&#124;"
// sequence itself.
function escapeForMarkdownTable(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/\|/g, "&#124;");
}

function unescapeFromMarkdownTable(value: string): string {
  return value.replace(/&#124;/g, "|").replace(/&amp;/g, "&");
}

// Shared by both the pass and fail paths in verifyVersion so a genuine test
// failure still shows up here, not just in verified-versions.json - a FAIL
// row silently missing from this report previously hid real results (caught
// by CodeRabbit on the first PR that actually recorded one).
function upsertMarkdownSummary(row: MarkdownSummaryRow): void {
  const summaryPath = path.join(process.cwd(), "verification-report.md");
  let summaryContent =
    "# Verification Summary Report\n\n| Version | System | Modules | Status | Date | Docker | Notes |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n";

  let existingResults: MarkdownSummaryRow[] = [];
  if (fs.existsSync(summaryPath)) {
    const lines = fs.readFileSync(summaryPath, "utf8").split("\n");
    existingResults = lines
      .filter((l) => l.trim().startsWith("|"))
      .map((r) =>
        // Slice off only the empty boundary artifacts from the leading/
        // trailing "|" - filtering all empty strings (as before) would also
        // drop a legitimately empty interior cell, like a PASS row's notes.
        r
          .split("|")
          .slice(1, -1)
          .map((p) => unescapeFromMarkdownTable(p.trim())),
      )
      // A formatter (oxfmt/prettier) pads table cells with extra spaces to
      // align columns, so the header/separator can't be matched by a fixed
      // substring like "Version | System" - compare normalized cell values
      // instead, and drop the separator row by its ":---"-only cell shape.
      // Legacy rows (written before the Notes column existed) only have 6
      // cells - still accepted, notes just comes back empty for those.
      .filter((cells) => cells.length >= 6 && cells[0] !== "Version" && !/^:?-+:?$/.test(cells[0]))
      .map((cells) => ({
        version: cells[0],
        system: cells[1],
        modules: cells[2],
        status: cells[3],
        date: cells[4],
        docker: cells[5],
        notes: cells[6] || undefined,
      }));
  }

  const existingIdx = existingResults.findIndex(
    (r) => r.version === row.version && r.system === row.system,
  );
  if (existingIdx !== -1) {
    existingResults[existingIdx] = row;
  } else {
    existingResults.push(row);
  }

  existingResults.sort((a, b) =>
    (b.version as string).localeCompare(a.version as string, undefined, { numeric: true }),
  );

  existingResults.forEach((r) => {
    const notes = r.notes ? escapeForMarkdownTable(r.notes) : "";
    summaryContent += `| ${r.version} | ${r.system} | ${r.modules} | ${r.status} | ${r.date} | ${r.docker} | ${notes} |\n`;
  });

  fs.writeFileSync(summaryPath, summaryContent);
  console.log(`Summary updated: ${summaryPath}`);
}

function getPlaywrightImageTag(): string {
  const pkgPath = path.join(process.cwd(), "node_modules", "@playwright", "test", "package.json");
  const { version } = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
  return `mcr.microsoft.com/playwright:v${version}-noble`;
}

/**
 * Runs the Playwright test suite inside Microsoft's official Playwright image
 * instead of on the host. Keeps the host OS entirely out of Playwright's
 * browser/dependency support matrix. Only explicitly listed env vars are
 * forwarded (not the full host environment, which would clobber the
 * container's own PATH/HOME) and secret values are never placed in argv —
 * `-e KEY` (no value) makes docker forward it from its own process env.
 */
function runPlaywrightInContainer(
  testFiles: string[],
  playwrightArgs: string[],
  containerEnv: Record<string, string | undefined>,
  rootless: boolean,
): void {
  const image = getPlaywrightImageTag();
  const envFlags = Object.entries(containerEnv)
    .filter(([, v]) => v !== undefined)
    .flatMap(([k]) => ["-e", k]);
  const ids = getHostUidGid();

  // The real FOUNDRY_USERNAME/PASSWORD/ADMIN_KEY live in a `.env` at the repo
  // root (see nightly VM setup) and are already forwarded explicitly via
  // envFlags above — the container never needs to read the file itself.
  // Bind-mounting the whole checkout below would otherwise still hand any
  // code running in the container (Playwright's own reporters, a transitive
  // dependency already in node_modules) direct read access to it, reachable
  // over `--network host`. Overlay each matching file with /dev/null so it
  // reads as empty inside the container regardless.
  const envFileHideFlags = fs
    .readdirSync(process.cwd())
    .filter((f) => f === ".env" || f.startsWith(".env."))
    .flatMap((f) => ["-v", `/dev/null:/work/${f}:ro`]);

  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "host",
      // Chromium can crash under a container's default 64MB /dev/shm.
      "--shm-size=1gb",
      // No host POSIX identity to match on Windows (process.getuid/getgid
      // are undefined there) - run as the container's own default user.
      ...(ids ? ["--user", `${ids.uid}:${ids.gid}`] : []),
      // See DockerOrchestratorConfig.rootless / isPodmanRuntime in
      // src/docker.ts - --userns=keep-id is Podman-specific syntax, so only
      // add it when the docker binary is actually Podman under the hood.
      ...(ids && rootless && isPodmanRuntime() ? ["--userns=keep-id"] : []),
      "-e",
      "HOME=/tmp",
      ...envFlags,
      "-v",
      `${process.cwd()}:/work`,
      ...envFileHideFlags,
      "-w",
      "/work",
      image,
      "npx",
      "playwright",
      "test",
      ...testFiles,
      "--workers=1",
      "--reporter=line,json",
      ...playwrightArgs,
    ],
    { stdio: "inherit", env: { ...process.env, ...containerEnv } },
  );
}

interface VerifyVersionOptions {
  system: string;
  modules: string[];
  systemVersion: string | undefined;
  isDocker: boolean;
  updateRegistry: boolean;
  recordFailures: boolean;
  keepContainer: boolean;
}

async function verifyVersion(
  version: string,
  options: VerifyVersionOptions,
): Promise<{ success: boolean; failures: TestFailure[]; skipped?: boolean; recorded: boolean }> {
  const {
    system,
    modules,
    systemVersion,
    isDocker,
    updateRegistry,
    recordFailures,
    keepContainer,
  } = options;
  console.log(
    `\n--- Verifying Version: ${version} (System: ${system}${systemVersion ? ` v${systemVersion}` : ""}, Modules: ${modules.join(", ") || "none"}) ---`,
  );

  // Fail fast on a known compatibility mismatch, before ever touching Docker
  // or Playwright: a system version whose manifest already declares it
  // incompatible with this FVTT build can never pass, regardless of how many
  // times it's retried. Checking this up front (a single manifest fetch)
  // instead of only discovering it 10-40 minutes into a doomed browser-based
  // install is what actually stops a stable-resweep or pending run from
  // burning its whole time budget on an outcome that was already knowable -
  // this exact scenario ate an entire nightly run's 3.5-hour timeout window
  // retrying the same incompatible combo across several registry rows.
  // Only possible when systemVersion is actually known (a manifest pin from
  // --system-version/--system-minor, a pending target, or a pinned
  // stable-resweep target) - an unpinned ad hoc run has nothing to check yet.
  if (systemVersion && !(await isCompatibleWithFvtt(system, systemVersion, version))) {
    const rangeNote = formatCompatRange(await fetchCompatRange(system, systemVersion));
    console.log(
      `--- Skipping ${version} (System: ${system} v${systemVersion}): declares compatibility ${rangeNote}; incompatible with FVTT ${version}. ---`,
    );
    // registry and markdown writes are caught independently (not one shared
    // try/catch) so a markdown-write hiccup can never erase a `recorded`
    // that a preceding, already-successful registry write earned - recorded
    // must reflect only the registry write's own outcome.
    let recorded = false;
    try {
      if (updateRegistry) {
        upsertRegistryEntry({
          fvtt: version,
          system,
          systemMinor: minorOf(systemVersion),
          systemVersion,
          status: "incompatible",
          timestamp: new Date().toISOString(),
          notes: `System declares compatibility ${rangeNote}; incompatible with FVTT ${version}.`,
          verifiedWith: getPackageVersion(),
        });
        recorded = true;
      }
    } catch (persistError) {
      console.error(
        `[verifyVersion] Failed to persist incompatible-skip registry entry for ${version}: ${(persistError as Error).message}`,
      );
      recorded = false;
    }
    try {
      upsertMarkdownSummary({
        version,
        system: `${system} (v${systemVersion})`,
        modules: modules.join(", ") || "none",
        status: "INCOMPATIBLE",
        date: new Date().toISOString().split("T")[0],
        docker: isDocker ? "Yes" : "No",
        notes: rangeNote,
      });
    } catch (persistError) {
      console.error(
        `[verifyVersion] Failed to persist incompatible-skip markdown summary for ${version}: ${(persistError as Error).message}`,
      );
    }
    return { success: true, failures: [], skipped: true, recorded };
  }

  let foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  const rootless = process.env.FOUNDRY_PLAYWRIGHT_ROOTLESS === "1";
  let orchestrator: DockerFoundryOrchestrator | null = null;
  let tmpDataDir: string | null = null;
  let failures: TestFailure[] = [];
  let meta = {
    foundry: version,
    system: { id: system, version: "unknown" },
    modules: [] as { id: string; version: string }[],
  };

  try {
    if (isDocker) {
      tmpDataDir = path.join(
        process.cwd(),
        ".foundry_test_data",
        `.foundry_data_tmp_${version}_${Date.now()}`,
      );

      orchestrator = new DockerFoundryOrchestrator({
        version: version,
        adminKey: process.env.FOUNDRY_ADMIN_KEY || "password",
        dataDir: tmpDataDir,
        rootless,
      });

      // Inject all local modules from e2e/ into the container
      const e2ePath = path.join(process.cwd(), "e2e");
      const items = fs.readdirSync(e2ePath);
      for (const item of items) {
        const itemPath = path.join(e2ePath, item);
        if (
          fs.statSync(itemPath).isDirectory() &&
          fs.existsSync(path.join(itemPath, "module.json"))
        ) {
          console.log(`Injecting local module: ${item}`);
          const modulesDir = path.join(tmpDataDir, "Data", "modules", item);
          fs.mkdirSync(modulesDir, { recursive: true });
          fs.cpSync(itemPath, modulesDir, { recursive: true });
        }
      }

      const url = await orchestrator.start();
      console.log(`Foundry is up at ${url}`);
      foundryUrl = url;
    }

    console.log(`Verifying against: ${foundryUrl}`);

    // Build system manifest URL if a specific version is pinned
    const manifestUrl = systemVersion ? buildManifestUrl(system, systemVersion) : null;
    if (systemVersion && !manifestUrl) {
      console.warn(`[verify] No manifest URL builder for system "${system}"; installing latest.`);
    }

    // Run E2E tests
    const env: Record<string, string> = {
      ...process.env,
      FOUNDRY_URL: foundryUrl,
      FOUNDRY_VERSION: version,
      FOUNDRY_SYSTEM_ID: system,
      FOUNDRY_UI_ADAPTER: process.env.FOUNDRY_UI_ADAPTER || system,
      FOUNDRY_MODULE_IDS: modules.join(","),
    };
    if (manifestUrl) {
      env["FOUNDRY_SYSTEM_MANIFEST"] = manifestUrl;
      console.log(`[verify] Pinning system manifest: ${manifestUrl}`);
    }

    // Pass through common Playwright flags
    const playwrightArgs = process.argv.filter(
      (a) => a.startsWith("--ui") || a.startsWith("--headed") || a.startsWith("--debug"),
    );

    const testFiles = [
      "e2e/verify.spec.ts",
      "e2e/user-management.spec.ts",
      "e2e/mixed-module-install.spec.ts",
    ];
    // Unique per run (not just per version), and removed up front - a
    // previous run at this same path that crashed before reaching its own
    // cleanup could otherwise leave a stale report behind for this run to
    // misread as its own results.
    const reportPath = path.join(
      process.cwd(),
      `.playwright-report-${version}-${Date.now()}-${process.pid}.json`,
    );
    fs.rmSync(reportPath, { force: true });
    // Namespaced the same way as reportPath - a single --all-pending run does
    // several separate `playwright test` invocations back to back, and each
    // one clears its own default test-results/ output dir at startup, which
    // would otherwise wipe out an earlier combo's trace/screenshot before
    // anyone gets to look at it.
    const outputDirName = `test-results-${version}-${Date.now()}-${process.pid}`;
    const outputDir = path.join(process.cwd(), outputDirName);
    const metaPath = path.join(process.cwd(), ".foundry_metadata.json");
    fs.rmSync(metaPath, { force: true });
    let execError: Error | null = null;
    try {
      if (isDocker) {
        // The container mounts process.cwd() at /work, so the path we hand
        // to Playwright's own JSON reporter (running inside the container)
        // must be rewritten relative to that mount point - the host's
        // absolute reportPath doesn't exist inside the container's
        // filesystem at all.
        const reportPathInContainer = `/work/${path.relative(process.cwd(), reportPath)}`;
        const outputDirInContainer = `/work/${outputDirName}`;
        runPlaywrightInContainer(
          testFiles,
          [...playwrightArgs, `--output=${outputDirInContainer}`],
          {
            FOUNDRY_URL: env["FOUNDRY_URL"],
            FOUNDRY_VERSION: env["FOUNDRY_VERSION"],
            FOUNDRY_SYSTEM_ID: env["FOUNDRY_SYSTEM_ID"],
            FOUNDRY_UI_ADAPTER: env["FOUNDRY_UI_ADAPTER"],
            FOUNDRY_MODULE_IDS: env["FOUNDRY_MODULE_IDS"],
            FOUNDRY_SYSTEM_MANIFEST: env["FOUNDRY_SYSTEM_MANIFEST"],
            FOUNDRY_ADMIN_KEY: process.env.FOUNDRY_ADMIN_KEY,
            FOUNDRY_ADMIN_PASSWORD: process.env.FOUNDRY_ADMIN_PASSWORD,
            FOUNDRY_USERNAME: process.env.FOUNDRY_USERNAME,
            FOUNDRY_PASSWORD: process.env.FOUNDRY_PASSWORD,
            FOUNDRY_LICENSE_KEY: process.env.FOUNDRY_LICENSE_KEY,
            PLAYWRIGHT_JSON_OUTPUT_NAME: reportPathInContainer,
          },
          rootless,
        );
      } else {
        execFileSync(
          "npx",
          [
            "playwright",
            "test",
            ...testFiles,
            "--workers=1",
            "--reporter=line,json",
            `--output=${outputDir}`,
            ...playwrightArgs,
          ],
          {
            stdio: "inherit",
            env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
          },
        );
      }
    } catch (e) {
      execError = e as Error;
    }

    if (fs.existsSync(reportPath)) {
      const rawContent = fs.readFileSync(reportPath, "utf8");
      fs.unlinkSync(reportPath);
      let validReport = false;
      let specCount = 0;
      try {
        const rawReport: unknown = JSON.parse(rawContent);
        if (isPlaywrightReport(rawReport)) {
          validReport = true;
          failures = extractFailures(rawReport);
          specCount = countSpecs(rawReport);
        }
      } catch {
        // Corrupted/truncated report - fold into the same "malformed"
        // diagnostic below instead of letting a raw JSON.parse error
        // escape and override execError precedence.
        validReport = false;
      }
      if (!validReport) {
        // The report doesn't have the expected shape (corrupted or
        // unexpected content) - don't silently treat this as success just
        // because some report file exists.
        throw (
          execError ??
          new Error(`Malformed Playwright report at ${reportPath}: missing "suites" array.`)
        );
      }
      if (specCount === 0) {
        // A well-formed report with zero specs (e.g. a test-file pattern
        // matched nothing, or a config issue skipped everything) is no
        // evidence anything was actually verified - don't record it as a
        // pass just because it happens to show zero failures too.
        throw (
          execError ??
          new Error(
            `Playwright report at ${reportPath} shows zero specs executed - treating as an infrastructure failure.`,
          )
        );
      }
      if (failures.length === 0 && execError) {
        // The process genuinely failed despite an otherwise clean-looking
        // report.
        throw execError;
      }
    } else if (execError) {
      // Playwright failed to start or crashed without producing a report.
      throw execError;
    } else {
      // Exited "successfully" but produced no report at all - no evidence
      // any test actually ran. Don't silently treat that as a pass.
      throw new Error(
        `Playwright exited successfully but produced no report at ${reportPath} - treating as an infrastructure failure.`,
      );
    }

    // Capture versions for the report (best-effort — the metadata test may have
    // run and written this even if a later test in the same run failed).
    console.log("[verifyVersion] Capturing system and module versions...");
    if (fs.existsSync(metaPath)) {
      const rawContent = fs.readFileSync(metaPath, "utf8");
      fs.unlinkSync(metaPath);
      try {
        const rawMeta: unknown = JSON.parse(rawContent);
        if (isCapturedMetadata(rawMeta)) {
          meta = rawMeta;
        } else {
          console.warn(
            `[verifyVersion] Ignoring malformed ${metaPath} - missing expected system.id/version/modules shape; keeping "unknown" version metadata.`,
          );
        }
      } catch (e) {
        console.warn(
          `[verifyVersion] Failed to parse ${metaPath} (${(e as Error).message}); keeping "unknown" version metadata.`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(`Verification failed with ${failures.length} test failures.`);
    }

    console.log(`--- Verification Successful for ${version} ---`);

    // Computed unconditionally (not just under updateRegistry) so the
    // markdown row below always matches the registry's own normalization
    // instead of showing a raw "unknown" version or the fake-module test
    // scaffold when they diverge.
    const realModules = filterRealModules(meta.modules);
    const resolvedSystemVersion = resolveVerifiedSystemVersion(
      meta.system.version,
      manifestUrl,
      systemVersion,
    );

    // Registry and markdown writes are caught independently (not one shared
    // try/catch) so a markdown-write hiccup can never erase a `recorded`
    // that a preceding, already-successful registry write earned - recorded
    // must reflect only the registry write's own outcome.
    let passRecorded = false;
    try {
      if (updateRegistry) {
        if (resolvedSystemVersion === "unknown") {
          console.warn(
            `[verifyVersion] Cannot determine the installed system version for ${version} (metadata missing/invalid and no manifest pin this run) - skipping registry update rather than recording an unverifiable "stable" entry.`,
          );
        } else {
          console.log(`Updating verified-versions.json for ${version}...`);
          upsertRegistryEntry({
            fvtt: version,
            system: meta.system.id,
            systemMinor: minorOf(resolvedSystemVersion),
            systemVersion: resolvedSystemVersion,
            modules: realModules.length > 0 ? realModules : undefined,
            status: "stable",
            timestamp: new Date().toISOString(),
            notes: `Verified locally with ${meta.system.id} v${resolvedSystemVersion}.`,
            verifiedWith: getPackageVersion(),
          });
          console.log("Registry updated successfully.");
          passRecorded = true;
        }
      }
    } catch (persistError) {
      console.error(
        `[verifyVersion] Failed to persist registry entry for ${version}: ${(persistError as Error).message}`,
      );
      passRecorded = false;
    }
    try {
      upsertMarkdownSummary({
        version,
        system: `${meta.system.id} (v${resolvedSystemVersion})`,
        modules: realModules.map((m) => `${m.id}@${m.version}`).join(", ") || "none",
        status: "PASS",
        date: new Date().toISOString().split("T")[0],
        docker: isDocker ? "Yes" : "No",
      });
    } catch (persistError) {
      console.error(
        `[verifyVersion] Failed to persist markdown summary for ${version}: ${(persistError as Error).message}`,
      );
    }
    return { success: true, failures: [], recorded: passRecorded };
  } catch (error: unknown) {
    console.error(`--- Verification Failed for ${version} ---`);
    console.error((error as Error).message);

    let failRecorded = false;
    if (failures.length > 0) {
      // Only genuine test failures land here - Docker/Playwright/report-parsing/
      // metadata errors fall through below, since "failed" is permanent (never
      // retried by --all-pending) and an infra hiccup isn't a real incompatibility.
      //
      // The markdown summary is written below regardless of updateRegistry/
      // recordFailures - a report-only run should still show a real failure,
      // same as the pass path always writes a PASS row regardless of those
      // flags. Only the permanent verified-versions.json entry is gated by
      // them.
      const realModules = filterRealModules(meta.modules);
      // manifestUrl is recomputed here since the one from the try block above
      // is out of scope in this catch block - same resolution rule either way.
      const manifestUrl = systemVersion ? buildManifestUrl(system, systemVersion) : null;
      const resolvedSystemVersion = resolveVerifiedSystemVersion(
        meta.system.version,
        manifestUrl,
        systemVersion,
      );

      if (resolvedSystemVersion === "unknown") {
        console.log(
          `Not recording failure details for ${version}: cannot determine which system version was actually tested (metadata missing/invalid and no manifest pin this run).`,
        );
      } else {
        // Registry and markdown writes are caught independently (not one
        // shared try/catch) so a markdown-write hiccup can never erase a
        // `recorded` that a preceding, already-successful registry write
        // earned - recorded must reflect only the registry write's outcome.
        try {
          if (updateRegistry && recordFailures) {
            console.log(`Recording failure in verified-versions.json for ${version}...`);
            upsertRegistryEntry({
              fvtt: version,
              system: meta.system.id || system,
              systemMinor: minorOf(resolvedSystemVersion),
              systemVersion: resolvedSystemVersion,
              modules: realModules.length > 0 ? realModules : undefined,
              status: "failed",
              timestamp: new Date().toISOString(),
              notes: `Automated verification failed: ${formatFailures(failures)}`,
              verifiedWith: getPackageVersion(),
            });
            console.log("Registry updated with failure entry.");
            failRecorded = true;
          }
        } catch (persistError) {
          console.error(
            `[verifyVersion] Failed to persist failure registry entry for ${version}: ${(persistError as Error).message}`,
          );
          failRecorded = false;
        }
        try {
          upsertMarkdownSummary({
            version,
            system: `${meta.system.id || system} (v${resolvedSystemVersion})`,
            modules: realModules.map((m) => `${m.id}@${m.version}`).join(", ") || "none",
            status: "FAIL",
            date: new Date().toISOString().split("T")[0],
            docker: isDocker ? "Yes" : "No",
            notes: formatFailures(failures),
          });
        } catch (persistError) {
          console.error(
            `[verifyVersion] Failed to persist failure markdown summary for ${version}: ${(persistError as Error).message}`,
          );
        }
      }
    } else if (updateRegistry && recordFailures) {
      console.log(
        `Not recording a failure entry for ${version}: no test failures were collected, so this looks like an infrastructure error rather than a real incompatibility. Leaving the entry pending so --all-pending retries it.`,
      );
    }

    return { success: false, failures, recorded: failRecorded };
  } finally {
    let cleanupFailed = false;
    if (orchestrator && !keepContainer) {
      try {
        await orchestrator.stopAndRemove();
      } catch (e) {
        // A real cleanup failure (not just "container didn't exist" -
        // stopAndRemove() already tolerates that) - don't let this override
        // the actual verification result above, or crash the rest of an
        // --all-pending batch. Retain tmpDataDir instead of removing it out
        // from under a container that may still be running.
        cleanupFailed = true;
        console.error(
          `[verifyVersion] Failed to clean up the Docker container: ${(e as Error).message}. Retaining ${tmpDataDir} for inspection.`,
        );
      }
    }
    if (tmpDataDir && !keepContainer && !cleanupFailed) {
      console.log(`Cleaning up temporary data directory: ${tmpDataDir}`);
      try {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      } catch (e) {
        // Same reasoning as the container-cleanup catch above - don't let
        // this override the actual verification result or crash the rest
        // of an --all-pending batch.
        console.error(
          `[verifyVersion] Failed to remove temporary data directory ${tmpDataDir}: ${(e as Error).message}`,
        );
      }
    }
  }
}

interface PlaywrightTestResult {
  status: string;
  errors?: { message: string }[];
}

interface PlaywrightSpec {
  title: string;
  tests: Array<{
    results: PlaywrightTestResult[];
  }>;
}

interface PlaywrightSuite {
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
}

function isPlaywrightReport(value: unknown): value is PlaywrightReport {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { suites?: unknown }).suites)
  );
}

interface CapturedMetadata {
  foundry: string;
  system: { id: string; version: string };
  modules: { id: string; version: string }[];
}

function isModuleEntry(value: unknown): value is { id: string; version: string } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["id"] === "string" && typeof v["version"] === "string";
}

function isCapturedMetadata(value: unknown): value is CapturedMetadata {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v["foundry"] !== "string") return false;
  const sys = v["system"];
  if (typeof sys !== "object" || sys === null) return false;
  const sysRecord = sys as Record<string, unknown>;
  if (typeof sysRecord["id"] !== "string" || typeof sysRecord["version"] !== "string") return false;
  return Array.isArray(v["modules"]) && v["modules"].every(isModuleEntry);
}

// Playwright error messages are multi-line: a short summary line (e.g.
// "locator.selectOption: Test timeout of 120000ms exceeded.") followed by a
// verbose "Call log: ..." block. Only the first line is useful in a registry
// notes field or a GitHub issue comment - the rest is noise there, and the
// full detail is still available in the retained trace/screenshot.
function firstErrorLine(result: PlaywrightTestResult): string | undefined {
  const message = result.errors?.[0]?.message;
  if (!message) return undefined;
  const line = message.split("\n")[0]!.trim();
  return line.length > 150 ? `${line.slice(0, 147)}...` : line;
}

function extractFailures(report: PlaywrightReport): TestFailure[] {
  const failures: TestFailure[] = [];

  function traverse(suite: PlaywrightSuite) {
    if (suite.suites) suite.suites.forEach(traverse);
    if (suite.specs) {
      suite.specs.forEach((spec) => {
        const failedResult = spec.tests
          .flatMap((t) => t.results)
          .find((r) => r.status === "failed" || r.status === "timedOut");
        if (failedResult) {
          failures.push({ title: spec.title, error: firstErrorLine(failedResult) });
        }
      });
    }
  }

  if (report.suites) report.suites.forEach(traverse);
  return failures;
}

function countSpecs(report: PlaywrightReport): number {
  let count = 0;

  function traverse(suite: PlaywrightSuite) {
    if (suite.suites) suite.suites.forEach(traverse);
    if (suite.specs) count += suite.specs.length;
  }

  if (report.suites) report.suites.forEach(traverse);
  return count;
}

interface VerifyTarget {
  version: string;
  system: string;
  systemVersion?: string;
  systemMinor?: string;
  modules: string[];
}

// A --if-release-pending stable resweep can cover a couple dozen (fvtt,
// system, systemMinor) rows, each a full Docker+Playwright run (10-40+
// minutes) - trying to fit them all into one nightly run risks the same
// thing that actually happened once: several unrelated rows all failing or
// running long back to back exhausted the whole timeout window before the
// sweep finished, with nothing to show for it but a killed process. Batching
// it small means each night makes bounded, guaranteed forward progress
// instead of gambling the whole window on one run - progress itself is just
// each row's own verifiedWith field, so there's nothing extra to track
// across runs.
const STABLE_RESWEEP_BATCH_SIZE = 2;

const program = new Command();

program
  .name("verify-local")
  .description("Orchestrates local verification of Foundry VTT versions using Docker.")
  .version("0.1.0", "-v, --cli-version")
  .option("--docker", "Run tests using a temporary Docker container", false)
  .option("--version <version>", "The specific Foundry VTT version to verify")
  .option(
    "--system <id>",
    "The system ID to use for verification",
    process.env.FOUNDRY_SYSTEM_ID || "dnd5e",
  )
  .option(
    "--system-minor <minor>",
    "Pin to the latest patch of this system minor version (e.g. 8.2). Resolved via GitHub API.",
  )
  .option("--modules <ids>", "Comma-separated module IDs to install and verify", "")
  .option("--all-pending", "Verify all pairings currently marked as pending in the registry", false)
  .option(
    "--re-verify",
    "Force re-verification of all pairings marked as stable in the registry",
    false,
  )
  .option("--all", "Verify all pairings (pending and stable) in the registry", false)
  .option(
    "--if-release-pending",
    `Also re-verify stable pairings not yet verified with the current package.json version, ${STABLE_RESWEEP_BATCH_SIZE} per run. Deferred entirely on a run that also finds new --all-pending work.`,
    false,
  )
  .option("--update-registry", "Update verified-versions.json on successful verification", false)
  .option(
    "--record-failures",
    "On genuine verification failure, write a 'failed' status entry to the registry so --all-pending stops retrying it. Only takes effect with --update-registry.",
    false,
  )
  .option(
    "--git-commit",
    "Automatically commit registry/report changes whenever they exist, regardless of pass/fail",
    false,
  )
  .option(
    "--keep-container",
    "Do not stop and remove the Docker container after verification",
    false,
  )
  .action(async (options) => {
    console.log("--- Starting Local Verification ---");

    // Build the library once
    console.log("Building library...");
    execSync("npm run build", { stdio: "inherit" });

    if (options.recordFailures && !options.updateRegistry) {
      console.warn("[verify] --record-failures has no effect without --update-registry; ignoring.");
    }

    const modules = options.modules ? options.modules.split(",").map((m: string) => m.trim()) : [];
    let targets: VerifyTarget[] = [];

    // Read once, at the start of the run, not after the (potentially
    // hours-long) verification loop below - if a newer release lands on
    // main mid-run, this run should keep targeting the version it actually
    // started against; the newer one is picked up by the next run.
    const pkgVersion = getPackageVersion();

    // Tracked so the automatic release-triggered resweep below can defer to
    // genuinely new work discovered this run, rather than competing with it
    // for the same time budget.
    let pendingTargetCount = 0;

    if (options.allPending || options.reVerify || options.all || options.ifReleasePending) {
      const registryPath = path.join(process.cwd(), "verified-versions.json");
      if (fs.existsSync(registryPath)) {
        const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
        const list = Array.isArray(registry) ? registry : [];

        if (options.allPending || options.all) {
          const pending = list.filter((e: Record<string, unknown>) => e.status === "pending");
          pendingTargetCount = pending.length;
          targets.push(
            ...pending.map((e: Record<string, unknown>) => ({
              version: e["fvtt"] as string,
              system: e["system"] as string,
              systemVersion: e["systemVersion"] as string | undefined,
              systemMinor: e["systemMinor"] as string | undefined,
              modules: Array.isArray(e["modules"])
                ? (e["modules"] as Record<string, unknown>[]).map(
                    (m: Record<string, unknown>) => m["id"] as string,
                  )
                : [],
            })),
          );
          if (pending.length > 0) console.log(`Targeting ${pending.length} pending pairings.`);
        }

        const stableTargetOf = (e: Record<string, unknown>) => ({
          version: e["fvtt"] as string,
          system: e["system"] as string,
          // Pin to the exact version this row was actually verified stable
          // with, not "whatever's latest" - re-verifying is meant to catch
          // a regression in this library against a config we already know
          // works, not to silently drift onto a newer system release that
          // was never part of this row's claim. Leaving this unpinned
          // previously meant every re-verify sweep (e.g. --if-release-
          // pending) tried installing today's actual-latest system
          // version regardless of what each row recorded - once that
          // latest version's own compatibility range moved past an older,
          // still-pinned FVTT build, every affected row failed the exact
          // same way, repeatedly, for the same non-issue.
          systemVersion: e["systemVersion"] as string | undefined,
          systemMinor: e["systemMinor"] as string | undefined,
          modules: Array.isArray(e["modules"])
            ? (e["modules"] as Record<string, unknown>[]).map(
                (m: Record<string, unknown>) => m["id"] as string,
              )
            : [],
        });

        if (options.reVerify || options.all) {
          // Explicit, deliberate full resweep - uncapped, same as a direct
          // request for "everything, right now" has always meant.
          const stable = list.filter((e: Record<string, unknown>) => e.status === "stable");
          targets.push(...stable.map((e) => stableTargetOf(e)));
          if (stable.length > 0)
            console.log(`Targeting ${stable.length} stable pairings for re-verification.`);
        } else if (options.ifReleasePending) {
          // Automatic, release-triggered resweep: bounded to a small batch
          // per run (see STABLE_RESWEEP_BATCH_SIZE), resumed across as many
          // nightly runs as it takes by simply re-filtering on verifiedWith
          // each time - no cross-run state to maintain. Deferred entirely on
          // a run that already found genuinely new pending work - that's the
          // more actionable thing to spend this run's time budget on.
          if (pendingTargetCount > 0) {
            console.log(
              `[verify] Deferring the release-triggered stable resweep this run - ${pendingTargetCount} new pending pairing(s) take priority.`,
            );
          } else {
            const stable = list.filter((e: Record<string, unknown>) => e.status === "stable");
            const remaining = stable.filter(
              (e: Record<string, unknown>) => e["verifiedWith"] !== pkgVersion,
            );
            const batch = remaining.slice(0, STABLE_RESWEEP_BATCH_SIZE);
            targets.push(...batch.map((e) => stableTargetOf(e)));
            if (batch.length > 0)
              console.log(
                `Targeting ${batch.length} of ${remaining.length} remaining stable pairing(s) for this cycle's resweep (not yet verified with v${pkgVersion}).`,
              );
          }
        }
      } else {
        console.error("Registry file not found.");
        process.exit(1);
      }
    } else {
      const versionArg = options.version || process.env.FOUNDRY_VERSION || "13";
      let systemVersion: string | undefined;

      if (options.systemMinor) {
        systemVersion = await resolveLatestPatch(options.system, options.systemMinor);
      }

      targets = [
        {
          version: versionArg,
          system: options.system,
          systemVersion,
          systemMinor: options.systemMinor,
          modules,
        },
      ];
    }

    if (targets.length === 0) {
      console.log("No versions matched the criteria. Nothing to verify.");
    }

    const results: { key: string; success: boolean; failures: TestFailure[]; skipped?: boolean }[] =
      [];

    // Commits registry/report changes immediately when --git-commit is set,
    // so a run interrupted partway through (the systemd timeout this whole
    // batching scheme exists to survive) leaves every already-completed
    // target's result safely committed instead of sitting as an uncommitted
    // diff - which once blocked the *next* run's own git checkout outright.
    // No-op in non---git-commit mode; that path keeps its original single
    // "suggested command" summary at the very end instead.
    function commitIfChanged(files: string[], message: string): void {
      if (!options.gitCommit) return;
      const changed = files.filter((f) => {
        try {
          execFileSync("git", ["diff", "--quiet", f]);
          return false;
        } catch {
          return true;
        }
      });
      if (changed.length === 0) return;
      try {
        execFileSync("git", ["add", ...changed]);
        execFileSync("git", ["commit", "-m", message], { stdio: "inherit" });
      } catch (e) {
        console.error("Failed to commit changes:", (e as Error).message);
        process.exit(1);
      }
    }

    for (const target of targets) {
      const result = await verifyVersion(target.version, {
        system: target.system,
        modules: target.modules,
        systemVersion: target.systemVersion,
        isDocker: options.docker,
        updateRegistry: options.updateRegistry,
        recordFailures: options.recordFailures,
        keepContainer: options.keepContainer,
      });
      const sysLabel = target.systemVersion
        ? `${target.system} v${target.systemVersion}`
        : target.system;
      const key = `${target.version} (${sysLabel})`;
      const status = result.skipped ? "INCOMPATIBLE" : result.success ? "PASS" : "FAIL";
      results.push({
        key,
        success: result.success,
        failures: result.failures,
        skipped: result.skipped,
      });

      commitIfChanged(
        ["verified-versions.json", "verification-report.md"],
        `chore(registry): verify ${key} [${status}]`,
      );
    }

    console.log("\n--- Verification Summary ---");
    results.forEach((r) => {
      const status = r.skipped ? "INCOMPATIBLE" : r.success ? "PASS" : "FAIL";
      console.log(`${r.key}: ${status}`);
      if (r.failures.length > 0) {
        r.failures.forEach((f) =>
          console.log(`  - [FAILED] ${f.title}${f.error ? ` (${f.error})` : ""}`),
        );
      }
    });

    const allPassed = results.every((r) => r.success);

    // Non---git-commit mode only: the incremental commits above already
    // cover --git-commit runs, so this is just the original "one combined
    // suggested command" behavior for a fully manual/dry-run invocation.
    if (!options.gitCommit) {
      const changedFiles = ["verified-versions.json", "verification-report.md"].filter((f) => {
        try {
          execFileSync("git", ["diff", "--quiet", f]);
          return false;
        } catch {
          return true;
        }
      });

      if (changedFiles.length > 0) {
        const summary = results
          .map((r) => `${r.key} [${r.skipped ? "INCOMPATIBLE" : r.success ? "PASS" : "FAIL"}]`)
          .join(", ");
        console.log(`\n--- Suggested Commit ---`);
        console.log(`git add ${changedFiles.join(" ")}`);
        console.log(`git commit -m "chore(registry): verify ${summary}"`);
      }
    }

    if (!allPassed) {
      process.exit(1);
    }
  });

program.parse(process.argv);
