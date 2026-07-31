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
  envFile?: string;
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
      envFile: config.envFile || ".env",
      rootless: config.rootless ?? false,
    };
  }

  /**
   * Starts the Foundry VTT container.
   */
  async start(): Promise<string> {
    console.log(`[DockerOrchestrator] Starting Foundry VTT v${this.config.version}...`);

    // 0. Verify environment file first - don't tear down if invalid
    const envPath = path.resolve(this.config.envFile);
    if (!fs.existsSync(envPath)) {
      throw new Error(
        `[DockerOrchestrator] Environment file not found at ${envPath}. A valid .env file is required to avoid leaking credentials in logs.`,
      );
    }

    const envContent = fs.readFileSync(envPath, "utf8");
    const requiredVars = ["FOUNDRY_USERNAME", "FOUNDRY_PASSWORD", "FOUNDRY_ADMIN_KEY"];
    for (const v of requiredVars) {
      const regex = new RegExp(`^[ \\t]*${v}=`, "m");
      if (!regex.test(envContent)) {
        throw new Error(
          `[DockerOrchestrator] Environment file at ${envPath} is missing required variable: ${v}`,
        );
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

    if (!imageExists) {
      console.log(`[DockerOrchestrator] Image ${image} not found locally. Pulling...`);
      execFileSync("docker", ["pull", image], { stdio: "inherit" });
    } else {
      console.log(`[DockerOrchestrator] Image ${image} already exists locally.`);
      // Optional: try to pull to update, but ignore failures
      try {
        console.log(`[DockerOrchestrator] Attempting to update image ${image}...`);
        execFileSync("docker", ["pull", image], { stdio: "ignore" });
      } catch {
        console.warn(`[DockerOrchestrator] Failed to update image ${image}, using local version.`);
      }
    }

    // 5. Run container
    console.log(
      `[DockerOrchestrator] Executing: docker run -d --name ${this.config.containerName} ... (using --env-file for security)`,
    );
    execFileSync("docker", this.getRunCommand(envPath), { stdio: "inherit" });

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
      // Foundry defaults to running internally as uid:gid 1000:1000, which
      // won't generally match the host user owning the bind mount (e.g. a
      // dedicated automation user). The image supports overriding this via
      // Docker's own --user (see felddy/foundryvtt-docker discussion #1197),
      // matched here to whichever user is actually running this - so
      // everything Foundry writes to the bind mounts is owned by that same
      // user from the start, with no permission mismatch to reconcile.
      "--user",
      `${process.getuid!()}:${process.getgid!()}`,
      ...(this.config.rootless && isPodmanRuntime() ? ["--userns=keep-id"] : []),
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
    const uid = process.getuid!();
    const gid = process.getgid!();
    const unfixable = new Set<string>();

    const fixOwnership = (entryPath: string) => {
      if (fs.statSync(entryPath).uid === uid) return;
      try {
        fs.chownSync(entryPath, uid, gid);
      } catch {
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
    const uid = process.getuid!();
    const gid = process.getgid!();
    const expectedOwner = `${uid}:${gid}`;

    // Ensure destination directory exists via an ephemeral container or exec (if running)
    // (docker exec defaults to the same identity getRunCommand() configured
    // via --user, so this directory is already owned by that identity.)
    // Array-form execFileSync avoids shell interpretation of localPath/
    // containerPath/containerName entirely (no `sh -c`, no metacharacters).
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
    // either - there's no fixup to fall back to here.
    const actualOwner = execFileSync(
      "docker",
      ["exec", this.config.containerName, "stat", "-c", "%u:%g", containerPath],
      { encoding: "utf8" },
    ).trim();
    if (actualOwner !== expectedOwner) {
      throw new Error(
        `[DockerOrchestrator] Copied ${containerPath} is owned by ${actualOwner}, not the expected ${expectedOwner} - archive-mode copy didn't attribute ownership as expected on this Docker/Podman version.`,
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
