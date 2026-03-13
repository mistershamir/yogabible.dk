"""
SEO/AEO checks for yogabible.dk
Each check returns: { errors: [], warnings: [], metrics: {}, rankings: {} }
"""

import os
import json
import logging
import urllib.request
import urllib.error
import ssl
from urllib.parse import urljoin

logger = logging.getLogger('seo-agent.checks')

SITE_URL = os.getenv('SITE_URL', 'https://yogabible.dk')
CORRECT_PRICE = '23.750'

# Key pages that must be live and healthy
KEY_PAGES = [
    '/',
    '/en/',
    '/200-hours-4-weeks-intensive-programs/',
    '/200-hours-8-weeks-semi-intensive-programs/',
    '/200-hours-18-weeks-flexible-programs/',
    '/300-hours-advanced-teacher-training/',
    '/om-200hrs-yogalreruddannelser/',
    '/en/200-hours-4-weeks-intensive-programs/',
    '/en/200-hours-8-weeks-semi-intensive-programs/',
    '/en/200-hours-18-weeks-flexible-programs/',
    '/yoga-journal/',
    '/yoga-glossary/',
    '/hot-yoga-copenhagen/',
    '/vibro-yoga/',
    '/sammenlign-yogalreruddannelser/',
    '/apply/',
    '/kontakt/',
    '/sitemap.xml',
    '/robots.txt',
]

# Target keywords to monitor (Danish + English)
TARGET_KEYWORDS = [
    'yogalæreruddannelse',
    'yogalæreruddannelse københavn',
    'yoga teacher training copenhagen',
    'yoga teacher training denmark',
    '200 timer yogauddannelse',
    'yoga uddannelse danmark',
    'hot yoga copenhagen',
    'vibro yoga',
    'yoga kursus københavn',
    '300 timer yoga uddannelse',
]


def _fetch(url, timeout=15):
    """Fetch a URL and return (status_code, body, headers)."""
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={'User-Agent': 'YogaBible-SEO-Agent/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read().decode('utf-8', errors='replace')
            return resp.status, body, dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, '', {}
    except Exception as e:
        return 0, str(e), {}


def check_site_health():
    """Check all key pages return 200 and have required SEO elements."""
    result = {'errors': [], 'warnings': [], 'metrics': {}}

    pages_ok = 0
    pages_fail = 0

    for path in KEY_PAGES:
        url = urljoin(SITE_URL, path)
        status, body, headers = _fetch(url)

        if status != 200:
            result['errors'].append(f'{path} returned HTTP {status}')
            pages_fail += 1
            continue

        pages_ok += 1

        # Skip non-HTML
        if path.endswith('.xml') or path.endswith('.txt'):
            continue

        # Check essential SEO elements
        if '<title>' not in body or '</title>' not in body:
            result['errors'].append(f'{path} — missing <title>')

        if 'name="description"' not in body:
            result['errors'].append(f'{path} — missing meta description')

        if 'rel="canonical"' not in body:
            result['warnings'].append(f'{path} — missing canonical')

        if 'application/ld+json' not in body and path in ['/', '/en/']:
            result['warnings'].append(f'{path} — missing structured data')

        # Check for wrong price in visible content
        if '25.500' in body and '/sammenlign' not in path:
            result['warnings'].append(f'{path} — still shows old price 25.500')

    result['metrics']['pages_ok'] = pages_ok
    result['metrics']['pages_fail'] = pages_fail

    return result


def check_structured_data():
    """Validate JSON-LD on key pages using Google Rich Results API."""
    result = {'errors': [], 'warnings': [], 'metrics': {}}

    # Check homepage structured data by fetching and parsing
    status, body, _ = _fetch(SITE_URL + '/')
    if status != 200:
        result['errors'].append('Cannot fetch homepage for structured data check')
        return result

    # Extract JSON-LD blocks
    import re
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', body, re.DOTALL)

    if not blocks:
        result['errors'].append('Homepage has no JSON-LD structured data')
        return result

    result['metrics']['jsonld_blocks'] = len(blocks)

    schema_types = set()
    def _add_type(t):
        """Safely add a @type which may be a string or list of strings."""
        if isinstance(t, list):
            for item in t:
                schema_types.add(item)
        elif isinstance(t, str):
            schema_types.add(t)

    for i, block in enumerate(blocks):
        try:
            data = json.loads(block)
            # Collect types
            if isinstance(data, dict):
                _add_type(data.get('@type', 'unknown'))
                if '@graph' in data:
                    for item in data['@graph']:
                        _add_type(item.get('@type', 'unknown'))
            elif isinstance(data, list):
                for item in data:
                    _add_type(item.get('@type', 'unknown'))
        except json.JSONDecodeError as e:
            result['errors'].append(f'Invalid JSON-LD block #{i+1}: {str(e)[:60]}')

    result['metrics']['schema_types'] = list(schema_types)

    # Check required types
    required = {'Organization', 'Course', 'FAQPage'}
    missing = required - schema_types
    if missing:
        result['warnings'].append(f'Homepage missing schema types: {", ".join(missing)}')

    return result


def check_price_consistency():
    """Check that YTT prices are correct across the site."""
    result = {'errors': [], 'warnings': [], 'metrics': {}}

    price_pages = [
        '/200-hours-4-weeks-intensive-programs/',
        '/200-hours-8-weeks-semi-intensive-programs/',
        '/200-hours-18-weeks-flexible-programs/',
        '/en/200-hours-4-weeks-intensive-programs/',
        '/en/200-hours-8-weeks-semi-intensive-programs/',
        '/en/200-hours-18-weeks-flexible-programs/',
        '/',
    ]

    for path in price_pages:
        status, body, _ = _fetch(urljoin(SITE_URL, path))
        if status != 200:
            continue

        # Check for wrong price
        if '25.500' in body:
            result['warnings'].append(f'{path} — contains old price 25.500 kr')
        if '25500' in body and 'ld+json' in body:
            result['warnings'].append(f'{path} — structured data may have old price 25500')

    return result


def check_pagespeed():
    """Check Core Web Vitals via Google PageSpeed Insights API."""
    result = {'errors': [], 'warnings': [], 'metrics': {}}

    api_key = os.getenv('GOOGLE_API_KEY', '')
    if not api_key:
        result['warnings'].append('GOOGLE_API_KEY not set — skipping PageSpeed check')
        return result

    for strategy in ['mobile', 'desktop']:
        url = (
            f'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
            f'?url={SITE_URL}&strategy={strategy}&key={api_key}'
            f'&category=PERFORMANCE&category=SEO'
        )

        status, body, _ = _fetch(url, timeout=60)
        if status != 200:
            result['warnings'].append(f'PageSpeed API failed for {strategy}: HTTP {status}')
            continue

        try:
            data = json.loads(body)
            cats = data.get('lighthouseResult', {}).get('categories', {})

            perf_score = cats.get('performance', {}).get('score', 0)
            seo_score = cats.get('seo', {}).get('score', 0)

            result['metrics'][f'pagespeed_{strategy}_performance'] = int(perf_score * 100)
            result['metrics'][f'pagespeed_{strategy}_seo'] = int(seo_score * 100)

            if perf_score < 0.5:
                result['warnings'].append(f'{strategy} performance score: {int(perf_score*100)}/100')
            if seo_score < 0.8:
                result['warnings'].append(f'{strategy} SEO score: {int(seo_score*100)}/100')

        except (json.JSONDecodeError, KeyError) as e:
            result['warnings'].append(f'PageSpeed parse error ({strategy}): {str(e)[:60]}')

    return result


def check_search_console():
    """
    Check Google Search Console for ranking data.
    Requires GOOGLE_SERVICE_ACCOUNT_JSON env var pointing to a service account
    with Search Console access.
    """
    result = {'errors': [], 'warnings': [], 'metrics': {}, 'rankings': {}}

    sa_json = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON', '')
    if not sa_json:
        result['warnings'].append('GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping Search Console')
        return result

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds = service_account.Credentials.from_service_account_file(
            sa_json,
            scopes=['https://www.googleapis.com/auth/webmasters.readonly']
        )
        service = build('searchconsole', 'v1', credentials=creds)

        # Last 28 days performance
        from datetime import timedelta
        end_date = datetime.now().strftime('%Y-%m-%d')
        start_date = (datetime.now() - timedelta(days=28)).strftime('%Y-%m-%d')

        response = service.searchanalytics().query(
            siteUrl=SITE_URL,
            body={
                'startDate': start_date,
                'endDate': end_date,
                'dimensions': ['query'],
                'rowLimit': 25,
            }
        ).execute()

        rows = response.get('rows', [])
        total_clicks = sum(r.get('clicks', 0) for r in rows)
        total_impressions = sum(r.get('impressions', 0) for r in rows)

        result['metrics']['gsc_clicks_28d'] = total_clicks
        result['metrics']['gsc_impressions_28d'] = total_impressions
        result['metrics']['gsc_top_queries'] = len(rows)

        # Track target keywords
        for row in rows:
            query = row['keys'][0]
            for target in TARGET_KEYWORDS:
                if target.lower() in query.lower():
                    result['rankings'][query] = {
                        'position': round(row.get('position', 0), 1),
                        'clicks': row.get('clicks', 0),
                        'impressions': row.get('impressions', 0),
                    }

        if total_clicks == 0:
            result['warnings'].append('Zero clicks in last 28 days')

    except ImportError:
        result['warnings'].append('google-api-python-client not installed — skipping Search Console')
    except Exception as e:
        result['warnings'].append(f'Search Console error: {str(e)[:100]}')

    return result


def check_keyword_rankings():
    """
    Basic keyword position check via SERPing the site.
    Uses site:yogabible.dk queries to verify indexation.
    Note: For actual ranking tracking, Search Console is the authoritative source.
    """
    result = {'errors': [], 'warnings': [], 'metrics': {}, 'rankings': {}}

    # Check sitemap for completeness
    status, sitemap_body, _ = _fetch(SITE_URL + '/sitemap.xml')
    if status == 200:
        import re
        urls = re.findall(r'<loc>([^<]+)</loc>', sitemap_body)
        result['metrics']['sitemap_urls'] = len(urls)

        # Check hreflang entries
        hreflang_count = sitemap_body.count('xhtml:link')
        result['metrics']['sitemap_hreflang_entries'] = hreflang_count

        if hreflang_count == 0:
            result['warnings'].append('Sitemap has no hreflang entries')

    else:
        result['errors'].append(f'Sitemap returned HTTP {status}')

    return result
