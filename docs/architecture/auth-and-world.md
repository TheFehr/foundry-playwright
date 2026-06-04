# Authentication & World Setup

## Overview

Every test needs Foundry to be running with a world loaded and a user logged in. The library exposes a layered set of helpers — from the low-level `returnToSetup` / `loginAs` functions up to the high-level `useFoundry` and `useBaseWorld` hooks — so you can pick the right abstraction for your test file.

## Core Functions

### `foundrySetup(page, config)`

The main orchestrator. From a fresh Docker container or a running Foundry instance it will:

1. Accept the EULA if shown.
2. Authenticate with the admin password.
3. Install the game system (skips if already installed).
4. Install any requested modules (skips if already installed).
5. Delete and recreate the test world if `deleteIfExists: true` (default).
6. Launch the world.
7. Log in as the configured user.
8. Activate the requested modules via world settings and reload.

```typescript
await foundrySetup(page, {
  worldId: "my-test-world",
  systemId: "dnd5e",
  moduleId: "my-module",
  adminPassword: process.env.FOUNDRY_ADMIN_KEY,
  userName: "Gamemaster",
});
```

**Key config options (`FoundrySetupConfig`):**

| Field            | Default                                        | Description                                                                |
| :--------------- | :--------------------------------------------- | :------------------------------------------------------------------------- |
| `worldId`        | —                                              | World directory / package ID                                               |
| `systemId`       | `FOUNDRY_SYSTEM_ID` or `dnd5e`                 | Game system ID                                                             |
| `systemManifest` | `FOUNDRY_SYSTEM_MANIFEST`                      | Install system from a specific manifest URL instead of the package browser |
| `moduleId`       | —                                              | Module ID or array of IDs to install and activate                          |
| `adminPassword`  | `FOUNDRY_ADMIN_PASSWORD` / `FOUNDRY_ADMIN_KEY` | Setup screen admin password                                                |
| `userName`       | `"Gamemaster"`                                 | User to log in as                                                          |
| `password`       | `""`                                           | User password                                                              |
| `deleteIfExists` | `true`                                         | Delete the world before creating it                                        |
| `createWorld`    | `true`                                         | Whether to create and launch a world at all                                |
| `version`        | `FOUNDRY_VERSION`                              | Hint to force V13 or V14 adapter                                           |

### `foundryTeardown(page, config)`

Navigates back to the setup screen and deletes the world. Used in `afterAll` hooks for full cleanup.

### `returnToSetup(page, adminPassword?)`

Navigates from wherever the page currently is (game world, `/join`, `/players`) back to the `/setup` screen. Handles the V14 admin-gated shutdown form. Used internally by most orchestration code.

### `loginAs(page, userName, password?)`

Selects a user on the `/join` screen and waits for the game to be ready. Does not handle world setup — the world must already be running.

## Test Hooks

### `useFoundry(test, config)`

The simplest integration: registers `beforeAll` and `afterAll` hooks on the Playwright `test` object.

- **`beforeAll`**: calls `foundrySetup` to create the world and log in.
- **`afterAll`**: calls `foundryTeardown` to delete the world.

```typescript
import { test, useFoundry } from "@thefehr/foundry-playwright";

useFoundry(test, {
  worldId: "my-world",
  systemId: "dnd5e",
  moduleId: "my-module",
});

test("something", async ({ page, foundry }) => { ... });
```

All tests in the file share a single world. State is not reset between tests.

### `useBaseWorld(test, config)`

A more powerful alternative that provides clean-slate isolation for each spec.

**On V14:**

- `beforeAll`: creates the world, runs the optional `setupWorld` callback, and takes a named backup (`fp-base-<worldId>` by default). Skips creation if the backup already exists from a previous run.
- `beforeEach`: restores the backup and re-launches the world, then logs in.
- `afterEach` (opt): captures a named snapshot when `captureAfterSpec: true`.
- `afterAll` (opt): deletes the world when `deleteAfterAll: true`.

**On V13** (no native backup API): `beforeEach` runs a full `foundrySetup` — deletes and recreates the world, re-installs nothing (system/modules already present), launches, logs in, and activates modules.

```typescript
import { test, useBaseWorld } from "@thefehr/foundry-playwright";

useBaseWorld(test, {
  worldId: "isolated-world",
  systemId: "dnd5e",
  moduleId: "my-module",
  setupWorld: async ({ state }) => {
    // Runs once before the base backup is taken (V14),
    // or before every spec (V13).
    await state.createTestActor("Base Actor");
  },
});

test("each test gets a clean world", async ({ foundry }) => { ... });
```

**Additional config fields for `useBaseWorld`:**

| Field              | Default             | Description                                                    |
| :----------------- | :------------------ | :------------------------------------------------------------- |
| `backupName`       | `fp-base-<worldId>` | Name of the base backup (V14)                                  |
| `setupWorld`       | —                   | Callback to configure the world before the snapshot            |
| `captureAfterSpec` | `false`             | Take a named backup after each spec for post-mortem inspection |
| `captureNameFn`    | —                   | Override the per-spec snapshot name                            |
| `deleteAfterAll`   | `false`             | Delete the world (and its backup) in `afterAll`                |
