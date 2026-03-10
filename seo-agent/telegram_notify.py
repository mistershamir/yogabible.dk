"""
Telegram notification for SEO agent reports.
Uses the same Telegram bot as the lead agent.
"""

import os
import json
import logging
import urllib.request

logger = logging.getLogger('seo-agent.telegram')

BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
CHAT_ID = os.getenv('TELEGRAM_OWNER_CHAT_ID', '')


def _send(text):
    """Send a Telegram message."""
    if not BOT_TOKEN or not CHAT_ID:
        logger.warning('Telegram credentials not set — printing to stdout')
        print(text)
        return False

    payload = json.dumps({
        'chat_id': CHAT_ID,
        'text': text,
        'parse_mode': 'HTML',
    }).encode('utf-8')

    req = urllib.request.Request(
        f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        logger.error(f'Telegram send failed: {e}')
        return False


def send_report(report):
    """Format and send the SEO report to Telegram."""
    is_daily = report.get('is_daily', False)
    errors = report.get('errors', [])
    warnings = report.get('warnings', [])
    metrics = report.get('metrics', {})
    rankings = report.get('rankings', {})

    # Header
    if is_daily and not errors:
        return  # Don't send daily if all clear

    if is_daily:
        header = '🔴 <b>SEO Daily Alert</b>'
    elif errors:
        header = '🔴 <b>SEO Weekly Report — Issues Found</b>'
    elif warnings:
        header = '🟡 <b>SEO Weekly Report</b>'
    else:
        header = '🟢 <b>SEO Weekly Report — All Clear</b>'

    lines = [header, '']

    # Errors
    if errors:
        lines.append(f'<b>Errors ({len(errors)}):</b>')
        for e in errors[:10]:
            lines.append(f'  - {_escape(e)}')
        if len(errors) > 10:
            lines.append(f'  ... and {len(errors) - 10} more')
        lines.append('')

    # Warnings (only in weekly)
    if warnings and not is_daily:
        lines.append(f'<b>Warnings ({len(warnings)}):</b>')
        for w in warnings[:8]:
            lines.append(f'  - {_escape(w)}')
        if len(warnings) > 8:
            lines.append(f'  ... and {len(warnings) - 8} more')
        lines.append('')

    # Metrics
    if metrics and not is_daily:
        lines.append('<b>Metrics:</b>')

        if 'pages_ok' in metrics:
            lines.append(f'  Pages healthy: {metrics["pages_ok"]}')
        if 'pages_fail' in metrics:
            lines.append(f'  Pages failing: {metrics["pages_fail"]}')
        if 'jsonld_blocks' in metrics:
            lines.append(f'  JSON-LD blocks: {metrics["jsonld_blocks"]}')
        if 'schema_types' in metrics:
            lines.append(f'  Schema types: {", ".join(metrics["schema_types"])}')
        if 'sitemap_urls' in metrics:
            lines.append(f'  Sitemap URLs: {metrics["sitemap_urls"]}')
        if 'sitemap_hreflang_entries' in metrics:
            lines.append(f'  Hreflang entries: {metrics["sitemap_hreflang_entries"]}')

        # PageSpeed
        for key in ['pagespeed_mobile_performance', 'pagespeed_mobile_seo',
                     'pagespeed_desktop_performance', 'pagespeed_desktop_seo']:
            if key in metrics:
                label = key.replace('pagespeed_', '').replace('_', ' ').title()
                score = metrics[key]
                emoji = '🟢' if score >= 90 else '🟡' if score >= 50 else '🔴'
                lines.append(f'  {emoji} {label}: {score}/100')

        # Search Console
        if 'gsc_clicks_28d' in metrics:
            lines.append(f'  GSC Clicks (28d): {metrics["gsc_clicks_28d"]}')
            lines.append(f'  GSC Impressions (28d): {metrics["gsc_impressions_28d"]}')

        lines.append('')

    # Rankings
    if rankings and not is_daily:
        lines.append('<b>Tracked Keywords:</b>')
        for query, data in sorted(rankings.items(), key=lambda x: x[1].get('position', 999)):
            pos = data.get('position', '?')
            clicks = data.get('clicks', 0)
            lines.append(f'  #{pos} — "{_escape(query)}" ({clicks} clicks)')
        lines.append('')

    text = '\n'.join(lines)

    # Telegram max message length is 4096
    if len(text) > 4000:
        text = text[:3950] + '\n\n... (truncated)'

    _send(text)


def _escape(text):
    """Escape HTML entities for Telegram."""
    return str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
