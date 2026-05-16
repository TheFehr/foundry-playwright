import fs from "fs";
import path from "path";

/**
 * Action for the 'init' CLI command.
 * Bootstraps a new Foundry E2E test project.
 */
export async function initAction() {
  console.log("🚀 Initializing foundry-playwright project...");

  const packageJsonPath = path.join(process.cwd(), "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    console.error("❌ package.json not found. Please run this in a Node.js project root.");
    process.exit(1);
  }

  // 1. Update package.json scripts
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  packageJson.scripts = packageJson.scripts || {};

  const testCommand = "foundry-playwright test --docker";
  if (!packageJson.scripts["test:e2e"]) {
    packageJson.scripts["test:e2e"] = testCommand;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log("✅ Added 'test:e2e' script to package.json");
  } else {
    console.log("ℹ️ 'test:e2e' script already exists in package.json. Skipping.");
  }

  // 2. Create playwright.config.ts
  const configPath = path.join(process.cwd(), "playwright.config.ts");
  if (!fs.existsSync(configPath)) {
    const configContent = `import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Foundry VTT E2E testing.
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120000, // 2 minutes for slow Foundry boots
  expect: {
    timeout: 10000,
  },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [["html", { open: "never" }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like \`await page.goto('/')\`. */
    baseURL: process.env.FOUNDRY_URL || "http://localhost:30000",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
`;
    fs.writeFileSync(configPath, configContent);
    console.log("✅ Created playwright.config.ts");
  } else {
    console.log("ℹ️ playwright.config.ts already exists. Skipping.");
  }

  // 3. Create e2e directory and a sample test
  const e2eDir = path.join(process.cwd(), "e2e");
  if (!fs.existsSync(e2eDir)) {
    fs.mkdirSync(e2eDir);
    console.log("✅ Created 'e2e' directory");
  }

  const sampleTestPath = path.join(e2eDir, "basic.spec.ts");
  if (!fs.existsSync(sampleTestPath)) {
    const sampleTestContent = `import { test, expect, useFoundry } from "@thefehr/foundry-playwright";

/**
 * This helper ensures that the Foundry VTT instance is fully set up
 * with the desired world, system, and modules before any tests run.
 */
useFoundry(test, {
  worldId: "test-world",
  systemId: "dnd5e",
  // moduleId: "my-module", // Uncomment and replace with your module ID
});

test("Foundry VTT is loaded and reachable", async ({ page }) => {
  await page.goto("/");
  
  // Wait for the game to be ready (handled by foundrySetup, but good to check)
  await expect(page).toHaveTitle(/Foundry VTT/);
  
  const gamePaused = await page.evaluate(() => game.paused);
  console.log("Is the game paused?", gamePaused);
});

test("Can interact with Foundry State", async ({ foundry }) => {
  // The 'foundry' fixture provides direct access to state manipulation
  const actors = await foundry.state.getDocuments("Actor");
  console.log(\`Found \${actors.length} actors in the world.\`);
});
`;
    fs.writeFileSync(sampleTestPath, sampleTestContent);
    console.log("✅ Created e2e/basic.spec.ts (sample test)");
  } else {
    console.log("ℹ️ e2e/basic.spec.ts already exists. Skipping.");
  }

  // 4. Create .env.template
  const envTemplatePath = path.join(process.cwd(), ".env.template");
  if (!fs.existsSync(envTemplatePath)) {
    const envContent = `FOUNDRY_ADMIN_KEY=password
FOUNDRY_VERSION=13.351.0
FOUNDRY_SYSTEM_ID=dnd5e
`;
    fs.writeFileSync(envTemplatePath, envContent);
    console.log("✅ Created .env.template");
  } else {
    console.log("ℹ️ .env.template already exists. Skipping.");
  }

  console.log("\n🎉 Setup complete! You can now run your tests with:");
  console.log("   npm run test:e2e");
}
