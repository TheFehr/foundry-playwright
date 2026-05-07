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
        const actor = window.game.actors.getName(actorName);
        if (!actor) throw new Error(`Actor ${actorName} not found.`);

        const current = (actor.system.currency[currency] as number) || 0;
        return actor.update({
          [`system.currency.${currency}`]: current + amount,
        });
      },
      { actorName, amount, currency },
    );
  }

  async manageGroupMembers(
    page: Page,
    groupName: string,
    memberNames: string[],
    action: "add" | "remove",
  ): Promise<void> {
    await page.evaluate(
      async ({ groupName, memberNames, action }) => {
        const group = window.game.actors.getName(groupName);
        if (!group) throw new Error(`Group ${groupName} not found.`);
        if (group.type !== "group") throw new Error(`Actor ${groupName} is not a group.`);

        const members = memberNames
          .map((n) => window.game.actors.getName(n))
          .filter((a): a is Actor => !!a);

        if (action === "add") {
          // Check for system-specific methods if they exist on the group actor
          const groupAny = group as any;
          if (groupAny.addMember) {
            for (const member of members) await groupAny.addMember(member);
          } else {
            const currentMembers = new Set(group.system.members.map((m: any) => m.actor.id));
            for (const member of members) currentMembers.add(member.id);
            await group.update({
              "system.members": Array.from(currentMembers).map((id) => ({ actor: { id } })),
            });
          }
        } else {
          const groupAny = group as any;
          if (groupAny.removeMember) {
            for (const member of members) await groupAny.removeMember(member);
          } else {
            const currentMembers = group.system.members.filter(
              (m: any) => !memberNames.includes(window.game.actors.get(m.actor.id)?.name || ""),
            );
            await group.update({ "system.members": currentMembers });
          }
        }
      },
      { groupName, memberNames, action },
    );
  }
}
