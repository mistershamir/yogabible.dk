"""
Telegram bot helpers for the Meta Ads Agent.
Handles bot setup, message handlers, and notification helpers.
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

logger = logging.getLogger('ads-agent.telegram')

TELEGRAM_TOKEN = os.getenv('ADS_TELEGRAM_BOT_TOKEN', '')
OWNER_CHAT_ID = os.getenv('TELEGRAM_OWNER_CHAT_ID', '')


def get_owner_chat_id():
    return OWNER_CHAT_ID


def is_owner(chat_id):
    owner = get_owner_chat_id()
    if not owner:
        return True
    return str(chat_id) == str(owner)


async def send_notification(app, text, buttons=None):
    """Send a proactive notification to the owner."""
    chat_id = get_owner_chat_id()
    if not chat_id:
        logger.warning('No TELEGRAM_OWNER_CHAT_ID — skipping notification')
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


def build_handlers(chat_fn, on_callback_fn=None):
    """Build Telegram handler list."""
    handlers = []

    async def start_handler(update: Update, context):
        if not is_owner(update.effective_chat.id):
            return
        await update.message.reply_text(
            '📊 <b>Meta Ads Agent</b> is online.\n\n'
            'I manage your Meta ad campaigns for Yoga Bible and Hot Yoga CPH.\n\n'
            'Try:\n'
            '• "Show me all campaigns"\n'
            '• "How are the YB ads performing this week?"\n'
            '• "Pause the 18-week campaign"\n'
            '• "Set daily budget to 200 DKK for campaign X"\n'
            '• "Compare YB and HYC spend"\n',
            parse_mode=ParseMode.HTML
        )

    handlers.append(CommandHandler('start', start_handler))

    async def message_handler(update: Update, context):
        if not is_owner(update.effective_chat.id):
            return
        if not update.message or not update.message.text:
            return

        await context.bot.send_chat_action(chat_id=update.effective_chat.id, action=ChatAction.TYPING)

        # Run the chat function (blocking call to Claude)
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(None, chat_fn, update.message.text)

        # Split long messages (Telegram 4096 char limit)
        for i in range(0, len(response), 4000):
            chunk = response[i:i+4000]
            await update.message.reply_text(chunk, parse_mode=ParseMode.HTML)

    handlers.append(MessageHandler(filters.TEXT & ~filters.COMMAND, message_handler))

    if on_callback_fn:
        async def callback_handler(update: Update, context):
            query = update.callback_query
            if not is_owner(query.from_user.id):
                return
            await query.answer()

            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(None, on_callback_fn, query.data)

            if response:
                await query.message.reply_text(response, parse_mode=ParseMode.HTML)

        handlers.append(CallbackQueryHandler(callback_handler))

    return handlers
