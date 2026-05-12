import { execSync } from "child_process";
import path from "path";
import fs from "fs";

export interface DockerOrchestratorConfig {
  version: string;
  port?: number;
  adminKey?: string;
  username?: string;
  password?: string;
  dataDir?: string;
  cacheDir?: string;
  containerName?: string;
  envFile?: string;
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
      adminKey: config.adminKey || "password",
      username: config.username || process.env.FOUNDRY_USERNAME || "",
      password: config.password || process.env.FOUNDRY_PASSWORD || "",
      dataDir: config.dataDir || path.join(process.cwd(), "foundry_data"),
      cacheDir: config.cacheDir || path.join(process.cwd(), ".foundry_cache"),
      containerName:
        config.containerName || `foundry-playwright-${config.version.replace(/\./g, "-")}`,
      envFile: config.envFile || ".env",
    };
  }

  /**
   * Starts the Foundry VTT container.
   */
  async start(): Promise<string> {
    console.log(`[DockerOrchestrator] Starting Foundry VTT v${this.config.version}...`);

    // 1. Verify environment file
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

    // 2. Ensure directories exist
    if (!fs.existsSync(this.config.dataDir)) fs.mkdirSync(this.config.dataDir, { recursive: true });
    if (!fs.existsSync(this.config.cacheDir))
      fs.mkdirSync(this.config.cacheDir, { recursive: true });

    // 3. Stop/Remove existing container if it exists
    this.stopAndRemove();

    // 4. Pull image if missing
    const image = `ghcr.io/felddy/foundryvtt:${this.config.version}`;
    const imageExists = execSync(`docker images -q ${image}`, { encoding: "utf8" }).trim() !== "";

    if (!imageExists) {
      console.log(`[DockerOrchestrator] Image ${image} not found locally. Pulling...`);
      execSync(`docker pull ${image}`, { stdio: "inherit" });
    } else {
      console.log(`[DockerOrchestrator] Image ${image} already exists locally.`);
      // Optional: try to pull to update, but ignore failures
      try {
        console.log(`[DockerOrchestrator] Attempting to update image ${image}...`);
        execSync(`docker pull ${image}`, { stdio: "ignore" });
      } catch {
        console.warn(`[DockerOrchestrator] Failed to update image ${image}, using local version.`);
      }
    }

    // 5. Run container
    const dockerCmd = this.getRunCommand(envPath);

    console.log(
      `[DockerOrchestrator] Executing: docker run -d --name ${this.config.containerName} ... (using --env-file for security)`,
    );
    execSync(dockerCmd, { stdio: "inherit" });

    // 6. Wait for healthy
    await this.waitForReady();

    return `http://localhost:${this.config.port}`;
  }

  /**
   * Generates the docker run command.
   * @internal
   */
  getRunCommand(envPath: string): string {
    const image = `ghcr.io/felddy/foundryvtt:${this.config.version}`;
    return [
      "docker run -d",
      `--name ${this.config.containerName}`,
      "--restart always",
      `-p ${this.config.port}:30000`,
      `--env-file "${path.resolve(envPath)}"`,
      `-v "${path.resolve(this.config.dataDir)}:/data"`,
      `-v "${path.resolve(this.config.cacheDir)}:/data/container_cache"`,
      image,
    ].join(" ");
  }

  /**
   * Stops and removes the container.
   */
  stopAndRemove() {
    console.log(`[DockerOrchestrator] Cleaning up container ${this.config.containerName}...`);
    try {
      execSync(`docker stop ${this.config.containerName}`, { stdio: "ignore" });
      execSync(`docker rm ${this.config.containerName}`, { stdio: "ignore" });
    } catch {}
  }

  /**
   * Copies a local path into the container.
   */
  copyToContainer(localPath: string, containerPath: string) {
    console.log(
      `[DockerOrchestrator] Copying ${localPath} to ${this.config.containerName}:${containerPath}`,
    );
    // Ensure destination directory exists via an ephemeral container or exec (if running)
    execSync(`docker exec ${this.config.containerName} mkdir -p ${path.dirname(containerPath)}`, {
      stdio: "inherit",
    });
    execSync(`docker cp ${localPath} ${this.config.containerName}:${containerPath}`, {
      stdio: "inherit",
    });
    // Fix permissions
    execSync(`docker exec ${this.config.containerName} chown -R 1000:1000 ${containerPath}`, {
      stdio: "inherit",
    });
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
}
