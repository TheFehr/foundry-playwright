# RFC 0002: Internal Verification Suite via Mock Modules

## Goal

Establish an industrial-grade internal verification suite that tests the `@thefehrs/foundry-playwright` library against specialized "Mock Modules". This suite ensures that every helper, adapter, and state manipulation utility is verified against a controlled, deterministic Foundry VTT environment.

## 1. Dual-Tier Verification Strategy

We will implement two distinct verification "tiers" to balance CI speed with real-world accuracy.

### Tier 1: "Quick Verify" (Mock Mode)

- **Environment:** Clean Foundry VTT instance + Lightweight Mock Modules (`e2e/mocks/*`).
- **Usage:** CI/CD (GitHub Actions).
- **Strategy:** Uses the `FP_VERIFY` protocol to verify that library calls (like `grantCurrency`) result in the correct API calls and internal state changes, without needing the actual systems installed.
- **Benefit:** Ultra-fast, zero-dependency, and deterministic.

### Tier 2: "Full Verify" (System Mode)

- **Environment:** Local Foundry VTT instance + Actual Systems (`dnd5e`, `pf2e`) + Actual Modules (`tidy5e-sheet`).
- **Usage:** Local development via `npm run verify:local`.
- **Strategy:** Runs the same library helpers against the _real_ UI and _real_ data structures. We will use a "Verification Bridge" (a small module that _only_ adds the `FP_VERIFY` logging to a real system) to maintain a consistent assertion API across both tiers.
- **Benefit:** Ensures the library actually works with the complex, evolving reality of the Foundry ecosystem.

---

## 2. The Verification Protocol ("Test API")

To eliminate "flaky" tests and brittle DOM assertions, we will implement a two-way communication channel between the Playwright runner and the Foundry VTT browser instance.

### A. The Global Test Registry

The browser instance will maintain a global object: `window.FP_VERIFY`.

```typescript
interface FPVerifyRegistry {
  /** Map of logs for specific actions (e.g., "hook:renderActorSheet") */
  logs: Record<string, { data: any; timestamp: number }[]>;
  /** Map of current states tracked by mock modules */
  state: Record<string, any>;
  /** Counter of events to verify execution order */
  counter: number;
}
```

### B. The Assertion Bridge

For both Tier 1 and Tier 2, we will use a **Hook-based Observation** strategy. Instead of monkey-patching, we will leverage Foundry's native extensibility points to populate `window.FP_VERIFY`.

#### 1. Document Updates (State)

We will use the `updateDocument` (e.g., `updateActor`, `updateItem`) and `createDocument` hooks.

```javascript
Hooks.on("updateActor", (actor, delta, options, userId) => {
  window.FP_VERIFY.log("actor-update", {
    id: actor.id,
    name: actor.name,
    delta,
    options,
  });
});
```

#### 2. UI Interactions

We will use `renderApplication` and its derivatives (`renderActorSheet`, etc.) to verify sheet openings, and standard DOM event listeners on the `document.body` (using capture phase) to verify clicks triggered by our UI helpers.

#### 3. Settings (State & UI Observation)

We will avoid `Proxy` objects to prevent false-positives (e.g., verifying the setter was called but the backend failed to persist). Instead, we will use two robust verification layers:

- **State Verification (Default):** For `setSetting` and `waitForSetting` helpers, we verify success by polling `game.settings.get` via `page.waitForFunction`. This confirms the end-state, which is what actually matters to a module developer.
- **UI Observation (Config Screen):** When testing UI-based setting changes (navigating the settings menu), we will use the `renderSettingsConfig` hook. The mock module will observe changes to the `SettingsConfig` application's state and log the "save" event to `FP_VERIFY` only after Foundry confirms the settings have been successfully persisted.

This "End-State First" approach ensures that if a setting fails to save due to a permissions issue or a database error, the test correctly fails, whereas a Proxy would have incorrectly reported success.

---

## 3. Mock Module Deep Dives

...

#### 4. Custom Hooks

The `triggerHook` helper will be verified by the mock/bridge simply listening for that specific hook name and logging the arguments.

---

## 3. Mock Module Deep Dives

...

### 2.1 `fake-module` (Base/Core)

**Purpose:** Verifies core library functions and Application V2 support.

- **Settings Registration:**
  - `test-bool`: Standard boolean.
  - `test-string`: Standard string.
  - `test-object`: Complex JSON object to verify deep-wait logic.
- **Application V2 Implementation:**
  - A class extending `foundry.applications.api.ApplicationV2`.
  - **Tab Navigation:** Uses the standard V2 `<nav class="tabs">` with `[data-tab]` attributes.
  - **Content:** Each tab contains a unique `id` (e.g., `tab-general-content`) and a "secret" data attribute that the mock module logs when the tab becomes active.
- **Hook Monitoring:**
  - Listens for all core Foundry hooks and logs their arguments to `FP_VERIFY`.
- **Tour Simulation:**
  - Implements a fake `Tour` class that, when "started", immediately logs its state to `FP_VERIFY`. This allows us to verify `disableTour` actually stops the tour before it renders.

### 2.2 `fake-module-dnd5e` & `fake-module-pf2e`

**Purpose:** Verifies system adapters.

- **Document Schema Mocking:**
  - These modules will intercept `Actor.create` and `Actor.update`.
  - They will ensure the expected data structures (like `system.currency`) are correctly logged to `FP_VERIFY` when the library attempts to modify them.
- **Adapter Action Verification:**
  - `grantCurrency`: The mock module logs the exact delta applied to the currency fields.
  - `setHP`: The mock module logs the path and value of the update call.
- **Explicit Adapter Selection:**
  - Instead of shimming `game.system.id`, verification tests will explicitly configure the library to use the desired adapter (e.g., via `foundry.state.setSystem("dnd5e")`) to ensure the correct logic is exercised even when the underlying system differs.

### 2.3 `fake-module-tidy5e`

**Purpose:** Verifies third-party module UI adapters.

- **Sheet Simulation:**
  - Registers an Actor sheet class that adds the `.tidy5e-sheet` and `.actor` classes to its rendered window.
  - **Tab Structure:** Mimics Tidy5e's specific navigation (e.g., `.tidy-tabs` and `.item` classes).
  - **V2 Transition:** Specifically mocks the V2-style Tidy5e sheets to ensure our selectors are future-proof.
- **Event Trapping:**
  - Logs clicks on tabs to `FP_VERIFY` to confirm that `switchActorTab` successfully reached the element and triggered the click.

---

## 3. Stability & Race Condition Management

### A. Polling with Deterministic Timeouts

We will wrap Playwright assertions in a custom `verifyResult` helper:

```typescript
async function verifyResult(page: Page, key: string, predicate: (data: any) => boolean) {
  await page.waitForFunction(
    ({ key, predicateStr }) => {
      const predicate = new Function(`return ${predicateStr}`)();
      const entries = window.FP_VERIFY.logs[key] || [];
      return entries.some((e) => predicate(e.data));
    },
    { key, predicateStr: predicate.toString() },
    { timeout: 5000 },
  );
}
```

### B. Persistence via Storage

By mirroring `FP_VERIFY` to `localStorage`, we ensure that if a helper triggers a `location.reload()` (like `handleReload`), we don't lose the verification data from the action that preceded the reload.

### C. Version-Aware Mocks

The mock modules will check `game.release.generation` (V12, V13, etc.) and:

- Use the correct `Application` vs `ApplicationV2` base classes.
- Use the correct `Document.create` vs `Document.implementation.create` patterns if they differ.

---

## 4. Failure Analysis

If a test fails, the suite will:

1.  **Dump `FP_VERIFY`:** Log the entire verification registry to the Playwright console.
2.  **Screenshot Canvas & UI:** Capture the state of the Foundry UI.
3.  **Validate Mock Status:** Explicitly check if the mock module was loaded and its `init` hook fired. If not, fail with a "Verification Environment Error" instead of a generic timeout.

## 5. Benefits

- **Zero-Dependency CI:** We can run the entire "DnD5e" suite on a clean Foundry instance with 0 systems installed.
- **Micro-Verification:** We can test "Did this hook fire with exactly these 3 arguments?" instead of "Did the UI change?".
- **Speed:** Tests can run as fast as Foundry can process the API calls, with no arbitrary `waitForTimeout`.
