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
        'by_channel': {},
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

        channel = lead.get('channel', '')
        if channel:
            stats['by_channel'][channel] = stats['by_channel'].get(channel, 0) + 1

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


# ═══════════════════════════════════════════════════════════════════
# COMMUNICATION HISTORY TOOLS
# ═══════════════════════════════════════════════════════════════════

def get_lead_communication_history(lead_id, limit=20):
    """Get full communication history for a lead: emails, SMS, campaigns, drip steps."""
    db = get_db()
    history = []

    # Email log
    emails = (db.collection('email_log')
              .where('lead_id', '==', lead_id)
              .order_by('sent_at', direction=firestore.Query.DESCENDING)
              .limit(limit)
              .stream())
    for doc in emails:
        d = doc.to_dict()
        d['type'] = 'email'
        d['id'] = doc.id
        history.append(d)

    # SMS log (from lead document's notes or sms_campaign_log)
    lead_doc = db.collection('leads').document(lead_id).get()
    if lead_doc.exists:
        lead = lead_doc.to_dict()
        if lead.get('last_sms_campaign'):
            sms = lead['last_sms_campaign']
            sms['type'] = 'sms_campaign'
            history.append(sms)

    # Sort by date
    history.sort(key=lambda x: str(x.get('sent_at', x.get('sentAt', ''))), reverse=True)
    return history[:limit]


def get_lead_full_context(lead_id):
    """Get complete lead context: profile, drip status, communication history, sequence enrollments."""
    db = get_db()

    # Lead profile
    lead_doc = db.collection('leads').document(lead_id).get()
    if not lead_doc.exists:
        return None
    lead = lead_doc.to_dict()
    lead['id'] = lead_id

    # Drip status
    drip = get_drip_status(lead_id)

    # Communication history
    comms = get_lead_communication_history(lead_id, limit=10)

    # Sequence enrollments
    enrollments = []
    try:
        seq_docs = (db.collection('sequence_enrollments')
                    .where('lead_id', '==', lead_id)
                    .stream())
        for doc in seq_docs:
            d = doc.to_dict()
            d['id'] = doc.id
            enrollments.append(d)
    except Exception:
        pass  # Collection may not exist yet

    return {
        'lead': lead,
        'drip': drip,
        'recent_communications': comms,
        'sequences': enrollments,
        'communication_count': len(comms)
    }


# ═══════════════════════════════════════════════════════════════════
# APPOINTMENT TOOLS
# ═══════════════════════════════════════════════════════════════════

APPT_COLLECTION = 'appointments'

def get_upcoming_appointments(days=7):
    """Get confirmed/rescheduled appointments in the next N days."""
    db = get_db()
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    future = (datetime.now(timezone.utc) + __import__('datetime').timedelta(days=days)).strftime('%Y-%m-%d')

    appts = []
    docs = (db.collection(APPT_COLLECTION)
            .where('status', 'in', ['confirmed', 'rescheduled'])
            .where('date', '>=', today)
            .where('date', '<=', future)
            .stream())
    for doc in docs:
        d = doc.to_dict()
        d['id'] = doc.id
        appts.append(d)

    appts.sort(key=lambda a: (a.get('date', ''), a.get('time', '')))
    return appts


def get_appointment(appt_id):
    """Get a single appointment by ID."""
    db = get_db()
    doc = db.collection(APPT_COLLECTION).document(appt_id).get()
    if doc.exists:
        d = doc.to_dict()
        d['id'] = doc.id
        return d
    return None


def find_appointment_by_client(name_or_email):
    """Find appointments by client name or email."""
    db = get_db()
    appts = []

    # Try email first
    if '@' in (name_or_email or ''):
        docs = (db.collection(APPT_COLLECTION)
                .where('client_email', '==', name_or_email.lower().strip())
                .order_by('date', direction=firestore.Query.DESCENDING)
                .limit(10)
                .stream())
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            appts.append(d)
    else:
        # Search by name — scan recent appointments
        docs = (db.collection(APPT_COLLECTION)
                .order_by('date', direction=firestore.Query.DESCENDING)
                .limit(100)
                .stream())
        search = (name_or_email or '').lower()
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            if search in (d.get('client_name', '') or '').lower():
                appts.append(d)
                if len(appts) >= 10:
                    break

    return appts


def update_appointment(appt_id, updates):
    """Update an appointment document."""
    db = get_db()
    updates['updated_at'] = datetime.now(timezone.utc)
    db.collection(APPT_COLLECTION).document(appt_id).update(updates)
    return True


def cancel_appointment(appt_id, reason=''):
    """Cancel an appointment."""
    return update_appointment(appt_id, {
        'status': 'cancelled',
        'cancelled_at': datetime.now(timezone.utc).isoformat(),
        'cancel_reason': reason or 'Cancelled by admin via AI agent'
    })


def reschedule_appointment(appt_id, new_date, new_time):
    """Reschedule an appointment to a new date/time."""
    db = get_db()
    doc = db.collection(APPT_COLLECTION).document(appt_id).get()
    if not doc.exists:
        return False
    old = doc.to_dict()
    return update_appointment(appt_id, {
        'date': new_date,
        'time': new_time,
        'status': 'rescheduled',
        'rescheduled_from': f"{old.get('date', '')} {old.get('time', '')}"
    })


def confirm_appointment_request(appt_id, slot_index=None):
    """Confirm a pending appointment request. Optionally pick a preferred slot."""
    db = get_db()
    doc = db.collection(APPT_COLLECTION).document(appt_id).get()
    if not doc.exists:
        return {'success': False, 'error': 'Not found'}
    appt = doc.to_dict()
    if appt.get('status') != 'pending_request':
        return {'success': False, 'error': f"Status is {appt.get('status')}, not pending_request"}

    confirmed_date = appt.get('date')
    confirmed_time = appt.get('time')
    if appt.get('preferred_slots') and slot_index is not None:
        slots = appt['preferred_slots']
        if 0 <= slot_index < len(slots):
            confirmed_date = slots[slot_index].get('date', confirmed_date)
            confirmed_time = slots[slot_index].get('time', confirmed_time)

    update_appointment(appt_id, {
        'status': 'confirmed',
        'date': confirmed_date,
        'time': confirmed_time,
        'confirmed_at': datetime.now(timezone.utc).isoformat()
    })
    return {'success': True, 'date': confirmed_date, 'time': confirmed_time}


def get_pending_requests():
    """Get all pending appointment requests awaiting approval."""
    db = get_db()
    appts = []
    docs = (db.collection(APPT_COLLECTION)
            .where('status', '==', 'pending_request')
            .stream())
    for doc in docs:
        d = doc.to_dict()
        d['id'] = doc.id
        appts.append(d)
    appts.sort(key=lambda a: (a.get('date', ''), a.get('time', '')))
    return appts


def get_todays_appointments():
    """Get all appointments for today."""
    db = get_db()
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    appts = []
    docs = (db.collection(APPT_COLLECTION)
            .where('date', '==', today)
            .where('status', 'in', ['confirmed', 'rescheduled'])
            .stream())
    for doc in docs:
        d = doc.to_dict()
        d['id'] = doc.id
        appts.append(d)
    appts.sort(key=lambda a: a.get('time', ''))
    return appts


def listen_new_appointments(callback):
    """Real-time listener for new appointments."""
    db = get_db()

    def on_snapshot(doc_snapshot, changes, read_time):
        for change in changes:
            if change.type.name == 'ADDED':
                d = change.document.to_dict()
                d['id'] = change.document.id
                callback(d)

    cutoff = datetime.now(timezone.utc).isoformat()
    # Listen for appointments created from now on
    query = db.collection(APPT_COLLECTION).where('status', 'in', ['confirmed', 'pending_request'])
    query.on_snapshot(on_snapshot)
