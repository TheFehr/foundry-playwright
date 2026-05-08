import { test, expect, verifyResult } from "../src/index.js";
import { foundrySetup, foundryTeardown } from "../src/index.js";

test.describe("Library Verification Suite", () => {
  const worldId = "verify-world";
  const adminPassword = process.env.FOUNDRY_ADMIN_KEY || "password";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600000);
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

  test.beforeEach(async ({ page }) => {
    await page.goto("/join");
    if (page.url().includes("/join")) {
      await page.locator('select[name="userid"]').selectOption({ label: "Gamemaster" });
      await page.locator('button[name="join"]').click();
    }
    await page.waitForURL(/\/game/);
    await expect(page.locator("#loading")).toBeHidden({ timeout: 60000 });
    await page.waitForFunction(() => typeof window.game !== "undefined" && window.game.ready, {
      timeout: 60000,
    });
    await page.evaluate(() => window.FP_VERIFY_RESET?.());
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(120000);
    const page = await browser.newPage();
    await foundryTeardown(page, {
      worldId,
      adminPassword,
    });
    await page.close();
  });

  test("foundry.state: document management", async ({ page, foundry }) => {
    const actorName = "Spy Actor " + Date.now();
    await foundry.state.createTestActor(actorName);
    await verifyResult(
      page,
      "actor-create",
      (data: any, extra: any) => data.name === extra.actorName,
      { actorName },
    );
    await foundry.state.grantCurrency(actorName, 100, "gp");
    await verifyResult(
      page,
      "actor-update",
      (data: any, extra: any) => {
        return data.name === extra.actorName && data.delta.system?.currency?.gp === 100;
      },
      { actorName },
    );
  });

  test("foundry.state: settings management", async ({ page, foundry }) => {
    const testVal = "val-" + Date.now();
    await foundry.state.setSetting("fake-module", "test-string", testVal);
    const val = await page.evaluate(() => window.game.settings.get("fake-module", "test-string"));
    expect(val).toBe(testVal);
  });

  test("foundry.ui: Application V2 tab switching", async ({ page, foundry }) => {
    await page.evaluate(async () => {
      const cls = (window.game.modules.get("fake-module") as any).FakeAppV2;
      const app = new cls();
      await app.render(true);
      await new Promise((r) => setTimeout(r, 500));
    });
    const appSelector = "#fake-app-v2";
    await expect(page.locator(appSelector)).toBeVisible({ timeout: 15000 });
    await foundry.ui.switchTab(appSelector, "Advanced");
    await verifyResult(page, "app-v2-tab-click", (data: any) => data.tab === "advanced");
  });

  test("foundry.helpers: tour suppression", async ({ page, foundry: _foundry }) => {
    await page.evaluate(() => {
      const tour = new (window.game.modules.get("fake-module") as any).FakeTour();
      tour.start();
    });
    await verifyResult(page, "tour-started", (data: any) => data.id === "test-tour");
    await expect(async () => {
      const progress = await page.evaluate(() => window.localStorage.getItem("core.tourProgress"));
      expect(progress).toContain("backupsOverview");
    }).toPass({ timeout: 10000 });
  });

  test("foundry.state: event logic (Hooks)", async ({ page, foundry }) => {
    const hookName = "testHook" + Date.now();
    const [hookArgs] = await Promise.all([
      foundry.state.waitForHook(hookName),
      page.evaluate((name) => {
        setTimeout(() => Hooks.call(name, { foo: "bar" }), 1000);
      }, hookName),
    ]);
    expect(hookArgs[0]).toBeGreaterThan(0);
  });

  test("foundry.ui: drop simulation", async ({ page, foundry }) => {
    const actorName = "Drop Actor " + Date.now();
    await foundry.state.createTestActor(actorName);
    await page.waitForFunction((name) => window.game.actors.getName(name), actorName);

    console.log("Opening sheet...");
    await page.evaluate((name) => {
      const actor = window.game.actors.getName(name);
      if (actor) actor.sheet.render(true);
    }, actorName);

    // Fallback to ANY visible window if specific selectors fail
    const selector = `foundry-app, .window-app, .sheet.actor, [id^="actor-"], section.window-app`;
    const sheet = page.locator(selector).filter({ hasText: actorName }).first();

    try {
      await expect(sheet).toBeVisible({ timeout: 30000 });
    } catch (e) {
      const dom = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("*"))
          .map((el) => ({
            tag: el.tagName,
            id: el.id,
            classes: el.className,
          }))
          .filter((o) => o.id || o.classes);
      });
      console.error("Visible elements:", JSON.stringify(dom, null, 2));
      throw e;
    }

    const dropData = { type: "Item", uuid: "Actor.123.Item.456" };
    await page.waitForTimeout(3000);

    const { simulateFoundryDrop } = await import("../src/helpers.js");
    // We use the ID of the actual visible sheet if we can find it
    const actualSelector = await sheet.evaluate((el) => {
      return el.id ? `#${el.id}` : el.tagName === "FOUNDRY-APP" ? "foundry-app" : ".window-app";
    });

    await simulateFoundryDrop(page, actualSelector, dropData);

    await expect(async () => {
      const logs = await page.evaluate(() => window.FP_VERIFY?.logs["actor-sheet-drop"] || []);
      expect(logs.length).toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });
  });

  test("foundry.setup: manifest-based installation UI", async ({ page }) => {
    // This test verifies the UI flow of manifest installation
    // We return to setup and try to open the dialog
    const { returnToSetup, openModuleInstallDialog } = await import("../src/index.js");
    await returnToSetup(page, adminPassword);

    const dialog = await openModuleInstallDialog(page);
    await expect(dialog).toBeVisible();

    const manifestUrl = "https://raw.githubusercontent.com/foundryvtt/dnd5e/master/system.json";
    const manifestInput = dialog.locator('input[name="manifest"], #install-package-url');
    await manifestInput.fill(manifestUrl);

    const installBtn = dialog
      .locator('button[data-action="installPackage"], button:has-text("Install")')
      .last();
    await expect(installBtn).toBeEnabled();

    // We don't actually click install here to avoid network dependencies and state pollution
    // but we've verified the path to it is open and the helpers work.
    const closeBtn = dialog.locator('button[data-action="close"], .header-button.close');
    await closeBtn.click();
    await expect(dialog).toBeHidden();
  });
});
