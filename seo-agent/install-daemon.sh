#!/bin/bash
# Install the SEO agent as a macOS launchd daemon (auto-start on boot, auto-restart on crash)
# Run this once on the Mac Mini as the 'agents' user.

AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.yogabible.seo-agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="${AGENT_DIR}/logs"
VENV_PYTHON="${AGENT_DIR}/venv/bin/python3"

mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

if [ ! -f "$VENV_PYTHON" ]; then
    echo "ERROR: venv not found at ${AGENT_DIR}/venv"
    echo "Create it first:"
    echo "  cd ${AGENT_DIR}"
    echo "  python3 -m venv venv"
    echo "  source venv/bin/activate"
    echo "  pip install -r requirements.txt"
    exit 1
fi

echo "Installing Yoga Bible SEO Agent as launchd daemon..."
echo "  Agent dir: $AGENT_DIR"
echo "  Python:    $VENV_PYTHON"
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
        <string>${VENV_PYTHON}</string>
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
    <string>${LOG_DIR}/seo-agent-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/seo-agent-stderr.log</string>
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

echo ""
echo "========================================"
echo "  SEO AGENT DAEMON INSTALLED"
echo "========================================"
echo ""
echo "  Start:   launchctl load $PLIST_PATH"
echo "  Stop:    launchctl unload $PLIST_PATH"
echo "  Restart: launchctl kickstart -k gui/\$(id -u)/${PLIST_NAME}"
echo "  Status:  launchctl list | grep yogabible"
echo "  Logs:    tail -f $LOG_DIR/seo-agent-stderr.log"
echo ""
echo "The agent will:"
echo "  - Auto-start on boot"
echo "  - Auto-restart if it crashes"
echo "  - Weekly full report: Monday 8am CET"
echo "  - Daily quick check:  7am CET (silent unless issues)"
echo ""
