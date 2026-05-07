import { expect, Page } from "@playwright/test";

/**
 * Aggressively removes Foundry VTT tours and overlays from the DOM and localStorage.
 * @param page The Playwright Page object.
 */
export async function disableTour(page: Page) {
  console.log("[disableTour] Aggressively removing tours and overlays...");

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
          opacity: 0 !important;
          width: 0 !important;
          height: 0 !important;
          z-index: -1000 !important;
        }
        body.tour-open, body.nue-open {
            pointer-events: auto !important;
        }
        * {
            pointer-events: auto;
        }
        .tour-overlay ~ *, #tour-overlay ~ * {
            pointer-events: auto !important;
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
 * Switches between tabs in the Foundry VTT setup or configuration screens.
 * @param page The Playwright Page object.
 * @param tabName The name of the tab to switch to (e.g., "Game Worlds", "Game Systems").
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

  // Quick check: is the tab already active?
  const alreadyActive = await page
    .evaluate((dataTab) => {
      const activeTab = document.querySelector(
        ".tabs .item.active, [data-action='tab'].active, [role='tab'][aria-selected='true'], .active[data-tab], .tab.active, [data-application-part].active",
      );
      return (
        activeTab?.getAttribute("data-tab") === dataTab ||
        activeTab?.getAttribute("data-application-part") === dataTab
      );
    }, dataTabName)
    .catch(() => false);

  if (alreadyActive) {
    console.log(`[switchTab] Tab "${tabName}" (${dataTabName}) is already active.`);
    return;
  }

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
  const dataTab = (await tab.getAttribute("data-tab")) || (await tab.getAttribute("data-action"));

  // Force click via evaluate to bypass overlays, then wait for transition
  await tab.evaluate((el) => (el as HTMLElement).click());

  // Wait for the tab to be active or for the target content to be visible
  await page
    .waitForFunction(
      ({ name, dataTab }) => {
        const activeTab = document.querySelector(
          ".tabs .item.active, [data-action='tab'].active, [role='tab'][aria-selected='true'], .active[data-tab], .tab.active, [data-application-part].active",
        );
        const isTabActive =
          activeTab?.textContent?.trim().includes(name) ||
          (dataTab && activeTab?.getAttribute("data-tab") === dataTab);

        // Also check if a section with that data-tab is now visible
        const contentVisible = dataTab
          ? document.querySelector(
              `section.tab[data-tab="${dataTab}"].active, .tab[data-tab="${dataTab}"].active, [data-application-part="${dataTab}"].active`,
            ) !== null || document.querySelector(`#setup-packages-${dataTab}.active`) !== null
          : true;

        return isTabActive || contentVisible; // Loosened check for V14
      },
      { name: tabName, dataTab },
      { timeout: 10000 },
    )
    .catch(() => null);

  console.log(`[switchTab] Tab "${tabName}" clicked and verified.`);
}

/**
 * Waits for the Foundry VTT game to be fully ready (game.ready is true).
 * @param page The Playwright Page object.
 * @param timeout The timeout in milliseconds.
 */
export async function waitForReady(page: Page, timeout: number = 60000) {
  console.log("[waitForReady] Waiting for game to be ready...");
  await expect(page.locator("#loading")).toBeHidden({ timeout });
  await page.waitForFunction(
    () => typeof window.game !== "undefined" && window.game.ready,
    { timeout },
  );
}

/**
 * Detects and handles the "Reload Application" dialog.
 * @param page The Playwright Page object.
 */
export async function handleReload(page: Page) {
  console.log("[handleReload] Waiting for reload dialog...");
  const reloadDialog = page
    .locator("dialog, foundry-app, .window-app, .application")
    .filter({ hasText: /Reload|Refresh/i })
    .last();

  await reloadDialog.waitFor({ state: "visible", timeout: 10000 });
  await reloadDialog.locator("button").filter({ hasText: /Yes|Confirm/i }).first().click();
  await page.waitForLoadState("networkidle");
}

/**
 * Fills a field in a Foundry VTT dialog based on its label.
 * @param page The Playwright Page object.
 * @param label The text label of the field.
 * @param value The value to fill.
 */
export async function fillDialogField(page: Page, label: string, value: string) {
  console.log(`[fillDialogField] Filling field "${label}" with "${value}"...`);
  const field = page.locator(".form-group", { hasText: label }).locator("input, select, textarea");
  await field.fill(value);
}

/**
 * Automates the multi-step process of activating a module that may trigger
 * dependency resolution and reload dialogs.
 * @param page The Playwright Page object.
 * @param moduleId The ID of the module to activate.
 */
export async function handleModuleActivationFlow(page: Page, moduleId: string) {
  console.log(`[handleModuleActivationFlow] Activating module: ${moduleId}`);

  // 1. Find the module row and checkbox
  const moduleRow = page.locator(
    `li.package[data-module-id="${moduleId}"], .package[data-module-id="${moduleId}"]`,
  );
  const checkbox = moduleRow.locator('input[type="checkbox"]');

  // If already checked, return
  if (await checkbox.isChecked()) {
    console.log(`[handleModuleActivationFlow] Module ${moduleId} is already checked.`);
    return;
  }

  await checkbox.click({ force: true });

  // 2. Handle Dependency Resolution Dialog
  const depDialog = page
    .locator("dialog, foundry-app, .window-app, .application")
    .filter({ hasText: /Dependency|Resolution/i })
    .last();

  try {
    await depDialog.waitFor({ state: "visible", timeout: 3000 });
    console.log("[handleModuleActivationFlow] Dependency dialog detected. Resolving...");
    await depDialog
      .locator("button")
      .filter({ hasText: /Activate|Confirm|Yes/i })
      .first()
      .click();
  } catch {
    // No dependency dialog appeared, which is fine
  }

  // 3. Save and Reload
  const saveBtn = page.locator('button:has-text("Save Module Settings"), button[name="submit"]').first();
  if (await saveBtn.isVisible()) {
    await saveBtn.click();
    await handleReload(page);
    await waitForReady(page);
  }
}

/**
 * Simulates dropping a compendium item onto a target.
 * @param page The Playwright Page object.
 * @param targetSelector The selector for the drop target (e.g., an actor sheet).
 * @param uuid The UUID of the compendium item.
 */
export async function dropCompendiumItem(page: Page, targetSelector: string, uuid: string) {
  const type = uuid.split(".")[0] === "Compendium" ? "Item" : uuid.split(".")[0];
  return simulateFoundryDrop(page, targetSelector, { type, uuid });
}

/**
 * Waits for a Foundry VTT setting to reach an expected value.
 * @param page The Playwright Page object.
 * @param moduleId The ID of the module or "core".
 * @param settingId The ID of the setting.
 * @param expectedValue The expected value of the setting.
 * @param timeout The timeout in milliseconds.
 */
export async function waitForSetting(
  page: Page,
  moduleId: string,
  settingId: string,
  expectedValue: any,
  timeout: number = 5000,
) {
  console.log(
    `[waitForSetting] Waiting for setting ${moduleId}.${settingId} to be ${expectedValue}...`,
  );
  await page.waitForFunction(
    ({ moduleId, settingId, expectedValue }) => {
      return window.game.settings.get(moduleId, settingId) === expectedValue;
    },
    { moduleId, settingId, expectedValue },
    { timeout },
  );
}

/**
 * Waits for a Foundry VTT Actor flag to reach an expected value.
 * @param page The Playwright Page object.
 * @param actorId The ID or UUID of the actor.
 * @param scope The module or "core" scope.
 * @param flagKey The flag key.
 * @param expectedValue The expected value of the flag.
 * @param timeout The timeout in milliseconds.
 */
export async function waitForActorFlag(
  page: Page,
  actorId: string,
  scope: string,
  flagKey: string,
  expectedValue: any,
  timeout: number = 5000,
) {
  console.log(
    `[waitForActorFlag] Waiting for flag ${scope}.${flagKey} on actor ${actorId} to be ${expectedValue}...`,
  );
  await page.waitForFunction(
    ({ actorId, scope, flagKey, expectedValue }) => {
      const actor =
        window.game.actors.get(actorId) || window.fromUuidSync(actorId);
      return actor?.getFlag(scope, flagKey) === expectedValue;
    },
    { actorId, scope, flagKey, expectedValue },
    { timeout },
  );
}

/**
 * Waits for a specific data path on a Foundry VTT Actor to reach an expected value.
 * @param page The Playwright Page object.
 * @param actorId The ID or UUID of the actor.
 * @param dataPath The property path (e.g., "system.abilities.str.value").
 * @param expectedValue The expected value.
 * @param timeout The timeout in milliseconds.
 */
export async function waitForActorData(
  page: Page,
  actorId: string,
  dataPath: string,
  expectedValue: any,
  timeout: number = 5000,
) {
  console.log(
    `[waitForActorData] Waiting for ${dataPath} on actor ${actorId} to be ${expectedValue}...`,
  );
  await page.waitForFunction(
    ({ actorId, dataPath, expectedValue }) => {
      const actor =
        window.game.actors.get(actorId) || window.fromUuidSync(actorId);
      if (!actor) return false;

      // Simple helper to get nested property
      const getProperty = (obj: any, path: string) => {
        return path.split(".").reduce((o, i) => o?.[i], obj);
      };

      return getProperty(actor, dataPath) === expectedValue;
    },
    { actorId, dataPath, expectedValue },
    { timeout },
  );
}

/**
 * Verifies that a specific event was logged in the FP_VERIFY registry.
 * @param page The Playwright Page object.
 * @param key The log key to check.
 * @param predicate A function that receives the log data and returns true if it matches.
 * @param extraData Optional data to pass to the predicate (to avoid closure issues).
 * @param timeout The timeout in milliseconds.
 */
export async function verifyResult(
  page: Page,
  key: string,
  predicate: (data: any, extra?: any) => boolean,
  extraData?: any,
  timeout: number = 5000,
) {
  console.log(`[verifyResult] Waiting for log "${key}" matching predicate...`);
  const predicateStr = predicate.toString();

  // First check if it already exists in the logs
  const alreadyFound = await page.evaluate(
    ({ key, predicateStr, extraData }) => {
      const predicate = new Function(`return ${predicateStr}`)();
      const entries = window.FP_VERIFY?.logs[key] || [];
      return entries.some((e: any) => {
        try {
          return e && predicate(e, extraData);
        } catch {
          return false;
        }
      });
    },
    { key, predicateStr, extraData },
  );

  if (alreadyFound) {
    console.log(`[verifyResult] Found existing log for "${key}".`);
    return;
  }

  await page
    .waitForFunction(
      ({ key, predicateStr, extraData }) => {
        try {
          const predicate = new Function(`return ${predicateStr}`)();
          const entries = window.FP_VERIFY?.logs[key] || [];
          return entries.some((e: any) => {
            try {
              return e && predicate(e, extraData);
            } catch {
              return false;
            }
          });
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
 * Clears the FP_VERIFY registry in the browser.
 * @param page The Playwright Page object.
 */
export async function clearFPVerify(page: Page) {
  console.log(`[clearFPVerify] Resetting verification logs...`);
  await page.evaluate(() => {
    window.FP_VERIFY_RESET?.();
  });
}

/**
 * Simulates a Foundry VTT drag-and-drop event.
 * @param page The Playwright Page object.
 * @param selector The selector for the drop target.
 * @param data The data to include in the DragEvent's dataTransfer (type and uuid).
 */
export async function simulateFoundryDrop(
  page: Page,
  selector: string,
  data: { type: string; uuid: string },
) {
  console.log(`[simulateFoundryDrop] Dropping ${data.type} (${data.uuid}) onto ${selector}...`);
  await page.evaluate(
    ({ selector, data }) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`Drop target not found: ${selector}`);

      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", JSON.stringify(data));
      dataTransfer.dropEffect = "copy";

      // Fire dragenter
      target.dispatchEvent(
        new DragEvent("dragenter", { dataTransfer, bubbles: true, cancelable: true }),
      );

      // Fire dragover
      target.dispatchEvent(
        new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true }),
      );

      // Fire drop
      target.dispatchEvent(
        new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }),
      );
    },
    { selector, data },
  );
}
