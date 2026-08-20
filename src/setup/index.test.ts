import { describe, it, expect } from "vitest";
import { parseFoundryBuild } from "./index.js";

describe("parseFoundryBuild", () => {
  it("extracts the build from a two-part version string", () => {
    expect(parseFoundryBuild("14.366")).toBe(366);
  });

  it("extracts the build from a three-part version string", () => {
    expect(parseFoundryBuild("14.360.0")).toBe(360);
  });

  it("returns undefined for a bare major version", () => {
    expect(parseFoundryBuild("14")).toBeUndefined();
  });

  it("returns undefined for a non-numeric minor component", () => {
    expect(parseFoundryBuild("14.x")).toBeUndefined();
  });
});
