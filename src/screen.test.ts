import { describe, it, expect } from "vitest";
import { Page } from "@playwright/test";
import { withScreenSize, setScreenSize } from "./screen.js";

describe("withScreenSize", () => {
  it("defaults viewport to match screen when no viewport is given", () => {
    const options = withScreenSize({ width: 390, height: 844 });
    expect(options.screen).toEqual({ width: 390, height: 844 });
    expect(options.viewport).toEqual({ width: 390, height: 844 });
  });

  it("lets screen and viewport diverge", () => {
    const options = withScreenSize({ width: 390, height: 844 }, { width: 1024, height: 768 });
    expect(options.screen).toEqual({ width: 390, height: 844 });
    expect(options.viewport).toEqual({ width: 1024, height: 768 });
  });
});

describe("setScreenSize", () => {
  it("throws instead of silently substituting screen size when the page has no viewport", async () => {
    const page = { viewportSize: () => null } as unknown as Page;

    await expect(setScreenSize(page, { width: 390, height: 844 })).rejects.toThrow(
      /has no viewport/,
    );
  });
});
