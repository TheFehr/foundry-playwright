import { describe, it, expect, vi } from "vitest";
import { Page } from "@playwright/test";
import { withScreenSize, setScreenSize } from "./screen.js";

/**
 * A minimal CDP session double: `send` and `detach` are spies, matching
 * just enough of the real `CDPSession` shape for `setScreenSize` to run.
 */
function createMockCDPSession() {
  return {
    send: vi.fn<(method: string, params?: unknown) => Promise<void>>().mockResolvedValue(undefined),
    detach: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

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

  it("does not detach the session that owns the current override", async () => {
    // Regression test: Emulation overrides are tied to the CDP session
    // that set them, so detaching that session clears the override —
    // this was previously done unconditionally in a `finally` block,
    // silently defeating setScreenSize entirely (caught by a real
    // Foundry page reporting the un-overridden default screen size, not
    // by this unit suite, since a full mock never exercises the real
    // CDP round trip — kept here as a behavioral guard, not full coverage).
    const session = createMockCDPSession();
    const page = {
      viewportSize: () => ({ width: 1024, height: 768 }),
      context: () => ({
        newCDPSession: vi
          .fn<() => Promise<ReturnType<typeof createMockCDPSession>>>()
          .mockResolvedValue(session),
      }),
    } as unknown as Page;

    await setScreenSize(page, { width: 390, height: 844 });

    expect(session.send).toHaveBeenCalledWith(
      "Emulation.setDeviceMetricsOverride",
      expect.objectContaining({ screenWidth: 390, screenHeight: 844 }),
    );
    expect(session.detach).not.toHaveBeenCalled();
  });

  it("detaches the previous session once a new override supersedes it", async () => {
    const firstSession = createMockCDPSession();
    const secondSession = createMockCDPSession();
    const newCDPSession = vi
      .fn<() => Promise<ReturnType<typeof createMockCDPSession>>>()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);
    const page = {
      viewportSize: () => ({ width: 1024, height: 768 }),
      context: () => ({ newCDPSession }),
    } as unknown as Page;

    await setScreenSize(page, { width: 390, height: 844 });
    expect(firstSession.detach).not.toHaveBeenCalled();

    await setScreenSize(page, { width: 1440, height: 900 });
    expect(firstSession.detach).toHaveBeenCalledTimes(1);
    expect(secondSession.detach).not.toHaveBeenCalled();
  });
});
