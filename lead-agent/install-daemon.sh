#!/bin/bash
# Install the lead agent as a macOS launchd daemon (auto-start on boot, auto-restart on crash)
# Also installs auto-deploy (checks GitHub every 5 min, pulls + restarts if needed)
# Run this once on the Mac Mini as the 'agents' user.

AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.yogabible.lead-agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
DEPLOY_PLIST_NAME="com.yogabible.auto-deploy"
DEPLOY_PLIST_PATH="$HOME/Library/LaunchAgents/${DEPLOY_PLIST_NAME}.plist"
PYTHON_PATH="$(which python3)"
LOG_DIR="${AGENT_DIR}/logs"

mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

echo "Installing Yoga Bible Lead Agent as launchd daemon..."
echo "  Agent dir: $AGENT_DIR"
echo "  Python:    $PYTHON_PATH"
echo "  Plist:     $PLIST_PATH"

# ── 1. Agent daemon (runs agent.py, auto-restarts on crash) ──

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON_PATH}</string>
        <string>${AGENT_DIR}/agent.py</string>
        <string>--daemon</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${AGENT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/agent-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/agent-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

echo "✅ Agent daemon installed and started"

# ── 2. Auto-deploy (checks GitHub every 5 min, pulls + restarts) ──

chmod +x "${AGENT_DIR}/auto-deploy.sh"

cat > "$DEPLOY_PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${DEPLOY_PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${AGENT_DIR}/auto-deploy.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${AGENT_DIR}</string>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/deploy-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/deploy-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
</dict>
</plist>
EOF

launchctl unload "$DEPLOY_PLIST_PATH" 2>/dev/null
launchctl load "$DEPLOY_PLIST_PATH"

echo "✅ Auto-deploy installed (checks GitHub every 5 min)"

echo ""
echo "════════════════════════════════════════════════"
echo "  INSTALLATION COMPLETE"
echo "════════════════════════════════════════════════"
echo ""
echo "Agent daemon:"
echo "  Start:   launchctl load $PLIST_PATH"
echo "  Stop:    launchctl unload $PLIST_PATH"
echo "  Status:  launchctl list | grep yogabible"
echo "  Logs:    tail -f $LOG_DIR/agent-stdout.log"
echo ""
echo "Auto-deploy:"
echo "  Checks GitHub every 5 minutes"
echo "  If agent files changed → pulls + restarts"
echo "  Logs:    tail -f $LOG_DIR/auto-deploy.log"
echo ""
echo "The agent will:"
echo "  • Auto-start on boot"
echo "  • Auto-restart if it crashes"
echo "  • Auto-update when you push to GitHub"
echo ""
