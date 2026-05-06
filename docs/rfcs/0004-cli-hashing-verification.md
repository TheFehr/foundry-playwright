# RFC 0004: CLI and Source Hashing Verification System

## 1. The "What"

A command-line interface (CLI) for `@thefehrs/foundry-playwright` that allows module developers to opt-in to a source-code verification system. This system tracks the SHA-256 hashes of "verified" source files and provides a CI mechanism to ensure no unverified code changes are merged into the repository.

## 2. The "Why"

1. **Developer Confidence:** For complex Foundry modules, a successful local test run is the "gold standard" for verification. This system forces developers to acknowledge that their source changes have been verified before they can be committed/merged.
2. **CI Enforcement:** Since actual Foundry E2E tests often cannot run in public CI (due to licensing), this system acts as a proxy. It ensures that any code change being PR'd has a corresponding hash update, implying it was successfully verified locally.
3. **Audit Trail:** Storing hashes of verified files provides a clear history of when specific parts of the codebase were last confirmed to be working.

## 3. The "How"

### A. CLI Entry Point

The package will expose a binary via `package.json`:

```json
"bin": {
  "foundry-playwright": "./dist/cli/index.js"
}
```

Users can invoke it via `npx foundry-playwright <command>`.

### B. The `init` Command

`npx foundry-playwright init`
Scaffolds the necessary infrastructure for the verification system:

- **`foundry-playwright.config.json`**: Defines the files to be tracked.
  ```json
  {
    "verify": {
      "include": ["src/**/*.ts", "templates/**/*.hbs", "styles/**/*.css"],
      "exclude": ["**/*.test.ts"]
    }
  }
  ```
- **`.github/workflows/verify-hashes.yml`**: A GitHub Action that runs the `--check` command on PRs.
- **`.verified-hashes.json`**: An empty initial state file to store hashes.

### C. The `hash` Command

The core logic for managing file integrity.

#### 1. `npx foundry-playwright hash --update`

Used locally by the developer _after_ a successful verification run.

- Resolves all files matching the patterns in `foundry-playwright.config.json`.
- Calculates SHA-256 hashes for each file.
- Updates `.verified-hashes.json` with the new file-to-hash map.
- The developer then commits this updated JSON file as proof of verification.

#### 2. `npx foundry-playwright hash --check`

Used in CI to validate the integrity of the PR.

- Recalculates hashes for all currently tracked files.
- Compares them against the values stored in `.verified-hashes.json`.
- **Fails (Exit 1)** if:
  - A hash doesn't match (file modified but not updated).
  - A new tracked file is found but not present in the JSON.
  - A tracked file is missing from the disk.
- **Succeeds (Exit 0)** if all current hashes match the stored "verified" state.

## 4. Workflow Example

1. Developer modifies `src/logic.ts`.
2. Developer runs local E2E tests: `npm run verify:local`.
3. Tests pass. Developer runs `npx foundry-playwright hash --update`.
4. Developer commits both `src/logic.ts` and `.verified-hashes.json`.
5. PR is opened. CI runs `npx foundry-playwright hash --check`.
6. CI passes because the hashes match.
