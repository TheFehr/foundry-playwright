import { describe, it, expect } from "vitest";
import { getSystemStateAdapter, registerSystemStateAdapter } from "./index.js";
import { DnD5eStateAdapter } from "./dnd5e.js";
import { PF2eStateAdapter } from "./pf2e.js";
import { BaseSystemStateAdapter } from "./base.js";

describe("SystemStateAdapters", () => {
  describe("getSystemStateAdapter", () => {
    it("returns DnD5eStateAdapter for 'dnd5e'", () => {
      const adapter = getSystemStateAdapter("dnd5e");
      expect(adapter).toBeInstanceOf(DnD5eStateAdapter);
      expect(adapter.id).toBe("dnd5e");
    });

    it("returns PF2eStateAdapter for 'pf2e'", () => {
      const adapter = getSystemStateAdapter("pf2e");
      expect(adapter).toBeInstanceOf(PF2eStateAdapter);
      expect(adapter.id).toBe("pf2e");
    });

    it("throws a descriptive error for unregistered systems instead of silently defaulting", () => {
      expect(() => getSystemStateAdapter("unknown-system")).toThrow(/unknown-system/);
      expect(() => getSystemStateAdapter("unknown-system")).toThrow(/registerSystemStateAdapter/);
    });
  });

  describe("registerSystemStateAdapter", () => {
    class AlienStateAdapter extends BaseSystemStateAdapter {
      id = "alienrpg";
    }

    it("makes a previously-unknown system resolvable", () => {
      registerSystemStateAdapter("alienrpg", (page) => new AlienStateAdapter(page));
      const adapter = getSystemStateAdapter("alienrpg");
      expect(adapter).toBeInstanceOf(AlienStateAdapter);
      expect(adapter.id).toBe("alienrpg");
    });

    it("can override a built-in adapter", () => {
      class CustomDnD5eAdapter extends BaseSystemStateAdapter {
        id = "dnd5e";
      }
      registerSystemStateAdapter("dnd5e", (page) => new CustomDnD5eAdapter(page));
      const adapter = getSystemStateAdapter("dnd5e");
      expect(adapter).toBeInstanceOf(CustomDnD5eAdapter);

      // restore the built-in for subsequent tests in this module
      registerSystemStateAdapter("dnd5e", (page) => new DnD5eStateAdapter(page));
    });
  });

  describe("DnD5eStateAdapter", () => {
    const adapter = new DnD5eStateAdapter();

    it("returns correct test actor data", () => {
      const data = adapter.getTestActorData("Test");
      expect(data.type).toBe("character");
      expect(data.system.attributes.hp.value).toBe(10);
    });
  });

  describe("PF2eStateAdapter", () => {
    const adapter = new PF2eStateAdapter();

    it("returns correct test actor data", () => {
      const data = adapter.getTestActorData("Test");
      expect(data.type).toBe("character");
      expect(data.system.attributes.hp.value).toBe(10);
    });
  });
});
