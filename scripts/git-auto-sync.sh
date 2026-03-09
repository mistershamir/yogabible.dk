#!/bin/bash
# =============================================================================
# Git Auto-Sync Script for yogabible.dk
#
# Keeps local (iCloud) repo and GitHub in sync bidirectionally.
#
# GitHub → Local: Pulls new changes from main (and optionally other branches)
# Local → GitHub: Pushes any unpushed local commits
#
# Usage:
#   ./scripts/git-auto-sync.sh              # Sync main branch
#   ./scripts/git-auto-sync.sh --branch dev # Sync specific branch
#   ./scripts/git-auto-sync.sh --all        # Sync all tracked branches
#
# Install as cron (every 5 minutes):
#   crontab -e
#   */5 * * * * /path/to/yogabible.dk/scripts/git-auto-sync.sh >> /tmp/git-sync.log 2>&1
#
# Install as launchd (macOS, recommended over cron):
#   See scripts/com.yogabible.git-sync.plist
# =============================================================================

set -euo pipefail

# --- Configuration ---
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
SYNC_BRANCH="${1:-main}"
LOG_PREFIX="[git-sync $(date '+%Y-%m-%d %H:%M:%S')]"
LOCK_FILE="/tmp/yogabible-git-sync.lock"
MAX_RETRIES=4

# --- Helpers ---
log() { echo "$LOG_PREFIX $1"; }
warn() { echo "$LOG_PREFIX WARNING: $1" >&2; }
die() { echo "$LOG_PREFIX ERROR: $1" >&2; exit 1; }

# Retry with exponential backoff for network operations
retry_with_backoff() {
  local cmd="$*"
  local attempt=1
  local wait=2

  while [ $attempt -le $MAX_RETRIES ]; do
    if eval "$cmd"; then
      return 0
    fi
    if [ $attempt -lt $MAX_RETRIES ]; then
      log "Attempt $attempt failed, retrying in ${wait}s..."
      sleep $wait
      wait=$((wait * 2))
    fi
    attempt=$((attempt + 1))
  done

  warn "Command failed after $MAX_RETRIES attempts: $cmd"
  return 1
}

# --- Lock file (prevent concurrent syncs, especially on iCloud) ---
acquire_lock() {
  if [ -f "$LOCK_FILE" ]; then
    local lock_pid
    lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      log "Another sync is running (PID $lock_pid), skipping."
      exit 0
    else
      warn "Stale lock file found, removing."
      rm -f "$LOCK_FILE"
    fi
  fi
  echo $$ > "$LOCK_FILE"
  trap 'rm -f "$LOCK_FILE"' EXIT
}

# --- iCloud safety: wait for .git conflicts to resolve ---
check_icloud_health() {
  # Check for iCloud conflict files in .git
  if find "$REPO_DIR/.git" -name "*.icloud" -o -name "*conflict*" 2>/dev/null | grep -q .; then
    warn "iCloud conflict files detected in .git — skipping sync to avoid corruption."
    return 1
  fi

  # Check for stale index.lock (common with iCloud)
  if [ -f "$REPO_DIR/.git/index.lock" ]; then
    local lock_age
    lock_age=$(( $(date +%s) - $(stat -f%m "$REPO_DIR/.git/index.lock" 2>/dev/null || stat -c%Y "$REPO_DIR/.git/index.lock" 2>/dev/null || echo "0") ))
    if [ "$lock_age" -gt 300 ]; then
      warn "Stale index.lock (${lock_age}s old), removing."
      rm -f "$REPO_DIR/.git/index.lock"
    else
      log "index.lock exists (${lock_age}s old), another git operation may be running. Skipping."
      return 1
    fi
  fi

  return 0
}

# --- Main sync logic ---
sync_branch() {
  local branch="$1"
  log "Syncing branch: $branch"

  # Fetch latest from remote
  if ! retry_with_backoff "git -C '$REPO_DIR' fetch origin '$branch' --quiet"; then
    warn "Failed to fetch origin/$branch"
    return 1
  fi

  local local_ref remote_ref base_ref
  local_ref=$(git -C "$REPO_DIR" rev-parse "$branch" 2>/dev/null || echo "")
  remote_ref=$(git -C "$REPO_DIR" rev-parse "origin/$branch" 2>/dev/null || echo "")

  if [ -z "$local_ref" ] || [ -z "$remote_ref" ]; then
    warn "Could not resolve refs for $branch"
    return 1
  fi

  # Already in sync
  if [ "$local_ref" = "$remote_ref" ]; then
    log "Branch $branch is up to date."
    return 0
  fi

  base_ref=$(git -C "$REPO_DIR" merge-base "$branch" "origin/$branch" 2>/dev/null || echo "")

  # Remote has new commits → pull (fast-forward only for safety)
  if [ "$local_ref" = "$base_ref" ]; then
    log "Remote has new commits on $branch, pulling..."
    local current_branch
    current_branch=$(git -C "$REPO_DIR" branch --show-current)

    if [ "$current_branch" = "$branch" ]; then
      git -C "$REPO_DIR" pull --ff-only origin "$branch" --quiet
      log "Pulled new commits on $branch."
    else
      git -C "$REPO_DIR" fetch origin "$branch:$branch" --quiet
      log "Updated $branch ref (not currently checked out)."
    fi
    return 0
  fi

  # Local has new commits → push
  if [ "$remote_ref" = "$base_ref" ]; then
    log "Local has unpushed commits on $branch, pushing..."
    if retry_with_backoff "git -C '$REPO_DIR' push -u origin '$branch' --quiet"; then
      log "Pushed local commits on $branch."
    fi
    return 0
  fi

  # Both have new commits → diverged, skip auto-merge
  warn "Branch $branch has diverged (local and remote both have new commits)."
  warn "Manual resolution required. Run: cd $REPO_DIR && git pull --rebase origin $branch"
  return 1
}

# --- Entry point ---
main() {
  acquire_lock

  cd "$REPO_DIR" || die "Cannot cd to $REPO_DIR"

  # Verify it's a git repo
  git rev-parse --git-dir > /dev/null 2>&1 || die "$REPO_DIR is not a git repository"

  # iCloud safety check
  check_icloud_health || exit 0

  if [ "${1:-}" = "--all" ]; then
    # Sync all local branches that have a remote tracking branch
    while IFS= read -r branch; do
      branch=$(echo "$branch" | sed 's/^[ *]*//' | tr -d ' ')
      [ -n "$branch" ] && sync_branch "$branch" || true
    done < <(git -C "$REPO_DIR" branch --format='%(refname:short)')
  else
    sync_branch "${SYNC_BRANCH}"
  fi

  log "Sync complete."
}

main "$@"
