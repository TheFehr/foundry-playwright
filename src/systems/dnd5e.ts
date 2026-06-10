import { FoundryPage } from "../types/index.js";
import { BaseSystemStateAdapter } from "./base.js";

/**
 * State adapter for the D&D 5th Edition system.
 */
export class DnD5eStateAdapter extends BaseSystemStateAdapter {
  readonly id = "dnd5e";

  constructor(page?: FoundryPage) {
    super(page);
    if (page?.deprecationTracker) {
      // Ignore dnd5e-internal deprecation shims (e.g. ActorSheetMixin in dnd5e 5.1.x).
      // These are emitted by dnd5e's own backwards-compat layer, not by Foundry itself.
      page.deprecationTracker.registerIgnore(["ActorSheetMixin", "BaseActorSheet"]);
    }
  }

  override getTestActorData(_name: string) {
    return {
      type: "character",
      system: {
        attributes: {
          hp: { value: 10, max: 10 },
        },
      },
    };
  }
}
