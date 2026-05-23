import { FoundryPage, UserRole } from "./types/index.js";
import { getSystemStateAdapter, SystemStateAdapter } from "./systems/index.js";
import { DeprecationTracker } from "./deprecations.js";

/**
 * Provides methods for direct manipulation of the Foundry VTT state.
 */
export class FoundryState {
  private adapter: SystemStateAdapter;

  constructor(
    private page: FoundryPage,
    private systemId: string = "dnd5e",
    private deprecationTracker?: DeprecationTracker,
  ) {
    this.adapter = getSystemStateAdapter(systemId, page);
  }

  /**
   * Sets the system adapter to use.
   */
  setSystem(systemId: string) {
    this.systemId = systemId;
    this.adapter = getSystemStateAdapter(systemId, this.page);
  }

  /**
   * Aggressively removes properties known to trigger deprecation warnings on access.
   * This is used before returning data from page.evaluate.
   */
  private static get SanitizerScript() {
    return `(obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        const deprecatedDnD5e = ['darkvision', 'blindsight', 'tremorsense', 'truesight', 'special'];
        const cleanSenses = (o) => {
            if (!o || typeof o !== 'object') return o;
            const result = Array.isArray(o) ? [] : {};
            for (let key in o) {
                if (key === 'senses') {
                    const senses = o[key];
                    const cleanS = Array.isArray(senses) ? [] : {};
                    for (let skey in senses) {
                        if (deprecatedDnD5e.includes(skey)) continue;
                        cleanS[skey] = senses[skey];
                    }
                    result[key] = cleanS;
                } else {
                    result[key] = cleanSenses(o[key]);
                }
            }
            return result;
        };
        return cleanSenses(obj);
    }`;
  }

  /**
   * Creates a new Foundry VTT document.
   * @param documentName The type of document (e.g., "Actor", "Item").
   * @param data The document data.
   */
  async createDocument(documentName: string, data: Record<string, unknown>) {
    return this.page.evaluate(
      async ({ documentName, data, sanitizer }) => {
        const cls = window.CONFIG[documentName].documentClass;
        const doc = await cls.create(data);
        if (!doc) return null;
        // Use raw _source to avoid getters/deprecations
        const obj = doc._source ? JSON.parse(JSON.stringify(doc._source)) : doc.toObject();
        const sanitize = new Function(`return ${sanitizer}`)();
        return sanitize(obj);
      },
      { documentName, data, sanitizer: FoundryState.SanitizerScript },
    );
  }

  /**
   * Updates an existing document in Foundry VTT.
   * @param documentName The name of the document type.
   * @param id The ID of the document to update.
   * @param delta The data to update.
   */
  async updateDocument(documentName: string, id: string, delta: Record<string, unknown>) {
    return this.page.evaluate(
      ({ documentName, id, delta }) => {
        const doc = window.game.collections.get(documentName).get(id);
        if (!doc) throw new Error(`Document ${documentName}/${id} not found`);
        return doc.update(delta);
      },
      { documentName, id, delta },
    );
  }

  /**
   * Deletes a document in Foundry VTT.
   * @param documentName The name of the document type.
   * @param id The ID of the document to delete.
   */
  async deleteDocument(documentName: string, id: string) {
    return this.page.evaluate(
      ({ documentName, id }) => {
        const doc = window.game.collections.get(documentName).get(id);
        if (!doc) throw new Error(`Document ${documentName}/${id} not found`);
        return doc.delete();
      },
      { documentName, id },
    );
  }

  /**
   * Gets a document by its ID.
   * @param documentName The name of the document type.
   * @param id The ID of the document.
   */
  async getDocument(documentName: string, id: string) {
    return this.page.evaluate(
      ({ documentName, id, sanitizer }) => {
        const doc = window.game.collections.get(documentName).get(id);
        if (!doc) return null;
        // Use raw _source to avoid getters/deprecations
        const obj = doc._source ? JSON.parse(JSON.stringify(doc._source)) : doc.toObject();
        const sanitize = new Function(`return ${sanitizer}`)();
        return sanitize(obj);
      },
      { documentName, id, sanitizer: FoundryState.SanitizerScript },
    );
  }

  /**
   * Gets a document by its name.
   * @param documentName The name of the document type.
   * @param name The name of the document.
   */
  async getDocumentByName(documentName: string, name: string) {
    return this.page.evaluate(
      ({ documentName, name, sanitizer }) => {
        const g = window.game;
        const collection =
          g.collections.get(documentName) ||
          (g as Record<string, unknown>)[documentName.toLowerCase() + "s"];
        const c = collection as unknown as {
          getName: (name: string) => FoundryDocument | undefined;
        };
        if (!c || typeof c.getName !== "function") return null;
        const doc = c.getName(name);
        if (!doc) return null;
        // Use raw _source to avoid getters/deprecations
        const obj = doc._source ? JSON.parse(JSON.stringify(doc._source)) : doc.toObject();
        const sanitize = new Function(`return ${sanitizer}`)();
        return sanitize(obj);
      },
      { documentName, name, sanitizer: FoundryState.SanitizerScript },
    );
  }

  /**
   * Creates a new User.
   */
  async createUser(name: string, role: UserRole = UserRole.PLAYER, password?: string) {
    return this.page.evaluate(
      ({ name, role, password }) => {
        return (
          window.game.users.documentClass as {
            create: (data: Record<string, unknown>) => Promise<User>;
          }
        ).create({ name, role, password });
      },
      { name, role, password },
    );
  }

  /**
   * Sets a user's role.
   */
  async setUserRole(userId: string, role: UserRole) {
    return this.page.evaluate(
      ({ userId, role }) => {
        const user = window.game.users.get(userId);
        if (!user) throw new Error(`User not found: ${userId}`);
        return user.update({ role });
      },
      { userId, role },
    );
  }

  /**
   * Configures a specific permission for a user role.
   */
  async setRolePermission(permission: string, role: UserRole, allowed: boolean) {
    return this.page.evaluate(
      ({ permission, role, allowed }) => {
        const current =
          (window.game.settings.get("core", "permissions") as Record<string, unknown>) || {};
        const p = current[permission];
        let updateValue: unknown;

        if (Array.isArray(p)) {
          const newP = [...p];
          // Ensure array is long enough
          while (newP.length <= role) newP.push(0);
          newP[role] = allowed ? 1 : 0;
          updateValue = newP;
        } else if (typeof p === "object" && p !== null) {
          updateValue = { ...p, [role]: allowed };
        } else {
          // If it's a number (minimum role level), we might want to convert it to an object
          // but for now let's just use the object format if we're setting specific roles
          updateValue = { [role]: allowed };
        }

        const update = { ...current, [permission]: updateValue };
        return window.game.settings.set("core", "permissions", update);
      },
      { permission, role, allowed },
    );
  }

  /**
   * Grants currency to an actor.
   * @param actorName The name of the actor.
   * @param amount The amount of currency to grant.
   * @param currency The type of currency (e.g., "gp", "sp").
   */
  async grantCurrency(actorName: string, amount: number, currency: string = "gp") {
    return this.adapter.grantCurrency(this.page, actorName, amount, currency);
  }

  /**
   * Gets the verification parameters for a currency update.
   */
  getCurrencyVerifyParams(actorName: string, amount: number, currency: string = "gp") {
    return this.adapter.getCurrencyVerifyParams(actorName, amount, currency);
  }

  /**
   * Sets an actor's HP.
   * @param actorName The name of the actor.
   * @param value The new HP value.
   * @param max The new max HP value (optional).
   */
  async setActorHP(actorName: string, value: number, max?: number) {
    return this.adapter.setActorHP(this.page, actorName, value, max);
  }

  /**
   * Rolls a specific roll for an actor.
   * @param actorName The name of the actor.
   * @param formula The roll formula (e.g., "1d20 + 5").
   * @param label A label for the roll.
   */
  async roll(actorName: string, formula: string, label: string = "Test Roll") {
    return this.page.evaluate(
      ({ actorName, formula, label }) => {
        const actor = window.game.actors.getName(actorName);
        if (!actor) throw new Error(`Actor not found: ${actorName}`);

        interface RollConstructor {
          new (
            formula: string,
            data?: Record<string, unknown>,
          ): {
            toMessage(options: { flavor: string }): unknown;
          };
        }
        interface ActorWithGetRollData {
          getRollData?: () => Record<string, unknown>;
        }

        const Roll = (window as unknown as { Roll: RollConstructor }).Roll;
        const actorWithData = actor as unknown as ActorWithGetRollData;
        const roll = new Roll(formula, actorWithData.getRollData?.());
        return roll.toMessage({ flavor: label });
      },
      { actorName, formula, label },
    );
  }

  /**
   * Executes a macro by name.
   * @param name The name of the macro.
   * @param args Arguments to pass to the macro.
   */
  async executeMacro(name: string, ...args: unknown[]) {
    return this.page.evaluate(
      ({ name, args }) => {
        const macro = window.game.macros.getName(name);
        return macro?.execute(...args);
      },
      { name, args },
    );
  }

  /**
   * Manually triggers a Foundry VTT hook.
   * @param hookName The name of the hook (e.g., "renderActorSheet").
   * @param args Arguments to pass to the hook.
   */
  async triggerHook(hookName: string, ...args: unknown[]) {
    return this.page.evaluate(
      ({ hookName, args }) => {
        return window.Hooks.call(hookName, ...args);
      },
      { hookName, args },
    );
  }

  /**
   * Emits a socket event via the Foundry VTT socket.
   * @param eventName The name of the event.
   * @param data The data to emit.
   */
  async emitSocket(eventName: string, data: unknown) {
    return this.page.evaluate(
      ({ eventName, data }) => {
        return window.game.socket.emit(eventName, data);
      },
      { eventName, data },
    );
  }

  /**
   * Waits for a specific Foundry VTT hook to be called.
   * @param hookName The name of the hook.
   * @param timeout The timeout in milliseconds.
   * @returns The first argument passed to the hook.
   */
  async waitForHook(hookName: string, timeout: number = 10000) {
    await this.page.evaluate((hookName) => {
      window._hookLogs = window._hookLogs || {};
      window._hookLogs[hookName] = window._hookLogs[hookName] || [];
      window.Hooks.on(hookName, (...args: unknown[]) => {
        window._hookLogs[hookName].push(args);
      });
    }, hookName);

    await this.page.waitForFunction(
      (name) => {
        return (window._hookLogs?.[name]?.length ?? 0) > 0;
      },
      hookName,
      { timeout },
    );

    return this.page.evaluate((name) => {
      const logs = window._hookLogs[name];
      window._hookLogs[name] = [];
      return logs[0]?.[0]; // Return the first argument of the first call
    }, hookName);
  }

  /**
   * Waits for a specific socket event to be received.
   * @param eventName The name of the event.
   * @param timeout The timeout in milliseconds.
   */
  async waitForSocket(eventName: string, timeout: number = 10000) {
    await this.page.evaluate((eventName) => {
      window._socketLogs = window._socketLogs || {};
      window._socketLogs[eventName] = window._socketLogs[eventName] || 0;
      window.game.socket.on(eventName, () => {
        window._socketLogs[eventName]++;
      });
    }, eventName);

    await this.page.waitForFunction(
      (name) => {
        return window._socketLogs?.[name] > 0;
      },
      eventName,
      { timeout },
    );

    return this.page.evaluate((name) => {
      const count = window._socketLogs[name];
      window._socketLogs[name] = 0;
      return count;
    }, eventName);
  }

  /**
   * Assigns an actor to a user.
   */
  async assignActorToUser(userId: string, actorId: string) {
    return this.page.evaluate(
      ({ userId, actorId }) => {
        const user = window.game.users.get(userId);
        if (!user) throw new Error(`User not found: ${userId}`);
        return user.update({ character: actorId });
      },
      { userId, actorId },
    );
  }

  /**
   * Updates an existing user.
   */
  async updateUser(userId: string, delta: Record<string, unknown>) {
    return this.page.evaluate(
      ({ userId, delta }) => {
        const user = window.game.users.get(userId);
        if (!user) throw new Error(`User not found: ${userId}`);
        return user.update(delta);
      },
      { userId, delta },
    );
  }

  /**
   * Creates a test actor.
   */
  async createTestActor(name: string = "Test Actor") {
    const { type, system } = this.adapter.getTestActorData(name);
    return this.createDocument("Actor", { name, type, system });
  }

  /**
   * Sets or updates a Foundry VTT setting.
   */
  async setSetting(module: string, key: string, value: unknown) {
    return this.page.evaluate(
      ({ module, key, value }) => {
        return window.game.settings.set(module, key, value);
      },
      { module, key, value },
    );
  }
}
