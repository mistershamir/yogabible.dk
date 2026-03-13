"""
API Health & Version Monitor
Checks all external integrations for availability and version freshness.
Returns the same { errors, warnings, metrics } format as other SEO checks.

Add to agent.py checks list to run weekly alongside SEO checks.
"""

import os
import json
import logging
import urllib.request
import urllib.error
import ssl
import subprocess
from pathlib import Path

logger = logging.getLogger('seo-agent.api-health')

SITE_URL = os.getenv('SITE_URL', 'https://yogabible.dk')
REPO_ROOT = Path(__file__).resolve().parent.parent

# ─── Known latest versions (update when upgrading) ────────────────────────────
# These are checked against live API responses to detect version drift.
KNOWN_VERSIONS = {
    'meta_graph': 'v25.0',
    'mindbody': 'v6',
    'firebase_client': '12.10.0',
    'firebase_admin_min': '13.6.1',
    'anthropic_header': '2023-06-01',
}

# ─── Endpoints to health-check ────────────────────────────────────────────────
HEALTH_ENDPOINTS = [
    # (name, url, expected_status, timeout)
    ('Netlify Functions', f'{SITE_URL}/.netlify/functions/health', 200, 10),
    ('Site Homepage', SITE_URL, 200, 15),
    ('Sitemap', f'{SITE_URL}/sitemap.xml', 200, 10),
    ('FB Leads Webhook', f'{SITE_URL}/.netlify/functions/facebook-leads-webhook', 403, 10),
    ('Meta CAPI', f'{SITE_URL}/.netlify/functions/meta-capi', 405, 10),
]

# Actionable context for each endpoint — shown when something is DOWN
ENDPOINT_CONTEXT = {
    'Netlify Functions': 'Netlify Functions DOWN — serverless backend is unreachable. Check Netlify dashboard for deploy errors',
    'Site Homepage': 'SITE DOWN — yogabible.dk is unreachable. Check Netlify status and DNS',
    'Sitemap': 'Sitemap DOWN — Google cannot crawl your site properly. Check Netlify deploy',
    'FB Leads Webhook': 'FB LEADS PIPELINE DOWN — you are NOT receiving Facebook ad leads. Check Netlify Functions logs',
    'Meta CAPI': 'META CONVERSION TRACKING DOWN — Facebook cannot track conversions from your ads. Ad optimization will suffer. Check Netlify Functions logs',
}


def check_api_health():
    """Run all API health checks. Returns { errors, warnings, metrics }."""
    result = {'errors': [], 'warnings': [], 'metrics': {}}

    # 1. Endpoint liveness
    _check_endpoints(result)

    # 2. Meta Graph API version (check if our version still works)
    _check_meta_api(result)

    # 3. MindBody API liveness
    _check_mindbody(result)

    # 4. GatewayAPI liveness
    _check_gatewayapi(result)

    # 5. npm outdated (Node.js deps)
    _check_npm_outdated(result)

    # 6. pip outdated (Python deps)
    _check_pip_outdated(result)

    # 7. Firebase Client SDK version drift
    _check_firebase_cdn(result)

    return result


def _check_endpoints(result):
    """Ping health endpoints."""
    ok = 0
    fail = 0
    ctx = ssl.create_default_context()

    for name, url, expected, timeout in HEALTH_ENDPOINTS:
        try:
            req = urllib.request.Request(url, method='GET')
            req.add_header('User-Agent', 'YogaBible-SEO-Agent/1.0')
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                if resp.status == expected:
                    ok += 1
                else:
                    fail += 1
                    result['errors'].append(f'{ENDPOINT_CONTEXT.get(name, name)}: HTTP {resp.status} (expected {expected})')
        except urllib.error.HTTPError as e:
            if e.code == expected:
                ok += 1
            else:
                fail += 1
                result['errors'].append(f'{ENDPOINT_CONTEXT.get(name, name)}: HTTP {e.code} (expected {expected})')
        except Exception as e:
            fail += 1
            result['errors'].append(f'{ENDPOINT_CONTEXT.get(name, name)}: {str(e)[:80]}')

    result['metrics']['api_endpoints_ok'] = ok
    result['metrics']['api_endpoints_fail'] = fail


def _check_meta_api(result):
    """Check Meta Graph API version is still alive (no token needed).

    Makes an unauthenticated request — expects a 400 (missing token) which proves
    the version endpoint exists. A 404 or redirect means the version is deprecated.
    Also checks that the FB Leads webhook and Meta CAPI endpoints are reachable
    (handled by _check_endpoints via HEALTH_ENDPOINTS).
    """
    version = KNOWN_VERSIONS['meta_graph']
    url = f'https://graph.facebook.com/{version}/me'

    try:
        req = urllib.request.Request(url, method='GET')
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            result['metrics']['meta_api_status'] = 'ok'
    except urllib.error.HTTPError as e:
        if e.code == 400:
            # 400 = version exists, just needs auth. This is what we expect.
            result['metrics']['meta_api_status'] = 'ok'
        elif e.code == 404:
            result['errors'].append(f'Meta Graph API {version}: version not found — may be deprecated')
        else:
            body = e.read().decode('utf-8', errors='replace')[:200]
            if 'deprecated' in body.lower():
                result['errors'].append(f'Meta Graph API {version}: deprecated — upgrade needed')
            else:
                result['metrics']['meta_api_status'] = f'HTTP {e.code}'
    except Exception as e:
        result['warnings'].append(f'Meta API check failed: {str(e)[:80]}')


def _check_mindbody(result):
    """Check MindBody API liveness."""
    api_key = os.getenv('MB_API_KEY', '')
    site_id = os.getenv('MB_SITE_ID', '')
    if not api_key or not site_id:
        result['warnings'].append('MindBody: MB_API_KEY or MB_SITE_ID not set — skipping')
        return

    url = f'https://api.mindbodyonline.com/public/{KNOWN_VERSIONS["mindbody"]}/site/sites'
    try:
        req = urllib.request.Request(url, method='GET')
        req.add_header('Api-Key', api_key)
        req.add_header('SiteId', site_id)
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            if resp.status == 200:
                result['metrics']['mindbody_status'] = 'ok'
            else:
                result['warnings'].append(f'MindBody API: HTTP {resp.status}')
    except Exception as e:
        result['warnings'].append(f'MindBody API: {str(e)[:80]}')


def _check_gatewayapi(result):
    """Check GatewayAPI token validity (doesn't send SMS)."""
    token = os.getenv('GATEWAYAPI_TOKEN', '')
    if not token:
        result['warnings'].append('GatewayAPI: GATEWAYAPI_TOKEN not set — skipping')
        return

    # Check account balance as a liveness test
    url = 'https://gatewayapi.eu/rest/me'
    try:
        req = urllib.request.Request(url, method='GET')
        req.add_header('Authorization', f'Token {token}')
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            if resp.status == 200:
                data = json.loads(resp.read())
                balance = data.get('credit', 'unknown')
                result['metrics']['sms_balance'] = balance
            else:
                result['warnings'].append(f'GatewayAPI: HTTP {resp.status}')
    except Exception as e:
        result['warnings'].append(f'GatewayAPI: {str(e)[:80]}')


def _check_npm_outdated(result):
    """Check for outdated npm packages."""
    package_json = REPO_ROOT / 'package.json'
    if not package_json.exists():
        return

    try:
        proc = subprocess.run(
            ['npm', 'outdated', '--json'],
            capture_output=True, text=True, timeout=30,
            cwd=str(REPO_ROOT)
        )
        # npm outdated exits 1 when packages are outdated
        if proc.stdout.strip():
            outdated = json.loads(proc.stdout)
            major_updates = []
            for pkg, info in outdated.items():
                current = info.get('current', '?')
                latest = info.get('latest', '?')
                if current != latest:
                    # Check if it's a major version bump
                    try:
                        curr_major = int(current.split('.')[0])
                        lat_major = int(latest.split('.')[0])
                        if lat_major > curr_major:
                            major_updates.append(f'{pkg}: {current} → {latest}')
                    except (ValueError, IndexError):
                        pass

            result['metrics']['npm_outdated_count'] = len(outdated)
            if major_updates:
                result['warnings'].append(f'npm major updates: {", ".join(major_updates[:5])}')
    except subprocess.TimeoutExpired:
        result['warnings'].append('npm outdated: timed out')
    except Exception as e:
        logger.debug(f'npm outdated check failed: {e}')


def _check_pip_outdated(result):
    """Check for outdated Python packages in lead-agent and seo-agent."""
    for agent_dir in ['lead-agent', 'seo-agent']:
        req_file = REPO_ROOT / agent_dir / 'requirements.txt'
        if not req_file.exists():
            continue

        try:
            proc = subprocess.run(
                ['pip', 'list', '--outdated', '--format=json'],
                capture_output=True, text=True, timeout=30
            )
            if proc.stdout.strip():
                outdated = json.loads(proc.stdout)
                # Filter to only packages in our requirements
                with open(req_file) as f:
                    our_pkgs = {line.split('>=')[0].split('<')[0].strip().lower().replace('-', '_')
                                for line in f if line.strip() and not line.startswith('#')}

                relevant = [p for p in outdated
                            if p['name'].lower().replace('-', '_') in our_pkgs]

                if relevant:
                    updates = [f"{p['name']}: {p['version']} → {p['latest_version']}" for p in relevant[:5]]
                    result['warnings'].append(f'{agent_dir} pip updates: {", ".join(updates)}')
        except Exception as e:
            logger.debug(f'pip outdated check failed for {agent_dir}: {e}')


def _check_firebase_cdn(result):
    """Check if a newer Firebase CDN version is available."""
    our_version = KNOWN_VERSIONS['firebase_client']
    # Try fetching the next minor version to see if we're behind
    parts = our_version.split('.')
    try:
        next_minor = f'{parts[0]}.{int(parts[1]) + 1}.0'
        url = f'https://www.gstatic.com/firebasejs/{next_minor}/firebase-app-compat.js'
        req = urllib.request.Request(url, method='HEAD')
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=5, context=ctx) as resp:
            if resp.status == 200:
                result['warnings'].append(f'Firebase CDN: {next_minor} available (you have {our_version})')
    except Exception:
        pass  # 404 = we're on latest, which is fine
