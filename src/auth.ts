import { expect, Page } from "@playwright/test";
import { switchTab, disableTour } from "./helpers.js";
import { getSetupAdapter } from "./setup/index.js";

/**
 * Deletes a Foundry VTT world if it exists.
 * @param page The Playwright Page object.
 * @param worldId The ID of the world to delete.
 */
export async function deleteWorldIfExists(page: Page, worldId: string) {
  const adapter = await getSetupAdapter(page);
  await adapter.deleteWorldIfExists(page, worldId);
}

/**
 * Configuration for the foundrySetup function.
 */
export interface FoundrySetupConfig {
  /** The ID of the world to create or launch. */
  worldId: string;
  /** The admin password for the Foundry VTT instance. Defaults to process.env.FOUNDRY_ADMIN_PASSWORD. */
  adminPassword?: string;
  /** The username to log in as. */
  userName: string;
  /** The password for the user. */
  password?: string;
  /** The ID(s) of the module(s) to ensure is activated. */
  moduleId?: string | string[];
  /** The ID of the game system to use (e.g., "dnd5e"). Defaults to process.env.FOUNDRY_SYSTEM_ID. */
  systemId?: string;
  /** The label of the game system to use (e.g., "Dungeons & Dragons Fifth Edition"). */
  systemLabel?: string;
  /** Whether to delete the world if it already exists. Defaults to true. */
  deleteIfExists?: boolean;
}

/**
 * Performs the full Foundry VTT setup: login, world creation/launch, and module activation.
 * @param page The Playwright Page object.
 * @param config The setup configuration.
 */
export async function foundrySetup(page: Page, config: FoundrySetupConfig) {
  const {
    worldId,
    adminPassword = process.env.FOUNDRY_ADMIN_PASSWORD || process.env.FOUNDRY_ADMIN_KEY,
    userName,
    password,
    moduleId,
    systemId = process.env.FOUNDRY_SYSTEM_ID,
    systemLabel = "Dungeons & Dragons Fifth Edition",
    deleteIfExists = true,
  } = config;

  if (!systemId) {
    throw new Error("systemId is required. Provide it in config or via FOUNDRY_SYSTEM_ID environment variable.");
  }
  if (!adminPassword) {
    throw new Error("adminPassword is required. Provide it in config or via FOUNDRY_ADMIN_PASSWORD environment variable.");
  }

  console.log(`[foundrySetup] Starting setup for world: ${worldId}`);

  // 1. Navigate to root
  console.log("[foundrySetup] Navigating to root...");
  await disableTour(page);
  await page.goto("/");
  
  // 2. Linear State Machine to handle setup flow
  const maxAttempts = 20;
  let attempts = 0;
  let done = false;

  while (!done && attempts < maxAttempts) {
    attempts++;
    
    try {
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => null);
    } catch (e) {}
    
    await disableTour(page); 
    const url = page.url();
    console.log(`[foundrySetup] Attempt ${attempts}. Current URL: ${url}`);

    await page.waitForTimeout(1000); // Prevent tight loops

    const adapter = await getSetupAdapter(page);

    if (url.includes("/license")) {
      console.log("[foundrySetup] EULA detected.");
      await adapter.handleEULA(page);
    } else if (url.includes("/auth")) {
      console.log("[foundrySetup] Admin authentication required.");
      const pwInput = page.locator('input[name="adminPassword"]');
      if (await pwInput.isVisible()) {
        await pwInput.fill(adminPassword);
        const submitBtn = page.locator('button[name="submit"], button:has-text("Log In")').first();
        if (await submitBtn.isVisible()) {
          await submitBtn.click();
          await page.waitForLoadState("networkidle");
        }
      }
    } else if (url.includes("/join")) {
      console.log("[foundrySetup] Join screen detected. Returning to setup...");
      const returnBtn = page.locator('button:has-text("Return to Setup"), button[name="shutdown"]');
      if (await returnBtn.isVisible()) {
        const adminPwInput = page.locator('input[name="adminPassword"]');
        if (await adminPwInput.isVisible()) {
          await adminPwInput.fill(adminPassword);
        }
        
        await Promise.all([
            page.waitForURL((u) => u.pathname.includes("/setup") || u.pathname.includes("/auth"), { timeout: 10000 }).catch(() => null),
            returnBtn.evaluate(el => (el as HTMLElement).click())
        ]);
        await page.waitForLoadState("networkidle");
      } else {
        done = true; 
      }
    } else if (url.endsWith("/setup") || url.includes("/setup#")) {
      console.log("[foundrySetup] On setup screen. Proceeding with configuration...");
      
      // Handle Usage Data dialog (Standard V13 logic, also works in V14)
      await page.evaluate(() => {
        const dialog = Array.from(document.querySelectorAll('dialog, .dialog, .application, .window-app'))
          .find(d => (d.textContent?.includes('Usage Data') || d.textContent?.includes('Sharing')) && 
                     !d.textContent?.includes('End User License Agreement'));
        if (dialog) {
          const noBtn = Array.from(dialog.querySelectorAll('button'))
            .find(b => b.textContent?.match(/no|decline|don't/i) || (b as HTMLElement).dataset.action === "no");
          if (noBtn) (noBtn as HTMLElement).click();
        }
      });

      const setupPwInput = page.locator('input[name="adminPassword"]');
      if (await setupPwInput.isVisible()) {
        await setupPwInput.fill(adminPassword);
        await page.locator('button:has-text("Log In")').first().click();
        await page.waitForLoadState("networkidle");
      }

      // 3. System Installation
      await adapter.installSystem(page, systemId, systemLabel);

      // 4. Module Installation
      if (moduleId) {
        const moduleIds = Array.isArray(moduleId) ? moduleId : [moduleId];
        await adapter.installModules(page, moduleIds);
      }

      // 5. World Management
      if (deleteIfExists) {
        await adapter.deleteWorldIfExists(page, worldId);
      }

      await adapter.createWorld(page, worldId, systemLabel, systemId);

      // In V14, creating a world might automatically launch it or redirect to players setup
      if (page.url().includes("/game") || page.url().includes("/join") || page.url().includes("/players")) {
          console.log("[foundrySetup] World created and redirected away from setup screen.");
          done = true;
      } else {
          console.log(`[foundrySetup] Launching world "${worldId}"...`);
          await switchTab(page, "Worlds");
          const worldBox = page.locator(`[data-package-id="${worldId}"]`).first();
          await worldBox.hover();
          const launchBtn = worldBox.locator('[data-action="worldLaunch"]');
          await launchBtn.click();
          done = true;
      }
    } else if (url.includes("/game")) {
      console.log("[foundrySetup] Already on game screen.");
      done = true;
    }
  }

  if (!done) throw new Error(`Failed to reach setup or game screen after ${maxAttempts} attempts.`);

  // 5. Final Join and Game Ready
  await page.waitForURL((u) => u.pathname.includes("/join") || u.pathname.includes("/game"), { timeout: 60000 });

  if (page.url().includes("/join")) {
    console.log(`[foundrySetup] On join screen. Logging in as "${userName}"...`);
    await page.locator('select[name="userid"]').selectOption({ label: userName });
    if (password) {
      await page.locator('input[name="password"]').fill(password);
    }
    await page.locator('button[name="join"]').click();
    await page.waitForURL(/\/game/, { timeout: 60000 });
  }

  console.log("[foundrySetup] Waiting for game to be ready...");
  await expect(page).toHaveURL(/\/game/, { timeout: 60000 });
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60000 });
  await page.waitForFunction(() => typeof (window as any).game !== "undefined" && (window as any).game.ready, { timeout: 60000 });

  // 6. Module Activation
  if (moduleId) {
    const moduleIds = Array.isArray(moduleId) ? moduleId : [moduleId];
    let needsReload = false;

    for (const modId of moduleIds) {
      const isModuleActive = await page.evaluate((id) => !!(window as any).game.modules.get(id)?.active, modId);
      if (!isModuleActive) {
        if (!needsReload) {
          await page.getByRole("tab", { name: "Game Settings" }).click();
          await page.locator('[data-app="modules"]').click();
          needsReload = true;
        }

        console.log(`[foundrySetup] Activating module: ${modId}`);
        const moduleRow = page.locator(`li.package[data-module-id="${modId}"], .package[data-module-id="${modId}"]`);
        await moduleRow.locator('input[type="checkbox"]').click({ force: true });
        const depDialog = page.locator("dialog, foundry-app, .window-app").filter({ hasText: /Dependency|Resolution/i }).last();
        try {
          await depDialog.waitFor({ state: "visible", timeout: 2000 });
          await depDialog.locator("button").filter({ hasText: /Activate/i }).click();
        } catch (e) {}
      }
    }

    if (needsReload) {
      await page.locator('button:has-text("Save Module Settings")').first().click();
      const reloadDialog = page.locator("dialog, foundry-app, .window-app").filter({ hasText: /Reload/i }).last();
      await reloadDialog.locator("button").filter({ hasText: /Yes/i }).click();
      await page.waitForURL(/\/game/, { timeout: 30000 });
      await page.waitForFunction(() => typeof (window as any).game !== "undefined" && (window as any).game.ready, { timeout: 60000 });
    }
  }
  console.log("[foundrySetup] Setup complete.");
}

/**
 * Configuration for the foundryTeardown function.
 */
export interface FoundryTeardownConfig {
  /** The ID of the world to delete. */
  worldId: string;
  /** The admin password for the Foundry VTT instance. */
  adminPassword?: string;
}

/**
 * Performs the Foundry VTT teardown: deletes the test world.
 * @param page The Playwright Page object.
 * @param config The teardown configuration.
 */
export async function foundryTeardown(page: Page, config: FoundryTeardownConfig) {
  const { worldId, adminPassword } = config;
  let attempts = 0;
  const maxAttempts = 10;
  let done = false;

  console.log("[foundryTeardown] Starting teardown...");

  while (!done && attempts < maxAttempts) {
    attempts++;
    const url = page.url();
    console.log(`[foundryTeardown] Attempt ${attempts}. Current URL: ${url}`);

    if (url.includes("/setup") || url.includes("/auth")) {
        // Handle Login
        const pwInput = page.locator('input[name="adminPassword"]');
        if (await pwInput.isVisible() && adminPassword) {
            console.log("[foundryTeardown] Admin login required.");
            await pwInput.fill(adminPassword);
            await page.locator('button[name="submit"], button:has-text("Log In")').first().click();
            await page.waitForLoadState("networkidle");
            continue;
        }
        
        // Check if we are on full setup screen
        const worldsTab = page.locator('[data-tab="worlds"], #setup-menu').first();
        if (await worldsTab.isVisible()) {
            done = true;
            break;
        }
    }

    if (url.includes("/join") || url.includes("/game") || (!url.includes("/setup") && !url.includes("/auth"))) {
        console.log("[foundryTeardown] Not on setup screen. Attempting to return...");
        const returnBtn = page.locator('button:has-text("Return to Setup"), button[name="shutdown"]');
        if (await returnBtn.isVisible()) {
            const adminPwInput = page.locator('input[name="adminPassword"]');
            if (await adminPwInput.isVisible() && adminPassword) {
                await adminPwInput.fill(adminPassword);
            }
            await returnBtn.click();
            await page.waitForLoadState("networkidle");
        } else {
            console.log("[foundryTeardown] No return button. Navigating to /setup...");
            await page.goto("/setup").catch(() => null);
        }
    }

    await page.waitForTimeout(2000);
  }

  const adapter = await getSetupAdapter(page);
  console.log(`[foundryTeardown] Deleting world: ${worldId}`);
  await disableTour(page);
  await adapter.deleteWorldIfExists(page, worldId);
  console.log("[foundryTeardown] Teardown complete.");
}

/**
 * Logs into a Foundry VTT world as a specific user.
 * Assumes the world is already launched and the page is at the join screen.
 * @param page The Playwright Page object.
 * @param userName The username to log in as.
 * @param password The password for the user.
 */
export async function loginAs(page: Page, userName: string, password?: string) {
  console.log(`[loginAs] Logging in as "${userName}"...`);
  
  if (!page.url().includes("/join")) {
    await page.goto("/join");
  }

  await page.waitForLoadState("networkidle");
  await page.locator('select[name="userid"]').selectOption({ label: userName });
  
  if (password) {
    await page.locator('input[name="password"]').fill(password);
  }

  await page.locator('button[name="join"]').click();
  await page.waitForURL(/\/game/, { timeout: 60000 });

  console.log("[loginAs] Waiting for game to be ready...");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60000 });
  await page.waitForFunction(() => typeof (window as any).game !== "undefined" && (window as any).game.ready, { timeout: 60000 });
  console.log(`[loginAs] Logged in as "${userName}".`);
}
