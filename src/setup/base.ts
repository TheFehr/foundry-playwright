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
  openSystemInstallDialog(page: FoundryPage): Promise<unknown>;

  /**
   * Opens the module installation dialog.
   * @param page The Foundry VTT Page object.
   */
  openModuleInstallDialog(page: FoundryPage): Promise<unknown>;

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

  /**
   * Launches an existing world from the Setup screen.
   * @param page The Foundry VTT Page object.
   * @param worldId The ID of the world to launch.
   */
  launchWorld(page: FoundryPage, worldId: string): Promise<void>;

  /**
   * Creates a named backup of a world. V14+ only.
   * @param page The Foundry VTT Page object.
   * @param worldId The ID of the world to back up.
   * @param backupName A label to identify this backup.
   */
  createWorldBackup(page: FoundryPage, worldId: string, backupName: string): Promise<void>;

  /**
   * Restores a world from a named backup. V14+ only.
   * The world data is overwritten; call launchWorld afterwards.
   * @param page The Foundry VTT Page object.
   * @param worldId The ID of the world to restore.
   * @param backupName The label of the backup to restore.
   */
  restoreWorldBackup(page: FoundryPage, worldId: string, backupName: string): Promise<void>;

  /**
   * Returns the labels of all backups for a given world. V14+ only.
   * @param page The Foundry VTT Page object.
   * @param worldId The ID of the world.
   */
  listWorldBackups(page: FoundryPage, worldId: string): Promise<string[]>;

  /**
   * Deletes a named backup for a world. V14+ only.
   * @param page The Foundry VTT Page object.
   * @param worldId The ID of the world.
   * @param backupName The label of the backup to delete.
   */
  deleteWorldBackup(page: FoundryPage, worldId: string, backupName: string): Promise<void>;

  /**
   * Fills in and submits the join-screen login form.
   * @param page The Foundry VTT Page object.
   * @param userName The display name of the user to log in as.
   * @param password The user's password, if one is set.
   */
  login(page: FoundryPage, userName: string, password?: string): Promise<void>;
}

/**
 * Fills in and submits the join-screen login form's `<select name="userid">`
 * GM/user picker - the form used by V13 and by V14 before build 366. Shared
 * by V13SetupAdapter and V14LegacySetupAdapter rather than duplicated: the
 * markup is identical on both, this is not a V13/V14 difference.
 */
export async function performLegacyJoin(
  page: FoundryPage,
  userName: string,
  password?: string,
): Promise<void> {
  await page.locator('select[name="userid"]').selectOption({ label: userName });
  if (password) await page.locator('input[name="password"]').fill(password);
  await page.locator('button[name="join"]').evaluate((el: Element) => (el as HTMLElement).click());
}

/**
 * Interface for version-specific logic within the Foundry VTT game environment.
 */
export interface GameAdapter {
  /** The major Foundry VTT version this adapter is for. */
  version: number;

  createDocument(
    page: FoundryPage,
    documentName: string,
    data: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Promise<unknown>;
  updateDocument(page: FoundryPage, uuid: string, delta: Record<string, unknown>): Promise<unknown>;
  deleteDocuments(
    page: FoundryPage,
    documentName: string,
    ids: string[],
    options: Record<string, unknown>,
  ): Promise<void>;
  getDocuments(
    page: FoundryPage,
    collection: string,
    query: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]>;
  createEmbeddedDocuments(
    page: FoundryPage,
    parentType: string,
    parentId: string,
    embeddedName: string,
    data: Record<string, unknown>[],
    options: Record<string, unknown>,
  ): Promise<unknown[]>;
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
    data: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Promise<unknown> {
    return page.evaluate(
      async ({ documentName, data, options }) => {
        const collectionName = (documentName.toLowerCase() + "s") as keyof Game;
        const collection = window.game[collectionName];
        const cls =
          (collection as Collection<FoundryDocument> | undefined)?.documentClass ||
          (
            window as unknown as Record<
              string,
              { create: (data: unknown, options: unknown) => Promise<unknown> }
            >
          )[documentName];
        if (!cls) throw new Error(`Document class ${documentName} not found.`);
        return await cls.create(data, options);
      },
      { documentName, data, options },
    );
  }

  async updateDocument(
    page: FoundryPage,
    uuid: string,
    delta: Record<string, unknown>,
  ): Promise<unknown> {
    return page.evaluate(
      async ({ uuid, delta }) => {
        const doc = window.fromUuidSync ? window.fromUuidSync(uuid) : null;
        if (doc) return await doc.update(delta);

        for (const collection of Object.values(window.game.collections || {})) {
          const c = collection as unknown as {
            getName: (name: string) => FoundryDocument | undefined;
          };
          if (typeof c.getName !== "function") continue;
          const match = c.getName(uuid);
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
    options: Record<string, unknown>,
  ): Promise<void> {
    await page.evaluate(
      async ({ documentName, ids, options }) => {
        const cls = (
          window as unknown as Record<
            string,
            { deleteDocuments: (ids: string[], options: unknown) => Promise<void> }
          >
        )[documentName];
        if (!cls) throw new Error(`Document class ${documentName} not found.`);
        await cls.deleteDocuments(ids, options);
      },
      { documentName, ids, options },
    );
  }

  async getDocuments(
    page: FoundryPage,
    collection: string,
    query: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    return page.evaluate(
      ({ collection, query }) => {
        const coll = (window.game as unknown as Record<string, Collection<FoundryDocument>>)[
          collection
        ];
        if (!coll) return [];
        // Simple query matching
        return coll
          .filter((d: FoundryDocument) => {
            return Object.entries(query).every(
              ([k, v]) => (d as unknown as Record<string, unknown>)[k] === v,
            );
          })
          .map((d: FoundryDocument) => d.toObject?.() || d.toJSON());
      },
      { collection, query },
    );
  }

  /**
   * Creates one or more embedded documents (e.g. Items on an Actor, Tokens
   * on a Scene) on an existing parent document. Unlike createDocument, this
   * targets Document Data Model behavior that lives on the parent instance
   * itself (`parent.createEmbeddedDocuments(...)`), not a top-level world
   * collection - core Foundry API, stable across V12-V14 so far, but kept
   * behind this version-adapted seam (rather than inlined directly in
   * FoundryState) in case a future generation changes it.
   */
  async createEmbeddedDocuments(
    page: FoundryPage,
    parentType: string,
    parentId: string,
    embeddedName: string,
    data: Record<string, unknown>[],
    options: Record<string, unknown>,
  ): Promise<unknown[]> {
    return page.evaluate(
      async ({ parentType, parentId, embeddedName, data, options }) => {
        const parent = window.game.collections.get(parentType)?.get(parentId) as
          | (FoundryDocument & {
              createEmbeddedDocuments?: (
                embeddedName: string,
                data: Record<string, unknown>[],
                options?: Record<string, unknown>,
              ) => Promise<FoundryDocument[]>;
            })
          | undefined;
        if (!parent) throw new Error(`Parent document ${parentType}/${parentId} not found.`);
        if (typeof parent.createEmbeddedDocuments !== "function") {
          throw new Error(`${parentType} does not support embedded documents.`);
        }
        const created = await parent.createEmbeddedDocuments(embeddedName, data, options);
        // Converted to plain objects here, inside the browser context,
        // matching getDocuments below - the returned Document instances
        // don't survive Playwright's evaluate-result serialization with
        // their methods/getters intact, only their own plain data does.
        return created.map((d) => d.toObject?.() ?? d.toJSON());
      },
      { parentType, parentId, embeddedName, data, options },
    );
  }
}
