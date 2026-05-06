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
