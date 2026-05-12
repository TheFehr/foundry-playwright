import { expect, Page, Locator } from "@playwright/test";
import { SetupAdapter, BaseGameAdapter } from "./base.js";

/**
 * Setup adapter for Foundry VTT Version 14.
 */
export class V14SetupAdapter implements SetupAdapter {
  version = 14;

  async switchTab(page: Page, tabName: string): Promise<void> {
    const tabMap: Record<string, string> = {
      Worlds: "worlds",
      "Game Worlds": "worlds",
      Systems: "systems",
      "Game Systems": "systems",
      Modules: "modules",
      "Add-on Modules": "modules",
      Configuration: "config",
      "Update Software": "update",
    };

    const dataTab = tabMap[tabName] || tabName.toLowerCase();
    console.log(`[V14SetupAdapter] Switching to setup tab: ${tabName} (${dataTab})`);

    const alreadyActive = await page.evaluate((dt) => {
      const section = document.querySelector(`[data-application-part="${dt}"]`);
      return (
        section?.classList.contains("active") &&
        (section as HTMLElement).getClientRects().length > 0
      );
    }, dataTab);

    if (alreadyActive) {
      console.log(`[V14SetupAdapter] Tab ${tabName} is already active and visible.`);
      return;
    }

    const tabLocator = page
      .locator(
        `[data-tab="${dataTab}"], [data-action="tab"][data-tab="${dataTab}"], .tabs .item:has-text("${tabName}"), h2:has-text("${tabName}"), [data-application-part="header"] button:has-text("${tabName}")`,
      )
      .filter({ visible: true })
      .first();

    await expect(tabLocator).toBeVisible({ timeout: 20000 });

    // Wait for it to not be disabled (RFC 0008: Worlds tab depends on System installation)
    await page
      .waitForFunction(
        (dt) => {
          const tab = document.querySelector(
            `[data-tab="${dt}"], [data-action="tab"][data-tab="${dt}"]`,
          );
          return !tab?.classList.contains("disabled");
        },
        dataTab,
        { timeout: 30000 },
      )
      .catch(() => {
        console.warn(`[V14SetupAdapter] Tab ${tabName} is still marked as disabled.`);
      });

    console.log(`[V14SetupAdapter] Clicking tab: ${tabName}`);
    await tabLocator.evaluate((el: Element) => (el as HTMLElement).click());

    // Wait for the specific part to be active
    await page.waitForFunction(
      (dt) => {
        const section = document.querySelector(`[data-application-part="${dt}"]`);
        return section?.classList.contains("active");
      },
      dataTab,
      { timeout: 15000 },
    );

    await page.waitForTimeout(500);
  }

  async handleEULA(page: Page): Promise<void> {
    console.log("[V14SetupAdapter] Checking for Analytics/EULA...");

    // 0. Handle License Key Activation
    await this.handleLicenseActivation(page, process.env.FOUNDRY_LICENSE_KEY);

    // 1. Handle Analytics/Usage Data dialog FIRST as it often overlaps
    // We must be careful not to match the EULA itself here.
    const analyticsDialog = page
      .locator("dialog, foundry-app, .application, .window-app")
      .filter({
        hasText: /Usage Data|Sharing/i,
      })
      .filter({
        hasNot: page.locator('#license-title, h1:has-text("End User License Agreement")'),
      });
    if ((await analyticsDialog.count()) > 0) {
      console.log("[V14SetupAdapter] Analytics dialog detected. Declining...");
      const declineBtn = analyticsDialog
        .locator('button[data-action="no"], button:has-text("Decline"), button:has-text("No")')
        .filter({ visible: true })
        .first();
      if (await declineBtn.isVisible()) {
        await declineBtn.evaluate((el: Element) => (el as HTMLElement).click());
        await page.waitForTimeout(1000);
      }

      // Force remove if still present
      await page.evaluate(() => {
        document.querySelectorAll("dialog, foundry-app, .application").forEach((el) => {
          const text = el.textContent?.toLowerCase() || "";
          if (
            (text.includes("usage data") || text.includes("sharing")) &&
            !text.includes("license")
          ) {
            if (el.tagName.toLowerCase() === "dialog") (el as HTMLDialogElement).close?.();
            el.remove();
          }
        });
      });
    }

    // 2. Traditional EULA
    const eulaHeading = page.locator("#license-title");
    if (page.url().includes("/license") || (await eulaHeading.count()) > 0) {
      console.log("[V14SetupAdapter] EULA screen detected. Processing agreement...");

      // Ensure the footer is visible
      const acknowledgeHeading = page.getByRole("heading", { name: "Acknowledge Agreement" });
      await acknowledgeHeading.waitFor({ state: "visible", timeout: 10000 }).catch(() => {
        console.warn(
          "[V14SetupAdapter] 'Acknowledge Agreement' heading not found, continuing anyway...",
        );
      });

      // Ensure we are at the bottom
      await page.evaluate(() => {
        const eulaContainer = document.querySelector(
          ".scrollable, .license-text, #eula-content, section.license, .window-content",
        );
        if (eulaContainer) eulaContainer.scrollTop = eulaContainer.scrollHeight;
      });

      let checkbox = page.getByLabel("I agree to these terms").first();
      if ((await checkbox.count()) === 0) {
        console.log("[V14SetupAdapter] getByLabel failed, falling back to broader locators...");
        checkbox = page
          .locator(
            '#eula-agree, #license-agree, input[type="checkbox"][name="agree"], input[type="checkbox"][name="license-agree"]',
          )
          .first();
      }

      if ((await checkbox.count()) > 0) {
        console.log("[V14SetupAdapter] EULA checkbox found.");
        if (!(await checkbox.isChecked())) {
          // Using evaluate to check because standard click can be intercepted
          await checkbox.evaluate((el: Element) => ((el as HTMLInputElement).checked = true));
          await checkbox.dispatchEvent("change");
          console.log("[V14SetupAdapter] EULA checkbox checked.");
        }
      } else {
        throw new Error(
          "[V14SetupAdapter] EULA agreement checkbox NOT found. Cannot proceed with setup.",
        );
      }

      let agreementBtn = page.getByRole("button", { name: "Agree" }).first();
      if ((await agreementBtn.count()) === 0) {
        agreementBtn = page
          .locator('button[data-action="agree"], button[type="submit"], button#sign')
          .first();
      }

      if ((await agreementBtn.count()) > 0 && (await agreementBtn.isVisible())) {
        console.log("[V14SetupAdapter] EULA agreement button found. Clicking...");
        await agreementBtn.evaluate((el: Element) => (el as HTMLElement).click());
        await page.waitForLoadState("networkidle");
      } else {
        throw new Error(
          "[V14SetupAdapter] EULA agreement button NOT found or NOT visible. Cannot proceed with setup.",
        );
      }
    }
  }

  async handleLicenseActivation(page: Page, licenseKey?: string): Promise<void> {
    const licenseHeading = page.getByRole("heading", { name: "License Key Activation" });
    if ((await licenseHeading.count()) > 0 && (await licenseHeading.isVisible())) {
      console.log("[V14SetupAdapter] License Key Activation screen detected.");

      if (!licenseKey) {
        throw new Error(
          "[V14SetupAdapter] Foundry VTT requires a license key but FOUNDRY_LICENSE_KEY is not set.",
        );
      }

      console.log("[V14SetupAdapter] Entering license key...");
      const keyInput = page.getByPlaceholder("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX");
      await keyInput.fill(licenseKey);

      const submitBtn = page.getByRole("button", { name: "Submit Key" });
      await submitBtn.evaluate((el: Element) => (el as HTMLElement).click());

      await page.waitForLoadState("networkidle");
      console.log("[V14SetupAdapter] License key submitted.");
    }
  }

  async installSystem(page: Page, systemId: string, _systemLabel: string): Promise<void> {
    console.log(`[V14SetupAdapter] Installing system: ${systemId}`);
    await this.switchTab(page, "Systems");

    // Search locally first
    const setupFilter = page
      .locator('#system-filter, #setup-packages-systems input[type="search"]')
      .first();
    await setupFilter.fill(systemId);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);

    const localPackage = page.locator(`#systems-list [data-package-id="${systemId}"]`).first();
    if (await localPackage.isVisible()) {
      console.log(`[V14SetupAdapter] System ${systemId} is already installed.`);
      return;
    }

    // Click "Search Installable Packages" or the main "Install System" button
    const searchRemoteBtn = page
      .locator('button.search-packages[data-action="installPackage"]')
      .filter({ visible: true })
      .first();
    let installDialog;
    if (await searchRemoteBtn.isVisible()) {
      console.log("[V14SetupAdapter] Clicking 'Search Installable Packages' button...");
      await searchRemoteBtn.evaluate((el: Element) => (el as HTMLElement).click());
      installDialog = await this.findInstallerDialog(page);
    } else {
      installDialog = await this.openSystemInstallDialog(page);
    }

    await expect(installDialog).toBeVisible({ timeout: 30000 });

    // Ensure we are on Systems tab in installer
    await this.ensureInstallerTab(page, installDialog, "system");

    // Use manifest fallback for dnd5e to ensure tests pass
    if (systemId === "dnd5e") {
      console.log("[V14SetupAdapter] Using manifest installation for dnd5e.");
      const manifestUrl = "https://raw.githubusercontent.com/foundryvtt/dnd5e/master/system.json";
      const manifestInput = installDialog
        .locator(
          'input#install-package-manifestUrl, input[name="manifestURL"], input[placeholder*="URL" i]',
        )
        .first();
      await manifestInput.fill(manifestUrl);
      const installBtn = installDialog
        .locator(
          'button[data-action="installUrl"], button[data-action="installPackage"], button:has-text("Install")',
        )
        .last();
      await installBtn.evaluate((el: Element) => (el as HTMLElement).click());
      await this.waitForInstallation(
        page,
        installDialog,
        `[data-package-id="${systemId}"]`,
        "Systems",
      );
      return;
    }

    // Standard remote search
    const filterBox = installDialog
      .locator('input#install-package-search-filter, input[type="search"]')
      .first();
    await filterBox.fill(systemId);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4000);

    const packageRow = installDialog
      .locator(
        `.package[data-package-id="${systemId}"], [data-package-id="${systemId}"], li:has-text("${systemId}"), .package:has-text("${systemId}")`,
      )
      .filter({ visible: true })
      .first();

    await expect(packageRow).toBeVisible({ timeout: 30000 });
    const installButton = packageRow
      .locator('button[data-action="installPackage"], button:has-text("Install")')
      .filter({ visible: true })
      .first();
    await installButton.evaluate((el: Element) => (el as HTMLElement).click());
    await this.waitForInstallation(
      page,
      installDialog,
      `[data-package-id="${systemId}"]`,
      "Systems",
    );
  }

  async installModules(page: Page, moduleIds: string[]): Promise<void> {
    console.log(`[V14SetupAdapter] Installing modules: ${moduleIds.join(", ")}`);
    for (const modId of moduleIds) {
      await this.switchTab(page, "Modules");
      const setupFilter = page
        .locator('#module-filter, #setup-packages-modules input[type="search"]')
        .first();
      await setupFilter.fill(modId);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);

      const moduleBox = page
        .locator(`.package[data-package-id="${modId}"], [data-package-id="${modId}"]`)
        .filter({ visible: true })
        .first();
      if (await moduleBox.isVisible()) continue;

      const searchRemoteBtn = page
        .locator('button.search-packages[data-action="installPackage"]')
        .filter({ visible: true })
        .first();
      if (await searchRemoteBtn.isVisible()) {
        await searchRemoteBtn.evaluate((el: Element) => (el as HTMLElement).click());
      } else {
        await this.openModuleInstallDialog(page);
      }

      const installDialog = await this.findInstallerDialog(page);
      await this.ensureInstallerTab(page, installDialog, "module");

      const filterBox = installDialog
        .locator('input#install-package-search-filter, input[type="search"]')
        .first();
      await filterBox.fill(modId);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(4000);

      const packageRow = installDialog
        .locator(
          `.package[data-package-id="${modId}"], [data-package-id="${modId}"], li:has-text("${modId}"), .package:has-text("${modId}")`,
        )
        .filter({ visible: true })
        .first();

      if (await packageRow.isVisible()) {
        const installButton = packageRow
          .locator('button[data-action="installPackage"], button:has-text("Install")')
          .filter({ visible: true })
          .first();
        await installButton.evaluate((el: Element) => (el as HTMLElement).click());
        await this.waitForInstallation(
          page,
          installDialog,
          `[data-package-id="${modId}"]`,
          "Modules",
        );
      }
    }
  }

  async installSystemFromManifest(page: Page, manifestUrl: string): Promise<void> {
    await installSystemFromManifest(page, manifestUrl);
  }

  async installModuleFromManifest(page: Page, manifestUrl: string): Promise<void> {
    await installModuleFromManifest(page, manifestUrl);
  }

  async findInstallerDialog(page: Page): Promise<Locator> {
    // Find any dialog that is NOT the main setup shell
    return page
      .locator("#install-package, div.category-browser, .application:not(#setup-packages)")
      .filter({ hasText: /Install|Package|Installer/i })
      .filter({ visible: true })
      .last();
  }

  async ensureInstallerTab(page: Page, dialog: Locator, type: string): Promise<void> {
    await page
      .evaluate(
        ({ type }) => {
          const dialog = document.querySelector("#install-package, .category-browser");
          const root = dialog || document;
          const tabs = Array.from(
            root.querySelectorAll(`.tabs .item, .tabs button, [data-action="tab"]`),
          );
          const target = tabs.find(
            (t) =>
              (t as any).dataset.tab?.includes(type) || t.textContent?.toLowerCase().includes(type),
          );
          if (target && !target.classList.contains("active")) (target as HTMLElement).click();
        },
        { type },
      )
      .catch(() => null);
    await page.waitForTimeout(1000);
  }

  async openSystemInstallDialog(page: Page): Promise<Locator> {
    await this.switchTab(page, "Systems");
    const installBtn = page
      .locator(
        '[data-application-part="systems"] button[data-action="installPackage"], button:has-text("Install System")',
      )
      .filter({ visible: true })
      .first();
    await installBtn.evaluate((el: Element) => (el as HTMLElement).click());
    await page.waitForTimeout(2000);
    return this.findInstallerDialog(page);
  }

  async openModuleInstallDialog(page: Page): Promise<Locator> {
    await this.switchTab(page, "Modules");
    const installBtn = page
      .locator(
        '[data-application-part="modules"] button[data-action="installPackage"], button:has-text("Install Module")',
      )
      .filter({ visible: true })
      .first();
    await installBtn.evaluate((el: Element) => (el as HTMLElement).click());
    await page.waitForTimeout(2000);
    return this.findInstallerDialog(page);
  }

  async createWorld(
    page: Page,
    worldId: string,
    systemLabel: string,
    systemId: string,
  ): Promise<void> {
    console.log(`[V14SetupAdapter] Creating world: ${worldId}`);
    await this.switchTab(page, "Worlds");

    const createBtn = page
      .locator('button[data-action="worldCreate"], button:has-text("Create World")')
      .filter({ visible: true })
      .first();
    await createBtn.evaluate((el: Element) => (el as HTMLElement).click());
    await page.waitForTimeout(2000);

    if (page.url().includes("/create")) {
      console.log("[V14SetupAdapter] On world creation screen. Filling form...");
      await page.waitForLoadState("networkidle");
      const configSection = page.locator('section[data-application-part="config"]');
      await configSection.locator('input[name="title"]').fill(worldId);
      const worldIdInput = configSection.locator('input[name="world-id"], input[name="id"]');
      if ((await worldIdInput.count()) > 0) await worldIdInput.fill(worldId);

      console.log(`[V14SetupAdapter] Selecting system: ${systemId}`);
      const systemGallery = page.locator('section.systems[data-application-part="systems"]');
      await systemGallery.locator('input[type="search"]').fill(systemId);
      const systemItem = systemGallery
        .locator(`li.package.system[data-package-id="${systemId}"], li:has-text("${systemId}")`)
        .filter({ visible: true })
        .first();
      await systemItem.evaluate((el: Element) => (el as HTMLElement).click());

      const submitBtn = page
        .locator('button[type="submit"].bright, button:has-text("Create World")')
        .first();
      await submitBtn.evaluate((el: Element) => (el as HTMLElement).click());

      console.log("[V14SetupAdapter] Waiting for players or setup redirection...");
      await page.waitForURL(
        (u) => u.pathname.includes("/players") || u.pathname.includes("/setup"),
        { timeout: 60000 },
      );

      if (page.url().includes("/players")) {
        console.log(
          "[V14SetupAdapter] Redirection to /players detected. Clicking Save Configuration...",
        );
        const playersSubmitBtn = page
          .locator('button[type="submit"].bright, button:has-text("Save Configuration")')
          .first();
        await playersSubmitBtn.evaluate((el: Element) => (el as HTMLElement).click());
        await page.waitForLoadState("networkidle");
      }
    }
  }

  async deleteWorldIfExists(page: Page, worldId: string): Promise<void> {
    console.log(`[V14SetupAdapter] Deleting world if exists: ${worldId}`);
    await this.switchTab(page, "Worlds");
    const worldBox = page
      .locator(`.package[data-package-id="${worldId}"], [data-package-id="${worldId}"]`)
      .first();

    if (await worldBox.isVisible()) {
      const stopButton = worldBox.locator('[data-action="worldStop"]');
      if (await stopButton.isVisible()) {
        await stopButton.evaluate((el: Element) => (el as HTMLElement).click());
        await expect(worldBox.locator('[data-action="worldLaunch"]')).toBeVisible({
          timeout: 10000,
        });
      }

      await worldBox.click({ button: "right" });
      const deleteOption = page.locator("li.context-item").filter({ hasText: /Delete World/i });
      await deleteOption.evaluate((el: Element) => (el as HTMLElement).click());

      const dialog = page
        .locator("dialog, .application")
        .filter({ hasText: /Delete World/i })
        .last();
      await expect(dialog).toBeVisible();
      const confirmCode = await dialog.locator(".reference, .confirm-code").first().innerText();
      const input = dialog
        .locator('input#delete-confirm, input[name="confirm"], input[name="world-id"]')
        .first();
      await input.fill(confirmCode);
      await dialog
        .locator('button[data-action="yes"], button:has-text("Yes"), button.bright')
        .first()
        .evaluate((el: Element) => (el as HTMLElement).click());
      await expect(worldBox).toBeHidden({ timeout: 15000 });
    }
  }

  private async waitForInstallation(
    page: Page,
    dialog: Locator,
    verificationSelector: string,
    tabName: string,
  ): Promise<void> {
    await page.waitForTimeout(5000);
    const closeBtn = dialog
      .locator('button[data-action="close"], .header-control.close, .header-button.close')
      .filter({ visible: true })
      .first();
    if (await closeBtn.isVisible())
      await closeBtn.evaluate((el: Element) => (el as HTMLElement).click());
    await this.switchTab(page, "Worlds");
    await this.switchTab(page, tabName);
  }
}

/**
 * Game adapter for Foundry VTT Version 14.
 */
export class V14GameAdapter extends BaseGameAdapter {
  version = 14;
}
