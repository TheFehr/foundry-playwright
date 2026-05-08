import { Page } from "@playwright/test";
import { SetupAdapter, GameAdapter } from "./base.js";
import { V13SetupAdapter, V13GameAdapter } from "./v13.js";
import { V14SetupAdapter, V14GameAdapter } from "./v14.js";

/**
 * Detects the Foundry VTT version and returns the appropriate setup adapter.
 * @param page The Playwright Page object.
 */
export async function getSetupAdapter(page: Page): Promise<SetupAdapter> {
  // Sniff version from game object or DOM
  const version = await page.evaluate(() => {
    // 1. Definitive source: game.version (in game)
    const v = window.game?.version || window.game?.release?.generation;
    if (v) {
      if (String(v).startsWith("14")) return 14;
      if (String(v).startsWith("13")) return 13;
    }

    // 2. Sniff from DOM (on setup screen)
    // V14 uses the <foundry-app> web component for its setup interface.
    // V13 uses a traditional <body> with classes like "setup".
    const isV14 =
      document.querySelector("foundry-app") !== null ||
      document.body.classList.contains("v14") ||
      (window as any).foundry?.applications?.api?.ApplicationV2 !== undefined;

    if (isV14) return 14;

    // Default to 13
    return 13;
  });

  console.log(`[getSetupAdapter] Detected Foundry VTT version: ${version}`);

  if (version === 14) return new V14SetupAdapter();
  return new V13SetupAdapter();
}

/**
 * Detects the Foundry VTT version and returns the appropriate game adapter.
 * @param page The Playwright Page object.
 */
export async function getGameAdapter(page: Page): Promise<GameAdapter> {
  const version = await page.evaluate(() => {
    const v = window.game?.version || window.game?.release?.generation;
    if (v) {
      if (String(v).startsWith("14")) return 14;
      if (String(v).startsWith("13")) return 13;
    }
    return 13;
  });

  if (version === 14) return new V14GameAdapter();
  return new V13GameAdapter();
}

export * from "./base.js";
export * from "./v13.js";
export * from "./v14.js";
