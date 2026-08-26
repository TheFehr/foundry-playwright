import { Locator } from "@playwright/test";
import { BaseGameAdapter } from "./base.js";
import { V12SetupAdapter } from "./v12.js";
import { FoundryPage } from "../types/index.js";

/**
 * Setup adapter for Foundry VTT Version 13.
 *
 * V13's setup/EULA/package-install screens are the same Application V1
 * shell V12 introduced (V14SetupAdapter is the actual rewrite, onto
 * ApplicationV2) - see V12SetupAdapter for the shared implementation. Only
 * overrides the two places V13 actually diverges from V12, both confirmed
 * live: package-section ids gained a "setup-packages-" prefix, and the
 * install-dialog filter input gained an accessible name.
 */
export class V13SetupAdapter extends V12SetupAdapter {
  version = 13;

  protected packagesSectionId(dataTab: string): string {
    return `setup-packages-${dataTab}`;
  }

  protected filterBoxLocator(dialog: Locator): Locator {
    return dialog.getByRole("searchbox", { name: "Filter" });
  }
}

/**
 * Game adapter for Foundry VTT Version 13.
 */
export class V13GameAdapter extends BaseGameAdapter {
  version = 13;

  constructor(page?: FoundryPage) {
    super(page);
  }
}
