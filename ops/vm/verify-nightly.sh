#!/usr/bin/env bash
set -euo pipefail

# Nightly compatibility verification, run by foundry-verify.timer on the VM.
#
# Consumes "pending" rows written by the cloud Monitor Releases workflow,
# runs the Docker-based verification suite against each, and pushes the
# result back. Requires FOUNDRY_USERNAME/PASSWORD/ADMIN_KEY in .env and a
# `gh auth login`'d token with repo scope, both local to this VM only.

REPO_DIR="${FP_REPO_DIR:-/opt/foundry-playwright}"
# Repo-owned rather than /tmp: a world-writable, predictable path there is
# open to a symlink pre-creation attack from another local user; this path is
# only writable by foundry-verify itself.
LOCK_FILE="$REPO_DIR/.verify-nightly.lock"
MAX_DISK_USED_PCT=85
BRANCH="foundry-verify-nightly-update"

cd "$REPO_DIR"

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[verify-nightly] Another run is still in progress, exiting."
  exit 0
fi

# Foundry-version-tagged images are reused across runs and left alone; this
# only clears dangling layers/containers. Runs via EXIT trap rather than as a
# last step so it still fires if an earlier command (disk guard, git push,
# reconciliation) aborts the script under `set -e`.
trap 'docker system prune -f >/dev/null 2>&1 || true' EXIT

used_pct=$(df --output=pcent "$REPO_DIR" | tail -1 | tr -dc '0-9')
if [ "$used_pct" -gt "$MAX_DISK_USED_PCT" ]; then
  echo "[verify-nightly] Disk usage at ${used_pct}%, aborting run." >&2
  exit 1
fi

# verify-local.ts namespaces a test-results-<version>-<timestamp>-<pid>/
# directory per verified combo and deliberately leaves it behind (holds a
# failing combo's trace.zip/screenshots for later diagnosis - see its
# --output handling). Prune anything older than a week so retaining those
# doesn't slowly erode the disk guard above.
find "$REPO_DIR" -maxdepth 1 -type d -name 'test-results-*' -mtime +7 -exec rm -rf {} +

# Always start from main, regardless of what branch a crashed previous run
# may have left checked out.
git checkout main
git pull --rebase --autostash

# main requires all changes via PR (zero approvals needed, but no direct push
# allowed even for signed bot commits) - verify-local.ts's --git-commit below
# still just does a local commit; it lands on this reused branch instead of
# main, then gets pushed and merged via PR further down.
git checkout -B "$BRANCH" main

# Don't let a genuine test failure abort the script — --record-failures already
# writes it to the registry as "failed" so it stops being retried; we still want
# to push whatever did succeed and reconcile issues either way. Capture the
# real exit status instead of masking it, so it still surfaces at the end
# (e.g. to systemd/monitoring) rather than always reporting success.
verify_status=0
npm run verify:local -- --all-pending --docker --update-registry --record-failures --git-commit ||
  verify_status=$?

# verify-local.ts only commits when something actually changed - if nothing
# did, there's nothing to open a PR for.
if [ "$(git rev-list --count main.."$BRANCH")" -gt 0 ]; then
  git push --force origin "$BRANCH"

  # The 20:00 CEST schedule is chosen to sit well clear of the Mon/Tue/Thu/Fri
  # 07:30-16:30 CEST push blackout, but this system user's git isn't wired to
  # the global pre-push hook that enforces it interactively - check again
  # here, right before the one action (merging into main) that actually makes
  # results live/visible, rather than before the branch push above.
  tz_day=$(TZ="Europe/Berlin" date +%u)
  tz_hm=$((10#$(TZ="Europe/Berlin" date +%H%M)))
  if [[ "$tz_day" =~ ^[1245]$ ]] && [ "$tz_hm" -ge 730 ] && [ "$tz_hm" -lt 1630 ]; then
    echo "[verify-nightly] Within the Mon/Tue/Thu/Fri 07:30-16:30 Europe/Berlin push blackout; PR pushed but left unmerged for tonight." >&2
    git checkout main
    exit "$verify_status"
  fi

  gh pr create --title "chore(registry): nightly verification update" \
    --body "Automated update from foundry-verify." \
    --base main --head "$BRANCH" 2>&1 ||
    echo "[verify-nightly] PR create failed (may already exist for $BRANCH) - continuing to merge."
  gh pr merge --squash --delete-branch "$BRANCH"
fi

git checkout main
git pull --ff-only origin main

npm run close-resolved-issues

exit "$verify_status"
