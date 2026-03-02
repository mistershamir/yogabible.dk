"""
Dynamic knowledge loader for the lead management agent.
Reads key project files at startup and on git events to build
a comprehensive context that Claude uses as its system prompt.

Auto-updates by:
1. Reading key files on every startup
2. Checking git log for recent changes
3. Providing a refresh_knowledge() callable for runtime updates
"""

import os
import subprocess
import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger('lead-agent.knowledge')

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Key files the agent should know about (relative to project root)
KEY_FILES = {
    'lead-agent/tools/email.py': 'Drip email templates (5-step sequence)',
    'lead-agent/tools/sms.py': 'SMS templates and GatewayAPI integration',
    'lead-agent/scheduler.py': 'Drip schedule timing and processing logic',
    'netlify/functions/shared/config.js': 'Program types, pricing, schedule PDFs, payment URLs',
    'netlify/functions/shared/lead-emails.js': 'Welcome email templates (per program type)',
    'netlify/functions/shared/email-service.js': 'Email signature, reusable blocks, template system',
    'netlify/functions/lead.js': 'Lead capture API (form submissions)',
    'apps-script/06 emails.js': 'Legacy Apps Script email templates',
    'apps-script/01_Config.js': 'Apps Script config (schedule mappings, payment URLs)',
}

_cached_knowledge = None
_cache_hash = None


def _read_file(rel_path):
    """Read a project file and return its content."""
    full = PROJECT_ROOT / rel_path
    if full.exists():
        try:
            return full.read_text(encoding='utf-8')
        except Exception as e:
            logger.warning(f'Could not read {rel_path}: {e}')
    return None


def _git_recent_changes(days=7):
    """Get recent git commit messages and changed files."""
    try:
        result = subprocess.run(
            ['git', 'log', f'--since={days} days ago', '--oneline', '--name-only', '--no-merges'],
            capture_output=True, text=True, cwd=PROJECT_ROOT, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception as e:
        logger.warning(f'Could not read git log: {e}')
    return None


def _git_current_branch():
    """Get current git branch name."""
    try:
        result = subprocess.run(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
            capture_output=True, text=True, cwd=PROJECT_ROOT, timeout=5
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return 'unknown'


def _compute_hash():
    """Compute a hash of key files to detect changes."""
    h = hashlib.md5()
    for rel_path in KEY_FILES:
        content = _read_file(rel_path)
        if content:
            h.update(content.encode('utf-8'))
    return h.hexdigest()


def _extract_config_summary():
    """Read the live Netlify config.js and extract key data for the agent."""
    content = _read_file('netlify/functions/shared/config.js')
    if not content:
        return '(config.js not found — using defaults)'
    # Return the full config since it contains pricing, program types, schedule PDFs, etc.
    # Truncate if too large (keep first 5000 chars which covers all the important stuff)
    if len(content) > 5000:
        content = content[:5000] + '\n... (truncated)'
    return content


def _extract_email_templates_summary():
    """Read the live Netlify lead-emails.js and extract a summary of what each email says."""
    content = _read_file('netlify/functions/shared/lead-emails.js')
    if not content:
        return '(lead-emails.js not found)'
    # The file is large (~30KB). Include the key functions to give Claude visibility
    # into what the actual welcome emails say (subject lines, banners, pricing, messaging).
    # Truncate to keep the prompt reasonable but include enough to see all templates.
    if len(content) > 20000:
        content = content[:20000] + '\n... (truncated — remaining templates follow same pattern)'
    return content


def build_knowledge():
    """Build the complete knowledge context from project files.

    Dynamically reads the live Netlify source files so the agent always
    has up-to-date pricing, email content, program details, etc.
    """
    global _cached_knowledge, _cache_hash

    current_hash = _compute_hash()
    if _cached_knowledge and _cache_hash == current_hash:
        logger.info('Knowledge cache hit — no files changed')
        return _cached_knowledge

    logger.info('Building knowledge base from project files...')

    # Read live source files
    config_content = _extract_config_summary()
    email_content = _extract_email_templates_summary()

    knowledge = f"""You are the lead management agent for Yoga Bible Denmark (yogabible.dk), a Yoga Alliance certified yoga teacher training school in Copenhagen.

BUSINESS: Owner Shamir (Kursusdirektør). Studio: Torvegade 66, 1400 København K. Phone: +45 53 88 12 09. Email: info@yogabible.dk. Booking: yogabible.dk/?booking=1

YTT PROGRAMS (all Yoga Alliance RYT-200, 23750 DKK total, max 12 students):
- 4-week Intensive: full-time daily, April 2026
- 8-week Semi-Intensive: weekends, May-June 2026
- 18-week Flexible: Saturdays, March-June 2026 (ALREADY STARTED — leads can still join this week with 1000 kr last-minute discount)
- 300h Advanced: weekends, May-Dec 2026
- 50h Specialty / 30h Module: TBA
Preparation Phase ("Forberedelsesfasen"): 3750 DKK (NEVER say "deposit"/"depositum" to leads — say "Forberedelsesfasen"). Gives immediate studio access. Remaining 20000 DKK in installments before start.

COURSES: Inversions/Splits/Backbends — each 2300 DKK, 8 sessions. Bundle discounts available.

LEADS (Firestore "leads" collection): Fields: email, first_name, last_name, phone, type (ytt/course/mentorship/contact/meta), ytt_program_type (18-week/4-week/8-week/300h/50h/30h), status (New/In Progress/Contacted/Converted/Not Interested/Deferred), temperature (Hot/Warm/Cold), notes, accommodation, city_country, source, cohort_label.

DRIP SEQUENCE (5 steps over 10 days for YTT leads):
1. Day 0: Welcome+schedule (auto-sent by Netlify)
2. Day 2-3: Social proof (500+ graduates, alumni quote) + SMS
3. Day 5: Investment framing (Forberedelsesfasen 3750kr, studio access)
4. Day 7: Urgency (limited spots, info meeting CTA) + SMS
5. Day 10: Personal nudge (take your time, future cohorts, direct phone)

EMAILS: Use send_template_email tool for welcome/drip emails — it uses the exact Netlify templates with correct content, pricing, signature, English note. For custom emails use Yoga Bible HTML style (brand orange #f75c03, Danish, signature: "Kærlig hilsen, Shamir - Kursusdirektør, Yoga Bible (DK)"). NEVER invent generic emails — always use templates.

IMPORTANT — 18-WEEK PROGRAM STATUS: The 18-week program has ALREADY STARTED (March 2026). The welcome email includes a "last-minute" banner offering 1000 kr discount, telling leads the intro modules are recorded so they can catch up. The discounted price is 22,750 kr (normal 23,750). This is the CURRENT live email — do NOT tell 18w leads the program hasn't started yet.

SMS: GatewayAPI, sender +45 53 88 12 09, max 160 chars.

STYLE: Be concise (Telegram). Short paragraphs. Emoji sparingly: ✅ ⏸ 📧 📞 🟢. Danish for Danish leads, English otherwise. Log notes to Firestore after actions.

WORKFLOW when Shamir reports a conversation: 1) Find lead 2) Update status+notes 3) Adjust drip 4) Confirm.

════════════════════════════════════════════
LIVE REFERENCE: Netlify config.js (pricing, programs, PDFs, payment URLs)
════════════════════════════════════════════
{config_content}

════════════════════════════════════════════
LIVE REFERENCE: Netlify lead-emails.js (welcome email templates — the ACTUAL emails leads receive)
These are the emails that go out automatically. When Shamir asks you to send a welcome email or asks what a lead received, refer to THIS source.
════════════════════════════════════════════
{email_content}
"""

    _cached_knowledge = knowledge
    _cache_hash = current_hash
    logger.info(f'Knowledge base built ({len(knowledge)} chars, hash={current_hash[:8]})')
    return knowledge


def refresh_knowledge():
    """Force-refresh the knowledge cache (call after git pull/merge)."""
    global _cached_knowledge, _cache_hash
    _cached_knowledge = None
    _cache_hash = None
    return build_knowledge()


def read_project_file(rel_path):
    """Read a project file by relative path. For the agent's read_project_file tool."""
    content = _read_file(rel_path)
    if content is None:
        return {'error': f'File not found: {rel_path}'}
    # Truncate very large files
    if len(content) > 15000:
        return {
            'content': content[:15000],
            'truncated': True,
            'total_chars': len(content),
            'note': 'File truncated at 15000 chars. Ask for a specific section if you need more.'
        }
    return {'content': content, 'truncated': False}


def get_recent_changes(days=7):
    """Get recent git changes for the agent's tool."""
    changes = _git_recent_changes(days)
    if changes:
        return {'changes': changes[:5000], 'days': days}
    return {'changes': 'No recent changes found', 'days': days}


def check_refresh_flag():
    """Check if the git hooks flagged a knowledge refresh. Returns True if refreshed."""
    flag_file = Path(__file__).resolve().parent / '.knowledge-refresh-needed'
    if flag_file.exists():
        try:
            flag_file.unlink()
            logger.info('Git hook flagged knowledge refresh — rebuilding...')
            refresh_knowledge()
            return True
        except Exception as e:
            logger.warning(f'Could not process refresh flag: {e}')
    return False
