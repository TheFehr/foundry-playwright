# Technical Plan: Docker Test Orchestrator for Developers

## The "What"

A set of reusable utilities and a CLI built into `@thefehr/foundry-playwright` that allows developers to spin up version-specific FoundryVTT instances in Docker containers for their own local test runs and development.

## The "Why"

1. **Simplified Local Environments:** Developers don't need to manually install or manage multiple versions of FoundryVTT on their host machines.
2. **Version Parity:** Ensures that tests are run against the exact same environment used during library verification.
3. **Speed & Isolation:** Containers provide a clean state for every test run, avoiding "dirty" data issues in local worlds.

## The "How"

### 1. The `foundry-test` CLI

The library will include a CLI tool that developers can use in their `package.json` scripts:

```bash
# Example developer script
"test:e2e": "foundry-test --version 14.360 --playwright 'npx playwright test'"
```

**Responsibilities:**

- Read local `.env` for Foundry credentials.
- Orchestrate the `felddy/foundryvtt-docker` lifecycle.
- Inject the necessary environment variables (`FOUNDRY_URL`, etc.) into the subsequent Playwright command.

### 2. Programmatic Integration (Global Setup)

For more control, developers can use the orchestrator directly in their `playwright.config.ts`:

```typescript
import { DockerFoundryOrchestrator } from "@thefehr/foundry-playwright";

export default defineConfig({
  globalSetup: async () => {
    const orchestrator = new DockerFoundryOrchestrator({
      version: "14.360",
      adminKey: process.env.FOUNDRY_ADMIN_KEY,
      // ...
    });
    await orchestrator.start();
    return () => orchestrator.stop();
  },
  // ...
});
```

### 3. Feature Highlights

- **Persistent Volumes:** Support for mapping a local `data` directory so developers can work on worlds between test runs.
- **Port Mapping:** Flexible port management to avoid conflicts with other running services.
- **Custom Images:** Support for using private or custom Docker images if the developer has specific environment needs.
- **Pre-Boot Scripts:** Support for running setup scripts (data injection) immediately after the container is healthy but before tests start.

### 4. Developer Workflow

1. **Install:** `npm install @thefehr/foundry-playwright`.
2. **Config:** Add credentials to `.env`.
3. **Run:** Execute tests through the orchestrator.
4. **Benefit:** A perfectly clean, version-accurate Foundry instance every time.
