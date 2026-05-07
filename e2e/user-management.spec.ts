import { test, expect, UserRole } from "../src/index.js";
import { foundrySetup, foundryTeardown, loginAs } from "../src/index.js";

test.describe("User Management Verification", () => {
  const worldId = "user-verify-world";
  const adminPassword = process.env.FOUNDRY_ADMIN_KEY || "password";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300000); // 5 minutes
    const page = await browser.newPage();
    await foundrySetup(page, {
      worldId,
      userName: "Gamemaster",
      adminPassword,
      moduleId: "fake-module",
      systemId: "dnd5e",
    });
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(120000); // 2 minutes
    const page = await browser.newPage();
    await foundryTeardown(page, {
      worldId,
      adminPassword,
    });
    await page.close();
  });

  test("user management: create, update, and login", async ({ browser, page, foundry }) => {
    // 1. GM Login (using the default page fixture)
    await page.goto("/join");
    await page.locator('select[name="userid"]').selectOption({ label: "Gamemaster" });
    await page.locator('button[name="join"]').click();
    await page.waitForURL(/\/game/);
    await page.waitForFunction(() => window.game?.ready);

    const testUserName = "Test Player " + Date.now();
    const testPassword = "password123";

    // 2. Create User
    console.log("Creating user...");
    await foundry.state.createUser(testUserName, UserRole.PLAYER, testPassword);

    // Verify user exists
    const userExists = await page.evaluate((name) => {
      return !!window.game.users.getName(name);
    }, testUserName);
    expect(userExists).toBe(true);

    // 3. Assign Actor
    console.log("Assigning actor...");
    const actorName = "User Actor";
    await foundry.state.createTestActor(actorName);
    const actorId = await page.evaluate((name) => window.game.actors.getName(name)?.id, actorName);
    const userId = await page.evaluate((name) => window.game.users.getName(name)?.id, testUserName);

    if (!userId || !actorId) throw new Error("Failed to get user or actor ID");

    await foundry.state.assignActorToUser(userId, actorId);

    // Verify assignment
    const assignedActorId = await page.evaluate(
      (uId) => window.game.users.get(uId)?.character?.id,
      userId,
    );
    expect(assignedActorId).toBe(actorId);

    // 4. Set Role Permission
    console.log("Setting role permission...");
    // Setting FILES_BROWSE for PLAYER role
    await foundry.state.setRolePermission("FILES_BROWSE", UserRole.PLAYER, true);

    // Verify permission
    const isAllowed = await page.evaluate(() => {
      return (window.game.settings.get("core", "permissions") as any)["FILES_BROWSE"][1]; // 1 is PLAYER
    });
    expect(isAllowed).toBe(true);

    // 5. Login as New User (using a new context/page)
    console.log("Logging in as new user...");
    const context = await browser.newContext();
    const playerPage = await context.newPage();
    await playerPage.goto("/join");
    await loginAs(playerPage, testUserName, testPassword);

    // Verify player is logged in
    await playerPage.waitForFunction(() => window.game?.ready);
    const currentUserName = await playerPage.evaluate(() => window.game.user.name);
    expect(currentUserName).toBe(testUserName);

    await context.close();
  });
});
