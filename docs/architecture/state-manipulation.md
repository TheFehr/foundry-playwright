    # Technical Plan: State Manipulation Fixtures

## The "What"

A set of Playwright fixtures and utilities that interact directly with the FoundryVTT internal API (`game`, `canvas`, `socket`) via `page.evaluate`. These utilities allow tests to inject data, modify world settings, and trigger game events without interacting with the DOM.

## The "Why"

Traditional E2E testing relies on "clicking through the UI" to set up state (e.g., opening an Actor sheet, clicking "Add Item", filling a form). This is:

1. **Slow:** Every UI interaction requires DOM rendering, event propagation, and network roundtrips.
2. **Brittle:** Minor UI changes (renaming a button, changing a tab layout) break setup code that is unrelated to the actual test logic.
3. **Limited:** Some state is difficult to set up via UI alone (e.g., setting precise cooldown timers, simulating complex socket events).

By manipulating state directly, we can ensure the game is in the exact required state in milliseconds, focusing the test execution on the actual feature being verified.

## The "How"

### 1. The `foundry` Fixture

We will extend the Playwright `test` object with a `foundry` fixture that provides a high-level API for state manipulation.

```typescript
export const test = base.extend<{ foundry: FoundryUtils }>({
  foundry: async ({ page }, use) => {
    await use(new FoundryUtils(page));
  },
});
```

### 2. Core Capabilities

#### A. Document Management

Methods to create, update, and delete Foundry documents (`Actor`, `Item`, `Scene`, `JournalEntry`).

- `foundry.createActor(data: object): Promise<string>` (returns UUID)
- `foundry.createItem(actorId: string, data: object): Promise<string>`
- `foundry.updateDocument(uuid: string, changes: object)`

#### B. Settings & Flags

Directly manipulate world or module settings.

- `foundry.setSetting(module: string, key: string, value: any)`
- `foundry.getFlag(uuid: string, scope: string, key: string)`

#### C. Deterministic Polling (Persistence Stability)

Foundry's backend persistence is asynchronous. Use these helpers to wait for state changes deterministically:

- `waitForSetting(page, module, key, expected)`
- `waitForActorFlag(page, actorId, scope, key, expected)`
- `waitForActorData(page, actorId, path, expected)`

These helpers use `page.waitForFunction` to poll the internal `game` object, ensuring the test only proceeds once the state has been persisted.

#### D. Hook & Event Simulation

Manually trigger Foundry hooks to test reactive logic.

- `foundry.triggerHook(hookName: string, ...args: any[])`
- Example: Simulating a drop event on a sheet without performing a real drag-and-drop.

### 3. Implementation Detail: `page.evaluate` Serialization

Since `page.evaluate` runs in the browser context, all data passed must be serializable. The library will handle the boilerplate of wrapping these calls:

```typescript
// Inside FoundryUtils
async createActor(data: object) {
  return await this.page.evaluate(async (actorData) => {
    const actor = await Actor.create(actorData);
    return actor.uuid;
  }, data);
}
```

### 4. Socket Interaction (Advanced)

For testing multi-user scenarios (e.g., a GM action triggering a UI update for a Player), the library will provide utilities to listen for or emit socket events directly, allowing for precise verification of network synchronization.
