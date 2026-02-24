#!/bin/bash
# Install the lead agent as a macOS launchd daemon (auto-start on boot, auto-restart on crash)
# Run this once on the Mac Mini.

AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.yogabible.lead-agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
PYTHON_PATH="$(which python3)"
LOG_DIR="${AGENT_DIR}/logs"

mkdir -p "$LOG_DIR"

echo "Installing Yoga Bible Lead Agent as launchd daemon..."
echo "  Agent dir: $AGENT_DIR"
echo "  Python:    $PYTHON_PATH"
echo "  Plist:     $PLIST_PATH"

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

# Load the daemon
launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

echo ""
echo "✅ Daemon installed and started!"
echo ""
echo "Commands:"
echo "  Start:   launchctl load $PLIST_PATH"
echo "  Stop:    launchctl unload $PLIST_PATH"
echo "  Status:  launchctl list | grep yogabible"
echo "  Logs:    tail -f $LOG_DIR/agent-stdout.log"
echo ""
echo "The agent will auto-start on boot and restart if it crashes."
