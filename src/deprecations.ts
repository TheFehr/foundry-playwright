/**
 * Matches a stack-trace frame showing a warning originated in a game
 * system's or module's own code (`systems/<id>/...`, `modules/<id>/...`),
 * rather than in foundry-playwright's own test helpers - the only thing we
 * inject in-page is the fake-module test fixture, so that path is excluded.
 * Foundry's own deprecation logger embeds the full call stack in the
 * console message text, so this can just match against that text directly.
 */
const THIRD_PARTY_ORIGIN = /\/(?:systems|modules)\/(?!fake-module\/)[^/]+\//;

// A V8 stack-trace frame line, e.g. `    at foo (http://host/systems/pf2e/pf2e.mjs:1:1)`.
// Restricting THIRD_PARTY_ORIGIN to these lines (rather than the whole message
// text) means a first-party deprecation whose human-readable description merely
// mentions a systems/modules-shaped path can't be mistaken for a real stack frame.
const STACK_FRAME_LINE = /^\s*at\s/;

/**
 * Scoped tracker for deprecation and warning messages.
 * Allows adapters to register patterns that should be ignored or explicitly failed.
 */
export class DeprecationTracker {
  private ignoredPatterns: (string | RegExp)[] = [
    "namespaced under foundry", // V14 internal namespacing we handle
  ];

  private failurePatterns: (string | RegExp)[] = [];

  /**
   * Registers a pattern to be ignored.
   */
  registerIgnore(pattern: string | RegExp | (string | RegExp)[]) {
    if (Array.isArray(pattern)) {
      this.ignoredPatterns.push(...pattern);
    } else {
      this.ignoredPatterns.push(pattern);
    }
  }

  /**
   * Registers a pattern that should explicitly fail the test, even if it doesn't contain "deprecated".
   */
  registerFailure(pattern: string | RegExp | (string | RegExp)[]) {
    if (Array.isArray(pattern)) {
      this.failurePatterns.push(...pattern);
    } else {
      this.failurePatterns.push(pattern);
    }
  }

  /**
   * Checks if a warning message should be ignored.
   */
  shouldIgnore(text: string): boolean {
    const lowerText = text.toLowerCase();
    return this.ignoredPatterns.some((p) => {
      if (typeof p === "string") return lowerText.includes(p.toLowerCase());
      return p.test(text);
    });
  }

  /**
   * Checks if a warning message should cause a test failure.
   */
  shouldFail(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Default failure for deprecations - unless the stack trace shows it
    // came from the system/module under test's own code, not ours. That's
    // not something we can fix or should fail verification over; it's
    // still surfaced via console.warn regardless, just not as a failure.
    if (lowerText.includes("deprecated") || lowerText.includes("deprecation")) {
      const stackLines = text
        .split("\n")
        .filter((line) => STACK_FRAME_LINE.test(line))
        .join("\n");
      if (!THIRD_PARTY_ORIGIN.test(stackLines)) return true;
    }

    // Check custom failure patterns - an explicit registration always
    // fails, regardless of wording or origin.
    return this.failurePatterns.some((p) => {
      if (typeof p === "string") return lowerText.includes(p.toLowerCase());
      return p.test(text);
    });
  }
}
