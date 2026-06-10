import { expect, Locator } from "@playwright/test";
import { SetupAdapter, BaseGameAdapter } from "./base.js";
import { installModuleFromManifest as helperInstallModuleFromManifest } from "../helpers.js";

import { FoundryPage } from "../types/index.js";

/**
 * Setup adapter for Foundry VTT Version 13.
 */
export class V13SetupAdapter implements SetupAdapter {
  version = 13;

  constructor(page?: FoundryPage) {
    if (page?.deprecationTracker) {
      // Add version-specific ignores if needed
    }
  }

  async switchTab(page: FoundryPage, tabName: string): Promise<void> {
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
    console.log(`[V13SetupAdapter] Switching to setup tab: ${tabName} (${dataTab})`);

    // Ensure navigation is visible
    const nav = page.locator("nav, .navigation, #setup-packages-modules").first();
    await nav.waitFor({ state: "attached", timeout: 20000 });

    const tabLocator = page
      .locator("nav h2, .navigation h2, h2, #setup-packages-modules h2")
      .filter({ hasText: new RegExp(tabName, "i") })
      .first();

    console.log(`[V13SetupAdapter] Waiting for tab locator visibility for "${tabName}"...`);
    await expect(tabLocator).toBeVisible({ timeout: 20000 });

    const tabText = await tabLocator.innerText();
    console.log(`[V13SetupAdapter] Found tab: "${tabText}". Clicking...`);

    // Use evaluate to bypass Playwright's overlay-blocking actionability check.
    // Standard click() inherits the test timeout and hangs when a modal dialog is present.
    await tabLocator.evaluate((el: Element) => (el as HTMLElement).click());

    await page.waitForFunction(
      ({ name, dt }) => {
        const h2 = Array.from(document.querySelectorAll("nav h2, .navigation h2, h2")).find(
          (el) =>
            el.textContent?.toLowerCase().includes(name.toLowerCase()) ||
            el.textContent?.toLowerCase().includes(dt.toLowerCase()),
        );
        return h2?.classList.contains("active");
      },
      { name: tabName, dt: dataTab },
      { timeout: 10000 },
    );

    // Wait for content section visibility
    await page.waitForFunction(
      (dt) => {
        const section = document.querySelector(`#setup-packages-${dt}`);
        return section && !section.getAttribute("style")?.includes("display: none");
      },
      dataTab,
      { timeout: 10000 },
    );

    console.log(`[V13SetupAdapter] Tab ${tabName} is now active.`);
  }

  async handleEULA(page: FoundryPage): Promise<void> {
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
      await eulaButton.first().evaluate((el: Element) => (el as HTMLElement).click());

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

  async handleLicenseActivation(page: FoundryPage, licenseKey?: string): Promise<void> {
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

  async installSystem(page: FoundryPage, systemId: string, _systemLabel: string): Promise<void> {
    console.log(`[V13SetupAdapter] Installing system: ${systemId}`);
    await this.switchTab(page, "Systems");

    // Check if already installed
    const localPackage = page
      .locator(`#setup-packages-systems [data-package-id="${systemId}"]`)
      .first();
    if (await localPackage.isVisible()) {
      console.log(`[V13SetupAdapter] System ${systemId} is already installed.`);
      return;
    }

    const installDialog = await this.openSystemInstallDialog(page);

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
      await installButton.evaluate((el: Element) => (el as HTMLElement).click());
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

  async installModules(page: FoundryPage, moduleIds: string[]): Promise<void> {
    console.log(`[V13SetupAdapter] Installing modules: ${moduleIds.join(", ")}`);
    await this.switchTab(page, "Modules");

    for (const modId of moduleIds) {
      const moduleBox = page
        .locator(`[data-package-id="${modId}"], [data-module-id="${modId}"]`)
        .first();
      if ((await moduleBox.count()) === 0 || (await moduleBox.isHidden())) {
        const installDialog = await this.openModuleInstallDialog(page);

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
          await installButton.evaluate((el: Element) => (el as HTMLElement).click());
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

  async installSystemFromManifest(page: FoundryPage, manifestUrl: string): Promise<void> {
    console.log(`[V13SetupAdapter] Installing system from manifest: ${manifestUrl}`);

    // Extract system id from URL so we can scope the verification selector.
    const systemIdMatch = /github\.com\/foundryvtt\/([^/]+)\/releases/.exec(manifestUrl);
    const systemId = systemIdMatch?.[1]; // e.g. "dnd5e"

    // Skip if already installed.
    await this.switchTab(page, "Systems");
    if (systemId) {
      const already = page
        .locator(`#setup-packages-systems [data-package-id="${systemId}"]`)
        .first();
      if (await already.isVisible()) {
        console.log(`[V13SetupAdapter] System ${systemId} already installed — skipping.`);
        return;
      }
    }

    const installDialog = await this.openSystemInstallDialog(page);

    // Fill the manifest URL input and click its adjacent install button via evaluate
    // to avoid actionability issues and to precisely target the form-group button.
    const installed = await page.evaluate((url) => {
      const input = document.querySelector<HTMLInputElement>('input[name="manifestURL"]');
      if (!input) return { ok: false, reason: "manifestURL input not found" };
      input.value = url;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const btn =
        input.closest(".form-group, footer, .form-fields")?.querySelector<HTMLElement>("button") ??
        document.querySelector<HTMLElement>('button.bright, button[data-action="installUrl"]');
      if (!btn) return { ok: false, reason: "install button not found" };
      btn.click();
      return { ok: true, reason: "" };
    }, manifestUrl);
    if (!installed.ok) {
      console.warn(
        `[V13SetupAdapter] installSystemFromManifest: ${installed.reason} — install may not have started.`,
      );
    }

    // Scope the verificationSelector to the Systems section so we don't accidentally
    // match the hidden fake-module element that lives in the Modules section of the DOM.
    const verificationSelector = systemId
      ? `#setup-packages-systems [data-package-id="${systemId}"]`
      : "#setup-packages-systems [data-package-id]";
    await this.waitForInstallation(page, installDialog, verificationSelector, "Systems");
  }

  async installModuleFromManifest(page: FoundryPage, manifestUrl: string): Promise<void> {
    await helperInstallModuleFromManifest(page, manifestUrl);
  }

  async openSystemInstallDialog(page: FoundryPage): Promise<Locator> {
    console.log("[V13SetupAdapter] Opening System Install Dialog...");
    await this.switchTab(page, "Systems");
    await this.dismissAnalyticsDialog(page);

    const installBtn = page
      .locator("button:visible")
      .filter({ hasText: /Install System/i })
      .first();

    await expect(installBtn).toBeVisible({ timeout: 10000 });
    await installBtn.evaluate((el: Element) => (el as HTMLElement).click());

    const dialog = page
      .locator("dialog, #install-package, .application.category-browser, foundry-app")
      .filter({ hasText: /Install System|Install Package/i })
      .last();

    await expect(dialog).toBeVisible({ timeout: 30000 });
    return dialog;
  }

  async openModuleInstallDialog(page: FoundryPage): Promise<Locator> {
    console.log("[V13SetupAdapter] Opening Module Install Dialog...");
    await this.switchTab(page, "Modules");

    const installBtn = page
      .locator("button:visible")
      .filter({ hasText: /Install Module/i })
      .first();

    await expect(installBtn).toBeVisible({ timeout: 10000 });
    await installBtn.evaluate((el: Element) => (el as HTMLElement).click());

    const dialog = page
      .locator("dialog, #install-package, .application.category-browser, foundry-app")
      .filter({ hasText: /Install Module|Install Package|Install System/i })
      .last();

    await expect(dialog).toBeVisible({ timeout: 30000 });
    return dialog;
  }

  async createWorld(
    page: FoundryPage,
    worldId: string,
    systemLabel: string,
    systemId: string,
  ): Promise<void> {
    console.log(`[V13SetupAdapter] Creating world: ${worldId}`);
    await this.switchTab(page, "Worlds");
    await this.dismissAnalyticsDialog(page);

    const createBtn = page
      .locator("button")
      .filter({ hasText: /Create World/i })
      .first();
    console.log("[V13SetupAdapter] Clicking Create World button...");
    await createBtn.evaluate((el: Element) => (el as HTMLElement).click());

    // V13 WorldConfig Application renders with id="world-config" on the outer container div,
    // not on the inner <form> element — so `form#world-config` never matches.
    const createDialog = page.locator("#world-config, .window-app#world-config").last();

    await createDialog.waitFor({ state: "visible", timeout: 20000 });
    console.log("[V13SetupAdapter] World creation dialog is visible.");

    const titleInput = createDialog
      .locator('input[name="title"], input[name*="title" i], input[placeholder*="Title" i]')
      .first();

    await titleInput.waitFor({ state: "visible", timeout: 10000 });
    await titleInput.fill(worldId);

    const pathInput = createDialog.locator(
      'input[name="id"], input[name="name"], input[name*="path" i], input[placeholder*="Path" i]',
    );
    if (await pathInput.first().isVisible()) {
      await pathInput.first().fill(worldId);
    }

    const systemSelect = createDialog.locator(
      'select[name="system"], select[name*="system" i], select.system-select',
    );

    // Attempt to select by value (id), then fallback to label
    try {
      await systemSelect.first().selectOption({ value: systemId }, { timeout: 5000 });
    } catch {
      console.warn(
        `[V13SetupAdapter] Failed to select system by ID "${systemId}". Trying label "${systemLabel}"...`,
      );
      // Fallback to label
      await systemSelect.first().selectOption({ label: systemLabel });
    }

    const submitBtn = createDialog
      .locator('button[type="submit"], button')
      .filter({ hasText: /Create World|Create/i })
      .first();
    await submitBtn
      .click()
      .catch(() => submitBtn.evaluate((el: Element) => (el as HTMLElement).click()));

    // Wait for the world-config dialog to close (id is on the outer container, not the form)
    await expect(page.locator("#world-config")).toBeHidden({ timeout: 20000 });
  }

  async launchWorld(page: FoundryPage, worldId: string): Promise<void> {
    console.log(`[V13SetupAdapter] Launching world: ${worldId}`);
    await this.switchTab(page, "Worlds");
    const worldBox = page.locator(`[data-package-id="${worldId}"]`).first();
    await worldBox.waitFor({ state: "visible", timeout: 15000 });

    const launchBtn = worldBox
      .locator('[data-action="worldLaunch"], button:has-text("Launch")')
      .first();
    // The launch button in V13 is hidden by default (shown on hover); wait for it to be
    // attached to the DOM, then dispatch the click — bypasses both actionability and CSS visibility.
    await launchBtn.waitFor({ state: "attached", timeout: 15000 });
    await launchBtn.dispatchEvent("click");
    await page.waitForURL(
      (u) =>
        u.pathname.includes("/join") ||
        u.pathname.includes("/game") ||
        u.pathname.includes("/players"),
      { timeout: 120000 },
    );
  }

  async createWorldBackup(
    _page: FoundryPage,
    _worldId: string,
    _backupName: string,
  ): Promise<void> {
    throw new Error(
      "[V13SetupAdapter] World backups are not supported on Foundry V13. Use V14 or later.",
    );
  }

  async restoreWorldBackup(
    _page: FoundryPage,
    _worldId: string,
    _backupName: string,
  ): Promise<void> {
    throw new Error(
      "[V13SetupAdapter] World backup restore is not supported on Foundry V13. Use V14 or later.",
    );
  }

  async listWorldBackups(_page: FoundryPage, _worldId: string): Promise<string[]> {
    throw new Error(
      "[V13SetupAdapter] World backup listing is not supported on Foundry V13. Use V14 or later.",
    );
  }

  async deleteWorldBackup(
    _page: FoundryPage,
    _worldId: string,
    _backupName: string,
  ): Promise<void> {
    throw new Error(
      "[V13SetupAdapter] World backup deletion is not supported on Foundry V13. Use V14 or later.",
    );
  }

  async deleteWorldIfExists(page: FoundryPage, worldId: string): Promise<void> {
    console.log(`[V13SetupAdapter] Deleting world if exists: ${worldId}`);
    await this.switchTab(page, "Worlds");
    await this.dismissAnalyticsDialog(page);
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
    page: FoundryPage,
    dialog: Locator,
    verificationSelector: string,
    tabName: string,
  ): Promise<void> {
    // Wait for progress indicator to appear (up to 10s), then wait for it to disappear.
    // Using waitForFunction is more efficient than locator.waitFor for polling DOM state.
    await page
      .waitForFunction(
        () =>
          !!document.querySelector(
            ".notification.info, .progress-bar.active, .notification.warning",
          ),
        { timeout: 10000 },
      )
      .catch(() => {
        console.log("[V13SetupAdapter] Installation progress indicator not detected.");
      });
    await page
      .waitForFunction(
        () =>
          !document.querySelector(
            ".notification.info, .progress-bar.active, .notification.warning",
          ),
        { timeout: 300000 },
      )
      .catch(() => null);

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
      await this.switchTab(page, "Worlds"); // Transition away and back
      await this.switchTab(page, tabName);
      await page
        .locator(verificationSelector)
        .first()
        .waitFor({ state: "visible", timeout: 30000 });
    }
  }

  private async dismissAnalyticsDialog(page: FoundryPage): Promise<void> {
    const analyticsLocator = page
      .locator("dialog, .window-app, .application")
      .filter({ hasText: /usage data/i })
      .first();
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
        return;
      }
    }
    // Fallback DOM removal
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
  }
}

/**
 * Game adapter for Foundry VTT Version 13.
 */
export class V13GameAdapter extends BaseGameAdapter {
  version = 13;

  constructor(page?: FoundryPage) {
    super(page);
  }
}
