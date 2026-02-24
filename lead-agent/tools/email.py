"""
Email tools for the lead management agent.
Uses Gmail SMTP — same setup as the Netlify functions.
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
