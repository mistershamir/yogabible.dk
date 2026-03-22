"""
Keyword History — weekly snapshot storage and week-over-week comparison.

Stores GSC query data in a local JSON file (seo-agent/data/keyword_history.json).
Each week's snapshot includes all queries with position, clicks, impressions.
Comparison logic detects: position movers, new queries, lost queries.
"""

import os
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger('seo-agent.keywords')

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
HISTORY_FILE = os.path.join(DATA_DIR, 'keyword_history.json')

# Keep 12 weeks of history (3 months)
MAX_SNAPSHOTS = 12


def _ensure_data_dir():
    """Create data directory if it doesn't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)


def _load_history():
    """Load keyword history from disk."""
    if not os.path.exists(HISTORY_FILE):
        return {'snapshots': []}
    try:
        with open(HISTORY_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {'snapshots': []}


def _save_history(history):
    """Save keyword history to disk."""
    _ensure_data_dir()
    with open(HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2, ensure_ascii=False)


def save_snapshot(queries):
    """
    Save this week's query data as a snapshot.
    queries: list of dicts with keys: query, position, clicks, impressions, ctr
    """
    history = _load_history()

    snapshot = {
        'date': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'queries': {q['query']: {
            'position': q['position'],
            'clicks': q['clicks'],
            'impressions': q['impressions'],
        } for q in queries},
    }

    history['snapshots'].append(snapshot)

    # Trim to max snapshots
    if len(history['snapshots']) > MAX_SNAPSHOTS:
        history['snapshots'] = history['snapshots'][-MAX_SNAPSHOTS:]

    _save_history(history)
    logger.info(f'Saved keyword snapshot with {len(queries)} queries')


def compare_with_previous():
    """
    Compare current snapshot with the previous week.
    Returns dict with: movers_up, movers_down, new_queries, lost_queries, summary.
    """
    history = _load_history()
    snapshots = history.get('snapshots', [])

    result = {
        'movers_up': [],      # Position improved (lower number)
        'movers_down': [],    # Position dropped (higher number)
        'new_queries': [],    # Queries that appeared this week
        'lost_queries': [],   # Queries that disappeared
        'weeks_of_data': len(snapshots),
    }

    if len(snapshots) < 2:
        return result

    current = snapshots[-1]['queries']
    previous = snapshots[-2]['queries']
    prev_date = snapshots[-2]['date']

    current_keys = set(current.keys())
    previous_keys = set(previous.keys())

    # New queries (appeared this week)
    for q in current_keys - previous_keys:
        data = current[q]
        if data['impressions'] >= 5:  # Only report meaningful queries
            result['new_queries'].append({
                'query': q,
                'position': data['position'],
                'clicks': data['clicks'],
                'impressions': data['impressions'],
            })

    # Lost queries (disappeared this week)
    for q in previous_keys - current_keys:
        data = previous[q]
        if data['impressions'] >= 5:
            result['lost_queries'].append({
                'query': q,
                'last_position': data['position'],
                'last_clicks': data['clicks'],
            })

    # Position changes for queries present in both weeks
    for q in current_keys & previous_keys:
        curr_pos = current[q]['position']
        prev_pos = previous[q]['position']
        delta = prev_pos - curr_pos  # Positive = improved (moved up)

        if abs(delta) < 1.0:
            continue  # Ignore tiny fluctuations

        entry = {
            'query': q,
            'position': round(curr_pos, 1),
            'previous_position': round(prev_pos, 1),
            'delta': round(delta, 1),
            'clicks': current[q]['clicks'],
            'impressions': current[q]['impressions'],
        }

        if delta > 0:
            result['movers_up'].append(entry)
        else:
            result['movers_down'].append(entry)

    # Sort by magnitude of change
    result['movers_up'].sort(key=lambda x: x['delta'], reverse=True)
    result['movers_down'].sort(key=lambda x: x['delta'])

    # Keep top movers only
    result['movers_up'] = result['movers_up'][:10]
    result['movers_down'] = result['movers_down'][:10]
    result['new_queries'] = sorted(result['new_queries'], key=lambda x: x['impressions'], reverse=True)[:10]
    result['lost_queries'] = sorted(result['lost_queries'], key=lambda x: x['last_clicks'], reverse=True)[:5]

    return result


def get_trend_for_keyword(keyword, weeks=4):
    """
    Get position trend for a specific keyword over the last N weeks.
    Returns list of {date, position} or empty list if not enough data.
    """
    history = _load_history()
    snapshots = history.get('snapshots', [])[-weeks:]

    trend = []
    for snap in snapshots:
        queries = snap.get('queries', {})
        if keyword in queries:
            trend.append({
                'date': snap['date'],
                'position': queries[keyword]['position'],
                'clicks': queries[keyword]['clicks'],
            })

    return trend
