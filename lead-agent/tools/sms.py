"""
SMS tools for the lead management agent.
Uses GatewayAPI EU — same provider as Netlify functions.
"""

import os
import json
import urllib.request
import urllib.parse
import base64
from dotenv import load_dotenv

load_dotenv()

GATEWAYAPI_TOKEN = os.getenv('GATEWAYAPI_TOKEN', '')
SENDER_PHONE = '+4553881209'


def normalize_phone(phone):
    """Normalize phone number to MSISDN format."""
    if not phone:
        return None
    phone = phone.strip().replace(' ', '').replace('-', '')
    if phone.startswith('+'):
        phone = phone[1:]
    if phone.startswith('00'):
        phone = phone[2:]
    # Assume Danish if no country code
    if len(phone) == 8:
        phone = '45' + phone
    return phone


def send_sms(to_phone, message):
    """Send an SMS via GatewayAPI."""
    if not GATEWAYAPI_TOKEN:
        return {'success': False, 'error': 'GATEWAYAPI_TOKEN not set'}

    phone = normalize_phone(to_phone)
    if not phone:
        return {'success': False, 'error': 'Invalid phone number'}

    payload = json.dumps({
        'sender': SENDER_PHONE,
        'message': message,
        'recipients': [{'msisdn': int(phone)}]
    }).encode('utf-8')

    req = urllib.request.Request(
        'https://gatewayapi.eu/rest/mtsms',
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + GATEWAYAPI_TOKEN
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req) as resp:
            return {'success': True, 'phone': phone}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def build_followup_sms(step, lead):
    """Build a follow-up SMS for a drip step."""
    first_name = lead.get('first_name', '')
    meeting_link = 'https://yogabible.dk/?booking=1'

    if step == 2:
        return f'Hej {first_name} — har du haft mulighed for at se dit skema? Tilføj datoerne til din kalender her: yogabible.dk/ytt-skema · Yoga Bible'
    elif step == 4:
        return f'Hej {first_name} — vi har stadig plads på holdet. Book et gratis infomøde (20 min): {meeting_link} · Yoga Bible'
    return None
