import { describe, it, expect } from "vitest";
import { DockerFoundryOrchestrator } from "./docker.js";
import path from "path";

describe("DockerFoundryOrchestrator", () => {
  it("generates the correct docker run command", () => {
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.327",
      port: 30001,
      containerName: "test-foundry",
      dataDir: "/tmp/data",
      cacheDir: "/tmp/cache",
    });

    const envPath = ".env.test";
    const command = orchestrator.getRunCommand(envPath);

    expect(command).toContain("docker run -d");
    expect(command).toContain("--name test-foundry");
    expect(command).toContain("-p 30001:30000");
    expect(command).toContain(`--env-file "${path.resolve(envPath)}"`);
    expect(command).toContain(`-v "${path.resolve("/tmp/data")}:/data"`);
    expect(command).toContain(`-v "${path.resolve("/tmp/cache")}:/data/container_cache"`);
    expect(command).toContain("ghcr.io/felddy/foundryvtt:12.327");
  });

  it("uses default values for optional config", () => {
    const orchestrator = new DockerFoundryOrchestrator({
      version: "11.315",
    });

    const command = orchestrator.getRunCommand(".env");

    expect(command).toContain("-p 30000:30000");
    expect(command).toContain("--name foundry-playwright-11-315");
    expect(command).toContain("ghcr.io/felddy/foundryvtt:11.315");
  });

  it("respects maxPortRetries in config", () => {
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.327",
      maxPortRetries: 20,
    });
    // Accessing private config for test verification
    const config = (orchestrator as unknown as { config: { maxPortRetries: number } }).config;
    expect(config.maxPortRetries).toBe(20);
  });

  it("defaults maxPortRetries to 10", () => {
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.327",
    });
    const config = (orchestrator as unknown as { config: { maxPortRetries: number } }).config;
    expect(config.maxPortRetries).toBe(10);
  });
});
