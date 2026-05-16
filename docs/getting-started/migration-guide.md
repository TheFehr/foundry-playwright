# Migration Guide: Adopting foundry-playwright

This guide explains how to migrate your existing Foundry VTT module or system testing setup to use `@thefehrs/foundry-playwright`.

## Step 1: Initialization

Run the initialization command in your project root:

```bash
npx foundry-playwright init
```

This will:

- Add a `test:e2e` script to your `package.json`.
- Create a `playwright.config.ts` with optimized settings for Foundry.
- Create an `e2e` directory with a `basic.spec.ts` sample test.
- Create a `.env.template` file.

## Step 2: Environment Setup

Copy `.env.template` to `.env` and fill in your Foundry credentials.

```bash
cp .env.template .env
```

The Docker orchestrator uses these variables to boot the correct version of Foundry.

## Step 3: Local Module Injection

The library's Docker orchestrator automatically injects any directories in your `e2e/` folder that contain a `module.json` or `system.json` into the Foundry instance.

If your module source is in the project root, you can create a symlink in `e2e/` or copy the files there during your build process.

## Step 4: Writing Tests with `useFoundry`

Instead of manual login boilerplate, use the `useFoundry` helper at the top of your test files:

```typescript
import { test, expect, useFoundry } from "@thefehrs/foundry-playwright";

// This sets up the world, system, and activates your module
useFoundry(test, {
  worldId: "test-world",
  systemId: "dnd5e",
  moduleId: "my-module-id",
});

test("My first test", async ({ page, foundry }) => {
  await page.goto("/");

  // Use the 'foundry' fixture for state manipulation
  await foundry.state.createActor({ name: "Test Hero", type: "character" });

  const actors = await foundry.state.getDocuments("Actor");
  expect(actors.some((a) => a.name === "Test Hero")).toBe(true);
});
```

## Step 5: Transitioning from UI-Based Setup

If you have existing tests that click through the UI to create actors or items, consider refactoring them to use `foundry.state`. Direct state manipulation via `page.evaluate` is significantly faster and more reliable than UI interactions.

**Before (UI-based):**

```typescript
await page.click(".actor-create");
await page.fill('input[name="name"]', "Hero");
await page.click("button.submit");
```

**After (State-based):**

```typescript
await foundry.state.createActor({ name: "Hero", type: "character" });
```

## Step 6: Running Tests

Execute your tests using the NPM script:

```bash
npm run test:e2e
```

This command uses the CLI to spin up a Docker container, run your Playwright tests against it, and then tear it down.
