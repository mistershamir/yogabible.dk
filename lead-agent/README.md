# Yoga Bible — AI Lead Management Agent

An AI-powered lead follow-up agent that runs on a dedicated Mac Mini.
Uses Claude (Anthropic API) with tool-use to manage YTT leads conversationally.
Talks to you via **Telegram** — manage leads from your phone.

## What it does

- **Monitors** new leads in Firestore (real-time listener)
- **Sends** drip email/SMS sequences automatically (day 1, 3, 5, 7, 10)
- **Notifies you on Telegram** when new leads arrive (with action buttons)
- **Pauses/adjusts** sequences when you tell it to (natural language)
- **Accepts** commands like: "Stop emails for Anna, she said no because of timing"
- **Runs 24/7** as a macOS launchd daemon on your Mac Mini

## Quick Start

### 1. Create your Telegram bot (2 minutes)

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`
3. Name: `Yoga Bible Lead Agent`
4. Username: `yogabible_lead_bot` (must be unique, add numbers if taken)
5. BotFather gives you a token like `7123456789:AAH...` — copy it

### 2. Get your chat ID

1. Start a chat with your new bot (send `/start`)
2. The bot will reply with your **chat ID** — copy it

Or get it manually: search for **@userinfobot** on Telegram, send `/start`, it shows your ID.

### 3. Install and configure

```bash
cd lead-agent
pip install -r requirements.txt

# Add to your .env file:
# TELEGRAM_BOT_TOKEN=7123456789:AAHxxxxx
# TELEGRAM_OWNER_CHAT_ID=123456789    (from step 2)
```

### 4. Run

```bash
# Telegram bot mode (default)
python agent.py

# CLI mode (for testing without Telegram)
python agent.py --cli

# Install as daemon (auto-start on boot)
./install-daemon.sh
```

## Architecture

```
agent.py              — Main entry: Telegram bot + scheduler + Firestore listener
tools/
  telegram.py         — Telegram bot handlers, notifications, inline buttons
  firestore.py        — Read/write leads, log emails, check sequences
  email.py            — Send emails via Gmail SMTP (same as Netlify functions)
  sms.py              — Send SMS via GatewayAPI
scheduler.py          — APScheduler: checks leads every hour, sends due follow-ups
```

## How it works

```
┌──────────────────────────────┐
│  📱 Telegram (@yogabible_lead_bot)  │
│  You chat here ←→ Agent replies     │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│  agent.py (Mac Mini daemon)  │
│  ├─ Claude AI (reasoning)    │
│  ├─ Firestore listener       │
│  └─ APScheduler (drips)      │
└──────────┬───────────────────┘
           │
    ┌──────┼──────────┐
    ▼      ▼          ▼
 Firestore  Gmail    GatewayAPI
 (leads)   (email)    (SMS)
```

## Telegram commands

Talk to it like a colleague:

- "Show me today's new leads"
- "Stop all emails for anna@example.com — she called and said she's not interested"
- "Anna changed her mind, restart her sequence from email 2"
- "I just spoke to Lars at the studio, he wants the 4-week program instead of 8-week"
- "Send a custom email to maria@example.com saying her schedule question was answered"
- "Pause everything for 3 days, I'm on vacation"

### Inline buttons

When a new lead arrives, you get a notification with buttons:

- **⏸ Pause drip** — Stop automated emails, handle manually
- **📞 Call first** — Pause drip + set a reminder to call
- **👍 Looks good** — Let the drip continue as planned

## Drip Sequence (default for YTT leads)

| Timing | Email | Focus |
|--------|-------|-------|
| Immediate | Welcome + schedule link | Excitement, interactive schedule |
| Day 2-3 | Social proof | Alumni stories, testimonials |
| Day 5 | Investment framing | Deposit-first pricing, installments |
| Day 7 | Urgency + booking | Limited spots, book info meeting |
| Day 10 | Final nudge | Last chance, personal note |

The AI can modify this per-lead based on your instructions.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_OWNER_CHAT_ID` | Yes | Your Telegram user ID |
| `GMAIL_USER` | Yes | Gmail address for sending |
| `GMAIL_APP_PASSWORD` | Yes | Gmail app password |
| `GATEWAYAPI_TOKEN` | Yes | GatewayAPI SMS token |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | Path to Firebase service account JSON |
| `AGENT_MODEL` | No | Claude model (default: claude-sonnet-4-20250514) |
| `DRIP_CHECK_INTERVAL_MINUTES` | No | How often to check drip queue (default: 60) |

## Future agents

This is agent #1. The same pattern works for more agents:

1. New Python file with its own tools and system prompt
2. New Telegram bot via @BotFather
3. Shared Firestore for cross-agent communication
4. Each agent = own chat on your phone
