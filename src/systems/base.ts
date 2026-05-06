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
}
