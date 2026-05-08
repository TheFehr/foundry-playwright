# RFC 0005: Comprehensive Verification Tracking

## 1. The "What"

An expansion to the existing verification framework to automatically capture and track the exact versions of the game system, active modules, and the `@thefehrs/foundry-playwright` library itself during a successful local verification run. Additionally, this data will be automatically compiled into a human-readable Markdown report.

## 2. The "Why"

1. **Proof of Current Compatibility:** A "PASS" status from months ago doesn't guarantee the library still works today. Tracking the `libraryVersion` proves that a specific version of the library was verified against a specific environment.
2. **Breaking Change Detection:** Foundry VTT core updates are only part of the equation. Game systems (e.g., `dnd5e`, `pf2e`) and UI-modifying modules frequently introduce breaking changes.
3. **Contextual Confidence:** We create a precise snapshot of a known-good configuration (Foundry + Library + System + Modules), giving developers confidence in the exact environment they are testing against.
4. **Visibility:** Raw JSON is hard to read. A dynamically generated Markdown table makes the support matrix immediately visible to users and contributors.

## 3. The "How"

### A. Data Schema Update

The `verified-versions.json` registry will be expanded to include the library version, and maps for systems and modules.

```json
{
  "verified": [
    {
      "version": "13.351.0",
      "libraryVersion": "1.2.0",
      "timestamp": "2024-05-24T12:00:00Z",
      "status": "stable",
      "notes": "Verified locally.",
      "systems": {
        "dnd5e": "3.1.2"
      },
      "modules": {
        "fake-module": "1.0.0",
        "tidy5e-sheet": "2.0.1"
      }
    }
  ]
}
```

### B. Version Extraction

1. **Environment Versions:** We will introduce a helper (e.g., in `src/helpers.ts`) designed to extract version data directly from the Foundry `game` instance.

   ```typescript
   async function extractEnvironmentVersions(page: Page) {
     return page.evaluate(() => {
       const systems = {};
       if (window.game.system) systems[window.game.system.id] = window.game.system.version;

       const modules = {};
       for (const [id, mod] of window.game.modules.entries()) {
         if (mod.active) modules[id] = mod.version;
       }
       return { systems, modules };
     });
   }
   ```

2. **Library Version:** The `scripts/verify-local.ts` orchestrator will read the current library version from the project's `package.json`.

### C. Workflow & Communication

Because the verification run is orchestrated by `scripts/verify-local.ts`, but the actual environment data is isolated within the Playwright browser process (`e2e/verify.spec.ts`), we need a communication bridge.

1.  **Test Extraction:** The Playwright test suite will call the extraction helper upon successful login.
2.  **File Bridge:** The test suite will serialize this data and write it to a temporary file (e.g., `.foundry_env_versions.json`).
3.  **Orchestrator Update:** After the tests pass, `scripts/verify-local.ts` reads this temporary file and grabs the library version from `package.json`.
4.  **Registry Merge:** The orchestrator updates the `verified-versions.json` registry with all gathered version data.

### D. Markdown Report Generation

As the final step of a successful `verify:local` run (if `--update-registry` is passed), the orchestrator will parse `verified-versions.json` and generate a `VERIFIED_ENVIRONMENTS.md` file in the project root (or `docs/`).

This file will contain a structured table summarizing the data:

| Foundry  | Library | System        | Modules             | Verified Date |
| :------- | :------ | :------------ | :------------------ | :------------ |
| 13.351.0 | v1.2.0  | dnd5e (3.1.2) | fake-module (1.0.0) | 2024-05-24    |
| 14.360.0 | v1.2.0  | pf2e (5.10.1) | fake-module (1.0.0) | 2024-05-25    |
