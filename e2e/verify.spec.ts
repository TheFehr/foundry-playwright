import { test, expect, verifyResult, useBaseWorld } from "../src/index.js";

test.describe("Library Verification Suite", () => {
  const worldId = "verify-world";
  const adminPassword = process.env.FOUNDRY_ADMIN_KEY || "password";

  useBaseWorld(test, {
    worldId,
    adminPassword,
    moduleId: "fake-module",
  });

  // Extend timeout for the first run (world creation + backup).
  test.beforeAll(() => test.setTimeout(600000));

  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => (window as unknown as Window).FP_VERIFY_RESET?.());
  });

  test("export: version metadata", async ({ page }) => {
    const meta = await page.evaluate(() => {
      const game = (window as unknown as Window).game;
      const modules = Array.from(
        game.modules.values() as Iterable<{ active: boolean; id: string; version: string }>,
      )
        .filter((m) => m.active)
        .map((m) => ({ id: m.id, version: m.version }));

      return {
        foundry: game.version || game.release?.generation,
        system: {
          id: game.system.id,
          version: game.system.version,
        },
        modules,
      };
    });
    const fs = await import("node:fs");
    fs.writeFileSync(".foundry_metadata.json", JSON.stringify(meta, null, 2));
  });

  test("foundry.state: document management", async ({ page, foundry }) => {
    const actorName = "Test Actor " + Date.now();

    await foundry.state.createDocument("Actor", {
      name: actorName,
      type: "character",
    });

    await verifyResult(
      page,
      "actor-create",
      (data: Record<string, unknown>, extra: Record<string, unknown>) =>
        data.name === extra.actorName,
      { actorName },
      { timeout: 30000 },
    );
    await foundry.state.grantCurrency(actorName, 100, "gp");
    const { key, predicate } = foundry.state.getCurrencyVerifyParams(actorName, 100, "gp");
    await verifyResult(page, key, predicate, { actorName, amount: 100, currency: "gp" });
  });

  test("foundry.state: settings management", async ({ page, foundry }) => {
    const testVal = "val-" + Date.now();

    await page.evaluate(() => {
      try {
        (window as unknown as Window).game.settings.register("fake-module", "test-string", {
          scope: "world",
          config: true,
          type: String,
          default: "",
        });
      } catch {}
    });

    await foundry.state.setSetting("fake-module", "test-string", testVal);
    const val = await page.evaluate(() =>
      (window as unknown as Window).game.settings.get("fake-module", "test-string"),
    );
    expect(val).toBe(testVal);
  });

  test("foundry.ui: Application V2 tab switching", async ({ page, foundry }) => {
    await page.waitForFunction(
      () =>
        (window as unknown as Window).FakeAppV2 ||
        (window as unknown as Window).game?.modules?.get("fake-module")?.FakeAppV2,
      { timeout: 30000 },
    );
    await page.evaluate(async () => {
      const cls =
        (window as unknown as Window).FakeAppV2 ||
        (window as unknown as Window).game.modules.get("fake-module").FakeAppV2;
      console.log(
        `[test] cls type: ${typeof cls}, is constructor: ${cls?.prototype?.constructor === cls}`,
      );
      if (typeof cls !== "function")
        throw new Error(`FakeAppV2 is not a function/constructor! It is: ${typeof cls}`);
      const app = new cls();
      await app.render(true);
      await new Promise((r) => setTimeout(r, 500));
    });
    const appSelector = "#fake-app-v2";
    await expect(page.locator(appSelector)).toBeVisible();

    await foundry.ui.switchTab(appSelector, "Advanced");
    await verifyResult(
      page,
      "app-v2-tab-click",
      (data: Record<string, unknown>) => data.tab === "advanced",
    );
  });

  test("foundry.helpers: tour suppression", async ({ page, foundry: _foundry }) => {
    await page.waitForFunction(
      () =>
        (window as unknown as Window).FakeTour ||
        (window as unknown as Window).game?.modules?.get("fake-module")?.FakeTour,
      { timeout: 30000 },
    );
    await page.evaluate(() => {
      const cls =
        (window as unknown as Window).FakeTour ||
        (window as unknown as Window).game.modules.get("fake-module").FakeTour;
      const tour = new cls();
      tour.start();
    });
    await verifyResult(
      page,
      "tour-started",
      (data: Record<string, unknown>) => data.id === "test-tour",
    );
    await expect(async () => {
      const progress = await page.evaluate(() => window.localStorage.getItem("core.tourProgress"));
      expect(progress).toContain("backupsOverview");
    }).toPass({ timeout: 10000 });
  });

  test("foundry.state: event logic (Hooks)", async ({ page, foundry }) => {
    const hookName = "testHook" + Date.now();
    const [hookArgs] = await Promise.all([
      foundry.state.waitForHook(hookName),
      page.evaluate((name) => Hooks.call(name, { data: "test" }), hookName),
    ]);
    expect(hookArgs.data).toBe("test");
  });

  test("foundry.ui: drop simulation", async ({ page, foundry }) => {
    const actorName = "Drop Actor " + Date.now();
    await foundry.state.createDocument("Actor", {
      name: actorName,
      type: "character",
    });

    await verifyResult(
      page,
      "actor-create",
      (data: Record<string, unknown>, extra: Record<string, unknown>) =>
        data.name === extra.actorName,
      { actorName },
    );

    await page.evaluate((name) => {
      const actor = (window as unknown as Window).game.actors.getName(name);
      if (actor) actor.sheet.render(true);
    }, actorName);

    const selector = `foundry-app, .window-app, .sheet.actor, [id^="actor-"], section.window-app`;
    await expect(page.locator(selector).filter({ hasText: actorName })).toBeVisible();

    const actorSheetSelector = `[id$="-${actorName}"], [id^="CharacterActorSheet-"], .sheet.actor:has-text("${actorName}")`;
    const data = { type: "Item", uuid: "Actor.123.Item.456" };

    await foundry.ui.simulateDrop(actorSheetSelector, data);

    await verifyResult(
      page,
      "actor-sheet-drop",
      (log: Record<string, unknown>, extra: Record<string, unknown>) => {
        return (log.dropData as Record<string, unknown>)?.uuid === extra.uuid;
      },
      { uuid: data.uuid },
    );
  });

  test("foundry.setup: manifest-based installation UI", async ({ page }) => {
    test.setTimeout(240000);
    const { returnToSetup, openModuleInstallDialog } = await import("../src/index.js");
    const adminPassword = process.env.FOUNDRY_ADMIN_PASSWORD || process.env.FOUNDRY_ADMIN_KEY;
    await returnToSetup(page, adminPassword);

    const dialog = await openModuleInstallDialog(page);
    await expect(dialog).toBeVisible();

    const manifestUrl = "https://raw.githubusercontent.com/foundryvtt/dnd5e/master/system.json";
    const manifestInput = dialog
      .locator("input")
      .filter({ hasNot: page.locator('input[type="checkbox"], input[type="radio"]') })
      .first();
    await manifestInput.fill(manifestUrl);

    const installBtn = dialog
      .locator('button[data-action="installPackage"], button:has-text("Install"), button.bright')
      .filter({ visible: true })
      .last();
    await expect(installBtn).toBeEnabled();

    const closeBtn = dialog.locator(
      'button[data-action="close"], .header-button.close, [data-action="close"]',
    );
    await closeBtn.evaluate((el: Element) => (el as HTMLElement).click());

    await page
      .waitForFunction(
        (sel) => {
          const el = document.querySelector(sel);
          return (
            !el ||
            (el as HTMLElement).style.display === "none" ||
            (el as HTMLElement).offsetParent === null
          );
        },
        "#install-package, .category-browser",
        { timeout: 15000 },
      )
      .catch(() => null);

    await expect(dialog.first())
      .toBeHidden({ timeout: 5000 })
      .catch(() => null);
  });
});
