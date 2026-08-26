import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { DockerFoundryOrchestrator } from "./docker.js";
import path from "path";
import fs from "fs";
import os from "os";

vi.mock("child_process", () => ({ execFileSync: vi.fn<typeof execFileSync>() }));

const expectedUserFlag = [`--user`, `${process.getuid!()}:${process.getgid!()}`];

function callEnsureWritableDir(orchestrator: DockerFoundryOrchestrator, dir: string): void {
  (orchestrator as unknown as { ensureWritableDir: (d: string) => void }).ensureWritableDir(dir);
}

function dockerErrorWithStderr(stderr: string): Error & { stderr: string } {
  return Object.assign(new Error("Command failed"), { stderr });
}

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
      version: "13.351.0",
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
      version: "13.351.0",
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
      version: "13.351.0",
      rootless: true,
    });
    const command = orchestrator.getRunCommand(".env");
    expect(command).toEqual(expect.arrayContaining(expectedUserFlag));
    expect(command).not.toContain("--userns=keep-id");
  });

  it("uses FOUNDRY_UID/FOUNDRY_GID instead of --user for pre-V13 images", () => {
    // ghcr.io/felddy/foundryvtt images before V13 default to root and only
    // drop to FOUNDRY_UID/FOUNDRY_GID internally (via su-exec) after their
    // entrypoint has done some root-only setup (e.g. writing a cookiejar
    // into its own home dir during FOUNDRY_USERNAME/PASSWORD auth) - forcing
    // --user for the whole container breaks that setup. V13+ images dropped
    // FOUNDRY_UID/FOUNDRY_GID entirely and expect --user instead. Confirmed
    // empirically against ghcr.io/felddy/foundryvtt:12.343.0.
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.343.0",
    });
    const command = orchestrator.getRunCommand(".env");
    expect(command).not.toEqual(expect.arrayContaining(["--user"]));
    expect(command).toEqual(expect.arrayContaining(["-e", `FOUNDRY_UID=${process.getuid!()}`]));
    expect(command).toEqual(expect.arrayContaining(["-e", `FOUNDRY_GID=${process.getgid!()}`]));
  });

  it("adds --userns=keep-id for pre-V13 images under rootless Podman", () => {
    // Without keep-id, the legacy branch's own FOUNDRY_UID/FOUNDRY_GID chown
    // (see getRunCommand) lands on a subuid-mapped owner on the host side
    // under rootless Podman, not the real host uid - defeating the reason
    // those env vars are passed at all. Same fix as the --user branch,
    // needed for the same reason.
    vi.mocked(execFileSync).mockReturnValue(
      "Emulate Docker CLI using podman.\npodman version 5.7.0\n",
    );
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.343.0",
      rootless: true,
    });
    const command = orchestrator.getRunCommand(".env");
    expect(command).not.toEqual(expect.arrayContaining(["--user"]));
    expect(command).toEqual(expect.arrayContaining(["-e", `FOUNDRY_UID=${process.getuid!()}`]));
    expect(command).toEqual(expect.arrayContaining(["-e", `FOUNDRY_GID=${process.getgid!()}`]));
    expect(command).toContain("--userns=keep-id");
  });

  it("omits --userns=keep-id for pre-V13 images when rootless is set but the runtime is real Docker", () => {
    vi.mocked(execFileSync).mockReturnValue("Docker version 27.3.1, build ce12230\n");
    const orchestrator = new DockerFoundryOrchestrator({
      version: "12.343.0",
      rootless: true,
    });
    const command = orchestrator.getRunCommand(".env");
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

  describe("ensureWritableDir (real filesystem, not mocked)", () => {
    let tmpBase: string;

    beforeEach(() => {
      tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fp-docker-test-"));
    });

    it("creates the directory if it doesn't exist", () => {
      const dir = path.join(tmpBase, "new-subdir");
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0" });
      expect(fs.existsSync(dir)).toBe(false);
      callEnsureWritableDir(orchestrator, dir);
      expect(fs.existsSync(dir)).toBe(true);
      fs.rmSync(tmpBase, { recursive: true, force: true });
    });

    it("does not throw when the directory and its contents are already owned by the current user", () => {
      fs.writeFileSync(path.join(tmpBase, "file.txt"), "hi");
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0" });
      expect(() => callEnsureWritableDir(orchestrator, tmpBase)).not.toThrow();
      fs.rmSync(tmpBase, { recursive: true, force: true });
    });

    it("throws a clear, actionable error when the directory can't be made writable/accessible", () => {
      // Mocked rather than chmod 0o000 - permission bits don't reliably
      // produce EACCES when running as root (common in CI containers) or
      // on Windows, so this needs to work regardless of who/where it runs.
      const dir = path.join(tmpBase, "locked");
      fs.mkdirSync(dir);
      const eacces = (): never => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      };
      const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementation(eacces as never);
      const accessSpy = vi.spyOn(fs, "accessSync").mockImplementation(eacces as never);
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0" });
      try {
        expect(() => callEnsureWritableDir(orchestrator, dir)).toThrow(
          /isn't writable\/accessible/,
        );
      } finally {
        readdirSpy.mockRestore();
        accessSpy.mockRestore();
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    });
  });

  describe("stopAndRemove", () => {
    it("tolerates a container that doesn't exist yet (Docker's error phrasing)", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw dockerErrorWithStderr("Error response from daemon: No such container: x\n");
      });
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0", containerName: "x" });
      expect(() => orchestrator.stopAndRemove()).not.toThrow();
    });

    it("tolerates a container that doesn't exist yet (Podman's error phrasing)", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw dockerErrorWithStderr(
          'Error: no container with name or ID "x" found: no such container\n',
        );
      });
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0", containerName: "x" });
      expect(() => orchestrator.stopAndRemove()).not.toThrow();
    });

    it("propagates a real cleanup failure instead of swallowing it", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw dockerErrorWithStderr(
          "Cannot connect to the Docker daemon. Is the docker daemon running?\n",
        );
      });
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0", containerName: "x" });
      expect(() => orchestrator.stopAndRemove()).toThrow(/Failed to stop container x/);
    });
  });

  describe("copyToContainer", () => {
    const expectedOwner = `${process.getuid!()}:${process.getgid!()}`;
    let tmpBase: string;
    let localFile: string;
    let localDir: string;

    beforeEach(() => {
      tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fp-docker-test-"));
      localFile = path.join(tmpBase, "file.txt");
      fs.writeFileSync(localFile, "hi");
      localDir = path.join(tmpBase, "dir");
      fs.mkdirSync(localDir);
    });

    afterEach(() => {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    });

    it("succeeds when the copied file's ownership matches the configured identity", () => {
      vi.mocked(execFileSync)
        .mockReturnValueOnce("") // mkdir -p
        .mockReturnValueOnce("") // cp -a
        .mockReturnValueOnce(`${expectedOwner}\n`); // stat
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0", containerName: "x" });
      expect(() => orchestrator.copyToContainer(localFile, "/container/path")).not.toThrow();
    });

    it("throws when the copied file's ownership doesn't match the configured identity", () => {
      vi.mocked(execFileSync)
        .mockReturnValueOnce("") // mkdir -p
        .mockReturnValueOnce("") // cp -a
        .mockReturnValueOnce("0:0\n"); // stat - unexpectedly root-owned
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0", containerName: "x" });
      expect(() => orchestrator.copyToContainer(localFile, "/container/path")).toThrow(
        /didn't attribute ownership as expected/,
      );
    });

    it("verifies every entry recursively when the copied path is a directory", () => {
      vi.mocked(execFileSync)
        .mockReturnValueOnce("") // mkdir -p
        .mockReturnValueOnce("") // cp -a
        .mockReturnValueOnce(
          `${expectedOwner} /container/path\n${expectedOwner} /container/path/nested.txt\n`,
        ); // find + stat
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0", containerName: "x" });
      expect(() => orchestrator.copyToContainer(localDir, "/container/path")).not.toThrow();
    });

    it("throws when any nested entry's ownership doesn't match, not just the top-level directory", () => {
      vi.mocked(execFileSync)
        .mockReturnValueOnce("") // mkdir -p
        .mockReturnValueOnce("") // cp -a
        .mockReturnValueOnce(`${expectedOwner} /container/path\n0:0 /container/path/nested.txt\n`); // find + stat
      const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0", containerName: "x" });
      expect(() => orchestrator.copyToContainer(localDir, "/container/path")).toThrow(
        /didn't attribute ownership as expected/,
      );
    });
  });
});
