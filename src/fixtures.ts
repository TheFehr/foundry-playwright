import { test as base } from "@playwright/test";
import { FoundryState } from "./state.js";
import { FoundryUI } from "./ui/index.js";
import { FoundryCanvas } from "./canvas.js";
import { disableTour } from "./helpers.js";
import { DeprecationTracker } from "./deprecations.js";
import { initAllSystems } from "./systems/index.js";

import { FoundryPage } from "./types/index.js";

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
  /** Tracker for deprecation warnings. */
  deprecationTracker: DeprecationTracker;
  /** The Playwright Page object. */
  page: FoundryPage;
}

/**
 * Extended Playwright test fixture that monitors the browser console for critical errors and warnings,
 * and provides Foundry-specific utilities.
 */
export const test = base.extend<FoundryFixtures>({
  deprecationTracker: async (_, use) => {
    await use(new DeprecationTracker());
  },
  foundry: async ({ page, deprecationTracker }, use) => {
    const systemId = process.env.FOUNDRY_SYSTEM_ID || "dnd5e";
    const uiAdapterId = process.env.FOUNDRY_UI_ADAPTER || "default";

    await use({
      state: new FoundryState(page as FoundryPage, systemId, deprecationTracker),
      ui: new FoundryUI(page, uiAdapterId),
      canvas: new FoundryCanvas(page),
    });
  },
  page: async ({ page, deprecationTracker }, use) => {
    // 1. Initial page setup
    await disableTour(page);

    // Attach tracker to page for non-fixture access (e.g. in adapters)
    const foundryPage = page as FoundryPage;
    foundryPage.deprecationTracker = deprecationTracker;

    // Initialize all known systems to register their deprecation patterns
    initAllSystems(foundryPage);

    const deprecations: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      const type = msg.type();
      if (
        text.includes("hardware acceleration") ||
        text.includes("Skipping game canvas") ||
        text.includes("Buffered socket event") ||
        text.includes("[vite]")
      )
        return;

      if (type === "error") console.error(`Browser Error: ${text}`);
      if (type === "warning") {
        if (deprecationTracker.shouldIgnore(text)) return;

        console.warn(`Browser Warning: ${text}`);

        if (deprecationTracker.shouldFail(text)) {
          deprecations.push(text);
          return;
        }

        if (
          text.includes("Cannot read properties of null") ||
          text.includes("Failed data migration")
        ) {
          throw new Error(`Critical Warning: ${text}`);
        }
      }
      if (type === "log") console.log(`Browser Log: ${text}`);
    });

    // 2. Pre-Test Synchronization
    const syncModule = async () => {
      const url = page.url();
      if (url.includes("/game") || url.includes("/players")) {
        console.log("[fixture] Synchronizing with game state...");
        await page
          .waitForFunction(() => (window as any).FP_VERIFY !== undefined, { timeout: 30000 })
          .catch(() => null);

        // Wait for constructor readiness on V14
        const isV14 = await page.evaluate(
          () =>
            (window as any).foundry?.applications?.api?.ApplicationV2 !== undefined ||
            document.querySelector('script[src*="foundry.mjs"]') !== null,
        );
        if (isV14) {
          await page
            .waitForFunction(
              () => {
                return (
                  (window as any).FakeAppV2 !== undefined && (window as any).FakeTour !== undefined
                );
              },
              {},
              { timeout: 15000 },
            )
            .catch(() => null);
        }
      }
    };

    await syncModule();

    try {
      await use(foundryPage);

      // Report deprecations at the end of a successful test run
      if (deprecations.length > 0) {
        const uniqueDeprecations = Array.from(new Set(deprecations));
        throw new Error(
          `Deprecation Warnings detected during test:\n${uniqueDeprecations.join("\n")}`,
        );
      }
    } catch (error) {
      const verifyData = await page
        .evaluate(() => {
          if (!(window as any).FP_VERIFY) return null;
          // Return a shallow copy of log keys to avoid massive serialization
          const logs = (window as any).FP_VERIFY.logs;
          const summary: any = {};
          for (let key in logs) {
            summary[key] = logs[key].length + " entries";
          }
          return {
            summary,
            lastLogs: Object.fromEntries(
              Object.entries(logs).map(([k, v]: [string, any]) => [k, v.slice(-1)]),
            ),
          };
        })
        .catch(() => null);
      if (verifyData)
        console.error(`[FP_VERIFY DUMP on Failure]:\n${JSON.stringify(verifyData, null, 2)}`);
      throw error;
    }
  },
});

export { expect } from "@playwright/test";
