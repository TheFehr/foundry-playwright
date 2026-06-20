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
    let tmpDataDir: string | null = null;

    try {
      if (docker) {
        tmpDataDir = path.join(
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

        // Auto-inject the current working directory if it is a module itself (contains module.json)
        const rootModuleJson = path.join(process.cwd(), "module.json");
        if (fs.existsSync(rootModuleJson)) {
          const moduleData = JSON.parse(fs.readFileSync(rootModuleJson, "utf8"));
          const moduleId = moduleData.id || moduleData.name;
          if (moduleId) {
            const modulesDir = path.join(tmpDataDir, "Data", "modules", moduleId);
            fs.mkdirSync(modulesDir, { recursive: true });

            const rootItems = fs.readdirSync(process.cwd());
            const exclude = ["node_modules", "e2e", ".git", ".foundry_cache", ".foundry_test_data"];
            for (const item of rootItems) {
              if (exclude.includes(item)) continue;
              const srcPath = path.join(process.cwd(), item);
              const destPath = path.join(modulesDir, item);
              fs.cpSync(srcPath, destPath, { recursive: true });
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
          registry.pending = registry.pending.filter(
            (v: { version: string }) => v.version !== version,
          );
          if (!registry.verified.find((v: { version: string }) => v.version === version)) {
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
    } catch (error: unknown) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    } finally {
      if (orchestrator) {
        await orchestrator.stopAndRemove();
      }
      if (tmpDataDir) {
        console.log(`[CLI] Cleaning up temporary data directory: ${tmpDataDir}`);
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

program.parse();
