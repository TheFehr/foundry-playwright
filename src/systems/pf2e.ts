import { Page } from "@playwright/test";
import { BaseSystemAdapter } from "./base.js";

/**
 * System adapter for Pathfinder 2nd Edition.
 */
export class PF2eAdapter extends BaseSystemAdapter {
  id = "pf2e";

  getHPPath(): string {
    return "system.attributes.hp.value";
  }

  async grantCurrency(
    page: Page,
    actorName: string,
    amount: number,
    currency: string = "gp",
  ): Promise<void> {
    await page.evaluate(
      ({ actorName, amount, currency }) => {
        const actor = window.game.actors.getName(actorName);
        if (!actor) throw new Error(`Actor ${actorName} not found.`);

        // PF2e currency logic might be more complex (inventory items),
        // but for this POC we'll assume a simplified system data update
        const current = (actor as any).system.currency?.[currency] || 0;
        return actor.update({
          [`system.currency.${currency}`]: current + amount,
        });
      },
      { actorName, amount, currency },
    );
  }

  async manageGroupMembers(
    _page: Page,
    _groupName: string,
    _memberNames: string[],
    _action: "add" | "remove",
  ): Promise<void> {
    // PF2e group logic implementation here
    console.warn("manageGroupMembers not yet fully implemented for PF2e");
  }
}
