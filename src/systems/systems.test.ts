import { describe, it, expect } from "vitest";
import { getSystemAdapter } from "./index.js";
import { DnD5eAdapter } from "./dnd5e.js";
import { PF2eAdapter } from "./pf2e.js";

describe("SystemAdapters", () => {
  const mockPage = {
    evaluate: (_fn: any) => Promise.resolve("1.0.0"),
  } as any;

  describe("getSystemAdapter", () => {
    it("returns DnD5eAdapter for 'dnd5e'", async () => {
      const adapter = await getSystemAdapter(mockPage, "dnd5e");
      expect(adapter).toBeInstanceOf(DnD5eAdapter);
      expect(adapter.id).toBe("dnd5e");
    });

    it("returns PF2eAdapter for 'pf2e'", async () => {
      const adapter = await getSystemAdapter(mockPage, "pf2e");
      expect(adapter).toBeInstanceOf(PF2eAdapter);
      expect(adapter.id).toBe("pf2e");
    });

    it("defaults to DnD5eAdapter for unknown systems", async () => {
      const adapter = await getSystemAdapter(mockPage, "unknown-system");
      expect(adapter).toBeInstanceOf(DnD5eAdapter);
    });
  });

  describe("DnD5eAdapter", () => {
    const adapter = new DnD5eAdapter();

    it("returns the correct HP path", () => {
      expect(adapter.getHPPath()).toBe("system.attributes.hp.value");
    });
  });

  describe("PF2eAdapter", () => {
    const adapter = new PF2eAdapter();

    it("returns the correct HP path", () => {
      expect(adapter.getHPPath()).toBe("system.attributes.hp.value");
    });
  });
});
