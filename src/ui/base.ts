import { Page } from "@playwright/test";

/**
 * Interface for UI-specific logic and selectors in Foundry VTT.
 */
export interface UIAdapter {
  /** The unique ID of the module or system this adapter is for. */
  id: string;

  /**
   * Returns a selector for an actor sheet.
   */
  getActorSheetSelector(): string;

  /**
   * Switches to a specific tab on an application (e.g., Actor sheet).
   * @param page The Playwright Page object.
   * @param appSelector The selector for the application window.
   * @param tabName The name of the tab to switch to.
   */
  switchAppTab(page: Page, appSelector: string, tabName: string): Promise<void>;
}

/**
 * Default UI adapter for standard Foundry VTT interface.
 */
export class DefaultUIAdapter implements UIAdapter {
  id = "default";

  getActorSheetSelector(): string {
    return ".window-app.sheet.actor";
  }

  async switchAppTab(page: Page, appSelector: string, tabName: string): Promise<void> {
    const app = page.locator(appSelector);

    // Support for both V1 (nav.tabs a.item) and V2 (nav.tabs [data-tab])
    const tabSelectors = [
      `nav.tabs [data-tab]:has-text("${tabName}")`,
      `nav.tabs [data-action="tab"]:has-text("${tabName}")`,
      `nav.tabs a.item:has-text("${tabName}")`,
      `[data-tab]:has-text("${tabName}")`,
    ];

    let clicked = false;
    for (const selector of tabSelectors) {
      const candidate = app.locator(selector).first();
      if ((await candidate.count()) > 0 && (await candidate.isVisible())) {
        await candidate.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      throw new Error(`Could not find tab "${tabName}" in application ${appSelector}`);
    }
  }
}
