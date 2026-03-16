#!/usr/bin/env python3
"""
Meta Ads CLI — lets any Claude Code session manage Meta ad campaigns.

Usage:
    python scripts/meta-ads-cli.py <command> [args...]

Reads META_ACCESS_TOKEN from ads-agent/.env or repo root .env.

Commands:
    accounts                              List ad accounts
    campaigns [brand] [--status=X]        List campaigns (brand: yb|hyc)
    insights <campaign_id> [days]         Campaign performance insights
    account-insights [brand] [days]       Account-level summary
    adsets <campaign_id>                  List ad sets in campaign
    adset-insights <adset_id> [days]      Ad set performance insights
    ads <adset_id>                        List ads in ad set
    ad-insights <ad_id> [days]            Ad performance insights
    creative <ad_id>                      Get ad creative details (text, headline, CTA)

    pause <id>                            Pause campaign/adset/ad
    resume <id>                           Resume (activate) campaign/adset/ad
    archive <id>                          Archive campaign/adset/ad
    delete <id>                           Delete campaign/adset/ad
    budget <id> <daily_dkk>              Update daily budget (DKK)
    lifetime-budget <id> <amount_dkk>    Update lifetime budget (DKK)
    duplicate <id>                        Duplicate entity (created as PAUSED)

    create-campaign <brand> <name> <objective> <daily_budget_dkk> [--status=PAUSED]
    create-adset <campaign_id> <name> <daily_budget_dkk> <targeting_json_file> [--optimization=LEAD_GENERATION]
    create-ad <adset_id> <name> <creative_json_file>
    update-ad-text <ad_id> <field> <value>    Update ad creative text (field: primary_text|headline|description|link)

    audiences [brand]                     List custom audiences
    create-audience <brand> <name> <desc> [--subtype=CUSTOM]
    delete-audience <audience_id>         Delete custom audience

    leadforms [brand]                     List instant forms (lead gen forms)
    leadform <form_id>                    Get form details + questions
    create-leadform <brand> <form_json_file>  Create instant form from JSON spec

    page-posts [brand] [--limit=10]       List recent page posts (for use as ad posts)
"""

import os
import sys
import json
import ssl
import urllib.request
import urllib.parse
import urllib.error

# Fix macOS SSL certificate issue — use certifi bundle if available
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()
HTTPS_HANDLER = urllib.request.HTTPSHandler(context=SSL_CTX)
URL_OPENER = urllib.request.build_opener(HTTPS_HANDLER)
urllib.request.install_opener(URL_OPENER)

# ── Config ──────────────────────────────────────────────────

GRAPH_API = 'https://graph.facebook.com/v25.0'

AD_ACCOUNTS = {
    'yb': 'act_1137462911884203',
    'yoga-bible': 'act_1137462911884203',
    'hyc': 'act_518096093802228',
    'hot-yoga-cph': 'act_518096093802228',
}

ACCOUNT_NAMES = {
    'act_1137462911884203': 'Yoga Bible',
    'act_518096093802228': 'Hot Yoga CPH',
}

# Page IDs for leadforms and page posts
PAGE_IDS = {
    'yb': None,          # Will be auto-discovered
    'hyc': None,
}

TOKEN = None


def load_token():
    """Load META_ACCESS_TOKEN from multiple locations (first match wins).

    Search order:
      1. META_ACCESS_TOKEN environment variable
      2. ~/.config/meta-ads/token  (global — works across all Claude sessions)
      3. ads-agent/.env  (repo-local)
      4. .env  (repo-local)
    """
    global TOKEN
    if TOKEN:
        return TOKEN

    # Check env var first
    TOKEN = os.environ.get('META_ACCESS_TOKEN')
    if TOKEN:
        return TOKEN

    # Try global config file (~/.config/meta-ads/token)
    global_token_path = os.path.join(os.path.expanduser('~'), '.config', 'meta-ads', 'token')
    if os.path.exists(global_token_path):
        with open(global_token_path) as f:
            val = f.read().strip()
            if val and val != '...':
                TOKEN = val
                return TOKEN

    # Try repo-local .env files
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for env_path in [
        os.path.join(repo_root, 'ads-agent', '.env'),
        os.path.join(repo_root, '.env'),
    ]:
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('META_ACCESS_TOKEN=') and not line.startswith('#'):
                        TOKEN = line.split('=', 1)[1].strip().strip('"').strip("'")
                        if TOKEN and TOKEN != '...':
                            return TOKEN

    print('ERROR: META_ACCESS_TOKEN not found.')
    print('Set it in one of these locations:')
    print('  1. ~/.config/meta-ads/token  (global, recommended)')
    print('  2. ads-agent/.env            (repo-local)')
    print('  3. META_ACCESS_TOKEN env var')
    sys.exit(1)


def resolve_account(brand):
    if not brand:
        return AD_ACCOUNTS['yb']
    return AD_ACCOUNTS.get(brand.lower().strip(), AD_ACCOUNTS['yb'])


def graph_get(url):
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return json.loads(body)
        except Exception:
            return {'error': {'message': body}}
    except Exception as e:
        return {'error': {'message': str(e)}}


def graph_post(url_or_id, fields=None, data_bytes=None):
    if '/' not in url_or_id and 'http' not in url_or_id:
        url = f'{GRAPH_API}/{url_or_id}?access_token={load_token()}'
    else:
        url = url_or_id

    if data_bytes is None and fields:
        data_bytes = urllib.parse.urlencode(fields).encode()
    elif data_bytes is None:
        data_bytes = b''

    req = urllib.request.Request(url, data=data_bytes, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return json.loads(body)
        except Exception:
            return {'error': {'message': body}}
    except Exception as e:
        return {'error': {'message': str(e)}}


def graph_delete(object_id):
    url = f'{GRAPH_API}/{object_id}?access_token={load_token()}'
    req = urllib.request.Request(url, method='DELETE')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return json.loads(body)
        except Exception:
            return {'error': {'message': body}}
    except Exception as e:
        return {'error': {'message': str(e)}}


def check_error(data):
    if isinstance(data, dict) and 'error' in data:
        err = data['error']
        msg = err.get('message', err) if isinstance(err, dict) else err
        print(f'ERROR: {msg}')
        sys.exit(1)


def pp(data):
    print(json.dumps(data, indent=2, ensure_ascii=False))


def range_to_preset(days):
    presets = {1: 'today', 7: 'last_7d', 14: 'last_14d', 28: 'last_28d', 30: 'last_30d', 90: 'last_90d'}
    return presets.get(int(days), 'last_7d')


def parse_flag(args, flag, default=None):
    """Extract --flag=value from args list."""
    for i, a in enumerate(args):
        if a.startswith(f'--{flag}='):
            val = a.split('=', 1)[1]
            args.pop(i)
            return val
    return default


# ── Commands ────────────────────────────────────────────────

def cmd_accounts():
    fields = 'name,account_id,account_status,currency,timezone_name,amount_spent,balance'
    url = f'{GRAPH_API}/me/adaccounts?fields={fields}&access_token={load_token()}'
    data = graph_get(url)
    check_error(data)
    accounts = [a for a in (data.get('data') or []) if a.get('id') in ACCOUNT_NAMES]
    for a in accounts:
        status_map = {1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 101: 'CLOSED'}
        a['account_status_name'] = status_map.get(a.get('account_status'), str(a.get('account_status')))
    pp({'accounts': accounts})


def cmd_campaigns(args):
    brand = args[0] if args else None
    status_filter = parse_flag(args, 'status')
    account = resolve_account(brand)
    fields = 'name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time'
    url = f'{GRAPH_API}/{account}/campaigns?fields={fields}&limit=50&access_token={load_token()}'
    if status_filter:
        effective_statuses = [s.strip().upper() for s in status_filter.split(',')]
        filter_param = json.dumps(effective_statuses)
        url += f'&filtering=[{{"field":"effective_status","operator":"IN","value":{filter_param}}}]'
    data = graph_get(url)
    check_error(data)

    campaigns = []
    for c in (data.get('data') or []):
        campaigns.append({
            'id': c['id'],
            'name': c.get('name', ''),
            'status': c.get('effective_status', ''),
            'objective': c.get('objective', ''),
            'daily_budget_dkk': float(c['daily_budget']) / 100 if c.get('daily_budget') else None,
            'lifetime_budget_dkk': float(c['lifetime_budget']) / 100 if c.get('lifetime_budget') else None,
            'budget_remaining_dkk': float(c['budget_remaining']) / 100 if c.get('budget_remaining') else None,
            'start_time': c.get('start_time', ''),
            'stop_time': c.get('stop_time', ''),
        })
    pp({'account': ACCOUNT_NAMES.get(account, account), 'campaigns': campaigns, 'count': len(campaigns)})


def cmd_insights(args):
    if not args:
        print('Usage: insights <campaign_id> [days]')
        sys.exit(1)
    entity_id = args[0]
    days = int(args[1]) if len(args) > 1 else 7
    fields = 'impressions,reach,clicks,cpc,cpm,ctr,spend,actions,cost_per_action_type,frequency,unique_clicks,unique_ctr,date_start,date_stop'
    preset = range_to_preset(days)
    url = f'{GRAPH_API}/{entity_id}/insights?fields={fields}&date_preset={preset}&access_token={load_token()}'
    data = graph_get(url)
    check_error(data)

    insights = data.get('data', [])
    if not insights:
        pp({'entity_id': entity_id, 'message': f'No data for last {days} days'})
        return

    i = insights[0]
    result = {
        'entity_id': entity_id,
        'period': f'last {days} days',
        'date_range': f"{i.get('date_start', '')} → {i.get('date_stop', '')}",
        'spend_dkk': i.get('spend', '0'),
        'impressions': i.get('impressions', '0'),
        'reach': i.get('reach', '0'),
        'clicks': i.get('clicks', '0'),
        'ctr': f"{i.get('ctr', '0')}%",
        'cpc_dkk': i.get('cpc', '0'),
        'cpm_dkk': i.get('cpm', '0'),
        'frequency': i.get('frequency', '0'),
    }

    for a in (i.get('actions') or []):
        at = a.get('action_type', '')
        if at == 'lead':
            result['leads'] = a['value']
        elif at == 'onsite_conversion.lead_grouped':
            result['onsite_leads'] = a['value']
        elif at == 'link_click':
            result['link_clicks'] = a['value']
        elif at == 'landing_page_view':
            result['landing_page_views'] = a['value']

    for cpa in (i.get('cost_per_action_type') or []):
        if cpa.get('action_type') == 'lead':
            result['cost_per_lead_dkk'] = cpa['value']

    pp(result)


def cmd_adsets(args):
    if not args:
        print('Usage: adsets <campaign_id>')
        sys.exit(1)
    campaign_id = args[0]
    fields = 'name,status,effective_status,campaign_id,daily_budget,lifetime_budget,budget_remaining,optimization_goal,billing_event,targeting,start_time,end_time'
    url = f'{GRAPH_API}/{campaign_id}/adsets?fields={fields}&limit=50&access_token={load_token()}'
    data = graph_get(url)
    check_error(data)

    adsets = []
    for a in (data.get('data') or []):
        adsets.append({
            'id': a['id'],
            'name': a.get('name', ''),
            'status': a.get('effective_status', ''),
            'daily_budget_dkk': float(a['daily_budget']) / 100 if a.get('daily_budget') else None,
            'lifetime_budget_dkk': float(a['lifetime_budget']) / 100 if a.get('lifetime_budget') else None,
            'optimization_goal': a.get('optimization_goal', ''),
            'targeting_summary': _summarize_targeting(a.get('targeting', {})),
        })
    pp({'adsets': adsets, 'count': len(adsets)})


def _summarize_targeting(targeting):
    """Summarize targeting spec into readable format."""
    if not targeting:
        return {}
    summary = {}
    if 'geo_locations' in targeting:
        geo = targeting['geo_locations']
        countries = geo.get('countries', [])
        cities = [c.get('name', '') for c in geo.get('cities', [])]
        if countries:
            summary['countries'] = countries
        if cities:
            summary['cities'] = cities
    if 'age_min' in targeting:
        summary['age'] = f"{targeting.get('age_min', 18)}-{targeting.get('age_max', 65)}"
    if 'genders' in targeting:
        gender_map = {1: 'male', 2: 'female'}
        summary['genders'] = [gender_map.get(g, str(g)) for g in targeting['genders']]
    if 'custom_audiences' in targeting:
        summary['custom_audiences'] = [ca.get('name', ca.get('id', '')) for ca in targeting['custom_audiences']]
    if 'flexible_spec' in targeting:
        interests = []
        for spec in targeting['flexible_spec']:
            for interest in spec.get('interests', []):
                interests.append(interest.get('name', ''))
        if interests:
            summary['interests'] = interests
    return summary


def cmd_ads(args):
    if not args:
        print('Usage: ads <adset_id>')
        sys.exit(1)
    adset_id = args[0]
    fields = 'name,status,effective_status,adset_id,campaign_id,creative{id,name,title,body,object_story_spec,url_tags},created_time,updated_time'
    url = f'{GRAPH_API}/{adset_id}/ads?fields={fields}&limit=50&access_token={load_token()}'
    data = graph_get(url)
    check_error(data)

    ads = []
    for a in (data.get('data') or []):
        ad = {
            'id': a['id'],
            'name': a.get('name', ''),
            'status': a.get('effective_status', ''),
            'created_time': a.get('created_time', ''),
        }
        creative = a.get('creative', {})
        if creative:
            ad['creative_id'] = creative.get('id', '')
        ads.append(ad)
    pp({'ads': ads, 'count': len(ads)})


def cmd_creative(args):
    """Get full creative details for an ad."""
    if not args:
        print('Usage: creative <ad_id>')
        sys.exit(1)
    ad_id = args[0]

    # First get the creative ID from the ad
    fields = 'creative{id}'
    url = f'{GRAPH_API}/{ad_id}?fields={fields}&access_token={load_token()}'
    data = graph_get(url)
    check_error(data)

    creative_id = data.get('creative', {}).get('id')
    if not creative_id:
        print('ERROR: No creative found for this ad')
        sys.exit(1)

    # Now get full creative details
    creative_fields = 'id,name,title,body,call_to_action_type,link_url,object_story_spec,asset_feed_spec,url_tags,image_url,thumbnail_url,effective_object_story_id'
    url = f'{GRAPH_API}/{creative_id}?fields={creative_fields}&access_token={load_token()}'
    data = graph_get(url)
    check_error(data)

    result = {'creative_id': creative_id}

    # Extract readable text fields
    if data.get('body'):
        result['primary_text'] = data['body']
    if data.get('title'):
        result['headline'] = data['title']
    if data.get('call_to_action_type'):
        result['cta'] = data['call_to_action_type']
    if data.get('link_url'):
        result['link'] = data['link_url']
    if data.get('image_url'):
        result['image_url'] = data['image_url']

    # Object story spec (richer details)
    oss = data.get('object_story_spec', {})
    if oss:
        link_data = oss.get('link_data', {})
        if link_data:
            if link_data.get('message'):
                result['primary_text'] = link_data['message']
            if link_data.get('name'):
                result['headline'] = link_data['name']
            if link_data.get('description'):
                result['description'] = link_data['description']
            if link_data.get('link'):
                result['link'] = link_data['link']
            if link_data.get('call_to_action', {}).get('type'):
                result['cta'] = link_data['call_to_action']['type']

        video_data = oss.get('video_data', {})
        if video_data:
            if video_data.get('message'):
                result['primary_text'] = video_data['message']
            if video_data.get('title'):
                result['headline'] = video_data['title']
            if video_data.get('call_to_action', {}).get('type'):
                result['cta'] = video_data['call_to_action']['type']

    # Asset feed spec (for dynamic creative)
    afs = data.get('asset_feed_spec', {})
    if afs:
        bodies = [b.get('text', '') for b in afs.get('bodies', [])]
        titles = [t.get('text', '') for t in afs.get('titles', [])]
        descriptions = [d.get('text', '') for d in afs.get('descriptions', [])]
        if bodies:
            result['primary_texts'] = bodies
        if titles:
            result['headlines'] = titles
        if descriptions:
            result['descriptions'] = descriptions

    pp(result)


def cmd_pause(args):
    if not args:
        print('Usage: pause <entity_id>')
        sys.exit(1)
    result = graph_post(args[0], {'status': 'PAUSED'})
    check_error(result)
    pp({'success': True, 'id': args[0], 'new_status': 'PAUSED'})


def cmd_resume(args):
    if not args:
        print('Usage: resume <entity_id>')
        sys.exit(1)
    result = graph_post(args[0], {'status': 'ACTIVE'})
    check_error(result)
    pp({'success': True, 'id': args[0], 'new_status': 'ACTIVE'})


def cmd_archive(args):
    if not args:
        print('Usage: archive <entity_id>')
        sys.exit(1)
    result = graph_post(args[0], {'status': 'ARCHIVED'})
    check_error(result)
    pp({'success': True, 'id': args[0], 'new_status': 'ARCHIVED'})


def cmd_delete(args):
    if not args:
        print('Usage: delete <entity_id>')
        sys.exit(1)
    result = graph_delete(args[0])
    check_error(result)
    pp({'success': True, 'id': args[0], 'action': 'deleted'})


def cmd_budget(args):
    if len(args) < 2:
        print('Usage: budget <entity_id> <daily_budget_dkk>')
        sys.exit(1)
    entity_id, amount = args[0], float(args[1])
    result = graph_post(entity_id, {'daily_budget': int(amount * 100)})
    check_error(result)
    pp({'success': True, 'id': entity_id, 'daily_budget_dkk': amount})


def cmd_lifetime_budget(args):
    if len(args) < 2:
        print('Usage: lifetime-budget <entity_id> <amount_dkk>')
        sys.exit(1)
    entity_id, amount = args[0], float(args[1])
    result = graph_post(entity_id, {'lifetime_budget': int(amount * 100)})
    check_error(result)
    pp({'success': True, 'id': entity_id, 'lifetime_budget_dkk': amount})


def cmd_duplicate(args):
    if not args:
        print('Usage: duplicate <entity_id>')
        sys.exit(1)
    url = f'{GRAPH_API}/{args[0]}/copies?access_token={load_token()}'
    data = urllib.parse.urlencode({'status_option': 'PAUSED'}).encode()
    result = graph_post(url, data_bytes=data)
    check_error(result)
    copied_id = result.get('copied_campaign_id') or result.get('copied_adset_id') or result.get('copied_ad_id') or result.get('id')
    pp({'success': True, 'original_id': args[0], 'copied_id': copied_id, 'status': 'PAUSED'})


def cmd_create_campaign(args):
    if len(args) < 4:
        print('Usage: create-campaign <brand> <name> <objective> <daily_budget_dkk> [--status=PAUSED]')
        print('Objectives: OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_AWARENESS, OUTCOME_ENGAGEMENT, OUTCOME_SALES')
        sys.exit(1)
    status = parse_flag(args, 'status', 'PAUSED')
    brand, name, objective, budget = args[0], args[1], args[2].upper(), float(args[3])
    account = resolve_account(brand)

    fields = {
        'name': name,
        'objective': objective,
        'status': status,
        'daily_budget': int(budget * 100),
        'special_ad_categories': '[]',
    }

    url = f'{GRAPH_API}/{account}/campaigns?access_token={load_token()}'
    result = graph_post(url, fields)
    check_error(result)
    pp({'success': True, 'campaign_id': result.get('id'), 'name': name, 'status': status})


def cmd_create_adset(args):
    if len(args) < 4:
        print('Usage: create-adset <campaign_id> <name> <daily_budget_dkk> <targeting_json_file> [--optimization=LEAD_GENERATION]')
        print('')
        print('targeting_json_file example:')
        print(json.dumps({
            'geo_locations': {'countries': ['DK']},
            'age_min': 25, 'age_max': 55,
            'genders': [2],
            'interests': [{'id': '6003384294789', 'name': 'Yoga'}],
        }, indent=2))
        sys.exit(1)

    optimization = parse_flag(args, 'optimization', 'LEAD_GENERATION')
    campaign_id, name, budget, targeting_file = args[0], args[1], float(args[2]), args[3]

    with open(targeting_file) as f:
        targeting = json.load(f)

    # Get account ID from campaign
    url = f'{GRAPH_API}/{campaign_id}?fields=account_id&access_token={load_token()}'
    campaign_data = graph_get(url)
    check_error(campaign_data)
    account = f"act_{campaign_data.get('account_id', '')}"

    fields = {
        'campaign_id': campaign_id,
        'name': name,
        'daily_budget': int(budget * 100),
        'optimization_goal': optimization,
        'billing_event': 'IMPRESSIONS',
        'targeting': json.dumps(targeting),
        'status': 'PAUSED',
    }

    url = f'{GRAPH_API}/{account}/adsets?access_token={load_token()}'
    result = graph_post(url, fields)
    check_error(result)
    pp({'success': True, 'adset_id': result.get('id'), 'name': name, 'status': 'PAUSED'})


def cmd_create_ad(args):
    if len(args) < 3:
        print('Usage: create-ad <adset_id> <name> <creative_json_file>')
        print('')
        print('creative_json_file example (link ad):')
        print(json.dumps({
            'page_id': 'YOUR_PAGE_ID',
            'link': 'https://yogabible.dk/200-timers-yogalaereruddannelse/',
            'message': 'Your primary text here...',
            'name': 'Your headline here',
            'description': 'Your link description',
            'call_to_action': {'type': 'LEARN_MORE'},
            'image_hash': 'abc123'
        }, indent=2))
        sys.exit(1)

    adset_id, name, creative_file = args[0], args[1], args[2]

    with open(creative_file) as f:
        creative_spec = json.load(f)

    # Get account ID from adset
    url = f'{GRAPH_API}/{adset_id}?fields=account_id&access_token={load_token()}'
    adset_data = graph_get(url)
    check_error(adset_data)
    account = f"act_{adset_data.get('account_id', '')}"

    # Build object_story_spec
    page_id = creative_spec.pop('page_id', None)
    image_hash = creative_spec.pop('image_hash', None)
    video_id = creative_spec.pop('video_id', None)

    if video_id:
        story_spec = {
            'page_id': page_id,
            'video_data': {
                'video_id': video_id,
                'message': creative_spec.get('message', ''),
                'title': creative_spec.get('name', ''),
                'call_to_action': creative_spec.get('call_to_action', {'type': 'LEARN_MORE'}),
                'link_description': creative_spec.get('description', ''),
            }
        }
    else:
        link_data = {
            'link': creative_spec.get('link', ''),
            'message': creative_spec.get('message', ''),
            'name': creative_spec.get('name', ''),
            'description': creative_spec.get('description', ''),
            'call_to_action': creative_spec.get('call_to_action', {'type': 'LEARN_MORE'}),
        }
        if image_hash:
            link_data['image_hash'] = image_hash
        story_spec = {
            'page_id': page_id,
            'link_data': link_data,
        }

    # Create ad creative
    creative_fields = {
        'name': f'{name} - Creative',
        'object_story_spec': json.dumps(story_spec),
    }
    url = f'{GRAPH_API}/{account}/adcreatives?access_token={load_token()}'
    creative_result = graph_post(url, creative_fields)
    check_error(creative_result)
    creative_id = creative_result.get('id')

    # Create ad
    ad_fields = {
        'name': name,
        'adset_id': adset_id,
        'creative': json.dumps({'creative_id': creative_id}),
        'status': 'PAUSED',
    }
    url = f'{GRAPH_API}/{account}/ads?access_token={load_token()}'
    result = graph_post(url, ad_fields)
    check_error(result)
    pp({'success': True, 'ad_id': result.get('id'), 'creative_id': creative_id, 'name': name, 'status': 'PAUSED'})


def cmd_update_ad_text(args):
    """Update the text fields of an ad's creative."""
    if len(args) < 3:
        print('Usage: update-ad-text <ad_id> <field> <value>')
        print('Fields: primary_text, headline, description, link, cta')
        print('CTA types: LEARN_MORE, SIGN_UP, APPLY_NOW, BOOK_TRAVEL, CONTACT_US, DOWNLOAD, GET_QUOTE, SUBSCRIBE')
        sys.exit(1)

    ad_id, field, value = args[0], args[1], ' '.join(args[2:])

    # Get current creative
    url = f'{GRAPH_API}/{ad_id}?fields=creative{id},account_id&access_token={load_token()}'
    ad_data = graph_get(url)
    check_error(ad_data)
    creative_id = ad_data.get('creative', {}).get('id')
    account = f"act_{ad_data.get('account_id', '')}"

    if not creative_id:
        print('ERROR: No creative found')
        sys.exit(1)

    # Get current creative details
    url = f'{GRAPH_API}/{creative_id}?fields=object_story_spec,name&access_token={load_token()}'
    creative_data = graph_get(url)
    check_error(creative_data)

    oss = creative_data.get('object_story_spec', {})
    link_data = oss.get('link_data', {})
    video_data = oss.get('video_data', {})
    data_key = 'link_data' if link_data else 'video_data'
    current_data = link_data or video_data

    if not current_data:
        print('ERROR: Cannot determine creative type')
        sys.exit(1)

    # Apply the change
    field_map = {
        'primary_text': 'message',
        'headline': 'name' if data_key == 'link_data' else 'title',
        'description': 'description' if data_key == 'link_data' else 'link_description',
        'link': 'link',
        'cta': 'call_to_action',
    }

    api_field = field_map.get(field)
    if not api_field:
        print(f'ERROR: Unknown field "{field}". Use: primary_text, headline, description, link, cta')
        sys.exit(1)

    if field == 'cta':
        current_data['call_to_action'] = {'type': value.upper()}
    else:
        current_data[api_field] = value

    oss[data_key] = current_data

    # Create new creative (Meta requires creating a new one)
    creative_fields = {
        'name': f"{creative_data.get('name', '')} (updated)",
        'object_story_spec': json.dumps(oss),
    }
    url = f'{GRAPH_API}/{account}/adcreatives?access_token={load_token()}'
    new_creative = graph_post(url, creative_fields)
    check_error(new_creative)
    new_creative_id = new_creative.get('id')

    # Update ad to use new creative
    result = graph_post(ad_id, {'creative': json.dumps({'creative_id': new_creative_id})})
    check_error(result)
    pp({'success': True, 'ad_id': ad_id, 'new_creative_id': new_creative_id, 'updated_field': field, 'new_value': value})


def cmd_audiences(args):
    brand = args[0] if args else None
    account = resolve_account(brand)
    fields = 'name,description,subtype,approximate_count,delivery_status,operation_status,time_created,time_updated'
    url = f'{GRAPH_API}/{account}/customaudiences?fields={fields}&limit=50&access_token={load_token()}'
    data = graph_get(url)
    check_error(data)

    audiences = []
    for a in (data.get('data') or []):
        audiences.append({
            'id': a['id'],
            'name': a.get('name', ''),
            'description': a.get('description', ''),
            'subtype': a.get('subtype', ''),
            'approximate_count': a.get('approximate_count', 0),
            'delivery_status': a.get('delivery_status', {}).get('status', ''),
        })
    pp({'account': ACCOUNT_NAMES.get(account, account), 'audiences': audiences, 'count': len(audiences)})


def cmd_create_audience(args):
    if len(args) < 3:
        print('Usage: create-audience <brand> <name> <description> [--subtype=CUSTOM]')
        print('Subtypes: CUSTOM, WEBSITE, LOOKALIKE, ENGAGEMENT')
        sys.exit(1)
    subtype = parse_flag(args, 'subtype', 'CUSTOM')
    brand, name, description = args[0], args[1], ' '.join(args[2:])
    account = resolve_account(brand)

    fields = {
        'name': name,
        'description': description,
        'subtype': subtype,
    }

    url = f'{GRAPH_API}/{account}/customaudiences?access_token={load_token()}'
    result = graph_post(url, fields)
    check_error(result)
    pp({'success': True, 'audience_id': result.get('id'), 'name': name, 'subtype': subtype})


def cmd_delete_audience(args):
    if not args:
        print('Usage: delete-audience <audience_id>')
        sys.exit(1)
    result = graph_delete(args[0])
    check_error(result)
    pp({'success': True, 'audience_id': args[0], 'action': 'deleted'})


def cmd_leadforms(args):
    """List instant forms for a page."""
    brand = args[0] if args else None
    account = resolve_account(brand)

    # Get page ID from ad account
    url = f'{GRAPH_API}/{account}?fields=business{id,name}&access_token={load_token()}'
    acct_data = graph_get(url)

    # Try to get forms directly from the ad account's associated pages
    # First, get pages the token has access to
    url = f'{GRAPH_API}/me/accounts?fields=id,name,access_token&access_token={load_token()}'
    pages_data = graph_get(url)
    check_error(pages_data)

    all_forms = []
    for page in (pages_data.get('data') or []):
        page_id = page['id']
        page_name = page.get('name', '')
        page_token = page.get('access_token', load_token())
        fields = 'id,name,status,leads_count,created_time,expired_at,qualifiers'
        url = f'{GRAPH_API}/{page_id}/leadgen_forms?fields={fields}&access_token={page_token}'
        forms_data = graph_get(url)
        if 'error' not in forms_data:
            for form in (forms_data.get('data') or []):
                form['page_name'] = page_name
                form['page_id'] = page_id
                all_forms.append(form)

    pp({'forms': all_forms, 'count': len(all_forms)})


def cmd_leadform_detail(args):
    """Get detailed info about an instant form."""
    if not args:
        print('Usage: leadform <form_id>')
        sys.exit(1)
    form_id = args[0]
    fields = 'id,name,status,leads_count,created_time,expired_at,questions,privacy_policy,thank_you_page,qualifiers'
    url = f'{GRAPH_API}/{form_id}?fields={fields}&access_token={load_token()}'
    data = graph_get(url)
    check_error(data)
    pp(data)


def cmd_create_leadform(args):
    """Create an instant form from a JSON spec file."""
    if len(args) < 2:
        print('Usage: create-leadform <brand> <form_json_file>')
        print('')
        print('form_json_file example:')
        print(json.dumps({
            'name': 'YTT Lead Form - April 2026',
            'questions': [
                {'type': 'FULL_NAME'},
                {'type': 'EMAIL'},
                {'type': 'PHONE'},
                {'type': 'CUSTOM', 'key': 'interest', 'label': 'Which program interests you?',
                 'options': [
                     {'value': '4-Week Intensive', 'key': '4w'},
                     {'value': '8-Week Semi-Intensive', 'key': '8w'},
                     {'value': '18-Week Flexible', 'key': '18w'},
                 ]}
            ],
            'privacy_policy': {'url': 'https://yogabible.dk/privacy-policy/', 'link_text': 'Privacy Policy'},
            'thank_you_page': {
                'title': 'Thank you for your interest!',
                'body': 'We will contact you within 24 hours.',
                'button_text': 'Visit our website',
                'button_type': 'VIEW_WEBSITE',
                'website_url': 'https://yogabible.dk/200-timers-yogalaereruddannelse/'
            },
            'follow_up_action_url': 'https://yogabible.dk/200-timers-yogalaereruddannelse/',
        }, indent=2))
        sys.exit(1)

    brand, form_file = args[0], args[1]

    with open(form_file) as f:
        form_spec = json.load(f)

    # Get page ID
    url = f'{GRAPH_API}/me/accounts?fields=id,name,access_token&access_token={load_token()}'
    pages_data = graph_get(url)
    check_error(pages_data)

    pages = pages_data.get('data', [])
    if not pages:
        print('ERROR: No pages found. Token needs pages_manage_metadata permission.')
        sys.exit(1)

    # Use first page (or let user specify)
    page = pages[0]
    page_token = page.get('access_token', load_token())

    fields = {
        'name': form_spec['name'],
        'questions': json.dumps(form_spec.get('questions', [])),
        'privacy_policy': json.dumps(form_spec.get('privacy_policy', {})),
    }
    if 'thank_you_page' in form_spec:
        fields['thank_you_page'] = json.dumps(form_spec['thank_you_page'])
    if 'follow_up_action_url' in form_spec:
        fields['follow_up_action_url'] = form_spec['follow_up_action_url']

    url = f'{GRAPH_API}/{page["id"]}/leadgen_forms?access_token={page_token}'
    result = graph_post(url, fields)
    check_error(result)
    pp({'success': True, 'form_id': result.get('id'), 'page': page.get('name'), 'name': form_spec['name']})


def cmd_page_posts(args):
    """List recent page posts (useful for promoting existing posts as ads)."""
    brand = args[0] if args else None
    limit = int(parse_flag(args, 'limit', '10'))

    url = f'{GRAPH_API}/me/accounts?fields=id,name,access_token&access_token={load_token()}'
    pages_data = graph_get(url)
    check_error(pages_data)

    for page in (pages_data.get('data') or []):
        page_token = page.get('access_token', load_token())
        fields = 'id,message,created_time,type,permalink_url,full_picture,shares'
        url = f'{GRAPH_API}/{page["id"]}/posts?fields={fields}&limit={limit}&access_token={page_token}'
        posts_data = graph_get(url)
        if 'error' not in posts_data:
            posts = []
            for p in (posts_data.get('data') or []):
                posts.append({
                    'id': p['id'],
                    'message': (p.get('message', '')[:100] + '...') if len(p.get('message', '')) > 100 else p.get('message', ''),
                    'type': p.get('type', ''),
                    'created_time': p.get('created_time', ''),
                    'permalink': p.get('permalink_url', ''),
                })
            pp({'page': page.get('name'), 'posts': posts, 'count': len(posts)})


def cmd_account_insights(args):
    brand = args[0] if args else None
    days = int(args[1]) if len(args) > 1 else 7
    account = resolve_account(brand)
    fields = 'impressions,reach,clicks,cpc,cpm,ctr,spend,actions,cost_per_action_type,frequency'
    preset = range_to_preset(days)
    url = f'{GRAPH_API}/{account}/insights?fields={fields}&date_preset={preset}&access_token={load_token()}'
    data = graph_get(url)
    check_error(data)

    insights = data.get('data', [])
    if not insights:
        pp({'account': ACCOUNT_NAMES.get(account), 'message': f'No data for last {days} days'})
        return

    i = insights[0]
    result = {
        'account': ACCOUNT_NAMES.get(account, account),
        'period': f'last {days} days',
        'spend_dkk': i.get('spend', '0'),
        'impressions': i.get('impressions', '0'),
        'reach': i.get('reach', '0'),
        'clicks': i.get('clicks', '0'),
        'ctr': f"{i.get('ctr', '0')}%",
        'cpc_dkk': i.get('cpc', '0'),
        'frequency': i.get('frequency', '0'),
    }

    for a in (i.get('actions') or []):
        if a.get('action_type') == 'lead':
            result['leads'] = a['value']
    for cpa in (i.get('cost_per_action_type') or []):
        if cpa.get('action_type') == 'lead':
            result['cost_per_lead_dkk'] = cpa['value']

    pp(result)


# ── Main ────────────────────────────────────────────────────

COMMANDS = {
    'accounts': lambda args: cmd_accounts(),
    'campaigns': cmd_campaigns,
    'insights': cmd_insights,
    'account-insights': cmd_account_insights,
    'adsets': cmd_adsets,
    'adset-insights': cmd_insights,  # Same function, works for any entity
    'ads': cmd_ads,
    'ad-insights': cmd_insights,     # Same function, works for any entity
    'creative': cmd_creative,
    'pause': cmd_pause,
    'resume': cmd_resume,
    'archive': cmd_archive,
    'delete': cmd_delete,
    'budget': cmd_budget,
    'lifetime-budget': cmd_lifetime_budget,
    'duplicate': cmd_duplicate,
    'create-campaign': cmd_create_campaign,
    'create-adset': cmd_create_adset,
    'create-ad': cmd_create_ad,
    'update-ad-text': cmd_update_ad_text,
    'audiences': cmd_audiences,
    'create-audience': cmd_create_audience,
    'delete-audience': cmd_delete_audience,
    'leadforms': cmd_leadforms,
    'leadform': cmd_leadform_detail,
    'create-leadform': cmd_create_leadform,
    'page-posts': cmd_page_posts,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ('-h', '--help', 'help'):
        print(__doc__)
        sys.exit(0)

    command = sys.argv[1]
    args = sys.argv[2:]

    if command not in COMMANDS:
        print(f'Unknown command: {command}')
        print(f'Available: {", ".join(sorted(COMMANDS.keys()))}')
        sys.exit(1)

    load_token()
    COMMANDS[command](args)


if __name__ == '__main__':
    main()
