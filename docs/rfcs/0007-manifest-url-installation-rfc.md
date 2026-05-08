# RFC 0007: Manifest URL Package Installation

## 1. The "What"

An addition to the setup procedures that allows installing Foundry VTT packages (systems and modules) directly via a manifest URL (`module.json` or `system.json`) rather than exclusively searching the public registry by package ID.

## 2. The "Why"

1. **Version Verification:** Allows testing and verifying systems/modules against specific previous versions, which is essential for ensuring backward compatibility.
2. **Beta Testing:** Enables developers using the framework to test against beta versions of dependencies or systems by providing direct manifest links, keeping their primary module and testing code separate.
3. **Local/Branch Testing:** Allows testing a module whose manifest is hosted locally or on a specific branch before it is published to the central Foundry directory.
4. **DRY & Simplicity:** The installation dialog for packages is nearly identical between Foundry V13 and V14. We can use shared helpers to avoid duplicating version-specific logic.

## 3. The "How"

### A. Granular Setup Helpers

We will introduce new granular helpers in `src/helpers.ts` that follow the library's design philosophy of "many clear helpers that can be called one after the other".

```typescript
/**
 * Navigates to the Systems tab and opens the installation dialog.
 * @param page The Playwright Page object.
 */
export async function openSystemInstallDialog(page: Page): Promise<Locator>;

/**
 * Navigates to the Modules tab and opens the installation dialog.
 * @param page The Playwright Page object.
 */
export async function openModuleInstallDialog(page: Page): Promise<Locator>;

/**
 * Installs a system from a manifest URL.
 * @param page The Playwright Page object.
 * @param manifestUrl The URL to the system.json manifest.
 */
export async function installSystemFromManifest(page: Page, manifestUrl: string): Promise<void>;

/**
 * Installs a module from a manifest URL.
 * @param page The Playwright Page object.
 * @param manifestUrl The URL to the module.json manifest.
 */
export async function installModuleFromManifest(page: Page, manifestUrl: string): Promise<void>;
```

### B. Implementation Details

1. **`open...InstallDialog`**:
   - Calls `switchTab(page, tabName)`.
   - Uses robust Playwright locators to find and click the "Install" button (e.g., `button[data-action="installPackage"]` or text-based filters for V13 compatibility).
   - Waits for the dialog to be visible and returns its `Locator`.
2. **`install...FromManifest`**:
   - Calls the relevant `open...InstallDialog` helper.
   - Locates the manifest URL input (usually at the bottom of the dialog).
   - Fills the `manifestUrl` and clicks the adjacent "Install" button.
   - Waits for the installation to complete using shared logic.

### C. Refactoring Existing Adapters

The `V13SetupAdapter` and `V14SetupAdapter` will be refactored to use `openSystemInstallDialog` and `openModuleInstallDialog` in their existing `installSystem` and `installModules` methods, ensuring that core framework logic benefits from the improved DRY structure.

## 4. Migration Strategy

1. **Phase 1:** Implement the new helpers in `src/helpers.ts`.
2. **Phase 2:** Refactor `src/setup/v13.ts` and `src/setup/v14.ts` to use the new `open...` helpers.
3. **Phase 3:** Update the internal E2E verification tests to use a known manifest URL to ensure the feature functions correctly.
4. **Phase 4:** Add documentation for the new capability in `README.md`.
