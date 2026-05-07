import { Page } from "@playwright/test";

/**
 * Interface for version-specific Foundry VTT setup logic.
 */
export interface SetupAdapter {
  /** The major Foundry VTT version this adapter is for (e.g., 13, 14). */
  version: number;

  /**
   * Handles the End User License Agreement screen if it appears.
   * @param page The Playwright Page object.
   */
  handleEULA(page: Page): Promise<void>;

  /**
   * Handles the License Key Activation screen if it appears.
   * @param page The Playwright Page object.
   * @param licenseKey The license key to activate (optional).
   */
  handleLicenseActivation(page: Page, licenseKey?: string): Promise<void>;

  /**
   * Installs a game system from the manifest list.
   * @param page The Playwright Page object.
   * @param systemId The ID of the system to install.
   * @param systemLabel The human-readable label of the system.
   */
  installSystem(page: Page, systemId: string, systemLabel: string): Promise<void>;

  /**
   * Installs one or more add-on modules from the manifest list.
   * @param page The Playwright Page object.
   * @param moduleIds The ID(s) of the module(s) to install.
   */
  installModules(page: Page, moduleIds: string[]): Promise<void>;

  /**
   * Creates a new game world.
   * @param page The Playwright Page object.
   * @param worldId The ID for the new world.
   * @param systemLabel The human-readable label of the system to use.
   * @param systemId The unique ID of the game system to use.
   */
  createWorld(page: Page, worldId: string, systemLabel: string, systemId: string): Promise<void>;

  /**
   * Deletes a game world if it exists.
   * @param page The Playwright Page object.
   * @param worldId The ID of the world to delete.
   */
  deleteWorldIfExists(page: Page, worldId: string): Promise<void>;
}

/**
 * Interface for version-specific logic within the Foundry VTT game environment.
 */
export interface GameAdapter {
  /** The major Foundry VTT version this adapter is for. */
  version: number;

  createDocument(page: Page, documentName: string, data: any, options: any): Promise<any>;
  updateDocument(page: Page, uuid: string, delta: any): Promise<any>;
  deleteDocuments(page: Page, documentName: string, ids: string[], options: any): Promise<void>;
  getDocuments(page: Page, collection: string, query: any): Promise<any[]>;
}

/**
 * Base implementation of GameAdapter with shared logic for most versions.
 */
export abstract class BaseGameAdapter implements GameAdapter {
  abstract version: number;

  async createDocument(page: Page, documentName: string, data: any, options: any): Promise<any> {
    return page.evaluate(
      async ({ documentName, data, options }) => {
        const collectionName = (documentName.toLowerCase() + "s") as keyof Game;
        const collection = window.game[collectionName];
        const cls = (collection as any)?.documentClass || window[documentName];
        if (!cls) throw new Error(`Document class ${documentName} not found.`);
        return await cls.create(data, options);
      },
      { documentName, data, options },
    );
  }

  async updateDocument(page: Page, uuid: string, delta: any): Promise<any> {
    return page.evaluate(
      async ({ uuid, delta }) => {
        const doc = window.fromUuidSync ? window.fromUuidSync(uuid) : null;
        if (doc) return await doc.update(delta);

        for (const collection of Object.values(window.game.collections || {})) {
          const match = collection.getName(uuid);
          if (match) return await match.update(delta);
        }
        throw new Error(`Document ${uuid} not found.`);
      },
      { uuid, delta },
    );
  }

  async deleteDocuments(
    page: Page,
    documentName: string,
    ids: string[],
    options: any,
  ): Promise<void> {
    await page.evaluate(
      async ({ documentName, ids, options }) => {
        const cls = window[documentName];
        if (!cls) throw new Error(`Document class ${documentName} not found.`);
        await cls.deleteDocuments(ids, options);
      },
      { documentName, ids, options },
    );
  }

  async getDocuments(page: Page, collection: string, query: Record<string, any>): Promise<any[]> {
    return page.evaluate(
      ({ collection, query }) => {
        const coll = window.game[collection];
        if (!coll) return [];
        // Simple query matching
        return coll
          .filter((d: FoundryDocument) => {
            return Object.entries(query).every(([k, v]) => (d as any)[k] === v);
          })
          .map((d: FoundryDocument) => d.toJSON());
      },
      { collection, query },
    );
  }
}
