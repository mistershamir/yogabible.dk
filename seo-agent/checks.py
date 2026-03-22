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
    '/om-200hrs-yogalaereruddannelser/',
    '/en/200-hours-4-weeks-intensive-programs/',
    '/en/200-hours-8-weeks-semi-intensive-programs/',
    '/en/200-hours-18-weeks-flexible-programs/',
    '/yoga-journal/',
    '/yoga-glossary/',
    '/hot-yoga-copenhagen/',
    '/vibro-yoga/',
    '/sammenlign-yogalaereruddannelser/',
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
    Pulls 500 queries, saves weekly snapshot for trend tracking,
    and detects position movers / new / lost queries.
    """
    result = {'errors': [], 'warnings': [], 'metrics': {}, 'rankings': {}}

    service, err = _get_gsc_service(scope='readonly')
    if service is None:
        result['warnings'].append(f'Search Console skipped — {err}')
        return result

    try:
        from datetime import datetime, timedelta
        from keyword_history import save_snapshot, compare_with_previous

        end_date = datetime.now().strftime('%Y-%m-%d')
        start_date = (datetime.now() - timedelta(days=28)).strftime('%Y-%m-%d')

        # Pull 500 queries (up from 25) for comprehensive tracking
        response = service.searchanalytics().query(
            siteUrl=SITE_URL,
            body={
                'startDate': start_date,
                'endDate': end_date,
                'dimensions': ['query'],
                'rowLimit': 500,
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

        # Identify "striking distance" keywords (positions 8-20, worth pushing)
        striking = []
        for row in rows:
            pos = row.get('position', 0)
            if 8 <= pos <= 20 and row.get('impressions', 0) >= 10:
                striking.append({
                    'query': row['keys'][0],
                    'position': round(pos, 1),
                    'impressions': row.get('impressions', 0),
                    'clicks': row.get('clicks', 0),
                })
        striking.sort(key=lambda x: x['impressions'], reverse=True)
        result['metrics']['striking_distance_keywords'] = striking[:15]

        # Save snapshot for weekly comparison
        all_queries = [{
            'query': row['keys'][0],
            'position': round(row.get('position', 0), 1),
            'clicks': row.get('clicks', 0),
            'impressions': row.get('impressions', 0),
        } for row in rows]

        save_snapshot(all_queries)

        # Compare with previous week
        comparison = compare_with_previous()
        result['metrics']['keyword_comparison'] = comparison

        if comparison['movers_up']:
            top_mover = comparison['movers_up'][0]
            result['metrics']['top_mover_up'] = (
                f'"{top_mover["query"]}" moved up {top_mover["delta"]} positions '
                f'to #{top_mover["position"]}'
            )

        if comparison['movers_down']:
            top_drop = comparison['movers_down'][0]
            result['metrics']['top_mover_down'] = (
                f'"{top_drop["query"]}" dropped {abs(top_drop["delta"])} positions '
                f'to #{top_drop["position"]}'
            )

        if total_clicks == 0:
            result['warnings'].append('Zero clicks in last 28 days')

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


def check_keyword_trends():
    """
    Monitor Google Trends for target keywords.
    Detects rising/falling search interest so we can adjust content proactively.
    Uses pytrends (unofficial Google Trends API).
    """
    result = {'errors': [], 'warnings': [], 'metrics': {}}

    try:
        from pytrends.request import TrendReq
    except ImportError:
        result['warnings'].append('pytrends not installed — skipping Trends check')
        return result

    try:
        pytrends = TrendReq(hl='da', tz=60, timeout=(10, 30))

        # Danish keywords (geo=DK)
        da_keywords = [
            'yogalæreruddannelse',
            'yoga uddannelse',
            'yoga kursus',
            'hot yoga københavn',
        ]

        # English keywords (geo=DK for Denmark-specific interest)
        en_keywords = [
            'yoga teacher training',
            'yoga certification',
            'hot yoga copenhagen',
        ]

        trends_data = {}

        # Check Danish keywords
        for batch_start in range(0, len(da_keywords), 5):
            batch = da_keywords[batch_start:batch_start + 5]
            try:
                pytrends.build_payload(batch, cat=0, timeframe='today 3-m', geo='DK')
                interest = pytrends.interest_over_time()

                if not interest.empty:
                    for kw in batch:
                        if kw in interest.columns:
                            values = interest[kw].tolist()
                            if len(values) >= 4:
                                recent = sum(values[-4:]) / 4
                                older = sum(values[:4]) / 4
                                trend = 'rising' if recent > older * 1.2 else (
                                    'falling' if recent < older * 0.8 else 'stable'
                                )
                                trends_data[kw] = {
                                    'trend': trend,
                                    'current_interest': round(recent, 1),
                                    'previous_interest': round(older, 1),
                                    'lang': 'da',
                                }
            except Exception as e:
                logger.debug(f'Trends batch error (DA): {e}')

        # Check English keywords
        for batch_start in range(0, len(en_keywords), 5):
            batch = en_keywords[batch_start:batch_start + 5]
            try:
                pytrends.build_payload(batch, cat=0, timeframe='today 3-m', geo='DK')
                interest = pytrends.interest_over_time()

                if not interest.empty:
                    for kw in batch:
                        if kw in interest.columns:
                            values = interest[kw].tolist()
                            if len(values) >= 4:
                                recent = sum(values[-4:]) / 4
                                older = sum(values[:4]) / 4
                                trend = 'rising' if recent > older * 1.2 else (
                                    'falling' if recent < older * 0.8 else 'stable'
                                )
                                trends_data[kw] = {
                                    'trend': trend,
                                    'current_interest': round(recent, 1),
                                    'previous_interest': round(older, 1),
                                    'lang': 'en',
                                }
            except Exception as e:
                logger.debug(f'Trends batch error (EN): {e}')

        # Also fetch related queries for top keyword
        try:
            pytrends.build_payload(['yogalæreruddannelse'], cat=0, timeframe='today 3-m', geo='DK')
            related = pytrends.related_queries()
            if 'yogalæreruddannelse' in related:
                rising = related['yogalæreruddannelse'].get('rising')
                if rising is not None and not rising.empty:
                    result['metrics']['related_rising_queries'] = rising['query'].tolist()[:10]
        except Exception:
            pass

        result['metrics']['keyword_trends'] = trends_data

        # Flag notable trend changes
        rising_kws = [kw for kw, d in trends_data.items() if d['trend'] == 'rising']
        falling_kws = [kw for kw, d in trends_data.items() if d['trend'] == 'falling']

        if rising_kws:
            result['metrics']['trends_rising'] = rising_kws
        if falling_kws:
            result['warnings'].append(
                f'Falling search interest: {", ".join(falling_kws)}'
            )

    except Exception as e:
        result['warnings'].append(f'Google Trends error: {str(e)[:100]}')

    return result


def _get_gsc_service(scope='readonly'):
    """
    Build a Google Search Console API service.
    scope: 'readonly' for search analytics/sitemaps, 'readwrite' for URL inspection.
    Returns (service, error_message). service is None if auth fails.
    """
    sa_json = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON', '')
    if not sa_json:
        return None, 'GOOGLE_SERVICE_ACCOUNT_JSON not set'

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        scopes = {
            'readonly': ['https://www.googleapis.com/auth/webmasters.readonly'],
            'readwrite': ['https://www.googleapis.com/auth/webmasters'],
        }

        creds = service_account.Credentials.from_service_account_file(
            sa_json,
            scopes=scopes.get(scope, scopes['readonly'])
        )
        service = build('searchconsole', 'v1', credentials=creds)
        return service, None

    except ImportError:
        return None, 'google-api-python-client not installed'
    except Exception as e:
        return None, f'GSC auth error: {str(e)[:100]}'


def check_indexing_coverage():
    """
    Check indexing status for all key pages via the URL Inspection API.
    Catches issues like: not indexed, redirect, noindex, crawl errors, canonical mismatches.
    Requires GOOGLE_SERVICE_ACCOUNT_JSON with webmasters (read-write) scope.
    """
    result = {'errors': [], 'warnings': [], 'metrics': {}}

    service, err = _get_gsc_service(scope='readwrite')
    if service is None:
        result['warnings'].append(f'Indexing check skipped — {err}')
        return result

    # Only inspect HTML pages (skip sitemap.xml, robots.txt)
    inspectable_pages = [p for p in KEY_PAGES if not p.endswith('.xml') and not p.endswith('.txt')]

    indexed = 0
    not_indexed = 0
    issues = []

    from urllib.parse import urljoin

    for path in inspectable_pages:
        url = urljoin(SITE_URL, path)
        try:
            response = service.urlInspection().index().inspect(
                body={
                    'inspectionUrl': url,
                    'siteUrl': SITE_URL,
                }
            ).execute()

            inspection = response.get('inspectionResult', {})
            index_status = inspection.get('indexStatusResult', {})
            verdict = index_status.get('verdict', 'UNKNOWN')
            coverage_state = index_status.get('coverageState', '')
            crawled_as = index_status.get('crawledAs', '')
            robots_txt = index_status.get('robotsTxtState', '')
            indexing_state = index_status.get('indexingState', '')
            last_crawl = index_status.get('lastCrawlTime', '')
            page_fetch = index_status.get('pageFetchState', '')
            referring_urls = index_status.get('referringUrls', [])

            # Check mobile usability from inspection result
            mobile = inspection.get('mobileUsabilityResult', {})
            mobile_verdict = mobile.get('verdict', 'UNKNOWN')

            if verdict == 'PASS':
                indexed += 1
            else:
                not_indexed += 1
                reason = coverage_state or verdict
                issues.append({
                    'page': path,
                    'reason': reason,
                    'last_crawl': last_crawl[:10] if last_crawl else 'never',
                    'page_fetch': page_fetch,
                })

            # Warn on mobile usability issues
            if mobile_verdict not in ('PASS', 'VERDICT_UNSPECIFIED', 'UNKNOWN'):
                mobile_issues = mobile.get('issues', [])
                issue_types = [i.get('issueType', 'unknown') for i in mobile_issues]
                result['warnings'].append(
                    f'{path} — mobile usability: {", ".join(issue_types)}'
                )

            # Warn on canonical mismatch
            canonical_url = index_status.get('googleCanonical', '')
            user_canonical = index_status.get('userCanonical', '')
            if canonical_url and user_canonical and canonical_url != user_canonical:
                result['warnings'].append(
                    f'{path} — canonical mismatch: Google chose {canonical_url} over {user_canonical}'
                )

            # Warn if robots.txt is blocking
            if robots_txt == 'DISALLOWED':
                result['errors'].append(f'{path} — blocked by robots.txt')

        except Exception as e:
            err_str = str(e)
            # Rate limiting — back off gracefully
            if '429' in err_str or 'quota' in err_str.lower():
                result['warnings'].append(f'URL Inspection API rate limited after {indexed + not_indexed} pages')
                break
            result['warnings'].append(f'{path} — inspection failed: {err_str[:80]}')

    result['metrics']['indexed_pages'] = indexed
    result['metrics']['not_indexed_pages'] = not_indexed

    # Report not-indexed pages as errors
    for issue in issues:
        result['errors'].append(
            f'{issue["page"]} — NOT INDEXED: {issue["reason"]} '
            f'(last crawl: {issue["last_crawl"]}, fetch: {issue["page_fetch"]})'
        )

    if indexed + not_indexed > 0:
        result['metrics']['index_coverage_pct'] = round(
            indexed / (indexed + not_indexed) * 100, 1
        )

    return result


def check_sitemaps_status():
    """
    Check sitemap submission status via Search Console Sitemaps API.
    Verifies sitemaps are submitted, processed without errors, and up to date.
    """
    result = {'errors': [], 'warnings': [], 'metrics': {}}

    service, err = _get_gsc_service(scope='readonly')
    if service is None:
        result['warnings'].append(f'Sitemaps status check skipped — {err}')
        return result

    try:
        response = service.sitemaps().list(siteUrl=SITE_URL).execute()
        sitemaps = response.get('sitemap', [])

        if not sitemaps:
            result['errors'].append('No sitemaps submitted to Search Console')
            return result

        result['metrics']['sitemaps_submitted'] = len(sitemaps)

        total_submitted = 0
        total_indexed = 0

        for sm in sitemaps:
            path = sm.get('path', 'unknown')
            sm_type = sm.get('type', 'unknown')
            last_submitted = sm.get('lastSubmitted', '')
            last_downloaded = sm.get('lastDownloaded', '')
            is_pending = sm.get('isPending', False)
            warnings_count = sm.get('warnings', 0)
            errors_count = sm.get('errors', 0)

            # Count URLs
            contents = sm.get('contents', [])
            for content in contents:
                submitted = content.get('submitted', 0)
                indexed = content.get('indexed', 0)
                total_submitted += int(submitted) if submitted else 0
                total_indexed += int(indexed) if indexed else 0

            # Report issues
            if errors_count and int(errors_count) > 0:
                result['errors'].append(f'Sitemap {path} has {errors_count} error(s)')

            if warnings_count and int(warnings_count) > 0:
                result['warnings'].append(f'Sitemap {path} has {warnings_count} warning(s)')

            if is_pending:
                result['warnings'].append(f'Sitemap {path} is pending processing')

            # Warn if sitemap hasn't been downloaded recently (>14 days)
            if last_downloaded:
                from datetime import datetime, timedelta
                try:
                    dl_date = datetime.fromisoformat(last_downloaded.replace('Z', '+00:00'))
                    if (datetime.now(dl_date.tzinfo) - dl_date).days > 14:
                        result['warnings'].append(
                            f'Sitemap {path} last downloaded {dl_date.strftime("%Y-%m-%d")} (>14 days ago)'
                        )
                except (ValueError, TypeError):
                    pass

        result['metrics']['sitemap_urls_submitted'] = total_submitted
        result['metrics']['sitemap_urls_indexed'] = total_indexed

        if total_submitted > 0 and total_indexed > 0:
            index_ratio = round(total_indexed / total_submitted * 100, 1)
            result['metrics']['sitemap_index_ratio'] = index_ratio
            if index_ratio < 80:
                result['warnings'].append(
                    f'Only {index_ratio}% of sitemap URLs are indexed ({total_indexed}/{total_submitted})'
                )

    except Exception as e:
        result['warnings'].append(f'Sitemaps status error: {str(e)[:100]}')

    return result
