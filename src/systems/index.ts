import { FoundryPage } from "../types/index.js";
import { SystemStateAdapter } from "./base.js";
import { DnD5eStateAdapter } from "./dnd5e.js";
import { PF2eStateAdapter } from "./pf2e.js";

/**
 * Gets a system state adapter by its ID.
 */
export function getSystemStateAdapter(id: string, page?: FoundryPage): SystemStateAdapter {
  if (id === "pf2e") return new PF2eStateAdapter(page);
  return new DnD5eStateAdapter(page);
}

/**
 * Initializes all known system adapters to register their deprecation patterns.
 */
export function initAllSystems(page: FoundryPage) {
  new DnD5eStateAdapter(page);
  new PF2eStateAdapter(page);
}

export * from "./base.js";
export * from "./dnd5e.js";
export * from "./pf2e.js";
