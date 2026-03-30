#!/usr/bin/env python3
"""
Meta Ads Management Agent — Yoga Bible + Hot Yoga CPH
Telegram bot with Claude tool-use for managing Meta ad campaigns.

Run:
  python agent.py              # Telegram bot mode (default)
  python agent.py --cli        # Terminal mode (testing)
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

from tools.meta_api import (
    get_ad_accounts, get_campaigns, get_campaign_insights,
    get_account_insights, get_adsets, get_ads,
    update_status, update_budget, update_schedule, duplicate_entity
)
from knowledge import build_knowledge

# ── Logging ───────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('ads-agent.log')
    ]
)
logger = logging.getLogger('ads-agent')

# ── Anthropic client ──────────────────────────────────
client = anthropic.Anthropic()
MODEL = os.getenv('AGENT_MODEL', 'claude-sonnet-4-6')

# ── Telegram app reference ────────────────────────────
_telegram_app = None
_telegram_app_loop = None

# ── Tool definitions for Claude ───────────────────────
TOOLS = [
    {
        "name": "get_ad_accounts",
        "description": "List all Meta ad accounts (Yoga Bible + HYC) with status and spend.",
        "input_schema": {"type": "object", "properties": {}}
    },
    {
        "name": "get_campaigns",
        "description": "List campaigns for a brand. Use brand='yoga-bible' or 'hyc'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "brand": {"type": "string", "description": "Brand: 'yoga-bible' or 'hyc'. Default: yoga-bible"},
                "limit": {"type": "number", "description": "Max campaigns to return (default 25)"}
            }
        }
    },
    {
        "name": "get_campaign_insights",
        "description": "Get performance data for a specific campaign (spend, clicks, CTR, leads, cost/lead).",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string", "description": "The campaign ID"},
                "days": {"type": "number", "description": "Date range in days: 1, 7, 14, 28, 30, 90 (default 7)"}
            },
            "required": ["campaign_id"]
        }
    },
    {
        "name": "get_account_insights",
        "description": "Get account-level performance summary (total spend, impressions, leads across all campaigns).",
        "input_schema": {
            "type": "object",
            "properties": {
                "brand": {"type": "string", "description": "Brand: 'yoga-bible' or 'hyc'"},
                "days": {"type": "number", "description": "Date range in days (default 7)"}
            }
        }
    },
    {
        "name": "get_adsets",
        "description": "List ad sets for a campaign or all ad sets for a brand.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string", "description": "Campaign ID (optional — if omitted, shows all for brand)"},
                "brand": {"type": "string", "description": "Brand (used when no campaign_id)"}
            }
        }
    },
    {
        "name": "get_ads",
        "description": "List individual ads for an ad set or all ads for a brand.",
        "input_schema": {
            "type": "object",
            "properties": {
                "adset_id": {"type": "string", "description": "Ad set ID (optional)"},
                "brand": {"type": "string", "description": "Brand (used when no adset_id)"}
            }
        }
    },
    {
        "name": "update_campaign_status",
        "description": "Pause, resume (activate), or archive a campaign, ad set, or ad. ALWAYS confirm with the user first.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "ID of the campaign/adset/ad"},
                "new_status": {"type": "string", "enum": ["ACTIVE", "PAUSED", "ARCHIVED"]}
            },
            "required": ["entity_id", "new_status"]
        }
    },
    {
        "name": "update_campaign_budget",
        "description": "Update daily or lifetime budget for a campaign or ad set. Amount in DKK. ALWAYS confirm first.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "ID of the campaign or ad set"},
                "daily_budget": {"type": "number", "description": "New daily budget in DKK"},
                "lifetime_budget": {"type": "number", "description": "New lifetime budget in DKK"}
            },
            "required": ["entity_id"]
        }
    },
    {
        "name": "update_adset_schedule",
        "description": "Update start or end time of an ad set. Use ISO 8601 format.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Ad set ID"},
                "start_time": {"type": "string", "description": "New start time (ISO 8601)"},
                "end_time": {"type": "string", "description": "New end time (ISO 8601)"}
            },
            "required": ["entity_id"]
        }
    },
    {
        "name": "duplicate_entity",
        "description": "Duplicate a campaign, ad set, or ad. The copy is created as PAUSED.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "ID to duplicate"}
            },
            "required": ["entity_id"]
        }
    },
]

# ── Conversation history ──────────────────────────────
conversation_history = []
MAX_HISTORY = 40


def execute_tool(name, input_data):
    """Execute a tool and return the result."""
    try:
        if name == 'get_ad_accounts':
            return get_ad_accounts()
        elif name == 'get_campaigns':
            return get_campaigns(input_data.get('brand'), input_data.get('limit', 25))
        elif name == 'get_campaign_insights':
            return get_campaign_insights(input_data['campaign_id'], input_data.get('days', 7))
        elif name == 'get_account_insights':
            return get_account_insights(input_data.get('brand'), input_data.get('days', 7))
        elif name == 'get_adsets':
            return get_adsets(input_data.get('campaign_id'), input_data.get('brand'))
        elif name == 'get_ads':
            return get_ads(input_data.get('adset_id'), input_data.get('brand'))
        elif name == 'update_campaign_status':
            return update_status(input_data['entity_id'], input_data['new_status'])
        elif name == 'update_campaign_budget':
            return update_budget(
                input_data['entity_id'],
                input_data.get('daily_budget'),
                input_data.get('lifetime_budget')
            )
        elif name == 'update_adset_schedule':
            return update_schedule(
                input_data['entity_id'],
                input_data.get('start_time'),
                input_data.get('end_time')
            )
        elif name == 'duplicate_entity':
            return duplicate_entity(input_data['entity_id'])
        else:
            return {'error': f'Unknown tool: {name}'}
    except Exception as e:
        logger.error(f'Tool {name} error: {e}')
        return {'error': str(e)}


def chat(user_message):
    """Process a user message through Claude with tool use."""
    global conversation_history

    conversation_history.append({"role": "user", "content": user_message})

    # Trim history if too long
    if len(conversation_history) > MAX_HISTORY:
        conversation_history = conversation_history[-MAX_HISTORY:]

    system_prompt = build_knowledge()

    try:
        # Run the agentic loop (tool use may require multiple turns)
        while True:
            response = client.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=system_prompt,
                tools=TOOLS,
                messages=conversation_history,
            )

            # Collect text blocks and tool use blocks
            text_parts = []
            tool_uses = []

            for block in response.content:
                if block.type == 'text':
                    text_parts.append(block.text)
                elif block.type == 'tool_use':
                    tool_uses.append(block)

            # If no tool use, we're done
            if not tool_uses:
                assistant_text = '\n'.join(text_parts) if text_parts else 'Done.'
                conversation_history.append({"role": "assistant", "content": response.content})
                return assistant_text

            # Execute tools and build tool results
            conversation_history.append({"role": "assistant", "content": response.content})

            tool_results = []
            for tool_use in tool_uses:
                logger.info(f'Tool call: {tool_use.name}({json.dumps(tool_use.input)[:200]})')
                result = execute_tool(tool_use.name, tool_use.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": json.dumps(result, default=str)
                })

            conversation_history.append({"role": "user", "content": tool_results})

            # If stop_reason is end_turn, break (shouldn't happen with tool_use but safety)
            if response.stop_reason == 'end_turn':
                return '\n'.join(text_parts) if text_parts else 'Done.'

    except Exception as e:
        logger.error(f'Chat error: {e}')
        return f'Error: {e}'


def handle_button(callback_data):
    """Handle inline button callbacks."""
    # Parse callback data like "pause:CAMPAIGN_ID" or "resume:CAMPAIGN_ID"
    parts = callback_data.split(':', 1)
    if len(parts) != 2:
        return None

    action, entity_id = parts
    if action == 'pause':
        result = update_status(entity_id, 'PAUSED')
        if result.get('success'):
            return f'⏸ Paused <code>{entity_id}</code>'
        return f'❌ Error: {result.get("error", "Unknown")}'
    elif action == 'resume':
        result = update_status(entity_id, 'ACTIVE')
        if result.get('success'):
            return f'▶️ Resumed <code>{entity_id}</code>'
        return f'❌ Error: {result.get("error", "Unknown")}'

    return None


# ═══════════════════════════════════════════════════════
# TELEGRAM MODE
# ═══════════════════════════════════════════════════════

def main_telegram():
    """Run as Telegram bot."""
    from telegram.ext import Application, CommandHandler
    from tools.telegram import build_handlers, TELEGRAM_TOKEN

    global _telegram_app, _telegram_app_loop

    if not TELEGRAM_TOKEN:
        logger.error('ADS_TELEGRAM_BOT_TOKEN not set — cannot start')
        sys.exit(1)

    logger.info('Starting Meta Ads Agent (Telegram mode)...')

    app = Application.builder().token(TELEGRAM_TOKEN).build()
    _telegram_app = app

    for handler in build_handlers(chat_fn=chat, on_callback_fn=handle_button):
        app.add_handler(handler)

    logger.info('Meta Ads Agent is running. Send /start in Telegram.')
    app.run_polling(drop_pending_updates=True)


# ═══════════════════════════════════════════════════════
# CLI MODE (for testing)
# ═══════════════════════════════════════════════════════

def main_cli():
    """Interactive terminal mode for testing."""
    print('Meta Ads Agent — CLI mode')
    print('Type your message or "quit" to exit.\n')

    while True:
        try:
            user_input = input('You: ').strip()
        except (EOFError, KeyboardInterrupt):
            print('\nBye.')
            break

        if not user_input or user_input.lower() in ('quit', 'exit', 'q'):
            break

        response = chat(user_input)
        print(f'\nAgent: {response}\n')


if __name__ == '__main__':
    if '--cli' in sys.argv:
        main_cli()
    else:
        main_telegram()
