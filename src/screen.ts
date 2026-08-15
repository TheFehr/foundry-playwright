import { Page } from "@playwright/test";

/**
 * Playwright's `viewport` context option controls `window.innerWidth`/
 * `innerHeight` — the browser's content area. It does **not** control
 * `window.screen.width`/`height` (the physical display), which some
 * modules read instead for responsive/mobile detection. Playwright
 * exposes `screen` as a separate context option specifically to let the
 * two diverge:
 *
 * ```ts
 * test.use({
 *   viewport: { width: 1024, height: 768 },
 *   screen: { width: 390, height: 844 },
 * });
 * ```
 *
 * `withScreenSize` builds that options object consistently. If a module
 * under test genuinely reads `screen.width` for a mobile threshold, pass
 * a `screen` size below the threshold and a `viewport` sized for however
 * much of the page you actually want rendered — they don't need to match.
 */
export function withScreenSize(
  screen: { width: number; height: number },
  viewport: { width: number; height: number } = screen,
): { viewport: { width: number; height: number }; screen: { width: number; height: number } } {
  return { viewport, screen };
}

/**
 * Overrides `window.screen.width`/`height` on an already-created page via
 * CDP `Emulation.setDeviceMetricsOverride`. Chromium only.
 *
 * Use this when the `screen` context option isn't available — it can
 * only be set at context-creation time (e.g. via `test.use()`), so it
 * can't change the screen size of a page/context that already exists.
 * Prefer the `screen` context option / {@link withScreenSize} when
 * you're able to set it before the page navigates; reach for this only
 * for genuinely mid-test changes (e.g. simulating a device rotation or
 * an orientation change within a single test).
 *
 * `Emulation.setDeviceMetricsOverride` replaces the page's *entire*
 * device metrics state, not just screen size — so this always sets
 * `deviceScaleFactor`/`mobile` too. Playwright exposes no API to read a
 * page's current values back, so there's nothing to preserve them from;
 * pass `deviceScaleFactor`/`mobile` explicitly if the page needs
 * anything other than the defaults (`1`/`false`). Similarly, if the
 * page's context was created with `viewport: null`, `page.viewportSize()`
 * returns `null` — pass `viewport` explicitly in that case, since there's
 * no existing viewport size to fall back to.
 */
export async function setScreenSize(
  page: Page,
  size: { width: number; height: number },
  options: {
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
    mobile?: boolean;
  } = {},
): Promise<void> {
  const { deviceScaleFactor = 1, mobile = false } = options;
  const targetViewport = options.viewport ?? page.viewportSize();
  if (!targetViewport) {
    throw new Error(
      "setScreenSize: page has no viewport (its context was likely created with " +
        "`viewport: null`). Pass `{ viewport: { width, height } }` explicitly — " +
        "falling back to the screen size would silently change layout dimensions.",
    );
  }

  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: targetViewport.width,
      height: targetViewport.height,
      deviceScaleFactor,
      mobile,
      screenWidth: size.width,
      screenHeight: size.height,
    });
  } finally {
    // Ignore detach failures — the target (e.g. the page/tab) may have
    // already closed, which detaches the session as a side effect.
    await client.detach().catch(() => {});
  }
}
