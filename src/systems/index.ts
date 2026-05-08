import { Page } from "@playwright/test";
import { SystemAdapter } from "./base.js";
import { DnD5eAdapter } from "./dnd5e.js";
import { PF2eAdapter } from "./pf2e.js";

const adapters: Record<string, SystemAdapter[]> = {
  dnd5e: [new DnD5eAdapter()],
  pf2e: [new PF2eAdapter()],
};

/**
 * Gets a system adapter by its ID, selecting the best match for the current system version.
 * @param page The Playwright Page object.
 * @param id The system ID (e.g., "dnd5e").
 * @returns The system adapter, or the default dnd5e adapter if not found.
 */
export async function getSystemAdapter(page: Page, id: string): Promise<SystemAdapter> {
  const version = await page.evaluate(() => window.game.system.version);
  const systemAdapters = adapters[id] || adapters["dnd5e"];

  // Find the first compatible adapter (order matters in the array)
  const adapter = systemAdapters.find((a) => a.isCompatible(version));
  return adapter || systemAdapters[0];
}

/**
 * Registers a new system adapter.
 * @param adapter The adapter to register.
 */
export function registerSystemAdapter(adapter: SystemAdapter) {
  if (!adapters[adapter.id]) adapters[adapter.id] = [];
  adapters[adapter.id].unshift(adapter); // Add to beginning so it takes priority
}

export * from "./base.js";
export * from "./dnd5e.js";
export * from "./pf2e.js";
