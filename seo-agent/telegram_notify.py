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

        # Indexing Coverage
        if 'indexed_pages' in metrics:
            idx = metrics['indexed_pages']
            not_idx = metrics['not_indexed_pages']
            pct = metrics.get('index_coverage_pct', 0)
            emoji = '🟢' if pct == 100 else '🟡' if pct >= 80 else '🔴'
            lines.append(f'  {emoji} Indexed: {idx}/{idx + not_idx} pages ({pct}%)')

        # Sitemaps
        if 'sitemaps_submitted' in metrics:
            lines.append(f'  Sitemaps submitted: {metrics["sitemaps_submitted"]}')
        if 'sitemap_urls_submitted' in metrics:
            sub = metrics['sitemap_urls_submitted']
            idxd = metrics.get('sitemap_urls_indexed', 0)
            ratio = metrics.get('sitemap_index_ratio', 0)
            lines.append(f'  Sitemap URLs: {idxd}/{sub} indexed ({ratio}%)')

        lines.append('')

    # Rankings
    if rankings and not is_daily:
        lines.append('<b>Tracked Keywords:</b>')
        for query, data in sorted(rankings.items(), key=lambda x: x[1].get('position', 999)):
            pos = data.get('position', '?')
            clicks = data.get('clicks', 0)
            lines.append(f'  #{pos} — "{_escape(query)}" ({clicks} clicks)')
        lines.append('')

    # Keyword movers (week-over-week)
    comparison = metrics.get('keyword_comparison', {})
    if comparison and not is_daily:
        movers_up = comparison.get('movers_up', [])
        movers_down = comparison.get('movers_down', [])
        new_queries = comparison.get('new_queries', [])
        lost_queries = comparison.get('lost_queries', [])
        weeks = comparison.get('weeks_of_data', 0)

        if movers_up or movers_down or new_queries:
            lines.append(f'<b>Keyword Movement</b> (week {weeks}):')

            if movers_up:
                lines.append('  <b>Climbers:</b>')
                for m in movers_up[:5]:
                    lines.append(
                        f'  ⬆️ "{_escape(m["query"])}" '
                        f'+{m["delta"]} → #{m["position"]} ({m["clicks"]} clicks)'
                    )

            if movers_down:
                lines.append('  <b>Drops:</b>')
                for m in movers_down[:5]:
                    lines.append(
                        f'  ⬇️ "{_escape(m["query"])}" '
                        f'{m["delta"]} → #{m["position"]}'
                    )

            if new_queries:
                lines.append('  <b>New queries:</b>')
                for q in new_queries[:5]:
                    lines.append(
                        f'  🆕 "{_escape(q["query"])}" #{q["position"]} '
                        f'({q["impressions"]} imp)'
                    )

            if lost_queries:
                lines.append('  <b>Lost:</b>')
                for q in lost_queries[:3]:
                    lines.append(
                        f'  ❌ "{_escape(q["query"])}" (was #{q["last_position"]})'
                    )

            lines.append('')

    # Striking distance keywords
    striking = metrics.get('striking_distance_keywords', [])
    if striking and not is_daily:
        lines.append('<b>Striking Distance (pos 8-20):</b>')
        for kw in striking[:5]:
            lines.append(
                f'  🎯 #{kw["position"]} — "{_escape(kw["query"])}" '
                f'({kw["impressions"]} imp, {kw["clicks"]} clicks)'
            )
        lines.append('')

    # Google Trends
    trends = metrics.get('keyword_trends', {})
    if trends and not is_daily:
        rising = [k for k, v in trends.items() if v['trend'] == 'rising']
        falling = [k for k, v in trends.items() if v['trend'] == 'falling']

        if rising or falling:
            lines.append('<b>Google Trends (3 months):</b>')
            for kw in rising:
                lines.append(f'  📈 "{_escape(kw)}" — rising interest')
            for kw in falling:
                lines.append(f'  📉 "{_escape(kw)}" — falling interest')
            lines.append('')

    # Related rising queries
    related = metrics.get('related_rising_queries', [])
    if related and not is_daily:
        lines.append('<b>Related Rising Queries:</b>')
        lines.append(f'  {", ".join(_escape(q) for q in related[:8])}')
        lines.append('')

    text = '\n'.join(lines)

    # Telegram max message length is 4096
    if len(text) > 4000:
        text = text[:3950] + '\n\n... (truncated)'

    _send(text)


def send_ai_analysis(analysis):
    """Send the AI analysis as a separate Telegram message."""
    text = '🤖 <b>AI SEO Analysis</b>\n\n' + _escape(analysis)

    # Telegram max message length is 4096
    if len(text) > 4000:
        text = text[:3950] + '\n\n... (truncated)'

    _send(text)


def _escape(text):
    """Escape HTML entities for Telegram."""
    return str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
