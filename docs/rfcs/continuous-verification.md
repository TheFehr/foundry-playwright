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

A `stable` entry superseded by a newer FVTT build (same major generation, same `system`/`systemMinor`) is moved to `retired-versions.json` rather than staying in this file forever - see [Retiring Superseded Entries](#retiring-superseded-entries-scriptsretire-supersededts) below.

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

## Re-verifying on Library Releases (`reverify-state.json`)

`--all-pending` (below) only catches drift in the _external_ world - a new
Foundry or system release. It never catches a regression introduced by a
change to this library itself: a `stable` registry entry is never touched
again once it's written, so a library-side bug can silently break a
previously-verified Foundry/system pairing with no signal in the registry.

`reverify-state.json` closes that gap without adding new infrastructure -
the VM already `git pull`s `main` every night, so a tracked file it reads
each run is enough of a queue:

```json
{ "requestedVersion": "1.4.4", "fulfilledVersion": "1.4.3" }
```

- **`release.yml`** bumps `requestedVersion` to the new version as part of
  the same signed commit that already bumps `package.json` / `CHANGELOG.md`
  for every release (no separate PR or workflow). `fulfilledVersion` is left
  untouched there.
- **`verify-nightly.sh`** always passes `--if-release-pending`. When
  `requestedVersion !== fulfilledVersion`, that run also re-verifies every
  `stable` pairing (equivalent to `--re-verify`) against the current
  library code, then writes `fulfilledVersion = requestedVersion` back,
  committed in the same PR as any registry changes. If nothing changed on
  the library side since the last release, this is a no-op every night.
- A run that's interrupted before writing `fulfilledVersion` (crash, disk
  guard, a blackout-deferred merge) just leaves the request unfulfilled, so
  the next run retries the full stable sweep - at-least-once, not
  exactly-once, same as the rest of this pipeline's failure handling.
- A pairing that regresses is written as `status: "failed"`, same as any
  other genuine verification failure (see `--record-failures` below), and
  `scripts/report-regressions.ts` files a `verification-required`-labeled
  issue for it if one doesn't already exist - `close-resolved-issues.ts`
  only ever updates an _existing_ issue, and a `stable` entry that just
  broke was never `pending`, so it never had one.

## Retiring Superseded Entries (`scripts/retire-superseded.ts`)

Nothing above ever removes a `stable` entry, and `monitor-releases.ts`
deliberately re-checks every FVTT build that has ever gone stable, forever
(so a later patch within an old generation still gets caught - see step 3
above). Left unchecked, this only ever grows: by the time this script was
added, the registry had 29 `stable` rows, many of them redundant history
(e.g. `14.360.0`/`14.365`/`14.366`/`14.367` all still carrying a `dnd5e 5.3.3`
entry that `14.368` had long since superseded). A release-triggered
`--if-release-pending` sweep (above) re-verifies _every_ `stable` row, so an
unbounded registry means an unbounded sweep - real timing put 29 rows at
~4.1h against `foundry-verify.service`'s 2h `TimeoutStartSec`.

```bash
npx tsx scripts/retire-superseded.ts
```

Groups `stable` entries by `(major FVTT generation, system, systemMinor)`,
keeps only the entry with the highest `fvtt` build in each group, and moves
every other entry in that group to `retired-versions.json` (same shape, plus
`retiredAt` and `supersededBy`) - archived, not deleted, so the history
survives outside the active sweep set. Scoped to `stable` only:
`incompatible`/`failed` rows cost nothing at sweep time (nothing ever sweeps
them), so they aren't part of the problem this fixes.

Run in `verify-nightly.sh` **before** `npm run verify`, not after - the
superseding entry is typically already `stable` from a past run, so pruning
first shrinks the set that run's own sweep is about to target, rather than
tidying up too late to help that run's duration.

**Known gap, not yet fixed:** this only catches redundant _build_ history
within a still-tracked system minor. A minor that ages out of
`monitor-releases.ts`'s top-3-tracked window stops being checked against any
FVTT build from that point on - there's no newer same-minor entry to
supersede it with, so it never gets picked up here either, and just sits
stale (e.g. `14.360.0`'s `pf2e 8.0`/`8.1` entries, orphaned once pf2e shipped
enough later minors to push them out of the window before any later FVTT
build was ever checked against them).

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

| Flag                   | Description                                                                              |
| :--------------------- | :--------------------------------------------------------------------------------------- |
| `--docker`             | Spin up a `ghcr.io/felddy/foundryvtt:<version>` container automatically                  |
| `--version <v>`        | Foundry version to verify (single target)                                                |
| `--system <id>`        | System ID (default: `dnd5e`)                                                             |
| `--system-minor <m>`   | Resolve and pin the latest patch of this minor via GitHub API                            |
| `--all-pending`        | Verify every `pending` entry in the registry                                             |
| `--re-verify`          | Re-verify every `stable` entry                                                           |
| `--all`                | Combine `--all-pending` and `--re-verify`                                                |
| `--if-release-pending` | Also re-verify every `stable` entry if a release is awaiting re-verification (see above) |
| `--update-registry`    | Write results back to `verified-versions.json` on success                                |
| `--git-commit`         | Auto-commit updated registry files                                                       |
| `--keep-container`     | Don't stop the Docker container after the run                                            |

On success the script also updates `verification-report.md` with a summary table.

## Typical Maintenance Workflow

1. Run the monitor: `npx tsx scripts/monitor-releases.ts`
2. Review the new `pending` entries in `verified-versions.json`.
3. For each pending entry (or `--all-pending` to batch them):
   ```bash
   npm run verify:local -- --docker --all-pending --update-registry --git-commit
   ```
4. Push the updated registry.
