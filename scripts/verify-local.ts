import { execSync } from "child_process";
import "dotenv/config";
import path from "path";
import fs from "fs";
import { DockerFoundryOrchestrator } from "../src/docker.js";

/**
 * Local Verification Script
 *
 * Orchestrates a Docker-based Foundry instance and runs the verification suite.
 */

async function verifyVersion(
  version: string,
  system: string,
  isDocker: boolean,
  updateRegistry: boolean,
) {
  console.log(`\n--- Verifying Version: ${version} (System: ${system}) ---`);

  const foundryUrl = process.env.FOUNDRY_URL || "http://localhost:30000";
  let orchestrator: DockerFoundryOrchestrator | null = null;

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
    }

    console.log(`Verifying against: ${foundryUrl}`);

    // Run E2E tests
    const env = {
      ...process.env,
      FOUNDRY_URL: foundryUrl,
      FOUNDRY_VERSION: version,
      FOUNDRY_SYSTEM_ID: system,
      FOUNDRY_UI_ADAPTER: process.env.FOUNDRY_UI_ADAPTER || system,
    };

    // Pass through common Playwright flags
    const playwrightArgs = process.argv.filter(
      (a) => a.startsWith("--ui") || a.startsWith("--headed") || a.startsWith("--debug"),
    );

    // We target only our specific verification suites
    const testFiles = ["e2e/verify.spec.ts", "e2e/user-management.spec.ts"].join(" ");

    execSync(`npx playwright test ${testFiles} --workers=1 ${playwrightArgs.join(" ")}`, {
      stdio: "inherit",
      env,
    });

    console.log(`--- Verification Successful for ${version} ---`);

    // Generate Report
    const reportPath = path.join(process.cwd(), `verification-report-${version}.md`);
    const reportContent = `# Verification Report: ${version}
- **Date:** ${new Date().toISOString()}
- **System:** ${system}
- **Status:** PASS
- **Docker:** ${isDocker ? "Yes" : "No"}
`;
    fs.writeFileSync(reportPath, reportContent);
    console.log(`Report generated: ${reportPath}`);

    // Registry Update
    if (updateRegistry) {
      console.log(`Updating verified-versions.json for ${version}...`);
      const registryPath = path.join(process.cwd(), "verified-versions.json");
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

      // Remove from pending
      registry.pending = registry.pending.filter((v: any) => v.version !== version);

      // Add to verified if not exists
      if (!registry.verified.find((v: any) => v.version === version)) {
        registry.verified.push({
          version: version,
          timestamp: new Date().toISOString(),
          status: "stable",
          notes: `Verified locally with ${system}.`,
        });
      }

      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      console.log("Registry updated successfully.");
    }
    return true;
  } catch (error: any) {
    console.error(`--- Verification Failed for ${version} ---`);
    console.error(error.message);
    return false;
  } finally {
    if (orchestrator && !process.argv.includes("--keep-container")) {
      await orchestrator.stopAndRemove();
    }
  }
}

async function run() {
  console.log("--- Starting Local Verification ---");

  const args = process.argv.slice(2);
  const isDocker = args.includes("--docker");
  const updateRegistry = args.includes("--update-registry");
  const allPending = args.includes("--all-pending");

  let systemArg = process.env.FOUNDRY_SYSTEM_ID || "dnd5e";
  const systemIdx = args.indexOf("--system");
  if (systemIdx !== -1 && args[systemIdx + 1]) {
    systemArg = args[systemIdx + 1];
  }

  // 1. Build the library once
  console.log("Building library...");
  execSync("npm run build", { stdio: "inherit" });

  let versions: string[] = [];

  if (allPending) {
    const registryPath = path.join(process.cwd(), "verified-versions.json");
    if (fs.existsSync(registryPath)) {
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      versions = registry.pending.map((p: any) => p.version);
      console.log(`Found ${versions.length} pending versions in registry.`);
    } else {
      console.error("Registry file not found.");
      process.exit(1);
    }
  } else {
    let versionArg = process.env.FOUNDRY_VERSION || "13";
    const versionIdx = args.indexOf("--version");
    if (versionIdx !== -1 && args[versionIdx + 1]) {
      versionArg = args[versionIdx + 1];
    }
    versions = [versionArg];
  }

  const results: { version: string; success: boolean }[] = [];

  for (const version of versions) {
    const success = await verifyVersion(version, systemArg, isDocker, updateRegistry);
    results.push({ version, success });
  }

  console.log("\n--- Verification Summary ---");
  results.forEach((r) => {
    console.log(`${r.version}: ${r.success ? "PASS" : "FAIL"}`);
  });

  if (results.some((r) => !r.success)) {
    process.exit(1);
  }
}

run();
