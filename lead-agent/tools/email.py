"""
Email tools for the lead management agent.
Uses Gmail SMTP — same setup as the Netlify functions.

Includes:
- Raw email sending
- Drip email builder (5-step sequence)
- Welcome email builder (per program type, mirrors Netlify templates)
"""

import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

GMAIL_USER = os.getenv('GMAIL_USER', 'info@yogabible.dk')
GMAIL_APP_PASSWORD = os.getenv('GMAIL_APP_PASSWORD', '')
FROM_NAME = 'Yoga Bible'

# ── Shared HTML building blocks (mirrors Netlify email-service.js) ──

BASE_STYLE = 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;'
BTN_STYLE = 'display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;'
ORANGE = '#f75c03'

MEETING_LINK = 'https://yogabible.dk/?booking=1'
ACCOMMODATION_LINK = 'https://yogabible.dk/accommodation'

SCHEDULE_LINKS = {
    '18-week': 'https://yogabible.dk/ytt-skema/?program=18w-mar-jun-2026',
    '4-week': 'https://yogabible.dk/ytt-skema/?program=4w-apr-2026',
    '8-week': 'https://yogabible.dk/ytt-skema/?program=8w-may-jun-2026',
}

SCHEDULE_PDFS = {
    '18-week': 'https://res.cloudinary.com/ddcynsa30/image/upload/v1771280099/18w-mar-jun-2026.pdf_izgiuz',
    '4-week': 'https://res.cloudinary.com/ddcynsa30/image/upload/v1771280041/4w-apr-2026.pdf_x9iwdf',
    '8-week': 'https://res.cloudinary.com/ddcynsa30/image/upload/v1771280072/8w-may-jun-2026.pdf_k7i62j',
}

PROGRAM_LABELS = {
    '18-week': '18-Ugers Fleksibel Yogalæreruddannelse (200h RYT)',
    '4-week': '4-Ugers Intensiv Yogalæreruddannelse (200h RYT)',
    '8-week': '8-Ugers Semi-Intensiv Yogalæreruddannelse (200h RYT)',
    '300h': '300-Timers Avanceret Yogalæreruddannelse',
    '50h': '50-Timers Specialmodul',
    '30h': '30-Timers Specialmodul',
}

COHORT_LABELS = {
    '18-week': 'Marts–Juni 2026',
    '4-week': 'April 2026',
    '8-week': 'Maj–Juni 2026',
    '300h': 'Maj–December 2026',
}


def _signature_html():
    """Yoga Bible full HTML signature (matches Netlify + Apps Script)."""
    return (
        f'<div style="margin-top:18px;padding-top:14px;border-top:1px solid #EBE7E3;font-size:15px;line-height:1.55;color:#1a1a1a;">'
        f'<div style="margin:0 0 2px;">Kærlig hilsen,</div>'
        f'<div style="margin:0 0 2px;"><strong>Shamir</strong> - Kursusdirektør</div>'
        f'<div style="margin:0 0 2px;">Yoga Bible (DK)</div>'
        f'<div style="margin:0 0 2px;"><a href="https://www.yogabible.dk" style="color:{ORANGE};text-decoration:none;">www.yogabible.dk</a></div>'
        f'<div style="margin:0 0 2px;"><a href="https://www.google.com/maps/search/?api=1&query=Torvegade+66,+1400+Copenhagen,+Denmark" target="_blank" style="color:{ORANGE};text-decoration:none;">Torvegade 66, 1400 København K, Danmark</a></div>'
        f'<div style="margin:0;"><a href="tel:+4553881209" style="color:{ORANGE};text-decoration:none;">+45 53 88 12 09</a></div>'
        f'</div>'
    )


def _signature_plain():
    return '\n\nKærlig hilsen,\nShamir - Kursusdirektør\nYoga Bible (DK)\nwww.yogabible.dk\nTorvegade 66, 1400 København K, Danmark\n+45 53 88 12 09'


def _english_note_html():
    return '<p style="margin-top:16px;font-size:13px;color:#888;border-top:1px solid #EBE7E3;padding-top:12px;">🇬🇧 Are you an English speaker? No problem — just reply in English and I will be happy to help.</p>'


def _english_note_plain():
    return '\n\nAre you an English speaker? No problem — just reply in English and I will be happy to help.\n'


def _accommodation_html(city_country=None):
    city_part = f' kommer fra {city_country} og' if city_country else ''
    return (
        f'<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-radius:6px;border-left:3px solid #4CAF50;">'
        f'<strong style="color:#2E7D32;">🏠 Bolig:</strong> '
        f'Jeg kan se, at du{city_part} har brug for bolig i København.<br><br>'
        f'Vi samarbejder med lokale udbydere. '
        f'<strong><a href="{ACCOMMODATION_LINK}" style="color:{ORANGE};">Se boligmuligheder her →</a></strong><br>'
        f'<span style="color:#666;">Har du spørgsmål om bolig? Svar bare på denne e-mail.</span>'
        f'</div>'
    )


def _pricing_html(full_price=23750, deposit=3750):
    remaining = full_price - deposit
    return (
        f'<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid {ORANGE};border-radius:4px;">'
        f'<strong>Pris:</strong> {full_price:,} kr. (ingen ekstra gebyrer)<br>'
        f'<strong>Forberedelsesfasen:</strong> {deposit:,} kr. sikrer din plads<br>'
        f'<strong>Rest:</strong> {remaining:,} kr. (i behagelige rater inden uddannelsesstart)'
        f'</div>'
    )


def _booking_cta_html():
    return (
        f'<p style="margin-top:20px;">Har du lyst til at høre mere eller stille spørgsmål? Book et gratis og uforpligtende infomøde:</p>'
        f'<p><a href="{MEETING_LINK}" style="{BTN_STYLE}">Book gratis infomøde →</a></p>'
        f'<p style="color:#666;font-size:14px;">20 minutter · Ansigt til ansigt eller online · Helt uforpligtende</p>'
    )


def _wrap_full_email(body_html, email_to=None):
    """Wrap email body with all standard sections: English note + signature + unsubscribe."""
    html = f'<div style="{BASE_STYLE}">'
    html += body_html
    html += _english_note_html()
    html += _signature_html()
    if email_to:
        html += f'<div style="margin-top:24px;padding-top:12px;border-top:1px solid #EBE7E3;text-align:center;"><span style="color:#999;font-size:11px;">Ønsker du ikke at modtage flere e-mails? Svar "afmeld" på denne e-mail.</span></div>'
    html += '</div>'
    return html


def send_email(to, subject, body_html, body_text=None):
    """Send an email via Gmail SMTP."""
    msg = MIMEMultipart('alternative')
    msg['From'] = f'{FROM_NAME} <{GMAIL_USER}>'
    msg['To'] = to
    msg['Subject'] = subject

    if body_text:
        msg.attach(MIMEText(body_text, 'plain', 'utf-8'))
    msg.attach(MIMEText(body_html, 'html', 'utf-8'))

    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        server.send_message(msg)

    return {'success': True, 'to': to, 'subject': subject}


def build_drip_email(step, lead, schedule_link=None):
    """
    Build a drip email for a specific step.
    Returns (subject, html, text) tuple.
    """
    first_name = lead.get('first_name', '')
    program = lead.get('program', 'yogalæreruddannelse')
    program_type = lead.get('ytt_program_type', '8-week')

    base_style = 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;'
    btn_style = 'display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;'
    sig = '<p style="margin-top:30px;color:#666;">Med venlig hilsen,<br><strong>Shamir</strong><br>Course Director, Yoga Bible</p>'
    meeting_link = os.getenv('SITE_URL', 'https://yogabible.dk') + '/?booking=1'

    if step == 1:
        # Day 1: Welcome + schedule link (replaces the old all-in-one email)
        subject = f'{first_name}, velkommen — se dit skema'
        html = f'''<div style="{base_style}">
            <p>Hej {first_name},</p>
            <p>Tak for din interesse i vores <strong>{program}</strong>. Spændende!</p>
            <p>Her er dit personlige skema med alle workshopdatoer:</p>
            <p style="margin:20px 0;"><a href="{schedule_link or 'https://yogabible.dk/ytt-skema/'}" style="{btn_style}">Se dit interaktive skema →</a></p>
            <p>Du kan tilføje alle datoer til din kalender med ét klik — og tjekke om de passer med din hverdag.</p>
            <p>Har du spørgsmål? Svar bare på denne mail.</p>
            {sig}
        </div>'''
        text = f'Hej {first_name},\n\nSe dit skema: {schedule_link or "https://yogabible.dk/ytt-skema/"}\n\nHilsen Shamir, Yoga Bible'

    elif step == 2:
        # Day 2-3: Social proof — alumni stories
        subject = f'{first_name}, hør hvad vores dimittender siger'
        html = f'''<div style="{base_style}">
            <p>Hej {first_name},</p>
            <p>Jeg ville lige dele noget med dig.</p>
            <p>Vi har uddannet <strong>500+ yogalærere</strong> siden 2014. De fleste siger det samme:</p>
            <blockquote style="border-left:3px solid #f75c03;padding:12px 16px;margin:20px 0;background:#FFF8F3;border-radius:0 8px 8px 0;">
                <em>"Probably the best thing I have ever done for myself."</em>
            </blockquote>
            <p>Vores dimittender underviser i hele Europa — fra studier i København til retreats på Bali.</p>
            <p>Har du haft tid til at kigge på <a href="{schedule_link or 'https://yogabible.dk/ytt-skema/'}" style="color:#f75c03;">skemaet</a>? Hvis noget er uklart, er du velkommen til at skrive.</p>
            {sig}
        </div>'''
        text = f'Hej {first_name},\n\n500+ dimittender siden 2014. Læs mere om deres oplevelser.\n\nHilsen Shamir'

    elif step == 3:
        # Day 5: Investment framing — deposit-first pricing
        subject = f'{first_name}, sådan starter du din rejse'
        html = f'''<div style="{base_style}">
            <p>Hej {first_name},</p>
            <p>Mange spørger om det praktiske, så her er et overblik:</p>
            <div style="background:#F5F3F0;border-radius:12px;padding:20px;margin:20px 0;">
                <p style="font-size:14px;color:#666;margin-bottom:8px;">Start din forberedelsesfase for</p>
                <p style="font-size:28px;font-weight:700;color:#0F0F0F;margin:0;">3.750 kr.</p>
                <p style="font-size:14px;color:#666;margin-top:8px;">Du får øjeblikkelig adgang til alle klasser i studiet. Restbeløbet fordeles i behagelige rater.</p>
            </div>
            <p>Med forberedelsesfasen sikrer du din plads (max 12 per hold) og kan begynde at praktisere med det samme. Mange studerende bruger denne periode til at forberede krop og sind inden uddannelsen starter.</p>
            <p>Vil du høre mere? Book et gratis infomøde:</p>
            <p><a href="{meeting_link}" style="{btn_style}">Book infomøde</a></p>
            {sig}
        </div>'''
        text = f'Hej {first_name},\n\nStart din forberedelsesfase for 3.750 kr. og få adgang med det samme.\n\nBook infomøde: {meeting_link}\n\nHilsen Shamir'

    elif step == 4:
        # Day 7: Urgency + booking CTA
        subject = f'{first_name}, pladser for maj-holdet'
        html = f'''<div style="{base_style}">
            <p>Hej {first_name},</p>
            <p>Kort update: Vi har <strong>begrænsede pladser</strong> tilbage på det kommende hold (max 12 studerende per hold).</p>
            <p>Mange af vores studerende fortæller, at det bedste de gjorde var at booke et infomøde — uforpligtende, 20 minutter, og du kan stille alle dine spørgsmål ansigt til ansigt (eller online).</p>
            <p><a href="{meeting_link}" style="{btn_style}">Book gratis infomøde →</a></p>
            <p>Du er også velkommen til bare at svare på denne mail med dine spørgsmål.</p>
            {sig}
        </div>'''
        text = f'Hej {first_name},\n\nBegrænsede pladser. Book et infomøde: {meeting_link}\n\nHilsen Shamir'

    elif step == 5:
        # Day 10: Final personal nudge
        subject = f'{first_name}, en personlig note'
        html = f'''<div style="{base_style}">
            <p>Hej {first_name},</p>
            <p>Jeg ville lige følge op en sidste gang.</p>
            <p>Yogalæreruddannelsen er en stor beslutning — det forstår jeg godt. Tag den tid du har brug for. Hvis timingen ikke passer nu, er der altid kommende hold.</p>
            <p>Men hvis du overvejer det, og der er noget der holder dig tilbage — lad mig vide. Mange studerende har haft de samme bekymringer, og vi har næsten altid kunnet finde en løsning.</p>
            <p>Du kan altid skrive til mig her, eller ring direkte: <strong>+45 53 88 12 09</strong></p>
            <p>Alt godt,</p>
            {sig}
        </div>'''
        text = f'Hej {first_name},\n\nEn personlig note. Ring gerne: +45 53 88 12 09\n\nHilsen Shamir'

    else:
        return None, None, None

    return subject, html, text


# ── Welcome email templates (mirrors Netlify lead-emails.js) ──────

def build_welcome_email(lead, program_type=None):
    """
    Build a welcome email matching the Netlify template for a program type.
    Returns (subject, html, text) tuple.
    This is the SAME content the lead receives when they first submit a form.
    """
    first_name = lead.get('first_name', '')
    email = lead.get('email', '')
    ptype = program_type or lead.get('ytt_program_type', '8-week')
    lead_type = lead.get('type', 'ytt')
    accommodation = lead.get('accommodation', '')
    city_country = lead.get('city_country', '')

    if lead_type == 'course':
        return _build_course_welcome(lead)
    elif lead_type == 'mentorship':
        return _build_mentorship_welcome(lead)

    # YTT welcome email
    label = PROGRAM_LABELS.get(ptype, 'Yogalæreruddannelse (200h)')
    cohort = COHORT_LABELS.get(ptype, '')
    schedule_link = SCHEDULE_LINKS.get(ptype, 'https://yogabible.dk/ytt-skema/')
    schedule_pdf = SCHEDULE_PDFS.get(ptype, '')

    subject = f'{first_name}, velkommen — her er dit skema for {label}'

    # Build highlights per program type
    highlights = _get_program_highlights(ptype)

    body = f'<p>Hej {first_name},</p>'
    body += f'<p>Tak for din interesse i vores <strong>{label}</strong>. Det er rigtig spændende!</p>'

    if cohort:
        body += f'<p>Det aktuelle hold starter <strong>{cohort}</strong>.</p>'

    # Schedule section
    if schedule_pdf:
        body += f'<p style="margin-top:16px;"><strong>📄 Dit skema:</strong></p>'
        body += f'<p><a href="{schedule_pdf}" style="{BTN_STYLE}">Download skema (PDF) →</a></p>'
    if schedule_link:
        body += f'<p>Du kan også se det interaktive skema online og tilføje datoerne til din kalender:</p>'
        body += f'<p><a href="{schedule_link}" style="color:{ORANGE};font-weight:600;">Se interaktivt skema →</a></p>'

    # Program highlights
    if highlights:
        body += '<p style="margin-top:16px;"><strong>Uddannelsen inkluderer:</strong></p><ul style="padding-left:20px;">'
        for h in highlights:
            body += f'<li style="margin-bottom:6px;">{h}</li>'
        body += '</ul>'

    # Pricing section
    body += _pricing_html()

    # Accommodation
    if accommodation and accommodation.lower() in ('yes', 'ja', 'true'):
        body += _accommodation_html(city_country)

    # Booking CTA
    body += _booking_cta_html()

    html = _wrap_full_email(body, email)
    text = f'Hej {first_name},\n\nTak for din interesse i {label}.\n\nSe dit skema: {schedule_link}\n\nForberedelsesfasen: 3.750 kr.\n\nBook infomøde: {MEETING_LINK}{_english_note_plain()}{_signature_plain()}'

    return subject, html, text


def _get_program_highlights(ptype):
    """Get bullet-point highlights for a YTT program type."""
    shared = [
        'Yoga Alliance certificeret (RYT-200)',
        'Max 12 studerende per hold',
        'Torvegade 66, Christianshavn, København',
        'Adgang til alle studiehold under forberedelsesfasen',
    ]
    specific = {
        '4-week': [
            '4 ugers fuldtids-immersion',
            'Mandag–fredag workshops',
            'Den hurtigste vej til certificering',
        ],
        '8-week': [
            '8 workshop-lørdage',
            'Behold dit job eller studie ved siden af',
            'Semi-intensivt weekend-format',
        ],
        '18-week': [
            '18 workshop-lørdage',
            'Det mest fleksible format',
            'Perfekt balance med dagligdagen',
        ],
        '300h': [
            'Avanceret certificering (bygger på 200h)',
            'Specialiserede moduler',
            'For erfarne praktikere og undervisere',
        ],
    }
    return specific.get(ptype, []) + shared


def _build_course_welcome(lead):
    """Build welcome email for course leads (Inversions, Splits, Backbends)."""
    first_name = lead.get('first_name', '')
    email = lead.get('email', '')
    course = lead.get('program', lead.get('course_id', 'Specialkursus'))

    subject = f'{first_name}, velkommen til {course} hos Yoga Bible'

    body = f'<p>Hej {first_name},</p>'
    body += f'<p>Tak for din interesse i vores <strong>{course}</strong> kursus!</p>'
    body += '<p>Kurset er 8 sessioner med fokus på teknik, styrke og progression. Alle niveauer er velkomne.</p>'
    body += f'<div style="margin:16px 0;padding:14px;background:#FFFCF9;border-left:3px solid {ORANGE};border-radius:4px;">'
    body += '<strong>Pris:</strong> 2.300 kr. per kursus<br>'
    body += '<strong>Sessioner:</strong> 8 workshops<br>'
    body += '<strong>Rabat:</strong> Spar med vores kursuspakker (2 eller 3 kurser)'
    body += '</div>'
    body += _booking_cta_html()

    html = _wrap_full_email(body, email)
    text = f'Hej {first_name},\n\nTak for din interesse i {course}.\n\nPris: 2.300 kr. · 8 sessioner\n\nBook infomøde: {MEETING_LINK}{_english_note_plain()}{_signature_plain()}'

    return subject, html, text


def _build_mentorship_welcome(lead):
    """Build welcome email for mentorship leads."""
    first_name = lead.get('first_name', '')
    email = lead.get('email', '')

    subject = f'{first_name}, velkommen til Yoga Bible Mentorship'

    body = f'<p>Hej {first_name},</p>'
    body += '<p>Tak for din interesse i vores <strong>Personlig Mentorship</strong> program!</p>'
    body += '<p>Mentorship er et 1:1 skræddersyet forløb, hvor vi sammen udvikler din praksis og undervisning med personlig vejledning hele vejen.</p>'
    body += _booking_cta_html()

    html = _wrap_full_email(body, email)
    text = f'Hej {first_name},\n\nTak for din interesse i Mentorship.\n\nBook konsultation: {MEETING_LINK}{_english_note_plain()}{_signature_plain()}'

    return subject, html, text


def send_welcome_email(lead, program_type=None):
    """Build and send a welcome email for a lead using the correct template."""
    subject, html, text = build_welcome_email(lead, program_type)
    return send_email(lead['email'], subject, html, text)


def send_drip_step(lead, step, schedule_link=None):
    """Build and send a drip email for a specific step."""
    subject, html, text = build_drip_email(step, lead, schedule_link)
    if subject:
        return send_email(lead['email'], subject, html, text)
    return {'error': f'Invalid drip step: {step}'}
