# @thefehr/foundry-playwright

A robust, multi-version E2E testing library for FoundryVTT modules and systems, powered by Playwright.

## Core Features

- **Multi-Version Support:** Built-in adapters for FoundryVTT V13 and V14 with automatic version detection.
- **Backup-Based World Reset:** `useBaseWorld` snapshots the world state before the first spec and restores it before each test — fast, isolated, no manual teardown (V14). Falls back to full recreate on V13.
- **Docker Orchestration:** Automated setup and teardown of version-specific Foundry instances via `DockerFoundryOrchestrator` or the `foundry-playwright test` CLI.
- **State Manipulation:** Fast, UI-less data injection via direct Foundry API and socket calls (`createDocument`, `createTestActor`, `grantCurrency`, `createUser`, `setRolePermission`, and more).
- **UI Helpers:** Tab switching, drop simulation, aggressive tour suppression, and dialog automation across V13 and V14 sheet layouts.
- **System Adapters:** First-class support for dnd5e and PF2e with pluggable `SystemStateAdapter` and `UIAdapter` interfaces.
- **Verified Versions Matrix:** A continuously updated `verified-versions.json` registry of confirmed-working (Foundry × system) combinations, maintained by a nightly release monitor.
- **Screen vs. Viewport:** `withScreenSize`/`setScreenSize` let `window.screen.width`/`height` (the physical display, used by some modules for mobile detection) diverge from `viewport` (`window.innerWidth`/`height`), which Playwright's `viewport` option alone can't do.

## Getting Started

```bash
npm install --save-dev @thefehr/foundry-playwright

npx foundry-playwright init
```

`init` scaffolds a `playwright.config.ts`, an `e2e/` directory with a sample test, and a `test:e2e` script in your `package.json`.

### Writing Tests

#### `useFoundry` — simple setup/teardown

Creates the world in `beforeAll`, tears it down in `afterAll`. Good for quick, stateless tests.

```typescript
import { test, expect, useFoundry } from "@thefehr/foundry-playwright";

useFoundry(test, {
  worldId: "test-world",
  systemId: "dnd5e",
  moduleId: "my-module-id",
});

test("actor can be created", async ({ foundry }) => {
  await foundry.state.createTestActor("Hero");
});
```

#### `useBaseWorld` — backup-based isolation (recommended for V14)

Takes a one-time snapshot after setup, then restores it before every spec. Each test starts from a clean slate without paying full setup cost.

```typescript
import { test, useBaseWorld, verifyResult } from "@thefehr/foundry-playwright";

useBaseWorld(test, {
  worldId: "my-test-world",
  systemId: "dnd5e",
  moduleId: "my-module-id",
  setupWorld: async ({ state }) => {
    await state.createTestActor("Base Actor");
  },
});

test("currency grant is logged", async ({ page, foundry }) => {
  await foundry.state.grantCurrency("Base Actor", 100, "gp");
  await verifyResult(page, "currency-update", (d) => d.amount === 100);
});
```

### Running Tests

```bash
# Against a running Foundry instance
npx playwright test

# With a Docker-managed Foundry instance
npm run verify:local -- --docker --version 14.360.0 --system dnd5e

# foundry-playwright test --docker auto-mounts e2e/<name>/module.json folders and a
# root module.json in the CWD. For a module that needs a build step first (e.g. a
# git-submodule checkout built into its own dist/), point at the built output directly:
npx foundry-playwright test --docker --module-dir ../my-module/dist
```

## Configuration

| Variable                                       | Purpose                                                              |
| :--------------------------------------------- | :------------------------------------------------------------------- |
| `FOUNDRY_URL`                                  | Base URL of the Foundry instance (default: `http://localhost:30000`) |
| `FOUNDRY_VERSION`                              | Force V13 or V14 adapter instead of auto-detecting                   |
| `FOUNDRY_SYSTEM_ID`                            | Active game system (default: `dnd5e`)                                |
| `FOUNDRY_UI_ADAPTER`                           | UI adapter: `default`, `dnd5e`, or `tidy5e`                          |
| `FOUNDRY_ADMIN_PASSWORD` / `FOUNDRY_ADMIN_KEY` | Admin password for setup operations                                  |
| `FOUNDRY_USERNAME` / `FOUNDRY_PASSWORD`        | Foundry account credentials for Docker image download                |

> `UIAdapter` (and `registerUIAdapter`) is scoped to actor-sheet-shaped UIs — an application selector plus tabs/collapsible sections. If the module under test has its own UI that isn't an actor sheet variant (a HUD, a control bar, a custom fullscreen layout), define plain selector constants in your own test suite instead of forcing that UI through the adapter interface.

## Documentation

- [Authentication & World Setup](docs/architecture/auth-and-world.md)
- [State Manipulation Fixtures](docs/architecture/state-manipulation.md)
- [Canvas Interaction](docs/architecture/canvas-interaction.md)
- [System Agnosticism & Adapters](docs/architecture/system-agnosticism.md)
- [Multi-Version Support](docs/architecture/multi-version-support.md)
- [Docker Orchestrator](docs/architecture/docker-orchestrator.md)
- [Getting Started / Migration Guide](docs/getting-started/migration-guide.md)
