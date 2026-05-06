import { Page, expect } from "@playwright/test";
import { DefaultUIAdapter } from "./base.js";

/**
 * UI adapter for the Tidy 5e Sheets module.
 */
export class Tidy5eUIAdapter extends DefaultUIAdapter {
  id = "tidy5e-sheet";

  override getActorSheetSelector(): string {
    return ".tidy5e-sheet.actor, .tidy5e-sheet.group";
  }

  override async switchAppTab(page: Page, appSelector: string, tabName: string): Promise<void> {
    const app = page.locator(appSelector);
    // Tidy5e might use different navigation or tab structures, especially for Group actors
    const tabItem = app
      .locator(".tidy-tabs [data-tab], nav.tabs a.item, .navigation .item")
      .filter({ hasText: tabName })
      .first();
    await tabItem.evaluate((el) => (el as HTMLElement).click());
    // In Tidy5e, the active state might be checked differently, but usually it's still a class
    await expect(tabItem).toHaveClass(/active|selected/);
  }
}
