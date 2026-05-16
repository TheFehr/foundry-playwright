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
      page.deprecationTracker.registerFailure(["has moved to", "senses", "dnd5e"]);
    }
  }

  override getTestActorData(_name: string) {
    return {
      type: "character",
      system: {
        details: {
          senses: {
            ranges: {
              darkvision: 60,
            },
          },
        },
        attributes: {
          hp: { value: 10, max: 10 },
        },
      },
    };
  }
}
