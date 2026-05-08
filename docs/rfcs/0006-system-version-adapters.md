# RFC 0006: Version-Specific System Adapters

## 1. The "What"

An expansion of the `SystemAdapter` pattern to support multiple versions of a single game system. This involves making system adapter retrieval asynchronous and version-aware, allowing the framework to select the correct adapter based on the version of the system currently running in Foundry VTT.

## 2. The "Why"

1. **Avoid Deprecation Warnings:** Game systems (like `dnd5e`) frequently change their data structures (e.g., the `senses.truesight` migration in v5.3). Using the correct data path prevents console warnings that pollute logs and potentially cause test failures.
2. **Backward Compatibility:** Maintain support for older versions of a system without cluttering a single adapter class with complex `if/else` logic.
3. **Consistency with Core:** This mirrors the existing pattern for Foundry Core (v13 vs v14), creating a unified approach to versioned adaptations.
4. **Clean Code:** Encourages specialized, smaller adapter subclasses rather than monolithic "god objects" that try to handle every version.

## 3. The "How"

### A. Asynchronous Initialization

The `getSystemAdapter` function will be updated to be asynchronous and accept the Playwright `Page` object. It will evaluate the system's version directly from the browser's `game` object.

```typescript
// src/systems/index.ts
export async function getSystemAdapter(page: Page, id: string): Promise<SystemAdapter> {
  const version = await page.evaluate(() => window.game.system.version);
  // Selection logic...
}
```

### B. Adapter Registration & Selection

Adapters will be registered with version constraints. A selection mechanism will pick the highest version adapter that satisfies the current system's version.

### C. Deprecation Monitoring

To ensure we stay ahead of breaking changes, the verification suite will monitor browser console logs for deprecation warnings (e.g., containing "Deprecated since Version"). These warnings will be collected, deduplicated, and reported at the end of the test run, causing the test to fail if any were encountered.

## 4. Migration Strategy

1.  **Phase 1:** Update `FoundryState` and `src/systems/index.ts` to support async adapter retrieval.
2.  **Phase 2:** Implement `DnD5eV5_3Adapter` to handle the `truesight` change.
3.  **Phase 3:** Integrate deprecation monitoring into the E2E verification test.
