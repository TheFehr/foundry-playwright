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
  modules: string[],
  isDocker: boolean,
  updateRegistry: boolean,
  keepContainer: boolean,
) {
  console.log(
    `\n--- Verifying Version: ${version} (System: ${system}, Modules: ${modules.join(", ") || "none"}) ---`,
  );

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
      FOUNDRY_MODULE_IDS: modules.join(","),
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
      modules: [] as { id: string; version: string }[],
    };

    const metaPath = path.join(process.cwd(), ".foundry_metadata.json");
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      fs.unlinkSync(metaPath); // Clean up
    }

    console.log(`--- Verification Successful for ${version} ---`);

    // Update Cumulative Summary Report
    const summaryPath = path.join(process.cwd(), "verification-report.md");
    let summaryContent =
      "# Verification Summary Report\n\n| Version | System | Modules | Status | Date | Docker |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n";

    let existingResults: any[] = [];
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

    const currentResult = {
      version: version,
      system: `${meta.system.id} (v${meta.system.version})`,
      modules: meta.modules.map((m) => `${m.id}@${m.version}`).join(", ") || "none",
      status: "PASS",
      date: new Date().toISOString().split("T")[0],
      docker: isDocker ? "Yes" : "No",
    };

    const existingIdx = existingResults.findIndex(
      (r) => r.version === version && r.system.startsWith(meta.system.id),
    );
    if (existingIdx !== -1) {
      existingResults[existingIdx] = currentResult;
    } else {
      existingResults.push(currentResult);
    }

    existingResults.sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    );

    existingResults.forEach((r) => {
      summaryContent += `| ${r.version} | ${r.system} | ${r.modules} | ${r.status} | ${r.date} | ${r.docker} |\n`;
    });

    fs.writeFileSync(summaryPath, summaryContent);
    console.log(`Summary updated: ${summaryPath}`);

    // Registry Update (Root-level array migration)
    if (updateRegistry) {
      console.log(`Updating verified-versions.json for ${version}...`);
      const registryPath = path.join(process.cwd(), "verified-versions.json");
      let registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

      // In case of migration from old object schema
      if (!Array.isArray(registry)) {
        console.warn("Registry is not an array. Performing migration...");
        registry = [];
      }

      // Record non-fake modules for the matrix
      const realModules = meta.modules.filter((m) => m.id !== "fake-module");

      const entry = {
        fvtt: version,
        system: meta.system.id,
        systemVersion: meta.system.version,
        modules: realModules.length > 0 ? realModules : undefined,
        status: "stable" as const,
        timestamp: new Date().toISOString(),
        notes: `Verified locally with ${meta.system.id} v${meta.system.version}.`,
      };

      // Match entry by fvtt and system
      const existingIdx = registry.findIndex(
        (e: any) => e.fvtt === version && e.system === meta.system.id,
      );
      if (existingIdx !== -1) {
        registry[existingIdx] = entry;
      } else {
        registry.push(entry);
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
    "--keep-container",
    "Do not stop and remove the Docker container after verification",
    false,
  )
  .action(async (options) => {
    console.log("--- Starting Local Verification ---");

    // 1. Build the library once
    console.log("Building library...");
    execSync("npm run build", { stdio: "inherit" });

    const modules = options.modules ? options.modules.split(",").map((m: string) => m.trim()) : [];
    let targets: { version: string; system: string; modules: string[] }[] = [];

    if (options.allPending || options.reVerify || options.all) {
      const registryPath = path.join(process.cwd(), "verified-versions.json");
      if (fs.existsSync(registryPath)) {
        const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
        const list = Array.isArray(registry) ? registry : [];

        if (options.allPending || options.all) {
          const pending = list.filter((e: any) => e.status === "pending");
          targets.push(
            ...pending.map((e: any) => ({
              version: e.fvtt,
              system: e.system,
              modules: e.modules?.map((m: any) => m.id) || [],
            })),
          );
          if (pending.length > 0) console.log(`Targeting ${pending.length} pending pairings.`);
        }

        if (options.reVerify || options.all) {
          const stable = list.filter((e: any) => e.status === "stable");
          targets.push(
            ...stable.map((e: any) => ({
              version: e.fvtt,
              system: e.system,
              modules: e.modules?.map((m: any) => m.id) || [],
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
      targets = [{ version: versionArg, system: options.system, modules }];
    }

    if (targets.length === 0) {
      console.log("No versions matched the criteria. Nothing to verify.");
      return;
    }

    const results: { key: string; success: boolean }[] = [];

    for (const target of targets) {
      const success = await verifyVersion(
        target.version,
        target.system,
        target.modules,
        options.docker,
        options.updateRegistry,
        options.keepContainer,
      );
      results.push({ key: `${target.version} (${target.system})`, success });
    }

    console.log("\n--- Verification Summary ---");
    results.forEach((r) => {
      console.log(`${r.key}: ${r.success ? "PASS" : "FAIL"}`);
    });

    if (results.some((r) => !r.success)) {
      process.exit(1);
    }
  });

program.parse(process.argv);
