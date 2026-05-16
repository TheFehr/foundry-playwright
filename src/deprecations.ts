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

    // Default failure for deprecations
    if (lowerText.includes("deprecated") || lowerText.includes("deprecation")) {
      return true;
    }

    // Check custom failure patterns
    return this.failurePatterns.some((p) => {
      if (typeof p === "string") return lowerText.includes(p.toLowerCase());
      return p.test(text);
    });
  }
}
