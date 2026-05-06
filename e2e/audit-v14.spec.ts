import { test } from "@playwright/test";
import { foundrySetup } from "../src/index.js";

test("V14 Setup Audit", async ({ page }) => {
  test.setTimeout(600000);
  const adminPassword = process.env.FOUNDRY_ADMIN_KEY || "password";

  console.log("\n--- STARTING V14 DOM AUDIT ---");

  await foundrySetup(page, {
    worldId: "audit-world-" + Date.now(),
    userName: "Gamemaster",
    adminPassword,
    moduleId: "fake-module",
    systemId: "dnd5e",
  });

  // Audit Setup Screen
  console.log("\nAudit: Setup Screen");
  const setupAudit = await page.evaluate(() => {
    return {
      tabs: Array.from(
        document.querySelectorAll("[data-tab], .tabs .item, [data-application-part]"),
      ).map((el) => ({
        tag: el.tagName,
        dataTab: (el as HTMLElement).dataset.tab,
        text: el.textContent?.trim(),
        classes: el.className,
      })),
    };
  });
  console.log("Setup Tabs:", JSON.stringify(setupAudit, null, 2));

  // Audit Create World Dialog
  if (page.url().includes("/setup")) {
    console.log("\nAudit: Create World Flow");
    const createBtn = page.locator('button[data-action="worldCreate"]');
    await createBtn.click();
    await page.waitForURL(/\/create/);

    const createAudit = await page.evaluate(() => {
      return {
        formId: document.querySelector("form")?.id,
        inputs: Array.from(document.querySelectorAll("input, select, button")).map((el) => ({
          tag: el.tagName,
          name: (el as any).name,
          type: (el as any).type,
          id: el.id,
          placeholder: (el as any).placeholder,
        })),
        packages: Array.from(document.querySelectorAll(".package")).map((el) => ({
          id: (el as HTMLElement).dataset.packageId,
          title:
            el.querySelector(".package-title")?.textContent?.trim() ||
            el.querySelector("h3")?.textContent?.trim(),
          parts: Array.from(el.querySelectorAll("[data-application-part]")).map((p) => ({
            part: (p as HTMLElement).dataset.applicationPart,
            text: p.textContent?.trim().substring(0, 30),
          })),
        })),
      };
    });
    console.log("Create World Audit:", JSON.stringify(createAudit, null, 2));
  }

  console.log("\n--- V14 DOM AUDIT COMPLETE ---");
});
