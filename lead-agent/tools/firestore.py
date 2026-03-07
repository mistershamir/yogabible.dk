"""
Firestore tools for the lead management agent.
Reads/writes to the same Firestore collections as the Netlify functions.
"""

import os
import json
from datetime import datetime, timezone
from google.cloud import firestore

_db = None

def get_db():
    global _db
    if _db is None:
        _db = firestore.Client()
    return _db


def get_new_leads(since_hours=24):
    """Get leads created in the last N hours."""
    db = get_db()
    cutoff = datetime.now(timezone.utc).timestamp() - (since_hours * 3600)
    cutoff_dt = datetime.fromtimestamp(cutoff, tz=timezone.utc)

    leads = []
    docs = (db.collection('leads')
            .where('created_at', '>=', cutoff_dt)
            .order_by('created_at', direction=firestore.Query.DESCENDING)
            .stream())
    for doc in docs:
        d = doc.to_dict()
        d['id'] = doc.id
        leads.append(d)
    return leads


def get_lead_by_email(email):
    """Find a lead by email address."""
    db = get_db()
    docs = (db.collection('leads')
            .where('email', '==', email.lower().strip())
            .limit(1)
            .stream())
    for doc in docs:
        d = doc.to_dict()
        d['id'] = doc.id
        return d
    return None


def get_lead_by_name(first_name, last_name=None):
    """Find leads by name (partial match on first_name)."""
    db = get_db()
    query = db.collection('leads').where('first_name', '==', first_name)
    if last_name:
        query = query.where('last_name', '==', last_name)

    leads = []
    for doc in query.limit(10).stream():
        d = doc.to_dict()
        d['id'] = doc.id
        leads.append(d)
    return leads


def update_lead(lead_id, updates):
    """Update a lead document in Firestore."""
    db = get_db()
    updates['updated_at'] = datetime.now(timezone.utc)
    db.collection('leads').document(lead_id).update(updates)
    return True


def add_lead_note(lead_id, note):
    """Append a timestamped note to a lead."""
    db = get_db()
    lead_ref = db.collection('leads').document(lead_id)
    lead = lead_ref.get().to_dict()
    existing_notes = lead.get('notes', '')
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')
    new_notes = f"[{timestamp} AI Agent] {note}\n{existing_notes}"
    lead_ref.update({
        'notes': new_notes,
        'updated_at': datetime.now(timezone.utc)
    })
    return True


def get_drip_status(lead_id):
    """Get the drip sequence status for a lead."""
    db = get_db()
    doc = db.collection('lead_drip_sequences').document(lead_id).get()
    if doc.exists:
        return doc.to_dict()
    return None


def set_drip_status(lead_id, data):
    """Create or update drip sequence tracking for a lead."""
    db = get_db()
    data['updated_at'] = datetime.now(timezone.utc)
    db.collection('lead_drip_sequences').document(lead_id).set(data, merge=True)
    return True


def pause_drip(lead_id, reason=''):
    """Pause the drip sequence for a lead."""
    return set_drip_status(lead_id, {
        'paused': True,
        'paused_at': datetime.now(timezone.utc),
        'pause_reason': reason
    })


def resume_drip(lead_id, from_step=None):
    """Resume a paused drip sequence, optionally from a specific step."""
    updates = {
        'paused': False,
        'resumed_at': datetime.now(timezone.utc)
    }
    if from_step is not None:
        updates['current_step'] = from_step
    return set_drip_status(lead_id, updates)


def get_leads_due_for_drip():
    """Find leads whose next drip email is due."""
    db = get_db()
    now = datetime.now(timezone.utc)

    due_leads = []
    docs = (db.collection('lead_drip_sequences')
            .where('paused', '==', False)
            .where('completed', '==', False)
            .where('next_send_at', '<=', now)
            .stream())

    for doc in docs:
        d = doc.to_dict()
        d['lead_id'] = doc.id
        # Fetch the actual lead data
        lead_doc = db.collection('leads').document(doc.id).get()
        if lead_doc.exists:
            lead_data = lead_doc.to_dict()
            if not lead_data.get('unsubscribed'):
                d['lead'] = lead_data
                due_leads.append(d)

    return due_leads


def log_email_sent(lead_id, email_to, subject, step):
    """Log an email sent to a lead."""
    db = get_db()
    db.collection('email_log').add({
        'lead_id': lead_id,
        'to': email_to,
        'subject': subject,
        'template_id': f'drip_step_{step}',
        'sent_at': datetime.now(timezone.utc),
        'status': 'sent',
        'source': 'ai_agent'
    })
    return True


def get_pipeline_stats():
    """Get lead pipeline stats: counts by status, temperature, recent conversions."""
    db = get_db()
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - __import__('datetime').timedelta(days=30)

    stats = {
        'by_status': {},
        'by_temperature': {},
        'total': 0,
        'converted_this_month': 0,
        'new_this_week': 0,
    }

    seven_days_ago = now - __import__('datetime').timedelta(days=7)

    for doc in db.collection('leads').stream():
        lead = doc.to_dict()
        stats['total'] += 1

        status = lead.get('status', 'Unknown')
        stats['by_status'][status] = stats['by_status'].get(status, 0) + 1

        temp = lead.get('temperature', '')
        if temp:
            stats['by_temperature'][temp] = stats['by_temperature'].get(temp, 0) + 1

        created = lead.get('created_at')
        if created:
            if hasattr(created, 'timestamp'):
                created_ts = created
            else:
                continue
            if created_ts >= thirty_days_ago and lead.get('converted'):
                stats['converted_this_month'] += 1
            if created_ts >= seven_days_ago:
                stats['new_this_week'] += 1

    return stats


def get_stale_leads(stale_days=3):
    """Find leads that are New or In Progress with no update in stale_days days."""
    db = get_db()
    now = datetime.now(timezone.utc)
    cutoff = now - __import__('datetime').timedelta(days=stale_days)

    stale = []
    for doc in db.collection('leads').stream():
        lead = doc.to_dict()
        lead['id'] = doc.id
        status = lead.get('status', '')
        if status not in ('New', 'In Progress'):
            continue
        if lead.get('converted') or lead.get('unsubscribed'):
            continue

        # Check last activity: updated_at or created_at
        last_activity = lead.get('updated_at') or lead.get('created_at')
        if last_activity and hasattr(last_activity, 'timestamp') and last_activity < cutoff:
            days_idle = (now - last_activity).days
            stale.append({
                'id': doc.id,
                'name': f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip(),
                'email': lead.get('email'),
                'phone': lead.get('phone'),
                'status': status,
                'program': lead.get('program') or lead.get('ytt_program_type'),
                'days_idle': days_idle,
                'created_at': str(lead.get('created_at', '')),
            })

    # Sort by most idle first
    stale.sort(key=lambda x: x['days_idle'], reverse=True)
    return stale


def listen_new_leads(callback):
    """Real-time listener for new leads. Calls callback(lead_dict) for each new lead."""
    db = get_db()

    def on_snapshot(doc_snapshot, changes, read_time):
        for change in changes:
            if change.type.name == 'ADDED':
                d = change.document.to_dict()
                d['id'] = change.document.id
                callback(d)

    # Watch for leads created in the last minute (to catch new ones)
    cutoff = datetime.now(timezone.utc)
    query = db.collection('leads').where('created_at', '>=', cutoff)
    query.on_snapshot(on_snapshot)
