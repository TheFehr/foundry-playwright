import { Page } from "@playwright/test";
import { DeprecationTracker } from "../deprecations.js";

/**
 * Extended Playwright Page with Foundry-specific properties.
 */
export interface FoundryPage extends Page {
  deprecationTracker?: DeprecationTracker;
}

/**
 * Foundry VTT User Roles as defined in CONST.USER_ROLES
 */
export enum UserRole {
  NONE = 0,
  PLAYER = 1,
  TRUSTED = 2,
  ASSISTANT = 3,
  GAMEMASTER = 4,
}
