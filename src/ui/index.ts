import { Page } from "@playwright/test";
import { UIAdapter, DefaultUIAdapter } from "./base.js";
import { Tidy5eUIAdapter } from "./tidy5e.js";
import { DnD5eUIAdapter } from "./dnd5e.js";

const adapters: Record<string, UIAdapter> = {
  default: new DefaultUIAdapter(),
  "tidy5e-sheet": new Tidy5eUIAdapter(),
  dnd5e: new DnD5eUIAdapter(),
};

/**
 * Gets a UI adapter by its ID.
 */
export function getUIAdapter(id: string): UIAdapter {
  return adapters[id] || adapters["default"];
}

/**
 * Registers a new UI adapter.
 */
export function registerUIAdapter(adapter: UIAdapter) {
  adapters[adapter.id] = adapter;
}

/**
 * Provides methods for interacting with the Foundry VTT UI.
 */
export class FoundryUI {
  private adapter: UIAdapter;

  constructor(
    private page: Page,
    adapterId: string = "default",
  ) {
    this.adapter = getUIAdapter(adapterId);
  }

  /**
   * Sets the UI adapter to use.
   */
  setAdapter(adapterId: string) {
    this.adapter = getUIAdapter(adapterId);
  }

  /**
   * Gets the CSS selector for actor sheets.
   */
  getActorSheetSelector(): string {
    return this.adapter.getActorSheetSelector();
  }

  /**
   * Switches to a specific tab on an application.
   */
  async switchTab(appSelector: string, tabName: string) {
    await this.adapter.switchAppTab(this.page, appSelector, tabName);
  }

  /**
   * Switches to a specific tab on an actor sheet.
   */
  async switchActorTab(actorName: string, tabName: string) {
    const selector = `${this.adapter.getActorSheetSelector()}:has-text("${actorName}")`;
    await this.switchTab(selector, tabName);
  }

  /**
   * Expands a collapsible section if it is currently collapsed.
   */
  async handleCollapsibleSection(appSelector: string, sectionName: string) {
    await this.adapter.handleCollapsibleSection(this.page, appSelector, sectionName);
  }
}

export * from "./base.js";
export * from "./tidy5e.js";
export * from "./dnd5e.js";
