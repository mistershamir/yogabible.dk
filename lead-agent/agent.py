#!/usr/bin/env python3
"""
Yoga Bible — AI Lead Management Agent
Conversational interface + background drip scheduler + Firestore listener.

Run: python agent.py
"""

import os
import sys
import json
import logging
import asyncio
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

import anthropic
from apscheduler.schedulers.background import BackgroundScheduler

from tools.firestore import (
    get_new_leads, get_lead_by_email, get_lead_by_name,
    update_lead, add_lead_note, get_drip_status,
    pause_drip, resume_drip, listen_new_leads
)
from tools.email import send_email, build_drip_email
from tools.sms import send_sms
from scheduler import initialize_drip_for_lead, process_due_drips

# ── Logging ───────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('lead-agent.log')
    ]
)
logger = logging.getLogger('lead-agent')

# ── Anthropic client ──────────────────────────────────
client = anthropic.Anthropic()
MODEL = os.getenv('AGENT_MODEL', 'claude-sonnet-4-20250514')

# ── Tool definitions for Claude ───────────────────────
TOOLS = [
    {
        "name": "get_new_leads",
        "description": "Get new leads from the last N hours. Default 24 hours.",
        "input_schema": {
            "type": "object",
            "properties": {
                "since_hours": {"type": "number", "description": "Hours to look back. Default 24."}
            }
        }
    },
    {
        "name": "find_lead",
        "description": "Find a lead by email or name. Use email for exact match, or first_name + optional last_name.",
        "input_schema": {
            "type": "object",
            "properties": {
                "email": {"type": "string"},
                "first_name": {"type": "string"},
                "last_name": {"type": "string"}
            }
        }
    },
    {
        "name": "update_lead_status",
        "description": "Update a lead's status, sub_status, temperature, priority, or other fields.",
        "input_schema": {
            "type": "object",
            "properties": {
                "lead_id": {"type": "string", "description": "Firestore document ID"},
                "status": {"type": "string", "enum": ["New", "In Progress", "Contacted", "Converted", "Not Interested", "Deferred"]},
                "sub_status": {"type": "string"},
                "temperature": {"type": "string", "enum": ["Hot", "Warm", "Cold", ""]},
                "notes": {"type": "string", "description": "Note to add (timestamped)"}
            },
            "required": ["lead_id"]
        }
    },
    {
        "name": "pause_lead_emails",
        "description": "Pause the drip email sequence for a lead. Stops all automated follow-up emails.",
        "input_schema": {
            "type": "object",
            "properties": {
                "lead_id": {"type": "string"},
                "reason": {"type": "string", "description": "Why emails are being paused"}
            },
            "required": ["lead_id"]
        }
    },
    {
        "name": "resume_lead_emails",
        "description": "Resume a paused drip sequence. Optionally restart from a specific step (2-5).",
        "input_schema": {
            "type": "object",
            "properties": {
                "lead_id": {"type": "string"},
                "from_step": {"type": "number", "description": "Step to resume from (2-5). Omit to continue where paused."}
            },
            "required": ["lead_id"]
        }
    },
    {
        "name": "get_drip_info",
        "description": "Get the current drip sequence status for a lead.",
        "input_schema": {
            "type": "object",
            "properties": {
                "lead_id": {"type": "string"}
            },
            "required": ["lead_id"]
        }
    },
    {
        "name": "send_custom_email",
        "description": "Send a custom one-off email to a lead (not part of the drip sequence).",
        "input_schema": {
            "type": "object",
            "properties": {
                "to_email": {"type": "string"},
                "subject": {"type": "string"},
                "body_html": {"type": "string", "description": "HTML email body. Use the Yoga Bible style."},
                "log_lead_id": {"type": "string", "description": "Lead ID to log this email against"}
            },
            "required": ["to_email", "subject", "body_html"]
        }
    },
    {
        "name": "send_sms_message",
        "description": "Send an SMS to a lead's phone number.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to_phone": {"type": "string"},
                "message": {"type": "string", "description": "SMS text (max 160 chars recommended)"}
            },
            "required": ["to_phone", "message"]
        }
    }
]

# ── Tool execution ────────────────────────────────────
def execute_tool(name, input_data):
    """Execute a tool and return the result."""
    try:
        if name == 'get_new_leads':
            leads = get_new_leads(input_data.get('since_hours', 24))
            return {'leads': [summarize_lead(l) for l in leads], 'count': len(leads)}

        elif name == 'find_lead':
            if input_data.get('email'):
                lead = get_lead_by_email(input_data['email'])
                return {'lead': summarize_lead(lead) if lead else None, 'found': lead is not None}
            elif input_data.get('first_name'):
                leads = get_lead_by_name(input_data['first_name'], input_data.get('last_name'))
                return {'leads': [summarize_lead(l) for l in leads], 'count': len(leads)}
            return {'error': 'Provide email or first_name'}

        elif name == 'update_lead_status':
            lead_id = input_data['lead_id']
            updates = {}
            for field in ['status', 'sub_status', 'temperature']:
                if field in input_data:
                    updates[field] = input_data[field]
            if updates:
                update_lead(lead_id, updates)
            if input_data.get('notes'):
                add_lead_note(lead_id, input_data['notes'])
            return {'success': True, 'updated_fields': list(updates.keys())}

        elif name == 'pause_lead_emails':
            pause_drip(input_data['lead_id'], input_data.get('reason', ''))
            add_lead_note(input_data['lead_id'], f'Drip PAUSED by agent: {input_data.get("reason", "")}')
            return {'success': True, 'paused': True}

        elif name == 'resume_lead_emails':
            resume_drip(input_data['lead_id'], input_data.get('from_step'))
            add_lead_note(input_data['lead_id'], f'Drip RESUMED by agent (from step {input_data.get("from_step", "current")})')
            return {'success': True, 'resumed': True}

        elif name == 'get_drip_info':
            info = get_drip_status(input_data['lead_id'])
            return {'drip': info or 'No drip sequence found'}

        elif name == 'send_custom_email':
            result = send_email(input_data['to_email'], input_data['subject'], input_data['body_html'])
            if input_data.get('log_lead_id'):
                add_lead_note(input_data['log_lead_id'], f'Custom email sent: "{input_data["subject"]}"')
            return result

        elif name == 'send_sms_message':
            return send_sms(input_data['to_phone'], input_data['message'])

        return {'error': f'Unknown tool: {name}'}

    except Exception as e:
        logger.error(f'Tool {name} failed: {e}')
        return {'error': str(e)}


def summarize_lead(lead):
    """Create a concise lead summary for the AI context."""
    if not lead:
        return None
    return {
        'id': lead.get('id'),
        'name': f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip(),
        'email': lead.get('email'),
        'phone': lead.get('phone'),
        'program': lead.get('program'),
        'type': lead.get('type'),
        'status': lead.get('status'),
        'temperature': lead.get('temperature', ''),
        'source': lead.get('source'),
        'accommodation': lead.get('accommodation'),
        'created_at': str(lead.get('created_at', '')),
        'notes': (lead.get('notes', '') or '')[:500],  # Truncate long notes
        'converted': lead.get('converted', False),
        'unsubscribed': lead.get('unsubscribed', False),
    }


# ── Agent conversation loop ──────────────────────────
SYSTEM_PROMPT = """You are the lead management agent for Yoga Bible Denmark, a yoga teacher training school in Copenhagen.

Your job:
- Help the owner (Shamir) manage YTT leads
- Pause/resume/modify email drip sequences based on real conversations
- Provide lead status updates and insights
- Send custom emails or SMS when requested

Context:
- Leads come from the website's schedule request forms (200h, 300h programs)
- Each lead gets a 5-step drip email sequence (welcome → social proof → pricing → urgency → final nudge)
- The drip can be paused, resumed, or customized per-lead
- Pricing: 23,750 DKK total, 3,750 DKK Preparation Phase deposit
- Studio: Torvegade 66, Christianshavn, Copenhagen
- Programs: 4-week intensive, 8-week semi-intensive, 18-week flexible (all 200h RYT)

Communication style:
- Be concise and action-oriented
- Confirm actions taken
- In Danish when the lead is Danish, in English otherwise
- Always note what you did in the lead's Firestore record

When Shamir tells you about a conversation with a lead:
1. Find the lead in Firestore
2. Update their status and add notes about the conversation
3. Adjust the drip sequence (pause if not interested, skip steps if already had a meeting, etc.)
4. Confirm what you did
"""

conversation_history = []

def chat(user_message):
    """Send a message to Claude and handle tool use."""
    conversation_history.append({"role": "user", "content": user_message})

    while True:
        response = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=conversation_history,
        )

        # Add assistant response to history
        conversation_history.append({"role": "assistant", "content": response.content})

        # If no tool use, we're done
        if response.stop_reason == 'end_turn':
            # Extract text from response
            text_parts = [b.text for b in response.content if hasattr(b, 'text')]
            return '\n'.join(text_parts)

        # Handle tool use
        if response.stop_reason == 'tool_use':
            tool_results = []
            for block in response.content:
                if block.type == 'tool_use':
                    logger.info(f'Tool call: {block.name}({json.dumps(block.input)[:200]})')
                    result = execute_tool(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, default=str)
                    })
            conversation_history.append({"role": "user", "content": tool_results})
            # Continue the loop to get the next response


# ── New lead handler (Firestore listener) ─────────────
def on_new_lead(lead):
    """Called when a new lead appears in Firestore. Initializes their drip sequence."""
    if lead.get('type') == 'ytt':
        logger.info(f'New YTT lead: {lead.get("first_name")} {lead.get("last_name")} ({lead.get("email")})')
        initialize_drip_for_lead(lead['id'], lead)


# ── Main ──────────────────────────────────────────────
def main():
    print('\n' + '=' * 60)
    print('  YOGA BIBLE — AI Lead Management Agent')
    print('  Type your commands in natural language.')
    print('  Type "quit" or Ctrl+C to exit.')
    print('=' * 60 + '\n')

    # Start the drip scheduler
    scheduler = BackgroundScheduler()
    interval = int(os.getenv('DRIP_CHECK_INTERVAL_MINUTES', '60'))
    scheduler.add_job(process_due_drips, 'interval', minutes=interval,
                      id='drip_check', replace_existing=True)
    scheduler.start()
    logger.info(f'Drip scheduler started (checking every {interval} min)')

    # Start Firestore listener for new leads
    try:
        listen_new_leads(on_new_lead)
        logger.info('Firestore listener started for new leads')
    except Exception as e:
        logger.warning(f'Could not start Firestore listener: {e}')

    # Interactive chat loop
    while True:
        try:
            user_input = input('\n🧘 You: ').strip()
            if not user_input:
                continue
            if user_input.lower() in ('quit', 'exit', 'q'):
                print('\nShutting down...')
                scheduler.shutdown()
                break

            response = chat(user_input)
            print(f'\n🤖 Agent: {response}')

        except KeyboardInterrupt:
            print('\n\nShutting down...')
            scheduler.shutdown()
            break
        except Exception as e:
            logger.error(f'Error: {e}')
            print(f'\n❌ Error: {e}')


if __name__ == '__main__':
    main()
