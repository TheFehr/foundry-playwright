import { FoundryPage } from "../types/index.js";

/**
 * Interface for system-specific state manipulation logic.
 */
export interface SystemStateAdapter {
  /** The system ID this adapter handles. */
  readonly id: string;

  /**
   * Grants currency to an actor.
   */
  grantCurrency(
    page: FoundryPage,
    actorName: string,
    amount: number,
    currency: string,
  ): Promise<any>;

  /**
   * Provides the system-specific data structure for a test actor.
   */
  getTestActorData(name: string): { type: string; system: any };

  /**
   * Sets an actor's HP.
   */
  setActorHP(page: FoundryPage, actorName: string, value: number, max?: number): Promise<any>;

  /**
   * Returns the log key and a predicate to verify a currency update in verifyResult.
   */
  getCurrencyVerifyParams(
    actorName: string,
    amount: number,
    currency: string,
  ): { key: string; predicate: (data: any, extra?: any) => boolean };
}

/**
 * Base implementation of SystemStateAdapter with default (often DnD5e-like) logic.
 */
export abstract class BaseSystemStateAdapter implements SystemStateAdapter {
  abstract id: string;

  constructor(protected page?: FoundryPage) {}

  async grantCurrency(
    page: FoundryPage,
    actorName: string,
    amount: number,
    currency: string,
  ): Promise<any> {
    return page.evaluate(
      ({ actorName, amount, currency }) => {
        const actor = window.game.actors.getName(actorName);
        if (!actor) throw new Error(`Actor not found: ${actorName}`);
        const current = (actor.system.currency?.[currency] || 0) + amount;
        return actor.update({ [`system.currency.${currency}`]: current });
      },
      { actorName, amount, currency },
    );
  }

  getTestActorData(_name: string): { type: string; system: any } {
    return {
      type: "character",
      system: {
        attributes: { hp: { value: 10, max: 10 } },
      },
    };
  }

  async setActorHP(
    page: FoundryPage,
    actorName: string,
    value: number,
    max?: number,
  ): Promise<any> {
    return page.evaluate(
      ({ actorName, value, max }) => {
        const actor = window.game.actors.getName(actorName);
        if (!actor) throw new Error(`Actor not found: ${actorName}`);
        const update: any = { "system.attributes.hp.value": value };
        if (max !== undefined) update["system.attributes.hp.max"] = max;
        return actor.update(update);
      },
      { actorName, value, max },
    );
  }

  getCurrencyVerifyParams(
    _actorName: string,
    _amount: number,
    _currency: string,
  ): { key: string; predicate: (data: any, extra?: any) => boolean } {
    return {
      key: "actor-update",
      predicate: (data: any, extra: any) => {
        // Broadly match any update that touches currency for the target actor
        if (data.name !== extra.actorName) return false;

        // Deep check for the expected currency value in the delta
        const delta = data.delta || {};

        // Check for direct property update: "system.currency.gp": 100
        if (delta[`system.currency.${extra.currency}`] === extra.amount) return true;

        // Check for nested update: { system: { currency: { gp: 100 } } }
        const nestedVal = delta.system?.currency?.[extra.currency];
        if (nestedVal === extra.amount) return true;

        return false;
      },
    };
  }
}
