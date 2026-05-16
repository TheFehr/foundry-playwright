import { describe, it, expect } from "vitest";
import { getSystemStateAdapter } from "./index.js";
import { DnD5eStateAdapter } from "./dnd5e.js";
import { PF2eStateAdapter } from "./pf2e.js";

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

    it("defaults to DnD5eStateAdapter for unknown systems", () => {
      const adapter = getSystemStateAdapter("unknown-system");
      expect(adapter).toBeInstanceOf(DnD5eStateAdapter);
    });
  });

  describe("DnD5eStateAdapter", () => {
    const adapter = new DnD5eStateAdapter();

    it("returns correct test actor data", () => {
      const data = adapter.getTestActorData("Test");
      expect(data.type).toBe("character");
      expect(data.system.attributes.hp.value).toBe(10);
      expect(data.system.details.senses.ranges.darkvision).toBe(60);
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
