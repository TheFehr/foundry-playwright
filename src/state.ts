import { Page, expect } from "@playwright/test";
import { SystemAdapter, getSystemAdapter } from "./systems/index.js";
import { GameAdapter, getGameAdapter } from "./setup/index.js";

/**
 * Options for creating a document in Foundry VTT.
 */
export interface CreateDocumentOptions {
  /** Optional pack ID (e.g., "world.my-pack") to create the document in a compendium. */
  pack?: string;
  /** Additional options to pass to the Foundry create method. */
  [key: string]: any;
}

/**
 * Foundry VTT User Roles.
 */
export enum UserRole {
  NONE = 0,
  PLAYER = 1,
  TRUSTED = 2,
  ASSISTANT = 3,
  GAMEMASTER = 4,
}

/**
 * Provides methods for direct state manipulation in Foundry VTT via page.evaluate.
 * Delegates version-specific logic to a GameAdapter and system-specific logic to a SystemAdapter.
 */
export class FoundryState {
  private systemAdapter: SystemAdapter;
  private gameAdapter: GameAdapter | null = null;

  constructor(
    private page: Page,
    systemId: string = "dnd5e",
  ) {
    this.systemAdapter = getSystemAdapter(systemId);
  }

  /**
   * Internal helper to get the versioned game adapter.
   */
  private async getAdapter(): Promise<GameAdapter> {
    if (!this.gameAdapter) {
      this.gameAdapter = await getGameAdapter(this.page);
    }
    return this.gameAdapter;
  }

  /**
   * Sets the system adapter to use.
   */
  setSystem(systemId: string) {
    this.systemAdapter = getSystemAdapter(systemId);
  }

  /**
   * Creates a user in Foundry VTT.
   * @param name The username.
   * @param role The user role.
   * @param password The user password.
   */
  async createUser(name: string, role: UserRole = UserRole.PLAYER, password?: string) {
    return this.page.evaluate(
      async ({ name, role, password }) => {
        const cls = window.game.users.documentClass;
        return await cls.create({ name, role, password });
      },
      { name, role, password },
    );
  }

  /**
   * Deletes a user by ID.
   * @param userId The ID of the user to delete.
   */
  async deleteUser(userId: string) {
    return this.page.evaluate(async (userId) => {
      const user = window.game.users.get(userId);
      if (user) await user.delete();
    }, userId);
  }

  /**
   * Sets the role for a user.
   * @param userId The ID of the user.
   * @param role The new user role.
   */
  async setUserRole(userId: string, role: UserRole) {
    return this.page.evaluate(
      async ({ userId, role }) => {
        const user = window.game.users.get(userId);
        if (!user) throw new Error(`User ${userId} not found.`);
        return await user.update({ role });
      },
      { userId, role },
    );
  }

  /**
   * Assigns an actor to a user as their character.
   * @param userId The ID of the user.
   * @param actorId The ID of the actor.
   */
  async assignActorToUser(userId: string, actorId: string) {
    return this.page.evaluate(
      async ({ userId, actorId }) => {
        const user = window.game.users.get(userId);
        if (!user) throw new Error(`User ${userId} not found.`);
        return await user.update({ character: actorId });
      },
      { userId, actorId },
    );
  }

  /**
   * Configures a specific permission for a user role.
   * @param permission The permission key (e.g., "FILES_BROWSE").
   * @param role The user role to configure.
   * @param allowed Whether the permission is allowed.
   */
  async setRolePermission(permission: string, role: UserRole, allowed: boolean) {
    return this.page.evaluate(
      async ({ permission, role, allowed }) => {
        const permissions = window.foundry.utils.deepClone(
          window.game.settings.get("core", "permissions"),
        );
        if (!permissions[permission]) permissions[permission] = {};
        permissions[permission][role] = allowed;
        return await window.game.settings.set("core", "permissions", permissions);
      },
      { permission, role, allowed },
    );
  }

  /**
   * Creates a document in a Foundry VTT collection.
   * Delegates to the version-specific GameAdapter.
   * @param documentName The name of the document class (e.g., "Actor", "Item", "Scene").
   * @param data The data for the new document.
   * @param options Options for creation.
   */
  async createDocument(
    documentName: string,
    data: any | any[],
    options: CreateDocumentOptions = {},
  ) {
    const adapter = await this.getAdapter();
    return adapter.createDocument(this.page, documentName, data, options);
  }

  /**
   * Updates a document in a Foundry VTT collection.
   * Delegates to the version-specific GameAdapter.
   * @param uuid The UUID or name of the document.
   * @param delta The changes to apply.
   */
  async updateDocument(uuid: string, delta: any) {
    const adapter = await this.getAdapter();
    return adapter.updateDocument(this.page, uuid, delta);
  }

  /**
   * Sets ownership levels for a document.
   * @param uuid The UUID of the document.
   * @param ownership Map of userId to ownership level (0-3).
   */
  async setDocumentOwnership(uuid: string, ownership: Record<string, number>) {
    return this.updateDocument(uuid, { ownership });
  }

  /**
   * Opens the sheet for a document.
   * @param uuid The UUID or name of the document.
   */
  async openSheet(uuid: string) {
    await this.page.evaluate((uuid) => {
      const doc = window.fromUuidSync ? window.fromUuidSync(uuid) : null;
      if (doc) {
        doc.sheet.render(true);
        return;
      }
      for (const collection of Object.values(window.game.collections || {})) {
        const match = collection.getName(uuid);
        if (match) {
          match.sheet.render(true);
          return;
        }
      }
    }, uuid);

    // Wait for a window with the document's name in the header
    await expect(
      this.page.locator("dialog, foundry-app, .window-app, .application").filter({ hasText: uuid }),
    ).toBeVisible({ timeout: 15000 });
  }

  /**
   * Closes the currently active sheet matching a selector or name.
   */
  async closeSheet(name?: string) {
    const locator = name
      ? this.page
          .locator("dialog, foundry-app, .window-app, .application")
          .filter({ hasText: name })
      : this.page.locator("dialog, foundry-app, .window-app, .application").last();

    await locator.locator('[data-action="close"], .header-button.close').first().click();
  }

  /**
   * Creates one or more Actors.
   */
  async createActor(data: any | any[], options: CreateDocumentOptions = {}) {
    return this.createDocument("Actor", data, options);
  }

  /**
   * Creates one or more Items.
   */
  async createItem(data: any | any[], options: CreateDocumentOptions = {}) {
    return this.createDocument("Item", data, options);
  }

  /**
   * Creates a compendium pack.
   * @param config Compendium configuration (label, name, type, package).
   */
  async createCompendium(config: { label: string; name: string; type: string; package?: string }) {
    return this.page.evaluate(async (config) => {
      const { label, name, type, package: pkg = "world" } = config;
      return await window.foundry.documents.collections.CompendiumCollection.createCompendium({
        type,
        label,
        name,
        package: pkg,
      });
    }, config);
  }

  /**
   * Gets a document by name from a collection.
   */
  async getDocumentByName(documentName: string, name: string, options: { pack?: string } = {}) {
    return this.page.evaluate(
      ({ documentName, name, options }) => {
        let collection;
        if (options.pack) {
          collection = window.game.packs.get(options.pack);
        } else {
          const collectionName = (documentName.toLowerCase() + "s") as keyof Game;
          collection = window.game[collectionName];
        }

        if (!collection) return null;
        return collection.getName(name)?.toJSON() || null;
      },
      { documentName, name, options },
    );
  }

  /**
   * Deletes all documents of a certain type that match a predicate (or all if no predicate).
   * Delegates to the version-specific GameAdapter.
   */
  async clearCollection(documentName: string, options: { pack?: string } = {}) {
    const adapter = await this.getAdapter();
    const ids = await this.page.evaluate(
      ({ documentName, options }) => {
        let collection;
        if (options.pack) {
          collection = window.game.packs.get(options.pack);
        } else {
          const collectionName = (documentName.toLowerCase() + "s") as keyof Game;
          collection = window.game[collectionName];
        }
        return collection ? collection.map((d: any) => d.id) : [];
      },
      { documentName, options },
    );

    if (ids.length > 0) {
      await adapter.deleteDocuments(this.page, documentName, ids, options);
    }
  }

  /**
   * Fast actor creation with sensible defaults.
   */
  async createTestActor(name: string, type: string = "character", data: any = {}) {
    return this.createActor({
      name,
      type,
      img: "icons/svg/mystery-man.svg",
      ...data,
    });
  }

  /**
   * Fast item creation with sensible defaults.
   */
  async createTestItem(name: string, type: string = "feat", data: any = {}) {
    return this.createItem({
      name,
      type,
      ...data,
    });
  }

  /**
   * Grants currency to an actor.
   * Uses the configured system adapter.
   */
  async grantCurrency(actorName: string, amount: number, currency?: string) {
    return this.systemAdapter.grantCurrency(this.page, actorName, amount, currency);
  }

  /**
   * Returns the system-specific path for HP.
   */
  getHPPath() {
    return this.systemAdapter.getHPPath();
  }

  /**
   * Sets the HP for an actor.
   */
  async setHP(actorName: string, value: number) {
    const hpPath = this.getHPPath();
    return this.page.evaluate(
      ({ actorName, hpPath, value }) => {
        const actor = window.game.actors.getName(actorName);
        if (!actor) throw new Error(`Actor ${actorName} not found.`);
        return actor.update({ [hpPath]: value });
      },
      { actorName, hpPath, value },
    );
  }

  /**
   * Manually triggers a Foundry VTT hook.
   * @param hookName The name of the hook (e.g., "renderActorSheet").
   * @param args Arguments to pass to the hook.
   */
  async triggerHook(hookName: string, ...args: any[]) {
    return this.page.evaluate(
      ({ hookName, args }) => {
        return window.Hooks.call(hookName, ...args);
      },
      { hookName, args },
    );
  }

  /**
   * Emits a socket event via the Foundry VTT socket.
   * @param eventName The name of the event.
   * @param data The data to emit.
   */
  async emitSocket(eventName: string, data: any) {
    return this.page.evaluate(
      ({ eventName, data }) => {
        return window.game.socket.emit(eventName, data);
      },
      { eventName, data },
    );
  }

  /**
   * Waits for a specific Foundry VTT hook to be called.
   * @param hookName The name of the hook.
   * @param timeout The timeout in milliseconds.
   */
  async waitForHook(hookName: string, timeout: number = 10000) {
    await this.page.evaluate((hookName) => {
      window._hookLogs = window._hookLogs || {};
      window._hookLogs[hookName] = window._hookLogs[hookName] || 0;
      window.Hooks.on(hookName, () => {
        window._hookLogs[hookName]++;
      });
    }, hookName);

    await this.page.waitForFunction(
      (name) => {
        return window._hookLogs?.[name] > 0;
      },
      hookName,
      { timeout },
    );

    return this.page.evaluate((name) => {
      const count = window._hookLogs[name];
      window._hookLogs[name] = 0;
      return [count]; // Return count as args for now to verify it was called
    }, hookName);
  }

  /**
   * Waits for a specific socket event to be received.
   * @param eventName The name of the event.
   * @param timeout The timeout in milliseconds.
   */
  async waitForSocket(eventName: string, timeout: number = 10000) {
    await this.page.evaluate((eventName) => {
      window._socketLogs = window._socketLogs || {};
      window._socketLogs[eventName] = window._socketLogs[eventName] || 0;
      window.game.socket.on(eventName, () => {
        window._socketLogs[eventName]++;
      });
    }, eventName);

    await this.page.waitForFunction(
      (name) => {
        return window._socketLogs?.[name] > 0;
      },
      eventName,
      { timeout },
    );

    return this.page.evaluate((name) => {
      const count = window._socketLogs[name];
      window._socketLogs[name] = 0;
      return count;
    }, eventName);
  }

  /**
   * Sets or updates a Foundry VTT setting.
   */
  async setSetting(module: string, key: string, value: any) {
    return this.page.evaluate(
      ({ module, key, value }) => {
        return window.game.settings.set(module, key, value);
      },
      { module, key, value },
    );
  }
}
