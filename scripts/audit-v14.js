import { chromium } from 'playwright';
import 'dotenv/config';

async function audit() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const adminPassword = process.env.FOUNDRY_ADMIN_KEY || 'password';
  const baseUrl = 'http://localhost:30000';

  console.log('--- STARTING STANDALONE V14 AUDIT ---');
  
  try {
    console.log(`Navigating to ${baseUrl}...`);
    await page.goto(baseUrl);
    await page.waitForLoadState('networkidle');
    console.log('Current URL:', page.url());

    // Stage: EULA
    if (page.url().includes('/license')) {
      console.log('\nAudit: EULA Screen');
      const eulaData = await page.evaluate(() => {
        const agreement = document.querySelector('#eula-agree, [name="agree"]');
        const sign = document.querySelector('#sign, button[data-action="accept"]');
        return {
          agreement: agreement ? { id: agreement.id, type: agreement.tagName } : 'Not found',
          sign: sign ? { id: sign.id, text: sign.textContent?.trim(), html: sign.outerHTML } : 'Not found'
        };
      });
      console.log('EULA DOM:', JSON.stringify(eulaData, null, 2));

      await page.locator('input#eula-agree, [name="agree"]').check();
      await page.locator('button#sign, button[data-action="accept"]').click();
      await page.waitForURL(u => !u.pathname.includes('/license'), { timeout: 30000 }).catch(() => null);
    }

    // Stage: Auth
    if (page.url().includes('/auth')) {
      console.log('\nAudit: Auth Screen');
      const authDOM = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('button, a, input')).map(el => ({
              tag: el.tagName,
              text: el.textContent?.trim(),
              name: el.getAttribute('name'),
              id: el.id
          }));
      });
      console.log('Auth Screen DOM:', JSON.stringify(authDOM, null, 2));

      await page.locator('input[name="adminPassword"]').fill(adminPassword);
      await page.locator('button[name="submit"], button:has-text("Log In")').first().click();
      await page.waitForURL(/\/setup/, { timeout: 30000 }).catch(() => null);
    }

    console.log('\nAudit: Setup Screen');
    console.log('Current URL:', page.url());
    
    // V14 needs time to load the SPA
    console.log('Waiting for app to load...');
    await page.waitForSelector('foundry-app, .window-app, nav.tabs', { timeout: 15000 }).catch(() => console.log('Wait timeout...'));

    const setupData = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('nav.tabs *, [data-action="tab"], [role="tab"]')).map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim(),
        dataAction: el.dataset?.action,
        dataTab: el.dataset?.tab,
        classes: Array.from(el.classList)
      }));

      const buttons = Array.from(document.querySelectorAll('button')).map(el => ({
        text: el.textContent?.trim(),
        dataAction: el.dataset?.action,
        classes: Array.from(el.classList)
      }));
      
      const body = document.body.innerHTML.substring(0, 5000); // First 5k chars

      return { tabs, buttons, body };
    });
    
    if (setupData.tabs.length === 0) {
        console.log('Setup screen appears empty! Body dump (partial):', setupData.body);
    } else {
        console.log('Setup Tabs:', JSON.stringify(setupData.tabs, null, 2));
        console.log('Setup Buttons:', JSON.stringify(setupData.buttons, null, 2));
    }

    // Trigger Install System
    console.log('\nTriggering Install System...');
    const installBtn = page.locator('button').filter({ hasText: /Install System/i }).first();
    if (await installBtn.isVisible()) {
        await installBtn.click();
        await page.waitForTimeout(3000);

        const dialogData = await page.evaluate(() => {
          const dialog = document.querySelector('foundry-app, .window-app, dialog, .application');
          if (!dialog) return 'No dialog found';
          return {
            tag: dialog.tagName,
            html: dialog.outerHTML.substring(0, 1000) // First 1k chars
          };
        });
        console.log('Install Dialog HTML (partial):', dialogData);
    } else {
        console.log('Install System button not found.');
    }

  } catch (e) {
    console.error('Audit Failed:', e);
  } finally {
    await browser.close();
    console.log('\n--- AUDIT COMPLETE ---');
  }
}

audit();
