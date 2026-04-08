/**
 * Email Service — Yoga Bible
 * Sends emails via nodemailer + Gmail SMTP (App Password)
 *
 * Required env vars:
 *   GMAIL_USER       — Gmail address (e.g. info@yogabible.dk)
 *   GMAIL_APP_PASSWORD — Gmail App Password (16-char, no spaces)
 */

const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { CONFIG } = require('./config');
const { buildUnsubscribeUrl, escapeHtml, formatDate } = require('./utils');
const { getDb } = require('./firestore');

// ─── Tracking helpers (shared with resend-service) ───────────────────────────

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 12);
}

const TRACK_BASE_FN = () => (CONFIG.SITE_URL || 'https://yogabible.dk') + '/.netlify/functions/email-track';

function injectTrackingPixel(html, campaignId, email) {
  if (!campaignId) return html;
  const base = TRACK_BASE_FN();
  const eh = hashEmail(email);
  const pixelUrl = base + '?t=open&cid=' + encodeURIComponent(campaignId) + '&e=' + eh;
  return html + '<img src="' + pixelUrl + '" width="1" height="1" style="display:none" alt="" />';
}

function wrapLinksForTracking(html, campaignId, email) {
  if (!campaignId) return html;
  const base = TRACK_BASE_FN();
  const eh = hashEmail(email);
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, function (match, url) {
    if (url.includes('/unsubscribe') || url.includes('/email-track')) return match;
    const trackUrl = base + '?t=click&cid=' + encodeURIComponent(campaignId) + '&e=' + eh + '&url=' + encodeURIComponent(url);
    return 'href="' + trackUrl + '"';
  });
}

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER || CONFIG.EMAIL_FROM;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!pass) {
    throw new Error('GMAIL_APP_PASSWORD env var not set. Generate one at https://myaccount.google.com/apppasswords');
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  return transporter;
}

// =========================================================================
// Signature & Reusable HTML Blocks
// =========================================================================

function getSignatureHtml(lang) {
  const orange = '#f75c03';
  var l = (lang || 'da').toLowerCase().substring(0, 2);
  var isDa = ['da', 'dk'].includes(l);
  var isDe = l === 'de';
  var greeting = isDa ? 'K\u00e6rlig hilsen,' : isDe ? 'Herzliche Gr\u00fc\u00dfe,' : 'Warm regards,';
  var title = isDa ? 'Kursusdirekt\u00f8r' : isDe ? 'Kursleiter' : 'Course Director';
  var address = isDa ? 'Torvegade 66, 1400 K\u00f8benhavn K, Danmark' : 'Torvegade 66, 1400 Copenhagen K, Denmark';
  return '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #EBE7E3;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;">' +
    '<div style="margin:0 0 2px;">' + greeting + '</div>' +
    '<div style="margin:0 0 2px;"><strong>Shamir</strong> - ' + title + '</div>' +
    '<div style="margin:0 0 2px;">Yoga Bible</div>' +
    '<div style="margin:0 0 2px;"><a href="https://www.yogabible.dk" style="color:' + orange + ';text-decoration:none;">www.yogabible.dk</a></div>' +
    '<div style="margin:0 0 2px;"><a href="' + CONFIG.STUDIO_MAPS_URL + '" target="_blank" style="color:' + orange + ';text-decoration:none;">' + address + '</a></div>' +
    '<div style="margin:0;"><a href="tel:+4553881209" style="color:' + orange + ';text-decoration:none;">+45 53 88 12 09</a></div>' +
    '</div>';
}

function getSignaturePlain(lang) {
  var l = (lang || 'da').toLowerCase().substring(0, 2);
  var isDa = ['da', 'dk'].includes(l);
  var isDe = l === 'de';
  var greeting = isDa ? 'K\u00e6rlig hilsen,' : isDe ? 'Herzliche Gr\u00fc\u00dfe,' : 'Warm regards,';
  var title = isDa ? 'Kursusdirekt\u00f8r' : isDe ? 'Kursleiter' : 'Course Director';
  var address = isDa ? 'Torvegade 66, 1400 K\u00f8benhavn K, Danmark' : 'Torvegade 66, 1400 Copenhagen K, Denmark';
  return '\n\n' + greeting + '\nShamir - ' + title + '\nYoga Bible\nwww.yogabible.dk\n' + address + '\n+45 53 88 12 09';
}

function getEnglishNoteHtml() {
  return '<p style="margin-top:16px;font-size:13px;color:#888;border-top:1px solid #EBE7E3;padding-top:12px;">' +
    '\ud83c\uddec\ud83c\udde7 Are you an English speaker? No problem \u2014 just reply in English and I will be happy to help.</p>';
}

function getEnglishNotePlain() {
  return '\n\nAre you an English speaker? No problem \u2014 just reply in English and I will be happy to help.\n';
}

function getGermanPsLineHtml() {
  return '<p style="margin-top:16px;font-size:13px;color:#6F6A66;font-style:italic;">' +
    'PS: Wir schreiben dir auf Deutsch, weil wir möchten, dass du dich bei uns willkommen fühlst — noch bevor du in Kopenhagen ankommst. Antworte gerne auf Deutsch oder Englisch, wir verstehen beides.</p>';
}

function getGermanPsLinePlain() {
  return '\n\nPS: Wir schreiben dir auf Deutsch, weil wir möchten, dass du dich bei uns willkommen fühlst — noch bevor du in Kopenhagen ankommst. Antworte gerne auf Deutsch oder Englisch, wir verstehen beides.\n';
}

function getUnsubscribeFooterHtml(email, lang) {
  const url = buildUnsubscribeUrl(email, lang);
  var l = (lang || 'da').toLowerCase().substring(0, 2);
  var text;
  if (l === 'de') {
    text = 'Du m\u00F6chtest keine E-Mails mehr erhalten? Hier abmelden';
  } else if (['da', 'dk'].includes(l)) {
    text = '\u00d8nsker du ikke at modtage flere e-mails? Afmeld her';
  } else {
    text = "Don't want to receive more emails? Unsubscribe here";
  }
  return '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #EBE7E3;text-align:center;">' +
    '<a href="' + url + '" style="color:#999;font-size:11px;text-decoration:none;">' + text + '</a>' +
    '</div>';
}

function getUnsubscribeFooterPlain(email, lang) {
  const url = buildUnsubscribeUrl(email, lang);
  var l = (lang || 'da').toLowerCase().substring(0, 2);
  var label;
  if (l === 'de') {
    label = 'Abmelden: ';
  } else if (['da', 'dk'].includes(l)) {
    label = 'Afmeld nyhedsbrev: ';
  } else {
    label = 'Unsubscribe: ';
  }
  return '\n\n---\n' + label + url;
}

function getAccommodationSectionHtml(cityCountry) {
  return '<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-radius:6px;border-left:3px solid #4CAF50;">' +
    '<strong style="color:#2E7D32;">\ud83c\udfe0 Bolig:</strong> ' +
    'Jeg kan se, at du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for bolig i K\u00f8benhavn.<br><br>' +
    'Vi samarbejder med lokale udbydere. ' +
    '<strong><a href="https://yogabible.dk/accommodation" style="color:#f75c03;">Se boligmuligheder her \u2192</a></strong><br>' +
    '<span style="color:#666;">Har du sp\u00f8rgsm\u00e5l om bolig? Svar bare p\u00e5 denne e-mail.</span>' +
    '</div>';
}

function getPricingSectionHtml(fullPrice, deposit, remaining, rateNote) {
  return '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">' +
    '<strong>Pris:</strong> ' + fullPrice + ' kr. (ingen ekstra gebyrer)<br>' +
    '<strong>Forberedelsesfasen:</strong> ' + deposit + ' kr. sikrer din plads<br>' +
    '<strong>Rest:</strong> ' + remaining + ' kr. (' + rateNote + ')' +
    '</div>';
}

// =========================================================================
// Template Variable Substitution
// =========================================================================

function substituteVars(text, vars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/gi, (match, key) => {
    return vars[key] || vars[key.toLowerCase()] || match;
  });
}

// =========================================================================
// Core Send Functions
// =========================================================================

/**
 * Send a raw email (lowest level)
 */
async function sendRawEmail({ to, subject, html, text, attachments, replyTo, fromEmail }) {
  const transport = getTransporter();

  // Allow sender override for multi-brand campaigns
  const senderEmail = fromEmail || process.env.GMAIL_USER || CONFIG.EMAIL_FROM;
  const senderName = fromEmail && fromEmail.includes('hotyogacph') ? 'Hot Yoga CPH' : CONFIG.FROM_NAME;

  const mailOptions = {
    from: `"${senderName}" <${senderEmail}>`,
    to,
    subject,
    text: text || '',
    html: html || '',
    replyTo: replyTo || CONFIG.EMAIL_FROM
  };

  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments;
  }

  const info = await transport.sendMail(mailOptions);
  console.log(`[email] Sent to ${to}: ${subject} (messageId: ${info.messageId})`);
  return { success: true, messageId: info.messageId };
}

/**
 * Send a template-based email from Firestore email_templates collection
 */
async function sendTemplateEmail({ to, templateId, vars, leadId, lang }) {
  const db = getDb();
  const doc = await db.collection('email_templates').doc(templateId).get();

  if (!doc.exists) {
    throw new Error(`Email template '${templateId}' not found`);
  }

  const template = doc.data();
  const subject = substituteVars(template.subject, vars);
  let bodyHtml = substituteVars(template.body_html || template.body || '', vars);
  let bodyPlain = substituteVars(template.body_plain || '', vars);

  // Language-aware note: English note only on DA emails, German PS on DE emails
  var tl = (lang || 'da').toLowerCase().substring(0, 2);
  var isDa = ['da', 'dk'].includes(tl);
  var isDe = tl === 'de';
  var noteHtml = isDa ? getEnglishNoteHtml() : isDe ? getGermanPsLineHtml() : '';
  var notePlain = isDa ? getEnglishNotePlain() : isDe ? getGermanPsLinePlain() : '';

  // Wrap with signature + unsubscribe
  const wrappedHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">' +
    bodyHtml +
    noteHtml +
    getSignatureHtml(lang) +
    getUnsubscribeFooterHtml(to, lang) +
    '</div>';

  const wrappedPlain = bodyPlain + notePlain + getSignaturePlain(lang) + getUnsubscribeFooterPlain(to, lang);

  const result = await sendRawEmail({ to, subject, html: wrappedHtml, text: wrappedPlain });

  // Log to email_log collection
  await logEmail({ to, subject, templateId, leadId, messageId: result.messageId });

  return result;
}

/**
 * Send a custom email (admin-composed, not from template)
 */
async function sendCustomEmail({ to, subject, bodyHtml, bodyPlain, leadId, includeSignature = true, includeUnsubscribe = true, campaignId, fromEmail, lang }) {
  // Language-aware note: English note only on DA emails, German PS on DE emails
  var tl = (lang || 'da').toLowerCase().substring(0, 2);
  var isDa = ['da', 'dk'].includes(tl);
  var isDe = tl === 'de';

  let html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  html += bodyHtml;
  if (includeSignature) {
    if (isDa) html += getEnglishNoteHtml();
    else if (isDe) html += getGermanPsLineHtml();
    html += getSignatureHtml(lang);
  }
  if (includeUnsubscribe) {
    html += getUnsubscribeFooterHtml(to, lang);
  }
  html += '</div>';

  // Inject tracking if campaignId provided
  if (campaignId) {
    html = wrapLinksForTracking(html, campaignId, to);
    html = injectTrackingPixel(html, campaignId, to);
  }

  let text = bodyPlain || '';
  if (includeSignature) {
    if (isDa) text += getEnglishNotePlain();
    else if (isDe) text += getGermanPsLinePlain();
    text += getSignaturePlain(lang);
  }
  if (includeUnsubscribe) text += getUnsubscribeFooterPlain(to, lang);

  const result = await sendRawEmail({ to, subject, html, text, fromEmail });
  await logEmail({ to, subject, templateId: null, leadId, messageId: result.messageId, campaignId });
  return result;
}

/**
 * Send admin notification about new lead
 */
async function sendAdminNotification(leadData) {
  // Determine country for subject line
  const countryField = (leadData.country || '').toUpperCase().trim();
  const cityCountry = leadData.city_country || '';
  const displayCountry = cityCountry || countryField || '';
  const lang = (leadData.lang || leadData.meta_lang || '').toLowerCase();
  const phone = String(leadData.phone || '').replace(/\s+/g, '');
  // DK detection: explicit country field, lang=da, Danish form, Danish phone (+45 or 8-digit), .dk email, or city_country contains Denmark/DK
  const hasDkPhone = phone.startsWith('+45') || phone.startsWith('0045') || (/^\d{8}$/.test(phone));
  const hasDkEmail = !!(leadData.email && leadData.email.toLowerCase().endsWith('.dk'));
  const isDk = countryField === 'DK' || lang === 'da' || lang === 'dk' || hasDkPhone || hasDkEmail
    || (cityCountry && (cityCountry.toLowerCase().includes('denmark') || cityCountry.toLowerCase().includes('danmark') || /,\s*dk$/i.test(cityCountry)));
  const originTag = isDk ? 'DK' : 'INT';
  const countryTag = displayCountry ? ` — ${displayCountry}` : '';

  // Detect applicants vs leads
  const isApplicant = leadData.type === 'education' || (leadData.source && leadData.source.toLowerCase().includes('ans\u00f8gning'))
    || (leadData.notes && leadData.notes.includes('APPLICATION'));
  const label = isApplicant ? 'New applicant' : 'New lead';
  const cohort = leadData.program || leadData.ytt_program_type || '';
  const cohortTag = cohort ? ` · ${cohort}` : '';
  const subject = `${label} [${originTag}${countryTag}]: ${leadData.first_name} ${leadData.last_name || ''} (${leadData.type || 'unknown'})${cohortTag}`;

  let html = '<div style="font-family:monospace;font-size:14px;line-height:1.6;">';
  html += `<h3 style="color:#f75c03;">${label} received</h3>`;
  html += '<table style="border-collapse:collapse;">';

  const fields = ['email', 'first_name', 'last_name', 'phone', 'type', 'ytt_program_type', 'program', 'meta_form_id', 'meta_form_name', 'source', 'channel', 'utm_campaign', 'accommodation', 'city_country', 'country', 'lang', 'notes'];
  for (const field of fields) {
    if (leadData[field]) {
      const val = escapeHtml(String(leadData[field]));
      // Highlight channel with a colored badge
      const display = field === 'channel'
        ? `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:13px;font-weight:bold;background:${getChannelColor(leadData[field])};color:#fff;">${val}</span>`
        : val;
      html += `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#666;">${field}:</td><td style="padding:4px 0;">${display}</td></tr>`;
    }
  }
  html += '</table></div>';

  return sendRawEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject,
    html,
    text: `${label} [${originTag}]: ${leadData.email} - ${leadData.first_name} - ${leadData.type} - ${cohort}${countryTag}`
  });
}

// =========================================================================
// Email Log
// =========================================================================

async function logEmail({ to, subject, templateId, leadId, messageId, campaignId }) {
  try {
    const db = getDb();
    const entry = {
      to,
      subject,
      template_id: templateId || null,
      lead_id: leadId || null,
      message_id: messageId || null,
      sent_at: new Date(),
      status: 'sent'
    };
    if (campaignId) entry.campaign_id = campaignId;
    await db.collection('email_log').add(entry);
  } catch (err) {
    console.error('[email] Failed to log email:', err.message);
  }
}

/** Return a background color for channel badges in admin emails */
function getChannelColor(channel) {
  if (!channel) return '#999';
  const ch = channel.toLowerCase();
  if (ch.includes('google ads')) return '#4285F4';
  if (ch.includes('google') && ch.includes('organic')) return '#34A853';
  if (ch.includes('meta ads') || ch.includes('facebook') || ch.includes('instagram ads')) return '#1877F2';
  if (ch.includes('ai referral')) return '#8B5CF6';
  if (ch.includes('social')) return '#E4405F';
  if (ch.includes('email')) return '#f75c03';
  if (ch.includes('sms')) return '#22C55E';
  if (ch === 'direct') return '#6B7280';
  if (ch.includes('referral')) return '#F59E0B';
  return '#999';
}

module.exports = {
  sendRawEmail,
  sendTemplateEmail,
  sendCustomEmail,
  sendAdminNotification,
  getSignatureHtml,
  getSignaturePlain,
  getEnglishNoteHtml,
  getEnglishNotePlain,
  getGermanPsLineHtml,
  getGermanPsLinePlain,
  getUnsubscribeFooterHtml,
  getUnsubscribeFooterPlain,
  getAccommodationSectionHtml,
  getPricingSectionHtml,
  substituteVars
};
