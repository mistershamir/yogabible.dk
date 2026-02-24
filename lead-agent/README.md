# Yoga Bible — AI Lead Management Agent

An AI-powered lead follow-up agent that runs on a dedicated Mac Mini.
Uses Claude (Anthropic API) with tool-use to manage YTT leads conversationally.

## What it does

- **Monitors** new leads in Firestore (real-time listener)
- **Sends** drip email/SMS sequences automatically (day 1, 3, 5, 7, 10)
- **Pauses/adjusts** sequences when you tell it to (natural language)
- **Accepts** commands like: "Stop emails for Anna, she said no because of timing"
- **Runs 24/7** as a macOS launchd daemon on your Mac Mini

## Quick Start

```bash
# 1. Install dependencies
cd lead-agent
pip install -r requirements.txt

# 2. Copy env template and fill in secrets
cp .env.example .env
# Edit .env with your API keys

# 3. Run interactively (for testing)
python agent.py

# 4. Install as daemon (runs on boot, auto-restarts)
./install-daemon.sh
```

## Architecture

```
agent.py          — Main entry: CLI chat + scheduler + Firestore listener
tools/
  firestore.py    — Read/write leads, log emails, check sequences
  email.py        — Send emails via Gmail SMTP (same as Netlify functions)
  sms.py          — Send SMS via GatewayAPI
scheduler.py      — APScheduler: checks leads every hour, sends due follow-ups
templates/        — Email HTML templates for drip sequence
```

## Commands (natural language)

Talk to it like a colleague:

- "Show me today's new leads"
- "Stop all emails for anna@example.com — she called and said she's not interested"
- "Anna changed her mind, restart her sequence from email 2"
- "I just spoke to Lars at the studio, he wants the 4-week program instead of 8-week"
- "Send a custom email to maria@example.com saying her schedule question was answered"
- "What leads haven't opened any emails in the last week?"
- "Pause everything for 3 days, I'm on vacation"

## Drip Sequence (default for YTT leads)

| Timing | Email | Focus |
|--------|-------|-------|
| Immediate | Welcome + schedule link | Excitement, interactive schedule |
| Day 2-3 | Social proof | Alumni stories, testimonials |
| Day 5 | Investment framing | Deposit-first pricing, installments |
| Day 7 | Urgency + booking | Limited spots, book info meeting |
| Day 10 | Final nudge | Last chance, personal note |

The AI can modify this per-lead based on your instructions.
