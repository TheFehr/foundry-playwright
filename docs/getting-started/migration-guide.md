# Getting Started with foundry-playwright

## Step 1: Install & Initialise

```bash
npm install --save-dev @thefehr/foundry-playwright
npx foundry-playwright init
```

`init` scaffolds:

- `playwright.config.ts` with optimised settings for Foundry
- `e2e/` directory with a sample test
- `.env.template` with required environment variables
- A `test:e2e` script in `package.json`

## Step 2: Environment Setup

```bash
cp .env.template .env
```

Fill in your Foundry credentials. At minimum you need:

```env
FOUNDRY_USERNAME=your-foundry-account@email.com
FOUNDRY_PASSWORD=your-foundry-password
FOUNDRY_ADMIN_KEY=your-admin-password
```

## Step 3: Local Module Injection

The Docker orchestrator automatically injects any directory inside `e2e/` that contains a `module.json` or `system.json` into the Foundry container. If your module source is at the project root it is also injected automatically.

## Step 4: Writing Tests

### Option A — `useFoundry` (simple)

Creates the world in `beforeAll`, tears it down in `afterAll`. Tests within the file share a single world instance and must manage their own state.

```typescript
import { test, expect, useFoundry } from "@thefehr/foundry-playwright";

useFoundry(test, {
  worldId: "my-test-world",
  systemId: "dnd5e",
  moduleId: "my-module-id",
});

test("creates an actor", async ({ foundry }) => {
  await foundry.state.createDocument("Actor", { name: "Hero", type: "character" });
  const actor = await foundry.state.getDocumentByName("Actor", "Hero");
  expect(actor).not.toBeNull();
});
```

### Option B — `useBaseWorld` (isolated, recommended for V14)

Snapshots the world state after setup and restores it before every test. Each spec starts from a guaranteed clean slate.

```typescript
import { test, useBaseWorld } from "@thefehr/foundry-playwright";

useBaseWorld(test, {
  worldId: "isolated-world",
  systemId: "dnd5e",
  moduleId: "my-module-id",
  setupWorld: async ({ state }) => {
    // Runs once before the snapshot is taken.
    // Seed any data every test should start with.
    await state.createTestActor("Starting Actor");
  },
});

test("modifying an actor does not affect other tests", async ({ foundry }) => {
  await foundry.state.setActorHP("Starting Actor", 1);
  // Next test will find Starting Actor at full HP because the world is restored.
});
```

See [Authentication & World Setup](../architecture/auth-and-world.md) for the full config reference.

## Step 5: State Manipulation

Prefer `foundry.state` over clicking through the UI to set up test preconditions. It is faster, more reliable, and not affected by sheet UI changes.

```typescript
// Create documents directly
await foundry.state.createDocument("Actor", { name: "Hero", type: "character" });
await foundry.state.createDocument("Item", { name: "Sword", type: "weapon" });

// Update a document
await foundry.state.updateDocument("Actor", actorId, { "system.attributes.hp.value": 10 });

// Grant currency (system-aware)
await foundry.state.grantCurrency("Hero", 50, "gp");

// User management
const userId = await foundry.state.createUser("Player", UserRole.PLAYER, "secret");
await foundry.state.assignActorToUser(userId, actorId);
```

See [State Manipulation Fixtures](../architecture/state-manipulation.md) for the full API reference.

## Step 6: Running Tests

```bash
# Against a running Foundry instance
npm run test:e2e

# With a Docker-managed Foundry instance
npx foundry-playwright test --docker

# Target a specific version
npm run verify:local -- --docker --version 14.360.0 --system dnd5e
```
