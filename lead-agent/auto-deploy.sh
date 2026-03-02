#!/bin/bash
# Auto-deploy script for Yoga Bible Lead Agent
# Checks GitHub for new commits, pulls if found, and restarts the agent.
# Designed to run every 5 minutes via launchd on the Mac Mini.

set -e

REPO_DIR="$HOME/yogabible.dk"
AGENT_DIR="$REPO_DIR/lead-agent"
BRANCH="claude/ai-email-followup-agent-2ORku"
PLIST_NAME="com.yogabible.lead-agent"
LOG_FILE="$AGENT_DIR/logs/auto-deploy.log"

mkdir -p "$AGENT_DIR/logs"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [auto-deploy] $1" >> "$LOG_FILE"
}

cd "$REPO_DIR"

# Fetch latest from remote (quiet, don't fail on network errors)
if ! git fetch origin "$BRANCH" --quiet 2>/dev/null; then
    log "WARN: git fetch failed (network issue?) — skipping this cycle"
    exit 0
fi

# Compare local HEAD with remote
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
    # No changes — nothing to do
    exit 0
fi

log "New commits detected: $LOCAL -> $REMOTE"

# Pull the changes
if git pull origin "$BRANCH" --quiet 2>/dev/null; then
    log "Pull successful"
else
    log "ERROR: git pull failed"
    exit 1
fi

# Check if agent-related files changed
CHANGED_FILES=$(git diff --name-only "$LOCAL" "$REMOTE")
AGENT_CHANGED=$(echo "$CHANGED_FILES" | grep -c "^lead-agent/" || true)

if [ "$AGENT_CHANGED" -gt 0 ]; then
    log "Agent files changed ($AGENT_CHANGED files) — restarting agent..."
    log "Changed files: $(echo "$CHANGED_FILES" | grep "^lead-agent/" | tr '\n' ', ')"

    # Restart the agent via launchctl
    # First try launchctl kickstart (macOS 10.10+), fallback to unload/load
    if launchctl kickstart -k "gui/$(id -u)/$PLIST_NAME" 2>/dev/null; then
        log "Agent restarted via launchctl kickstart"
    else
        # Fallback: find and kill the agent process, launchd KeepAlive will restart it
        AGENT_PID=$(pgrep -f "python.*agent.py" || true)
        if [ -n "$AGENT_PID" ]; then
            kill "$AGENT_PID" 2>/dev/null
            log "Agent killed (PID $AGENT_PID) — launchd will restart it"
        else
            log "No running agent found — launchd should start it"
        fi
    fi
else
    log "No agent files changed — skipping restart (pulled: $(echo "$CHANGED_FILES" | tr '\n' ', '))"
fi

# Trim log file if it gets too big (keep last 500 lines)
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 1000 ]; then
    tail -500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
