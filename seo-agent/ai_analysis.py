"""
AI-Powered SEO & AEO Analysis (Claude Sonnet)

Analyzes the weekly report data + live page content to provide:
1. Natural language summary with prioritized action items
2. SEO content optimization suggestions per page
3. Structured data / schema recommendations for AI chat visibility
4. Keyword strategy insights based on Search Console data

Runs once per week as part of the Monday report.
Cost: ~$0.01-0.03 per weekly run (Sonnet is cheap).
"""

import os
import json
import logging
import urllib.request
import urllib.error
import ssl
from urllib.parse import urljoin

logger = logging.getLogger('seo-agent.ai')

SITE_URL = os.getenv('SITE_URL', 'https://yogabible.dk')
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY', '')

# Pages to analyze for content quality (most important for conversions)
ANALYZE_PAGES = [
    ('/', 'Homepage'),
    ('/en/', 'Homepage (EN)'),
    ('/om-200hrs-yogalaereruddannelser/', '200hr YTT Overview'),
    ('/200-hours-4-weeks-intensive-programs/', '4-Week Intensive'),
    ('/200-hours-8-weeks-semi-intensive-programs/', '8-Week Semi-Intensive'),
    ('/200-hours-18-weeks-flexible-programs/', '18-Week Flexible'),
    ('/300-hours-advanced-teacher-training/', '300hr Advanced'),
    ('/en/200-hours-4-weeks-intensive-programs/', '4-Week Intensive (EN)'),
]

# Target keywords the business needs to rank for
TARGET_KEYWORDS = {
    'da': [
        'yogalæreruddannelse',
        'yogalæreruddannelse københavn',
        'yoga uddannelse danmark',
        '200 timer yogauddannelse',
        'yoga kursus københavn',
        '300 timer yoga uddannelse',
        'hot yoga copenhagen',
    ],
    'en': [
        'yoga teacher training copenhagen',
        'yoga teacher training denmark',
        'yoga teacher training europe',
        '200 hour yoga teacher training',
        'yoga certification copenhagen',
        'yoga alliance certified training denmark',
    ],
}


def analyze_with_ai(report):
    """Run AI analysis on the weekly report. Returns analysis text for Telegram."""
    if not ANTHROPIC_API_KEY:
        logger.warning('ANTHROPIC_API_KEY not set — skipping AI analysis')
        return None

    try:
        # Gather page content for analysis
        page_data = _fetch_page_data()

        # Build the prompt
        prompt = _build_prompt(report, page_data)

        # Call Claude Sonnet
        analysis = _call_claude(prompt)

        return analysis

    except Exception as e:
        logger.error(f'AI analysis failed: {e}')
        return None


def _fetch_page_data():
    """Fetch key pages and extract SEO-relevant content."""
    ctx = ssl.create_default_context()
    pages = []

    for path, name in ANALYZE_PAGES:
        url = urljoin(SITE_URL, path)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'YogaBible-SEO-Agent/1.0'})
            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                body = resp.read().decode('utf-8', errors='replace')

                # Extract key SEO elements
                title = _extract_between(body, '<title>', '</title>')
                meta_desc = _extract_meta(body, 'description')
                h1s = _extract_all(body, '<h1', '</h1>')
                h2s = _extract_all(body, '<h2', '</h2>')

                # Get visible text (rough — strip tags)
                import re
                # Remove scripts, styles, and tags
                text = re.sub(r'<script[^>]*>.*?</script>', '', body, flags=re.DOTALL)
                text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
                text = re.sub(r'<[^>]+>', ' ', text)
                text = re.sub(r'\s+', ' ', text).strip()
                # First 2000 chars of visible text
                visible_text = text[:2000]

                pages.append({
                    'path': path,
                    'name': name,
                    'title': title,
                    'meta_description': meta_desc,
                    'h1': h1s[:3],
                    'h2': h2s[:10],
                    'visible_text_preview': visible_text,
                })
        except Exception as e:
            logger.debug(f'Failed to fetch {path}: {e}')

    return pages


def _build_prompt(report, page_data):
    """Build the analysis prompt for Claude."""
    metrics = report.get('metrics', {})
    errors = report.get('errors', [])
    warnings = report.get('warnings', [])
    rankings = report.get('rankings', {})

    return f"""You are an expert SEO/AEO consultant for Yoga Bible (yogabible.dk), a premium yoga teacher training school in Copenhagen, Denmark. Each conversion (student enrollment) is worth ~25,000 DKK, so even small SEO improvements have significant revenue impact.

The site is bilingual: Danish (primary) and English. It must rank for both Danish and English yoga teacher training keywords.

## Current Report Data

**Errors:** {json.dumps(errors, ensure_ascii=False) if errors else 'None'}

**Warnings:** {json.dumps(warnings, ensure_ascii=False) if warnings else 'None'}

**Metrics:**
{json.dumps(metrics, indent=2, ensure_ascii=False)}

**Search Console Rankings (28d):**
{json.dumps(rankings, indent=2, ensure_ascii=False) if rankings else 'No data yet (service account just added)'}

## Target Keywords to Rank For

**Danish:** {', '.join(TARGET_KEYWORDS['da'])}
**English:** {', '.join(TARGET_KEYWORDS['en'])}

## Page Analysis

{_format_pages(page_data)}

## Your Task

Provide a concise, actionable weekly SEO briefing. Structure it exactly like this:

**PRIORITY FIXES** (things hurting SEO/conversions right now):
- List only genuine issues, max 3 items

**CONTENT OPPORTUNITIES** (specific improvements to make this week):
- Analyze each key page's title, meta description, and headings against target keywords
- Flag any pages where the title doesn't include the primary keyword
- Flag meta descriptions that aren't compelling or miss keywords
- Suggest specific rewrites where needed (give the exact text)

**AI CHAT VISIBILITY** (how to appear in ChatGPT, Perplexity, etc.):
- Review the structured data (schema types: {', '.join(metrics.get('schema_types', []))})
- Suggest any missing schema that would help AI assistants reference Yoga Bible
- Note: AI chatbots pull from structured data, FAQ schema, and clear authoritative content

**KEYWORD INSIGHTS** (based on Search Console data if available):
- Which keywords are close to page 1 (positions 8-20) and worth pushing
- Any surprising queries you're ranking for that deserve dedicated content

**KEYWORD TRENDS & MARKET SIGNALS:**
- Striking distance keywords: {json.dumps(metrics.get('striking_distance_keywords', [])[:10], ensure_ascii=False)}
- Google Trends data: {json.dumps(metrics.get('keyword_trends', {}), ensure_ascii=False)}
- Related rising queries: {json.dumps(metrics.get('related_rising_queries', []), ensure_ascii=False)}
- Week-over-week keyword movement: top mover up: {metrics.get('top_mover_up', 'N/A')}, top drop: {metrics.get('top_mover_down', 'N/A')}
- Based on trend and movement data, recommend specific content actions:
  * Which rising queries deserve new blog posts or FAQ entries
  * Which falling keywords need content refresh
  * Which striking-distance keywords to prioritize in existing page optimization

Keep it concise — this goes to a Telegram message. Use plain text, no markdown. Max 800 words. Be specific and actionable, not generic SEO advice. Every suggestion should reference a specific page and give exact text to change."""


def _format_pages(pages):
    """Format page data for the prompt."""
    lines = []
    for p in pages:
        lines.append(f"### {p['name']} ({p['path']})")
        lines.append(f"Title: {p.get('title', 'MISSING')}")
        lines.append(f"Meta desc: {p.get('meta_description', 'MISSING')}")
        lines.append(f"H1: {', '.join(p.get('h1', [])) or 'MISSING'}")
        lines.append(f"H2s: {', '.join(p.get('h2', [])) or 'None'}")
        lines.append(f"Content preview: {p.get('visible_text_preview', '')[:500]}...")
        lines.append('')
    return '\n'.join(lines)


def _call_claude(prompt):
    """Call Claude Sonnet via the Anthropic API."""
    url = 'https://api.anthropic.com/v1/messages'

    payload = json.dumps({
        'model': 'claude-sonnet-4-6',
        'max_tokens': 1500,
        'messages': [{'role': 'user', 'content': prompt}],
    }).encode('utf-8')

    req = urllib.request.Request(url, data=payload, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('x-api-key', ANTHROPIC_API_KEY)
    req.add_header('anthropic-version', '2023-06-01')

    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
        data = json.loads(resp.read())
        return data['content'][0]['text']


def _extract_between(html, start, end):
    """Extract text between two tags."""
    i = html.find(start)
    if i == -1:
        return ''
    i += len(start)
    j = html.find(end, i)
    if j == -1:
        return ''
    return html[i:j].strip()


def _extract_meta(html, name):
    """Extract a meta tag content."""
    import re
    match = re.search(rf'<meta\s+name="{name}"\s+content="([^"]*)"', html)
    if not match:
        match = re.search(rf'<meta\s+content="([^"]*)"\s+name="{name}"', html)
    return match.group(1) if match else ''


def _extract_all(html, start_tag, end_tag):
    """Extract all occurrences between tags."""
    import re
    results = []
    pattern = rf'{start_tag}[^>]*>(.*?){end_tag}'
    for match in re.finditer(pattern, html, re.DOTALL):
        text = re.sub(r'<[^>]+>', '', match.group(1)).strip()
        if text:
            results.append(text)
    return results
