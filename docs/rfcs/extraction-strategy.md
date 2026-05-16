# Technical Plan: Extraction & Integration Strategy

## The "What"

A phased roadmap for moving the identified components out of `thefehr-learning-manager` into a new standalone repository, publishing the resulting package, and refactoring the original project to use the new dependency.

## The "Why"

Directly ripping out code and switching to a new library is risky. We need a strategy that:

1. **Ensures Continuous Delivery:** The existing project must remain testable throughout the transition.
2. **Minimizes Regressions:** We must verify that the extracted code works in isolation before relying on it.
3. **Optimizes Integration:** The final integration should result in cleaner, more maintainable code in the original project.

## The "How"

### Phase 1: Repository & Environment Setup (The Foundation)

1.  **New Repo:** Initialize `@thefehr/foundry-playwright` with TypeScript, Playwright, and Vitest (for unit testing the library's non-browser logic).
2.  **Infrastructure:** Set up a `package.json` with appropriate peer dependencies (`@playwright/test`) and a build script (ESM).

### Phase 2: Incremental Porting (The Migration)

1.  **Port Helpers:** Move `helpers.ts` logic first, as it has the fewest dependencies.
2.  **Port Fixtures:** Move the console monitoring and base test extension.
3.  **Port Setup Logic:** Refactor `global-setup.ts` into the parameterized `foundrySetup` function.
4.  **Verification:** Use the `npm run verify:local` command to verify that the setup/auth logic works against a real local Foundry instance. Create a minimal "dummy" module in the new repo to exercise the library components.

### Phase 3: Advanced Feature Implementation (The Expansion)

1.  **Implement State Injection:** Develop the `foundry` fixture with the `createActor`, `updateDocument` etc. methods.
2.  **Implement Canvas Helpers:** Develop the coordinate mapping and mouse simulation logic.
3.  **Implement System Adapters:** Create the initial `dnd5e` adapter.

### Phase 4: Integration & Refactoring (The Swap)

1.  **Beta Release:** Publish a `0.1.0-beta` version of the package.
2.  **Add Dependency:** Run `npm install --save-dev @thefehr/foundry-playwright` in `thefehr-learning-manager`.
3.  **Refactor Fixtures:**
    - Update `e2e/fixtures.ts` to extend the library's base `test`.
    - Delete duplicate logic.
4.  **Refactor Setup/Teardown:** Replace `e2e/global-setup.ts` and `e2e/global-teardown.ts` with calls to the library's orchestrators.
5.  **Clean up Helpers:** Delete `e2e/helpers.ts` once all functions are replaced by library equivalents.

### Phase 5: Verification & Cleanup (The Finalization)

1.  **Run E2E Suite:** Ensure all 100% of existing tests in `thefehr-learning-manager` pass with the new library.
2.  **Documentation:** Complete the README and API documentation in the library repo.
3.  **Final Release:** Publish `1.0.0`.
