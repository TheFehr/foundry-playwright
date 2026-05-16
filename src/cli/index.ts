#!/usr/bin/env node
import { Command } from "commander";
import { DockerFoundryOrchestrator } from "../docker.js";
import { initAction } from "./init.js";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const program = new Command();

program
  .name("foundry-playwright")
  .description("CLI for Foundry VTT E2E testing with Playwright")
  .version("0.1.0");

program.command("init").description("Initialize a new Foundry E2E test project").action(initAction);

program
  .command("test")
  .description("Run E2E tests with an optional Docker-orchestrated Foundry instance")
  .option("-v, --version <version>", "Foundry VTT version", process.env.FOUNDRY_VERSION || "13")
  .option("-s, --system <id>", "System ID", process.env.FOUNDRY_SYSTEM_ID || "dnd5e")
  .option("--docker", "Use Docker for the Foundry instance")
  .option("--update-registry", "Update verified-versions.json on success")
  .option("--playwright <command>", "Playwright command to run", "npx playwright test")
  .action(async (options) => {
    const { version, system, docker, updateRegistry, playwright } = options;
    let orchestrator: DockerFoundryOrchestrator | null = null;

    try {
      if (docker) {
        const tmpDataDir = path.join(
          process.cwd(),
          ".foundry_test_data",
          `.foundry_data_tmp_${Date.now()}`,
        );
        orchestrator = new DockerFoundryOrchestrator({
          version,
          adminKey: process.env.FOUNDRY_ADMIN_KEY || "password",
          dataDir: tmpDataDir,
        });

        // Auto-inject local modules if they exist in e2e/ (common pattern in this repo)
        const e2ePath = path.join(process.cwd(), "e2e");
        if (fs.existsSync(e2ePath)) {
          const items = fs.readdirSync(e2ePath);
          for (const item of items) {
            const itemPath = path.join(e2ePath, item);
            if (
              fs.statSync(itemPath).isDirectory() &&
              fs.existsSync(path.join(itemPath, "module.json"))
            ) {
              const modulesDir = path.join(tmpDataDir, "Data", "modules", item);
              fs.mkdirSync(modulesDir, { recursive: true });
              fs.cpSync(itemPath, modulesDir, { recursive: true });
            }
          }
        }

        const url = await orchestrator.start();
        process.env.FOUNDRY_URL = url;
      }

      process.env.FOUNDRY_VERSION = version;
      process.env.FOUNDRY_SYSTEM_ID = system;

      console.log(`Running: ${playwright}`);
      execSync(playwright, { stdio: "inherit", env: process.env });

      if (updateRegistry) {
        // Logic to update verified-versions.json
        console.log("Updating registry...");
        const registryPath = path.join(process.cwd(), "verified-versions.json");
        if (fs.existsSync(registryPath)) {
          const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
          registry.pending = registry.pending.filter((v: any) => v.version !== version);
          if (!registry.verified.find((v: any) => v.version === version)) {
            registry.verified.push({
              version,
              timestamp: new Date().toISOString(),
              status: "stable",
              notes: `Verified with CLI.`,
            });
          }
          fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    } finally {
      if (orchestrator) {
        await orchestrator.stopAndRemove();
      }
    }
  });

program.parse();
