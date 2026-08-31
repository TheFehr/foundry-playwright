import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import net from "net";
import os from "os";

export interface DockerOrchestratorConfig {
  version: string;
  port?: number;
  maxPortRetries?: number;
  adminKey?: string;
  username?: string;
  password?: string;
  dataDir?: string;
  cacheDir?: string;
  containerName?: string;
  /**
   * Set this when the `docker` binary is actually a rootless Podman install
   * (e.g. via the `podman-docker` package). Rootless container runtimes only
   * identity-map container UID 0 back to the invoking host user - any other
   * UID (including the `--user`-forced host UID below) otherwise maps
   * through an arbitrary /etc/subuid subordinate range instead, breaking
   * bind-mount ownership. `--userns=keep-id` (Podman-specific) fixes that.
   * Default false: no behavior change for a plain rootful Docker install.
   */
  rootless?: boolean;
}

/**
 * Host uid/gid for Docker's --user / FOUNDRY_UID+FOUNDRY_GID bind-mount
 * ownership matching. Returns null on Windows (process.getuid/getgid are
 * POSIX-only, undefined there) - Docker Desktop for Windows has no
 * host-side POSIX ownership to preserve on a bind mount in the first
 * place, so there's nothing to match and the container should just run
 * as its own default user.
 */
export function getHostUidGid(): { uid: number; gid: number } | null {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") return null;
  return { uid: process.getuid(), gid: process.getgid() };
}

/**
 * Whether the `docker` binary is actually a Podman install (e.g. via the
 * `podman-docker` package). `--userns=keep-id` is Podman-specific syntax -
 * real Docker (including rootless Docker) doesn't understand it, so the
 * `rootless` config option must only add it when this is true.
 */
export function isPodmanRuntime(): boolean {
  try {
    return /podman/i.test(execFileSync("docker", ["--version"], { encoding: "utf8" }));
  } catch {
    return false;
  }
}

/**
 * Programmatic orchestrator for Foundry VTT Docker containers.
 * Uses direct docker commands instead of docker-compose for better control and zero-config for users.
 */
export class DockerFoundryOrchestrator {
  private config: Required<DockerOrchestratorConfig>;

  constructor(config: DockerOrchestratorConfig) {
    this.config = {
      version: config.version,
      port: config.port || 30000,
      maxPortRetries: config.maxPortRetries ?? 10,
      adminKey: config.adminKey || "password",
      username: config.username || process.env.FOUNDRY_USERNAME || "",
      password: config.password || process.env.FOUNDRY_PASSWORD || "",
      dataDir: config.dataDir || path.join(process.cwd(), "foundry_data"),
      cacheDir: config.cacheDir || path.join(os.homedir(), ".cache", "foundry-playwright"),
      containerName:
        config.containerName || `foundry-playwright-${config.version.replace(/\./g, "-")}`,
      rootless: config.rootless ?? false,
    };
  }

  /**
   * Starts the Foundry VTT container.
   */
  async start(): Promise<string> {
    console.log(`[DockerOrchestrator] Starting Foundry VTT v${this.config.version}...`);

    // 0. Verify credentials are available before tearing anything down. A
    // literal newline in any of these would inject extra KEY=VALUE lines into
    // the env file below, letting a crafted credential value smuggle
    // arbitrary env vars into the container.
    if (!this.config.username || !this.config.password) {
      throw new Error(
        "[DockerOrchestrator] FOUNDRY_USERNAME and FOUNDRY_PASSWORD are required " +
          "(pass them via config or set them as environment variables) to start a container.",
      );
    }
    for (const [name, value] of [
      ["FOUNDRY_USERNAME", this.config.username],
      ["FOUNDRY_PASSWORD", this.config.password],
      ["FOUNDRY_ADMIN_KEY", this.config.adminKey],
    ]) {
      if (/[\r\n]/.test(value)) {
        throw new Error(`[DockerOrchestrator] ${name} must not contain line breaks.`);
      }
    }

    // 1. Stop/Remove existing container if it exists
    // We do this BEFORE finding an available port to avoid port drift if the existing container is using the target port.
    this.stopAndRemove();

    // 2. Find available port if needed
    const originalPort = this.config.port;
    const availablePort = await this.findAvailablePort(originalPort);
    if (availablePort !== originalPort) {
      console.log(
        `[DockerOrchestrator] Port ${originalPort} was unavailable. Using ${availablePort} instead.`,
      );
      this.config.port = availablePort;
    }

    // 3. Ensure directories exist and are actually writable by this process.
    // dataDir is normally freshly created per run, so this rarely matters
    // there, but cacheDir is persistent across runs and can carry over
    // top-level entries owned by a different uid (e.g. from before a --user
    // fix, or a different automation user) - getRunCommand()'s --user
    // override only controls what NEW writes are owned by, it does nothing
    // for files that already exist with the wrong owner. Detect and
    // best-effort fix that here, rather than finding out ~15 minutes into a
    // container run via a cryptic "Permission denied" (this exact scenario
    // has happened in practice).
    this.ensureWritableDir(this.config.dataDir);
    this.ensureWritableDir(this.config.cacheDir);

    // 4. Pull image if missing
    const image = `ghcr.io/felddy/foundryvtt:${this.config.version}`;
    const imageExists =
      execFileSync("docker", ["images", "-q", image], { encoding: "utf8" }).trim() !== "";
    // A hung pull (bad network/registry issue) would otherwise block silently
    // until whatever much longer timeout wraps this whole process - fail
    // clearly and quickly instead.
    const PULL_TIMEOUT_MS = 5 * 60 * 1000;

    if (!imageExists) {
      console.log(`[DockerOrchestrator] Image ${image} not found locally. Pulling...`);
      execFileSync("docker", ["pull", image], { stdio: "inherit", timeout: PULL_TIMEOUT_MS });
    } else {
      console.log(`[DockerOrchestrator] Image ${image} already exists locally.`);
      // Optional: try to pull to update, but ignore failures
      try {
        console.log(`[DockerOrchestrator] Attempting to update image ${image}...`);
        execFileSync("docker", ["pull", image], { stdio: "ignore", timeout: PULL_TIMEOUT_MS });
      } catch {
        console.warn(`[DockerOrchestrator] Failed to update image ${image}, using local version.`);
      }
    }

    // 5. Run container. Credentials are written to a fresh, restrictive-permission
    // file in the OS temp dir (never the project working directory) only for the
    // duration of this single `docker run -d` call - Docker reads --env-file once,
    // at container-creation time, and `-d` means this call returns as soon as the
    // container is created and started (not once it exits), so the file's real
    // on-disk lifetime is bounded to that single command, not the rest of the test
    // run. `-e KEY=VALUE` was considered instead of a file entirely, but
    // execFileSync prints its full argument list in the error it throws on
    // failure, which would leak credentials into CI logs.
    console.log(
      `[DockerOrchestrator] Executing: docker run -d --name ${this.config.containerName} ... (using --env-file for security)`,
    );
    const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-playwright-env-"));
    try {
      const envPath = path.join(envDir, "env");
      const envContent =
        `FOUNDRY_USERNAME=${this.config.username}\n` +
        `FOUNDRY_PASSWORD=${this.config.password}\n` +
        `FOUNDRY_ADMIN_KEY=${this.config.adminKey}\n`;
      fs.writeFileSync(envPath, envContent, { mode: 0o600 });
      execFileSync("docker", this.getRunCommand(envPath), { stdio: "inherit" });
    } finally {
      fs.rmSync(envDir, { recursive: true, force: true });
    }

    // 6. Wait for healthy
    await this.waitForReady();

    return `http://localhost:${this.config.port}`;
  }

  /**
   * Generates the arguments for `docker run` (excluding the "docker" binary
   * itself) as an array, for execFileSync - never shell-joined, so none of
   * these values (container name, resolved paths, version-derived image tag)
   * can be interpreted as shell metacharacters.
   * @internal
   */
  getRunCommand(envPath: string): string[] {
    const image = `ghcr.io/felddy/foundryvtt:${this.config.version}`;
    const ids = getHostUidGid();

    // felddy/foundryvtt images before V13 default to root, chown /data
    // themselves via the FOUNDRY_UID/FOUNDRY_GID env vars, and only then
    // su-exec down to that uid for the actual Foundry process - critically,
    // *before* that drop, entrypoint.sh's authenticate step still needs to
    // write a cookiejar into its own (root-owned, non-bind-mounted) home
    // directory. Forcing `docker run --user <host-uid>` for the whole
    // container (as done below for V13+) skips straight past that root
    // step and makes that write fail with EACCES - confirmed empirically
    // against ghcr.io/felddy/foundryvtt:12.343.0, which never leaves its
    // authenticate-retry loop under a forced --user. V13+ images dropped
    // FOUNDRY_UID/FOUNDRY_GID entirely (they're in that image's own
    // DEPRECATED_ENVS) and instead expect the caller to run as an arbitrary
    // uid directly via --user (felddy/foundryvtt-docker discussion #1197) -
    // so the two mechanisms are mutually exclusive, not just old/new syntax
    // for the same thing, and must be selected per major version.
    const usesLegacyUidGid = Number(this.config.version.split(".")[0]) < 13;

    // Under rootless Podman, an unprivileged container's root (or any uid it
    // chowns to) maps through /etc/subuid, not to the real host uid - so
    // without --userns=keep-id, the legacy branch's own FOUNDRY_UID/GID
    // chown (see above) lands on a subuid-mapped owner on the host side,
    // not the actual host user, defeating the reason those env vars are
    // passed at all. Same reasoning as the --user branch below, which
    // already needs this for the same reason - applies regardless of which
    // of the two uid-matching mechanisms is in play.
    const userNsFlag = this.config.rootless && isPodmanRuntime() ? ["--userns=keep-id"] : [];

    return [
      "run",
      "-d",
      "--name",
      this.config.containerName,
      "--restart",
      "always",
      "-p",
      `${this.config.port}:30000`,
      "--env-file",
      path.resolve(envPath),
      ...(ids
        ? usesLegacyUidGid
          ? ["-e", `FOUNDRY_UID=${ids.uid}`, "-e", `FOUNDRY_GID=${ids.gid}`, ...userNsFlag]
          : ["--user", `${ids.uid}:${ids.gid}`, ...userNsFlag]
        : []),
      "-v",
      `${path.resolve(this.config.dataDir)}:/data`,
      "-v",
      `${path.resolve(this.config.cacheDir)}:/data/container_cache`,
      image,
    ];
  }

  /**
   * Ensures a bind-mount directory exists and its top-level entries are
   * actually owned by the current process, best-effort fixing any that
   * aren't (only possible when this process already has permission to -
   * e.g. after switching automation users, it typically won't). Only checks
   * top-level entries, matching the known shape of this cache directory
   * (a handful of files, not deeply nested) rather than a full recursive
   * walk of potentially large cached content.
   */
  private ensureWritableDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }
    const ids = getHostUidGid();
    if (!ids) {
      // Windows has no POSIX ownership model to fix - just verify the
      // directory is writable, nothing to chown.
      try {
        fs.accessSync(dir, fs.constants.W_OK);
      } catch {
        throw new Error(`[DockerOrchestrator] ${dir} isn't writable by the current user.`);
      }
      return;
    }
    const { uid, gid } = ids;
    const unfixable = new Set<string>();

    const fixOwnership = (entryPath: string) => {
      try {
        if (fs.statSync(entryPath).uid === uid) return;
        fs.chownSync(entryPath, uid, gid);
      } catch {
        // Covers both a failed chown AND a failed stat (e.g. a dangling
        // symlink, or the entry vanishing between readdirSync and here) -
        // either way, fold into the same diagnostic below instead of
        // letting a raw fs exception escape this function.
        unfixable.add(entryPath);
      }
    };

    // The directory itself, not just its contents - readdirSync can succeed
    // on a directory this process doesn't own if group/other bits allow it,
    // which isn't the same as being able to write new entries into it.
    fixOwnership(dir);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      // Can't even list it (e.g. restrictive mode bits on a directory owned
      // by a different uid that chownSync above also couldn't fix) - fold
      // into the same diagnostic below rather than letting a raw fs
      // exception escape this function.
      unfixable.add(dir);
    }
    for (const entry of entries) {
      fixOwnership(path.join(dir, entry));
    }

    try {
      fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
    } catch {
      unfixable.add(dir);
    }

    if (unfixable.size > 0) {
      throw new Error(
        `[DockerOrchestrator] ${dir} isn't writable/accessible by the current user (uid ${uid}) and this process lacks permission to fix it: ${[...unfixable].join(", ")}. This can happen after switching automation users or removing elevated privileges. Fix manually, e.g.: sudo chown -R ${uid}:${gid} "${dir}"`,
      );
    }
  }

  /**
   * Stops and removes the container.
   */
  stopAndRemove() {
    console.log(`[DockerOrchestrator] Cleaning up container ${this.config.containerName}...`);
    for (const args of [
      ["stop", this.config.containerName],
      ["rm", this.config.containerName],
    ]) {
      try {
        execFileSync("docker", args, { stdio: ["ignore", "ignore", "pipe"] });
      } catch (e) {
        // The container simply not existing yet is expected (this runs as
        // pre-cleanup before every start()) - both Docker ("No such
        // container: X") and Podman ("no container with name or ID X
        // found: no such container") phrase it differently but always
        // include "no such container". Anything else (daemon down,
        // permission denied, a container that won't stop) is a real
        // failure callers need to know about, since they may otherwise
        // proceed to remove a bind-mounted data dir a container is still
        // using.
        const stderr = (e as { stderr?: Buffer | string }).stderr?.toString() ?? "";
        if (!/no such container/i.test(stderr)) {
          throw new Error(
            `[DockerOrchestrator] Failed to ${args[0]} container ${this.config.containerName}: ${stderr || (e as Error).message}`,
          );
        }
      }
    }
  }

  /**
   * Copies a local path into the container.
   */
  copyToContainer(localPath: string, containerPath: string) {
    console.log(
      `[DockerOrchestrator] Copying ${localPath} to ${this.config.containerName}:${containerPath}`,
    );
    const ids = getHostUidGid();
    const expectedOwner = ids ? `${ids.uid}:${ids.gid}` : null;

    // Creates the destination directory inside the already-running container
    // via `docker exec` - this requires the configured container to already
    // be running (no ephemeral container is involved). docker exec defaults
    // to the same identity getRunCommand() configured via --user, so this
    // directory is already owned by that identity. Array-form execFileSync
    // avoids shell interpretation of localPath/containerPath/containerName
    // entirely (no `sh -c`, no metacharacters).
    execFileSync(
      "docker",
      ["exec", this.config.containerName, "mkdir", "-p", path.dirname(containerPath)],
      { stdio: "inherit" },
    );
    execFileSync(
      "docker",
      ["cp", "-a", localPath, `${this.config.containerName}:${containerPath}`],
      {
        stdio: "inherit",
      },
    );

    // Archive mode (-a) has been verified, directly, to attribute ownership
    // to the container's own --user-configured identity under both real
    // Docker and rootless Podman - but that's an emergent behavior, not a
    // documented contract, so verify the actual result explicitly rather
    // than silently trusting it. If it ever doesn't hold (a different
    // Docker/Podman version), fail clearly instead of leaving files that
    // Foundry can't read/write: this process runs docker exec as the
    // container's own non-root identity (matching getRunCommand()'s
    // --user), so it has no privilege to chown the file after the fact
    // either - there's no fixup to fall back to here. Directory copies are
    // verified recursively (every entry, not just the top-level path),
    // since a partial-ownership regression on nested content wouldn't be
    // caught by only checking containerPath itself.
    //
    // On Windows, getRunCommand() never forces --user (there's no host
    // POSIX identity to match), so there's no expected owner to verify
    // against here either - skip the check entirely.
    if (!expectedOwner) return;

    const mismatches = fs.statSync(localPath).isDirectory()
      ? execFileSync(
          "docker",
          [
            "exec",
            this.config.containerName,
            "find",
            containerPath,
            "-exec",
            "stat",
            "-c",
            "%u:%g %n",
            "{}",
            "+",
          ],
          { encoding: "utf8" },
        )
          .trim()
          .split("\n")
          .filter((line) => line.length > 0 && !line.startsWith(`${expectedOwner} `))
      : (() => {
          const actualOwner = execFileSync(
            "docker",
            ["exec", this.config.containerName, "stat", "-c", "%u:%g", containerPath],
            { encoding: "utf8" },
          ).trim();
          return actualOwner === expectedOwner ? [] : [`${actualOwner} ${containerPath}`];
        })();

    if (mismatches.length > 0) {
      throw new Error(
        `[DockerOrchestrator] Copied path(s) not owned by the expected ${expectedOwner}: ${mismatches.join(", ")} - archive-mode copy didn't attribute ownership as expected on this Docker/Podman version.`,
      );
    }
  }

  private async waitForReady(): Promise<void> {
    const url = `http://localhost:${this.config.port}`;
    console.log(`[DockerOrchestrator] Waiting for Foundry to be ready at ${url}...`);

    let ready = false;
    const maxAttempts = 150;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!ready) {
      throw new Error("Foundry VTT failed to start within the timeout period.");
    }
    console.log("[DockerOrchestrator] Foundry is ready!");
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    let currentPort = startPort;
    const maxPort = startPort + this.config.maxPortRetries;

    while (currentPort <= maxPort) {
      if (await this.isPortAvailable(currentPort)) {
        return currentPort;
      }
      currentPort++;
    }

    throw new Error(
      `[DockerOrchestrator] No available ports found in range ${startPort} - ${maxPort}.`,
    );
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => {
        resolve(false);
      });
      server.once("listening", () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }
}
