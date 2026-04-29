# Technical Plan: Continuous Verification & Release Tracking

## The "What"
A semi-automated system designed to detect new FoundryVTT releases and track their verification status. Since FoundryVTT cannot run in CI due to licensing, this system bridges the gap by notifying developers when a new version requires manual local verification.

## The "Why"
1. **License Compliance:** FoundryVTT's license prevents automated cloud-based execution (CI).
2. **Proactive Maintenance:** Catching breaking changes early (on release) is better than discovering them when a user reports a bug.
3. **Transparency:** Storing a history of "Verified Versions" provides confidence to consumers of the library.

## The "How"

### 1. Verification Registry (`verified-versions.json`)
A version-controlled file that serves as the "Source of Truth" for compatibility.
```json
{
  "verified": [
    {
      "version": "12.331",
      "timestamp": "2025-10-01T10:00:00Z",
      "status": "stable",
      "notes": "Full suite passed locally."
    }
  ],
  "pending": []
}
```

### 2. The "Release Monitor" (GitHub Action)
A scheduled workflow (e.g., daily) that:
- **Scrapes:** Fetches `https://foundryvtt.com/releases/`.
- **Detects:** Extracts the latest "Stable" release number.
- **Compares:** Checks if this version exists in `verified-versions.json`.
- **Triggers:** If a new version is found and not yet verified:
    - Creates a GitHub Issue labeled `verification-required`.
    - (Optional) Opens a PR that adds the new version to the `pending` list in `verified-versions.json`.

### 3. Manual Verification Workflow
When an issue/PR is created:
1.  **Local Setup:** The developer pulls the latest changes.
2.  **Run Suite:** Execute the verification script. The script can now optionally orchestrate a Docker container to provide the correct Foundry version automatically:
    ```bash
    # Option A: Use a local running instance
    npm run verify:local -- --foundry-version=13.331

    # Option B: Spin up a specific version via Docker (requires FOUNDRY_USERNAME/PASSWORD)
    npm run verify:local -- --docker --foundry-version=14.360
    ```

#### The `verify:local` Command Details
This script is a robust wrapper around Playwright and Docker that ensures the environment is correctly primed.

**Responsibilities:**
- **Docker Orchestration (Optional):** If `--docker` is passed, the script will:
    - Pull the corresponding image: `ghcr.io/felddy/foundryvtt:${VERSION}`.
    - Start a container with `FOUNDRY_USERNAME`, `FOUNDRY_PASSWORD`, and `FOUNDRY_ADMIN_KEY` mapped from the local environment.
    - Map a temporary or persistent `data` volume for the test world.
    - Wait for the container's health check (server ready) before proceeding.
- **Environment Sync:** It reads the provided `--foundry-version` and sets the `FOUNDRY_VERSION` and `FOUNDRY_URL` environment variables.
- **Connectivity & Version Validation:** Confirms the instance (Docker or local) is reachable and reports the expected version.
- **Test Orchestration:** Runs the full suite against the instance.
- **Cleanup:** If Docker was used, the script automatically stops and removes the container after the tests complete (unless `--keep-container` is used).
- **Report Generation:** Generates `verification-report.md`.
- **Automatic Registry Update (Interactive):** Prompts to update `verified-versions.json` on success.

3.  **Sign-off:** 
    - Review the changes and commit `verified-versions.json`.
    - The GitHub Issue can be closed automatically if the registry update is part of a PR.

### 4. Integration into Library logic
The library can export a `checkCompatibility()` utility that reads this JSON file and warns users if they are running a version of Foundry that hasn't been verified yet.

## Automation Logic (Pseudo-code for GA)
```yaml
name: Monitor Foundry Releases
on:
  schedule:
    - cron: '0 0 * * *' # Daily
jobs:
  check-version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Fetch Latest Version
        run: |
          LATEST=$(curl -s https://foundryvtt.com/releases/ | grep -oP '(?<=Version )\d+\.\d+')
          echo "LATEST_VERSION=$LATEST" >> $GITHUB_ENV
      - name: Create Issue if New
        if: env.NEW_VERSION_DETECTED == 'true'
        uses: imjohnbo/issue-bot@v3
        with:
          title: "Verification Required: FoundryVTT ${{ env.LATEST_VERSION }}"
          body: "A new stable version of FoundryVTT has been detected. Please run the E2E suite locally."
```
