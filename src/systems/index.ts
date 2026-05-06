import { SystemAdapter } from "./base.js";
import { DnD5eAdapter } from "./dnd5e.js";
import { PF2eAdapter } from "./pf2e.js";

const adapters: Record<string, SystemAdapter> = {
  dnd5e: new DnD5eAdapter(),
  pf2e: new PF2eAdapter(),
};

/**
 * Gets a system adapter by its ID.
 * @param id The system ID (e.g., "dnd5e").
 * @returns The system adapter, or the default dnd5e adapter if not found.
 */
export function getSystemAdapter(id: string): SystemAdapter {
  return adapters[id] || adapters["dnd5e"];
}

/**
 * Registers a new system adapter.
 * @param adapter The adapter to register.
 */
export function registerSystemAdapter(adapter: SystemAdapter) {
  adapters[adapter.id] = adapter;
}

export * from "./base.js";
export * from "./dnd5e.js";
export * from "./pf2e.js";
