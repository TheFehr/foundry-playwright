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
 *
 * These are stored values, not effective permission — for a real
 * capability check (which also accounts for GM/role overrides), use the
 * document's `testUserPermission()` instead of reading ownership directly.
 * `INHERIT` is primarily meaningful on embedded documents (e.g. a token
 * deferring to its actor's ownership), not something you'd typically set
 * on a top-level actor.
 */
export enum DocumentOwnershipLevel {
  INHERIT = -1,
  NONE = 0,
  LIMITED = 1,
  OBSERVER = 2,
  OWNER = 3,
}
