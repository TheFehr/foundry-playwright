import { FoundryPage } from "../types/index.js";
import { BaseSystemStateAdapter } from "./base.js";
import { getGameAdapter } from "../setup/index.js";

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
  ): Promise<unknown> {
    const actorId = await page.evaluate((actorName) => {
      const actor = (window as unknown as Window).game.actors.getName(actorName);
      if (!actor) throw new Error(`Actor not found: ${actorName}`);
      return actor.id;
    }, actorName);

    // Create the treasure item via the version-adapted GameAdapter seam
    // rather than a bespoke actor.createEmbeddedDocuments call - this is
    // core Document Data Model behavior (embedding an Item on an Actor),
    // not PF2e-specific, so it goes through the same seam any other
    // embedded-document creation does (see FoundryState.createEmbeddedDocuments).
    const adapter = await getGameAdapter(page);
    const [newItem] = (await adapter.createEmbeddedDocuments(
      page,
      "Actor",
      actorId,
      "Item",
      [
        {
          name: `${currency.toUpperCase()} Coins`,
          type: "treasure",
          system: {
            denomination: currency,
            quantity: amount,
          },
        },
      ],
      {},
    )) as { id: string }[];

    // Definitively log to the verification registry
    await page.evaluate(
      ({ actorName, amount, currency, itemId }) => {
        // @ts-ignore
        if (window.FP_VERIFY) {
          window.FP_VERIFY.log("pf2e-currency-added", { actorName, amount, currency, itemId });
        }
      },
      { actorName, amount, currency, itemId: newItem?.id },
    );

    return newItem;
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

  // pf2e 8.5.0 made item-type validation throw instead of silently no-op,
  // surfacing that "loot" (the base default in BaseSystemStateAdapter) has
  // never actually been a valid inventory item type for a "character"
  // actor in pf2e - only for the system's dedicated Loot-actor sheet.
  // "equipment" is pf2e's own generic miscellaneous-gear physical item
  // type, valid on any creature actor. Confirmed live against pf2e 8.5.0 /
  // FVTT 14.367: "loot" fails with "Loot items cannot be added to this
  // actor."; grantCurrency above already proves "treasure" works the same
  // way for the same reason.
  override getTestItemData(_name: string) {
    return { type: "equipment", system: {} };
  }

  override getCurrencyVerifyParams(
    actorName: string,
    amount: number,
    currency: string,
  ): {
    key: string;
    predicate: (data: Record<string, unknown>, extra?: Record<string, unknown>) => boolean;
  } {
    return {
      key: "pf2e-currency-added",
      predicate: (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
        return (
          data["actorName"] === extra["actorName"] &&
          data["currency"] === extra["currency"] &&
          data["amount"] === extra["amount"]
        );
      },
    };
  }
}
