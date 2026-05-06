import { test as base } from "@playwright/test";
import { FoundryState } from "./state.js";
import { FoundryUI } from "./ui/index.js";
import { FoundryCanvas } from "./canvas.js";
import { disableTour } from "./helpers.js";

/**
 * Extended Playwright test fixtures for Foundry VTT.
 */
export interface FoundryFixtures {
  /** Helper for Foundry VTT utilities. */
  foundry: {
    /** Direct state manipulation. */
    state: FoundryState;
    /** UI interaction and selectors. */
    ui: FoundryUI;
    /** WebGL Canvas interaction. */
    canvas: FoundryCanvas;
  };
}

/**
 * Extended Playwright test fixture that monitors the browser console for critical errors and warnings,
 * and provides Foundry-specific utilities.
 */
export const test = base.extend<FoundryFixtures>({
  foundry: async ({ page }, use) => {
    const systemId = process.env.FOUNDRY_SYSTEM_ID || "dnd5e";
    const uiAdapterId = process.env.FOUNDRY_UI_ADAPTER || "default";

    await use({
      state: new FoundryState(page, systemId),
      ui: new FoundryUI(page, uiAdapterId),
      canvas: new FoundryCanvas(page),
    });
  },
  page: async ({ page }, use) => {
    // Aggressively suppress tours for every test page
    await disableTour(page);

    page.on("console", (msg) => {
      const text = msg.text();
      const type = msg.type();

      // Ignore known harmless warnings
      if (text.includes("hardware acceleration")) return;
      if (text.includes("Skipping game canvas")) return;
      if (text.includes("Buffered socket event")) return;
      // Vite dev server noise
      if (text.includes("[vite]")) return;

      if (type === "error") {
        // We log errors but don't fail immediately because Foundry often has benign 404s for assets
        console.error(`Browser Error: ${text}`);
      }

      if (type === "warning") {
        // Log all warnings to host console for visibility
        console.warn(`Browser Warning: ${text}`);

        // Fail only on severe migration errors
        if (
          text.includes("Cannot read properties of null") ||
          text.includes("Failed data migration")
        ) {
          console.error(`CRITICAL WARNING detected in browser console: ${text}`);
          throw new Error(`Critical Warning: ${text}`);
        }
      }
    });

    try {
      await use(page);
    } catch (error) {
      // If a test fails, try to dump FP_VERIFY logs for debugging
      const verifyData = await page
        .evaluate(() => {
          // @ts-ignore
          return window.FP_VERIFY ? JSON.stringify(window.FP_VERIFY.logs, null, 2) : null;
        })
        .catch(() => null);

      if (verifyData) {
        console.error(`[FP_VERIFY DUMP on Failure]:\n${verifyData}`);
      }
      throw error;
    }
  },
});

export { expect } from "@playwright/test";
