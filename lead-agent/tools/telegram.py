"""
Telegram bot interface for the lead management agent.
Replaces the CLI loop — Shamir chats with the agent via Telegram.
Also sends proactive notifications (new leads, drip events, reminders).
"""

import os
import asyncio
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters
)
from telegram.constants import ParseMode, ChatAction

logger = logging.getLogger('lead-agent.telegram')

TELEGRAM_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
OWNER_CHAT_ID = os.getenv('TELEGRAM_OWNER_CHAT_ID', '')


def get_owner_chat_id():
    """Return the owner's chat ID (set after first /start or from env)."""
    return OWNER_CHAT_ID


def is_owner(chat_id):
    """Only respond to the owner's messages."""
    owner = get_owner_chat_id()
    if not owner:
        return True  # First message sets the owner
    return str(chat_id) == str(owner)


# ── Notification helpers (called from agent.py / scheduler.py) ──

async def send_notification(app, text, buttons=None):
    """Send a proactive notification to the owner."""
    chat_id = get_owner_chat_id()
    if not chat_id:
        logger.warning('No TELEGRAM_OWNER_CHAT_ID set — skipping notification')
        return

    reply_markup = None
    if buttons:
        keyboard = [[InlineKeyboardButton(b['text'], callback_data=b['data'])] for b in buttons]
        reply_markup = InlineKeyboardMarkup(keyboard)

    await app.bot.send_message(
        chat_id=chat_id,
        text=text,
        parse_mode=ParseMode.HTML,
        reply_markup=reply_markup,
    )


def format_new_lead_notification(lead):
    """Format a Telegram message for a new lead with enriched context."""
    name = f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip()
    email = lead.get('email', 'N/A')
    phone = lead.get('phone', 'N/A')
    lead_type = lead.get('type', 'ytt')
    program = lead.get('program', lead.get('ytt_program_type', 'N/A'))
    source = lead.get('source', 'N/A')
    accommodation = lead.get('accommodation', '')
    lead_id = lead.get('id', '')
    city = lead.get('city_country', '')
    cohort = lead.get('cohort_label', '')

    # Returning lead detection (set by on_new_lead in agent.py)
    returning = lead.get('_returning', False)

    # Header — distinguish returning vs new
    if returning:
        header = "🔄 <b>Returning Lead</b>"
        prev_status = lead.get('_previous_status', '')
        return_note = f"\n⚠️ Previously seen (was: {prev_status})" if prev_status else "\n⚠️ Previously seen in system"
    else:
        header = "🟢 <b>New Lead</b>"
        return_note = ""

    # Lead type badge
    type_badge = f"[{lead_type.upper()}]" if lead_type != 'ytt' else "[YTT]"

    msg = (
        f"{header} {type_badge}\n\n"
        f"<b>{name}</b>\n"
        f"📧 {email}\n"
    )

    # Phone prominently displayed for easy calling
    if phone and phone != 'N/A':
        msg += f"📱 <b>{phone}</b>\n"
    else:
        msg += f"📱 No phone provided\n"

    channel = lead.get('channel', '')
    msg += f"🎓 {program}\n"
    if channel:
        msg += f"📡 Channel: <b>{channel}</b>\n"
    msg += f"📍 Source: {source}\n"

    if cohort:
        msg += f"📅 Cohort: {cohort}\n"
    if city:
        msg += f"🌍 {city}\n"
    if accommodation:
        msg += f"🏠 Accommodation: {accommodation}\n"

    msg += return_note

    # Action summary based on lead type
    if lead_type == 'ytt':
        msg += "\n\n✅ Welcome email + schedule sent.\nDrip step 2 scheduled."
    else:
        msg += "\n\n📝 Lead registered (no drip — non-YTT type)."

    # Phone reminder
    if phone and phone != 'N/A':
        msg += "\n📞 <i>15-min call reminder set.</i>"

    buttons = [
        {'text': '⏸ Pause drip', 'data': f'pause:{lead_id}'},
        {'text': '📞 Call first', 'data': f'call:{lead_id}'},
        {'text': '👍 Looks good', 'data': f'ack:{lead_id}'},
    ]

    return msg, buttons


def format_drip_sent_notification(lead_id, lead, step, channel):
    """Format a notification for a sent drip email/SMS."""
    name = f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip()
    emoji = '📧' if channel == 'email' else '💬'
    return f"{emoji} Drip #{step} sent to <b>{name}</b>"


# ── Bot command handlers (set up in agent.py) ──

def build_handlers(chat_fn, on_callback_fn):
    """
    Build Telegram handler list.
    chat_fn(user_message: str) -> str  — the agent's chat() function
    on_callback_fn(action: str, lead_id: str) -> str  — handle button taps
    """

    async def start_handler(update: Update, context):
        global OWNER_CHAT_ID
        chat_id = str(update.effective_chat.id)
        if not OWNER_CHAT_ID:
            OWNER_CHAT_ID = chat_id
            logger.info(f'Owner chat ID set: {chat_id}')
        if not is_owner(update.effective_chat.id):
            await update.message.reply_text("⛔ Unauthorized.")
            return
        await update.message.reply_text(
            "🧘 <b>Yoga Bible Lead Agent</b>\n\n"
            "I'm your AI lead manager. Talk to me like a colleague:\n\n"
            "• \"Show me today's leads\"\n"
            "• \"Pause emails for Anna\"\n"
            "• \"I just spoke to Lars, he wants the 4-week\"\n"
            "• \"Send a custom email to maria@...\"\n\n"
            f"Your chat ID: <code>{chat_id}</code>",
            parse_mode=ParseMode.HTML,
        )

    async def message_handler(update: Update, context):
        if not is_owner(update.effective_chat.id):
            return
        user_text = update.message.text
        if not user_text:
            return

        # Run the blocking Claude API call in a thread so the event loop stays free.
        # Meanwhile, refresh the typing indicator every 4 seconds (it expires after 5).
        typing_active = True

        async def keep_typing():
            while typing_active:
                try:
                    await update.effective_chat.send_action(ChatAction.TYPING)
                except Exception:
                    pass
                await asyncio.sleep(4)

        typing_task = asyncio.create_task(keep_typing())

        try:
            # Run synchronous chat() in a thread — does NOT block the event loop
            response = await asyncio.to_thread(chat_fn, user_text)
            # Telegram messages have a 4096 char limit — split if needed
            for chunk in _split_message(response):
                await update.message.reply_text(chunk, parse_mode=ParseMode.HTML)
        except Exception as e:
            logger.error(f'Chat error: {e}')
            await update.message.reply_text(f"❌ Error: {e}")
        finally:
            typing_active = False
            typing_task.cancel()

    async def callback_handler(update: Update, context):
        query = update.callback_query
        if not is_owner(query.from_user.id):
            await query.answer("⛔ Unauthorized")
            return

        await query.answer()  # Acknowledge the button tap

        data = query.data  # e.g. "pause:abc123"
        parts = data.split(':', 1)
        action = parts[0]
        lead_id = parts[1] if len(parts) > 1 else ''

        try:
            # Run blocking Claude call in a thread
            response = await asyncio.to_thread(on_callback_fn, action, lead_id)
            await query.edit_message_reply_markup(reply_markup=None)
            await query.message.reply_text(response, parse_mode=ParseMode.HTML)
        except Exception as e:
            logger.error(f'Callback error: {e}')
            await query.message.reply_text(f"❌ Error: {e}")

    return [
        CommandHandler('start', start_handler),
        CallbackQueryHandler(callback_handler),
        MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler),
    ]


def _split_message(text, max_len=4000):
    """Split a long message into chunks that fit Telegram's limit."""
    if len(text) <= max_len:
        return [text]
    chunks = []
    while text:
        if len(text) <= max_len:
            chunks.append(text)
            break
        # Split at last newline before limit
        split_at = text.rfind('\n', 0, max_len)
        if split_at == -1:
            split_at = max_len
        chunks.append(text[:split_at])
        text = text[split_at:].lstrip('\n')
    return chunks
