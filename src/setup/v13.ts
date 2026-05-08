import { expect, Page } from "@playwright/test";
import { SetupAdapter, BaseGameAdapter } from "./base.js";
import {
  switchTab,
  openSystemInstallDialog,
  openModuleInstallDialog,
  installSystemFromManifest,
  installModuleFromManifest,
} from "../helpers.js";

/**
 * Setup adapter for Foundry VTT Version 13.
 */
export class V13SetupAdapter implements SetupAdapter {
  version = 13;

  async handleEULA(page: Page): Promise<void> {
    console.log("[V13SetupAdapter] Handling EULA...");

    // 0. Handle License Key Activation
    await this.handleLicenseActivation(page, process.env.FOUNDRY_LICENSE_KEY);

    await page.evaluate(() => {
      const eulaContainer = document.querySelector(".scrollable, .license-text, #eula-content");
      if (eulaContainer) eulaContainer.scrollTop = eulaContainer.scrollHeight;
    });

    const checkbox = page.locator('input[type="checkbox"], [name="agree"]').first();
    if ((await checkbox.count()) > 0) {
      if (!(await checkbox.isChecked())) {
        await checkbox.click({ force: true });
      }
    } else {
      throw new Error(
        "[V13SetupAdapter] EULA agreement checkbox NOT found. Cannot proceed with setup.",
      );
    }

    const eulaButton = page.locator("button").filter({ hasText: /agree|sign|accept/i });
    if ((await eulaButton.count()) > 0) {
      await eulaButton.first().evaluate((el) => (el as HTMLElement).click());

      try {
        await page.waitForURL((u) => !u.pathname.includes("/license"), { timeout: 20000 });
      } catch {
        throw new Error(
          "[V13SetupAdapter] Failed to navigate away from EULA screen after clicking Agree.",
        );
      }
    } else {
      throw new Error("[V13SetupAdapter] Stuck on /license but no agreement button found.");
    }
  }

  async handleLicenseActivation(page: Page, licenseKey?: string): Promise<void> {
    const licenseHeading = page.getByRole("heading", { name: "License Key Activation" });
    if ((await licenseHeading.count()) > 0 && (await licenseHeading.isVisible())) {
      console.log("[V13SetupAdapter] License Key Activation screen detected.");

      if (!licenseKey) {
        throw new Error(
          "[V13SetupAdapter] Foundry VTT requires a license key but FOUNDRY_LICENSE_KEY is not set.",
        );
      }

      console.log("[V13SetupAdapter] Entering license key...");
      const keyInput = page.getByPlaceholder("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX");
      await keyInput.fill(licenseKey);

      const submitBtn = page.getByRole("button", { name: "Submit Key" });
      await submitBtn.click();

      await page.waitForLoadState("networkidle");
      console.log("[V13SetupAdapter] License key submitted.");
    }
  }

  async installSystem(page: Page, systemId: string, _systemLabel: string): Promise<void> {
    console.log(`[V13SetupAdapter] Installing system: ${systemId}`);
    const installDialog = await openSystemInstallDialog(page);

    const filterBox = installDialog.getByRole("searchbox", { name: "Filter" });
    await filterBox.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type(systemId, { delay: 50 });
    await page.keyboard.press("Enter");

    await page.waitForTimeout(5000);

    const packageRow = installDialog.locator(`[data-package-id="${systemId}"]`).first();
    await expect(packageRow).toBeVisible({ timeout: 15000 });

    const installButton = packageRow
      .locator('button[data-action="installPackage"], button:has-text("Install")')
      .first();
    if ((await installButton.count()) > 0) {
      await installButton.evaluate((el) => (el as HTMLElement).click());
      await this.waitForInstallation(
        page,
        installDialog,
        `[data-package-id="${systemId}"]`,
        "Systems",
      );
    } else {
      throw new Error(`Failed to find Install button for system: ${systemId}`);
    }
  }

  async installModules(page: Page, moduleIds: string[]): Promise<void> {
    console.log(`[V13SetupAdapter] Installing modules: ${moduleIds.join(", ")}`);
    await switchTab(page, "Modules");

    for (const modId of moduleIds) {
      const moduleBox = page
        .locator(`[data-package-id="${modId}"], [data-module-id="${modId}"]`)
        .first();
      if ((await moduleBox.count()) === 0 || (await moduleBox.isHidden())) {
        const installDialog = await openModuleInstallDialog(page);

        const filterBox = installDialog.getByRole("searchbox", { name: "Filter" });
        await filterBox.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.keyboard.type(modId, { delay: 50 });
        await page.keyboard.press("Enter");

        await page.waitForTimeout(5000);

        const packageRow = installDialog.locator(`[data-package-id="${modId}"]`).first();
        await expect(packageRow).toBeVisible({ timeout: 15000 });

        const installButton = packageRow
          .locator('button[data-action="installPackage"], button:has-text("Install")')
          .first();
        if ((await installButton.count()) > 0) {
          await installButton.evaluate((el) => (el as HTMLElement).click());
          await this.waitForInstallation(
            page,
            installDialog,
            `[data-package-id="${modId}"]`,
            "Modules",
          );
        } else {
          throw new Error(`Failed to find Install button for module: ${modId}`);
        }
      }
    }
  }

  async installSystemFromManifest(page: Page, manifestUrl: string): Promise<void> {
    await installSystemFromManifest(page, manifestUrl);
  }

  async installModuleFromManifest(page: Page, manifestUrl: string): Promise<void> {
    await installModuleFromManifest(page, manifestUrl);
  }

  async createWorld(
    page: Page,
    worldId: string,
    systemLabel: string,
    _systemId: string,
  ): Promise<void> {
    console.log(`[V13SetupAdapter] Creating world: ${worldId}`);
    await switchTab(page, "Worlds");

    const createBtn = page
      .locator("button")
      .filter({ hasText: /Create World/i })
      .first();
    await createBtn.evaluate((el) => (el as HTMLElement).click());

    // Target the specific world-config form
    const createDialog = page
      .locator("form#world-config, dialog, .application")
      .filter({ hasText: /World|Create/i })
      .last();
    await expect(createDialog).toBeVisible({ timeout: 15000 });

    const titleInput = createDialog.locator(
      'input[name="title"], input[name*="title" i], input[placeholder*="Title" i]',
    );
    await titleInput.first().fill(worldId);

    const pathInput = createDialog.locator(
      'input[name="id"], input[name="name"], input[name*="path" i], input[placeholder*="Path" i]',
    );
    if (await pathInput.first().isVisible()) {
      await pathInput.first().fill(worldId);
    }

    const systemSelect = createDialog.locator(
      'select[name="system"], select[name*="system" i], select.system-select',
    );
    await systemSelect.first().selectOption({ label: systemLabel });

    const submitBtn = createDialog
      .locator('button[type="submit"], button')
      .filter({ hasText: /Create World|Create/i })
      .first();
    await submitBtn.evaluate((el) => (el as HTMLElement).click());

    // Wait for the specific form to be removed
    await expect(page.locator("form#world-config")).toBeHidden({ timeout: 20000 });
  }

  async deleteWorldIfExists(page: Page, worldId: string): Promise<void> {
    console.log(`[V13SetupAdapter] Deleting world if exists: ${worldId}`);
    await switchTab(page, "Worlds");
    const worldBox = page.locator(`[data-package-id="${worldId}"]`).first();

    if ((await worldBox.count()) === 1 && (await worldBox.isVisible())) {
      const stopButton = worldBox.locator('[data-action="worldStop"]');
      if ((await stopButton.count()) === 1 && (await stopButton.isVisible())) {
        await stopButton.click();
        await expect(worldBox.locator('[data-action="worldLaunch"]')).toBeVisible({
          timeout: 10000,
        });
      }

      await worldBox.dispatchEvent("contextmenu");
      const deleteOption = page.locator("li.context-item, .context-item").filter({
        hasText: /Delete World/i,
      });
      await deleteOption.click();

      const dialog = page
        .locator("dialog, .application, .window-app")
        .filter({ hasText: new RegExp(`Delete World: ${worldId}`, "i") })
        .last();
      await expect(dialog).toBeVisible();

      const confirmCode = await dialog.locator(".reference").innerText();
      await dialog.getByRole("textbox").fill(confirmCode);
      await dialog.getByRole("button", { name: "Yes" }).click();
      await expect(worldBox).toBeHidden({ timeout: 15000 });
    }
  }

  private async waitForInstallation(
    page: Page,
    dialog: any,
    verificationSelector: string,
    tabName: string,
  ): Promise<void> {
    await page.waitForTimeout(5000);
    const progressNotification = page.locator(".notification", {
      hasText: /Downloading|Installing/i,
    });
    try {
      await progressNotification.waitFor({ state: "visible", timeout: 15000 });
      await progressNotification.waitFor({ state: "hidden", timeout: 300000 });
    } catch {
      console.log("[V13SetupAdapter] Installation notification not seen or finished very quickly.");
    }

    const closeBtn = dialog.locator('button.header-button.control.close, [data-action="close"]');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }

    try {
      await page
        .locator(verificationSelector)
        .first()
        .waitFor({ state: "visible", timeout: 30000 });
    } catch {
      console.log("[V13SetupAdapter] Package not immediately visible. Refreshing tab...");
      await switchTab(page, "Worlds"); // Transition away and back
      await switchTab(page, tabName);
      await page
        .locator(verificationSelector)
        .first()
        .waitFor({ state: "visible", timeout: 30000 });
    }
  }
}

/**
 * Game adapter for Foundry VTT Version 13.
 */
export class V13GameAdapter extends BaseGameAdapter {
  version = 13;
}
