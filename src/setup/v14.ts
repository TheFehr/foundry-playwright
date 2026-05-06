import { expect, Page, Locator } from "@playwright/test";
import { SetupAdapter } from "./base.js";
import { switchTab } from "../helpers.js";

/**
 * Setup adapter for Foundry VTT Version 14.
 */
export class V14SetupAdapter implements SetupAdapter {
  version = 14;

  async handleEULA(page: Page): Promise<void> {
    console.log("[V14SetupAdapter] Checking for Analytics/EULA...");
    
    // 0. Handle License Key Activation
    await this.handleLicenseActivation(page, process.env.FOUNDRY_LICENSE_KEY);

    // 1. Handle Analytics/Usage Data dialog FIRST as it often overlaps
    // We must be careful not to match the EULA itself here.
    const analyticsDialog = page.locator('dialog, foundry-app, .application').filter({ 
        hasText: /Usage Data|Sharing/i 
    }).filter({ 
        hasNot: page.locator('#license-title, h1:has-text("End User License Agreement")') 
    });
    if (await analyticsDialog.count() > 0 && await analyticsDialog.isVisible()) {
        console.log("[V14SetupAdapter] Analytics dialog detected. Declining...");
        const declineBtn = analyticsDialog.locator('button[data-action="no"], button:has-text("Decline")').first();
        if (await declineBtn.isVisible()) {
            await declineBtn.click({ force: true });
            await page.waitForTimeout(1000);
        }
    }

    // 2. Traditional EULA
    const eulaHeading = page.locator('#license-title');
    if (page.url().includes("/license") || await eulaHeading.count() > 0) {
        console.log("[V14SetupAdapter] EULA screen detected. Processing agreement...");
        
        // Ensure the footer is visible
        const acknowledgeHeading = page.getByRole('heading', { name: 'Acknowledge Agreement' });
        await acknowledgeHeading.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
            console.warn("[V14SetupAdapter] 'Acknowledge Agreement' heading not found, continuing anyway...");
        });

        // Ensure we are at the bottom
        await page.evaluate(() => {
          const eulaContainer = document.querySelector('.scrollable, .license-text, #eula-content, section.license, .window-content');
          if (eulaContainer) eulaContainer.scrollTop = eulaContainer.scrollHeight;
        });

        let checkbox = page.getByLabel('I agree to these terms').first();
        if (await checkbox.count() === 0) {
          console.log("[V14SetupAdapter] getByLabel failed, falling back to ID/Selector...");
          checkbox = page.locator('#eula-agree, input[type="checkbox"][name="agree"]').first();
        }

        if (await checkbox.count() > 0) {
          console.log("[V14SetupAdapter] EULA checkbox found.");
          if (!(await checkbox.isChecked())) {
            // Using force: true because the label might be overlaying the input
            await checkbox.click({ force: true });
            console.log("[V14SetupAdapter] EULA checkbox clicked.");
          }
          
          // Verify check state
          if (!(await checkbox.isChecked())) {
            console.warn("[V14SetupAdapter] Checkbox still not checked after click. Retrying with evaluate...");
            await checkbox.evaluate(el => (el as HTMLInputElement).checked = true);
            await checkbox.dispatchEvent('change');
          }
        } else {
          throw new Error("[V14SetupAdapter] EULA agreement checkbox NOT found. Cannot proceed with setup.");
        }

        let agreementBtn = page.getByRole('button', { name: 'Agree' }).first();
        if (await agreementBtn.count() === 0) {
           // Fallback for older V14 builds or different locales if needed, but primary is "Agree"
           agreementBtn = page.locator('button[data-action="agree"], button[type="submit"], button#sign').first();
        }

        if (await agreementBtn.count() > 0 && await agreementBtn.isVisible()) {
            console.log("[V14SetupAdapter] EULA agreement button found. Clicking...");
            
            // Try regular click first, then force, then evaluate
            await agreementBtn.click({ timeout: 5000 }).catch(() => agreementBtn.click({ force: true }));
            
            // Wait for navigation away from license
            try {
                await page.waitForURL((u) => !u.pathname.includes("/license"), { timeout: 20000 });
                console.log("[V14SetupAdapter] Successfully navigated away from EULA.");
            } catch (e) {
                console.warn("[V14SetupAdapter] Timeout waiting for EULA navigation. Retrying with evaluate click...");
                await agreementBtn.evaluate(el => (el as HTMLElement).click());
                await page.waitForURL((u) => !u.pathname.includes("/license"), { timeout: 10000 }).catch(() => {
                    throw new Error("[V14SetupAdapter] Failed to navigate away from EULA screen after clicking Agree.");
                });
            }
            await page.waitForLoadState("networkidle");
        } else {
            throw new Error("[V14SetupAdapter] EULA agreement button NOT found or NOT visible. Cannot proceed with setup.");
        }
    }
  }

  async handleLicenseActivation(page: Page, licenseKey?: string): Promise<void> {
    const licenseHeading = page.getByRole('heading', { name: 'License Key Activation' });
    if (await licenseHeading.count() > 0 && await licenseHeading.isVisible()) {
      console.log("[V14SetupAdapter] License Key Activation screen detected.");
      
      if (!licenseKey) {
        throw new Error("[V14SetupAdapter] Foundry VTT requires a license key but FOUNDRY_LICENSE_KEY is not set.");
      }

      console.log("[V14SetupAdapter] Entering license key...");
      const keyInput = page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX-XXXX-XXXX');
      await keyInput.fill(licenseKey);
      
      const submitBtn = page.getByRole('button', { name: 'Submit Key' });
      await submitBtn.click();
      
      await page.waitForLoadState("networkidle");
      console.log("[V14SetupAdapter] License key submitted.");
    }
  }

  async installSystem(page: Page, systemId: string, systemLabel: string): Promise<void> {
    console.log(`[V14SetupAdapter] Installing system: ${systemId}`);
    await switchTab(page, "Systems");
    
    const installBtn = page.locator('#setup-packages-systems button[data-action="installPackage"]');
    await expect(installBtn).toBeVisible({ timeout: 10000 });
    await installBtn.evaluate(el => (el as HTMLElement).click());
    
    console.log("[V14SetupAdapter] Waiting for installation dialog...");
    const installDialog = page.locator(".application, foundry-app, dialog").filter({ has: page.locator("#install-package-search-filter") }).last();
    await expect(installDialog).toBeVisible({ timeout: 20000 });

    const filterBox = installDialog.locator('#install-package-search-filter');
    await filterBox.fill(systemId);
    await page.keyboard.press('Enter');
    
    const packageRow = installDialog.locator(`[data-package-id="${systemId}"]`).first();
    await expect(packageRow).toBeVisible({ timeout: 30000 });

    const installButton = packageRow.locator('button[data-action="installPackage"], button:has-text("Installed")').first();
    await expect(installButton).toBeVisible({ timeout: 10000 });
    
    const isInstalled = await installButton.getAttribute("disabled") !== null || (await installButton.innerText()).includes("Installed");

    if (isInstalled) {
      console.log(`[V14SetupAdapter] System ${systemId} is already installed.`);
    } else {
      console.log(`[V14SetupAdapter] Clicking Install button for system: ${systemId}`);
      await installButton.evaluate(el => (el as HTMLElement).click());
      await this.waitForInstallation(page, installDialog, `[data-package-id="${systemId}"]`, "Systems");
    }

    const closeBtn = installDialog.locator('button[data-action="close"], .header-button.close');
    if (await closeBtn.isVisible()) {
        await closeBtn.click({ force: true });
    }
  }

  async installModules(page: Page, moduleIds: string[]): Promise<void> {
    console.log(`[V14SetupAdapter] Installing modules: ${moduleIds.join(", ")}`);
    await switchTab(page, "Modules");

    for (const modId of moduleIds) {
      const moduleBox = page.locator(`.package[data-package-id="${modId}"], [data-package-id="${modId}"]`).first();
      if (await moduleBox.count() === 0 || await moduleBox.isHidden()) {
        const installBtn = page.locator('#setup-packages-modules button[data-action="installPackage"]');
        await expect(installBtn).toBeVisible({ timeout: 10000 });
        await installBtn.evaluate(el => (el as HTMLElement).click());
        
        console.log(`[V14SetupAdapter] Waiting for installation dialog for ${modId}...`);
        const installDialog = page.locator(".application, foundry-app, dialog").filter({ has: page.locator("#install-package-search-filter") }).last();
        await expect(installDialog).toBeVisible({ timeout: 20000 });

        const filterBox = installDialog.locator('#install-package-search-filter');
        await filterBox.fill(modId);
        await page.keyboard.press('Enter');
        
        const packageRow = installDialog.locator(`[data-package-id="${modId}"]`).first();
        await expect(packageRow).toBeVisible({ timeout: 30000 });

        const installButton = packageRow.locator('button[data-action="installPackage"], button:has-text("Installed")').first();
        await expect(installButton).toBeVisible({ timeout: 10000 });

        const isInstalled = await installButton.getAttribute("disabled") !== null || (await installButton.innerText()).includes("Installed");

        if (isInstalled) {
          console.log(`[V14SetupAdapter] Module ${modId} is already installed.`);
        } else {
          console.log(`[V14SetupAdapter] Clicking Install button for module ${modId}...`);
          await installButton.evaluate(el => (el as HTMLElement).click());
          await this.waitForInstallation(page, installDialog, `[data-package-id="${modId}"]`, "Modules");
        }

        const closeBtn = installDialog.locator('button[data-action="close"], .header-button.close');
        if (await closeBtn.isVisible()) {
            await closeBtn.click({ force: true });
        }
      }
    }
  }

  async createWorld(page: Page, worldId: string, systemLabel: string, systemId: string): Promise<void> {
    console.log(`[V14SetupAdapter] Creating world: ${worldId}`);
    await switchTab(page, "Worlds");
    
    // Persistent click loop for V14 world creation
    let creationStarted = false;
    for (let i = 0; i < 5; i++) {
        if (page.url().includes("/create")) {
            creationStarted = true;
            break;
        }
        
        console.log(`[V14SetupAdapter] Attempting to open world creation form (Attempt ${i + 1})...`);
        const createBtn = page.locator('button[data-action="worldCreate"]').first();
        await expect(createBtn).toBeVisible({ timeout: 15000 });
        
        // Try standard click
        await createBtn.click({ force: true }).catch(() => null);
        await page.waitForTimeout(2000);
        
        if (page.url().includes("/create")) {
            creationStarted = true;
            break;
        }
        
        // Try evaluate click as fallback
        console.log("[V14SetupAdapter] Standard click failed to navigate, trying evaluate click...");
        await createBtn.evaluate(el => (el as HTMLElement).click()).catch(() => null);
        await page.waitForTimeout(2000);
    }

    if (!creationStarted && !page.url().includes("/create")) {
        throw new Error("[V14SetupAdapter] Failed to navigate to world creation screen after multiple attempts.");
    }
    
    console.log("[V14SetupAdapter] On world creation screen. Filling form...");
    await page.waitForLoadState("networkidle");

    // V14 world configuration form (left side)
    const configSection = page.locator('section[data-application-part="config"]');
    await configSection.locator('input[name="title"]').fill(worldId);
    
    const worldIdInput = configSection.locator('input[name="world-id"]');
    if (await worldIdInput.count() > 0) {
        await worldIdInput.fill(worldId);
    }

    // V14 System Selection Gallery (right side)
    console.log(`[V14SetupAdapter] Selecting system: ${systemId}`);
    const systemGallery = page.locator('section.systems[data-application-part="systems"]');
    await systemGallery.locator('input[type="search"]').fill(systemId);
    
    const systemItem = systemGallery.locator(`li.package.system[data-package-id="${systemId}"]`);
    await expect(systemItem).toBeVisible({ timeout: 10000 });
    await systemItem.click();
    
    // Submit Button is often at the top right in V14
    const submitBtn = page.locator('button[type="submit"].bright, button:has-text("Create World")').first();
    await submitBtn.evaluate(el => (el as HTMLElement).click());
    
    // V14 forwards to /players setup
    console.log("[V14SetupAdapter] Waiting for /players redirection...");
    await page.waitForURL(/\/players/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");
    
    const playersSubmitBtn = page.locator('button[type="submit"].bright, button:has-text("Save Configuration")').first();
    await playersSubmitBtn.evaluate(el => (el as HTMLElement).click());

    // Final redirection into the world
    console.log("[V14SetupAdapter] Waiting for world login...");
    await page.waitForURL((u) => !u.pathname.includes("/setup") && !u.pathname.includes("/players") && !u.pathname.includes("/create"), { timeout: 30000 });
    await page.waitForLoadState("networkidle");
  }

  async deleteWorldIfExists(page: Page, worldId: string): Promise<void> {
    console.log(`[V14SetupAdapter] Deleting world if exists: ${worldId}`);
    await switchTab(page, "Worlds");
    const worldBox = page.locator(`.package[data-package-id="${worldId}"]`).first();

    if ((await worldBox.count()) === 1 && await worldBox.isVisible()) {
      const stopButton = worldBox.locator('[data-action="worldStop"]');
      if (await stopButton.isVisible()) {
        await stopButton.click();
        // Wait for the world to stop (Launch button appears)
        await expect(worldBox.locator('[data-action="worldLaunch"]')).toBeVisible({ timeout: 10000 });
      }

      await worldBox.click({ button: "right" });
      const deleteOption = page.locator("li.context-item").filter({ hasText: /Delete World/i });
      await deleteOption.click();

      const dialog = page.locator("dialog, foundry-app, .application").filter({ has: page.locator("#delete-confirm") }).last();
      await expect(dialog).toBeVisible();

      const confirmCode = await dialog.locator(".reference").innerText();
      await dialog.locator("#delete-confirm").fill(confirmCode);
      await dialog.locator('button[data-action="yes"]').click();
      await expect(worldBox).toBeHidden({ timeout: 15000 });
    }
  }

  private async waitForInstallation(page: Page, dialog: any, verificationSelector: string, tabName: string): Promise<void> {
    const progressNotification = page.locator(".notification", { hasText: /Downloading|Installing/i });
    try {
      // Notification might appear very briefly or not at all if fast
      await progressNotification.waitFor({ state: "visible", timeout: 5000 });
      await progressNotification.waitFor({ state: "hidden", timeout: 300000 });
    } catch (e) {}

    const closeBtn = dialog.locator('button[data-action="close"], .header-button.close');
    if (await closeBtn.isVisible()) {
      await closeBtn.click({ force: true });
    }

    // Refresh and verify
    await switchTab(page, "Worlds");
    await switchTab(page, tabName); 
    await page.locator(verificationSelector).first().waitFor({ state: "visible", timeout: 30000 });
  }
}

