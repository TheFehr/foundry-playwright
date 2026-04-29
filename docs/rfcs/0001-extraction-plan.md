# Plan: Extract FoundryVTT E2E Testing Library

## Goal
Extract the generic FoundryVTT E2E testing utilities, fixtures, and setup logic from `thefehrs-learning-manager` into a standalone, reusable NPM package. This will allow other FoundryVTT module developers to benefit from a robust Playwright-based testing foundation.

## Proposed Package: `@thefehrs/foundry-playwright`

### 1. Components to Extract & Expand

#### A. Authentication & World Selection (`src/auth.ts`)
- **Automated Login:** Parameterized login for GM or Player roles.
- **EULA Handling:** Logic to automatically detect and accept the Foundry EULA if it appears.
- **World Bootstrapping:** Utilities to navigate the setup screen, create/delete worlds, and boot directly into a specific test world.
- **Server Coordination:** Integration helpers to ensure the Playwright `webServer` is synchronized with Foundry's startup.

#### B. State Manipulation Fixtures (`src/state.ts`)
- **Direct Data Injection:** Playwright fixtures that use `page.evaluate` or `socket` calls to bypass the UI for setup.
- **Common Document Helpers:** 
    - `createTestActor(data)`: Fast actor creation.
    - `createTestItem(data)`: Fast item creation.
    - `grantCurrency(actorId, amount)`: (Configurable per system).
- **Hook Simulation:** Helpers to manually trigger Foundry hooks (like `dropActorSheetData`) with mock event data to test logic without brittle drag-and-drop UI interactions.

#### C. Canvas Interaction Utilities (`src/canvas.ts`)
- **Coordinate Mapping:** Functions to convert grid coordinates (X, Y) to viewport pixels.
- **Targeting Helpers:** Utilities to "click" on tokens, tiles, or specific grid intersections on the WebGL canvas.
- **Interaction Macros:** Standardized patterns for dragging tokens or measuring distances on the canvas via Playwright's `mouse` API.

#### D. Console & Error Monitoring (`src/fixtures.ts`)
- **Foundry Noise Filtering:** The base `test` extension that listens for `console` events, filters harmless Foundry noise, and fails on critical warnings (deprecations, null pointer errors, failed migrations).

#### E. System Agnosticism (`src/config.ts`)
- **Pluggable System Logic:** Ensure all helpers are system-neutral.
- **Configuration Schema:** Allow users to define system-specific paths (e.g., `system.currency.gp` vs `system.resources.coin`) so the library works across `dnd5e`, `pf2e`, and custom systems.

#### F. Teardown Logic (`src/teardown.ts`)
- **World Cleanup:** A configurable `foundryTeardown` function to delete the test world and restore the server to a clean state.

#### G. Multi-Version Support (`src/versioning.ts`)
- **Version Adapters:** Abstractions to handle UI and API differences between major Foundry versions (V13, V14).
- **Environment Configuration:** Support for `FOUNDRY_VERSION` environment variable.

#### H. Continuous Verification & Release Tracking
- **Release Monitor:** GitHub Action to detect new FoundryVTT releases.
- **Verification Registry:** `verified-versions.json` to track locally verified versions.

#### I. Docker Test Orchestrator
- **Reusable Runner:** A CLI and API for consumers to spin up FoundryVTT containers for their own local test runs.
- **Configuration Integration:** Easy integration with Playwright's `webServer` or as a global setup hook.

### 2. Extraction Strategy

1.  **Repository Setup:** Create a new repository with a TypeScript + Playwright environment.
2.  **Code Migration:** 
    - Move `helpers.ts` and `fixtures.ts` logic into the new package.
    - Refactor `global-setup.ts` into a parameterized `foundrySetup` function.
3.  **Abstractions:** Use a `FoundryConfig` object to handle module IDs, system-specific paths, and credentials.
4.  **Publishing:** Set up a CI pipeline to publish the package to NPM.

### 3. Integration into `thefehrs-learning-manager`

1.  **Dependency:** Add `@thefehrs/foundry-playwright` as a `devDependency`.
2.  **Refactor `e2e/fixtures.ts`:** Extend the library's base `test` fixture.
3.  **Refactor `e2e/global-setup.ts`:** Replace custom setup logic with `foundrySetup`.
4.  **Clean up `e2e/helpers.ts`:** Remove generic functions.

## Detailed Technical Plans
For in-depth explanations of the "what, why, and how" for each component, refer to the following documents:

- [Authentication & World Selection](../architecture/auth-and-world.md)
- [State Manipulation Fixtures](../architecture/state-manipulation.md)
- [Canvas Interaction Utilities](../architecture/canvas-interaction.md)
- [System Agnosticism & Configuration](../architecture/system-agnosticism.md)
- [Multi-Version Support (V13 & V14)](../architecture/multi-version-support.md)
- [Continuous Verification & Release Tracking](continuous-verification.md)
- [Docker Test Orchestrator for Developers](../architecture/docker-orchestrator.md)
- [Roadmap: Features & Helper Functions](roadmap-and-features.md)
- [Extraction & Integration Strategy](extraction-strategy.md)

## Benefits
- **Maintainability:** Standardized handling of Foundry's idiosyncrasies.
- **Speed:** Faster test execution by using state injection instead of UI clicks.
- **Reliability:** Robust canvas testing and error monitoring.
- **Community:** A shared foundation for all FoundryVTT module developers.
