import { Page } from "@playwright/test";
import {
  disableTour,
  waitForReady,
  validateStack,
  shutdownWorldDirectly,
  waitUntilWorldClosed,
  waitUntilLeftJoinScreen,
} from "./helpers.js";
import { getSetupAdapter } from "./setup/index.js";

/**
 * Navigates from within a world or the join screen back to the setup screen.
 * Implements RFC 0008 transition logic.
 */
export async function returnToSetup(page: Page, adminPassword?: string, _version?: string) {
  console.log("[returnToSetup] Returning to setup screen...");

  // Each real transition (about:blank -> /setup default jump -> /auth or
  // /join -> Setup) can legitimately cost more than one attempt on its own -
  // confirmed live, repeatedly: a shutdown/login submit that doesn't take
  // effect on the first try still lands on a fully successful Setup screen
  // one single attempt later, which 3 wasn't always enough budget for (every
  // one of those observed cases threw here despite Setup being reached
  // moments after the final attempt). Now that every wait in this loop is
  // bounded, a higher ceiling only costs a few more seconds in the rare
  // genuine-failure case, not a hang.
  let maxAttempts = 6;
  for (let i = 0; i < maxAttempts; i++) {
    const url = page.url();
    console.log(`[returnToSetup] Attempt ${i + 1}. Current URL: ${url}`);

    if (url.includes("/setup")) {
      // Check if we are actually on setup or just redirected to setup login
      const setupPwInput = page.locator('input[name="adminPassword"]');
      if (await setupPwInput.isVisible()) {
        console.log("[returnToSetup] Admin login required on /setup.");
        await setupPwInput.fill(adminPassword || process.env.FOUNDRY_ADMIN_PASSWORD || "password");
        await page
          .locator('button[type="submit"], button:has-text("Log In")')
          .first()
          .evaluate((el: Element) => (el as HTMLElement).click());
        await page
          .waitForURL((u) => u.pathname.includes("/setup"), { timeout: 10000 })
          .catch(() => null);
        // Best-effort settle only - the isSetup check right below is the real,
        // bounded gate, so this never needs to be able to hang on its own.
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
      }

      // Definitively check for setup application root - a bounded wait
      // rather than a single point-in-time check, since the URL can update
      // before the Setup app has actually rendered. Confirmed live (direct
      // DOM inspection): body.classList.contains("setup") is the real,
      // correct signal for this build - "foundry-app#setup" never matches
      // at all here, kept only as a harmless fallback for other versions.
      // 15s, not 5s: returning here from an active, just-launched game
      // session involves a full page reload (confirmed via the VM trace
      // that found this bug - many seconds of template recompilation
      // logged during exactly this transition), unlike the much faster
      // fresh-login path a 5s bound was tuned against.
      const isSetup = await page
        .waitForFunction(
          () =>
            !!document.querySelector("foundry-app#setup") ||
            document.body.classList.contains("setup"),
          { timeout: 15000 },
        )
        .then(() => true)
        .catch(() => false);
      if (isSetup) {
        console.log("[returnToSetup] Successfully reached Setup screen.");
        return;
      }
    }

    if (url.includes("/auth")) {
      console.log("[returnToSetup] On /auth screen. Checking for admin login...");
      const pwInput = page.locator('input[name="adminPassword"]');
      // A still-valid admin session can land here only to be auto-redirected
      // onward by Foundry's own client-side JS - that decision isn't instant.
      // Confirmed live: an immediate, unawaited isVisible() check can run
      // before that redirect fires, wrongly concluding "not logged in" and
      // bouncing to /setup just as /setup was about to bounce back here on
      // its own - burning attempts on a race instead of letting the page
      // settle. Give it a brief bounded window for either outcome first.
      const pwVisible = await pwInput
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!pwVisible) {
        const movedOnOwn = await page
          .waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        if (movedOnOwn) {
          console.log("[returnToSetup] /auth auto-redirected on its own.");
          continue;
        }
      }
      if (pwVisible) {
        await pwInput.fill(adminPassword || process.env.FOUNDRY_ADMIN_PASSWORD || "password");
        await page
          .locator('button[type="submit"], button:has-text("Log In")')
          .first()
          .evaluate((el: Element) => (el as HTMLElement).click());
        // Wait for setup root OR url change
        await Promise.race([
          page.waitForURL((u) => u.pathname.includes("/setup"), { timeout: 20000 }),
          page.waitForSelector("foundry-app#setup, body.setup", { timeout: 20000 }),
        ]).catch(() => null);
        // Best-effort settle - the race above is the real gate, and the next
        // loop iteration re-reads page.url() regardless, so this must not be
        // able to hang on its own.
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
      } else {
        console.log("[returnToSetup] On /auth but no admin login found. Navigating to /setup...");
        await page.goto("/setup").catch(() => null);
        // Confirmed live: this previously had no timeout at all and could hang
        // here indefinitely (e.g. if /setup keeps some background activity
        // alive), burning the whole retry loop on one single stuck wait
        // instead of letting the next iteration re-check page state.
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
      }
      continue;
    }

    if (url.includes("/join")) {
      console.log("[returnToSetup] On /join screen. Attempting Shutdown...");
      // Check for V14 admin-gated shutdown form
      const shutdownForm = page.locator("#join-game-setup");
      const shutdownInput = shutdownForm.locator('input[name="adminPassword"]');
      if (await shutdownInput.isVisible()) {
        console.log("[returnToSetup] V14 Shutdown form detected. Filling password...");
        await shutdownInput.fill(adminPassword || process.env.FOUNDRY_ADMIN_PASSWORD || "password");
        await shutdownForm
          .locator('button[type="submit"]')
          .first()
          .evaluate((el: Element) => (el as HTMLElement).click());
        await waitUntilLeftJoinScreen(page);
      } else {
        // Admin already authenticated — the form still renders a submit button labelled
        // "Return to Setup" (with an info message instead of the password input).
        // Also handles V13 "Return to Setup" / shutdown buttons.
        const returnBtn = page
          .locator(
            '#join-game-setup button[type="submit"], #join-game-setup button, ' +
              'button:has-text("Return to Setup"), button[name="shutdown"], button[data-action="shutdown"]',
          )
          .filter({ visible: true })
          .first();
        if (await returnBtn.isVisible()) {
          console.log("[returnToSetup] Return-to-setup button found. Clicking...");
          await returnBtn.evaluate((el: Element) => (el as HTMLElement).click());
          await waitUntilLeftJoinScreen(page);
        } else {
          await page.goto("/setup").catch(() => null);
        }
      }
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
      continue;
    }

    // V14 world creation lands at /players (player config screen) while the world is running.
    // Navigating to /setup from here auto-redirects to /game, so go via /join where the
    // V14 admin shutdown form is available.
    if (url.includes("/players")) {
      console.log("[returnToSetup] On /players screen. Navigating to /join for admin shutdown...");
      await page.goto("/join").catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
      continue;
    }

    if (url.includes("/game")) {
      console.log("[returnToSetup] Inside World. Attempting to logout/shutdown...");

      // Attempt direct API shutdown first (most robust)
      const directShutdownSuccess = await shutdownWorldDirectly(page);
      if (directShutdownSuccess) continue;

      // Fallback: simple evaluation or redirect
      await page
        .evaluate(() => {
          // @ts-ignore
          if (typeof game !== "undefined" && game.shutDown) game.shutDown();
          else window.location.href = "/setup";
        })
        .catch(() => null);
      await page.waitForTimeout(3000);
      // Waits for the URL to actually leave /game, not for the page to go
      // network-idle - a live Foundry session keeps a persistent WebSocket
      // connection with continuous traffic, so it may never satisfy "no
      // network activity for 500ms" even once this shutdown attempt has
      // genuinely succeeded. Confirmed live: this previously had no timeout
      // at all, so a race here could burn this entire beforeAll hook's
      // timeout on one single stuck wait instead of letting the outer
      // maxAttempts loop retry.
      await waitUntilWorldClosed(page);
      continue;
    }

    // Default: try direct jump
    console.log(`[returnToSetup] Navigating to /setup...`);
    await page.goto("/setup").catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  }

  // Exhausting every attempt without ever hitting the early `return` above
  // means Setup was never actually reached - throw rather than letting the
  // caller silently proceed as if it had. A caller then calling something
  // like switchTab(page, "Worlds") against whatever page we're actually
  // still on produces a confusing, unrelated-looking timeout instead of
  // this function's own clear, specific failure.
  throw new Error(
    `[returnToSetup] Failed to reach the Setup screen after ${maxAttempts} attempts (stuck at ${page.url()}).`,
  );
}

/**
 * Extracts the pinned system version from a manifest URL.
 * Handles dnd5e (`release-5.2.5`) and pf2e (`pf2e-8.0.3`) URL conventions.
 */
export function extractVersionFromManifest(manifestUrl: string): string | null {
  const m = /(?:release|pf2e)-(\d+(?:\.\d+)+)/.exec(manifestUrl);
  return m?.[1] ?? null;
}

/**
 * Reads the installed version of a game system from the Foundry setup screen.
 * Returns null if the system is not found or the version cannot be determined.
 * Must be called while the browser is on the setup screen.
 */
export async function getInstalledSystemVersion(
  page: Page,
  systemId: string,
): Promise<string | null> {
  return page.evaluate((sysId) => {
    const g = window.game as Game & {
      packages?: { systems?: { get?: (id: string) => { version?: string } | undefined } };
      data?: {
        systems?: Array<{ id: string; version?: string }>;
        packages?: { systems?: Array<{ id: string; version?: string }> };
      };
    };

    // V14: game.packages.systems (Collection)
    const sys14 = g.packages?.systems?.get?.(sysId);
    if (sys14?.version) return sys14.version;

    // V13: game.data.systems (array)
    const sysArr = g.data?.systems ?? g.data?.packages?.systems;
    if (Array.isArray(sysArr)) {
      const sys13 = sysArr.find((s) => s.id === sysId);
      if (sys13?.version) return sys13.version;
    }

    // DOM fallback: read version text from the package card on the setup screen.
    // V13 keeps all tab sections in the DOM simultaneously, so #setup-packages-systems
    // is always queryable. V14 may only render the active tab.
    const card = document.querySelector<HTMLElement>(
      `#setup-packages-systems [data-package-id="${sysId}"], ` +
        `[data-application-part="systems"] [data-package-id="${sysId}"], ` +
        `[data-package-id="${sysId}"]`,
    );
    if (!card) return null;

    const vEl = card.querySelector<HTMLElement>(".version, .tag.version, [data-version]");
    if (vEl?.textContent) {
      const text = vEl.textContent.trim().replace(/^[vV]ersion\s*/i, "");
      if (/^\d+\./.test(text)) return text;
    }

    for (const el of card.querySelectorAll<HTMLElement>("span, .tag")) {
      const text = (el.textContent ?? "").trim().replace(/^[vV]ersion\s*/i, "");
      if (/^\d+\.\d+/.test(text)) return text;
    }

    return null;
  }, systemId);
}

export const SYSTEM_LABELS: Record<string, string> = {
  dnd5e: "D&D 5th Edition",
  pf2e: "Pathfinder 2e",
  pf1: "Pathfinder 1st Edition",
  swade: "Savage Worlds Adventure Edition",
  worldbuilding: "Simple Worldbuilding",
  dungeonworld: "Dungeon World",
};

export interface FoundrySetupConfig {
  worldId?: string;
  systemId?: string;
  systemLabel?: string;
  systemManifest?: string;
  /**
   * Module ID(s) to ensure end up installed (via the package browser's
   * remote search, skipped if already present) and active. Independent of
   * how a module was actually installed - list an id here even if it was
   * installed via `moduleManifest` below, to have it activated.
   */
  moduleId?: string | string[];
  /**
   * Manifest URL(s) to install module(s) directly from, for modules not
   * available (or not desired) via the package browser's remote search.
   * Runs before `moduleId`'s installs. Only installs - list the module's
   * own id in `moduleId` too if it also needs to be activated.
   */
  moduleManifest?: string | string[];
  adminPassword?: string;
  userName?: string;
  password?: string;
  createWorld?: boolean;
  deleteIfExists?: boolean;
  version?: string;
  [key: string]: unknown;
}

/**
 * Performs full end-to-end setup of a Foundry VTT instance.
 */
export async function foundrySetup(page: Page, config: FoundrySetupConfig) {
  const {
    worldId,
    systemId = process.env.FOUNDRY_SYSTEM_ID || "dnd5e",
    systemManifest = process.env.FOUNDRY_SYSTEM_MANIFEST,
    moduleId,
    moduleManifest,
    adminPassword = (process.env.FOUNDRY_ADMIN_PASSWORD || process.env.FOUNDRY_ADMIN_KEY) as string,
    userName = "Gamemaster",
    password = "",
    createWorld = true,
    deleteIfExists = true,
    version = process.env.FOUNDRY_VERSION,
  } = config;

  const systemLabel = config.systemLabel || SYSTEM_LABELS[systemId] || systemId;

  if (!adminPassword) {
    throw new Error(
      "[foundrySetup] Admin password is required. Please provide 'adminPassword' in config or set FOUNDRY_ADMIN_PASSWORD/FOUNDRY_ADMIN_KEY environment variables.",
    );
  }

  console.log(`[foundrySetup] Starting setup for world: ${worldId} (System: ${systemId})`);

  let done = false;
  let maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts && !done; attempt++) {
    if (page.url() === "about:blank") await page.goto("/").catch(() => null);
    await disableTour(page);
    // Best-effort settle - the url/DOM checks below re-read live state
    // regardless, so this can never be allowed to hang on its own.
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);

    const url = page.url();

    // Handle chrome-error or other non-HTTP URLs — server is temporarily unavailable.
    if (!url.startsWith("http")) {
      console.log(
        `[foundrySetup] Attempt ${attempt}/${maxAttempts}: server not accessible (${url}), retrying in 10s...`,
      );
      await page.waitForTimeout(10000);
      await page.goto("/").catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
      continue;
    }

    // 0. World Lock check
    if (url.includes("/join") || url.includes("/game") || url.includes("/players")) {
      await returnToSetup(page, adminPassword, version);
      continue;
    }

    // 1. License Screen
    if (url.endsWith("/license") || url.includes("/license#")) {
      const adapter = await getSetupAdapter(page, version);
      await adapter.handleEULA(page);
      continue;
    }

    // 2. Admin Auth Screen
    if (
      url.endsWith("/auth") ||
      url.includes("/auth#") ||
      (url.includes("/setup") && (await page.locator('input[name="adminPassword"]').isVisible()))
    ) {
      console.log("[foundrySetup] Admin login required.");
      const pwInput = page.locator('input[name="adminPassword"]');
      if (await pwInput.isVisible()) {
        await pwInput.fill(adminPassword);
        await page
          .locator('button[type="submit"], button:has-text("Log In")')
          .first()
          .evaluate((el: Element) => (el as HTMLElement).click());
        await page
          .waitForURL((u) => u.pathname.includes("/setup"), { timeout: 15000 })
          .catch(() => null);
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
      }
      continue;
    }

    // 3. Setup Screen
    if (url.endsWith("/setup") || url.includes("/setup#")) {
      console.log("[foundrySetup] On setup screen. Proceeding with configuration...");
      const adapter = await getSetupAdapter(page, version);

      // Dismiss the "Allow Sharing Usage Data" analytics dialog. Waits briefly for it to
      // appear (it renders async), then clicks "No" to save the preference so it stays gone.
      const reDismissDialogs = async () => {
        const analyticsLocator = page
          .locator("dialog, .window-app, .application, foundry-app")
          .filter({ hasText: /usage data/i })
          .first();
        // Wait up to 2s for the dialog to appear (it's shown asynchronously after tab activation)
        await analyticsLocator.waitFor({ state: "visible", timeout: 2000 }).catch(() => null);
        if (await analyticsLocator.isVisible()) {
          const noBtn = analyticsLocator
            .locator(
              'button[data-action="no"], button[data-button="no"], button:has-text("No"), button:has-text("Decline")',
            )
            .filter({ visible: true })
            .first();
          if (await noBtn.isVisible()) {
            await noBtn.evaluate((el: Element) => (el as HTMLElement).click());
            await page.waitForTimeout(500);
          }
        }
        // Fallback DOM removal for any lingering elements
        await page
          .evaluate(() => {
            document.querySelectorAll("dialog, .application, foundry-app").forEach((d) => {
              const text = d.textContent?.toLowerCase() || "";
              if (
                (text.includes("usage data") || text.includes("sharing")) &&
                !text.includes("license")
              ) {
                if (d.tagName.toLowerCase() === "dialog") (d as HTMLDialogElement).close?.();
                d.remove();
              }
            });
          })
          .catch(() => null);
      };

      // Pre-dismiss any analytics dialog on setup screen entry (it appears async on first load)
      await reDismissDialogs();

      // MANDATORY ORDER: Install system FIRST so Worlds tab is enabled in V14
      if (systemManifest) {
        await adapter.installSystemFromManifest(page, systemManifest);
      } else if (systemId) {
        await adapter.installSystem(page, systemId, systemLabel);
      }

      // Verify the installed system version matches the pinned manifest before touching worlds.
      // Catches stale cached installations (e.g. "already installed" guard skipped the upgrade).
      if (systemManifest) {
        const expectedVersion = extractVersionFromManifest(systemManifest);
        if (expectedVersion) {
          const installedVersion = await getInstalledSystemVersion(page, systemId);
          console.log(
            `[foundrySetup] System version: ${systemId} installed=${installedVersion ?? "unknown"}, expected=${expectedVersion}`,
          );
          if (installedVersion !== null && installedVersion !== expectedVersion) {
            throw new Error(
              `[foundrySetup] System version mismatch for ${systemId}: ` +
                `expected v${expectedVersion} but found v${installedVersion} installed. ` +
                `A cached installation may be preventing the correct version from being used.`,
            );
          }
        }
      }

      // 4. Module Installation - manifest-based installs run first, then
      // registry-search installs. Not mutually exclusive: a module only
      // available via direct manifest URL (moduleManifest) and modules
      // available in the package browser (moduleId) can both be needed in
      // the same world - e.g. a consumer's own unlisted module plus a
      // published dependency like lib-wrapper. installModules' own
      // "already installed" check means listing the same id in both
      // (moduleManifest for install, moduleId for activation below) just
      // skips the redundant second install rather than erroring.
      if (moduleManifest) {
        const moduleManifests = Array.isArray(moduleManifest) ? moduleManifest : [moduleManifest];
        for (const manifestUrl of moduleManifests) {
          await adapter.installModuleFromManifest(page, manifestUrl);
        }
      }
      if (moduleId) {
        const moduleIds = Array.isArray(moduleId) ? moduleId : [moduleId];
        await adapter.installModules(page, moduleIds);
      }

      // 5. World Management (NOW SAFE in V14 as system exists)
      await reDismissDialogs();
      if (deleteIfExists && worldId) await adapter.deleteWorldIfExists(page, worldId);

      if (createWorld && worldId) {
        await reDismissDialogs();
        await adapter.createWorld(page, worldId, systemLabel, systemId);

        // Final redirection check
        if (
          page.url().includes("/game") ||
          page.url().includes("/join") ||
          page.url().includes("/players")
        ) {
          done = true;
        } else {
          console.log(`[foundrySetup] Manually launching world "${worldId}"...`);
          await reDismissDialogs();
          await adapter.launchWorld(page, worldId);
          done = true;
        }
      } else {
        done = true;
      }
    }
  }

  if (!done) throw new Error(`Failed to reach setup or game screen after ${maxAttempts} attempts.`);

  // 6. Final Join and Game Ready
  await page.waitForURL(
    (u) =>
      u.pathname.includes("/join") ||
      u.pathname.includes("/game") ||
      u.pathname.includes("/players"),
    { timeout: 60000 },
  );

  if (page.url().includes("/join")) {
    console.log(`[foundrySetup] On join screen. Logging in as "${userName}"...`);
    const adapter = await getSetupAdapter(page, version);
    await adapter.login(page, userName, password);
    await page.waitForURL(/\/game/, { timeout: 60000 });
  }

  console.log("[foundrySetup] Waiting for game to be ready...");
  await waitForReady(page);

  // RFC 0008: Validate the stack against the registry
  await validateStack(page, version).catch(() => null);

  // 7. Module Activation via Server-Side Settings (RFC 0008 strategy)
  if (moduleId) {
    const moduleIds = Array.isArray(moduleId) ? moduleId : [moduleId];
    console.log(`[foundrySetup] Activating modules via server settings: ${moduleIds.join(", ")}`);

    await page.evaluate(async (ids) => {
      // @ts-ignore
      const current = game.settings.get("core", "moduleConfiguration") || {};
      let changed = false;
      ids.forEach((id) => {
        if (!(current as Record<string, boolean>)[id]) {
          (current as Record<string, boolean>)[id] = true;
          changed = true;
        }
      });
      if (changed) {
        // @ts-ignore
        await game.settings.set("core", "moduleConfiguration", current);
        // @ts-ignore
        game.socket.emit("reload");
        window.location.reload();
      }
    }, moduleIds);

    // Not "await waitForURL" - a reload back into a live world re-establishes
    // the same persistent WebSocket traffic that makes plain networkidle
    // unreliable elsewhere in this file, so this must stay bounded. The
    // page.url() check right below re-reads live state regardless of whether
    // this settles cleanly.
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);

    // The reload can land on /players (a lighter, pre-join interstitial)
    // instead of /game if there was no established client session to resume
    // mid-reload. window.game.ready reads true there too, but none of the
    // just-activated modules' init hooks have actually run in that state.
    // Leave it the intended way (the in-app action, via the adapter) rather
    // than force-navigating past it - a plain page.goto("/join") here races
    // the interstitial's own in-flight redirect on some Foundry builds
    // (observed on 14.368).
    if (!page.url().includes("/game")) {
      console.log(
        `[foundrySetup] Reload after module activation landed on "${page.url()}", not /game — leaving the interstitial screen...`,
      );
      const adapter = await getSetupAdapter(page, version);
      await adapter.leavePlayersScreen(page);
      if (page.url().includes("/join")) {
        console.log(`[foundrySetup] On join screen. Logging in as "${userName}"...`);
        await adapter.login(page, userName, password);
        await page.waitForURL(/\/game/, { timeout: 60000 });
      }
    }

    await waitForReady(page);
  }
}

/**
 * Performs teardown of a Foundry VTT world.
 */
export async function foundryTeardown(page: Page, config: FoundrySetupConfig) {
  const {
    worldId,
    adminPassword = process.env.FOUNDRY_ADMIN_PASSWORD || process.env.FOUNDRY_ADMIN_KEY,
    version = process.env.FOUNDRY_VERSION,
  } = config;
  console.log("[foundryTeardown] Starting teardown...");

  await returnToSetup(page, adminPassword, version).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);

  const adapter = await getSetupAdapter(page, version);
  await disableTour(page);
  if (worldId) await adapter.deleteWorldIfExists(page, worldId);
  console.log("[foundryTeardown] Teardown complete.");
}

/**
 * Logs into a Foundry VTT world as a specific user.
 */
export async function loginAs(page: Page, userName: string, password?: string) {
  if (!page.url().includes("/join")) await page.goto("/join");
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  const adapter = await getSetupAdapter(page);
  await adapter.login(page, userName, password);
  await page.waitForURL(/\/game/, { timeout: 60000 });
  await waitForReady(page);
}
