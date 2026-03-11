/**
 * Lead Welcome Emails — Yoga Bible
 * Auto-reply emails sent to leads when they submit a form.
 * Ported from Apps Script (06 emails.js) to Netlify Functions.
 *
 * Each program type has its own Danish email template with:
 * - Program info, pricing, schedule attachment (if available)
 * - Accommodation section (if needed)
 * - Booking CTA, English note, signature, unsubscribe
 *
 * Schedule PDFs are now hosted on Cloudinary (not Google Drive).
 */

const { CONFIG, COURSE_CONFIG, SCHEDULE_PDFS } = require('./config');
const {
  escapeHtml,
  getCoursePaymentUrl,
  getBundlePaymentUrl
} = require('./utils');
const {
  sendRawEmail,
  getSignatureHtml,
  getSignaturePlain,
  getEnglishNoteHtml,
  getEnglishNotePlain,
  getUnsubscribeFooterHtml,
  getUnsubscribeFooterPlain,
  getAccommodationSectionHtml,
  getPricingSectionHtml
} = require('./email-service');
const { getDb } = require('./firestore');

// =========================================================================
// Shared HTML helpers
// =========================================================================

function wrapHtml(body) {
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">' +
    body + '</div>';
}

function bookingCta() {
  return '<p style="margin-top:20px;">Har du lyst til at h\u00f8re mere eller stille sp\u00f8rgsm\u00e5l? Book et gratis og uforpligtende infom\u00f8de:</p>' +
    '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book et gratis infom\u00f8de</a></p>';
}

function questionPrompt() {
  return '<p style="margin-top:20px;">Jeg vil ogs\u00e5 gerne h\u00f8re: <strong>Hvad fik dig til at overveje en yogauddannelse?</strong> Du er velkommen til bare at svare p\u00e5 denne mail.</p>' +
    '<p>Gl\u00e6der mig til at h\u00f8re fra dig.</p>';
}

function programHighlightsHtml(extras) {
  let html = '<p style="margin-top:16px;">Kort om uddannelsen:</p>';
  html += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  html += '<li>200 timer \u00b7 Yoga Alliance-certificeret</li>';
  html += '<li>Hatha, Vinyasa, Yin, Hot Yoga & Meditation</li>';
  html += '<li>Anatomi, filosofi, sekvensering & undervisningsmetodik</li>';
  if (extras) extras.forEach(e => { html += '<li>' + e + '</li>'; });
  html += '<li>Alle niveauer er velkomne</li>';
  html += '</ul>';
  return html;
}

function programHighlightsPlain(extras) {
  let text = 'Kort om uddannelsen:\n';
  text += '- 200 timer \u00b7 Yoga Alliance-certificeret\n';
  text += '- Hatha, Vinyasa, Yin, Hot Yoga & Meditation\n';
  text += '- Anatomi, filosofi, sekvensering & undervisningsmetodik\n';
  if (extras) extras.forEach(e => { text += '- ' + e + '\n'; });
  text += '- Alle niveauer velkomne\n';
  return text;
}

function alumniNote() {
  return '<p style="margin-top:12px;">Vi har uddannet yogal\u00e6rere siden 2014, og vores dimittender underviser i hele Europa og videre.</p>';
}

function getAccommodationSectionPlain(cityCountry) {
  return '\n\nBolig: Jeg kan se du' + (cityCountry ? ' kommer fra ' + cityCountry + ' og' : '') + ' har brug for bolig i K\u00f8benhavn.\n' +
    'Se muligheder: https://yogabible.dk/accommodation\n' +
    'Har du sp\u00f8rgsm\u00e5l? Svar bare p\u00e5 denne e-mail.\n';
}

function getPricingSectionPlain(fullPrice, deposit, remaining, rateNote) {
  return 'Pris: ' + fullPrice + ' kr. (ingen ekstra gebyrer)\n' +
    'Forberedelsesfasen: ' + deposit + ' kr.\n' +
    'Rest: ' + remaining + ' kr. (' + rateNote + ')\n';
}

// =========================================================================
// Preparation Phase promotion block
// =========================================================================

function getPreparationPhaseHtml(programPageUrl) {
  return '<div style="margin-top:16px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:4px;">' +
    '<strong style="color:#166534;">\ud83d\udca1 Vidste du?</strong> De fleste studerende starter med forberedelsesfasen allerede nu \u2014 og det er der en god grund til:<br><br>' +
    '\u2705 Du kan begynde at deltage i klasser i studiet med det samme<br>' +
    '\u2705 Du opbygger styrke, fleksibilitet og rutine inden uddannelsesstart<br>' +
    '\u2705 Du m\u00f8der dine kommende medstuderende i et afslappet milj\u00f8<br>' +
    '\u2705 Dine klasser t\u00e6ller med i dine tr\u00e6ningstimer<br><br>' +
    '<a href="' + programPageUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">Start forberedelsesfasen \u2014 3.750 kr.</a>' +
    '</div>';
}

function getPreparationPhasePlain(programPageUrl) {
  return '\nVidste du? De fleste studerende starter med forberedelsesfasen allerede nu:\n' +
    '- Deltag i klasser i studiet med det samme\n' +
    '- Opbyg styrke, fleksibilitet og rutine inden uddannelsesstart\n' +
    '- M\u00f8d dine kommende medstuderende\n' +
    '- Dine klasser t\u00e6ller med i dine tr\u00e6ningstimer\n' +
    'Start forberedelsesfasen: ' + programPageUrl + '\n';
}

// =========================================================================
// Schedule PDF attachment helper
// =========================================================================

/**
 * Look up schedule PDF URL from config by program type and cohort.
 * Falls back to 'default' if no cohort match.
 */
function getSchedulePdfUrl(programType, program) {
  const urls = SCHEDULE_PDFS[programType];
  if (!urls) return '';

  // Try to match cohort from program string
  const prog = (program || '').toLowerCase();
  for (const cohortKey of Object.keys(urls)) {
    if (cohortKey === 'default') continue;
    if (prog.includes(cohortKey.toLowerCase().split(' ')[0])) {
      return urls[cohortKey] || '';
    }
  }

  // Try keyword matching
  if (prog.includes('aug') || prog.includes('dec')) {
    for (const key of Object.keys(urls)) {
      if (key.toLowerCase().includes('aug') || key.toLowerCase().includes('dec')) return urls[key] || '';
    }
  }
  if (prog.includes('okt') || prog.includes('oct') || prog.includes('nov')) {
    for (const key of Object.keys(urls)) {
      if (key.toLowerCase().includes('okt') || key.toLowerCase().includes('oct')) return urls[key] || '';
    }
  }
  if (prog.includes('jul')) {
    for (const key of Object.keys(urls)) {
      if (key.toLowerCase().includes('jul')) return urls[key] || '';
    }
  }

  return urls['default'] || '';
}

async function fetchSchedulePdfAttachment(programType, program) {
  const url = getSchedulePdfUrl(programType, program);
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `yoga-bible-schedule-${programType}.pdf`;
    return { filename, content: buffer, contentType: 'application/pdf' };
  } catch (err) {
    console.error(`[lead-emails] Failed to fetch schedule PDF for ${programType}:`, err.message);
    return null;
  }
}

// =========================================================================
// Main router: sendWelcomeEmail
// =========================================================================

async function sendWelcomeEmail(leadData, action, tokenData = {}) {
  if (!leadData.email) {
    console.log('[lead-emails] No email for lead, skipping welcome email');
    return { success: false, reason: 'no_email' };
  }

  // Check if lead is unsubscribed
  if (leadData.unsubscribed) {
    console.log(`[lead-emails] Lead ${leadData.email} is unsubscribed, skipping`);
    return { success: false, reason: 'unsubscribed' };
  }

  try {
    // Multi-format request: user selected 2+ formats in the modal
    if (leadData.multi_format === 'Yes' && leadData.all_formats) {
      const result = await sendEmailMultiYTT(leadData, tokenData);
      if (result && result.success) {
        await logWelcomeEmail(leadData.email, result.subject || 'Multi-format welcome email');
      }
      return result;
    }

    let result;
    switch (action) {
      case 'lead_schedule_4w':
      case 'lead_schedule_4w-apr':
        result = await sendEmail4wYTT(leadData, tokenData);
        break;
      case 'lead_schedule_4w-jul':
        result = await sendEmail4wJulyYTT(leadData, tokenData);
        break;
      case 'lead_schedule_8w':
        result = await sendEmail8wYTT(leadData, tokenData);
        break;
      case 'lead_schedule_18w':
      case 'lead_schedule_18w-mar':
        result = await sendEmail18wYTT(leadData, tokenData);
        break;
      case 'lead_schedule_18w-aug':
        result = await sendEmail18wAugYTT(leadData, tokenData);
        break;
      case 'lead_schedule_multi':
        result = await sendEmailMultiYTT(leadData, tokenData);
        break;
      case 'lead_schedule_300h':
        result = await sendEmail300hYTT(leadData);
        break;
      case 'lead_schedule_50h':
      case 'lead_schedule_30h':
        result = await sendEmailSpecialtyYTT(leadData);
        break;
      case 'lead_courses':
        result = await sendEmailCourses(leadData);
        break;
      case 'lead_mentorship':
        result = await sendEmailMentorship(leadData);
        break;
      case 'lead_undecided':
        result = await sendEmailUndecidedYTT(leadData, tokenData);
        break;
      case 'lead_meta':
        result = await sendEmailGeneric(leadData);
        break;
      case 'contact':
        result = await sendEmailGeneric(leadData);
        break;
      default:
        result = await sendEmailGeneric(leadData);
        break;
    }

    // Log to email_log
    if (result && result.success) {
      await logWelcomeEmail(leadData.email, result.subject || 'Welcome email');
    }

    return result;
  } catch (err) {
    console.error('[lead-emails] sendWelcomeEmail error:', err.message);
    return { success: false, error: err.message };
  }
}

async function logWelcomeEmail(to, subject) {
  try {
    const db = getDb();
    await db.collection('email_log').add({
      to,
      subject,
      template_id: 'auto_welcome',
      sent_at: new Date(),
      status: 'sent'
    });
  } catch (err) {
    console.error('[lead-emails] Failed to log welcome email:', err.message);
  }
}

// =========================================================================
// 4-Week YTT Email
// =========================================================================

async function sendEmail4wYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '4-Week Intensive YTT';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', her er alle datoer til 4-ugers yogauddannelsen';

  const isFebruary = program.toLowerCase().includes('feb');
  const fullPrice = isFebruary ? '20.750' : '23.750';
  const remaining = isFebruary ? '17.000' : '20.000';
  const discountNote = isFebruary ? ' (inkl. 3.000 kr. early bird-rabat)' : '';
  const rateNote = 'fleksibel ratebetaling';

  const scheduleUrl = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk/skema/4-uger/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk/skema/4-uger/';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>4-ugers intensive 200-timers yogal\u00e6reruddannelse</strong>.</p>';
  bodyHtml += '<p>Her finder du alle tr\u00e6ningsdage og tidspunkter for uddannelsen:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis, hvad der sker hver dag i de 4 uger.</p>';

  bodyHtml += '<p style="margin-top:16px;">Det intensive format er til dig, der vil fordybe dig fuldt ud. P\u00e5 4 uger gennemf\u00f8rer du hele certificeringen med daglig tr\u00e6ning og teori \u2014 mange af vores dimittender fort\u00e6ller, at det intensive format hjalp dem med at l\u00e6re mere, fordi de var 100% dedikerede.</p>';
  bodyHtml += programHighlightsHtml();
  bodyHtml += '<p style="margin-top:12px;">Vi har uddannet yogal\u00e6rere siden 2014, og vores dimittender underviser i hele Europa og videre. Kan du ikke m\u00f8de op en dag, tilbyder vi online backup p\u00e5 udvalgte workshops.</p>';

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);

  bodyHtml += '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
  bodyHtml += '<strong>Pris:</strong> ' + fullPrice + ' kr.' + discountNote + '<br>';
  bodyHtml += '<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>';
  bodyHtml += '<strong>Rest:</strong> ' + remaining + ' kr. (' + rateNote + ')';
  bodyHtml += '</div>';

  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-4-weeks-intensive-programs" style="color:#f75c03;">L\u00e6s mere om 4-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  // Plain text
  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 4-ugers intensive 200-timers yogal\u00e6reruddannelse.\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl + '\n\n';
  bodyPlain += programHighlightsPlain();
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\nPris: ' + fullPrice + ' kr.' + discountNote + '\nForberedelsesfasen: 3.750 kr.\nRest: ' + remaining + ' kr. (' + rateNote + ')\n\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// 4-Week July (Vinyasa Plus) YTT Email
// =========================================================================

async function sendEmail4wJulyYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', her er alle datoer til 4-ugers Vinyasa Plus yogauddannelsen (juli)';

  const fullPrice = '23.750';
  const remaining = '20.000';
  const rateNote = 'fleksibel ratebetaling';

  const scheduleUrl = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk/skema/4-uger-juli/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk/skema/4-uger-juli/';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>4-ugers Vinyasa Plus yogal\u00e6reruddannelse</strong> (juli 2026).</p>';
  bodyHtml += '<p>Her finder du alle tr\u00e6ningsdage og tidspunkter for uddannelsen:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis, hvad der sker hver dag i de 4 uger.</p>';

  bodyHtml += '<div style="margin:16px 0;padding:14px;background:#FFF7ED;border-left:3px solid #f75c03;border-radius:6px;">';
  bodyHtml += '<strong style="color:#c2410c;">Vinyasa Plus \u2014 hvad g\u00f8r dette hold s\u00e6rligt?</strong><br><br>';
  bodyHtml += '<strong>70% Vinyasa Flow:</strong> Kreativ sekvensering, klasseledelse og avancerede undervisningsteknikker<br>';
  bodyHtml += '<strong>30% Yin Yoga + Hot Yoga:</strong> Restitution, dybe stræk og undervisning i opvarmet milj\u00f8<br><br>';
  bodyHtml += 'Du bliver certificeret til at undervise b\u00e5de opvarmede og ikke-opvarmede Vinyasa-klasser samt Yin Yoga.';
  bodyHtml += '</div>';

  bodyHtml += programHighlightsHtml();

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);

  bodyHtml += '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
  bodyHtml += '<strong>Pris:</strong> ' + fullPrice + ' kr.<br>';
  bodyHtml += '<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>';
  bodyHtml += '<strong>Rest:</strong> ' + remaining + ' kr. (' + rateNote + ')';
  bodyHtml += '</div>';

  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-4-weeks-intensive-programs" style="color:#f75c03;">L\u00e6s mere om 4-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  // Plain text
  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 4-ugers Vinyasa Plus yogal\u00e6reruddannelse (juli 2026).\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl + '\n\n';
  bodyPlain += 'VINYASA PLUS \u2014 hvad g\u00f8r dette hold s\u00e6rligt?\n';
  bodyPlain += '70% Vinyasa Flow: Kreativ sekvensering, klasseledelse og undervisningsteknikker\n';
  bodyPlain += '30% Yin Yoga + Hot Yoga: Restitution og undervisning i opvarmet milj\u00f8\n\n';
  bodyPlain += programHighlightsPlain();
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\nPris: ' + fullPrice + ' kr.\nForberedelsesfasen: 3.750 kr.\nRest: ' + remaining + ' kr. (' + rateNote + ')\n\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// 8-Week YTT Email
// =========================================================================

async function sendEmail8wYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '8-Week Semi-Intensive YTT';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', her er alle datoer til 8-ugers yogauddannelsen';

  const scheduleUrl8w = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk/skema/8-uger/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk/skema/8-uger/';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>8-ugers semi-intensive 200-timers yogal\u00e6reruddannelse</strong>.</p>';

  bodyHtml += '<p>Her finder du alle 22 workshopdatoer og tidspunkter:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl8w + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis, hvad der sker hver dag i de 8 uger.</p>';

  bodyHtml += '<p style="margin-top:16px;">8-ugers formatet giver en god balance: nok intensitet til at holde fokus og g\u00f8re reelle fremskridt, men stadig plads til arbejde, familie eller andre forpligtelser. Det er et popul\u00e6rt valg for dem, der gerne vil have en dyb oplevelse uden at s\u00e6tte hele livet p\u00e5 pause.</p>';
  bodyHtml += programHighlightsHtml(['Online backup hvis du ikke kan m\u00f8de op en dag']);
  bodyHtml += alumniNote();

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'fleksibel ratebetaling');
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs" style="color:#f75c03;">L\u00e6s mere om 8-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 8-ugers semi-intensive 200-timers yogal\u00e6reruddannelse.\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl8w + '\n\n';
  bodyPlain += programHighlightsPlain(['Online backup hvis du ikke kan m\u00f8de op']);
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\n' + getPricingSectionPlain('23.750', '3.750', '20.000', 'fleksibel ratebetaling') + '\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain,
  });
  return { ...result, subject };
}

// =========================================================================
// 18-Week YTT Email
// =========================================================================

async function sendEmail18wYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '18-Week Flexible YTT';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', uddannelsen er netop startet \u2014 tilmeld dig stadig denne uge';

  const scheduleUrl18w = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk/skema/18-uger/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk/skema/18-uger/';

  // Started + last-minute discount banner
  const startedBannerHtml =
    '<div style="margin-bottom:20px;padding:14px 16px;background:#FFF7ED;border-left:3px solid #f75c03;border-radius:6px;">' +
    '<p style="margin:0 0 8px;"><strong style="color:#c2410c;">\ud83c\udf1f Uddannelsen er netop g\u00e5et i gang \u2014 og du kan stadig n\u00e5 med denne uge.</strong></p>' +
    '<p style="margin:0;color:#444;">Intromodulerne er allerede afholdt, men vi har dem p\u00e5 optagelse \u2014 s\u00e5 du nemt kan indhente det p\u00e5 ingen tid. Som tak for din hurtige beslutning f\u00e5r du <strong style="color:#c2410c;">1.000 kr. i last-minute-rabat</strong>.</p>' +
    '</div>';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>18-ugers fleksible yogal\u00e6reruddannelse</strong>.</p>';
  bodyHtml += startedBannerHtml;

  bodyHtml += '<p>Her finder du alle datoer og tidspunkter for uddannelsen:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl18w + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis hvilke dage der er hverdagshold og weekendhold.</p>';

  bodyHtml += programHighlightsHtml([
    'V\u00e6lg hverdags- eller weekendspor \u2014 og skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op en dag',
    '60 yogaklasser i studiet inkluderet'
  ]);

  bodyHtml += '<p style="margin-top:12px;">Det, der g\u00f8r dette program unikt, er fleksibiliteten. Hver workshop k\u00f8rer to gange \u2014 \u00e9n p\u00e5 en hverdag og \u00e9n i weekenden \u2014 s\u00e5 du altid kan f\u00f8lge med, uanset hvad din uge ser ud.</p>';
  bodyHtml += '<p style="margin-top:12px;">Holdet er <strong>netop g\u00e5et i gang</strong>, og vi holder holdene sm\u00e5 for at sikre personlig feedback. <strong>Der er kun f\u00e5 pladser tilbage</strong> \u2014 og last-minute-rabatten g\u00e6lder kun denne uge.</p>';

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">' +
    '<strong>Normalpris:</strong> <span style="text-decoration:line-through;color:#999;">23.750 kr.</span> &rarr; <strong style="color:#166534;">22.750 kr.</strong> med last-minute-rabat<br>' +
    '<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>' +
    '<strong>Rest:</strong> 19.000 kr. (fleksibel ratebetaling)' +
    '</div>';
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-18-weeks-flexible-programs" style="color:#f75c03;">L\u00e6s mere om 18-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 18-ugers fleksible yogal\u00e6reruddannelse.\n\n';
  bodyPlain += '\ud83c\udf1f UDDANNELSEN ER NETOP G\u00c5ET I GANG \u2014 DU KAN STADIG N\u00c5 MED DENNE UGE\n\n';
  bodyPlain += 'Intromodulerne er allerede afholdt, men vi har dem p\u00e5 optagelse \u2014 s\u00e5 du nemt kan indhente det.\n';
  bodyPlain += 'Som tak for din hurtige beslutning f\u00e5r du 1.000 kr. i last-minute-rabat.\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl18w + '\n\n';
  bodyPlain += programHighlightsPlain([
    'V\u00e6lg hverdags- eller weekendspor \u2014 skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op',
    '60 yogaklasser inkluderet'
  ]);
  bodyPlain += '\nDet unikke er fleksibiliteten: hver workshop k\u00f8rer to gange, \u00e9n hverdag og \u00e9n weekend.\n\n';
  bodyPlain += 'Holdet er netop g\u00e5et i gang. Kun f\u00e5 pladser tilbage \u2014 last-minute-rabatten g\u00e6lder kun denne uge.\n\n';
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += 'Normalpris: 23.750 kr. \u2014 din pris med last-minute-rabat: 22.750 kr.\n';
  bodyPlain += 'Forberedelsesfasen: 3.750 kr. \u00b7 Rest: 19.000 kr. (fleksibel ratebetaling)\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-18-weeks-flexible-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain,
  });
  return { ...result, subject };
}

// =========================================================================
// 18-Week Flexible YTT — August–December 2026
// =========================================================================

async function sendEmail18wAugYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', dit skema til efter\u00e5rets 18-ugers program er klar';

  const scheduleUrl18wAug = tokenData.leadId && tokenData.token
    ? 'https://www.yogabible.dk/skema/18-uger-august/?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : 'https://www.yogabible.dk/skema/18-uger-august/';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>18-ugers fleksible yogal\u00e6reruddannelse</strong> \u2014 efter\u00e5rsholdet august\u2013december 2026.</p>';

  bodyHtml += '<p>Her finder du alle datoer og tidspunkter for uddannelsen:</p>';
  bodyHtml += '<p style="margin:20px 0;"><a href="' + scheduleUrl18wAug + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:600;font-size:16px;">Se skemaet \u2192</a></p>';
  bodyHtml += '<p style="font-size:14px;color:#666;">Du kan tilf\u00f8je alle datoer direkte til din kalender \u2014 og se pr\u00e6cis hvilke dage der er hverdagshold og weekendhold.</p>';

  bodyHtml += programHighlightsHtml([
    'V\u00e6lg hverdags- eller weekendspor \u2014 og skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op en dag',
    '60 yogaklasser i studiet inkluderet',
    'Start: 10. august 2026 \u00b7 Graduation: 13. december 2026'
  ]);

  bodyHtml += '<p style="margin-top:12px;">Det, der g\u00f8r dette program unikt, er fleksibiliteten. Hver workshop k\u00f8rer to gange \u2014 \u00e9n p\u00e5 en hverdag og \u00e9n i weekenden \u2014 s\u00e5 du altid kan f\u00f8lge med, uanset hvad din uge ser ud.</p>';
  bodyHtml += '<p style="margin-top:12px;">Holdene er sm\u00e5 (max 12 studerende) for at sikre personlig feedback og n\u00e6rv\u00e6rende undervisning. <strong>Tilmeld dig tidligt</strong> \u2014 pladser fyldes.</p>';

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">' +
    '<strong>Pris:</strong> 23.750 kr.<br>' +
    '<strong>Forberedelsesfasen:</strong> 3.750 kr. sikrer din plads<br>' +
    '<strong>Rest:</strong> 20.000 kr. (fleksibel ratebetaling)' +
    '</div>';
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-18-weeks-flexible-programs" style="color:#f75c03;">L\u00e6s mere om 18-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 18-ugers fleksible yogal\u00e6reruddannelse \u2014 efter\u00e5rsholdet august\u2013december 2026.\n\n';
  bodyPlain += 'Uddannelsesskema og datoer:\n' + scheduleUrl18wAug + '\n\n';
  bodyPlain += programHighlightsPlain([
    'V\u00e6lg hverdags- eller weekendspor \u2014 skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op',
    '60 yogaklasser inkluderet',
    'Start: 10. august 2026 \u00b7 Graduation: 13. december 2026'
  ]);
  bodyPlain += '\nDet unikke er fleksibiliteten: hver workshop k\u00f8rer to gange, \u00e9n hverdag og \u00e9n weekend.\n\n';
  bodyPlain += 'Max 12 studerende pr. hold. Tilmeld dig tidligt.\n\n';
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += 'Pris: 23.750 kr.\n';
  bodyPlain += 'Forberedelsesfasen: 3.750 kr. \u00b7 Rest: 20.000 kr. (fleksibel ratebetaling)\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-18-weeks-flexible-programs\n';
  bodyPlain += 'Book infom\u00f8de: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain,
  });
  return { ...result, subject };
}

// =========================================================================
// Multi-Format YTT Email (user requested 2–3 formats at once)
// =========================================================================

async function sendEmailMultiYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const formats = (leadData.all_formats || '').split(',').filter(f => f);

  const scheduleBase = tokenData.leadId && tokenData.token
    ? '?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : '';

  const FORMAT_INFO = {
    '18w': {
      name: '18-ugers fleksible program (for\u00e5r)',
      period: 'marts\u2013juni 2026',
      desc: 'Det mest fleksible format \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Perfekt hvis du har arbejde, studie eller familie ved siden af.',
      url: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/18-uger/' + scheduleBase,
      programType: '18-week'
    },
    '18w-mar': {
      name: '18-ugers fleksible program (for\u00e5r)',
      period: 'marts\u2013juni 2026',
      desc: 'For\u00e5rsholdet \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Perfekt hvis du har arbejde, studie eller familie ved siden af.',
      url: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/18-uger/' + scheduleBase,
      programType: '18-week'
    },
    '18w-aug': {
      name: '18-ugers fleksible program (efter\u00e5r)',
      period: 'august\u2013december 2026',
      desc: 'Efter\u00e5rsholdet \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Start 10. august, graduation 13. december.',
      url: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/18-uger-august/' + scheduleBase,
      programType: '18-week'
    },
    '8w': {
      name: '8-ugers semi-intensive program',
      period: 'maj\u2013juni 2026',
      desc: 'En god balance mellem intensitet og hverdagsliv. Nok fokus til reelle fremskridt, men stadig plads til andre forpligtelser.',
      url: 'https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/8-uger/' + scheduleBase,
      programType: '8-week'
    },
    '4w': {
      name: '4-ugers intensive program (april)',
      period: 'april 2026',
      desc: 'Fuldt fordybende \u2014 daglig tr\u00e6ning og teori i 4 uger. Complete Program: Hatha, Vinyasa, Yin, Hot Yoga og Meditation.',
      url: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger/' + scheduleBase,
      programType: '4-week'
    },
    '4w-apr': {
      name: '4-ugers Complete Program (april)',
      period: 'april 2026',
      desc: 'Fuldt fordybende \u2014 daglig tr\u00e6ning og teori i 4 uger. Hatha, Vinyasa, Yin, Hot Yoga og Meditation.',
      url: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger/' + scheduleBase,
      programType: '4-week'
    },
    '4w-jul': {
      name: '4-ugers Vinyasa Plus (juli)',
      period: 'juli 2026',
      desc: '70% Vinyasa Flow \u2014 kreativ sekvensering, klasseledelse og undervisningsteknikker. Plus 30% Yin Yoga + Hot Yoga. Underviser opvarmede og ikke-opvarmede klasser.',
      url: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger-juli/' + scheduleBase,
      programType: '4-week'
    }
  };

  // Build Danish format list with "og" before last item
  const formatNames = formats.map(f => (FORMAT_INFO[f] || {}).name || f);
  let formatList;
  if (formatNames.length > 1) {
    formatList = formatNames.slice(0, -1).join(', ') + ' og ' + formatNames[formatNames.length - 1];
  } else {
    formatList = formatNames[0] || '';
  }

  const subject = firstName + ', dine YTT-skemaer er klar';

  // ---- HTML ----
  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>200-timers yogal\u00e6reruddannelse</strong>!</p>';

  bodyHtml += '<p>Jeg kan se, at du gerne vil sammenligne vores <strong>' + escapeHtml(formatList) + '</strong>. ';
  bodyHtml += 'Godt t\u00e6nkt \u2014 herunder finder du skemaer og datoer for hvert format.</p>';

  // Comparison prompt box
  bodyHtml += '<div style="margin:20px 0;padding:14px;background:#E3F2FD;border-radius:6px;border-left:3px solid #1976D2;">';
  bodyHtml += '<strong style="color:#1565C0;">\ud83d\udcad Et hurtigt sp\u00f8rgsm\u00e5l:</strong><br>';
  bodyHtml += 'Jeg kan se du sammenligner flere formater. Er det fordi du har arbejde, studie eller andre forpligtelser, der p\u00e5virker hvilken form der passer bedst?<br><br>';
  bodyHtml += '<span style="color:#666;">Svar gerne p\u00e5 denne e-mail \u2014 s\u00e5 hj\u00e6lper jeg dig med at finde det perfekte match!</span>';
  bodyHtml += '</div>';

  // Format descriptions
  bodyHtml += '<p style="margin-top:20px;"><strong>Her er en oversigt over de formater du valgte:</strong></p>';
  formats.forEach(f => {
    const info = FORMAT_INFO[f];
    if (!info) return;
    bodyHtml += '<div style="margin:12px 0;padding:12px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
    bodyHtml += '<strong>' + escapeHtml(info.name) + '</strong> <span style="color:#888;">(' + escapeHtml(info.period) + ')</span><br>';
    bodyHtml += '<span style="color:#555;">' + info.desc + '</span><br>';
    if (info.scheduleUrl) {
      bodyHtml += '<p style="margin:10px 0 4px;"><a href="' + info.scheduleUrl + '" style="display:inline-block;background:#f75c03;color:#fff;padding:8px 18px;text-decoration:none;border-radius:50px;font-weight:600;font-size:14px;">Se dit skema \u2192</a></p>';
    }
    bodyHtml += '<a href="' + info.url + '" style="color:#f75c03;font-size:13px;">L\u00e6s mere om programmet \u2192</a>';
    bodyHtml += '</div>';
  });

  bodyHtml += programHighlightsHtml();
  bodyHtml += alumniNote();

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'samme pris for alle formater \u2014 fleksibel ratebetaling');

  // Preparation Phase — single block that covers all formats
  bodyHtml += '<div style="margin-top:20px;padding:16px;background:#F0FDF4;border-left:3px solid #22C55E;border-radius:4px;">';
  bodyHtml += '<strong style="color:#166534;">\ud83d\udca1 Smart tr\u00e6k: Start forberedelsesfasen nu</strong><br><br>';
  bodyHtml += 'De fleste studerende starter med forberedelsesfasen allerede nu \u2014 og det er der en god grund til:<br><br>';
  bodyHtml += '\u2705 \u00d8jeblikkelig adgang til alle yogaklasser i studiet<br>';
  bodyHtml += '\u2705 Opbyg styrke, fleksibilitet og rutine inden uddannelsesstart<br>';
  bodyHtml += '\u2705 M\u00f8d dine kommende medstuderende i et afslappet milj\u00f8<br>';
  bodyHtml += '\u2705 Dine klasser t\u00e6ller med i dine tr\u00e6ningstimer<br><br>';
  bodyHtml += '<a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="display:inline-block;background:#f75c03;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">Start forberedelsesfasen \u2014 3.750 kr.</a>';
  bodyHtml += '</div>';

  // Links + compare
  bodyHtml += '<p style="margin-top:20px;">';
  formats.forEach(f => {
    const info = FORMAT_INFO[f];
    if (info) bodyHtml += '<a href="' + info.url + '" style="color:#f75c03;">' + escapeHtml(info.name.replace('program', 'detaljer')) + '</a> \u00b7 ';
  });
  bodyHtml += '<a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Sammenlign alle formater</a>';
  bodyHtml += '</p>';

  bodyHtml += '<p style="margin-top:20px;">Har du lyst til at se studiet eller f\u00e5 hj\u00e6lp til at v\u00e6lge det rigtige format?</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book infom\u00f8de eller samtale</a></p>';
  bodyHtml += '<p>Gl\u00e6der mig til at h\u00f8re fra dig!</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  // ---- Plain text ----
  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 200-timers yogal\u00e6reruddannelse!\n\n';
  bodyPlain += 'Jeg kan se du gerne vil sammenligne vores ' + formatList + '. ';
  bodyPlain += 'Herunder finder du skemaer og datoer for hvert format.\n\n';
  bodyPlain += 'Et hurtigt sp\u00f8rgsm\u00e5l: Er det fordi du har andre forpligtelser der p\u00e5virker dit valg? Svar gerne s\u00e5 jeg kan hj\u00e6lpe!\n\n';
  formats.forEach(f => {
    const info = FORMAT_INFO[f];
    if (info) {
      bodyPlain += '--- ' + info.name + ' (' + info.period + ') ---\n';
      bodyPlain += info.desc + '\n';
      if (info.scheduleUrl) bodyPlain += 'Skema og datoer: ' + info.scheduleUrl + '\n';
      bodyPlain += 'L\u00e6s mere: ' + info.url + '\n\n';
    }
  });
  bodyPlain += programHighlightsPlain();
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\n' + getPricingSectionPlain('23.750', '3.750', '20.000', 'samme pris for alle formater \u2014 fleksibel ratebetaling') + '\n';
  bodyPlain += '\nSmart tr\u00e6k: Start forberedelsesfasen nu (3.750 kr.)\n';
  bodyPlain += '- \u00d8jeblikkelig adgang til alle yogaklasser i studiet\n';
  bodyPlain += '- Opbyg styrke og rutine inden uddannelsesstart\n';
  bodyPlain += '- M\u00f8d dine kommende medstuderende\n';
  bodyPlain += '- Dine klasser t\u00e6ller med i dine tr\u00e6ningstimer\n';
  bodyPlain += 'Start her: https://www.yogabible.dk/om-200hrs-yogalreruddannelser\n\n';
  bodyPlain += 'Book infom\u00f8de eller samtale: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += 'Gl\u00e6der mig til at h\u00f8re fra dig!';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// Undecided YTT Email — lead chose "Ved ikke endnu" on the program question
// Showcases all available program formats with descriptions + comparison links
// =========================================================================

async function sendEmailUndecidedYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';

  const scheduleBase = tokenData.leadId && tokenData.token
    ? '?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token)
    : '';

  const subject = firstName + ', find dit perfekte yogauddannelsesformat';

  // ---- HTML ----
  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>200-timers yogalæreruddannelse</strong>!</p>';
  bodyHtml += '<p>Det er helt normalt ikke at vide, hvilket format der passer bedst \u2014 det afhænger af din hverdag, dine mål og din læringsstil. Lad mig give dig et overblik, så du lettere kan vælge.</p>';

  // Intro box
  bodyHtml += '<div style="margin:20px 0;padding:14px;background:#E3F2FD;border-radius:6px;border-left:3px solid #1976D2;">';
  bodyHtml += '<strong style="color:#1565C0;">💡 Alle formater giver dig det samme certifikat</strong><br>';
  bodyHtml += 'Uanset hvilket format du vælger, får du en <strong>200-timers Yoga Alliance-certificering</strong> med samme pensum: Hatha, Vinyasa, Yin, Hot Yoga, Meditation, anatomi, filosofi og undervisningsmetodik. Max 12 studerende pr. hold.';
  bodyHtml += '</div>';

  // Format cards
  const formats = [
    {
      name: '4-ugers intensiv',
      period: 'April 2026',
      emoji: '🔥',
      desc: 'Fuldt fordybende daglig træning i 4 uger. Det mest intense format \u2014 perfekt hvis du kan sætte alt andet på pause og vil have den dybeste oplevelse.',
      goodFor: 'Dig der vil have en komplet immersion og kan dedikere 4 uger fuld tid.',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger/' + scheduleBase,
      pageUrl: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs'
    },
    {
      name: '8-ugers semi-intensiv',
      period: 'Maj\u2013Juni 2026',
      emoji: '⚡',
      desc: 'En god balance mellem intensitet og hverdagsliv. Nok fokus til reelle fremskridt, men stadig plads til arbejde eller studie ved siden af.',
      goodFor: 'Dig der vil have fokuseret uddannelse men har brug for lidt mere tid end 4 uger.',
      scheduleUrl: 'https://www.yogabible.dk/skema/8-uger/' + scheduleBase,
      pageUrl: 'https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs'
    },
    {
      name: '4-ugers Vinyasa Plus',
      period: 'Juli 2026',
      emoji: '🌊',
      desc: '70% Vinyasa Flow \u2014 kreativ sekvensering, klasseledelse og avancerede undervisningsteknikker. Plus 30% Yin Yoga + Hot Yoga. For dig der brænder for Vinyasa.',
      goodFor: 'Dig der allerede ved du vil specialisere dig i Vinyasa Flow.',
      scheduleUrl: 'https://www.yogabible.dk/skema/4-uger-juli/' + scheduleBase,
      pageUrl: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs'
    },
    {
      name: '18-ugers fleksibel',
      period: 'August\u2013December 2026',
      emoji: '🧘',
      desc: 'Det mest fleksible format \u2014 vælg hverdags- eller weekendspor og skift frit undervejs. Perfekt hvis du har arbejde, studie eller familie ved siden af. 60 yogaklasser inkluderet.',
      goodFor: 'Dig der vil tage uddannelsen uden at sætte hverdagen på pause.',
      scheduleUrl: 'https://www.yogabible.dk/skema/18-uger-august/' + scheduleBase,
      pageUrl: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs'
    }
  ];

  bodyHtml += '<p style="margin-top:24px;"><strong>Her er dine muligheder:</strong></p>';

  formats.forEach(f => {
    bodyHtml += '<div style="margin:16px 0;padding:16px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
    bodyHtml += '<strong style="font-size:17px;">' + f.emoji + ' ' + escapeHtml(f.name) + '</strong> <span style="color:#888;">(' + escapeHtml(f.period) + ')</span><br>';
    bodyHtml += '<span style="color:#555;">' + f.desc + '</span><br><br>';
    bodyHtml += '<span style="color:#166534;font-size:14px;"><strong>God til:</strong> ' + f.goodFor + '</span><br>';
    bodyHtml += '<p style="margin:10px 0 4px;">';
    bodyHtml += '<a href="' + f.scheduleUrl + '" style="display:inline-block;background:#f75c03;color:#fff;padding:8px 18px;text-decoration:none;border-radius:50px;font-weight:600;font-size:14px;">Se skema og datoer \u2192</a>';
    bodyHtml += ' <a href="' + f.pageUrl + '" style="color:#f75c03;font-size:13px;margin-left:12px;">Læs mere \u2192</a>';
    bodyHtml += '</p></div>';
  });

  // Compare link
  bodyHtml += '<div style="margin:24px 0;padding:16px;background:#F5F3F0;border-radius:6px;text-align:center;">';
  bodyHtml += '<p style="margin:0 0 10px;"><strong>Stadig i tvivl?</strong></p>';
  bodyHtml += '<a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="display:inline-block;background:#1a1a1a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Sammenlign alle formater side om side \u2192</a>';
  bodyHtml += '</div>';

  // Pricing — same for all formats
  bodyHtml += programHighlightsHtml();
  bodyHtml += alumniNote();

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'samme pris for alle formater \u2014 fleksibel ratebetaling');
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/om-200hrs-yogalreruddannelser');

  // Meeting CTA
  bodyHtml += '<p style="margin-top:24px;">Det bedste du kan gøre nu? <strong>Book et gratis infomøde</strong> \u2014 så hjælper jeg dig personligt med at finde det rigtige format:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book et gratis infomøde</a></p>';
  bodyHtml += '<p>Du er også velkommen til bare at svare på denne e-mail med dine spørgsmål.</p>';
  bodyHtml += '<p>Glæder mig til at høre fra dig!</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  // ---- Plain text ----
  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak for din interesse i vores 200-timers yogalæreruddannelse!\n\n';
  bodyPlain += 'Det er helt normalt ikke at vide, hvilket format der passer bedst. Her er et overblik:\n\n';
  bodyPlain += 'Alle formater giver dig det samme 200-timers Yoga Alliance-certifikat med samme pensum. Max 12 studerende pr. hold.\n\n';

  formats.forEach(f => {
    bodyPlain += '--- ' + f.name + ' (' + f.period + ') ---\n';
    bodyPlain += f.desc + '\n';
    bodyPlain += 'God til: ' + f.goodFor + '\n';
    bodyPlain += 'Skema: ' + f.scheduleUrl + '\n';
    bodyPlain += 'Læs mere: ' + f.pageUrl + '\n\n';
  });

  bodyPlain += 'Sammenlign alle formater: https://www.yogabible.dk/om-200hrs-yogalreruddannelser\n\n';
  bodyPlain += programHighlightsPlain();
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\n' + getPricingSectionPlain('23.750', '3.750', '20.000', 'samme pris for alle formater — fleksibel ratebetaling') + '\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/om-200hrs-yogalreruddannelser');
  bodyPlain += '\nBook et gratis infomøde: ' + CONFIG.MEETING_LINK + '\n';
  bodyPlain += 'Du kan også svare på denne e-mail med dine spørgsmål.\n\nGlæder mig til at høre fra dig!';
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// 300h Advanced YTT Email
// =========================================================================

async function sendEmail300hYTT(leadData) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '300-Hour Advanced YTT';
  const subject = 'Din foresp\u00f8rgsel \u2014 300-timers avanceret yogal\u00e6reruddannelse';

  const attachment = await fetchSchedulePdfAttachment('300h', program);
  const hasSchedule = !!attachment;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>300-timers avancerede yogal\u00e6reruddannelse</strong> (24 uger, maj\u2013december 2026)!</p>';
  bodyHtml += '<p>Dette program er designet til certificerede yogal\u00e6rere, der \u00f8nsker at fordybe deres praksis og undervisning p\u00e5 h\u00f8jeste niveau.</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedh\u00e6ftet det fulde skema, s\u00e5 du kan se hvordan programmet er bygget op.</p>';
  } else {
    bodyHtml += '<p>Vi er ved at l\u00e6gge sidste h\u00e5nd p\u00e5 det detaljerede skema \u2014 jeg sender det til dig, s\u00e5 snart det er klar.</p>';
  }

  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en uforpligtende samtale</a></p>';
  bodyHtml += '<p>Du er ogs\u00e5 velkommen til at svare p\u00e5 denne e-mail med dine sp\u00f8rgsm\u00e5l.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores 300-timers avancerede yogal\u00e6reruddannelse (24 uger, maj\u2013december 2026)!\n\n';
  bodyPlain += hasSchedule ? 'Jeg har vedh\u00e6ftet det fulde skema.\n\n' : 'Det detaljerede skema er snart klar \u2014 jeg sender det til dig.\n\n';
  bodyPlain += 'Book en samtale: ' + CONFIG.MEETING_LINK + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain,
    attachments: attachment ? [attachment] : []
  });
  return { ...result, subject };
}

// =========================================================================
// Specialty YTT Email (50h, 30h)
// =========================================================================

async function sendEmailSpecialtyYTT(leadData) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || 'Specialty Teacher Training';
  const specialty = leadData.subcategories || '';
  const subject = 'Din foresp\u00f8rgsel \u2014 ' + program;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>' + escapeHtml(program) + '</strong>!</p>';
  if (specialty) bodyHtml += '<p>Du n\u00e6vnte interesse for: <strong>' + escapeHtml(specialty) + '</strong></p>';
  bodyHtml += '<p>Vores specialmoduler er perfekte for l\u00e6rere, der vil fordybe sig inden for specifikke omr\u00e5der.</p>';
  bodyHtml += '<p>Vi er ved at finalisere 2026-skemaet. Vil du vide mere?</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en uforpligtende samtale</a></p>';
  bodyHtml += '<p>Svar ogs\u00e5 gerne p\u00e5 denne e-mail med dine sp\u00f8rgsm\u00e5l.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  const bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores ' + program + '!\n\nBook en samtale: ' + CONFIG.MEETING_LINK + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// Courses Email
// =========================================================================

async function sendEmailCourses(leadData) {
  const firstName = leadData.first_name || '';
  const courses = leadData.program || '';
  const preferredMonth = leadData.preferred_month || leadData.cohort_label || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';

  const courseList = courses.split(/[,+]/).map(c => c.trim()).filter(c => c);
  const isBundle = courseList.length > 1;
  const subject = isBundle ? 'Dine kursus-detaljer \u2014 Yoga Bible' : 'Dit kursus \u2014 Yoga Bible';

  // Try to attach course schedule for preferred month
  const attachment = preferredMonth ? await fetchSchedulePdfAttachment('courses', preferredMonth) : null;
  const hasSchedule = !!attachment;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  if (isBundle) {
    bodyHtml += '<p>Tak for din interesse i vores kursusbundle! Du valgte:</p><ul style="margin:10px 0;padding-left:20px;">';
    courseList.forEach(course => {
      const config = COURSE_CONFIG[course] || {};
      bodyHtml += '<li><strong>' + escapeHtml(course) + '</strong>' + (config.description ? ' \u2014 ' + config.description : '') + '</li>';
    });
    bodyHtml += '</ul>';
    if (courseList.length === 2) bodyHtml += '<p><strong>Bundle-pris (2 kurser):</strong> 4.140 kr. (spar 10%!)</p>';
    else if (courseList.length === 3) bodyHtml += '<p><strong>All-In Bundle:</strong> 5.865 kr. (spar 15% + GRATIS 1-m\u00e5neds yogapas!)</p>';
  } else {
    bodyHtml += '<p>Tak for din interesse i vores <strong>' + escapeHtml(courses) + '</strong>-kursus!</p>';
    bodyHtml += '<p><strong>Pris:</strong> 2.300 kr.</p>';
  }

  if (preferredMonth) bodyHtml += '<p><strong>Foretrukken m\u00e5ned:</strong> ' + escapeHtml(preferredMonth) + '</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedh\u00e6ftet kursusskemaet for <strong>' + escapeHtml(preferredMonth) + '</strong>, s\u00e5 du kan se datoer og tidspunkter.</p>';
  } else if (preferredMonth) {
    bodyHtml += '<p>Vi er ved at l\u00e6gge sidste h\u00e5nd p\u00e5 kursusskemaet for ' + escapeHtml(preferredMonth) + '. Jeg sender det til dig, s\u00e5 snart det er klar.</p>';
  }

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);

  bodyHtml += '<p style="margin-top:16px;">Du kan tilmelde dig direkte p\u00e5 vores hjemmeside, eller book en kort samtale hvis du har sp\u00f8rgsm\u00e5l:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en samtale</a></p>';

  if (!isBundle && courseList.length === 1 && preferredMonth) {
    const paymentUrl = getCoursePaymentUrl(courseList[0], preferredMonth);
    if (paymentUrl) bodyHtml += '<p>Klar til at tilmelde dig? <a href="' + paymentUrl + '" style="color:#f75c03;font-weight:600;">Tilmeld dig her \u2192</a></p>';
  } else if (isBundle && preferredMonth) {
    const bundleUrl = getBundlePaymentUrl(courseList, preferredMonth);
    if (bundleUrl) bodyHtml += '<p>Klar til at tilmelde dig? <a href="' + bundleUrl + '" style="color:#f75c03;font-weight:600;">F\u00e5 din bundle her \u2192</a></p>';
  }

  bodyHtml += '<p>Svar gerne p\u00e5 denne e-mail hvis du har sp\u00f8rgsm\u00e5l!</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores kurser!\n\n';
  if (isBundle) {
    bodyPlain += 'Du valgte: ' + courseList.join(', ') + '\n';
    if (courseList.length === 2) bodyPlain += 'Bundle-pris (2 kurser): 4.140 kr. (spar 10%!)\n\n';
    else if (courseList.length === 3) bodyPlain += 'All-In Bundle: 5.865 kr. (spar 15% + GRATIS 1-måneds yogapas!)\n\n';
  } else {
    bodyPlain += 'Kursus: ' + courses + '\nPris: 2.300 kr.\n\n';
  }
  if (preferredMonth) bodyPlain += 'Foretrukken måned: ' + preferredMonth + '\n';
  if (hasSchedule) bodyPlain += 'Jeg har vedhæftet kursusskemaet for ' + preferredMonth + '.\n\n';
  else if (preferredMonth) bodyPlain += 'Kursusskemaet for ' + preferredMonth + ' er snart klar.\n\n';
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += 'Book en samtale: ' + CONFIG.MEETING_LINK;
  bodyPlain += getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain,
    attachments: attachment ? [attachment] : []
  });
  return { ...result, subject };
}

// =========================================================================
// Mentorship Email
// =========================================================================

async function sendEmailMentorship(leadData) {
  const firstName = leadData.first_name || '';
  const service = leadData.service || 'Mentorship';
  const subcategories = leadData.subcategories || '';
  const message = leadData.message || '';
  const subject = 'Din mentorship-foresp\u00f8rgsel \u2014 Yoga Bible';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>' + escapeHtml(service) + '</strong>-program!</p>';
  if (subcategories) bodyHtml += '<p><strong>Interesseomr\u00e5der:</strong> ' + escapeHtml(subcategories) + '</p>';
  if (message) bodyHtml += '<p><strong>Din besked:</strong> ' + escapeHtml(message) + '</p>';
  bodyHtml += '<p>Jeg vil gerne h\u00f8re mere om dine m\u00e5l. Lad os booke en kort samtale:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en gratis samtale</a></p>';
  bodyHtml += '<p>Du er ogs\u00e5 velkommen til at svare direkte p\u00e5 denne e-mail.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  const bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores ' + service + '-program!\n\nBook en gratis samtale: ' + CONFIG.MEETING_LINK + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// Generic / Contact Email
// =========================================================================

async function sendEmailGeneric(leadData) {
  const firstName = leadData.first_name || '';
  const subject = 'Tak for din henvendelse \u2014 Yoga Bible';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du tog kontakt til <strong>Yoga Bible</strong>!</p>';
  bodyHtml += '<p>Vi har modtaget din foresp\u00f8rgsel og vender tilbage snarest.</p>';
  bodyHtml += '<p>I mellemtiden:</p>';
  bodyHtml += '<ul style="margin:10px 0;padding-left:20px;">';
  bodyHtml += '<li>Book en samtale: <a href="' + CONFIG.MEETING_LINK + '" style="color:#f75c03;">Klik her</a></li>';
  bodyHtml += '<li>Bes\u00f8g vores hjemmeside: <a href="https://www.yogabible.dk" style="color:#f75c03;">yogabible.dk</a></li>';
  bodyHtml += '</ul>';
  bodyHtml += '<p>Du er velkommen til at svare p\u00e5 denne e-mail med sp\u00f8rgsm\u00e5l.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  const bodyPlain = 'Hej ' + firstName + ',\n\nTak fordi du tog kontakt til Yoga Bible!\n\nVi vender tilbage snarest.\n\nBook en samtale: ' + CONFIG.MEETING_LINK + '\nBes\u00f8g: https://www.yogabible.dk' + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(leadData.email);

  const result = await sendRawEmail({
    to: leadData.email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain
  });
  return { ...result, subject };
}

// =========================================================================
// Application Confirmation Email
// =========================================================================

async function sendApplicationConfirmation(email, applicationId, firstName) {
  const subject = 'Tak for din ansøgning — Yoga Bible';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName || '') + ',</p>';
  bodyHtml += '<p>Tak for din ansøgning til <strong>Yoga Bible</strong>!</p>';
  bodyHtml += '<p>Dit ansøgnings-ID er: <strong>' + escapeHtml(applicationId) + '</strong></p>';
  bodyHtml += '<p>Vi kigger din ansøgning igennem og vender tilbage med næste skridt.</p>';
  bodyHtml += '<p>Har du spørgsmål i mellemtiden? Svar bare på denne e-mail eller ring til os på <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a>.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(email);

  const bodyPlain = 'Hej ' + (firstName || '') + ',\n\nTak for din ansøgning til Yoga Bible!\n\nDit ansøgnings-ID er: ' + applicationId + '\n\nVi kigger din ansøgning igennem og vender tilbage.\n\nHar du spørgsmål? Svar på denne e-mail eller ring +45 53 88 12 09.' + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(email);

  const result = await sendRawEmail({
    to: email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain
  });

  await logWelcomeEmail(email, subject);
  return { ...result, subject };
}

// =========================================================================
// Careers Auto-Reply Email
// =========================================================================

async function sendCareersConfirmation(email, firstName, category, role) {
  const subject = 'Tak for din ansøgning — Yoga Bible Careers';

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName || '') + ',</p>';
  bodyHtml += '<p>Tak for din interesse i at blive en del af <strong>Yoga Bible</strong>-teamet!</p>';
  bodyHtml += '<p>Vi har modtaget din ansøgning' + (category ? ' inden for <strong>' + escapeHtml(category) + '</strong>' : '') + (role ? ' som <strong>' + escapeHtml(role) + '</strong>' : '') + '.</p>';
  bodyHtml += '<p>Vi gennemgår alle ansøgninger løbende og vender tilbage, hvis der er et match.</p>';
  bodyHtml += '<p>Har du spørgsmål? Svar bare på denne e-mail.</p>';
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(email);

  const bodyPlain = 'Hej ' + (firstName || '') + ',\n\nTak for din interesse i at blive en del af Yoga Bible-teamet!\n\nVi har modtaget din ansøgning' + (category ? ' inden for ' + category : '') + (role ? ' som ' + role : '') + '.\n\nVi gennemgår alle ansøgninger løbende og vender tilbage, hvis der er et match.\n\nHar du spørgsmål? Svar bare på denne e-mail.' + getEnglishNotePlain() + getSignaturePlain() + getUnsubscribeFooterPlain(email);

  const result = await sendRawEmail({
    to: email,
    subject,
    html: wrapHtml(bodyHtml),
    text: bodyPlain
  });

  await logWelcomeEmail(email, subject);
  return { ...result, subject };
}

module.exports = {
  sendWelcomeEmail,
  sendApplicationConfirmation,
  sendCareersConfirmation
};
