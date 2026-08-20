import { describe, it, expect } from "vitest";
import { parseFoundryBuild, selectV14SetupAdapter } from "./index.js";
import { V14SetupAdapter, V14LegacySetupAdapter } from "./v14.js";
import type { FoundryPage } from "../types/index.js";

const mockPage = {} as FoundryPage;

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

describe("selectV14SetupAdapter", () => {
  it("picks V14SetupAdapter at the cutoff build", () => {
    expect(selectV14SetupAdapter(mockPage, 366)).toBeInstanceOf(V14SetupAdapter);
  });

  it("picks V14SetupAdapter above the cutoff build", () => {
    expect(selectV14SetupAdapter(mockPage, 400)).toBeInstanceOf(V14SetupAdapter);
  });

  it("picks V14LegacySetupAdapter below the cutoff build", () => {
    expect(selectV14SetupAdapter(mockPage, 365)).toBeInstanceOf(V14LegacySetupAdapter);
  });

  it("throws rather than guessing when the build is unknown", () => {
    expect(() => selectV14SetupAdapter(mockPage, undefined)).toThrow(/could not determine/);
  });
});
