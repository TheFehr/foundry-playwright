import { Page } from "@playwright/test";
import { BaseSystemAdapter } from "./base.js";

/**
 * System adapter for Dungeons & Dragons Fifth Edition.
 */
export class DnD5eAdapter extends BaseSystemAdapter {
  id = "dnd5e";

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
        const actor = (window as any).game.actors.getName(actorName);
        if (!actor) throw new Error(`Actor ${actorName} not found.`);

        const current = actor.system.currency[currency] || 0;
        return actor.update({
          [`system.currency.${currency}`]: current + amount,
        });
      },
      { actorName, amount, currency },
    );
  }
}
