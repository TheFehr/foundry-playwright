import { Page } from "@playwright/test";
import { SetupAdapter } from "./base.js";
import { V13SetupAdapter } from "./v13.js";
import { V14SetupAdapter } from "./v14.js";

/**
 * Detects the Foundry VTT version and returns the appropriate setup adapter.
 * @param page The Playwright Page object.
 */
export async function getSetupAdapter(page: Page): Promise<SetupAdapter> {
  // Sniff version from game object or DOM
  const version = await page.evaluate(() => {
    // 1. Definitive source: game.version (in game)
    // @ts-ignore
    const v = (window as any).game?.version;
    if (v) {
        if (v.startsWith('14')) return 14;
        if (v.startsWith('13')) return 13;
    }

    // 2. Sniff from DOM (on setup screen)
    const isV14 = 
        document.querySelector('foundry-app') !== null || 
        document.querySelector('script[src*="foundry.mjs"][type="module"]') !== null || // V14 uses ES modules more extensively
        document.body.classList.contains('v14') ||
        // Check for V14-specific CSS variables or structures
        getComputedStyle(document.documentElement).getPropertyValue('--foundry-app-width') !== ""; 
    
    if (isV14) return 14;
    
    // Default to 13
    return 13;
  });

  console.log(`[getSetupAdapter] Detected Foundry VTT version: ${version}`);
  
  if (version === 14) return new V14SetupAdapter();
  return new V13SetupAdapter();
}

export * from "./base.js";
export * from "./v13.js";
export * from "./v14.js";
