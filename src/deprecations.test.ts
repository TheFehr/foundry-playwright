import { describe, it, expect } from "vitest";
import { DeprecationTracker } from "./deprecations.js";

const OWN_DEPRECATION = `The V1 Application framework is deprecated.
    at Object.logCompatibilityWarning (http://127.0.0.1:30000/scripts/foundry.mjs:6715:17)
    at eval (eval at evaluate (:234:30), <anonymous>:3:1)`;

const PF2E_DEPRECATION = `The V1 Application framework is deprecated, and will be removed in a later core software version.
    at Object.logCompatibilityWarning (http://127.0.0.1:30000/scripts/foundry.mjs:6715:17)
    at new Application (http://127.0.0.1:30000/scripts/foundry.mjs:37008:21)
    at new FormApplication (http://127.0.0.1:30000/scripts/foundry.mjs:38040:5)
    at new SettingsMenuPF2e (http://127.0.0.1:30000/systems/pf2e/pf2e.mjs:59889:23)
    at new HomebrewElements (http://127.0.0.1:30000/systems/pf2e/pf2e.mjs:60326:23)`;

const FAKE_MODULE_DEPRECATION = `Something is deprecated.
    at Object.logCompatibilityWarning (http://127.0.0.1:30000/scripts/foundry.mjs:6715:17)
    at Init (http://127.0.0.1:30000/modules/fake-module/module.js:12:3)`;

describe("DeprecationTracker", () => {
  describe("shouldFail", () => {
    it("fails a deprecation with no system/module frame in its stack (our own code)", () => {
      const tracker = new DeprecationTracker();
      expect(tracker.shouldFail(OWN_DEPRECATION)).toBe(true);
    });

    it("does not fail a deprecation whose stack traces into a game system's own code", () => {
      const tracker = new DeprecationTracker();
      expect(tracker.shouldFail(PF2E_DEPRECATION)).toBe(false);
    });

    it("fails a deprecation whose stack only traces into the fake-module test fixture", () => {
      const tracker = new DeprecationTracker();
      expect(tracker.shouldFail(FAKE_MODULE_DEPRECATION)).toBe(true);
    });

    it("still fails a third-party-originated deprecation if explicitly registered as a failure pattern", () => {
      const tracker = new DeprecationTracker();
      tracker.registerFailure("HomebrewElements");
      expect(tracker.shouldFail(PF2E_DEPRECATION)).toBe(true);
    });

    it("does not fail non-deprecation text that matches no failure pattern", () => {
      const tracker = new DeprecationTracker();
      expect(tracker.shouldFail("Just a regular warning")).toBe(false);
    });

    it("still honors custom failure patterns for non-deprecation-worded text", () => {
      const tracker = new DeprecationTracker();
      tracker.registerFailure("boom");
      expect(tracker.shouldFail("something went boom")).toBe(true);
    });
  });

  describe("shouldIgnore", () => {
    it("ignores the built-in V14 namespacing pattern", () => {
      const tracker = new DeprecationTracker();
      expect(tracker.shouldIgnore("You are accessing this namespaced under foundry now")).toBe(
        true,
      );
    });

    it("ignores a registered custom pattern", () => {
      const tracker = new DeprecationTracker();
      tracker.registerIgnore("some noisy warning");
      expect(tracker.shouldIgnore("This is some noisy warning text")).toBe(true);
    });
  });
});
