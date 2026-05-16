import { FoundryPage } from "../types/index.js";
import { BaseSystemStateAdapter } from "./base.js";

/**
 * State adapter for the Pathfinder 2nd Edition system.
 */
export class PF2eStateAdapter extends BaseSystemStateAdapter {
  readonly id = "pf2e";

  constructor(page?: FoundryPage) {
    super(page);
    if (page?.deprecationTracker) {
      page.deprecationTracker.registerIgnore(["template.json is deprecated"]);
    }
  }

  override async grantCurrency(
    page: FoundryPage,
    actorName: string,
    amount: number,
    currency: string,
  ): Promise<any> {
    return page.evaluate(
      async ({ actorName, amount, currency }) => {
        const actor = window.game.actors.getName(actorName);
        if (!actor) throw new Error(`Actor not found: ${actorName}`);

        // Create the treasure item
        const [newItem] = await actor.createEmbeddedDocuments("Item", [
          {
            name: `${currency.toUpperCase()} Coins`,
            type: "treasure",
            system: {
              denomination: currency,
              quantity: amount,
            },
          },
        ]);

        // Definitively log to the verification registry
        // @ts-ignore
        if (window.FP_VERIFY) {
          window.FP_VERIFY.log("pf2e-currency-added", {
            actorName,
            amount,
            currency,
            itemId: newItem.id,
          });
        }

        return newItem;
      },
      { actorName, amount, currency },
    );
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

  override getCurrencyVerifyParams(
    actorName: string,
    amount: number,
    currency: string,
  ): { key: string; predicate: (data: any, extra?: any) => boolean } {
    return {
      key: "pf2e-currency-added",
      predicate: (data: any, extra: any) => {
        return (
          data.actorName === extra.actorName &&
          data.currency === extra.currency &&
          data.amount === extra.amount
        );
      },
    };
  }
}
