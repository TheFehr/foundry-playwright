import { expect, Page, Locator } from "@playwright/test";

/**
 * Aggressively removes Foundry VTT tours and overlays from the DOM and localStorage.
 * @param page The Playwright Page object.
 */
export async function disableTour(page: Page) {
  const removalScript = () => {
    const selectors = [
      ".tour-overlay",
      "#tour-overlay",
      ".joyride-overlay",
      ".foundry-tour-overlay",
      ".tour-dot",
      ".tour-step-anchor",
      ".nue-overlay",
      ".nue-container",
      "foundry-guide",
    ];

    // 1. Remove elements from DOM
    const remove = () => {
      selectors.forEach((s) => {
        document.querySelectorAll(s).forEach((el) => {
          (el as HTMLElement).style.display = "none";
          (el as HTMLElement).style.pointerEvents = "none";
          el.remove();
        });
      });
      // Also remove pointer-events from body if blocked
      if (
        document.body.classList.contains("tour-open") ||
        document.body.style.pointerEvents === "none"
      ) {
        document.body.classList.remove("tour-open", "nue-open");
        document.body.style.pointerEvents = "auto";
      }
    };
    remove();

    // 2. Inject override style
    if (!document.getElementById("foundry-playwright-no-tour")) {
      const style = document.createElement("style");
      style.id = "foundry-playwright-no-tour";
      style.innerHTML = `
        .tour-overlay, #tour-overlay, .joyride-overlay, .foundry-tour-overlay, .nue-overlay, .nue-container, foundry-guide, .tour-step-anchor, .tour-dot { 
          display: none !important; 
          visibility: hidden !important; 
          pointer-events: none !important; 
        }
      `;
      document.head.appendChild(style);
    }

    // 3. Set localStorage to mark tours as completed
    try {
      const tourProgress = { core: { backupsOverview: 1, welcome: 1, setup: 1 } };
      window.localStorage.setItem("core.tourProgress", JSON.stringify(tourProgress));
    } catch {}

    // 4. Mutation Observer to keep them gone
    const observer = new MutationObserver(remove);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  // Run as init script for new pages
  await page.addInitScript(removalScript);
  // Run immediately on the current page
  await page.evaluate(removalScript).catch(() => null);
}

/**
 * Navigates to a specific tab by name or ID.
 * @param page The Playwright Page object.
 * @param tabName The logical name or data-tab value of the tab.
 */
export async function switchTab(page: Page, tabName: string) {
  // Map logical names to data-tab values for robustness
  const tabMap: Record<string, string> = {
    "Game Worlds": "worlds",
    Worlds: "worlds",
    "Game Systems": "systems",
    Systems: "systems",
    "Add-on Modules": "modules",
    Modules: "modules",
    Configuration: "config",
    "Update Software": "update",
  };

  const dataTabName = tabMap[tabName] || tabName.toLowerCase();

  console.log(`[switchTab] Switching to tab: ${tabName}`);

  // 1. Try robust data-tab selectors first (V13/V14 common patterns)
  const selectors = [
    `[data-tab="${dataTabName}"]`,
    `[data-action="tab"][data-tab="${dataTabName}"]`,
    `nav.tabs [data-tab="${dataTabName}"]`,
    `nav.tabs [data-action="tab"][data-tab="${dataTabName}"]`,
    `button[role="tab"][data-tab="${dataTabName}"]`,
    `[data-application-part] [data-tab="${dataTabName}"]`,
    // Fallbacks if mapping failed but text matches
    `nav.tabs [data-tab]:has-text("${tabName}")`,
    `[data-action="tab"]:has-text("${tabName}")`,
    `.tabs .item:has-text("${tabName}")`,
    `button[role="tab"]:has-text("${tabName}")`,
  ];

  let tab = null;
  for (const selector of selectors) {
    const candidate = page.locator(selector).first();
    if ((await candidate.count()) > 0 && (await candidate.isVisible())) {
      console.log(`[switchTab] Found candidate with selector: ${selector}`);
      tab = candidate;
      break;
    }
  }

  if (!tab) {
    console.log(
      `[switchTab] No robust selector matched for "${tabName}". Falling back to text search.`,
    );
    tab = page
      .locator(`*:visible:has-text("${tabName}")`)
      .filter({ hasNot: page.locator("option") })
      .first();
  }

  await expect(tab).toBeVisible({ timeout: 15000 });

  // Get the data-tab attribute if it exists to wait for content later
  const dataTab =
    (await tab.getAttribute("data-tab")) || (await tab.getAttribute("data-action")) || dataTabName;

  // Force click via evaluate to bypass overlays, then wait for transition
  await tab.evaluate((el) => (el as HTMLElement).click());

  // Wait for the tab to be active or for the target content to be visible
  await page
    .waitForFunction(
      ({ name, dataTab }) => {
        const activeTab = document.querySelector(
          ".tabs .item.active, [data-action='tab'].active, [role='tab'][aria-selected='true'], .active[data-tab], .tab.active, [data-application-part].active, nav h2.active, .navigation h2.active, h2.active",
        );
        const isTabActive =
          activeTab?.textContent?.trim().includes(name) ||
          (dataTab && activeTab?.getAttribute("data-tab") === dataTab);

        // Also check if a section with that data-tab is now visible
        const contentVisible = dataTab
          ? document.querySelector(
              `section.tab[data-tab="${dataTab}"].active, .tab[data-tab="${dataTab}"].active, [data-application-part="${dataTab}"].active`,
            ) !== null ||
            document.querySelector(`#setup-packages-${dataTab}.active`) !== null ||
            document.querySelector(`#setup-packages-${dataTab}:not([style*="display: none"])`) !==
              null
          : true;

        return isTabActive || contentVisible;
      },
      { name: tabName, dataTab },
      { timeout: 10000 },
    )
    .catch(() => null);

  console.log(`[switchTab] Tab "${tabName}" clicked and verified.`);
}

/**
 * Navigates to the Systems tab and opens the installation dialog.
 * @param page The Playwright Page object.
 */
export async function openSystemInstallDialog(page: Page): Promise<Locator> {
  const { getSetupAdapter } = await import("./setup/index.js");
  const adapter = await getSetupAdapter(page);
  return await adapter.openSystemInstallDialog(page);
}

/**
 * Navigates to the Modules tab and opens the installation dialog.
 * @param page The Playwright Page object.
 */
export async function openModuleInstallDialog(page: Page): Promise<Locator> {
  const { getSetupAdapter } = await import("./setup/index.js");
  const adapter = await getSetupAdapter(page);
  return await adapter.openModuleInstallDialog(page);
}

/**
 * Installs a system from a manifest URL.
 * @param page The Playwright Page object.
 * @param manifestUrl The URL to the system.json manifest.
 */
export async function installSystemFromManifest(page: Page, manifestUrl: string): Promise<void> {
  console.log(`[installSystemFromManifest] Installing from: ${manifestUrl}`);
  const dialog = await openSystemInstallDialog(page);
  await installFromManifest(page, dialog, manifestUrl);
}

/**
 * Installs a module from a manifest URL.
 * @param page The Playwright Page object.
 * @param manifestUrl The URL to the module.json manifest.
 */
export async function installModuleFromManifest(page: Page, manifestUrl: string): Promise<void> {
  console.log(`[installModuleFromManifest] Installing from: ${manifestUrl}`);
  const dialog = await openModuleInstallDialog(page);
  await installFromManifest(page, dialog, manifestUrl);
}

/**
 * Shared helper for filling manifest URL and clicking install in a dialog.
 */
async function installFromManifest(
  page: Page,
  dialog: Locator,
  manifestUrl: string,
): Promise<void> {
  // Foundry's manifest input is usually at the bottom
  const manifestInput = dialog
    .locator(
      'input#install-package-manifestUrl, input[name="manifestURL"], input:not(#world-filter):not(#system-filter):not(#module-filter):not([type="checkbox"]):not([type="radio"])',
    )
    .first();
  await manifestInput.fill(manifestUrl);

  const installBtn = dialog
    .locator('button[data-action="installPackage"], button:has-text("Install"), button.bright')
    .filter({ visible: true })
    .last();
  await installBtn.evaluate((el) => (el as HTMLElement).click());

  // Use the progress bar / notification wait logic
  await page
    .waitForFunction(() => {
      const progress = document.querySelector(".notification.info, .progress-bar, .loading");
      return !progress;
    })
    .catch(() => null);

  // Close the dialog if it's still open
  const closeBtn = dialog.locator('button[data-action="close"], .header-button.close');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
  }
}

/**
 * Waits for the Foundry VTT game object to be fully initialized and ready.
 * @param page The Playwright Page object.
 */
export async function waitForReady(page: Page) {
  console.log("[waitForReady] Waiting for game to be ready...");
  await page.waitForFunction(() => (window as any).game?.ready, { timeout: 60000 });
}

/**
 * Executes a function after ensuring a log has been emitted via FP_VERIFY.
 * @param page The Playwright Page object.
 * @param key The log key to wait for.
 * @param predicate A function to test the log data.
 * @param extraData Optional extra data to pass to the predicate.
 */
export async function verifyResult(
  page: Page,
  key: string,
  predicate: (data: any, extra?: any) => boolean,
  extraData?: any,
  options: { timeout?: number } = {},
) {
  const { timeout = 15000 } = options;
  console.log(`[verifyResult] Waiting for log "${key}" matching predicate...`);

  // We must stringify the predicate to pass it into evaluate
  const predicateStr = predicate.toString();

  await page
    .waitForFunction(
      ({ key, predicateStr, extraData }) => {
        try {
          const predicate = new Function(`return ${predicateStr}`)();
          const logs = (window as any).FP_VERIFY?.logs[key] || [];
          return logs.some((l: any) => predicate(l, extraData));
        } catch {
          return false;
        }
      },
      { key, predicateStr, extraData },
      { timeout },
    )
    .catch((err) => {
      console.error(`[verifyResult] Timeout waiting for log "${key}".`);
      throw err;
    });
}

/**
 * Waits for a specific actor flag to be set to a value.
 */
export async function waitForActorFlag(page: Page, actorName: string, flag: string, value: any) {
  await verifyResult(page, "actor-update", (data) => {
    return data.name === actorName && data.delta.flags?.["fake-module"]?.[flag] === value;
  });
}

/**
 * Waits for specific actor data to be updated.
 */
export async function waitForActorData(page: Page, actorName: string, path: string, value: any) {
  await verifyResult(page, "actor-update", (data) => {
    const current = data.delta.system?.[path];
    return data.name === actorName && current === value;
  });
}

/**
 * Waits for a game setting to be set.
 */
export async function waitForSetting(page: Page, module: string, key: string, value: any) {
  // Note: Settings updates are usually logged or checked directly
  await page.waitForFunction(
    ({ module, key, value }) => {
      return (window as any).game.settings.get(module, key) === value;
    },
    { module, key, value },
  );
}

/**
 * Clears the FP_VERIFY log registry.
 */
export async function clearFPVerify(page: Page) {
  await page.evaluate(() => {
    if ((window as any).FP_VERIFY_RESET) (window as any).FP_VERIFY_RESET();
  });
}

/**
 * Handles the Foundry VTT reload dialog.
 */
export async function handleReload(page: Page) {
  const dialog = page
    .locator("dialog, foundry-app, .window-app")
    .filter({ hasText: /Reload/i })
    .last();
  await expect(dialog).toBeVisible();
  await dialog.locator('button:has-text("Yes")').first().click();
  await page.waitForLoadState("networkidle");
  await waitForReady(page);
}

/**
 * Fills a field in a visible dialog.
 */
export async function fillDialogField(page: Page, label: string, value: string) {
  const dialog = page.locator("dialog, foundry-app, .window-app").filter({ visible: true }).last();
  const input = dialog.locator(`input[name="${label}"], input[placeholder*="${label}" i]`).first();
  await input.fill(value);
}

/**
 * Performs the full module activation flow for a list of modules.
 */
export async function handleModuleActivationFlow(page: Page, moduleIds: string[]) {
  const { foundrySetup } = await import("./auth.js");
  await foundrySetup(page, { moduleId: moduleIds, createWorld: false, deleteIfExists: false });
}

/**
 * Simulates a drop from a compendium onto a target.
 */
export async function dropCompendiumItem(
  page: Page,
  targetSelector: string,
  pack: string,
  itemId: string,
) {
  const data = {
    type: "Item",
    uuid: `Compendium.${pack}.Item.${itemId}`,
  };
  await simulateFoundryDrop(page, targetSelector, data);
}

/**
 * Simulates a Foundry VTT drag-and-drop event.
 */
export async function simulateFoundryDrop(page: Page, targetSelector: string, data: any) {
  console.log(`[simulateFoundryDrop] Dropping ${data.type} onto ${targetSelector}...`);
  await page.evaluate(
    ({ selector, data }) => {
      const selectors = selector.split(",").map((s) => s.trim());
      let el: HTMLElement | null = null;

      for (const sel of selectors) {
        const cleanSel = sel.replace(/:has-text\([^)]*\)/g, "");
        try {
          const matches = document.querySelectorAll(cleanSel);
          if (sel.includes(":has-text")) {
            const textMatch = sel.match(/:has-text\("([^"]*)"\)/);
            const searchText = textMatch ? textMatch[1] : "";
            el = Array.from(matches).find((m) =>
              m.textContent?.includes(searchText),
            ) as HTMLElement;
          } else {
            el = matches[0] as HTMLElement;
          }
        } catch {
          // Ignore selector errors
        }
        if (el) break;
      }

      if (!el) throw new Error(`Target ${selector} not found.`);

      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", JSON.stringify(data));
      el.dispatchEvent(
        new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true }),
      );
      el.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
    },
    { selector: targetSelector, data },
  );
}
