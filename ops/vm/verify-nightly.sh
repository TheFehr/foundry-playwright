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

git pull --rebase --autostash

# Don't let a genuine test failure abort the script — --record-failures already
# writes it to the registry as "failed" so it stops being retried; we still want
# to push whatever did succeed and reconcile issues either way. Capture the
# real exit status instead of masking it, so it still surfaces at the end
# (e.g. to systemd/monitoring) rather than always reporting success.
verify_status=0
npm run verify:local -- --all-pending --docker --update-registry --record-failures --git-commit ||
  verify_status=$?

git pull --rebase --autostash

# The 20:00 CEST schedule is chosen to sit well clear of the Mon/Tue/Thu/Fri
# 07:30-16:30 CEST push blackout, but this system user's git isn't wired to
# the global pre-push hook that enforces it interactively - so check again
# here, right before the one action (the push) that actually leaves the VM.
tz_day=$(TZ="Europe/Berlin" date +%u)
tz_hm=$((10#$(TZ="Europe/Berlin" date +%H%M)))
if [[ "$tz_day" =~ ^[1245]$ ]] && [ "$tz_hm" -ge 730 ] && [ "$tz_hm" -lt 1630 ]; then
  echo "[verify-nightly] Within the Mon/Tue/Thu/Fri 07:30-16:30 Europe/Berlin push blackout; leaving results committed locally and skipping push/reconciliation for tonight." >&2
  exit "$verify_status"
fi

git push

npm run close-resolved-issues

exit "$verify_status"
