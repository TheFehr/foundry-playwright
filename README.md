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
- **System Adapters:** Pluggable logic for `dnd5e` and `pf2e`.

## Getting Started

### Installation

```bash
npm install --save-dev @thefehrs/foundry-playwright
```

### CLI Usage

The library provides a CLI to run tests with a Docker-orchestrated Foundry instance.

```bash
# Run tests against Foundry V14
npx foundry-playwright test --version 14.360.0 --docker --playwright "npx playwright test"
```

### Programmatic Setup

```typescript
import { test, foundrySetup } from "@thefehrs/foundry-playwright";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await foundrySetup(page, {
    worldId: "test-world",
    userName: "Gamemaster",
    adminPassword: "password",
    systemId: "dnd5e",
    moduleId: "my-module"
  });
  await page.close();
});
```
