import { FoundryPage } from "../types/index.js";
import { SetupAdapter, GameAdapter } from "./base.js";
import { V13SetupAdapter, V13GameAdapter } from "./v13.js";
import { V14SetupAdapter, V14GameAdapter } from "./v14.js";

/**
 * Detects the Foundry VTT version and returns the appropriate setup adapter.
 * Prioritizes explicit version input from parameters or environment variables.
 */
export async function getSetupAdapter(
  page: FoundryPage,
  versionOverride?: string | number,
): Promise<SetupAdapter> {
  // 1. Prioritize explicit input
  const explicitVersion = versionOverride || process.env.FOUNDRY_VERSION;
  if (explicitVersion) {
    const v = String(explicitVersion);
    if (v.startsWith("14")) return new V14SetupAdapter(page);
    if (v.startsWith("13")) return new V13SetupAdapter(page);
    console.warn(
      `[getSetupAdapter] Explicit version "${v}" provided but not explicitly supported. Falling back to detection.`,
    );
  }

  console.log("[getSetupAdapter] Detecting Foundry version...");

  // Wait for definitive detection
  const detectedVersion = await page
    .waitForFunction(
      () => {
        // 1. Check for Version String (Most reliable if available)
        const v =
          (window as any).game?.version ||
          (window as any).game?.release?.generation ||
          (window as any).foundry?.utils?.vttVersion;
        if (v) {
          const vs = String(v);
          if (vs.startsWith("14")) return 14;
          if (vs.startsWith("13")) return 13;
        }

        // 2. Check for V14 definitive markers (ApplicationV2 shell)
        const isV14 =
          (window as any).foundry?.applications?.api?.ApplicationV2 !== undefined ||
          document.querySelector("foundry-app") !== null ||
          document.body.classList.contains("v14");

        if (isV14) return 14;

        // 3. Check for V13 definitive markers
        // V13 uses traditional body classes and does NOT have foundry-app
        const isV13 =
          (document.body.classList.contains("setup") ||
            document.body.classList.contains("join") ||
            document.body.classList.contains("game")) &&
          document.querySelector("foundry-app") === null;

        if (isV13) return 13;

        // 4. Script-based fallback (V12- used foundry.js, V13+ uses foundry.mjs)
        const scripts = Array.from(document.querySelectorAll("script")).map((s) => s.src);
        if (scripts.some((s) => s.includes("foundry.mjs"))) {
          // If it's foundry.mjs but didn't match V14 markers yet, it might be V13
          // or V14 hasn't fully loaded its shell. We wait.
          return null;
        }
        if (scripts.some((s) => s.includes("scripts/foundry.js"))) return 13; // V12/V13 early? Actually V13 is mjs.

        return null; // Not detectable yet
      },
      {},
      { timeout: 30000 },
    )
    .then((h) => h.jsonValue())
    .catch(async () => {
      const diag = await page.evaluate(() => {
        return {
          url: window.location.href,
          html: document.body.innerHTML.substring(0, 500),
          foundry: !!(window as any).foundry,
          vttVersion: (window as any).foundry?.utils?.vttVersion,
          scripts: Array.from(document.querySelectorAll("script")).map((s) => s.src),
        };
      });
      console.warn(
        `[getSetupAdapter] Detection timed out at ${diag.url}. Diag: ${JSON.stringify(diag)}`,
      );

      // Fallback logic in catch block
      if (diag.vttVersion) {
        if (String(diag.vttVersion).startsWith("14")) return 14;
        if (String(diag.vttVersion).startsWith("13")) return 13;
      }

      if (diag.url.includes("/players") || diag.url.includes("/create")) return 14;
      if (diag.scripts.some((s) => s.includes("foundry.mjs"))) {
        // If we are here, we timed out. If it has foundry.mjs and NO foundry-app, it's likely 13.
        const hasFoundryApp = await page.evaluate(
          () => document.querySelector("foundry-app") !== null,
        );
        return hasFoundryApp ? 14 : 13;
      }
      return 13; // Default to 13
    });

  if (detectedVersion === 14) return new V14SetupAdapter(page);
  return new V13SetupAdapter(page);
}

/**
 * Detects the Foundry VTT version and returns the appropriate game adapter.
 */
export async function getGameAdapter(
  page: FoundryPage,
  versionOverride?: string | number,
): Promise<GameAdapter> {
  // 1. Prioritize explicit input
  const explicitVersion = versionOverride || process.env.FOUNDRY_VERSION;
  if (explicitVersion) {
    const v = String(explicitVersion);
    if (v.startsWith("14")) return new V14GameAdapter(page);
    if (v.startsWith("13")) return new V13GameAdapter(page);
  }

  const version = await page
    .waitForFunction(
      () => {
        const v =
          (window as any).game?.version ||
          (window as any).game?.release?.generation ||
          (window as any).foundry?.utils?.vttVersion;
        if (v) {
          if (String(v).startsWith("14")) return 14;
          if (String(v).startsWith("13")) return 13;
        }
        if ((window as any).foundry?.applications?.api?.ApplicationV2 !== undefined) return 14;
        return null;
      },
      {},
      { timeout: 30000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => 13);

  if (version === 14) return new V14GameAdapter(page);
  return new V13GameAdapter(page);
}

export * from "./base.js";
export * from "./v13.js";
export * from "./v14.js";
