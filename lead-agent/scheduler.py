"""
Drip sequence scheduler.
Checks for leads due for follow-up and sends the next email in their sequence.
Runs as a background job in APScheduler.
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from tools.firestore import (
    get_db, get_leads_due_for_drip, set_drip_status,
    log_email_sent, add_lead_note
)
from tools.email import send_email, build_drip_email
from tools.sms import send_sms, build_followup_sms
from monitor import notify_error

logger = logging.getLogger('lead-agent.scheduler')


def _notify_telegram(lead_id, lead, step, channel):
    """Try to send a Telegram notification. Fails silently if not available."""
    try:
        from agent import notify_drip_sent
        notify_drip_sent(lead_id, lead, step, channel)
    except Exception:
        pass  # Telegram not available (e.g. CLI mode)

# Drip sequence timing: step -> days after lead creation
DRIP_SCHEDULE = {
    1: 0,    # Immediate (handled by Netlify function already — skip in drip)
    2: 2,    # Day 2-3: Social proof
    3: 5,    # Day 5: Investment framing
    4: 7,    # Day 7: Urgency
    5: 10,   # Day 10: Final nudge
}

SCHEDULE_LINKS = {
    '8-week': 'https://yogabible.dk/ytt-skema/?program=8w-may-jun-2026',
    '18-week': 'https://yogabible.dk/ytt-skema/?program=18w-mar-jun-2026',
    '4-week': 'https://yogabible.dk/ytt-skema/?program=4w-apr-2026',
}


def initialize_drip_for_lead(lead_id, lead_data):
    """DISABLED: All email sequences are now handled by the Netlify sequence engine.
    Agent drip was causing duplicate emails when both systems were active for the same lead.
    The agent continues to handle Telegram notifications and call reminders."""
    logger.info(f'Drip disabled — all email sequences handled by Netlify sequence engine (lead {lead_id})')
    return


def process_due_drips():
    """DISABLED: All drip processing is now handled by the Netlify sequence engine.
    Agent drip was causing duplicate emails when both systems were active for the same lead."""
    logger.info('Drip processing disabled — handled by Netlify sequence engine')
    return

    for drip in due:
        lead_id = drip['lead_id']
        lead = drip.get('lead', {})
        step = drip.get('current_step', 2)
        program_type = drip.get('program_type', '8-week')

        if step > 5:
            # Sequence complete
            set_drip_status(lead_id, {'completed': True})
            add_lead_note(lead_id, f'Drip sequence completed (5 emails sent)')
            continue

        # Migration guard: hand off to Netlify sequence engine if enrolled there
        try:
            existing_enrollment = db.collection('sequence_enrollments') \
                .where('lead_id', '==', lead_id) \
                .where('status', 'in', ['active', 'paused']) \
                .limit(1) \
                .get()

            if len(existing_enrollment.docs) > 0:
                set_drip_status(lead_id, {
                    'completed': True,
                    'pause_reason': 'Migrated to Netlify sequence engine'
                })
                add_lead_note(lead_id, 'Drip handed off to Netlify sequence engine')
                logger.info(f'Lead {lead_id} migrated to Netlify sequences — agent drip completed')
                continue
        except Exception as e:
            logger.warning(f'Migration check failed for {lead_id}: {e}')

        # Skip unsubscribed
        if lead.get('unsubscribed'):
            set_drip_status(lead_id, {'paused': True, 'pause_reason': 'unsubscribed'})
            continue

        # Skip converted
        if lead.get('converted'):
            set_drip_status(lead_id, {'completed': True})
            add_lead_note(lead_id, 'Drip stopped — lead converted')
            continue

        schedule_link = SCHEDULE_LINKS.get(program_type, 'https://yogabible.dk/ytt-skema/')

        try:
            # Build and send email
            subject, html, text = build_drip_email(step, lead, schedule_link)
            if subject:
                send_email(lead['email'], subject, html, text)
                log_email_sent(lead_id, lead['email'], subject, step)
                add_lead_note(lead_id, f'Drip email #{step} sent: "{subject}"')
                logger.info(f'Sent drip #{step} to {lead["email"]}')
                _notify_telegram(lead_id, lead, step, 'email')

            # Send SMS on steps 2 and 4
            if step in (2, 4) and lead.get('phone'):
                sms_text = build_followup_sms(step, lead)
                if sms_text:
                    send_sms(lead['phone'], sms_text)
                    add_lead_note(lead_id, f'Drip SMS #{step} sent')
                    _notify_telegram(lead_id, lead, step, 'sms')

            # Advance to next step
            next_step = step + 1
            if next_step <= 5:
                days_until = DRIP_SCHEDULE[next_step] - DRIP_SCHEDULE[step]
                next_send = datetime.now(timezone.utc) + timedelta(days=days_until)
                set_drip_status(lead_id, {
                    'current_step': next_step,
                    'next_send_at': next_send,
                    'last_sent_step': step,
                    'last_sent_at': datetime.now(timezone.utc),
                })
            else:
                set_drip_status(lead_id, {
                    'completed': True,
                    'last_sent_step': step,
                    'last_sent_at': datetime.now(timezone.utc),
                })

        except Exception as e:
            logger.error(f'Error sending drip #{step} to {lead_id}: {e}')
            add_lead_note(lead_id, f'Drip email #{step} FAILED: {str(e)}')
            notify_error('drip_fail', f'Drip #{step} for {lead.get("email", lead_id)}: {e}')
