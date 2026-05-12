/**
 * FP_VERIFY Protocol Implementation
 * This module provides a global registry for verification in Playwright tests.
 */

(function() {
    console.log('FP_VERIFY: Script execution started.');

    try {
        class FPVerify {
          constructor() {
            this.reset();
            this.setupInterceptors();
            this.setupMocks();
            this.registerSettings();
            
            const tourProgress = { core: { backupsOverview: 1, welcome: 1, setup: 1 } };
            window.localStorage.setItem("core.tourProgress", JSON.stringify(tourProgress));
            console.log('FP_VERIFY: Protocol Initialized.');
          }

          reset() {
            this.logs = {};
            console.log('FP_VERIFY: Registry Reset.');
          }

          /**
           * Aggressively removes properties known to trigger deprecation warnings on access.
           */
          sanitize(data) {
              if (!data || typeof data !== 'object') return data;
              try {
                  // Known problematic keys in DnD5e
                  const deprecatedDnD5e = ['darkvision', 'blindsight', 'tremorsense', 'truesight', 'special'];
                  
                  const cleanObject = (obj) => {
                      if (!obj || typeof obj !== 'object' || obj instanceof Document) return obj;
                      const result = Array.isArray(obj) ? [] : {};
                      for (let key in obj) {
                          if (deprecatedDnD5e.includes(key)) continue;
                          
                          // Avoid deep recursion into large structures to prevent stack overflow
                          const val = obj[key];
                          if (val && typeof val === 'object' && !(val instanceof Document)) {
                              if (key === 'senses') {
                                  const senses = {};
                                  for (let skey in val) {
                                      if (!deprecatedDnD5e.includes(skey)) senses[skey] = val[skey];
                                  }
                                  result[key] = senses;
                              } else {
                                  // Just a shallow copy for everything else to be safe
                                  result[key] = val;
                              }
                          } else {
                              result[key] = val;
                          }
                      }
                      return result;
                  };

                  let base = data;
                  // Prioritize raw database data (_source) to avoid schema-level getters/deprecations
                  if (data._source) base = data._source;
                  else if (data.toObject) base = data.toObject();
                  
                  return cleanObject(base);
              } catch (e) {
                  return { error: "Sanitization failed", message: e.message };
              }
          }

          log(key, data) {
            if (!this.logs[key]) this.logs[key] = [];
            this.logs[key].push({ timestamp: Date.now(), ...this.sanitize(data) });
            console.log(`FP_VERIFY: Logged "${key}"`);
          }

          setupInterceptors() {
            document.body.addEventListener('drop', (event) => {
                try {
                    const dataTransfer = event.dataTransfer.getData('text/plain');
                    if (dataTransfer) {
                        const dropData = JSON.parse(dataTransfer);
                        this.log('actor-sheet-drop', { global: true, dropData });
                    }
                } catch (e) {}
            }, { capture: true });

            const docs = ['Actor', 'Item', 'Scene', 'User', 'JournalEntry', 'RollTable'];
            docs.forEach(d => {
              Hooks.on(`create${d}`, (doc) => {
                  this.log(`${d.toLowerCase()}-create`, { id: doc.id, name: doc.name, data: doc });
              });
              Hooks.on(`update${d}`, (doc, delta) => {
                  this.log(`${d.toLowerCase()}-update`, { id: doc.id, name: doc.name, delta });
              });
              Hooks.on(`delete${d}`, (doc) => this.log(`${d.toLowerCase()}-delete`, { id: doc.id }));
            });

            if (typeof game !== 'undefined' && game.socket) {
                game.socket.on('module.fake-module', (data) => {
                    if (data.type === 'fireHook') Hooks.call(data.hook, data.data);
                });
            }

            const setupDropListener = (html, app) => {
              const element = html instanceof HTMLElement ? html : (html[0] || html);
              if (!element || !element.addEventListener) return;
              if (element.dataset.fpVerifyDropAttached) return;
              element.dataset.fpVerifyDropAttached = "true";

              element.addEventListener('drop', (event) => {
                try {
                    const dataTransfer = event.dataTransfer.getData('text/plain');
                    const dropData = dataTransfer ? JSON.parse(dataTransfer) : { raw: dataTransfer };
                    this.log('actor-sheet-drop', { actorId: app.document?.id || app.id, dropData });
                } catch (e) { this.log('actor-sheet-drop', { error: e.message }); }
              }, { capture: true });
            };

            Hooks.on('renderActorSheet', (app, html, data) => setupDropListener(html, app));
            Hooks.on('renderActorSheetV2', (app, html, data) => setupDropListener(html, app));
            Hooks.on('renderApplication', (app, html, data) => setupDropListener(html, app));
            Hooks.on('renderApplicationV2', (app, html, data) => setupDropListener(html, app));
            Hooks.on('renderDocumentSheet', (app, html, data) => setupDropListener(html, app));
          }

          setupMocks() {
            const originalCall = Hooks.call;
            Hooks.call = (hook, ...args) => {
                if (hook === 'ready') this.log('ready', { timestamp: Date.now() });
                return originalCall.apply(Hooks, [hook, ...args]);
            };
          }

          registerSettings() {
            if (typeof game !== 'undefined' && game.settings) {
                const settingsMap = game.settings.settings || game.settings.registry;
                if (settingsMap && settingsMap.has('fake-module.test-string')) return true;
                
                console.log('FP_VERIFY: Registering test-string setting...');
                try {
                    game.settings.register('fake-module', 'test-string', {
                      name: 'Test String', scope: 'world', config: true, type: String, default: ''
                    });
                    return true;
                } catch (e) {
                    console.warn('FP_VERIFY: Settings registration deferred:', e.message);
                    return false;
                }
            }
            return false;
          }
        }

        const init = () => {
            if (typeof Hooks !== 'undefined') {
                if (window.FP_VERIFY) return true;
                window.FP_VERIFY = new FPVerify();
                window.FP_VERIFY_RESET = () => window.FP_VERIFY.reset();
                
                // Silence compatibility warnings
                if (typeof CONFIG !== 'undefined' && CONFIG.compatibility) {
                    CONFIG.compatibility.mode = 0; // CONST.COMPATIBILITY_MODES.SILENT
                }

                console.log('FP_VERIFY: Successfully initialized.');
                return true;
            }
            return false;
        };

        const tryRegisterCategories = () => {
            try {
                const api = foundry.applications?.api;
                const sheets = foundry.applications?.sheets;
                
                if (api?.ApplicationV2 && !window.FakeAppV2) {
                    window.FakeAppV2 = class FakeAppV2 extends api.ApplicationV2 {
                        static DEFAULT_OPTIONS = {
                            id: 'fake-app-v2', tag: 'form', window: { title: 'Fake App V2' },
                            actions: { logTab: (event, target) => window.FP_VERIFY.log('app-v2-tab-click', { tab: target.dataset.tab }) }
                        };
                        _prepareContext(options) { return { ...super._prepareContext(options), tabs: { general: { label: 'General' }, advanced: { label: 'Advanced' } } }; }
                        async _renderHTML(context, options) {
                            const div = document.createElement('div');
                            div.innerHTML = `<nav class="tabs"><a class="item" data-tab="general" data-action="logTab">General</a><a class="item" data-tab="advanced" data-action="logTab">Advanced</a></nav>
                                            <section class="tab" data-tab="general" id="tab-general-content"><p>General Content</p></section>
                                            <section class="tab" data-tab="advanced" id="tab-advanced-content"><p>Advanced Content</p></section>`;
                            return div;
                        }
                        _replaceHTML(result, content, options) { content.replaceWith(result); }
                    };
                    const m = typeof game !== 'undefined' ? game.modules?.get('fake-module') : null;
                    if (m) m.FakeAppV2 = window.FakeAppV2;
                    console.log('FP_VERIFY: FakeAppV2 registered.');
                }

                const ActorSheetClass = foundry.applications?.sheets?.ActorSheet || foundry.appv1?.sheets?.ActorSheet || (typeof ActorSheet !== 'undefined' ? ActorSheet : null);
                const ActorsCollection = foundry.documents?.collections?.Actors || (typeof Actors !== 'undefined' ? Actors : null);

                if (ActorSheetClass && !window.FakeTidySheet) {
                    window.FakeTidySheet = class FakeTidySheet extends ActorSheetClass {
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
                    };
                    if (typeof game !== 'undefined' && game.system?.id === 'dnd5e' && ActorsCollection) {
                        ActorsCollection.registerSheet('dnd5e', window.FakeTidySheet, { types: ['character'], makeDefault: false, label: 'Fake Tidy Sheet' });
                    }
                    const m = typeof game !== 'undefined' ? game.modules?.get('fake-module') : null;
                    if (m) m.FakeTidySheet = window.FakeTidySheet;
                    console.log('FP_VERIFY: FakeTidySheet registered.');
                }

                if (!window.FakeTour) {
                    window.FakeTour = class FakeTour {
                        constructor() { this.id = 'test-tour'; }
                        start() { window.FP_VERIFY.log('tour-started', { id: this.id }); }
                    };
                    const m = typeof game !== 'undefined' ? game.modules?.get('fake-module') : null;
                    if (m) m.FakeTour = window.FakeTour;
                    console.log('FP_VERIFY: FakeTour registered.');
                }
            } catch (e) { console.error('FP_VERIFY: tryRegisterCategories error:', e); }
        };

        init();
        tryRegisterCategories();

        const interval = setInterval(() => {
            const initialized = init();
            if (window.FP_VERIFY) window.FP_VERIFY.registerSettings();
            tryRegisterCategories();
            if (initialized && window.FakeAppV2 && window.FakeTidySheet) clearInterval(interval);
        }, 100);

        if (typeof Hooks !== 'undefined') {
            Hooks.on('init', init);
            Hooks.on('ready', () => { init(); tryRegisterCategories(); });
        }

    } catch (e) { console.error('FP_VERIFY: Critical error:', e); }

})();
