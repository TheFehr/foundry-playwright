/**
 * FP_VERIFY Protocol Implementation
 * This module provides a global registry for verification in Playwright tests.
 */

class FPVerify {
  constructor() {
    this.reset();
    this.setupInterceptors();
    this.setupMocks();
    this.registerSettings();
    this.setupAppV2();
    this.setupTourMock();
    this.setupTidyMock();
    
    // Ensure tour progress is set for verification tests
    const tourProgress = { core: { backupsOverview: 1, welcome: 1, setup: 1 } };
    window.localStorage.setItem("core.tourProgress", JSON.stringify(tourProgress));

    console.log('FP_VERIFY: Protocol Initialized.');
  }

  reset() {
    this.logs = {};
    console.log('FP_VERIFY: Registry Reset.');
  }

  log(key, data) {
    if (!this.logs[key]) this.logs[key] = [];
    this.logs[key].push({
      timestamp: Date.now(),
      ...data
    });
    console.log(`FP_VERIFY: Logged "${key}"`, data);
  }

  setupInterceptors() {
    // Global Drop Listener for Debugging/Verification
    document.body.addEventListener('drop', (event) => {
        try {
            const dataTransfer = event.dataTransfer.getData('text/plain');
            if (dataTransfer) {
                const dropData = JSON.parse(dataTransfer);
                this.log('actor-sheet-drop', { 
                    global: true,
                    dropData 
                });
            }
        } catch (e) {}
    }, { capture: true });

    // Intercept Document Creation/Updates
    const docs = ['Actor', 'Item', 'Scene', 'User', 'JournalEntry', 'RollTable'];
    docs.forEach(d => {
      Hooks.on(`create${d}`, (doc) => this.log(`${d.toLowerCase()}-create`, { id: doc.id, name: doc.name, data: doc.toObject() }));
      Hooks.on(`update${d}`, (doc, delta) => this.log(`${d.toLowerCase()}-update`, { id: doc.id, name: doc.name, delta }));
      Hooks.on(`delete${d}`, (doc) => this.log(`${d.toLowerCase()}-delete`, { id: doc.id }));
    });

    // Socket-to-Hook Bridge
    game.socket.on('module.fake-module', (data) => {
        if (data.type === 'fireHook') {
            Hooks.call(data.hook, data.data);
        }
    });

    // Universal Drop Listener
    const setupDropListener = (html, app) => {
      const element = html instanceof HTMLElement ? html : (html[0] || html);
      if (!element || !element.addEventListener) return;
      if (element.dataset.fpVerifyDropAttached) return;
      element.dataset.fpVerifyDropAttached = "true";

      element.addEventListener('drop', (event) => {
        try {
            const dataTransfer = event.dataTransfer.getData('text/plain');
            const dropData = dataTransfer ? JSON.parse(dataTransfer) : { raw: dataTransfer };
            this.log('actor-sheet-drop', { 
                actorId: app.document?.id || app.id, 
                dropData 
            });
        } catch (e) {
            this.log('actor-sheet-drop', { error: e.message });
        }
      }, { capture: true }); // Use capture phase
    };

    Hooks.on('renderActorSheet', (app, html, data) => setupDropListener(html, app));
    Hooks.on('renderApplication', (app, html, data) => setupDropListener(html, app));
    Hooks.on('renderDocumentSheet', (app, html, data) => setupDropListener(html, app));

    // Settings Monitoring
    Hooks.on('renderSettingsConfig', (app, html, data) => {
      this.log('render-settings-config', { active: true });
    });
  }

  setupMocks() {
    const originalCall = Hooks.call;
    Hooks.call = (hook, ...args) => {
        if (hook.startsWith('verify') || hook.startsWith('test')) {
            this.log('custom-hook', { hook, args });
        }
        return originalCall.apply(Hooks, [hook, ...args]);
    };
  }

  registerSettings() {
    game.settings.register('fake-module', 'test-bool', {
      name: 'Test Boolean',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false
    });

    game.settings.register('fake-module', 'test-string', {
      name: 'Test String',
      scope: 'world',
      config: true,
      type: String,
      default: ''
    });
  }

  setupAppV2() {
    class FakeAppV2 extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = {
        id: 'fake-app-v2',
        tag: 'form',
        window: { title: 'Fake App V2' },
        actions: {
          logTab: function(event, target) {
            const tab = target.dataset.tab;
            window.FP_VERIFY.log('app-v2-tab-click', { tab });
          }
        }
      };
      async _renderHTML(context, options) {
        const div = document.createElement('div');
        div.innerHTML = `
          <nav class="tabs">
            <a class="item" data-tab="general" data-action="logTab">General</a>
            <a class="item" data-tab="advanced" data-action="logTab">Advanced</a>
          </nav>
          <section class="tab" data-tab="general" id="tab-general-content">
            <p>General Content</p>
          </section>
          <section class="tab" data-tab="advanced" id="tab-advanced-content">
            <p>Advanced Content</p>
          </section>
        `;
        return div;
      }
      _replaceHTML(result, content, options) {
        content.replaceWith(result);
      }
    }
    game.modules.get('fake-module').FakeAppV2 = FakeAppV2;
  }

  setupTourMock() {
    class FakeTour {
        constructor() { this.id = 'test-tour'; }
        start() { window.FP_VERIFY.log('tour-started', { id: this.id }); }
    }
    game.modules.get('fake-module').FakeTour = FakeTour;
  }

  setupTidyMock() {
    class FakeTidySheet extends ActorSheet {
      static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
          template: 'modules/fake-module/templates/tidy-mock.hbs',
          classes: ['tidy5e-sheet', 'dnd5e', 'sheet', 'actor', 'character']
        });
      }
      activateListeners(html) {
          super.activateListeners(html);
          const tabs = html.find('.tidy-tabs [data-tab], nav.tabs a.item, .navigation .item');
          tabs.click(ev => {
              const tab = ev.currentTarget.dataset.tab || ev.currentTarget.innerText;
              window.FP_VERIFY.log('tidy-tab-click', { tab });
              tabs.removeClass('active selected');
              $(ev.currentTarget).addClass('active');
          });
      }
    }
    if (game.system.id === 'dnd5e') {
      Actors.registerSheet('dnd5e', FakeTidySheet, { types: ['character'], makeDefault: false, label: 'Fake Tidy Sheet' });
    }
    game.modules.get('fake-module').FakeTidySheet = FakeTidySheet;
  }
}

Hooks.once('init', () => {
  window.FP_VERIFY = new FPVerify();
  window.FP_VERIFY_RESET = () => window.FP_VERIFY.reset();
});
