# State Manipulation Fixtures

## The `foundry` Fixture

Every test receives a `foundry` fixture with three namespaces:

```typescript
test("example", async ({ page, foundry }) => {
  await foundry.state.createTestActor("Hero");
  await foundry.ui.switchTab(".actor-sheet", "Items");
  await foundry.canvas.clickToken("Hero");
});
```

- **`foundry.state`** — `FoundryState`: direct Foundry API calls via `page.evaluate`, no UI interaction.
- **`foundry.ui`** — `FoundryUI`: Playwright-level UI helpers for sheets and dialogs.
- **`foundry.canvas`** — `FoundryCanvas`: WebGL canvas interaction.

---

## `FoundryState` — Direct API Access

All methods run inside the browser via `page.evaluate`. They communicate with Foundry's internal `game` object and are significantly faster than UI interactions.

### Document Management

```typescript
// Create any document type
await foundry.state.createDocument("Actor", { name: "Hero", type: "character" });
await foundry.state.createDocument("Item", { name: "Sword", type: "weapon" });

// Update by document ID
await foundry.state.updateDocument("Actor", actorId, { "system.attributes.hp.value": 50 });

// Delete by ID
await foundry.state.deleteDocument("Actor", actorId);

// Read
const actor = await foundry.state.getDocument("Actor", actorId);
const byName = await foundry.state.getDocumentByName("Actor", "Hero");
```

### Actor Helpers

```typescript
// Create a system-appropriate test actor (type resolved by SystemStateAdapter)
await foundry.state.createTestActor("Test Actor");

// Grant currency (system-aware)
await foundry.state.grantCurrency("Hero", 100, "gp");

// Set HP
await foundry.state.setActorHP("Hero", 42, /* max */ 100);

// Roll a formula
await foundry.state.roll("Hero", "1d20+5", "Attack Roll");

// Execute a macro by name
await foundry.state.executeMacro("My Macro");
```

### User Management

```typescript
import { UserRole } from "@thefehr/foundry-playwright";

const userId = await foundry.state.createUser("Player One", UserRole.PLAYER, "password");
await foundry.state.setUserRole(userId, UserRole.TRUSTED);
await foundry.state.updateUser(userId, { color: "#ff0000" });
await foundry.state.assignActorToUser(userId, actorId);

// Grant a core permission to a role
await foundry.state.setRolePermission("FILES_BROWSE", UserRole.PLAYER, true);
```

### Settings

```typescript
await foundry.state.setSetting("my-module", "my-key", "value");
```

### Hooks & Sockets

```typescript
// Trigger a hook and capture its arguments
const [arg] = await foundry.state.waitForHook("myHook");

// Emit a socket event and wait for the response
await foundry.state.emitSocket("myEvent", { data: 123 });
const payload = await foundry.state.waitForSocket("myEvent");

// Fire a hook without waiting (for testing reactive code)
await foundry.state.triggerHook("myHook", { foo: "bar" });
```

---

## `FoundryUI` — Sheet & Dialog Helpers

```typescript
// Switch a tab inside an actor sheet or ApplicationV2 app
await foundry.ui.switchTab("#my-app", "Inventory");

// Simulate a drag-and-drop onto a sheet
await foundry.ui.simulateDrop(".actor-sheet", { type: "Item", uuid: "Item.abc123" });

// Expand or collapse a collapsible section
await foundry.ui.handleCollapsibleSection(".actor-sheet", "Features", true);
```

---

## `FoundryCanvas` — WebGL Canvas

```typescript
// Convert a grid position to canvas pixels
const { x, y } = await foundry.canvas.gridToPixels(3, 5);

// Click a token by its actor name
await foundry.canvas.clickToken("Hero");

// Drag a token from one grid cell to another
await foundry.canvas.dragToken("Hero", { row: 2, col: 4 });
```

---

## `FP_VERIFY` — Event Logging

`FP_VERIFY` is a global object injected by the `fake-module` that ships with the library's internal test suite. It intercepts Foundry hooks (`createActor`, `updateActor`, etc.) and logs them for test assertions.

### `verifyResult(page, key, predicate, extra?, options?)`

Polls `FP_VERIFY.logs[key]` until the predicate returns true or a timeout is reached.

```typescript
await foundry.state.grantCurrency("Hero", 100, "gp");
await verifyResult(
  page,
  "currency-update",
  (data, extra) => data.amount === extra.amount,
  { amount: 100 },
  { timeout: 10000 },
);
```

### `waitForActorFlag(page, actorName, scope, key, expected?)`

Polls `game.actors.getName(actorName).getFlag(scope, key)` until it matches the expected value.

### `waitForActorData(page, actorName, path, expected?)`

Polls a dot-notation path on the actor's data object.
