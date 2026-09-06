import { FoundryPage } from "../types/index.js";

/**
 * Aggressively removes properties known to trigger deprecation warnings on
 * access, before returning document data out of a page.evaluate. Shared
 * between BaseGameAdapter (in-browser, via page.evaluate) and FoundryState
 * (both in-browser and, for createEmbeddedDocuments, applied Node-side to
 * already-serialized data) - defined here rather than in state.ts to avoid
 * a state.ts -> setup/index.ts -> setup/base.ts -> state.ts import cycle.
 */
export const DOCUMENT_SANITIZER_SCRIPT = `(obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const deprecatedDnD5e = ['darkvision', 'blindsight', 'tremorsense', 'truesight', 'special'];
    const cleanSenses = (o) => {
        if (!o || typeof o !== 'object') return o;
        const result = Array.isArray(o) ? [] : {};
        for (let key in o) {
            if (key === 'senses') {
                const senses = o[key];
                const cleanS = Array.isArray(senses) ? [] : {};
                for (let skey in senses) {
                    if (deprecatedDnD5e.includes(skey)) continue;
                    cleanS[skey] = senses[skey];
                }
                result[key] = cleanS;
            } else {
                result[key] = cleanSenses(o[key]);
            }
        }
        return result;
    };
    return cleanSenses(obj);
}`;

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

  /** Creates a top-level world document, returning its sanitized plain data. */
  createDocument(
    page: FoundryPage,
    documentName: string,
    data: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Promise<unknown>;
  /** Updates a document looked up by documentName + id (e.g. "Actor" + its id). */
  updateDocument(
    page: FoundryPage,
    documentName: string,
    id: string,
    delta: Record<string, unknown>,
  ): Promise<unknown>;
  /** Deletes a single document looked up by documentName + id. */
  deleteDocument(page: FoundryPage, documentName: string, id: string): Promise<void>;
  /** Gets a single document by documentName + id, returning sanitized plain data or null. */
  getDocument(page: FoundryPage, documentName: string, id: string): Promise<unknown>;
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
      async ({ documentName, data, options, sanitizer }) => {
        const cls = window.CONFIG[documentName].documentClass;
        if (!cls) throw new Error(`Document class ${documentName} not found.`);
        const doc = await cls.create(data, options);
        if (!doc) return null;
        // Use raw _source to avoid getters/deprecations
        const obj = doc._source ? JSON.parse(JSON.stringify(doc._source)) : doc.toObject();
        const sanitize = new Function(`return ${sanitizer}`)();
        return sanitize(obj);
      },
      { documentName, data, options, sanitizer: DOCUMENT_SANITIZER_SCRIPT },
    );
  }

  async updateDocument(
    page: FoundryPage,
    documentName: string,
    id: string,
    delta: Record<string, unknown>,
  ): Promise<unknown> {
    return page.evaluate(
      ({ documentName, id, delta }) => {
        const doc = window.game.collections.get(documentName).get(id);
        if (!doc) throw new Error(`Document ${documentName}/${id} not found`);
        return doc.update(delta);
      },
      { documentName, id, delta },
    );
  }

  async deleteDocument(page: FoundryPage, documentName: string, id: string): Promise<void> {
    await page.evaluate(
      ({ documentName, id }) => {
        const doc = window.game.collections.get(documentName).get(id);
        if (!doc) throw new Error(`Document ${documentName}/${id} not found`);
        return doc.delete();
      },
      { documentName, id },
    );
  }

  async getDocument(page: FoundryPage, documentName: string, id: string): Promise<unknown> {
    return page.evaluate(
      ({ documentName, id, sanitizer }) => {
        const doc = window.game.collections.get(documentName).get(id);
        if (!doc) return null;
        // Use raw _source to avoid getters/deprecations
        const obj = doc._source ? JSON.parse(JSON.stringify(doc._source)) : doc.toObject();
        const sanitize = new Function(`return ${sanitizer}`)();
        return sanitize(obj);
      },
      { documentName, id, sanitizer: DOCUMENT_SANITIZER_SCRIPT },
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
