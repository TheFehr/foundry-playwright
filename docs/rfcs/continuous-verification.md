# Continuous Verification & Release Tracking

## Overview

FoundryVTT's license prevents automated cloud-based execution, so compatibility verification is done locally. This document describes the tooling that keeps `verified-versions.json` up to date.

## The Verification Registry (`verified-versions.json`)

A version-controlled file that tracks the compatibility status of every `(fvtt version × game system × system minor version)` combination the library has been tested against.

**Entry schema:**

```json
{
  "fvtt": "14.360.0",
  "system": "dnd5e",
  "systemMinor": "5.3",
  "systemVersion": "5.3.3",
  "status": "stable",
  "timestamp": "2026-06-03T12:23:02.024Z",
  "notes": "Verified locally with dnd5e v5.3.3."
}
```

**Status values:**

| Status         | Meaning                                                                    |
| :------------- | :------------------------------------------------------------------------- |
| `stable`       | Passed the full verification suite locally                                 |
| `pending`      | Detected by the release monitor; awaiting local verification               |
| `incompatible` | System's `system.json` `compatibility` block excludes this Foundry version |

The registry key is `(fvtt, system, systemMinor)`. A new patch release within the same minor (e.g. dnd5e 5.3.3 → 5.3.4) triggers a new pending entry; the old stable entry remains until re-verified.

## The Release Monitor (`scripts/monitor-releases.ts`)

Run nightly (or manually) to detect new system releases:

```bash
npx tsx scripts/monitor-releases.ts
```

The monitor:

1. Fetches the latest stable Foundry VTT version from `foundryvtt.com/releases/`.
2. Queries the GitHub Releases API for the **top 3 minor versions** of each tracked system (`dnd5e`, `pf2e`). Uses `gh auth token` if available to avoid the 60 req/hr anonymous rate limit.
3. For each `(fvtt version, system minor)` combination not yet covered by a stable or pending entry:
   - Downloads the system's `system.json` and checks the `compatibility.minimum` / `compatibility.maximum` fields.
   - If incompatible, records an `incompatible` entry immediately (no verification needed).
   - If compatible, appends a `pending` entry with the exact patch version and the `verify:local` command to run.
4. Writes any changes back to `verified-versions.json`.

If a new Foundry generation is detected (no stable entry for that major version yet), it is added to the check set until at least one stable entry is recorded.

## Local Verification (`scripts/verify-local.ts`)

Runs the Playwright verification suite against a Docker-orchestrated Foundry instance.

```bash
# Verify a specific version and system
npm run verify:local -- --docker --version 14.360.0 --system dnd5e --system-minor 5.3

# Verify all pending entries
npm run verify:local -- --docker --all-pending --update-registry --git-commit

# Re-verify all stable entries
npm run verify:local -- --docker --re-verify --update-registry --git-commit

# Verify everything (pending + stable)
npm run verify:local -- --docker --all --update-registry --git-commit
```

**Key flags:**

| Flag                 | Description                                                             |
| :------------------- | :---------------------------------------------------------------------- |
| `--docker`           | Spin up a `ghcr.io/felddy/foundryvtt:<version>` container automatically |
| `--version <v>`      | Foundry version to verify (single target)                               |
| `--system <id>`      | System ID (default: `dnd5e`)                                            |
| `--system-minor <m>` | Resolve and pin the latest patch of this minor via GitHub API           |
| `--all-pending`      | Verify every `pending` entry in the registry                            |
| `--re-verify`        | Re-verify every `stable` entry                                          |
| `--all`              | Combine `--all-pending` and `--re-verify`                               |
| `--update-registry`  | Write results back to `verified-versions.json` on success               |
| `--git-commit`       | Auto-commit updated registry files                                      |
| `--keep-container`   | Don't stop the Docker container after the run                           |

On success the script also updates `verification-report.md` with a summary table.

## Typical Maintenance Workflow

1. Run the monitor: `npx tsx scripts/monitor-releases.ts`
2. Review the new `pending` entries in `verified-versions.json`.
3. For each pending entry (or `--all-pending` to batch them):
   ```bash
   npm run verify:local -- --docker --all-pending --update-registry --git-commit
   ```
4. Push the updated registry.
