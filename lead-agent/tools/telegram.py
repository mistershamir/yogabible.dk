"""
Telegram bot interface for the lead management agent.
Replaces the CLI loop — Shamir chats with the agent via Telegram.
Also sends proactive notifications (new leads, drip events, reminders).
"""

import os
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters
)
from telegram.constants import ParseMode

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
    """Format a Telegram message for a new lead."""
    name = f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip()
    email = lead.get('email', 'N/A')
    phone = lead.get('phone', 'N/A')
    program = lead.get('program', lead.get('ytt_program_type', 'N/A'))
    source = lead.get('source', 'N/A')
    accommodation = lead.get('accommodation', '')
    lead_id = lead.get('id', '')

    msg = (
        f"🟢 <b>New Lead</b>\n\n"
        f"<b>{name}</b>\n"
        f"📧 {email}\n"
        f"📱 {phone}\n"
        f"🎓 {program}\n"
        f"📍 {source}\n"
    )
    if accommodation:
        msg += f"🏠 Accommodation: {accommodation}\n"

    msg += "\n✅ Welcome email + schedule sent.\nDrip step 2 scheduled."

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

        # Show typing indicator while Claude thinks
        await update.effective_chat.send_action('typing')

        try:
            response = chat_fn(user_text)
            # Telegram messages have a 4096 char limit — split if needed
            for chunk in _split_message(response):
                await update.message.reply_text(chunk, parse_mode=ParseMode.HTML)
        except Exception as e:
            logger.error(f'Chat error: {e}')
            await update.message.reply_text(f"❌ Error: {e}")

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
            response = on_callback_fn(action, lead_id)
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
