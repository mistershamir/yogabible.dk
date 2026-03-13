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




def _booking_cta_html():
    return (
        '<p style="margin-top:20px;">Har du lyst til at høre mere eller stille spørgsmål? Book et gratis og uforpligtende infomøde:</p>'
        f'<p><a href="{MEETING_LINK}" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book et gratis infomøde</a></p>'
    )


def _question_prompt_html():
    return (
        '<p style="margin-top:20px;">Jeg vil også gerne høre: <strong>Hvad fik dig til at overveje en yogauddannelse?</strong> Du er velkommen til bare at svare på denne mail.</p>'
        '<p>Glæder mig til at høre fra dig.</p>'
    )


def _alumni_note_html():
    return '<p style="margin-top:12px;">Vi har uddannet yogalærere siden 2014, og vores dimittender underviser i hele Europa og videre.</p>'


def _program_highlights_html(extras=None):
    """Shared program highlights — matches Netlify programHighlightsHtml()."""
    html = '<p style="margin-top:16px;">Kort om uddannelsen:</p>'
    html += '<ul style="margin:8px 0;padding-left:20px;color:#333;">'
    html += '<li>200 timer · Yoga Alliance-certificeret</li>'
    html += '<li>Hatha, Vinyasa, Yin, Hot Yoga & Meditation</li>'
    html += '<li>Anatomi, filosofi, sekvensering & undervisningsmetodik</li>'
    if extras:
        for e in extras:
            html += f'<li>{e}</li>'
    html += '<li>Alle niveauer er velkomne</li>'
    html += '</ul>'
    return html


def _program_highlights_plain(extras=None):
    text = 'Kort om uddannelsen:\n'
    text += '- 200 timer · Yoga Alliance-certificeret\n'
    text += '- Hatha, Vinyasa, Yin, Hot Yoga & Meditation\n'
    text += '- Anatomi, filosofi, sekvensering & undervisningsmetodik\n'
    if extras:
        for e in extras:
            text += f'- {e}\n'
    text += '- Alle niveauer velkomne\n'
    return text


def _preparation_phase_html(program_page_url):
    """Green box with preparation phase benefits — matches Netlify getPreparationPhaseHtml()."""
    return (
        '<div style="margin-top:16px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:4px;">'
        '<strong style="color:#166534;">💡 Vidste du?</strong> De fleste studerende starter med forberedelsesfasen allerede nu — og det er der en god grund til:<br><br>'
        '✅ Du kan begynde at deltage i klasser i studiet med det samme<br>'
        '✅ Du opbygger styrke, fleksibilitet og rutine inden uddannelsesstart<br>'
        '✅ Du møder dine kommende medstuderende i et afslappet miljø<br>'
        '✅ Dine klasser tæller med i dine træningstimer<br><br>'
        f'<a href="{program_page_url}" style="display:inline-block;background:#f75c03;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">Start forberedelsesfasen — 3.750 kr.</a>'
        '</div>'
    )


def _preparation_phase_plain(program_page_url):
    return (
        '\nVidste du? De fleste studerende starter med forberedelsesfasen allerede nu:\n'
        '- Deltag i klasser i studiet med det samme\n'
        '- Opbyg styrke, fleksibilitet og rutine inden uddannelsesstart\n'
        '- Mød dine kommende medstuderende\n'
        '- Dine klasser tæller med i dine træningstimer\n'
        f'Start forberedelsesfasen: {program_page_url}\n'
    )


def _pricing_section_html(full_price, deposit, remaining, rate_note):
    """Pricing box — matches Netlify getPricingSectionHtml()."""
    return (
        f'<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">'
        f'<strong>Pris:</strong> {full_price} kr. (ingen ekstra gebyrer)<br>'
        f'<strong>Forberedelsesfasen:</strong> {deposit} kr. sikrer din plads<br>'
        f'<strong>Rest:</strong> {remaining} kr. ({rate_note})'
        f'</div>'
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

    with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=15) as server:
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


# ── Welcome email templates (exact mirror of Netlify lead-emails.js) ──────

def build_welcome_email(lead, program_type=None):
    """
    Build a welcome email matching the EXACT Netlify template for a program type.
    Returns (subject, html, text) tuple.
    """
    first_name = lead.get('first_name', '')
    email = lead.get('email', '')
    ptype = program_type or lead.get('ytt_program_type', '8-week')
    lead_type = lead.get('type', 'ytt')

    if lead_type == 'course':
        return _build_course_welcome(lead)
    elif lead_type == 'mentorship':
        return _build_mentorship_welcome(lead)

    # Route to the correct YTT template
    if ptype == '18-week':
        return _build_18w_welcome(lead)
    elif ptype == '4-week':
        return _build_4w_welcome(lead)
    elif ptype == '8-week':
        return _build_8w_welcome(lead)
    else:
        # 300h, 50h, 30h — use generic YTT template
        return _build_generic_ytt_welcome(lead, ptype)


def _build_18w_welcome(lead):
    """18-week YTT welcome — exact mirror of Netlify sendEmail18wYTT()."""
    first_name = lead.get('first_name', '')
    email = lead.get('email', '')
    needs_housing = (lead.get('accommodation', '') or '').lower() == 'yes'
    city_country = lead.get('city_country', '')

    subject = f'{first_name}, uddannelsen er netop startet — tilmeld dig stadig denne uge'
    schedule_url = 'https://www.yogabible.dk/skema/18-uger/'
    program_page = 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs'

    # Started + last-minute discount banner
    started_banner = (
        '<div style="margin-bottom:20px;padding:14px 16px;background:#FFF7ED;border-left:3px solid #f75c03;border-radius:6px;">'
        '<p style="margin:0 0 8px;"><strong style="color:#c2410c;">🌟 Uddannelsen er netop gået i gang — og du kan stadig nå med denne uge.</strong></p>'
        '<p style="margin:0;color:#444;">Intromodulerne er allerede afholdt, men vi har dem på optagelse — så du nemt kan indhente det på ingen tid. Som tak for din hurtige beslutning får du <strong style="color:#c2410c;">1.000 kr. i last-minute-rabat</strong>.</p>'
        '</div>'
    )

    body = f'<p>Hej {first_name},</p>'
    body += '<p>Tak fordi du viste interesse for vores <strong>18-ugers fleksible yogalæreruddannelse</strong>.</p>'
    body += started_banner
    body += '<p>Her finder du alle datoer og tidspunkter for uddannelsen:</p>'
    body += f'<p style="margin:20px 0;"><a href="{schedule_url}" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet →</a></p>'
    body += '<p style="font-size:14px;color:#666;">Du kan tilføje alle datoer direkte til din kalender — og se præcis hvilke dage der er hverdagshold og weekendhold.</p>'
    body += _program_highlights_html([
        'Vælg hverdags- eller weekendspor — og skift frit undervejs',
        'Online backup hvis du ikke kan møde op en dag',
        '60 yogaklasser i studiet inkluderet'
    ])
    body += '<p style="margin-top:12px;">Det, der gør dette program unikt, er fleksibiliteten. Hver workshop kører to gange — én på en hverdag og én i weekenden — så du altid kan følge med, uanset hvad din uge ser ud.</p>'
    body += '<p style="margin-top:12px;">Holdet er <strong>netop gået i gang</strong>, og vi holder holdene små for at sikre personlig feedback. <strong>Der er kun få pladser tilbage</strong> — og last-minute-rabatten gælder kun denne uge.</p>'

    if needs_housing:
        body += _accommodation_html(city_country)

    # Discounted pricing
    body += (
        '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">'
        '<strong>Normalpris:</strong> <span style="text-decoration:line-through;color:#999;">23.750 kr.</span> &rarr; <strong style="color:#166534;">22.750 kr.</strong> med last-minute-rabat<br>'
        '<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>'
        '<strong>Rest:</strong> 19.000 kr. (fleksibel ratebetaling)'
        '</div>'
    )
    body += _preparation_phase_html(program_page)
    body += f'<p style="margin-top:20px;"><a href="{program_page}" style="color:#f75c03;">Læs mere om 18-ugers programmet</a>'
    body += ' · <a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>'
    body += _booking_cta_html() + _question_prompt_html()
    body += _english_note_html() + _signature_html()
    body += f'<div style="margin-top:24px;padding-top:12px;border-top:1px solid #EBE7E3;text-align:center;"><span style="color:#999;font-size:11px;">Ønsker du ikke at modtage flere e-mails? Svar "afmeld" på denne e-mail.</span></div>'

    html = f'<div style="{BASE_STYLE}">{body}</div>'

    text = f'Hej {first_name},\n\n'
    text += 'Tak fordi du viste interesse for vores 18-ugers fleksible yogalæreruddannelse.\n\n'
    text += '🌟 UDDANNELSEN ER NETOP GÅET I GANG — DU KAN STADIG NÅ MED DENNE UGE\n\n'
    text += 'Intromodulerne er allerede afholdt, men vi har dem på optagelse — så du nemt kan indhente det.\n'
    text += 'Som tak for din hurtige beslutning får du 1.000 kr. i last-minute-rabat.\n\n'
    text += f'Uddannelsesskema og datoer:\n{schedule_url}\n\n'
    text += _program_highlights_plain(['Vælg hverdags- eller weekendspor — skift frit undervejs', 'Online backup hvis du ikke kan møde op', '60 yogaklasser inkluderet'])
    text += '\nNormalpris: 23.750 kr. — din pris med last-minute-rabat: 22.750 kr.\n'
    text += 'Forberedelsesfasen: 3.750 kr. · Rest: 19.000 kr. (fleksibel ratebetaling)\n'
    text += _preparation_phase_plain(program_page)
    text += f'\nLæs mere: {program_page}\n'
    text += f'Book infomøde: {MEETING_LINK}\n'
    text += _english_note_plain() + _signature_plain()

    return subject, html, text


def _build_4w_welcome(lead):
    """4-week YTT welcome — exact mirror of Netlify sendEmail4wYTT()."""
    first_name = lead.get('first_name', '')
    email = lead.get('email', '')
    program = lead.get('program', '4-Week Intensive YTT')
    needs_housing = (lead.get('accommodation', '') or '').lower() == 'yes'
    city_country = lead.get('city_country', '')

    subject = f'{first_name}, her er alle datoer til 4-ugers yogauddannelsen'
    schedule_url = 'https://www.yogabible.dk/skema/4-uger/'
    program_page = 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs'

    is_february = 'feb' in program.lower()
    full_price = '20.750' if is_february else '23.750'
    remaining = '17.000' if is_february else '20.000'
    discount_note = ' (inkl. 3.000 kr. early bird-rabat)' if is_february else ''
    rate_note = 'fleksibel ratebetaling'

    body = f'<p>Hej {first_name},</p>'
    body += '<p>Tak fordi du viste interesse for vores <strong>4-ugers intensive 200-timers yogalæreruddannelse</strong>.</p>'
    body += '<p>Her finder du alle træningsdage og tidspunkter for uddannelsen:</p>'
    body += f'<p style="margin:20px 0;"><a href="{schedule_url}" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet →</a></p>'
    body += '<p style="font-size:14px;color:#666;">Du kan tilføje alle datoer direkte til din kalender — og se præcis, hvad der sker hver dag i de 4 uger.</p>'
    body += '<p style="margin-top:16px;">Det intensive format er til dig, der vil fordybe dig fuldt ud. På 4 uger gennemfører du hele certificeringen med daglig træning og teori — mange af vores dimittender fortæller, at det intensive format hjalp dem med at lære mere, fordi de var 100% dedikerede.</p>'
    body += _program_highlights_html()
    body += '<p style="margin-top:12px;">Vi har uddannet yogalærere siden 2014, og vores dimittender underviser i hele Europa og videre. Kan du ikke møde op en dag, tilbyder vi online backup på udvalgte workshops.</p>'

    if needs_housing:
        body += _accommodation_html(city_country)

    body += (
        f'<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">'
        f'<strong>Pris:</strong> {full_price} kr.{discount_note}<br>'
        f'<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>'
        f'<strong>Rest:</strong> {remaining} kr. ({rate_note})'
        f'</div>'
    )
    body += _preparation_phase_html(program_page)
    body += f'<p style="margin-top:20px;"><a href="{program_page}" style="color:#f75c03;">Læs mere om 4-ugers programmet</a>'
    body += ' · <a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>'
    body += _booking_cta_html() + _question_prompt_html()
    body += _english_note_html() + _signature_html()
    body += f'<div style="margin-top:24px;padding-top:12px;border-top:1px solid #EBE7E3;text-align:center;"><span style="color:#999;font-size:11px;">Ønsker du ikke at modtage flere e-mails? Svar "afmeld" på denne e-mail.</span></div>'

    html = f'<div style="{BASE_STYLE}">{body}</div>'

    text = f'Hej {first_name},\n\n'
    text += 'Tak fordi du viste interesse for vores 4-ugers intensive 200-timers yogalæreruddannelse.\n\n'
    text += f'Uddannelsesskema og datoer:\n{schedule_url}\n\n'
    text += _program_highlights_plain()
    text += f'\nPris: {full_price} kr.{discount_note}\nForberedelsesfasen: 3.750 kr.\nRest: {remaining} kr. ({rate_note})\n\n'
    text += _preparation_phase_plain(program_page)
    text += f'\nLæs mere: {program_page}\n'
    text += f'Book infomøde: {MEETING_LINK}\n'
    text += _english_note_plain() + _signature_plain()

    return subject, html, text


def _build_8w_welcome(lead):
    """8-week YTT welcome — exact mirror of Netlify sendEmail8wYTT()."""
    first_name = lead.get('first_name', '')
    email = lead.get('email', '')
    needs_housing = (lead.get('accommodation', '') or '').lower() == 'yes'
    city_country = lead.get('city_country', '')

    subject = f'{first_name}, her er alle datoer til 8-ugers yogauddannelsen'
    schedule_url = 'https://www.yogabible.dk/skema/8-uger/'
    program_page = 'https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs'

    body = f'<p>Hej {first_name},</p>'
    body += '<p>Tak fordi du viste interesse for vores <strong>8-ugers semi-intensive 200-timers yogalæreruddannelse</strong>.</p>'
    body += '<p>Her finder du alle 22 workshopdatoer og tidspunkter:</p>'
    body += f'<p style="margin:20px 0;"><a href="{schedule_url}" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet →</a></p>'
    body += '<p style="font-size:14px;color:#666;">Du kan tilføje alle datoer direkte til din kalender — og se præcis, hvad der sker hver dag i de 8 uger.</p>'
    body += '<p style="margin-top:16px;">8-ugers formatet giver en god balance: nok intensitet til at holde fokus og gøre reelle fremskridt, men stadig plads til arbejde, familie eller andre forpligtelser. Det er et populært valg for dem, der gerne vil have en dyb oplevelse uden at sætte hele livet på pause.</p>'
    body += _program_highlights_html(['Online backup hvis du ikke kan møde op en dag'])
    body += _alumni_note_html()

    if needs_housing:
        body += _accommodation_html(city_country)

    body += _pricing_section_html('23.750', '3.750', '20.000', 'fleksibel ratebetaling')
    body += _preparation_phase_html(program_page)
    body += f'<p style="margin-top:20px;"><a href="{program_page}" style="color:#f75c03;">Læs mere om 8-ugers programmet</a>'
    body += ' · <a href="https://www.yogabible.dk/om-200hrs-yogalaereruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>'
    body += _booking_cta_html() + _question_prompt_html()
    body += _english_note_html() + _signature_html()
    body += f'<div style="margin-top:24px;padding-top:12px;border-top:1px solid #EBE7E3;text-align:center;"><span style="color:#999;font-size:11px;">Ønsker du ikke at modtage flere e-mails? Svar "afmeld" på denne e-mail.</span></div>'

    html = f'<div style="{BASE_STYLE}">{body}</div>'

    text = f'Hej {first_name},\n\n'
    text += 'Tak fordi du viste interesse for vores 8-ugers semi-intensive 200-timers yogalæreruddannelse.\n\n'
    text += f'Uddannelsesskema og datoer:\n{schedule_url}\n\n'
    text += _program_highlights_plain(['Online backup hvis du ikke kan møde op'])
    text += '\nPris: 23.750 kr. (ingen ekstra gebyrer)\nForberedelsesfasen: 3.750 kr.\nRest: 20.000 kr. (fleksibel ratebetaling)\n\n'
    text += _preparation_phase_plain(program_page)
    text += f'\nLæs mere: {program_page}\n'
    text += f'Book infomøde: {MEETING_LINK}\n'
    text += _english_note_plain() + _signature_plain()

    return subject, html, text


def _build_generic_ytt_welcome(lead, ptype):
    """Generic YTT welcome for 300h, 50h, 30h programs."""
    first_name = lead.get('first_name', '')
    email = lead.get('email', '')
    label = PROGRAM_LABELS.get(ptype, 'Yogalæreruddannelse')

    subject = f'{first_name}, tak for din interesse i {label}'

    body = f'<p>Hej {first_name},</p>'
    body += f'<p>Tak fordi du viste interesse for vores <strong>{label}</strong>.</p>'
    body += _program_highlights_html()
    body += _alumni_note_html()
    body += _booking_cta_html() + _question_prompt_html()
    body += _english_note_html() + _signature_html()

    html = f'<div style="{BASE_STYLE}">{body}</div>'
    text = f'Hej {first_name},\n\nTak for din interesse i {label}.\n\nBook infomøde: {MEETING_LINK}\n{_english_note_plain()}{_signature_plain()}'

    return subject, html, text


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
    body += _english_note_html() + _signature_html()

    html = f'<div style="{BASE_STYLE}">{body}</div>'
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
    body += _english_note_html() + _signature_html()

    html = f'<div style="{BASE_STYLE}">{body}</div>'
    text = f'Hej {first_name},\n\nTak for din interesse i Mentorship.\n\nBook konsultation: {MEETING_LINK}{_english_note_plain()}{_signature_plain()}'

    return subject, html, text


# ── Welcome SMS templates (mirrors Netlify config.js AUTO_SMS_CONFIG) ──

WELCOME_SMS_TEMPLATES = {
    'ytt': "Hi {{first_name}}! Thank you for your interest in our Yoga Teacher Training. We've sent details to your email (check inbox + spam). Book a free info session: https://yogabible.dk/?booking=1 — Warm regards, Yoga Bible",
    'course': "Hi {{first_name}}! Thank you for your interest in our {{program}} course. We've sent details to your email (check inbox + spam). Book a consultation: https://yogabible.dk/?booking=1 — Warm regards, Yoga Bible",
    'mentorship': "Hi {{first_name}}! Thank you for your interest in our Mentorship program. We've sent details to your email (check inbox + spam). Book a free consultation: https://yogabible.dk/?booking=1 — Warm regards, Yoga Bible",
    'default': "Hi {{first_name}}! Thank you for reaching out to Yoga Bible. We've sent info to your email (check inbox + spam). Book a consultation: https://yogabible.dk/?booking=1 — Warm regards, Yoga Bible",
}


def build_welcome_sms(lead):
    """Build the welcome SMS message matching the Netlify AUTO_SMS_CONFIG templates."""
    lead_type = lead.get('type', 'ytt')
    first_name = lead.get('first_name', 'there')
    program = lead.get('program', 'yoga program')

    if lead_type in ('ytt', 'meta'):
        template = WELCOME_SMS_TEMPLATES['ytt']
    elif lead_type in ('course', 'bundle'):
        template = WELCOME_SMS_TEMPLATES['course']
    elif lead_type == 'mentorship':
        template = WELCOME_SMS_TEMPLATES['mentorship']
    else:
        template = WELCOME_SMS_TEMPLATES['default']

    return template.replace('{{first_name}}', first_name).replace('{{program}}', program)


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
