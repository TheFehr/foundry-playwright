import { FoundryPage } from "../types/index.js";
import { SystemStateAdapter } from "./base.js";
import { DnD5eStateAdapter } from "./dnd5e.js";
import { PF2eStateAdapter } from "./pf2e.js";

type SystemStateAdapterFactory = (page?: FoundryPage) => SystemStateAdapter;

const adapterFactories = new Map<string, SystemStateAdapterFactory>([
  ["dnd5e", (page) => new DnD5eStateAdapter(page)],
  ["pf2e", (page) => new PF2eStateAdapter(page)],
]);

/**
 * Registers a `SystemStateAdapter` factory for a system ID, so
 * {@link getSystemStateAdapter} can resolve it. Mirrors the
 * `registerUIAdapter` pattern in `src/ui/index.ts`.
 *
 * Use this to add support for a system that doesn't have first-class
 * `dnd5e`/`pf2e`-level support in this library, instead of relying on
 * (or working around) the dnd5e-shaped defaults.
 */
export function registerSystemStateAdapter(id: string, factory: SystemStateAdapterFactory) {
  adapterFactories.set(id, factory);
}

/**
 * Gets a system state adapter by its ID.
 *
 * Throws for unregistered system IDs rather than silently falling back
 * to the dnd5e adapter — using dnd5e-shaped test data (currency paths,
 * HP paths, actor type) against a system with a different data schema
 * produces actors/updates that are silently wrong, not just untested.
 * Register an adapter for the system first via
 * {@link registerSystemStateAdapter}, or use `dnd5e`/`pf2e` directly.
 */
export function getSystemStateAdapter(id: string, page?: FoundryPage): SystemStateAdapter {
  const factory = adapterFactories.get(id);
  if (!factory) {
    const known = [...adapterFactories.keys()].join(", ");
    throw new Error(
      `No SystemStateAdapter registered for system "${id}". ` +
        `Known systems: ${known}. Register one with registerSystemStateAdapter("${id}", (page) => new YourAdapter(page)) ` +
        `before using currency/HP/test-actor helpers against this system.`,
    );
  }
  return factory(page);
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
