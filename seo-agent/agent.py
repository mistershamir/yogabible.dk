#!/usr/bin/env python3
"""
SEO/AEO Monitoring Agent for yogabible.dk
Runs weekly checks and sends Telegram reports.

Usage:
  python agent.py           # Run once (for cron/launchd)
  python agent.py --daemon  # Run continuously with scheduler
  python agent.py --check   # Run checks and print to stdout (testing)
"""

import os
import sys
import json
import logging
import argparse
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger('seo-agent')

from checks import (
    check_site_health,
    check_structured_data,
    check_search_console,
    check_pagespeed,
    check_keyword_rankings,
    check_price_consistency,
    check_indexing_coverage,
    check_sitemaps_status,
)
from api_health import check_api_health
from ai_analysis import analyze_with_ai
from telegram_notify import send_report, send_ai_analysis


def run_all_checks():
    """Run all SEO/AEO checks and return a combined report."""
    report = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'errors': [],
        'warnings': [],
        'metrics': {},
        'rankings': {},
    }

    checks = [
        ('Site Health', check_site_health),
        ('Structured Data', check_structured_data),
        ('Price Consistency', check_price_consistency),
        ('PageSpeed', check_pagespeed),
        ('Search Console', check_search_console),
        ('Indexing Coverage', check_indexing_coverage),
        ('Sitemaps Status', check_sitemaps_status),
        ('Keyword Rankings', check_keyword_rankings),
        ('API Health', check_api_health),
    ]

    for name, check_fn in checks:
        try:
            logger.info(f'Running: {name}')
            result = check_fn()
            report['errors'].extend(result.get('errors', []))
            report['warnings'].extend(result.get('warnings', []))
            report['metrics'].update(result.get('metrics', {}))
            report['rankings'].update(result.get('rankings', {}))
        except Exception as e:
            logger.error(f'{name} failed: {e}')
            report['errors'].append(f'{name} check failed: {str(e)[:100]}')

    return report


def main():
    parser = argparse.ArgumentParser(description='SEO/AEO Monitoring Agent')
    parser.add_argument('--daemon', action='store_true', help='Run continuously with scheduler')
    parser.add_argument('--check', action='store_true', help='Run checks and print to stdout')
    args = parser.parse_args()

    if args.daemon:
        run_daemon()
    else:
        report = run_all_checks()
        if args.check:
            print(json.dumps(report, indent=2, ensure_ascii=False))
        else:
            send_report(report)
            logger.info('Report sent to Telegram')
            # AI analysis on weekly reports
            if not report.get('is_daily'):
                logger.info('Running AI analysis...')
                analysis = analyze_with_ai(report)
                if analysis:
                    send_ai_analysis(analysis)
                    logger.info('AI analysis sent to Telegram')


def run_daemon():
    """Run with APScheduler — weekly checks."""
    from apscheduler.schedulers.blocking import BlockingScheduler

    scheduler = BlockingScheduler()

    # Weekly full report + AI analysis (Monday 8am CET)
    def weekly_full():
        report = run_all_checks()
        send_report(report)
        logger.info('Running AI analysis...')
        analysis = analyze_with_ai(report)
        if analysis:
            send_ai_analysis(analysis)
            logger.info('AI analysis sent')

    scheduler.add_job(
        weekly_full,
        'cron',
        day_of_week='mon',
        hour=7,  # UTC = 8am CET
        minute=0,
        id='weekly_seo_report',
    )

    # Daily quick check (just site health + prices, 7am CET)
    def daily_quick():
        report = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'errors': [],
            'warnings': [],
            'metrics': {},
            'rankings': {},
            'is_daily': True,
        }
        for name, fn in [('Site Health', check_site_health), ('Prices', check_price_consistency)]:
            try:
                result = fn()
                report['errors'].extend(result.get('errors', []))
                report['warnings'].extend(result.get('warnings', []))
            except Exception as e:
                report['errors'].append(f'{name}: {str(e)[:100]}')
        # Only send if there are issues
        if report['errors']:
            send_report(report)

    scheduler.add_job(
        daily_quick,
        'cron',
        hour=6,  # UTC = 7am CET
        minute=0,
        id='daily_seo_quick',
    )

    logger.info('SEO Agent daemon started — weekly reports on Monday 8am CET')
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info('SEO Agent shutting down')


if __name__ == '__main__':
    main()
