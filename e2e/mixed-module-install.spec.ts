import { test, expect } from "../src/index.js";
import { foundrySetup, foundryTeardown, loginAs } from "../src/index.js";

test.describe("Mixed Module Install Verification", () => {
  const worldId = "mixed-module-verify-world";
  const adminPassword = process.env.FOUNDRY_ADMIN_KEY || "password";
  // A small, always-published module with a stable manifest URL, unrelated
  // to this library - used purely as "some real module only installable
  // via manifest URL, not necessarily in the local package browser search
  // index", to exercise the manifest+id co-existence path (verified live
  // against https://github.com/ruipin/fvtt-lib-wrapper).
  const manifestUrl =
    "https://github.com/ruipin/fvtt-lib-wrapper/releases/latest/download/module.json";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(900000); // 15 minutes — Docker + system install + world setup can be slow
    const page = await browser.newPage();
    await foundrySetup(page, {
      worldId,
      userName: "Gamemaster",
      adminPassword,
      // moduleId activates both regardless of install path - lib-wrapper
      // installs via moduleManifest below, fake-module via the registry
      // search installModules already exercises elsewhere.
      moduleId: ["fake-module", "lib-wrapper"],
      moduleManifest: manifestUrl,
    });
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(120000); // 2 minutes
    const page = await browser.newPage();
    await foundryTeardown(page, { worldId, adminPassword });
    await page.close();
  });

  test("foundrySetup installs and activates both a manifest module and a registry module together", async ({
    page,
  }) => {
    await loginAs(page, "Gamemaster");

    const modules = await page.evaluate(() => {
      const g = window.game;
      return Array.from(g.modules.values() as Iterable<{ id: string; active: boolean }>).filter(
        (m) => m.id === "fake-module" || m.id === "lib-wrapper",
      );
    });

    const fakeModule = modules.find((m) => m.id === "fake-module");
    const libWrapper = modules.find((m) => m.id === "lib-wrapper");

    expect(fakeModule?.active).toBe(true);
    expect(libWrapper?.active).toBe(true);
  });
});
