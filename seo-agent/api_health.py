"""
API Health & Version Monitor
Checks all external integrations for availability and version freshness.
Returns the same { errors, warnings, metrics } format as other SEO checks.

Auto-discovers Netlify functions from the repo — no manual updates needed
when new integrations are added.
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
KNOWN_VERSIONS = {
    'meta_graph': 'v25.0',
    'mindbody': 'v6',
    'firebase_client': '12.10.0',
    'firebase_admin_min': '13.6.1',
    'anthropic_header': '2023-06-01',
}

# ─── Critical functions that get actionable error messages ────────────────────
# Any function not listed here still gets checked, just with a generic message.
CRITICAL_FUNCTIONS = {
    'facebook-leads-webhook': {
        'context': 'FB LEADS PIPELINE DOWN — you are NOT receiving Facebook ad leads. Check Netlify Functions logs immediately',
        'category': 'ads',
    },
    'meta-capi': {
        'context': 'META CONVERSION TRACKING DOWN — Facebook cannot track conversions from your ads. Ad spend optimization will suffer. Check Netlify Functions logs',
        'category': 'ads',
    },
    'lead': {
        'context': 'LEAD CAPTURE DOWN — website lead forms are broken. New leads are being lost. Check Netlify Functions logs',
        'category': 'leads',
    },
    'apply': {
        'context': 'APPLICATION FORM DOWN — YTT applications cannot be submitted. Check Netlify Functions logs',
        'category': 'leads',
    },
    'health': {
        'context': 'NETLIFY FUNCTIONS DOWN — serverless backend is unreachable. All API features are likely broken. Check Netlify dashboard',
        'category': 'infrastructure',
    },
    'mb-checkout': {
        'context': 'PAYMENT CHECKOUT DOWN — customers cannot complete purchases. Revenue is being lost. Check Netlify Functions logs',
        'category': 'payments',
    },
    'mb-book': {
        'context': 'CLASS BOOKING DOWN — students cannot book classes. Check Netlify Functions logs',
        'category': 'booking',
    },
    'mb-classes': {
        'context': 'CLASS SCHEDULE DOWN — schedule page cannot load classes. Check Netlify Functions logs',
        'category': 'booking',
    },
    'send-email': {
        'context': 'EMAIL SENDING DOWN — system emails (confirmations, drip sequences) are not being sent. Check Netlify Functions logs',
        'category': 'communications',
    },
    'send-sms': {
        'context': 'SMS SENDING DOWN — SMS notifications and drip messages are not being sent. Check Netlify Functions logs',
        'category': 'communications',
    },
    'instagram-webhook': {
        'context': 'INSTAGRAM WEBHOOK DOWN — Instagram DM automation is broken. Check Netlify Functions logs',
        'category': 'social',
    },
    'catalog': {
        'context': 'COURSE CATALOG DOWN — course information cannot be loaded. Check Netlify Functions logs',
        'category': 'content',
    },
}

# Functions to skip (internal/utility, not worth health-checking)
SKIP_FUNCTIONS = {
    'shared',           # shared module directory, not a function
    'migrate-applications',  # one-time migration
    'catalog-seed',     # one-time seed
    'careers-seed',     # one-time seed
    'seed-trainee-materials',  # one-time seed
    'facebook-leads-backfill',  # manual backfill
    'ai-backfill',      # manual utility
}

# ─── Core endpoints (non-function) ───────────────────────────────────────────
CORE_ENDPOINTS = [
    ('Site Homepage', SITE_URL, 200, 15,
     'SITE DOWN — yogabible.dk is unreachable. Check Netlify status and DNS'),
    ('Sitemap', f'{SITE_URL}/sitemap.xml', 200, 10,
     'Sitemap DOWN — Google cannot crawl your site. Check Netlify deploy'),
]


def check_api_health():
    """Run all API health checks. Returns { errors, warnings, metrics }."""
    result = {'errors': [], 'warnings': [], 'metrics': {}}

    # 1. Core endpoints + auto-discovered Netlify functions
    _check_core_endpoints(result)
    _check_netlify_functions(result)

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


def _check_core_endpoints(result):
    """Check core site endpoints (homepage, sitemap)."""
    ctx = ssl.create_default_context()

    for name, url, expected, timeout, context_msg in CORE_ENDPOINTS:
        try:
            req = urllib.request.Request(url, method='GET')
            req.add_header('User-Agent', 'YogaBible-SEO-Agent/1.0')
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                if resp.status != expected:
                    result['errors'].append(f'{context_msg}: HTTP {resp.status}')
        except urllib.error.HTTPError as e:
            if e.code != expected:
                result['errors'].append(f'{context_msg}: HTTP {e.code}')
        except Exception as e:
            result['errors'].append(f'{context_msg}: {str(e)[:80]}')


def _check_netlify_functions(result):
    """Auto-discover and health-check all Netlify functions."""
    functions_dir = REPO_ROOT / 'netlify' / 'functions'
    if not functions_dir.exists():
        result['warnings'].append('Netlify functions directory not found')
        return

    # Discover all .js function files
    function_names = set()
    for f in functions_dir.iterdir():
        if f.suffix == '.js' and f.stem not in SKIP_FUNCTIONS:
            function_names.add(f.stem)

    ok = 0
    fail = 0
    critical_down = []
    ctx = ssl.create_default_context()

    for name in sorted(function_names):
        url = f'{SITE_URL}/.netlify/functions/{name}'
        try:
            req = urllib.request.Request(url, method='GET')
            req.add_header('User-Agent', 'YogaBible-SEO-Agent/1.0')
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                # Any response = function is deployed and reachable
                ok += 1
        except urllib.error.HTTPError as e:
            # 400, 401, 403, 405 = function is alive, just rejects unauthenticated GET
            if e.code < 500:
                ok += 1
            else:
                fail += 1
                _report_function_down(result, name, e.code, critical_down)
        except Exception as e:
            fail += 1
            _report_function_down(result, name, str(e)[:60], critical_down)

    result['metrics']['api_endpoints_ok'] = ok
    result['metrics']['api_endpoints_fail'] = fail
    result['metrics']['api_endpoints_total'] = ok + fail

    if critical_down:
        result['metrics']['critical_services_down'] = critical_down


def _report_function_down(result, name, status, critical_down):
    """Report a function being down with appropriate severity."""
    info = CRITICAL_FUNCTIONS.get(name)
    if info:
        result['errors'].append(f'{info["context"]} (HTTP {status})')
        critical_down.append(name)
    else:
        result['warnings'].append(f'Netlify function "{name}" returned HTTP {status}')


def _check_meta_api(result):
    """Check Meta Graph API version is still alive (no token needed).

    Makes an unauthenticated request — expects a 400 (missing token) which proves
    the version endpoint exists. A 404 or redirect means the version is deprecated.
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
        if proc.stdout.strip():
            outdated = json.loads(proc.stdout)
            major_updates = []
            for pkg, info in outdated.items():
                current = info.get('current', '?')
                latest = info.get('latest', '?')
                if current != latest:
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
