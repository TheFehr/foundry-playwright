# @thefehrs/foundry-playwright

A robust, multi-version E2E testing library for FoundryVTT modules and systems, powered by Playwright.

## Status

This repository is currently in the **Extraction & Initialization** phase. Detailed documentation can be found in the `docs/` directory.

## Documentation

### Architecture & Design

- [Authentication & World Selection](docs/architecture/auth-and-world.md)
- [State Manipulation Fixtures](docs/architecture/state-manipulation.md)
- [Canvas Interaction Utilities](docs/architecture/canvas-interaction.md)
- [System Agnosticism & Configuration](docs/architecture/system-agnosticism.md)
- [Multi-Version Support (V13 & V14)](docs/architecture/multi-version-support.md)
- [Docker Test Orchestrator for Developers](docs/architecture/docker-orchestrator.md)

### Plans & RFCs

- [RFC 0001: Main Extraction Plan](docs/rfcs/0001-extraction-plan.md)
- [Extraction & Integration Strategy](docs/rfcs/extraction-strategy.md)
- [Continuous Verification & Release Tracking](docs/rfcs/continuous-verification.md)
- [Roadmap: Features & Helper Functions](docs/rfcs/roadmap-and-features.md)

## Core Features

- **Multi-Version Support:** Built-in adapters for FoundryVTT V13 and V14.
- **Docker Orchestration:** Automated setup and teardown of version-specific Foundry instances via CLI or programmatic orchestrator.
- **State Manipulation:** Fast, UI-less data injection via direct Foundry API and socket calls (`createActor`, `updateDocument`, `grantCurrency`).
- **UI Helpers:** Robust tab switching, aggressive tour suppression, and dialog automation.

## Getting Started

### Quick Start (Initialization)

The easiest way to get started is by using the CLI to bootstrap your project:

```bash
# Install the library
npm install --save-dev @thefehrs/foundry-playwright

# Initialize the test suite
npx foundry-playwright init
```

This will create a `playwright.config.ts`, an `e2e` directory with a sample test, and add a `test:e2e` script to your `package.json`.

### Writing Your First Test

Use the `useFoundry` helper to handle the complex authentication and world setup:

```typescript
import { test, expect, useFoundry } from "@thefehrs/foundry-playwright";

// Automatically boots Foundry and sets up the environment
useFoundry(test, {
  worldId: "test-world",
  systemId: "dnd5e",
  moduleId: "my-module-id",
});

test("Foundry is ready", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Foundry VTT/);
});
```

### Running Tests

```bash
# Run tests with a Docker-orchestrated Foundry instance
npm run test:e2e
```

For more detailed instructions, see the [Migration Guide](docs/getting-started/migration-guide.md).

## Core Features
