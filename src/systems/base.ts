import { Page } from "@playwright/test";

/**
 * Interface for system-specific logic in Foundry VTT.
 */
export interface SystemAdapter {
  /** The unique ID of the game system (e.g., "dnd5e", "pf2e"). */
  id: string;

  /**
   * Returns the path to the HP value in the actor's system data.
   */
  getHPPath(): string;

  /**
   * Grants currency to an actor.
   * @param page The Playwright Page object.
   * @param actorName The name of the actor.
   * @param amount The amount of currency to grant.
   * @param currency The type of currency (e.g., "gp", "sp").
   */
  grantCurrency(page: Page, actorName: string, amount: number, currency?: string): Promise<void>;

  /**
   * Adds or removes members from a group actor.
   * @param page The Playwright Page object.
   * @param groupName The name of the group actor.
   * @param memberNames The names of the members to add/remove.
   * @param action Whether to "add" or "remove".
   */
  manageGroupMembers(
    page: Page,
    groupName: string,
    memberNames: string[],
    action: "add" | "remove",
  ): Promise<void>;
}

/**
 * Base class for system adapters with default implementations where possible.
 */
export abstract class BaseSystemAdapter implements SystemAdapter {
  abstract id: string;
  abstract getHPPath(): string;
  abstract grantCurrency(
    page: Page,
    actorName: string,
    amount: number,
    currency?: string,
  ): Promise<void>;

  abstract manageGroupMembers(
    page: Page,
    groupName: string,
    memberNames: string[],
    action: "add" | "remove",
  ): Promise<void>;
}
