# Multi-Version Support (V13 & V14)

## The Problem

FoundryVTT V13 and V14 have incompatible setup UIs, different DOM structures, and different backup/restore APIs. Every layer of the library needs to handle both.

## Version Detection

The library auto-detects the running version by probing the DOM once the page is loaded:

- **V14**: `window.foundry.applications.api.ApplicationV2` is defined, or a `<foundry-app>` custom element is present.
- **V13**: Neither marker is present; body classes indicate the classic setup screen.

You can bypass detection by setting `FOUNDRY_VERSION=13` or `FOUNDRY_VERSION=14` in your environment. This skips the DOM probe and is faster when you know the target version.

## The Adapter Pattern

### `SetupAdapter` (setup screen operations)

`getSetupAdapter(page, version?)` returns the correct implementation:

| Method                      | Purpose                                                   |
| :-------------------------- | :-------------------------------------------------------- |
| `handleEULA`                | Accepts the EULA modal                                    |
| `installSystem`             | Installs a game system from the package browser           |
| `installSystemFromManifest` | Installs a system from a direct manifest URL              |
| `installModules`            | Installs one or more modules                              |
| `createWorld`               | Creates a new world                                       |
| `launchWorld`               | Clicks the Launch button and waits for `/join` or `/game` |
| `deleteWorldIfExists`       | Deletes a world if it exists                              |
| `switchTab`                 | Navigates the setup screen tabs                           |

**V14-only backup methods:**

| Method               | Purpose                                                        |
| :------------------- | :------------------------------------------------------------- |
| `createWorldBackup`  | Takes a named backup of a world                                |
| `restoreWorldBackup` | Restores a world from a named backup (triggers server restart) |
| `listWorldBackups`   | Returns the list of backup labels for a world                  |
| `deleteWorldBackup`  | Deletes a named backup                                         |

### System & UI Adapters (in-game operations)

Two further adapter layers handle per-system and per-UI-module differences:

- **`SystemStateAdapter`** — Resolved via `FOUNDRY_SYSTEM_ID`. `DnD5eAdapter` and `PF2eAdapter` implement system-specific data shapes (HP structure, currency paths, test actor types, deprecation patterns).
- **`UIAdapter`** — Resolved via `FOUNDRY_UI_ADAPTER`. `DefaultUIAdapter`, `DnD5eUIAdapter`, and `Tidy5eUIAdapter` handle differences in actor sheet selectors and tab structures across sheet modules.

## `useBaseWorld` — V14 Backup Strategy

The signature difference in V14 is the native backup/restore API. `useBaseWorld` exploits this for fast, isolated test resets:

```
beforeAll
  └── foundrySetup (create world, activate modules)
  └── setupWorld callback (seed base state)
  └── createWorldBackup("fp-base-<worldId>")

beforeEach
  └── returnToSetup
  └── restoreWorldBackup  ← triggers server restart
  └── launchWorld
  └── loginAs (test page)

[each test runs against a clean, restored world]
```

Backup restore in V14 involves a full server restart. The adapter polls `/setup` until the server is reachable again before proceeding.

On V13, `useBaseWorld` falls back to a full `foundrySetup` per spec (delete → create → launch → activate modules). This is slower but correct.

## Environment Variables

| Variable                  | Effect                                                               |
| :------------------------ | :------------------------------------------------------------------- |
| `FOUNDRY_VERSION`         | Force `"13"` or `"14"` adapter; skips DOM detection                  |
| `FOUNDRY_SYSTEM_ID`       | Select `SystemStateAdapter` (default: `dnd5e`)                       |
| `FOUNDRY_UI_ADAPTER`      | Select `UIAdapter` (default: `default`)                              |
| `FOUNDRY_SYSTEM_MANIFEST` | Install system from this manifest URL instead of the package browser |
