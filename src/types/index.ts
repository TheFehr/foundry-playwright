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

/**
 * Foundry VTT Document Ownership Levels as defined in
 * CONST.DOCUMENT_OWNERSHIP_LEVELS. Distinct from {@link UserRole}: this
 * is per-document (e.g. `actor.ownership[userId]`), not per-user.
 */
export enum DocumentOwnershipLevel {
  INHERIT = -1,
  NONE = 0,
  LIMITED = 1,
  OBSERVER = 2,
  OWNER = 3,
}
