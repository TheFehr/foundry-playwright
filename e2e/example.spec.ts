import { test, expect } from '../src/index.js';
import { foundrySetup, foundryTeardown } from '../src/index.js';

// This is an example of how a consumer would use the library
test.describe('Foundry VTT Library Example', () => {
  
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await foundrySetup(page, {
      worldId: 'test-world',
      userName: 'Gamemaster',
      adminPassword: 'admin', // Should come from env in real usage
      moduleId: 'my-module',
      systemId: 'dnd5e',
      systemLabel: 'Dungeons & Dragons Fifth Edition',
    });
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await foundryTeardown(page, {
      worldId: 'test-world',
      adminPassword: 'admin',
    });
    await page.close();
  });

  test('should have game ready', async ({ page, foundry }) => {
    await page.goto('/');
    
    // Using state manipulation
    await foundry.state.createTestActor('Example Actor');
    await foundry.state.grantCurrency('Example Actor', 50, 'gp');
    
    // Using UI interaction (if an actor sheet was open)
    // await foundry.ui.switchActorTab('Example Actor', 'Inventory');

    const isReady = await page.evaluate(() => (window as any).game?.ready);
    expect(isReady).toBe(true);
  });
});
