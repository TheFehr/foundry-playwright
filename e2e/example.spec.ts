import { test, expect, useBaseWorld } from "../src/index.js";

// This is an example of how a consumer would use the library.
// useBaseWorld creates the world once, takes a base backup, and restores it
// before every spec — much faster than recreating the world each time.
test.describe("Foundry VTT Library Example", () => {
  useBaseWorld(test, {
    worldId: "test-world",
    adminPassword: "admin", // Use env vars in real usage: process.env.FOUNDRY_ADMIN_KEY
    moduleId: "my-module",
    systemId: "dnd5e",
    systemLabel: "Dungeons & Dragons Fifth Edition",

    // Optional: populate the world once before the base backup is taken (V14).
    // On V13 this runs before every spec instead.
    async setupWorld({ state }) {
      await state.createDocument("Actor", { name: "Shared NPC", type: "npc" });
    },

    // Optional: capture a named backup after each spec for post-mortem inspection.
    captureAfterSpec: false,
  });

  test("should have game ready", async ({ page, foundry }) => {
    await foundry.state.createTestActor("Example Actor");
    await foundry.state.grantCurrency("Example Actor", 50, "gp");

    const isReady = await page.evaluate(() => (window as unknown as Window).game?.ready);
    expect(isReady).toBe(true);
  });
});
