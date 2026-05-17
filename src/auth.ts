import { Page } from "@playwright/test";
import { disableTour, waitForReady, validateStack, shutdownWorldDirectly } from "./helpers.js";
import { getSetupAdapter } from "./setup/index.js";

/**
 * Navigates from within a world or the join screen back to the setup screen.
 * Implements RFC 0008 transition logic.
 */
export async function returnToSetup(
  page: Page,
  adminPassword?: string,
  _version?: string | number,
) {
  console.log("[returnToSetup] Returning to setup screen...");

  let maxAttempts = 3;
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
        await page.waitForLoadState("networkidle");
      }

      // Definitively check for setup application root
      const isSetup = await page.evaluate(
        () =>
          !!document.querySelector("foundry-app#setup") ||
          document.body.classList.contains("setup"),
      );
      if (isSetup) {
        console.log("[returnToSetup] Successfully reached Setup screen.");
        return;
      }
    }

    if (url.includes("/auth")) {
      console.log("[returnToSetup] On /auth screen. Logging in...");
      const pwInput = page.locator('input[name="adminPassword"]');
      if (await pwInput.isVisible()) {
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
        await page.waitForLoadState("networkidle");
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
        await page.waitForTimeout(5000); // Allow time for shutdown
      } else {
        // Standard return or direct navigation
        const returnBtn = page.locator(
          'button:has-text("Return to Setup"), button[name="shutdown"]',
        );
        if (await returnBtn.isVisible()) {
          await returnBtn.evaluate((el: Element) => (el as HTMLElement).click());
        } else {
          await page.goto("/setup").catch(() => null);
        }
      }
      await page.waitForLoadState("networkidle");
      continue;
    }

    if (url.includes("/game") || url.includes("/players")) {
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
      await page.waitForLoadState("networkidle");
      continue;
    }

    // Default: try direct jump
    console.log(`[returnToSetup] Navigating to /setup...`);
    await page.goto("/setup").catch(() => null);
    await page.waitForLoadState("networkidle");
  }
}

/**
 * Performs full end-to-end setup of a Foundry VTT instance.
 */
export async function foundrySetup(page: Page, config: any = {}) {
  const SYSTEM_LABELS: Record<string, string> = {
    dnd5e: "D&D 5th Edition",
    pf2e: "Pathfinder 2e",
    pf1: "Pathfinder 1st Edition",
    swade: "Savage Worlds Adventure Edition",
    worldbuilding: "Simple Worldbuilding",
    dungeonworld: "Dungeon World",
  };

  const {
    worldId,
    systemId = process.env.FOUNDRY_SYSTEM_ID || "dnd5e",
    systemManifest,
    moduleId,
    moduleManifest,
    adminPassword = process.env.FOUNDRY_ADMIN_PASSWORD || process.env.FOUNDRY_ADMIN_KEY,
    userName = "Gamemaster",
    password = "",
    createWorld = true,
    deleteIfExists = true,
    version = process.env.FOUNDRY_VERSION,
  } = config;

  const systemLabel = config.systemLabel || SYSTEM_LABELS[systemId] || systemId;

  console.log(`[foundrySetup] Starting setup for world: ${worldId} (System: ${systemId})`);

  let done = false;
  let maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts && !done; attempt++) {
    if (page.url() === "about:blank") await page.goto("/");
    await disableTour(page);
    await page.waitForLoadState("networkidle");

    const url = page.url();

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
        await page.waitForLoadState("networkidle");
      }
      continue;
    }

    // 3. Setup Screen
    if (url.endsWith("/setup") || url.includes("/setup#")) {
      console.log("[foundrySetup] On setup screen. Proceeding with configuration...");
      const adapter = await getSetupAdapter(page, version);

      // Aggressively clear Usage Data/Sharing dialogs (Shadow DOM included)
      await page.evaluate(() => {
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
      });

      // MANDATORY ORDER: Install system FIRST so Worlds tab is enabled in V14
      if (systemManifest) {
        await adapter.installSystemFromManifest(page, systemManifest);
      } else if (systemId) {
        await adapter.installSystem(page, systemId, systemLabel);
      }

      // 4. Module Installation
      if (moduleManifest) {
        await adapter.installModuleFromManifest(page, moduleManifest);
      } else if (moduleId) {
        const moduleIds = Array.isArray(moduleId) ? moduleId : [moduleId];
        await adapter.installModules(page, moduleIds);
      }

      // 5. World Management (NOW SAFE in V14 as system exists)
      if (deleteIfExists) await adapter.deleteWorldIfExists(page, worldId);

      if (createWorld) {
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
          await adapter.switchTab(page, "Worlds");
          const worldBox = page
            .locator(`[data-package-id="${worldId}"], [data-module-id="${worldId}"]`)
            .first();
          const launchBtn = worldBox
            .locator('[data-action="worldLaunch"], button:has-text("Launch")')
            .first();
          await launchBtn.evaluate((el: Element) => (el as HTMLElement).click());
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
    await page.locator('select[name="userid"]').selectOption({ label: userName });
    if (password) await page.locator('input[name="password"]').fill(password);
    await page
      .locator('button[name="join"]')
      .evaluate((el: Element) => (el as HTMLElement).click());
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
        if (!current[id]) {
          current[id] = true;
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

    await page.waitForLoadState("networkidle");
    await waitForReady(page);
  }
}

/**
 * Performs teardown of a Foundry VTT world.
 */
export async function foundryTeardown(page: Page, config: any) {
  const {
    worldId,
    adminPassword = process.env.FOUNDRY_ADMIN_PASSWORD || process.env.FOUNDRY_ADMIN_KEY,
    version = process.env.FOUNDRY_VERSION,
  } = config;
  console.log("[foundryTeardown] Starting teardown...");

  await returnToSetup(page, adminPassword, version).catch(() => null);
  await page.waitForLoadState("networkidle");

  const adapter = await getSetupAdapter(page, version);
  await disableTour(page);
  await adapter.deleteWorldIfExists(page, worldId);
  console.log("[foundryTeardown] Teardown complete.");
}

/**
 * Logs into a Foundry VTT world as a specific user.
 */
export async function loginAs(page: Page, userName: string, password?: string) {
  if (!page.url().includes("/join")) await page.goto("/join");
  await page.waitForLoadState("networkidle");
  await page.locator('select[name="userid"]').selectOption({ label: userName });
  if (password) await page.locator('input[name="password"]').fill(password);
  await page.locator('button[name="join"]').evaluate((el: Element) => (el as HTMLElement).click());
  await page.waitForURL(/\/game/, { timeout: 60000 });
  await waitForReady(page);
}
