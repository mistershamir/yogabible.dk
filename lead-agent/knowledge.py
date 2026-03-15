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
# NOTE: These are only used for cache invalidation (hash check), NOT loaded into the prompt.
# The system prompt uses curated summaries instead of raw file content.
KEY_FILES = {
    'lead-agent/tools/email.py': 'Drip email templates (5-step sequence)',
    'lead-agent/tools/sms.py': 'SMS templates and GatewayAPI integration',
    'lead-agent/scheduler.py': 'Drip schedule timing and processing logic',
    'netlify/functions/shared/config.js': 'Program types, pricing, schedule PDFs, payment URLs',
    'netlify/functions/shared/lead-emails.js': 'Welcome email templates (per program type)',
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
    """Return a concise summary of config.js — not the raw file."""
    return """Schedule PDFs (Cloudinary):
- 18-week Mar-Jun 2026: https://res.cloudinary.com/ddcynsa30/image/upload/v1771280099/18w-mar-jun-2026.pdf_izgiuz
- 4-week Apr 2026: https://res.cloudinary.com/ddcynsa30/image/upload/v1771280041/4w-apr-2026.pdf_x9iwdf
- 8-week May-Jun 2026: https://res.cloudinary.com/ddcynsa30/image/upload/v1771280072/8w-may-jun-2026.pdf_k7i62j
- 300h: TBA

Payment URLs (MindBody):
- 18-week: prodid=10112 | 4-week: prodid=10113

Courses: Inversions/Splits/Backbends — 2300 DKK each, 8 sessions.
Booking link: https://yogabible.dk/?booking=1
Application form: https://www.yogabible.dk/apply"""


def _extract_email_templates_summary():
    """Return a concise summary of email templates — not the raw 48KB file."""
    return """Welcome emails (auto-sent by Netlify on form submit):
- Subject: "Dit [program] skema er klar — Yoga Bible" (or "Dine skemaer er klar" for multi)
- Content: Greeting, program highlights (200h YA-certified, Hatha/Vinyasa/Yin/Hot/Meditation, anatomy/philosophy/sequencing), schedule PDF link, pricing (23750 DKK total, Forberedelsesfasen 3750 DKK), accommodation section if needed, booking CTA, question prompt, English note, signature
- 18-week special: "LAST-MINUTE" banner with 1000 kr discount (22750 DKK), recorded intro modules, immediate start possible
- Signature: "Kærlig hilsen, Shamir — Kursusdirektør, Yoga Bible (DK)"

The agent has its own send_template_email tool that generates correct emails using tools/email.py — no need to reconstruct from lead-emails.js."""


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
Preparation Phase ("Forberedelsesfasen"): 3750 DKK (NEVER say "deposit"/"depositum" to leads — say "Forberedelsesfasen"). Gives immediate studio access. Remaining 20000 DKK in flexible instalments at the student's comfort — before training starts.

COURSES: Inversions/Splits/Backbends — each 2300 DKK, 8 sessions. Bundle discounts available.

LEADS (Firestore "leads" collection): Fields: email, first_name, last_name, phone, type (ytt/course/mentorship/contact/meta), ytt_program_type (18-week/4-week/8-week/300h/50h/30h), status (New/In Progress/Contacted/Converted/Not Interested/Deferred), temperature (Hot/Warm/Cold), notes, accommodation, city_country, source, cohort_label, channel (Google Ads/Meta Ads/Google Organic/AI Referral (ChatGPT)/Social (Facebook)/Direct/Email/SMS/Referral), utm_source, utm_medium, utm_campaign, gclid, fbclid, referrer, landing_page.

DRIP SEQUENCE (5 steps over 10 days for YTT leads):
1. Day 0: Welcome+schedule (auto-sent by Netlify)
2. Day 2-3: Social proof (500+ graduates, alumni quote) + SMS
3. Day 5: Investment framing (Forberedelsesfasen 3750kr, studio access)
4. Day 7: Urgency (limited spots, info meeting CTA) + SMS
5. Day 10: Personal nudge (take your time, future cohorts, direct phone)

EMAILS: Use send_template_email tool for welcome/drip emails — it uses the exact Netlify templates with correct content, pricing, signature, English note. For custom emails use Yoga Bible HTML style (brand orange #f75c03, Danish, signature: "Kærlig hilsen, Shamir - Kursusdirektør, Yoga Bible (DK)"). NEVER invent generic emails — always use templates.

IMPORTANT — 18-WEEK PROGRAM STATUS: The 18-week program has ALREADY STARTED (March 2026). The welcome email includes a "last-minute" banner offering 1000 kr discount, telling leads the intro modules are recorded so they can catch up. The discounted price is 22,750 kr (normal 23,750). This is the CURRENT live email — do NOT tell 18w leads the program hasn't started yet.

SMS: GatewayAPI, sender +45 53 88 12 09, max 160 chars.

APPOINTMENTS (Firestore "appointments" collection): Types: info-session (30min), consultation (30min), intro-class (60min, request-based), photo-session (60min, request-based). Statuses: confirmed, rescheduled, cancelled, pending_request, awaiting_client. Fields: date, time, duration, client_name, client_email, client_phone, type, type_name_da, type_name_en, location (studio/online), status, message, preferred_slots (photo sessions — 3 suggested times).

APPOINTMENT MANAGEMENT: You can view upcoming appointments, today's schedule, pending requests. You can cancel, reschedule, approve requests, and SMS clients directly. When Shamir asks about appointments, use the appointment tools. For photo sessions with multiple suggested slots, show all options and ask which to confirm. Client SMS sends go through GatewayAPI same as lead SMS.

APPOINTMENT REMINDERS: The system sends a Telegram briefing at 18:00 (evening before) listing tomorrow's appointments. The morning briefing at 9:00 also includes today's appointments and pending requests. New bookings trigger instant Telegram notifications.

STYLE: Be VERY concise — this is Telegram, not email. Max 2-3 short sentences per response. No long explanations or reflections. Just confirm what you did and move on. Emoji sparingly: ✅ ⏸ 📧 📞 🟢 📅 🔔. Danish for Danish leads, English otherwise. Log notes to Firestore after actions. IMPORTANT: After sending an email or SMS, your summary should be SHORT (e.g. "Done — emailed Anna, status updated to Contacted."). The system already sends an instant delivery notification separately.

WORKFLOW when Shamir reports a conversation: 1) Find lead 2) Update status+notes 3) Adjust drip 4) Confirm.
WORKFLOW for appointment management: When asked about schedule/appointments, use get_upcoming_appointments or get_todays_appointments. When asked to cancel/move an appointment, find it first, confirm details, then execute. For pending requests, show the details and ask for approval.

REFERENCE: Config (schedule PDFs, payment URLs)
{config_content}

REFERENCE: Email templates (what leads actually receive)
{email_content}
"""

    # Append nurture system context
    knowledge += """

--- NURTURE SEQUENCE SYSTEM ---

## Active Sequences
- YTT Onboarding (auto-enrolled on new YTT lead): 5 steps over 14 days — welcome (sent by Netlify) → why become a teacher → SMS check-in → what happens in training → format self-selection + Prep Phase
- April 4W Intensive Conversion: 2 steps — urgency + last chance (manual enrollment)
- July Vinyasa Plus International: 4 steps — Copenhagen lifestyle → Vinyasa Plus explainer → accommodation logistics → urgency (manual enrollment)
- 8W Semi-Intensive DK: 3 steps — same cert half time → SMS nudge → Prep Phase (manual enrollment)
- 18W Flexible Aug-Dec: 3 steps — sold out social proof → how it works → Prep Phase (manual enrollment)

## System Architecture
- All automated sends go through the Netlify sequence engine (sequences.js)
- Campaigns (one-off broadcasts) go through the campaign wizard in the admin panel
- The agent monitors for gaps and failures but does NOT send drip emails directly
- The agent drafts personalized follow-ups for leads who completed sequences without converting
- Frequency throttling: leads won't receive sequence emails within 48h of another email

## Agent Monitoring Role
- Every 2h: check for leads not in any sequence → alert Shamir via Telegram
- Every 4h: check for sequence send failures → alert Shamir
- Daily 10am: review leads who completed sequences without converting → draft personalized follow-up
"""

    # Append dynamic knowledge from Firestore (editable via admin panel)
    firestore_knowledge = _fetch_firestore_knowledge('yoga-bible')
    if firestore_knowledge:
        knowledge += f'\n\n--- ADMIN-MANAGED KNOWLEDGE (editable via admin panel) ---\n{firestore_knowledge}'

    _cached_knowledge = knowledge
    _cache_hash = current_hash
    logger.info(f'Knowledge base built ({len(knowledge)} chars, hash={current_hash[:8]})')
    return knowledge


def _fetch_firestore_knowledge(brand='yoga-bible'):
    """Fetch active knowledge sections from Firestore for a given brand.
    Returns a formatted string to append to the system prompt, or None if empty/error."""
    try:
        from tools.firestore import get_db
        db = get_db()
        docs = (db.collection('agent_knowledge')
                .where('brand', '==', brand)
                .where('active', '==', True)
                .order_by('sort_order')
                .stream())

        sections = []
        for doc in docs:
            d = doc.to_dict()
            title = d.get('title', d.get('section_key', 'Untitled'))
            content = d.get('content', '').strip()
            if content:
                sections.append(f'[{title}]\n{content}')

        if not sections:
            return None

        result = '\n\n'.join(sections)
        logger.info(f'Loaded {len(sections)} knowledge sections from Firestore (brand={brand})')
        return result

    except Exception as e:
        logger.warning(f'Could not fetch Firestore knowledge: {e}')
        return None


def get_knowledge_for_brand(brand):
    """Public API: fetch knowledge sections for any brand.
    Used by future agents (Hot Yoga CPH, Vibro Yoga) to build their own prompts."""
    return _fetch_firestore_knowledge(brand)


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


def auto_pull_main():
    """Pull latest changes from origin/main. Returns dict with status info.

    Returns:
        dict with keys:
          - pulled (bool): whether new commits were pulled
          - agent_changed (bool): whether lead-agent/ Python files changed
          - error (str|None): error message if pull failed
    """
    result = {'pulled': False, 'agent_changed': False, 'error': None}

    try:
        # Make sure we're on main
        branch = _git_current_branch()
        if branch != 'main':
            logger.info(f'Not on main (on {branch}) — skipping auto-pull')
            return result

        # Fetch latest from origin
        fetch = subprocess.run(
            ['git', 'fetch', 'origin', 'main'],
            capture_output=True, text=True, cwd=PROJECT_ROOT, timeout=30
        )
        if fetch.returncode != 0:
            result['error'] = f'git fetch failed: {fetch.stderr.strip()}'
            logger.warning(result['error'])
            return result

        # Check if there are new commits
        diff_check = subprocess.run(
            ['git', 'rev-list', 'HEAD..origin/main', '--count'],
            capture_output=True, text=True, cwd=PROJECT_ROOT, timeout=10
        )
        new_commits = int(diff_check.stdout.strip()) if diff_check.returncode == 0 else 0

        if new_commits == 0:
            logger.debug('auto-pull: already up to date')
            return result

        # Check which files changed BEFORE pulling
        changed_files = subprocess.run(
            ['git', 'diff', '--name-only', 'HEAD..origin/main'],
            capture_output=True, text=True, cwd=PROJECT_ROOT, timeout=10
        )
        changed = changed_files.stdout.strip().splitlines() if changed_files.returncode == 0 else []

        # Pull
        pull = subprocess.run(
            ['git', 'pull', 'origin', 'main', '--ff-only'],
            capture_output=True, text=True, cwd=PROJECT_ROOT, timeout=30
        )
        if pull.returncode != 0:
            result['error'] = f'git pull failed: {pull.stderr.strip()}'
            logger.warning(result['error'])
            return result

        result['pulled'] = True
        logger.info(f'auto-pull: pulled {new_commits} new commit(s) from main')
        logger.info(f'auto-pull: changed files: {", ".join(changed[:20])}')

        # Check if agent code itself changed (needs restart)
        agent_files = [f for f in changed if f.startswith('lead-agent/') and f.endswith('.py')]
        if agent_files:
            result['agent_changed'] = True
            logger.info(f'auto-pull: agent code changed: {", ".join(agent_files)} — restart needed')

        # Knowledge files changed — refresh immediately
        knowledge_files = [f for f in changed if f in KEY_FILES]
        if knowledge_files:
            logger.info(f'auto-pull: knowledge files changed: {", ".join(knowledge_files)} — refreshing')
            refresh_knowledge()

        return result

    except Exception as e:
        result['error'] = str(e)
        logger.warning(f'auto-pull error: {e}')
        return result
