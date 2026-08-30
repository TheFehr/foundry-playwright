import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { DockerFoundryOrchestrator, getHostUidGid } from "./docker.js";
import path from "path";
import fs from "fs";
import os from "os";

vi.mock("child_process", () => ({ execFileSync: vi.fn<typeof execFileSync>() }));

// null on Windows (process.getuid/getgid are POSIX-only) - tests that
// assert POSIX-specific uid/gid flags are skipped there in favor of the
// dedicated "Windows (no process.getuid/getgid)" block below, which
// simulates the same condition on any platform.
const hostIds = getHostUidGid();
const expectedUserFlag = hostIds ? [`--user`, `${hostIds.uid}:${hostIds.gid}`] : [];

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

  it.skipIf(!hostIds)("omits --userns=keep-id by default", () => {
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

  it.skipIf(!hostIds)(
    "adds --userns=keep-id when rootless is set and the runtime is Podman",
    () => {
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
    },
  );

  it.skipIf(!hostIds)(
    "omits --userns=keep-id when rootless is set but the runtime is real Docker",
    () => {
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
    },
  );

  it.skipIf(!hostIds)("uses FOUNDRY_UID/FOUNDRY_GID instead of --user for pre-V13 images", () => {
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
    expect(command).toEqual(expect.arrayContaining(["-e", `FOUNDRY_UID=${hostIds!.uid}`]));
    expect(command).toEqual(expect.arrayContaining(["-e", `FOUNDRY_GID=${hostIds!.gid}`]));
  });

  it.skipIf(!hostIds)("adds --userns=keep-id for pre-V13 images under rootless Podman", () => {
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
    expect(command).toEqual(expect.arrayContaining(["-e", `FOUNDRY_UID=${hostIds!.uid}`]));
    expect(command).toEqual(expect.arrayContaining(["-e", `FOUNDRY_GID=${hostIds!.gid}`]));
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

  describe("start() env file lifecycle", () => {
    let tmpBase: string;

    beforeEach(() => {
      tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "docker-start-test-"));
      vi.unstubAllEnvs();
    });

    afterEach(() => {
      fs.rmSync(tmpBase, { recursive: true, force: true });
      vi.unstubAllEnvs();
    });

    it("throws before touching Docker when username/password are missing", async () => {
      vi.stubEnv("FOUNDRY_USERNAME", "");
      vi.stubEnv("FOUNDRY_PASSWORD", "");
      const orchestrator = new DockerFoundryOrchestrator({
        version: "13.351.0",
        port: 48213,
        maxPortRetries: 0,
        dataDir: path.join(tmpBase, "data"),
        cacheDir: path.join(tmpBase, "cache"),
      });

      await expect(orchestrator.start()).rejects.toThrow(
        /FOUNDRY_USERNAME and FOUNDRY_PASSWORD are required/,
      );
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it("writes credentials to a fresh temp env file for `docker run` and removes it afterward, even when the run fails", async () => {
      let capturedEnvPath: string | null = null;
      let capturedEnvContent: string | null = null;
      vi.mocked(execFileSync).mockImplementation(((cmd: string, args: string[]) => {
        if (args[0] === "images") return "";
        if (args[0] === "pull" || args[0] === "stop" || args[0] === "rm") return "";
        if (args[0] === "run") {
          capturedEnvPath = args[args.indexOf("--env-file") + 1];
          capturedEnvContent = fs.readFileSync(capturedEnvPath, "utf8");
          throw new Error("simulated docker run failure");
        }
        return "";
      }) as unknown as typeof execFileSync);

      const orchestrator = new DockerFoundryOrchestrator({
        version: "13.351.0",
        port: 48213,
        maxPortRetries: 0,
        username: "test-user",
        password: "test-pass",
        adminKey: "test-key",
        dataDir: path.join(tmpBase, "data"),
        cacheDir: path.join(tmpBase, "cache"),
      });

      await expect(orchestrator.start()).rejects.toThrow("simulated docker run failure");
      expect(capturedEnvContent).toBe(
        "FOUNDRY_USERNAME=test-user\nFOUNDRY_PASSWORD=test-pass\nFOUNDRY_ADMIN_KEY=test-key\n",
      );
      expect(capturedEnvPath).not.toBeNull();
      expect(fs.existsSync(path.dirname(capturedEnvPath as unknown as string))).toBe(false);
    });
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
        // Message differs by platform (POSIX chown-fixing path vs. the
        // Windows path, which has no ownership model to fix) - match the
        // substring both share rather than picking one exact phrasing.
        expect(() => callEnsureWritableDir(orchestrator, dir)).toThrow(/isn't writable/);
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

  describe.skipIf(!hostIds)("copyToContainer", () => {
    const expectedOwner = hostIds ? `${hostIds.uid}:${hostIds.gid}` : "";
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

  // Simulates the real Windows condition (process.getuid/getgid don't
  // exist) by deleting them for the duration of this block, rather than
  // relying on actually running on Windows - so this coverage runs on
  // every platform's CI, not just the windows-latest job.
  describe("Windows (no process.getuid/getgid)", () => {
    let originalGetuid: typeof process.getuid;
    let originalGetgid: typeof process.getgid;

    beforeEach(() => {
      originalGetuid = process.getuid;
      originalGetgid = process.getgid;
      // @ts-expect-error simulating a platform where these don't exist
      delete process.getuid;
      // @ts-expect-error simulating a platform where these don't exist
      delete process.getgid;
    });

    afterEach(() => {
      process.getuid = originalGetuid;
      process.getgid = originalGetgid;
    });

    it("omits --user and FOUNDRY_UID/FOUNDRY_GID for a V13+ image", () => {
      const orchestrator = new DockerFoundryOrchestrator({ version: "13.351.0" });
      const command = orchestrator.getRunCommand(".env");
      expect(command).not.toContain("--user");
      expect(command).not.toContain("FOUNDRY_UID");
      expect(command).not.toContain("FOUNDRY_GID");
      expect(command).not.toContain("--userns=keep-id");
    });

    it("omits FOUNDRY_UID/FOUNDRY_GID and --user for a pre-V13 image", () => {
      const orchestrator = new DockerFoundryOrchestrator({ version: "12.343.0" });
      const command = orchestrator.getRunCommand(".env");
      expect(command).not.toContain("--user");
      expect(command.some((arg) => arg.startsWith("FOUNDRY_UID="))).toBe(false);
      expect(command.some((arg) => arg.startsWith("FOUNDRY_GID="))).toBe(false);
    });

    describe("ensureWritableDir", () => {
      let tmpBase: string;

      beforeEach(() => {
        tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fp-docker-test-win-"));
      });

      afterEach(() => {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      });

      it("creates the directory if it doesn't exist", () => {
        const dir = path.join(tmpBase, "new-subdir");
        const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0" });
        expect(fs.existsSync(dir)).toBe(false);
        callEnsureWritableDir(orchestrator, dir);
        expect(fs.existsSync(dir)).toBe(true);
      });

      it("does not throw for an existing, writable directory (no chown attempted)", () => {
        const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0" });
        expect(() => callEnsureWritableDir(orchestrator, tmpBase)).not.toThrow();
      });

      it("throws a clear error for a directory that isn't writable (no chown to fall back to)", () => {
        const accessSpy = vi.spyOn(fs, "accessSync").mockImplementation(() => {
          throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        });
        const orchestrator = new DockerFoundryOrchestrator({ version: "1.0.0" });
        try {
          expect(() => callEnsureWritableDir(orchestrator, tmpBase)).toThrow(
            /isn't writable by the current user/,
          );
        } finally {
          accessSpy.mockRestore();
        }
      });
    });

    it("copyToContainer skips ownership verification entirely", () => {
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fp-docker-test-win-"));
      const localFile = path.join(tmpBase, "file.txt");
      fs.writeFileSync(localFile, "hi");
      try {
        vi.mocked(execFileSync)
          .mockReturnValueOnce("") // mkdir -p
          .mockReturnValueOnce(""); // cp -a
        const orchestrator = new DockerFoundryOrchestrator({
          version: "1.0.0",
          containerName: "x",
        });
        expect(() => orchestrator.copyToContainer(localFile, "/container/path")).not.toThrow();
        // Only mkdir + cp - no stat/find call, since there's no host owner
        // to verify against.
        expect(execFileSync).toHaveBeenCalledTimes(2);
      } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    });
  });
});
