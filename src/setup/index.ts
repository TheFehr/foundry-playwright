import { FoundryPage } from "../types/index.js";
import { SetupAdapter, GameAdapter } from "./base.js";
import { V13SetupAdapter, V13GameAdapter } from "./v13.js";
import {
  V14SetupAdapter,
  V14LegacySetupAdapter,
  V14GameAdapter,
  V14_USERNAME_LOGIN_BUILD,
} from "./v14.js";

type DetectedVersion = { major: 13 | 14; build?: number } | null;

/**
 * Extracts the Foundry build number from a version string, e.g. "14.366" or
 * "14.360.0" both yield 366/360. Returns undefined for strings with no
 * parseable minor component (e.g. a bare "14").
 */
export function parseFoundryBuild(version: string): number | undefined {
  const build = Number(version.split(".")[1]);
  return Number.isFinite(build) ? build : undefined;
}

/**
 * Checks a version string's major component exactly, e.g. "14.366" and "14"
 * match major "14" but "140.1" does not - a plain startsWith("14") would
 * wrongly match "140.1" too.
 */
export function matchesMajorVersion(version: string, major: "13" | "14"): boolean {
  return version.split(".", 1)[0] === major;
}

/**
 * Selects the Foundry V14 setup adapter for the specified build.
 *
 * @param build - The numeric Foundry V14 build used to choose the login form.
 * @returns The legacy adapter for builds below the username-login threshold; otherwise, the current V14 adapter.
 * @throws Error if the build number is unknown.
 */
export function selectV14SetupAdapter(page: FoundryPage, build: number | undefined): SetupAdapter {
  if (build === undefined) {
    throw new Error(
      "[getSetupAdapter] Detected Foundry V14 but could not determine its build number, " +
        "so the correct join-form login adapter can't be selected. Pass an explicit " +
        `version with a build (e.g. "14.366") via versionOverride or FOUNDRY_VERSION.`,
    );
  }
  if (build < V14_USERNAME_LOGIN_BUILD) return new V14LegacySetupAdapter(page);
  return new V14SetupAdapter(page);
}

/**
 * Best-effort read of game.release.build off the already-loaded page, for
 * callers (a bare "14" override) that named the major version but not the
 * build. Never throws - returns undefined if the page hasn't populated
 * `game` yet, letting the caller's own fallback handle that.
 */
async function probeV14Build(page: FoundryPage): Promise<number | undefined> {
  return page
    .evaluate(() => (window as unknown as Window).game?.release?.build)
    .catch(() => undefined);
}

/**
 * Detects the Foundry VTT version and selects the corresponding setup adapter.
 *
 * @param page - The page used for version detection and adapter initialization
 * @param versionOverride - Optional Foundry version to use before environment or page detection
 * @returns The setup adapter for the detected or specified Foundry version
 */
export async function getSetupAdapter(
  page: FoundryPage,
  versionOverride?: string,
): Promise<SetupAdapter> {
  // 1. Prioritize explicit input
  const explicitVersion = versionOverride || process.env.FOUNDRY_VERSION;
  if (explicitVersion) {
    const v = explicitVersion;
    if (matchesMajorVersion(v, "14")) {
      // A bare "14" (documented as valid, e.g. FOUNDRY_VERSION="14") carries
      // no build - probe the already-loaded page for it before falling
      // through to selectV14SetupAdapter's throw.
      const build = parseFoundryBuild(v) ?? (await probeV14Build(page));
      return selectV14SetupAdapter(page, build);
    }
    if (matchesMajorVersion(v, "13")) return new V13SetupAdapter(page);
    console.warn(
      `[getSetupAdapter] Explicit version "${v}" provided but not explicitly supported. Falling back to detection.`,
    );
  }

  console.log("[getSetupAdapter] Detecting Foundry version...");

  // Wait for definitive detection
  const detectedVersion: DetectedVersion = await page
    .waitForFunction(
      () => {
        // 1. Check for Version String (Most reliable if available)
        const v =
          (window as unknown as Window).game?.version ||
          (window as unknown as Window).game?.release?.generation ||
          (window as unknown as Window).foundry?.utils?.vttVersion;
        if (v) {
          const vs = String(v);
          if (vs.split(".", 1)[0] === "14") {
            // game.release.build is the exact build number straight from
            // Foundry itself, when available - prefer it over parsing vs.
            const releaseBuild = (window as unknown as Window).game?.release?.build;
            const build =
              typeof releaseBuild === "number" ? releaseBuild : Number(vs.split(".")[1]);
            if (Number.isFinite(build)) return { major: 14 as const, build };
            // Major confirmed but no build resolvable from this tick yet
            // (e.g. game.release hasn't populated alongside vttVersion) -
            // keep polling rather than selecting an adapter with an
            // undetermined build. The timeout fallback below still covers
            // the case where a build genuinely never arrives.
            return null;
          }
          if (vs.split(".", 1)[0] === "13") return { major: 13 as const };
        }

        // 2. Check for V14 definitive markers (ApplicationV2 shell)
        const isV14 =
          (window as unknown as Window).foundry?.applications?.api?.ApplicationV2 !== undefined ||
          document.querySelector("foundry-app") !== null ||
          document.body.classList.contains("v14");

        if (isV14) {
          // Confirmed V14 via markers, but the version-string check above
          // didn't resolve a build yet - keep waiting for it instead of
          // selecting an adapter blind (see the build-check above).
          return null;
        }

        // 3. Check for V13 definitive markers
        // V13 uses traditional body classes and does NOT have foundry-app
        const isV13 =
          (document.body.classList.contains("setup") ||
            document.body.classList.contains("join") ||
            document.body.classList.contains("game")) &&
          document.querySelector("foundry-app") === null;

        if (isV13) return { major: 13 as const };

        // 4. Script-based fallback (V12- used foundry.js, V13+ uses foundry.mjs)
        const scripts = Array.from(document.querySelectorAll("script")).map((s) => s.src);
        if (scripts.some((s) => s.includes("foundry.mjs"))) {
          // If it's foundry.mjs but didn't match V14 markers yet, it might be V13
          // or V14 hasn't fully loaded its shell. We wait.
          return null;
        }
        if (scripts.some((s) => s.includes("scripts/foundry.js"))) return { major: 13 as const }; // V12/V13 early? Actually V13 is mjs.

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
          foundry: !!(window as unknown as Window).foundry,
          vttVersion: (window as unknown as Window).foundry?.utils?.vttVersion,
          scripts: Array.from(document.querySelectorAll("script")).map((s) => s.src),
        };
      });
      console.warn(
        `[getSetupAdapter] Detection timed out at ${diag.url}. Diag: ${JSON.stringify(diag)}`,
      );

      // Fallback logic in catch block. This runs once, not in a polling
      // loop like the predicate above, so any branch concluding V14 makes
      // one last direct probeV14Build() attempt before conceding an
      // undetermined build - by 30+ seconds in, it's very likely to
      // succeed, and selectV14SetupAdapter throws on anything that doesn't.
      if (diag.vttVersion) {
        const vs = String(diag.vttVersion);
        if (vs.split(".", 1)[0] === "14") {
          const build = parseFoundryBuild(vs) ?? (await probeV14Build(page));
          return { major: 14 as const, build };
        }
        if (vs.split(".", 1)[0] === "13") return { major: 13 as const };
      }

      if (diag.url.includes("/players") || diag.url.includes("/create")) {
        return { major: 14 as const, build: await probeV14Build(page) };
      }
      if (diag.scripts.some((s) => s.includes("foundry.mjs"))) {
        // If we are here, we timed out. Check the same V14 markers as the
        // main polling predicate above, not just foundry-app - ApplicationV2
        // or the "v14" body class alone would otherwise be missed here and
        // misclassified as V13.
        const hasV14Markers = await page.evaluate(
          () =>
            (window as unknown as Window).foundry?.applications?.api?.ApplicationV2 !== undefined ||
            document.querySelector("foundry-app") !== null ||
            document.body.classList.contains("v14"),
        );
        if (hasV14Markers) return { major: 14 as const, build: await probeV14Build(page) };
        return { major: 13 as const };
      }
      return { major: 13 as const }; // Default to 13
    });

  if (detectedVersion?.major === 14) return selectV14SetupAdapter(page, detectedVersion.build);
  return new V13SetupAdapter(page);
}

/**
 * Selects the game adapter for the detected Foundry VTT major version.
 *
 * @param versionOverride - Optional Foundry version to use instead of page detection.
 * @returns A V13 or V14 game adapter; defaults to the V13 adapter when detection fails.
 */
export async function getGameAdapter(
  page: FoundryPage,
  versionOverride?: string,
): Promise<GameAdapter> {
  // 1. Prioritize explicit input
  const explicitVersion = versionOverride || process.env.FOUNDRY_VERSION;
  if (explicitVersion) {
    const v = explicitVersion;
    if (matchesMajorVersion(v, "14")) return new V14GameAdapter(page);
    if (matchesMajorVersion(v, "13")) return new V13GameAdapter(page);
  }

  const version = await page
    .waitForFunction(
      () => {
        const v =
          (window as unknown as Window).game?.version ||
          (window as unknown as Window).game?.release?.generation ||
          (window as unknown as Window).foundry?.utils?.vttVersion;
        if (v) {
          if (String(v).split(".", 1)[0] === "14") return 14;
          if (String(v).split(".", 1)[0] === "13") return 13;
        }
        if ((window as unknown as Window).foundry?.applications?.api?.ApplicationV2 !== undefined)
          return 14;
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
