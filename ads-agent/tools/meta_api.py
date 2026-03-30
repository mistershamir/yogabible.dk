"""
Meta Marketing API wrapper — direct Graph API calls for ad management.
Used by the ads agent as Claude tool implementations.
"""

import os
import json
import logging
import urllib.request
import urllib.parse
import urllib.error

logger = logging.getLogger('ads-agent.meta_api')

GRAPH_API = 'https://graph.facebook.com/v25.0'

AD_ACCOUNTS = {
    'yoga-bible': 'act_1137462911884203',
    'hyc': 'act_518096093802228',
}

ACCOUNT_NAMES = {
    'act_1137462911884203': 'Yoga Bible',
    'act_518096093802228': 'Hot Yoga CPH',
}


def _token():
    return os.getenv('META_ACCESS_TOKEN', '')


def _graph_get(url):
    """GET request to Graph API."""
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            if 'error' in data:
                return {'error': data['error'].get('message', 'Unknown Graph API error')}
            return data
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            err = json.loads(body)
            return {'error': err.get('error', {}).get('message', body)}
        except Exception:
            return {'error': body}
    except Exception as e:
        return {'error': str(e)}


def _graph_post(object_id, fields):
    """POST update to Graph API."""
    url = f'{GRAPH_API}/{object_id}?access_token={_token()}'
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            if 'error' in result:
                return {'error': result['error'].get('message', 'Unknown error')}
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            err = json.loads(body)
            return {'error': err.get('error', {}).get('message', body)}
        except Exception:
            return {'error': body}
    except Exception as e:
        return {'error': str(e)}


def _range_to_preset(days):
    presets = {1: 'today', 7: 'last_7d', 14: 'last_14d', 28: 'last_28d', 30: 'last_30d', 90: 'last_90d'}
    return presets.get(days, 'last_7d')


def _resolve_account(brand):
    """Resolve brand name to ad account ID."""
    if not brand:
        return AD_ACCOUNTS.get('yoga-bible')
    brand_lower = brand.lower().strip()
    if 'hyc' in brand_lower or 'hot' in brand_lower or 'cph' in brand_lower:
        return AD_ACCOUNTS['hyc']
    return AD_ACCOUNTS['yoga-bible']


# ═══════════════════════════════════════════════════════════
# Tool implementations (called by agent.py execute_tool)
# ═══════════════════════════════════════════════════════════

def get_ad_accounts():
    """List all ad accounts with basic info."""
    fields = 'name,account_id,account_status,currency,timezone_name,amount_spent,balance'
    url = f'{GRAPH_API}/me/adaccounts?fields={fields}&access_token={_token()}'
    data = _graph_get(url)
    if 'error' in data:
        return data
    accounts = [a for a in (data.get('data') or []) if a.get('id') in ACCOUNT_NAMES]
    return {'accounts': accounts}


def get_campaigns(brand=None, limit=25):
    """Get campaigns for an ad account."""
    account = _resolve_account(brand)
    fields = 'name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time'
    url = f'{GRAPH_API}/{account}/campaigns?fields={fields}&limit={limit}&access_token={_token()}'
    data = _graph_get(url)
    if 'error' in data:
        return data

    campaigns = []
    for c in (data.get('data') or []):
        campaigns.append({
            'id': c['id'],
            'name': c.get('name', ''),
            'status': c.get('effective_status', ''),
            'objective': c.get('objective', ''),
            'daily_budget': float(c['daily_budget']) / 100 if c.get('daily_budget') else None,
            'lifetime_budget': float(c['lifetime_budget']) / 100 if c.get('lifetime_budget') else None,
            'budget_remaining': float(c['budget_remaining']) / 100 if c.get('budget_remaining') else None,
            'start_time': c.get('start_time', ''),
        })
    return {'account': ACCOUNT_NAMES.get(account, account), 'campaigns': campaigns, 'count': len(campaigns)}


def get_campaign_insights(campaign_id, days=7):
    """Get performance insights for a specific campaign."""
    fields = 'impressions,reach,clicks,cpc,cpm,ctr,spend,actions,cost_per_action_type,frequency,unique_clicks,unique_ctr,date_start,date_stop'
    preset = _range_to_preset(days)
    url = f'{GRAPH_API}/{campaign_id}/insights?fields={fields}&date_preset={preset}&access_token={_token()}'
    data = _graph_get(url)
    if 'error' in data:
        return data

    insights = data.get('data', [])
    if not insights:
        return {'campaign_id': campaign_id, 'message': 'No data for this period'}

    i = insights[0]
    result = {
        'campaign_id': campaign_id,
        'period': f'last {days} days',
        'spend': i.get('spend', '0'),
        'impressions': i.get('impressions', '0'),
        'reach': i.get('reach', '0'),
        'clicks': i.get('clicks', '0'),
        'ctr': i.get('ctr', '0'),
        'cpc': i.get('cpc', '0'),
        'cpm': i.get('cpm', '0'),
        'frequency': i.get('frequency', '0'),
    }

    # Extract lead count
    actions = i.get('actions', [])
    for a in actions:
        if a.get('action_type') == 'lead':
            result['leads'] = a['value']
        elif a.get('action_type') == 'onsite_conversion.lead_grouped':
            result['onsite_leads'] = a['value']
        elif a.get('action_type') == 'link_click':
            result['link_clicks'] = a['value']

    # Cost per lead
    for cpa in (i.get('cost_per_action_type') or []):
        if cpa.get('action_type') == 'lead':
            result['cost_per_lead'] = cpa['value']

    return result


def get_account_insights(brand=None, days=7):
    """Get account-level performance summary."""
    account = _resolve_account(brand)
    fields = 'impressions,reach,clicks,cpc,cpm,ctr,spend,actions,cost_per_action_type,frequency'
    preset = _range_to_preset(days)
    url = f'{GRAPH_API}/{account}/insights?fields={fields}&date_preset={preset}&access_token={_token()}'
    data = _graph_get(url)
    if 'error' in data:
        return data

    insights = data.get('data', [])
    if not insights:
        return {'account': ACCOUNT_NAMES.get(account), 'message': 'No data for this period'}

    i = insights[0]
    result = {
        'account': ACCOUNT_NAMES.get(account, account),
        'period': f'last {days} days',
        'spend': i.get('spend', '0'),
        'impressions': i.get('impressions', '0'),
        'reach': i.get('reach', '0'),
        'clicks': i.get('clicks', '0'),
        'ctr': i.get('ctr', '0'),
        'cpc': i.get('cpc', '0'),
        'frequency': i.get('frequency', '0'),
    }

    # Extract actions
    for a in (i.get('actions') or []):
        if a.get('action_type') == 'lead':
            result['leads'] = a['value']
    for cpa in (i.get('cost_per_action_type') or []):
        if cpa.get('action_type') == 'lead':
            result['cost_per_lead'] = cpa['value']

    return result


def get_adsets(campaign_id=None, brand=None):
    """Get ad sets for a campaign or account."""
    fields = 'name,status,effective_status,campaign_id,daily_budget,lifetime_budget,budget_remaining,optimization_goal,billing_event,start_time,end_time'

    if campaign_id:
        url = f'{GRAPH_API}/{campaign_id}/adsets?fields={fields}&limit=50&access_token={_token()}'
    else:
        account = _resolve_account(brand)
        url = f'{GRAPH_API}/{account}/adsets?fields={fields}&limit=50&access_token={_token()}'

    data = _graph_get(url)
    if 'error' in data:
        return data

    adsets = []
    for a in (data.get('data') or []):
        adsets.append({
            'id': a['id'],
            'name': a.get('name', ''),
            'status': a.get('effective_status', ''),
            'daily_budget': float(a['daily_budget']) / 100 if a.get('daily_budget') else None,
            'lifetime_budget': float(a['lifetime_budget']) / 100 if a.get('lifetime_budget') else None,
            'optimization_goal': a.get('optimization_goal', ''),
        })
    return {'adsets': adsets, 'count': len(adsets)}


def get_ads(adset_id=None, brand=None):
    """Get ads for an ad set or account."""
    fields = 'name,status,effective_status,adset_id,campaign_id,creative,created_time'

    if adset_id:
        url = f'{GRAPH_API}/{adset_id}/ads?fields={fields}&limit=50&access_token={_token()}'
    else:
        account = _resolve_account(brand)
        url = f'{GRAPH_API}/{account}/ads?fields={fields}&limit=50&access_token={_token()}'

    data = _graph_get(url)
    if 'error' in data:
        return data

    ads = []
    for a in (data.get('data') or []):
        ads.append({
            'id': a['id'],
            'name': a.get('name', ''),
            'status': a.get('effective_status', ''),
            'adset_id': a.get('adset_id', ''),
            'campaign_id': a.get('campaign_id', ''),
            'created_time': a.get('created_time', ''),
        })
    return {'ads': ads, 'count': len(ads)}


def update_status(entity_id, new_status):
    """Pause, resume, or archive a campaign/adset/ad."""
    if new_status not in ('ACTIVE', 'PAUSED', 'ARCHIVED'):
        return {'error': f'Invalid status: {new_status}. Use ACTIVE, PAUSED, or ARCHIVED.'}

    result = _graph_post(entity_id, {'status': new_status})
    if 'error' in result:
        return result
    return {'success': True, 'id': entity_id, 'new_status': new_status}


def update_budget(entity_id, daily_budget=None, lifetime_budget=None):
    """Update daily or lifetime budget (in DKK)."""
    fields = {}
    if daily_budget is not None:
        fields['daily_budget'] = int(float(daily_budget) * 100)
    if lifetime_budget is not None:
        fields['lifetime_budget'] = int(float(lifetime_budget) * 100)

    if not fields:
        return {'error': 'Provide daily_budget or lifetime_budget (in DKK)'}

    result = _graph_post(entity_id, fields)
    if 'error' in result:
        return result
    return {'success': True, 'id': entity_id, 'updated': {k: v / 100 for k, v in fields.items()}}


def update_schedule(entity_id, start_time=None, end_time=None):
    """Update start or end time of an ad set."""
    fields = {}
    if start_time:
        fields['start_time'] = start_time
    if end_time:
        fields['end_time'] = end_time
    if not fields:
        return {'error': 'Provide start_time or end_time (ISO 8601)'}

    result = _graph_post(entity_id, fields)
    if 'error' in result:
        return result
    return {'success': True, 'id': entity_id, 'updated': fields}


def duplicate_entity(entity_id):
    """Duplicate a campaign, ad set, or ad (created as PAUSED)."""
    url = f'{GRAPH_API}/{entity_id}/copies?access_token={_token()}'
    data = urllib.parse.urlencode({'status_option': 'PAUSED'}).encode()
    req = urllib.request.Request(url, data=data, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            if 'error' in result:
                return {'error': result['error'].get('message', 'Duplicate failed')}
            copied_id = result.get('copied_campaign_id') or result.get('copied_adset_id') or result.get('copied_ad_id') or result.get('id')
            return {'success': True, 'copied_id': copied_id}
    except Exception as e:
        return {'error': str(e)}
