import { execSync, execFileSync } from "child_process";
import "dotenv/config";
import path from "path";
import fs from "fs";
import { DockerFoundryOrchestrator, isPodmanRuntime } from "../src/docker.js";
import { Command } from "commander";
import { minorOf } from "./version-utils.js";

/**
 * Local Verification Script
 *
 * Orchestrates a Docker-based Foundry instance and runs the verification suite.
 * Supports pinning a specific system version via --system-minor (resolves latest
 * patch for that minor from GitHub) or --system-version (exact version).
 */

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
  status: "stable" | "failed";
  timestamp: string;
  notes: string;
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

  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "host",
      "--user",
      `${process.getuid!()}:${process.getgid!()}`,
      // See DockerOrchestratorConfig.rootless / isPodmanRuntime in
      // src/docker.ts - --userns=keep-id is Podman-specific syntax, so only
      // add it when the docker binary is actually Podman under the hood.
      ...(rootless && isPodmanRuntime() ? ["--userns=keep-id"] : []),
      "-e",
      "HOME=/tmp",
      ...envFlags,
      "-v",
      `${process.cwd()}:/work`,
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
): Promise<{ success: boolean; failures: string[] }> {
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

  let foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  const rootless = process.env.FOUNDRY_PLAYWRIGHT_ROOTLESS === "1";
  let orchestrator: DockerFoundryOrchestrator | null = null;
  let tmpDataDir: string | null = null;
  let failures: string[] = [];
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

    const testFiles = ["e2e/verify.spec.ts", "e2e/user-management.spec.ts"];
    // Unique per run (not just per version), and removed up front - a
    // previous run at this same path that crashed before reaching its own
    // cleanup could otherwise leave a stale report behind for this run to
    // misread as its own results.
    const reportPath = path.join(
      process.cwd(),
      `.playwright-report-${version}-${Date.now()}-${process.pid}.json`,
    );
    fs.rmSync(reportPath, { force: true });
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
        runPlaywrightInContainer(
          testFiles,
          playwrightArgs,
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
      try {
        const rawReport: unknown = JSON.parse(rawContent);
        if (isPlaywrightReport(rawReport)) {
          validReport = true;
          failures = extractFailures(rawReport);
        }
      } catch {
        // Corrupted/truncated report - fold into the same "malformed"
        // diagnostic below instead of letting a raw JSON.parse error
        // escape and override execError precedence.
        validReport = false;
      }
      if (!validReport || (failures.length === 0 && execError)) {
        // Either the report doesn't have the expected shape (corrupted or
        // unexpected content) or the process genuinely failed despite a
        // clean-looking report - in both cases, don't silently treat this
        // as success just because some report file exists.
        throw (
          execError ??
          new Error(`Malformed Playwright report at ${reportPath}: missing "suites" array.`)
        );
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

    // Update Cumulative Summary Report
    const summaryPath = path.join(process.cwd(), "verification-report.md");
    let summaryContent =
      "# Verification Summary Report\n\n| Version | System | Modules | Status | Date | Docker |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n";

    let existingResults: Record<string, unknown>[] = [];
    if (fs.existsSync(summaryPath)) {
      const lines = fs.readFileSync(summaryPath, "utf8").split("\n");
      const rows = lines.filter(
        (l) => l.startsWith("|") && !l.includes("Version | System") && !l.includes(":---"),
      );
      existingResults = rows.map((r) => {
        const parts = r
          .split("|")
          .map((p) => p.trim())
          .filter((p) => p !== "");
        return {
          version: parts[0],
          system: parts[1],
          modules: parts[2],
          status: parts[3],
          date: parts[4],
          docker: parts[5],
        };
      });
    }

    const installedSystemVersion = meta.system.version;
    const currentResult = {
      version: version,
      system: `${meta.system.id} (v${installedSystemVersion})`,
      modules: meta.modules.map((m) => `${m.id}@${m.version}`).join(", ") || "none",
      status: "PASS",
      date: new Date().toISOString().split("T")[0],
      docker: isDocker ? "Yes" : "No",
    };

    const existingIdx = existingResults.findIndex(
      (r) => r.version === version && r.system === currentResult.system,
    );
    if (existingIdx !== -1) {
      existingResults[existingIdx] = currentResult;
    } else {
      existingResults.push(currentResult);
    }

    existingResults.sort((a, b) =>
      (b.version as string).localeCompare(a.version as string, undefined, { numeric: true }),
    );

    existingResults.forEach((r) => {
      summaryContent += `| ${r.version} | ${r.system} | ${r.modules} | ${r.status} | ${r.date} | ${r.docker} |\n`;
    });

    fs.writeFileSync(summaryPath, summaryContent);
    console.log(`Summary updated: ${summaryPath}`);

    // Registry update — key is (fvtt, system, systemMinor)
    if (updateRegistry) {
      const realModules = filterRealModules(meta.modules);
      const resolvedSystemVersion = resolveVerifiedSystemVersion(
        installedSystemVersion,
        manifestUrl,
        systemVersion,
      );

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
        });
        console.log("Registry updated successfully.");
      }
    }
    return { success: true, failures: [] };
  } catch (error: unknown) {
    console.error(`--- Verification Failed for ${version} ---`);
    console.error((error as Error).message);

    if (updateRegistry && recordFailures && failures.length > 0) {
      // Only genuine test failures land here - Docker/Playwright/report-parsing/
      // metadata errors fall through below, since "failed" is permanent (never
      // retried by --all-pending) and an infra hiccup isn't a real incompatibility.
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
          `Not recording a failure entry for ${version}: cannot determine which system version was actually tested (metadata missing/invalid and no manifest pin this run). Leaving the entry pending so --all-pending retries it.`,
        );
      } else {
        console.log(`Recording failure in verified-versions.json for ${version}...`);
        upsertRegistryEntry({
          fvtt: version,
          system: meta.system.id || system,
          systemMinor: minorOf(resolvedSystemVersion),
          systemVersion: resolvedSystemVersion,
          modules: realModules.length > 0 ? realModules : undefined,
          status: "failed",
          timestamp: new Date().toISOString(),
          notes: `Automated verification failed: ${failures.join("; ")}`,
        });
        console.log("Registry updated with failure entry.");
      }
    } else if (updateRegistry && recordFailures) {
      console.log(
        `Not recording a failure entry for ${version}: no test failures were collected, so this looks like an infrastructure error rather than a real incompatibility. Leaving the entry pending so --all-pending retries it.`,
      );
    }

    return { success: false, failures };
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

function extractFailures(report: PlaywrightReport): string[] {
  const failures: string[] = [];

  function traverse(suite: PlaywrightSuite) {
    if (suite.suites) suite.suites.forEach(traverse);
    if (suite.specs) {
      suite.specs.forEach((spec) => {
        const isFailed = spec.tests.some((t) =>
          t.results.some((r) => r.status === "failed" || r.status === "timedOut"),
        );
        if (isFailed) {
          failures.push(spec.title);
        }
      });
    }
  }

  if (report.suites) report.suites.forEach(traverse);
  return failures;
}

interface VerifyTarget {
  version: string;
  system: string;
  systemVersion?: string;
  systemMinor?: string;
  modules: string[];
}

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

    if (options.allPending || options.reVerify || options.all) {
      const registryPath = path.join(process.cwd(), "verified-versions.json");
      if (fs.existsSync(registryPath)) {
        const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
        const list = Array.isArray(registry) ? registry : [];

        if (options.allPending || options.all) {
          const pending = list.filter((e: Record<string, unknown>) => e.status === "pending");
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

        if (options.reVerify || options.all) {
          const stable = list.filter((e: Record<string, unknown>) => e.status === "stable");
          targets.push(
            ...stable.map((e: Record<string, unknown>) => ({
              version: e["fvtt"] as string,
              system: e["system"] as string,
              // Don't pin systemVersion for re-verify: let installSystem handle already-installed
              // systems; the registry update records whatever version is actually installed.
              systemMinor: e["systemMinor"] as string | undefined,
              modules: Array.isArray(e["modules"])
                ? (e["modules"] as Record<string, unknown>[]).map(
                    (m: Record<string, unknown>) => m["id"] as string,
                  )
                : [],
            })),
          );
          if (stable.length > 0)
            console.log(`Targeting ${stable.length} stable pairings for re-verification.`);
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
      return;
    }

    const results: { key: string; success: boolean; failures: string[] }[] = [];

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
      results.push({
        key: `${target.version} (${sysLabel})`,
        success: result.success,
        failures: result.failures,
      });
    }

    console.log("\n--- Verification Summary ---");
    results.forEach((r) => {
      const status = r.success ? "PASS" : "FAIL";
      console.log(`${r.key}: ${status}`);
      if (r.failures.length > 0) {
        r.failures.forEach((f) => console.log(`  - [FAILED] ${f}`));
      }
    });

    const allPassed = results.every((r) => r.success);

    // Git integration
    const changedFiles = ["verified-versions.json", "verification-report.md"].filter((f) => {
      try {
        execFileSync("git", ["diff", "--quiet", f]);
        return false;
      } catch {
        return true;
      }
    });

    if (changedFiles.length > 0) {
      const summary = results.map((r) => `${r.key} [${r.success ? "PASS" : "FAIL"}]`).join(", ");
      const commitMsg = `chore(registry): verify ${summary}`;

      if (options.gitCommit) {
        console.log(`\n--- Auto-committing changes ---`);
        try {
          execFileSync("git", ["add", ...changedFiles]);
          execFileSync("git", ["commit", "-m", commitMsg], { stdio: "inherit" });
          console.log("Commit successful.");
        } catch (e) {
          console.error("Failed to commit changes:", (e as Error).message);
          process.exit(1);
        }
      } else {
        console.log(`\n--- Suggested Commit ---`);
        console.log(`git add ${changedFiles.join(" ")}`);
        console.log(`git commit -m "${commitMsg}"`);
      }
    }

    if (!allPassed) {
      process.exit(1);
    }
  });

program.parse(process.argv);
