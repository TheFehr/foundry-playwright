import { execSync } from "child_process";
import "dotenv/config";
import path from "path";
import fs from "fs";
import { DockerFoundryOrchestrator } from "../src/docker.js";
import { Command } from "commander";

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
  keepContainer: boolean,
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

    // 4. Capture versions for the report
    console.log("[verifyVersion] Capturing system and module versions...");
    let meta = {
      foundry: version,
      system: { id: system, version: "unknown" },
    };

    const metaPath = path.join(process.cwd(), ".foundry_metadata.json");
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      fs.unlinkSync(metaPath); // Clean up
    }

    console.log(`--- Verification Successful for ${version} ---`);

    // Generate Individual Report
    const reportPath = path.join(process.cwd(), `verification-report-${version}.md`);
    const reportContent = `# Verification Report: ${version}
- **Date:** ${new Date().toISOString()}
- **Foundry Version:** ${meta.foundry}
- **System:** ${meta.system.id} (v${meta.system.version})
- **Status:** PASS
- **Docker:** ${isDocker ? "Yes" : "No"}
`;
    fs.writeFileSync(reportPath, reportContent);
    console.log(`Report generated: ${reportPath}`);

    // Update Cumulative Summary Report
    const summaryPath = path.join(process.cwd(), "verification-report.md");
    let summaryContent =
      "# Verification Summary Report\n\n| Version | System | Status | Date | Docker |\n| :--- | :--- | :--- | :--- | :--- |\n";

    let existingResults: any[] = [];
    if (fs.existsSync(summaryPath)) {
      const lines = fs.readFileSync(summaryPath, "utf8").split("\n");
      // Extract existing table rows (skipping header and divider)
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
          status: parts[2],
          date: parts[3],
          docker: parts[4],
        };
      });
    }

    // Update or add current result
    const currentResult = {
      version: version,
      system: `${meta.system.id} (v${meta.system.version})`,
      status: "PASS",
      date: new Date().toISOString().split("T")[0], // YYYY-MM-DD for table brevity
      docker: isDocker ? "Yes" : "No",
    };

    const existingIdx = existingResults.findIndex((r) => r.version === version);
    if (existingIdx !== -1) {
      existingResults[existingIdx] = currentResult;
    } else {
      existingResults.push(currentResult);
    }

    // Sort by version descending
    existingResults.sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    );

    // Rebuild summary content
    existingResults.forEach((r) => {
      summaryContent += `| ${r.version} | ${r.system} | ${r.status} | ${r.date} | ${r.docker} |\n`;
    });

    fs.writeFileSync(summaryPath, summaryContent);
    console.log(`Summary updated: ${summaryPath}`);

    // Registry Update
    if (updateRegistry) {
      console.log(`Updating verified-versions.json for ${version}...`);
      const registryPath = path.join(process.cwd(), "verified-versions.json");
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

      // Remove from pending
      registry.pending = registry.pending.filter((v: any) => v.version !== version);

      // Add to verified if not exists
      const existingIdx = registry.verified.findIndex((v: any) => v.version === version);
      const entry = {
        version: version,
        timestamp: new Date().toISOString(),
        status: "stable",
        notes: `Verified locally with ${meta.system.id} v${meta.system.version}.`,
        metadata: {
          system: meta.system,
        },
      };

      if (existingIdx !== -1) {
        registry.verified[existingIdx] = entry;
      } else {
        registry.verified.push(entry);
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
    if (orchestrator && !keepContainer) {
      await orchestrator.stopAndRemove();
    }
  }
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
  .option("--all-pending", "Verify all versions currently marked as pending in the registry", false)
  .option(
    "--re-verify",
    "Force re-verification of all versions marked as stable in the registry",
    false,
  )
  .option("--all", "Verify all versions (pending and stable) in the registry", false)
  .option("--update-registry", "Update verified-versions.json on successful verification", false)
  .option(
    "--keep-container",
    "Do not stop and remove the Docker container after verification",
    false,
  )
  .action(async (options) => {
    console.log("--- Starting Local Verification ---");

    // 1. Build the library once
    console.log("Building library...");
    execSync("npm run build", { stdio: "inherit" });

    let versions: string[] = [];

    if (options.allPending || options.reVerify || options.all) {
      const registryPath = path.join(process.cwd(), "verified-versions.json");
      if (fs.existsSync(registryPath)) {
        const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

        if (options.allPending || options.all) {
          const pending = registry.pending.map((p: any) => p.version);
          versions.push(...pending);
          if (pending.length > 0) console.log(`Targeting ${pending.length} pending versions.`);
        }

        if (options.reVerify || options.all) {
          const verified = registry.verified.map((v: any) => v.version);
          versions.push(...verified);
          if (verified.length > 0)
            console.log(`Targeting ${verified.length} verified versions for re-verification.`);
        }
      } else {
        console.error("Registry file not found.");
        process.exit(1);
      }
    } else {
      const versionArg = options.version || process.env.FOUNDRY_VERSION || "13";
      versions = [versionArg];
    }

    // Remove duplicates
    versions = [...new Set(versions)];

    if (versions.length === 0) {
      console.log("No versions matched the criteria. Nothing to verify.");
      return;
    }

    const results: { version: string; success: boolean }[] = [];

    for (const version of versions) {
      const success = await verifyVersion(
        version,
        options.system,
        options.docker,
        options.updateRegistry,
        options.keepContainer,
      );
      results.push({ version, success });
    }

    console.log("\n--- Verification Summary ---");
    results.forEach((r) => {
      console.log(`${r.version}: ${r.success ? "PASS" : "FAIL"}`);
    });

    if (results.some((r) => !r.success)) {
      process.exit(1);
    }
  });

program.parse(process.argv);
