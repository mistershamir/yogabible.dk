#!/usr/bin/env python3
"""
Yoga Bible — AI Lead Management Agent
Telegram interface + background drip scheduler + Firestore listener.

Run:
  python agent.py              # Telegram bot mode (default)
  python agent.py --cli        # Old-school terminal mode (for testing)
  python agent.py --daemon     # Telegram bot mode (launchd compatible)
"""

import os
import sys
import json
import logging
import asyncio
import time
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
from tools.email import (
    send_email, build_drip_email, build_welcome_email,
    send_welcome_email, send_drip_step, build_welcome_sms, SCHEDULE_LINKS
)
from tools.sms import send_sms
from scheduler import initialize_drip_for_lead, process_due_drips
from knowledge import build_knowledge, refresh_knowledge, check_refresh_flag
from monitor import notify_startup, notify_shutdown, notify_error, heartbeat

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
        "description": "Get new leads from the last N hours (default 24).",
        "input_schema": {
            "type": "object",
            "properties": {
                "since_hours": {"type": "number"}
            }
        }
    },
    {
        "name": "find_lead",
        "description": "Find a lead by email or name.",
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
        "description": "Update lead status, temperature, or add notes.",
        "input_schema": {
            "type": "object",
            "properties": {
                "lead_id": {"type": "string"},
                "status": {"type": "string", "enum": ["New", "In Progress", "Contacted", "Converted", "Not Interested", "Deferred"]},
                "sub_status": {"type": "string"},
                "temperature": {"type": "string", "enum": ["Hot", "Warm", "Cold", ""]},
                "notes": {"type": "string"}
            },
            "required": ["lead_id"]
        }
    },
    {
        "name": "pause_lead_emails",
        "description": "Pause drip sequence for a lead.",
        "input_schema": {
            "type": "object",
            "properties": {
                "lead_id": {"type": "string"},
                "reason": {"type": "string"}
            },
            "required": ["lead_id"]
        }
    },
    {
        "name": "resume_lead_emails",
        "description": "Resume paused drip. Optionally set from_step (2-5).",
        "input_schema": {
            "type": "object",
            "properties": {
                "lead_id": {"type": "string"},
                "from_step": {"type": "number"}
            },
            "required": ["lead_id"]
        }
    },
    {
        "name": "get_drip_info",
        "description": "Get drip sequence status for a lead.",
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
        "description": "Send a one-off email. Use Yoga Bible HTML style (orange #f75c03, Danish, signature).",
        "input_schema": {
            "type": "object",
            "properties": {
                "to_email": {"type": "string"},
                "subject": {"type": "string"},
                "body_html": {"type": "string"},
                "log_lead_id": {"type": "string"}
            },
            "required": ["to_email", "subject", "body_html"]
        }
    },
    {
        "name": "send_template_email",
        "description": "Send welcome or drip email using existing templates with correct content, pricing, signature.",
        "input_schema": {
            "type": "object",
            "properties": {
                "template_type": {"type": "string", "enum": ["welcome", "drip"]},
                "lead_id": {"type": "string"},
                "lead_email": {"type": "string"},
                "lead_data": {
                    "type": "object",
                    "properties": {
                        "first_name": {"type": "string"},
                        "email": {"type": "string"},
                        "ytt_program_type": {"type": "string"},
                        "type": {"type": "string"},
                        "accommodation": {"type": "string"},
                        "program": {"type": "string"}
                    }
                },
                "program_type": {"type": "string"},
                "drip_step": {"type": "number"}
            },
            "required": ["template_type"]
        }
    },
    {
        "name": "send_sms_message",
        "description": "Send SMS via GatewayAPI (max 160 chars).",
        "input_schema": {
            "type": "object",
            "properties": {
                "to_phone": {"type": "string"},
                "message": {"type": "string"}
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

        elif name == 'send_template_email':
            return _handle_template_email(input_data)

        elif name == 'send_sms_message':
            return send_sms(input_data['to_phone'], input_data['message'])

        return {'error': f'Unknown tool: {name}'}

    except Exception as e:
        logger.error(f'Tool {name} failed: {e}')
        # Alert on email/SMS failures
        if name in ('send_custom_email', 'send_template_email'):
            notify_error('email_fail', f'{name}: {e}')
        elif name == 'send_sms_message':
            notify_error('sms_fail', f'{name}: {e}')
        return {'error': str(e)}


def _handle_template_email(input_data):
    """Handle the send_template_email tool — build from templates and send."""
    template_type = input_data['template_type']

    # Resolve lead data: from lead_id lookup, lead_data override, or minimal data
    lead_data = input_data.get('lead_data', {})
    lead_id = input_data.get('lead_id')

    if lead_id and not lead_data.get('email'):
        # Look up lead from Firestore
        from tools.firestore import get_lead_by_email
        from google.cloud import firestore
        db = firestore.Client()
        doc = db.collection('leads').document(lead_id).get()
        if doc.exists:
            lead_data = {**doc.to_dict(), **lead_data, 'id': lead_id}
        else:
            return {'error': f'Lead {lead_id} not found in Firestore'}

    # If only lead_email provided, use it
    if input_data.get('lead_email') and not lead_data.get('email'):
        lead_data['email'] = input_data['lead_email']

    if not lead_data.get('email'):
        return {'error': 'No email address available — provide lead_id, lead_email, or lead_data.email'}

    if template_type == 'welcome':
        program_type = input_data.get('program_type') or lead_data.get('ytt_program_type', '8-week')
        subject, html, text = build_welcome_email(lead_data, program_type)
        result = send_email(lead_data['email'], subject, html, text)
        if lead_id:
            add_lead_note(lead_id, f'Welcome email sent via template ({program_type}): "{subject}"')

        # Also send welcome SMS if phone is available (mirrors Netlify lead.js flow)
        sms_result = None
        phone = lead_data.get('phone', '')
        if phone:
            sms_message = build_welcome_sms(lead_data)
            sms_result = send_sms(phone, sms_message)
            if lead_id:
                add_lead_note(lead_id, f'Welcome SMS sent: "{sms_message[:30]}..."')

        return {**result, 'template': 'welcome', 'program_type': program_type, 'sms_sent': sms_result is not None and sms_result.get('success', False)}

    elif template_type == 'drip':
        step = input_data.get('drip_step', 2)
        program_type = lead_data.get('ytt_program_type', '8-week')
        schedule_link = SCHEDULE_LINKS.get(program_type, 'https://yogabible.dk/ytt-skema/')
        subject, html, text = build_drip_email(step, lead_data, schedule_link)
        if not subject:
            return {'error': f'Invalid drip step: {step}'}
        result = send_email(lead_data['email'], subject, html, text)
        if lead_id:
            add_lead_note(lead_id, f'Drip step {step} sent manually via template: "{subject}"')
        return {**result, 'template': 'drip', 'step': step}

    return {'error': f'Unknown template type: {template_type}'}


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
        'ytt_program_type': lead.get('ytt_program_type'),
        'type': lead.get('type'),
        'status': lead.get('status'),
        'temperature': lead.get('temperature', ''),
        'source': lead.get('source'),
        'accommodation': lead.get('accommodation'),
        'city_country': lead.get('city_country'),
        'cohort_label': lead.get('cohort_label'),
        'created_at': str(lead.get('created_at', '')),
        'notes': (lead.get('notes', '') or '')[:500],  # Truncate long notes
        'converted': lead.get('converted', False),
        'unsubscribed': lead.get('unsubscribed', False),
    }


# ── Agent conversation loop ──────────────────────────
# Build the system prompt dynamically from project knowledge
SYSTEM_PROMPT = build_knowledge()
logger.info(f'System prompt loaded ({len(SYSTEM_PROMPT)} chars)')

conversation_history = []

MAX_RETRIES = 4
RETRY_BACKOFF = [2, 4, 8, 16]  # seconds

def _call_api_with_retry(messages):
    """Call Anthropic API with retry + exponential backoff for rate limits."""
    for attempt in range(MAX_RETRIES + 1):
        try:
            return client.messages.create(
                model=MODEL,
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=messages,
            )
        except anthropic.RateLimitError as e:
            if attempt < MAX_RETRIES:
                wait = RETRY_BACKOFF[attempt]
                logger.warning(f'Rate limited (attempt {attempt + 1}/{MAX_RETRIES + 1}), retrying in {wait}s...')
                time.sleep(wait)
            else:
                logger.error(f'Rate limit exceeded after {MAX_RETRIES + 1} attempts')
                raise
        except anthropic.APIError as e:
            if attempt < MAX_RETRIES and getattr(e, 'status_code', 0) >= 500:
                wait = RETRY_BACKOFF[attempt]
                logger.warning(f'API error {e.status_code} (attempt {attempt + 1}), retrying in {wait}s...')
                time.sleep(wait)
            else:
                raise


def chat(user_message):
    """Send a message to Claude and handle tool use."""
    global SYSTEM_PROMPT
    conversation_history.append({"role": "user", "content": user_message})

    # Keep conversation history manageable (last 20 messages to save tokens)
    if len(conversation_history) > 20:
        conversation_history[:] = conversation_history[-20:]

    while True:
        try:
            response = _call_api_with_retry(conversation_history)
        except Exception as e:
            logger.error(f'API call failed: {e}')
            # Remove the user message we just added so history stays clean
            conversation_history.pop()
            return f'Sorry, I hit an API error: {e}'

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


# ── Button callback handler ──────────────────────────
def handle_button(action, lead_id):
    """Handle inline keyboard button taps from Telegram."""
    if action == 'pause':
        return chat(f"Pause the drip sequence for lead {lead_id} — I want to handle this one manually.")
    elif action == 'call':
        return chat(f"Pause drip for lead {lead_id} — I'll call them first. Remind me tomorrow at 10:00 if I haven't updated.")
    elif action == 'ack':
        return chat(f"Lead {lead_id} looks good, let the drip continue as planned. Just acknowledge.")
    else:
        return f"Unknown action: {action}"


# ── New lead handler (Firestore listener) ─────────────
# Will be set by the Telegram bot startup to enable async notifications
_telegram_app = None

def on_new_lead(lead):
    """Called when a new lead appears in Firestore. Initializes drip + notifies Telegram."""
    if lead.get('type') == 'ytt':
        logger.info(f'New YTT lead: {lead.get("first_name")} {lead.get("last_name")} ({lead.get("email")})')
        initialize_drip_for_lead(lead['id'], lead)

        # Send Telegram notification
        if _telegram_app:
            from tools.telegram import format_new_lead_notification, send_notification
            msg, buttons = format_new_lead_notification(lead)
            asyncio.run_coroutine_threadsafe(
                send_notification(_telegram_app, msg, buttons),
                _telegram_app_loop
            )

_telegram_app_loop = None


# ── Drip notification hook ────────────────────────────
def notify_drip_sent(lead_id, lead, step, channel='email'):
    """Send a Telegram notification when a drip email/SMS is sent."""
    if _telegram_app:
        from tools.telegram import format_drip_sent_notification, send_notification
        msg = format_drip_sent_notification(lead_id, lead, step, channel)
        asyncio.run_coroutine_threadsafe(
            send_notification(_telegram_app, msg),
            _telegram_app_loop
        )


# ── Knowledge refresh command ─────────────────────────
def reload_knowledge():
    """Refresh the system prompt from project files (call after git pull/push)."""
    global SYSTEM_PROMPT
    SYSTEM_PROMPT = refresh_knowledge()
    logger.info(f'Knowledge reloaded ({len(SYSTEM_PROMPT)} chars)')
    return SYSTEM_PROMPT


# ── Main: Telegram mode ─────────────────────────────
def main_telegram():
    """Run the agent as a Telegram bot."""
    from telegram.ext import Application, CommandHandler
    from tools.telegram import build_handlers, TELEGRAM_TOKEN

    global _telegram_app, _telegram_app_loop

    if not TELEGRAM_TOKEN:
        logger.error('TELEGRAM_BOT_TOKEN not set in .env — cannot start Telegram bot')
        sys.exit(1)

    logger.info('Starting Yoga Bible Lead Agent (Telegram mode)...')

    # Notify via Telegram that agent has (re)started
    notify_startup()

    # Build the Telegram application
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    _telegram_app = app

    # Register handlers (chat + callbacks + /reload command)
    for handler in build_handlers(chat_fn=chat, on_callback_fn=handle_button):
        app.add_handler(handler)

    # Add /reload command for manual knowledge refresh
    async def reload_handler(update, context):
        from tools.telegram import is_owner
        if not is_owner(update.effective_chat.id):
            return
        reload_knowledge()
        await update.message.reply_text('✅ Knowledge base reloaded from project files.')

    app.add_handler(CommandHandler('reload', reload_handler))

    # Start the drip scheduler + knowledge refresh checker
    scheduler = BackgroundScheduler()
    interval = int(os.getenv('DRIP_CHECK_INTERVAL_MINUTES', '60'))
    scheduler.add_job(process_due_drips, 'interval', minutes=interval,
                      id='drip_check', replace_existing=True)

    # Check for knowledge refresh flag every 5 minutes (set by git hooks)
    def _check_and_reload():
        if check_refresh_flag():
            reload_knowledge()
            logger.info('Knowledge auto-refreshed via git hook flag')

    scheduler.add_job(_check_and_reload, 'interval', minutes=5,
                      id='knowledge_refresh', replace_existing=True)

    # Daily heartbeat — proof of life + error summary
    scheduler.add_job(heartbeat, 'interval', hours=24,
                      id='heartbeat', replace_existing=True)

    scheduler.start()
    logger.info(f'Drip scheduler started (checking every {interval} min)')
    logger.info('Knowledge refresh checker started (checking every 5 min)')
    logger.info('Daily heartbeat scheduled')

    # Start Firestore listener for new leads
    try:
        listen_new_leads(on_new_lead)
        logger.info('Firestore listener started for new leads')
    except Exception as e:
        logger.warning(f'Could not start Firestore listener: {e}')

    # Run the bot (blocks until stopped)
    logger.info('Telegram bot is running — send /start to your bot')
    app.run_polling(drop_pending_updates=True)

    # Cleanup
    scheduler.shutdown()
    notify_shutdown()


# ── Main: CLI mode (for testing) ──────────────────────
def main_cli():
    """Run the agent in terminal mode (original behavior)."""
    print('\n' + '=' * 60)
    print('  YOGA BIBLE — AI Lead Management Agent (CLI mode)')
    print('  Type your commands in natural language.')
    print('  Type "quit" or Ctrl+C to exit.')
    print('  Type "reload" to refresh knowledge from project files.')
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
            if user_input.lower() == 'reload':
                reload_knowledge()
                print('✅ Knowledge base reloaded.')
                continue

            response = chat(user_input)
            print(f'\n🤖 Agent: {response}')

        except KeyboardInterrupt:
            print('\n\nShutting down...')
            scheduler.shutdown()
            break
        except Exception as e:
            logger.error(f'Error: {e}')
            print(f'\n❌ Error: {e}')


# ── Entry point ──────────────────────────────────────
def main():
    if '--cli' in sys.argv:
        main_cli()
    else:
        # Default: Telegram mode (also used by --daemon)
        main_telegram()


if __name__ == '__main__':
    main()
