import { FoundryPage } from "../types/index.js";

/**
 * Interface for version-specific Foundry VTT setup logic.
 */
export interface SetupAdapter {
  /** The major Foundry VTT version this adapter is for (e.g., 13, 14). */
  version: number;

  /**
   * Switches between tabs on the setup screen.
   * @param page The Foundry VTT Page object.
   * @param tabName The logical name of the tab (e.g., "Worlds", "Systems").
   */
  switchTab(page: FoundryPage, tabName: string): Promise<void>;

  /**
   * Handles the End User License Agreement screen if it appears.
   * @param page The Foundry VTT Page object.
   */
  handleEULA(page: FoundryPage): Promise<void>;

  /**
   * Handles the License Key Activation screen if it appears.
   * @param page The Foundry VTT Page object.
   * @param licenseKey The license key to activate (optional).
   */
  handleLicenseActivation(page: FoundryPage, licenseKey?: string): Promise<void>;

  /**
   * Installs a game system from the manifest list.
   * @param page The Foundry VTT Page object.
   * @param systemId The ID of the system to install.
   * @param systemLabel The human-readable label of the system.
   */
  installSystem(page: FoundryPage, systemId: string, systemLabel: string): Promise<void>;

  /**
   * Installs one or more add-on modules from the manifest list.
   * @param page The Foundry VTT Page object.
   * @param moduleIds The ID(s) of the module(s) to install.
   */
  installModules(page: FoundryPage, moduleIds: string[]): Promise<void>;

  /**
   * Installs a game system from a direct manifest URL.
   * @param page The Foundry VTT Page object.
   * @param manifestUrl The URL to the system.json manifest.
   */
  installSystemFromManifest(page: FoundryPage, manifestUrl: string): Promise<void>;

  /**
   * Installs a module from a direct manifest URL.
   * @param page The Foundry VTT Page object.
   * @param manifestUrl The URL to the module.json manifest.
   */
  installModuleFromManifest(page: FoundryPage, manifestUrl: string): Promise<void>;

  /**
   * Opens the system installation dialog.
   * @param page The Foundry VTT Page object.
   */
  openSystemInstallDialog(page: FoundryPage): Promise<any>;

  /**
   * Opens the module installation dialog.
   * @param page The Foundry VTT Page object.
   */
  openModuleInstallDialog(page: FoundryPage): Promise<any>;

  /**
   * Creates a new game world.
   * @param page The Foundry VTT Page object.
   * @param worldId The ID for the new world.
   * @param systemLabel The human-readable label of the system to use.
   * @param systemId The unique ID of the game system to use.
   */
  createWorld(
    page: FoundryPage,
    worldId: string,
    systemLabel: string,
    systemId: string,
  ): Promise<void>;

  /**
   * Deletes a game world if it exists.
   * @param page The Foundry VTT Page object.
   * @param worldId The ID of the world to delete.
   */
  deleteWorldIfExists(page: FoundryPage, worldId: string): Promise<void>;
}

/**
 * Interface for version-specific logic within the Foundry VTT game environment.
 */
export interface GameAdapter {
  /** The major Foundry VTT version this adapter is for. */
  version: number;

  createDocument(page: FoundryPage, documentName: string, data: any, options: any): Promise<any>;
  updateDocument(page: FoundryPage, uuid: string, delta: any): Promise<any>;
  deleteDocuments(
    page: FoundryPage,
    documentName: string,
    ids: string[],
    options: any,
  ): Promise<void>;
  getDocuments(page: FoundryPage, collection: string, query: any): Promise<any[]>;
}

/**
 * Base implementation of GameAdapter with shared logic for most versions.
 */
export abstract class BaseGameAdapter implements GameAdapter {
  abstract version: number;

  constructor(protected page?: FoundryPage) {}

  async createDocument(
    page: FoundryPage,
    documentName: string,
    data: any,
    options: any,
  ): Promise<any> {
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

  async updateDocument(page: FoundryPage, uuid: string, delta: any): Promise<any> {
    return page.evaluate(
      async ({ uuid, delta }) => {
        const doc = window.fromUuidSync ? window.fromUuidSync(uuid) : null;
        if (doc) return await doc.update(delta);

        for (const collection of Object.values(window.game.collections || {})) {
          const match = (collection as any).getName ? (collection as any).getName(uuid) : null;
          if (match) return await match.update(delta);
        }
        throw new Error(`Document ${uuid} not found.`);
      },
      { uuid, delta },
    );
  }

  async deleteDocuments(
    page: FoundryPage,
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

  async getDocuments(
    page: FoundryPage,
    collection: string,
    query: Record<string, any>,
  ): Promise<any[]> {
    return page.evaluate(
      ({ collection, query }) => {
        const coll = window.game[collection];
        if (!coll) return [];
        // Simple query matching
        return coll
          .filter((d: FoundryDocument) => {
            return Object.entries(query).every(([k, v]) => (d as any)[k] === v);
          })
          .map((d: FoundryDocument) => (d as any).toObject?.() || d.toJSON());
      },
      { collection, query },
    );
  }
}
