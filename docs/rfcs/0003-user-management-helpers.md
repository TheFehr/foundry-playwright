# RFC 0003: User Management Helpers

## Goal

Establish a set of helpers for managing Foundry VTT users, roles, and permissions. These helpers will enable testing of multi-user scenarios, permission-restricted features, and user-specific configurations.

## 1. Extension of `FoundryState`

We will add user management methods to the `FoundryState` class in `src/state.ts`. These methods will use `page.evaluate` to interact directly with the Foundry VTT API.

### A. User Creation and Deletion

- `createUser(name: string, role?: UserRole, password?: string)`: Creates a new user.
- `deleteUser(userId: string)`: Deletes a user by ID.

### B. Role and Permission Management

- `setUserRole(userId: string, role: UserRole)`: Updates a user's role (e.g., Player, Trusted, Assistant, Gamemaster).
- `assignActorToUser(userId: string, actorId: string)`: Assigns a character actor to a user.
- `setRolePermission(role: UserRole, permission: string, allowed: boolean)`: Configures specific permissions for a user role (e.g., "FILES_BROWSE" for "PLAYER").

## 2. New Type Definitions

We will introduce `UserRole` and `Permission` enums or types to ensure type safety and align with Foundry's `CONST.USER_ROLES`.

```typescript
export enum UserRole {
  NONE = 0,
  PLAYER = 1,
  TRUSTED = 2,
  ASSISTANT = 3,
  GAMEMASTER = 4,
}
```

## 3. Implementation Details

### `createUser`

Uses `User.create({ name, role, password })`.

### `setUserRole`

Uses `game.users.get(userId).update({ role })`.

### `assignActorToUser`

Uses `game.users.get(userId).update({ character: actorId })`.

### `setRolePermission`

This involves updating the `core.permissions` setting.

```javascript
const permissions = game.settings.get("core", "permissions");
permissions[permission][role] = allowed;
await game.settings.set("core", "permissions", permissions);
```

## 4. Multi-User Testing Strategy

While `foundrySetup` handles initial login, complex tests may require simulating multiple users simultaneously.
We recommend using Playwright's multiple browser contexts:

1.  **Context A (GM):** Performs setup and creates a world.
2.  **Context B (Player):** Joins the world as a specific user.

We will provide a `loginAs(page, username, password)` helper in `src/auth.ts` to facilitate switching users or logging in from a secondary context.

## 5. Benefits

- **Automated Multi-User Setup:** Quickly create "test users" without manual UI interaction.
- **Granular Permission Testing:** Verify that modules correctly respect Foundry's permission system.
- **Improved Test Isolation:** Ensure each test can have its own clean set of users.
