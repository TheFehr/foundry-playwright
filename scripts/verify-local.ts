import { execSync, execFileSync } from "child_process";
import "dotenv/config";
import path from "path";
import fs from "fs";
import { DockerFoundryOrchestrator } from "../src/docker.js";
import { Command } from "commander";

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
      return `https://github.com/foundryvtt/pf2e/releases/download/${version}/system.json`;
    default:
      return null;
  }
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

async function verifyVersion(
  version: string,
  system: string,
  modules: string[],
  systemVersion: string | undefined,
  isDocker: boolean,
  updateRegistry: boolean,
  keepContainer: boolean,
): Promise<{ success: boolean; failures: string[] }> {
  console.log(
    `\n--- Verifying Version: ${version} (System: ${system}${systemVersion ? ` v${systemVersion}` : ""}, Modules: ${modules.join(", ") || "none"}) ---`,
  );

  let foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  let orchestrator: DockerFoundryOrchestrator | null = null;
  let failures: string[] = [];

  try {
    if (isDocker) {
      const tmpDataDir = path.join(
        process.cwd(),
        ".foundry_test_data",
        `.foundry_data_tmp_${version}_${Date.now()}`,
      );

      orchestrator = new DockerFoundryOrchestrator({
        version: version,
        adminKey: process.env.FOUNDRY_ADMIN_KEY || "password",
        dataDir: tmpDataDir,
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

    const testFiles = ["e2e/verify.spec.ts", "e2e/user-management.spec.ts"].join(" ");
    const reportPath = path.join(process.cwd(), `.playwright-report-${version}.json`);
    try {
      execSync(
        `npx playwright test ${testFiles} --workers=1 --reporter=line,json ${playwrightArgs.join(" ")}`,
        {
          stdio: "inherit",
          env: { ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
        },
      );
    } catch {
      // execSync throws on test failure; we parse the report below
    }

    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      failures = extractFailures(report);
      fs.unlinkSync(reportPath);
    }

    if (failures.length > 0) {
      throw new Error(`Verification failed with ${failures.length} test failures.`);
    }

    // Capture versions for the report
    console.log("[verifyVersion] Capturing system and module versions...");
    let meta = {
      foundry: version,
      system: { id: system, version: "unknown" },
      modules: [] as { id: string; version: string }[],
    };

    const metaPath = path.join(process.cwd(), ".foundry_metadata.json");
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      fs.unlinkSync(metaPath);
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
      (r) => r.version === version && (r.system as string).startsWith(meta.system.id),
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
      console.log(`Updating verified-versions.json for ${version}...`);
      const registryPath = path.join(process.cwd(), "verified-versions.json");
      let registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

      if (!Array.isArray(registry)) {
        console.warn("Registry is not an array. Performing migration...");
        registry = [];
      }

      const realModules = meta.modules.filter((m) => m.id !== "fake-module");
      const [sysMajor, sysMinor] = installedSystemVersion.split(".");
      const systemMinor = `${sysMajor}.${sysMinor}`;

      const entry = {
        fvtt: version,
        system: meta.system.id,
        systemMinor,
        systemVersion: installedSystemVersion,
        modules: realModules.length > 0 ? realModules : undefined,
        status: "stable" as const,
        timestamp: new Date().toISOString(),
        notes: `Verified locally with ${meta.system.id} v${installedSystemVersion}.`,
      };

      const entryIdx = (registry as Record<string, unknown>[]).findIndex(
        (e) =>
          e["fvtt"] === version &&
          e["system"] === meta.system.id &&
          e["systemMinor"] === systemMinor,
      );
      if (entryIdx !== -1) {
        registry[entryIdx] = entry;
      } else {
        registry.push(entry);
      }

      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      console.log("Registry updated successfully.");
    }
    return { success: true, failures: [] };
  } catch (error: unknown) {
    console.error(`--- Verification Failed for ${version} ---`);
    console.error((error as Error).message);
    return { success: false, failures };
  } finally {
    if (orchestrator && !keepContainer) {
      await orchestrator.stopAndRemove();
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
  .option("--git-commit", "Automatically commit changes on success", false)
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
              systemVersion: e["systemVersion"] as string | undefined,
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

      targets = [{ version: versionArg, system: options.system, systemVersion, modules }];
    }

    if (targets.length === 0) {
      console.log("No versions matched the criteria. Nothing to verify.");
      return;
    }

    const results: { key: string; success: boolean; failures: string[] }[] = [];

    for (const target of targets) {
      const result = await verifyVersion(
        target.version,
        target.system,
        target.modules,
        target.systemVersion,
        options.docker,
        options.updateRegistry,
        options.keepContainer,
      );
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

    if (allPassed && changedFiles.length > 0) {
      const verifiedKeys = results.map((r) => r.key).join(", ");
      const commitMsg = `chore(registry): verify ${verifiedKeys}`;

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
