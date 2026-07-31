import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import { DockerFoundryOrchestrator } from "./docker.js";
import path from "path";

vi.mock("child_process", () => ({ execFileSync: vi.fn<typeof execFileSync>() }));

const expectedUserFlag = [`--user`, `${process.getuid!()}:${process.getgid!()}`];

describe("DockerFoundryOrchestrator", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  it("generates the correct docker run command", () => {
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.327",
      port: 30001,
      containerName: "test-foundry",
      dataDir: "/tmp/data",
      cacheDir: "/tmp/cache",
    });

    const envPath = ".env.test";
    const command = orchestrator.getRunCommand(envPath).join(" ");

    expect(command).toContain("run -d");
    expect(command).toContain("--name test-foundry");
    expect(command).toContain("-p 30001:30000");
    expect(command).toContain(`--env-file ${path.resolve(envPath)}`);
    expect(command).toContain(`-v ${path.resolve("/tmp/data")}:/data`);
    expect(command).toContain(`-v ${path.resolve("/tmp/cache")}:/data/container_cache`);
    expect(command).toContain("ghcr.io/felddy/foundryvtt:12.327");
  });

  it("uses default values for optional config", () => {
    const orchestrator = new DockerFoundryOrchestrator({
      version: "11.315",
    });

    const command = orchestrator.getRunCommand(".env").join(" ");

    expect(command).toContain("-p 30000:30000");
    expect(command).toContain("--name foundry-playwright-11-315");
    expect(command).toContain("ghcr.io/felddy/foundryvtt:11.315");
  });

  it("omits --userns=keep-id by default", () => {
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.327",
    });
    const command = orchestrator.getRunCommand(".env");
    expect(command).toEqual(expect.arrayContaining(expectedUserFlag));
    expect(command).not.toContain("--userns=keep-id");
    // rootless defaults to false, so the runtime-detection shell-out should
    // never even happen.
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("adds --userns=keep-id when rootless is set and the runtime is Podman", () => {
    vi.mocked(execFileSync).mockReturnValue(
      "Emulate Docker CLI using podman.\npodman version 5.7.0\n",
    );
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.327",
      rootless: true,
    });
    const command = orchestrator.getRunCommand(".env");
    expect(command).toEqual(expect.arrayContaining(expectedUserFlag));
    expect(command).toContain("--userns=keep-id");
  });

  it("omits --userns=keep-id when rootless is set but the runtime is real Docker", () => {
    // --userns=keep-id is Podman-specific syntax; real (including rootless)
    // Docker doesn't understand it and would fail outright if it were added.
    vi.mocked(execFileSync).mockReturnValue("Docker version 27.3.1, build ce12230\n");
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.327",
      rootless: true,
    });
    const command = orchestrator.getRunCommand(".env");
    expect(command).toEqual(expect.arrayContaining(expectedUserFlag));
    expect(command).not.toContain("--userns=keep-id");
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
