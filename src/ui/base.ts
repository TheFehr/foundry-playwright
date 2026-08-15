import { Page } from "@playwright/test";

/**
 * Interface for UI-specific logic and selectors in Foundry VTT.
 *
 * `UIAdapter` is shaped specifically for actor-sheet-like UIs: an
 * application selector, tabs, and collapsible sections. It's the right
 * fit for adapting to different sheet modules (Tidy5e, the default
 * dnd5e sheet, etc.) via {@link registerUIAdapter}.
 *
 * It is *not* a general-purpose "module UI" abstraction. A module whose
 * UI doesn't look like an actor sheet (e.g. a HUD, a control bar, a
 * custom fullscreen layout) usually doesn't fit this shape — reach for
 * a plain exported selector-constants object in the consuming test
 * suite instead of forcing that UI through `getActorSheetSelector`/
 * `switchAppTab`/`handleCollapsibleSection`. Only implement `UIAdapter`
 * for the parts of a module's UI that genuinely are an actor sheet
 * variant (e.g. an actor sheet rendered inside a custom wrapper).
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

  /**
   * Expands a collapsible section if it is currently collapsed.
   * @param page The Playwright Page object.
   * @param appSelector The selector for the application window.
   * @param sectionName The name/label of the section.
   */
  handleCollapsibleSection(page: Page, appSelector: string, sectionName: string): Promise<void>;
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

  async handleCollapsibleSection(
    page: Page,
    appSelector: string,
    sectionName: string,
  ): Promise<void> {
    const app = page.locator(appSelector);
    const section = app.locator(".form-group, .section, details").filter({ hasText: sectionName });

    // Core Foundry doesn't have many collapsible sections by default,
    // but we'll check for 'details' or custom classes
    const details = section.locator("details").first();
    if ((await details.count()) > 0) {
      const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
      if (!isOpen) await details.locator("summary").click();
    }
  }
}
