"""
Monitoring & health alerts for the lead agent.
Sends Telegram notifications on:
- Agent startup/restart (so you know if it crashed)
- Email or SMS send failures
- Drip processing errors
- Daily heartbeat (proof of life)
"""

import os
import logging
import asyncio
from datetime import datetime, timezone

logger = logging.getLogger('lead-agent.monitor')

# Track startup time for uptime reporting
STARTUP_TIME = datetime.now(timezone.utc)

# Error counters (reset on heartbeat)
_error_counts = {
    'email_fail': 0,
    'sms_fail': 0,
    'drip_fail': 0,
    'api_fail': 0,
}


def reset_counters():
    """Reset error counters (called by heartbeat)."""
    for key in _error_counts:
        _error_counts[key] = 0


def record_error(category):
    """Record an error occurrence."""
    if category in _error_counts:
        _error_counts[category] += 1


def get_error_summary():
    """Get a summary of errors since last reset."""
    total = sum(_error_counts.values())
    if total == 0:
        return None
    parts = []
    if _error_counts['email_fail']:
        parts.append(f"📧 {_error_counts['email_fail']} email failures")
    if _error_counts['sms_fail']:
        parts.append(f"💬 {_error_counts['sms_fail']} SMS failures")
    if _error_counts['drip_fail']:
        parts.append(f"🔄 {_error_counts['drip_fail']} drip errors")
    if _error_counts['api_fail']:
        parts.append(f"🤖 {_error_counts['api_fail']} API errors")
    return '\n'.join(parts)


def _send_telegram_sync(text):
    """Send a Telegram message synchronously (for use outside async context)."""
    token = os.getenv('TELEGRAM_BOT_TOKEN', '')
    chat_id = os.getenv('TELEGRAM_OWNER_CHAT_ID', '')
    if not token or not chat_id:
        logger.warning('Telegram credentials not set — skipping monitor notification')
        return

    import urllib.request
    import json

    payload = json.dumps({
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'HTML',
    }).encode('utf-8')

    req = urllib.request.Request(
        f'https://api.telegram.org/bot{token}/sendMessage',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        logger.error(f'Monitor notification failed: {e}')
        return False


def notify_startup():
    """Send a startup notification — tells Shamir the agent is (re)starting."""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    _send_telegram_sync(
        f"🟢 <b>Lead Agent Started</b>\n\n"
        f"⏰ {now}\n"
        f"If you didn't expect this, the agent may have crashed and auto-restarted. "
        f"Check logs: <code>tail -50 lead-agent/logs/agent-stderr.log</code>"
    )
    logger.info('Startup notification sent')


def notify_shutdown():
    """Send a shutdown notification (graceful stop)."""
    _send_telegram_sync("🔴 <b>Lead Agent Stopped</b> (graceful shutdown)")
    logger.info('Shutdown notification sent')


def notify_error(category, detail):
    """Send an immediate alert for critical errors."""
    record_error(category)

    emoji = {'email_fail': '📧', 'sms_fail': '💬', 'drip_fail': '🔄', 'api_fail': '🤖'}.get(category, '⚠️')
    # Truncate detail to avoid Telegram message limit
    detail_short = str(detail)[:300]

    _send_telegram_sync(
        f"{emoji} <b>Agent Error: {category}</b>\n\n"
        f"<code>{detail_short}</code>\n\n"
        f"The agent is still running. Check logs if this repeats."
    )
    logger.warning(f'Error alert sent: {category} — {detail_short}')


def heartbeat():
    """
    Daily heartbeat — call from APScheduler every 24h.
    Reports uptime + any accumulated errors.
    """
    now = datetime.now(timezone.utc)
    uptime = now - STARTUP_TIME
    hours = int(uptime.total_seconds() // 3600)
    days = hours // 24
    remaining_hours = hours % 24

    uptime_str = f"{days}d {remaining_hours}h" if days > 0 else f"{hours}h"

    error_summary = get_error_summary()
    status = "✅ All clear" if not error_summary else f"⚠️ Issues detected:\n{error_summary}"

    _send_telegram_sync(
        f"💓 <b>Daily Heartbeat</b>\n\n"
        f"⏰ Uptime: {uptime_str}\n"
        f"{status}"
    )
    reset_counters()
    logger.info(f'Heartbeat sent (uptime: {uptime_str})')
