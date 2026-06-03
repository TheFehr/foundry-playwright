import {
  Browser,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestInfo,
  TestType,
} from "@playwright/test";
import {
  FoundrySetupConfig,
  foundrySetup,
  foundryTeardown,
  loginAs,
  returnToSetup,
} from "./auth.js";
import { FoundryState } from "./state.js";
import { FoundryUI } from "./ui/index.js";
import { FoundryCanvas } from "./canvas.js";
import { getSetupAdapter } from "./setup/index.js";
import { FoundryPage } from "./types/index.js";
import { waitForReady } from "./helpers.js";

export interface SetupWorldHelpers {
  page: FoundryPage;
  state: FoundryState;
  ui: FoundryUI;
  canvas: FoundryCanvas;
}

export interface BaseWorldConfig extends FoundrySetupConfig {
  /**
   * Label for the base backup. Defaults to `fp-base-<worldId>`.
   * On V14 this backup is created once and restored before every spec.
   * On V13 this label is unused; the world is recreated from scratch each spec.
   */
  backupName?: string;

  /**
   * Callback that configures the world's initial state.
   * On V14 it runs once before the base backup is taken.
   * On V13 it runs before every spec (after the world is recreated).
   * Must be safe to call on a freshly created, empty world.
   */
  setupWorld?: (helpers: SetupWorldHelpers) => Promise<void>;

  /**
   * When true, a named backup is captured after each spec (V14 only).
   * Useful for post-mortem inspection on another Foundry instance.
   */
  captureAfterSpec?: boolean;

  /**
   * Override the snapshot name for captureAfterSpec.
   * Receives the test title; defaults to `<worldId>-<slugified-title>`.
   */
  captureNameFn?: (title: string) => string;

  /**
   * When true, the world is deleted in afterAll. Defaults to false — the
   * world (and its base backup) are left in place for reuse across runs.
   */
  deleteAfterAll?: boolean;
}

type UseFoundryTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

function resolveBackupName(config: BaseWorldConfig): string {
  return config.backupName ?? `fp-base-${config.worldId}`;
}

function buildHelpers(page: FoundryPage, config: BaseWorldConfig): SetupWorldHelpers {
  const systemId = config.systemId ?? process.env.FOUNDRY_SYSTEM_ID ?? "dnd5e";
  const uiAdapterId = process.env.FOUNDRY_UI_ADAPTER ?? "default";
  return {
    page,
    state: new FoundryState(page, systemId),
    ui: new FoundryUI(page, uiAdapterId),
    canvas: new FoundryCanvas(page),
  };
}

/**
 * One-time: creates the base world backup from the current world state.
 * Call this after `foundrySetup` and any initial world configuration.
 * Skips silently if a backup with the same name already exists.
 */
export async function createBaseWorldBackup(
  page: FoundryPage,
  config: BaseWorldConfig,
): Promise<void> {
  const { worldId, version, adminPassword } = config;
  if (!worldId) throw new Error("[createBaseWorldBackup] worldId is required.");

  const backupName = resolveBackupName(config);
  const adminPw =
    adminPassword ?? process.env.FOUNDRY_ADMIN_PASSWORD ?? process.env.FOUNDRY_ADMIN_KEY;

  await returnToSetup(page, adminPw, version);
  const adapter = await getSetupAdapter(page, version);
  const existing = await adapter.listWorldBackups(page, worldId);

  if (existing.includes(backupName)) {
    console.log(`[createBaseWorldBackup] Backup "${backupName}" already exists, skipping.`);
    return;
  }

  await adapter.createWorldBackup(page, worldId, backupName);
  console.log(`[createBaseWorldBackup] Backup "${backupName}" created.`);
}

/**
 * Restores the world to its base backup state and re-launches it.
 * The page will be on `/join` after this call; use `loginAs` to enter as a specific user.
 */
export async function restoreBaseWorld(page: FoundryPage, config: BaseWorldConfig): Promise<void> {
  const { worldId, version, adminPassword } = config;
  if (!worldId) throw new Error("[restoreBaseWorld] worldId is required.");

  const backupName = resolveBackupName(config);
  const adminPw =
    adminPassword ?? process.env.FOUNDRY_ADMIN_PASSWORD ?? process.env.FOUNDRY_ADMIN_KEY;

  await returnToSetup(page, adminPw, version);
  const adapter = await getSetupAdapter(page, version);
  await adapter.restoreWorldBackup(page, worldId, backupName);
  await adapter.launchWorld(page, worldId);
}

/**
 * Captures a named snapshot of the current world state (V14 only, no-op on V13).
 * Useful for post-mortem inspection: copy the backup to another Foundry instance.
 */
export async function captureWorldSnapshot(
  page: FoundryPage,
  config: BaseWorldConfig,
  snapshotName: string,
): Promise<void> {
  const { worldId, version, adminPassword } = config;
  if (!worldId) throw new Error("[captureWorldSnapshot] worldId is required.");

  const adminPw =
    adminPassword ?? process.env.FOUNDRY_ADMIN_PASSWORD ?? process.env.FOUNDRY_ADMIN_KEY;
  await returnToSetup(page, adminPw, version);
  const adapter = await getSetupAdapter(page, version);

  if (adapter.version < 14) {
    console.log("[captureWorldSnapshot] Skipping snapshot on V13.");
    return;
  }

  await adapter.createWorldBackup(page, worldId, snapshotName);
  console.log(`[captureWorldSnapshot] Snapshot "${snapshotName}" captured.`);
}

/**
 * Drop-in replacement for `useFoundry` that leverages Foundry's backup system.
 *
 * On **V14+**:
 *   - `beforeAll`: creates the world once, runs `setupWorld`, takes the base backup
 *     (skips creation if the backup already exists from a previous run).
 *   - `beforeEach`: restores the base backup and re-launches the world, then logs in.
 *   - `afterEach` (opt): captures a named snapshot when `captureAfterSpec` is true.
 *   - `afterAll` (opt): deletes the world when `deleteAfterAll` is true.
 *
 * On **V13**:
 *   - `beforeAll`: creates the world once and runs `setupWorld`.
 *   - `beforeEach`: tears down and re-creates the world, runs `setupWorld` again, then logs in.
 *   - `afterAll`: deletes the world.
 */
export function useBaseWorld(test: UseFoundryTest, config: BaseWorldConfig): void {
  const {
    worldId,
    version,
    adminPassword,
    userName = "Gamemaster",
    password = "",
    deleteAfterAll = false,
    captureAfterSpec = false,
  } = config;

  if (!worldId) throw new Error("[useBaseWorld] worldId is required.");

  const backupName = resolveBackupName(config);
  const adminPw = (adminPassword ??
    process.env.FOUNDRY_ADMIN_PASSWORD ??
    process.env.FOUNDRY_ADMIN_KEY) as string;

  // Detected once in beforeAll and referenced in subsequent hooks.
  let isV14 = false;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(600000);
    const page = (await browser.newPage()) as FoundryPage;
    try {
      const adapter = await getSetupAdapter(page, version);
      isV14 = adapter.version >= 14;

      if (isV14) {
        // Check if the base backup already exists so we can skip world re-creation on warm runs.
        // Retry the initial navigation in case the Docker container isn't fully ready yet.
        for (let i = 0; i < 10; i++) {
          try {
            await page.goto("/setup");
            await page.waitForLoadState("networkidle");
            if (page.url().startsWith("http")) break;
          } catch {
            console.log(
              `[useBaseWorld] Server not ready (attempt ${i + 1}/10), retrying in 10s...`,
            );
            await page.waitForTimeout(10000);
          }
        }
        const existingBackups = await adapter
          .listWorldBackups(page, worldId)
          .catch(() => [] as string[]);

        if (existingBackups.includes(backupName)) {
          console.log(
            `[useBaseWorld] Base backup "${backupName}" already exists, skipping world setup.`,
          );
          return;
        }

        // First run: create the world, configure it, then snapshot.
        await foundrySetup(page, { ...config, deleteIfExists: true });
        if (config.setupWorld) {
          await config.setupWorld(buildHelpers(page, config));
        }
        await returnToSetup(page, adminPw, version);
        await adapter.createWorldBackup(page, worldId, backupName);
      } else {
        // V13: create world once; setupWorld runs in beforeEach.
        await foundrySetup(page, config);
        if (config.setupWorld) {
          await config.setupWorld(buildHelpers(page, config));
        }
      }
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ browser, page }: { browser: Browser; page: FoundryPage }) => {
    test.setTimeout(600000);
    const tempPage = (await browser.newPage()) as FoundryPage;
    try {
      if (isV14) {
        await returnToSetup(tempPage, adminPw, version);
        const adapter = await getSetupAdapter(tempPage, version);
        await adapter.restoreWorldBackup(tempPage, worldId, backupName);
        await adapter.launchWorld(tempPage, worldId);
      } else {
        // V13: full teardown + recreate + setupWorld before each spec.
        await foundryTeardown(tempPage, config).catch(() => null);
        await foundrySetup(tempPage, config);
        if (config.setupWorld) {
          await config.setupWorld(buildHelpers(tempPage, config));
        }
        // Return to setup so the world is in a clean launched state for loginAs.
        // foundrySetup already ends at /game on the temp page, which is fine.
      }
    } finally {
      await tempPage.close();
    }

    // Log in with the test's own page.
    await loginAs(page, userName, password);
    await waitForReady(page);
  });

  if (captureAfterSpec) {
    test.afterEach(async ({ browser }: { browser: Browser }, testInfo: TestInfo) => {
      if (!isV14) return;
      const tempPage = (await browser.newPage()) as FoundryPage;
      try {
        const snapshotName = config.captureNameFn
          ? config.captureNameFn(testInfo.title)
          : `${worldId}-${testInfo.title.replace(/\s+/g, "-").toLowerCase().slice(0, 60)}`;
        await captureWorldSnapshot(tempPage, config, snapshotName);
      } finally {
        await tempPage.close();
      }
    });
  }

  test.afterAll(async ({ browser }: { browser: Browser }) => {
    if (!deleteAfterAll) return;
    const page = (await browser.newPage()) as FoundryPage;
    try {
      await foundryTeardown(page, config);
    } finally {
      await page.close();
    }
  });
}
