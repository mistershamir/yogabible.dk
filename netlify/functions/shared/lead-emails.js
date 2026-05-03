/**
 * Lead Welcome Emails — Yoga Bible
 * Auto-reply emails sent to leads after a 30-minute defer window.
 *
 * Style: plain-text feel. Just <p> tags, inline orange links, no boxes,
 * no buttons, no bullet lists. Resend's wrapHtml auto-appends the
 * standard signature + unsubscribe footer.
 *
 * Conventions:
 *   - Subject lines never include the lead's name (looks automated).
 *   - All info kept; conditional logic kept.
 *   - Refund language is forbidden everywhere (Prep Phase is non-refundable
 *     if student cancels; only mention refunds if a lead asks directly).
 */

const { CONFIG, COURSE_CONFIG, SCHEDULE_PDFS } = require('./config');
const {
  escapeHtml,
  getCoursePaymentUrl,
  getBundlePaymentUrl
} = require('./utils');
const { sendSingleViaResend } = require('./resend-service');
const { getDb } = require('./firestore');

const i18n = require('./lead-email-i18n');

// Form ID → language map (same as facebook-leads-webhook.js)
const FORM_LANG_MAP = {
  '827004866473769':  'en',     // july-vinyasa-plus-en (UK)
  '25716246641411656':'en',     // july-vinyasa-plus-no
  '4318151781759438': 'en',     // july-vinyasa-plus-se
  '2450631555377690': 'de',     // july-vinyasa-plus-de
  '1668412377638315': 'en',     // july-vinyasa-plus-fi
  '960877763097239':  'en',     // july-vinyasa-plus-nl
  '1344364364192542': 'da',     // july-vinyasa-plus-dk
  '961808297026346':  'da'      // general dk form (multi-program)
};

// =========================================================================
// Inline-link helper — keeps every <a> in one consistent shape
// =========================================================================
const ORANGE = 'style="color:#f75c03;"';
function link(url, text) {
  return '<a href="' + url + '" ' + ORANGE + '>' + text + '</a>';
}

// =========================================================================
// Localized Preparation Phase price (international leads)
// =========================================================================
function getLocalizedPrepPrice(country) {
  switch ((country || '').toUpperCase()) {
    case 'NO': return '3,750 DKK (approx. 5,400 NOK)';
    case 'SE': return '3,750 DKK (approx. 5,600 SEK)';
    case 'DE': case 'AT': case 'CH': return '3.750 DKK (ca. 500 EUR)';
    case 'FI': return '3,750 DKK (approx. 500 EUR)';
    case 'NL': return '3,750 DKK (approx. 500 EUR)';
    case 'UK': return '3,750 DKK (approx. £425)';
    case 'DK': return '3.750 kr.';
    default:   return '3,750 DKK (approx. 500 EUR)';
  }
}

// =========================================================================
// Tokenized schedule URL builder
// =========================================================================
function tokenize(url, tokenData) {
  if (!tokenData || !tokenData.leadId || !tokenData.token) return url;
  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  return url + sep + 'tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token);
}

// =========================================================================
// Schedule PDF attachment helper (300h + Courses)
// =========================================================================

function getSchedulePdfUrl(programType, program) {
  const urls = SCHEDULE_PDFS[programType];
  if (!urls) return '';

  const prog = (program || '').toLowerCase();
  for (const cohortKey of Object.keys(urls)) {
    if (cohortKey === 'default') continue;
    if (prog.includes(cohortKey.toLowerCase().split(' ')[0])) {
      return urls[cohortKey] || '';
    }
  }
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
    const filename = 'yoga-bible-schedule-' + programType + '.pdf';
    return { filename, content: buffer, contentType: 'application/pdf' };
  } catch (err) {
    console.error('[lead-emails] Failed to fetch schedule PDF for ' + programType + ':', err.message);
    return null;
  }
}

// =========================================================================
// Country-specific travel sentence (English / German Vinyasa Plus)
// =========================================================================
function travelSentenceEn(country) {
  switch ((country || '').toUpperCase()) {
    case 'NO': return 'Copenhagen is just a short flight from most Norwegian cities — many of our students fly in from Oslo, Bergen and Trondheim.';
    case 'SE': return 'Copenhagen is right next door — a quick flight from Stockholm, or just 30 minutes by train from Malmö.';
    case 'DE': case 'AT': return 'Copenhagen is well connected from all major German-speaking airports, with frequent direct flights.';
    case 'FI': return 'Direct flights from Helsinki to Copenhagen take under two hours.';
    case 'NL': return 'Copenhagen is just a short direct flight from Amsterdam and other Dutch airports.';
    case 'UK': return 'Copenhagen is just a short direct flight from most UK airports — many of our students fly in from London, Manchester and Edinburgh.';
    case 'DK': return '';
    default:   return 'Copenhagen has direct flight connections from most major European cities.';
  }
}

function travelSentenceDe(country) {
  switch ((country || '').toUpperCase()) {
    case 'DE': return 'Kopenhagen ist von allen großen deutschen Flughäfen gut erreichbar, mit regelmäßigen Direktflügen.';
    case 'AT': return 'Kopenhagen ist von Wien und anderen österreichischen Flughäfen leicht erreichbar, mit regelmäßigen Direktflügen.';
    case 'CH': return 'Kopenhagen ist von der Schweiz aus gut erreichbar, mit Direktflügen ab Zürich, Basel und Genf.';
    case 'DK': return '';
    default:   return 'Kopenhagen hat direkte Flugverbindungen von den meisten großen europäischen Städten.';
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

  if (leadData.unsubscribed) {
    console.log('[lead-emails] Lead ' + leadData.email + ' is unsubscribed, skipping');
    return { success: false, reason: 'unsubscribed' };
  }

  // Dedup: skip if a welcome email was sent to this address in the past 24h.
  // Catches retries from Meta webhooks and form double-submits.
  try {
    const db = getDb();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentWelcomeSnap = await db.collection('email_log')
      .where('to', '==', leadData.email.toLowerCase().trim())
      .where('template_id', '==', 'auto_welcome')
      .where('sent_at', '>=', twentyFourHoursAgo)
      .where('status', 'in', ['sent', 'pending'])
      .limit(1)
      .get();
    if (!recentWelcomeSnap.empty) {
      console.log('[lead-emails] Welcome already sent to ' + leadData.email + ' within 24h — skipping duplicate');
      return { success: true, reason: 'already_sent' };
    }
  } catch (dedupErr) {
    console.error('[lead-emails] Welcome dedup check failed (PROCEEDING with send):', dedupErr.message);
  }

  try {
    if (action === 'lead_waitlist_300h') {
      const result = await sendWaitlist300hEmail(leadData, tokenData);
      if (result && result.success) {
        await logWelcomeEmail(leadData.email, result.subject || 'Waitlist 300h email', (tokenData || {}).leadId);
      }
      return result;
    }

    const formLang = FORM_LANG_MAP[leadData.meta_form_id];
    const lang = (formLang || leadData.lang || leadData.meta_lang || 'da').toLowerCase().trim().substring(0, 2);
    const isDanish = ['da', 'dk'].includes(lang);
    const isGerman = lang === 'de';

    const programKeyMap = {
      'lead_schedule_4w': '4-week', 'lead_schedule_4w-apr': '4-week', 'lead_schedule_4w-jun': '4-week-jun',
      'lead_schedule_4w-jul': '4-week-jul', 'lead_schedule_8w': '8-week',
      'lead_schedule_18w': '18-week', 'lead_schedule_18w-mar': '18-week',
      'lead_schedule_18w-aug': '18-week-aug', 'lead_schedule_300h': '300h',
      'lead_schedule_50h': 'specialty', 'lead_schedule_30h': 'specialty'
    };

    if (isGerman) {
      let result;
      var isJulyActionDe = action === 'lead_schedule_4w-jul' ||
        (action === 'lead_meta' && leadData.type === 'ytt' && leadData.ytt_program_type === '4-week-jul');
      if (isJulyActionDe) {
        result = await sendJulyVinyasaPlusDeEmail(leadData, tokenData);
      } else if ((leadData.multi_format === 'Yes' && leadData.all_formats) || action === 'lead_schedule_multi') {
        result = await sendMultiFormatEmail(leadData, 'de', tokenData);
      } else if (action === 'lead_undecided') {
        result = await sendUndecidedEmail(leadData, 'de', tokenData);
      } else if (action === 'lead_courses') {
        result = await sendCoursesEmail(leadData, 'de', tokenData);
      } else if (action === 'lead_mentorship') {
        result = await sendMentorshipEmail(leadData, 'de', tokenData);
      } else if (programKeyMap[action]) {
        result = await sendProgramEmail(leadData, programKeyMap[action], 'de', tokenData);
      } else if (action === 'lead_meta' && leadData.type === 'ytt') {
        var metaKeyDe = leadData.ytt_program_type || '4-week';
        if (!i18n.PROGRAMS[metaKeyDe]) metaKeyDe = '4-week';
        result = await sendProgramEmail(leadData, metaKeyDe, 'de', tokenData);
      } else {
        result = await sendEmailGenericBilingual(leadData, 'de', tokenData);
      }
      if (result && result.success) {
        await logWelcomeEmail(leadData.email, result.subject || 'Welcome email (DE)', (tokenData || {}).leadId);
      }
      return result;
    }

    if (!isDanish) {
      let result;
      var isJulyActionEn = action === 'lead_schedule_4w-jul' ||
        (action === 'lead_meta' && leadData.type === 'ytt' && leadData.ytt_program_type === '4-week-jul');
      if (isJulyActionEn) {
        result = await sendJulyVinyasaPlusEnEmail(leadData, tokenData);
      } else if ((leadData.multi_format === 'Yes' && leadData.all_formats) || action === 'lead_schedule_multi') {
        result = await sendMultiFormatEmail(leadData, 'en', tokenData);
      } else if (action === 'lead_undecided') {
        result = await sendUndecidedEmail(leadData, 'en', tokenData);
      } else if (action === 'lead_courses') {
        result = await sendCoursesEmail(leadData, 'en', tokenData);
      } else if (action === 'lead_mentorship') {
        result = await sendMentorshipEmail(leadData, 'en', tokenData);
      } else if (programKeyMap[action]) {
        result = await sendProgramEmail(leadData, programKeyMap[action], 'en', tokenData);
      } else if (action === 'lead_meta' && leadData.type === 'ytt') {
        var metaKeyEn = leadData.ytt_program_type || '4-week';
        if (!i18n.PROGRAMS[metaKeyEn]) metaKeyEn = '4-week';
        result = await sendProgramEmail(leadData, metaKeyEn, 'en', tokenData);
      } else {
        result = await sendEmailGenericBilingual(leadData, 'en', tokenData);
      }
      if (result && result.success) {
        await logWelcomeEmail(leadData.email, result.subject || 'Welcome email (EN)', (tokenData || {}).leadId);
      }
      return result;
    }

    // Danish lead
    if (leadData.multi_format === 'Yes' && leadData.all_formats) {
      const result = await sendEmailMultiYTT(leadData, tokenData);
      if (result && result.success) {
        await logWelcomeEmail(leadData.email, result.subject || 'Multi-format welcome email', (tokenData || {}).leadId);
      }
      return result;
    }

    let result;
    switch (action) {
      case 'lead_schedule_4w':
      case 'lead_schedule_4w-apr':
        result = await sendEmail4wYTT(leadData, tokenData); break;
      case 'lead_schedule_4w-jun':
        result = await sendEmail4wJuneYTT(leadData, tokenData); break;
      case 'lead_schedule_4w-jul':
        result = await sendJulyVinyasaPlusDaEmail(leadData, tokenData); break;
      case 'lead_schedule_8w':
        result = await sendEmail8wYTT(leadData, tokenData); break;
      case 'lead_schedule_18w':
      case 'lead_schedule_18w-mar':
        result = await sendEmail18wYTT(leadData, tokenData); break;
      case 'lead_schedule_18w-aug':
        result = await sendEmail18wAugYTT(leadData, tokenData); break;
      case 'lead_schedule_multi':
        result = await sendEmailMultiYTT(leadData, tokenData); break;
      case 'lead_schedule_300h':
        result = await sendEmail300hYTT(leadData, tokenData); break;
      case 'lead_schedule_50h':
      case 'lead_schedule_30h':
        result = await sendEmailSpecialtyYTT(leadData, tokenData); break;
      case 'lead_courses':
        result = await sendEmailCourses(leadData, tokenData); break;
      case 'lead_mentorship':
        result = await sendEmailMentorship(leadData, tokenData); break;
      case 'lead_undecided':
        result = await sendEmailUndecidedYTT(leadData, tokenData); break;
      case 'lead_meta':
      case 'contact':
      default:
        result = await sendEmailGeneric(leadData, tokenData); break;
    }

    if (result && result.success) {
      await logWelcomeEmail(leadData.email, result.subject || 'Welcome email', (tokenData || {}).leadId);
      if (tokenData && tokenData.leadId) {
        const db = getDb();
        db.collection('leads').doc(tokenData.leadId).update({
          welcome_email_sent_at: new Date(),
          'email_engagement.welcome_sent_at': new Date()
        }).catch(() => {});
      }
    }
    return result;
  } catch (err) {
    console.error('[lead-emails] sendWelcomeEmail error:', err.message);
    return { success: false, error: err.message };
  }
}

async function logWelcomeEmail(to, subject, leadId) {
  try {
    const db = getDb();
    await db.collection('email_log').add({
      to,
      subject,
      template_id: 'auto_welcome',
      lead_id: leadId || null,
      sent_at: new Date(),
      status: 'sent'
    });
  } catch (err) {
    console.error('[lead-emails] Failed to log welcome email:', err.message);
  }
}

// =========================================================================
// 4-Week April YTT (Danish) — keep for legacy lead_schedule_4w action
// =========================================================================
async function sendEmail4wYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = 'Datoer til 4-ugers yogalæreruddannelsen';

  const isFebruary = program.toLowerCase().includes('feb');
  const fullPrice = isFebruary ? '20.750' : '23.750';
  const remaining = isFebruary ? '17.000' : '20.000';
  const discountNote = isFebruary ? ' (inkl. 3.000 kr. early bird-rabat)' : '';

  const sUrl = tokenize('https://www.yogabible.dk/skema/4-uger/', tokenData);

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 4-ugers intensive 200-timers yogalæreruddannelse. Her er alle træningsdage og tidspunkter: ' + link(sUrl, 'Se skemaet her') + '. Du kan tilføje datoerne direkte til din kalender.</p>';
  html += '<p>Det intensive format er til dig, der vil fordybe dig fuldt ud. På 4 uger gennemfører du hele certificeringen med daglig træning og teori — Hatha, Vinyasa, Yin, Hot Yoga og Meditation. Mange dimittender fortæller, at det intensive format hjalp dem med at lære mere, fordi de var 100% dedikerede.</p>';
  html += '<p>200 timer, Yoga Alliance-certificeret. Anatomi, filosofi, sekvensering og undervisningsmetodik. Alle niveauer er velkomne. Vi har uddannet yogalærere siden 2014, og vores dimittender underviser i hele Europa og videre.</p>';
  if (needsHousing) {
    html += '<p>Om bolig: jeg kan se du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for sted at bo i København. Vi samarbejder med lokale udbydere — ' + link('https://yogabible.dk/accommodation', 'se boligmuligheder her') + '. Sig til, hvis du har spørgsmål.</p>';
  }
  html += '<p>Pris: ' + fullPrice + ' kr.' + discountNote + '. Forberedelsesfasen på 3.750 kr. sikrer din plads — beløbet trækkes fra den fulde pris, så resten på ' + remaining + ' kr. kan betales i fleksible rater. ' + link('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs', 'Start Forberedelsesfasen her') + '.</p>';
  html += '<p>Hvis du vil snakke om uddannelsen, ' + link(CONFIG.MEETING_LINK, 'book et gratis infomøde her') + ' — eller bare svar på denne mail.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse i vores 4-ugers intensive 200-timers yogalæreruddannelse. Her er alle træningsdage og tidspunkter:\n' + sUrl + '\n\n';
  plain += 'Det intensive format er til dig, der vil fordybe dig fuldt ud. På 4 uger gennemfører du hele certificeringen med daglig træning og teori — Hatha, Vinyasa, Yin, Hot Yoga og Meditation.\n\n';
  plain += '200 timer, Yoga Alliance-certificeret. Anatomi, filosofi, sekvensering og undervisningsmetodik. Alle niveauer er velkomne.\n\n';
  if (needsHousing) plain += 'Om bolig: vi samarbejder med lokale udbydere — se: https://yogabible.dk/accommodation\n\n';
  plain += 'Pris: ' + fullPrice + ' kr.' + discountNote + '. Forberedelsesfasen på 3.750 kr. sikrer din plads. Resten (' + remaining + ' kr.) kan betales i fleksible rater.\nStart her: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs\n\n';
  plain += 'Vil du snakke? Book et gratis infomøde: ' + CONFIG.MEETING_LINK + '\n\n';
  plain += 'Shamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:4-week', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// 4-Week June YTT (Danish)
// =========================================================================
async function sendEmail4wJuneYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = 'Datoer til 4-ugers yogalæreruddannelsen (juni)';

  const sUrl = tokenize('https://www.yogabible.dk/skema/4-uger-juni/', tokenData);

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 4-ugers intensive 200-timers yogalæreruddannelse i juni 2026. Her er alle træningsdage og tidspunkter for juni-holdet: ' + link(sUrl, 'Se juni-skemaet her') + '. Du kan tilføje datoerne direkte til din kalender og se præcis, hvad der sker hver dag fra 1. juni til graduation 28. juni.</p>';
  html += '<p>Det intensive format er til dig, der vil fordybe dig fuldt ud. På 4 uger gennemfører du hele certificeringen med daglig træning og teori — Hatha, Vinyasa, Yin, Hot Yoga og Meditation. Mange dimittender fortæller, at det intensive format hjalp dem med at lære mere, fordi de var 100% dedikerede.</p>';
  html += '<p>200 timer, Yoga Alliance-certificeret. Anatomi, filosofi, sekvensering og undervisningsmetodik. Alle niveauer er velkomne. Vi har uddannet yogalærere siden 2014, og vores dimittender underviser i hele Europa og videre.</p>';
  if (needsHousing) {
    html += '<p>Om bolig: jeg kan se du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for sted at bo i København. Vi samarbejder med lokale udbydere — ' + link('https://yogabible.dk/accommodation', 'se boligmuligheder her') + '. Sig til, hvis du har spørgsmål.</p>';
  }
  html += '<p>Pris: 23.750 kr. Forberedelsesfasen på 3.750 kr. sikrer din plads — beløbet trækkes fra den fulde pris, så resten på 20.000 kr. kan betales i fleksible rater. ' + link('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs', 'Start Forberedelsesfasen her') + '.</p>';
  html += '<p>Hvis du vil snakke om uddannelsen, ' + link(CONFIG.MEETING_LINK, 'book et gratis infomøde her') + ' — eller bare svar på denne mail.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse i vores 4-ugers intensive 200-timers yogalæreruddannelse i juni 2026. Her er alle træningsdage og tidspunkter:\n' + sUrl + '\n\n';
  plain += '4 uger med daglig træning og teori — Hatha, Vinyasa, Yin, Hot Yoga og Meditation. 1. juni til graduation 28. juni.\n\n';
  plain += '200 timer, Yoga Alliance-certificeret. Anatomi, filosofi, sekvensering og undervisningsmetodik. Alle niveauer er velkomne.\n\n';
  if (needsHousing) plain += 'Om bolig: vi samarbejder med lokale udbydere — se: https://yogabible.dk/accommodation\n\n';
  plain += 'Pris: 23.750 kr. Forberedelsesfasen på 3.750 kr. sikrer din plads. Resten (20.000 kr.) kan betales i fleksible rater.\nStart her: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs\n\n';
  plain += 'Vil du snakke? Book et gratis infomøde: ' + CONFIG.MEETING_LINK + '\n\n';
  plain += 'Shamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:4-week-jun', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// 4-Week July (Vinyasa Plus) — Danish CPH version (router uses this when
// the lead is Danish AND in Copenhagen). Non-CPH Danish leads route through
// sendJulyVinyasaPlusDaEmail below.
// =========================================================================
async function sendEmail4wJulyYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = 'Datoer til 4-ugers Vinyasa Plus uddannelsen (juli)';

  const isCph = i18n.isCopenhagenLead(leadData);
  const schedPath = isCph ? '/skema/4-uger-juli/' : '/en/schedule/4-weeks-july-plan/';
  const sUrl = tokenize('https://www.yogabible.dk' + schedPath, tokenData);

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 4-ugers Vinyasa Plus yogalæreruddannelse i juli 2026. Her er alle træningsdage og tidspunkter: ' + link(sUrl, 'Se skemaet her') + '. Du kan tilføje datoerne direkte til din kalender.</p>';
  html += '<p>Om formatet: 70% Vinyasa Flow — kreativ sekvensering, klasseledelse og avancerede undervisningsteknikker — og 30% Yin Yoga + Hot Yoga — restitution, dybe stræk og undervisning i opvarmet miljø. Du bliver certificeret til at undervise både opvarmede og ikke-opvarmede Vinyasa-, Yin- og Hot Yoga-klasser. ' + link('https://yogabible.dk/yoga-journal/vinyasa-plus-metoden/', 'Læs mere om Vinyasa Plus-metoden her') + '.</p>';
  html += '<p>200 timer, Yoga Alliance-certificeret. Anatomi, filosofi, sekvensering og undervisningsmetodik. Alle niveauer er velkomne. Vi har uddannet yogalærere siden 2014.</p>';
  if (needsHousing) {
    html += '<p>Om bolig: jeg kan se du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for sted at bo i København. Vi samarbejder med lokale udbydere — ' + link('https://yogabible.dk/accommodation', 'se boligmuligheder her') + '.</p>';
  }
  html += '<p>Pris: 23.750 kr. Forberedelsesfasen på 3.750 kr. sikrer din plads — beløbet trækkes fra den fulde pris, så resten på 20.000 kr. kan betales i fleksible rater. ' + link('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100211', 'Start Forberedelsesfasen her') + '.</p>';
  html += '<p>Hvis du vil snakke om uddannelsen, ' + link(CONFIG.MEETING_LINK, 'book et gratis infomøde her') + ' — eller bare svar på denne mail.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse i vores 4-ugers Vinyasa Plus yogalæreruddannelse i juli 2026. Her er alle træningsdage og tidspunkter:\n' + sUrl + '\n\n';
  plain += 'Om formatet: 70% Vinyasa Flow + 30% Yin Yoga + Hot Yoga. Du bliver certificeret til at undervise både opvarmede og ikke-opvarmede klasser.\n\n';
  plain += '200 timer, Yoga Alliance-certificeret. Alle niveauer er velkomne.\n\n';
  if (needsHousing) plain += 'Om bolig: se: https://yogabible.dk/accommodation\n\n';
  plain += 'Pris: 23.750 kr. Forberedelsesfasen på 3.750 kr. sikrer din plads. Resten (20.000 kr.) kan betales i rater.\nStart her: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100211\n\n';
  plain += 'Book infomøde: ' + CONFIG.MEETING_LINK + '\n\n';
  plain += 'Shamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:4-week-jul', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// July Vinyasa Plus — English (international)
// Conditional on country (travel sentence + localized price), Q1 (yoga
// experience), Q2 (accommodation), Q3 (English comfort).
// =========================================================================
async function sendJulyVinyasaPlusEnEmail(leadData, tokenData) {
  const firstName = leadData.first_name || '';
  const country = (leadData.country || 'OTHER').toUpperCase();
  const yogaExp = leadData.yoga_experience || '';
  const accommodation = leadData.accommodation || '';
  const englishComfort = leadData.english_comfort || '';
  const lang = (leadData.lang || leadData.meta_lang || 'en').toLowerCase().substring(0, 2);

  const subject = 'Dates for the July Vinyasa Plus training';
  const sUrl = tokenize('https://yogabible.dk/en/schedule/4-weeks-july-plan/', tokenData);
  const localizedPrice = getLocalizedPrepPrice(country);
  const checkoutUrl = 'https://www.yogabible.dk/en/schedule/4-weeks-july-plan/?product=100211';

  let html = '';
  html += '<p>Hi ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Thanks for your interest in our 4-Week Vinyasa Plus Yoga Teacher Training (July 2026). Here are all the training days and times: ' + link(sUrl, 'View your schedule') + '. You can add all dates directly to your calendar.</p>';
  html += '<p>About the format: 70% Vinyasa Flow — creative sequencing, class leadership and advanced teaching techniques — and 30% Yin Yoga + Hot Yoga — restoration, deep stretches and teaching in a heated environment. You\'ll be certified to teach both non-heated and heated Vinyasa, Yin and Hot Yoga classes. ' + link('https://yogabible.dk/en/yoga-journal/vinyasa-plus-metoden/', 'Read more about the Vinyasa Plus method here') + '.</p>';
  html += '<p>A few practicals: 200 hours, Yoga Alliance certified (RYT-200). Vinyasa Flow, Yin Yoga, Hot Yoga and Meditation. Anatomy, philosophy, sequencing and teaching methodology. All levels welcome.</p>';

  if (yogaExp === 'regular') {
    html += '<p>Great — your existing practice gives you a strong foundation. The training will deepen your understanding and add teaching methodology, sequencing and anatomy to what you already know.</p>';
  } else if (yogaExp === 'beginner') {
    html += '<p>You\'re welcome exactly as you are. Many of our graduates started in the same place. The Preparation Phase gives you time to build strength, flexibility and confidence before training starts in July.</p>';
  } else if (yogaExp === 'previous_ytt') {
    html += '<p>Welcome back to the mat. Vinyasa Plus will add a new dimension to your teaching — especially the 70/30 flow-to-yin ratio and heated teaching techniques.</p>';
  }

  if (lang !== 'en' && lang !== 'da' && englishComfort === 'needs_patience') {
    html += '<p>Don\'t worry — the English we use is clear and practical, not academic. Your classmates will be international too, so everyone supports each other.</p>';
  } else if (lang !== 'en' && lang !== 'da' && englishComfort === 'unsure') {
    html += '<p>We completely understand. The English we use is clear and practical, not academic. Many of our graduates had the same concern before starting — and it was never an issue. If you\'d like to talk about this, just reply to this email.</p>';
  }

  html += '<p>We\'ve been training yoga teachers since 2014, and our graduates teach across Europe and beyond.</p>';

  const travel = travelSentenceEn(country);
  if (travel) html += '<p>' + travel + ' ' + link('https://yogabible.dk/en/about-copenhagen/', 'Here\'s a bit about Copenhagen') + ' if you\'d like a sense of the city.</p>';

  if (accommodation === 'accommodation') {
    html += '<p>About accommodation — we can see you\'d like a hand. Once you secure your spot through the Preparation Phase, we\'ll help you reserve accommodation in Copenhagen. ' + link('https://yogabible.dk/en/accommodation/', 'See accommodation options here') + ', and just reply to this email if you have questions about housing.</p>';
  } else if (accommodation === 'accommodation_plus') {
    html += '<p>About accommodation and logistics — we\'ve got you covered. Once you secure your spot through the Preparation Phase, we\'ll help with accommodation, getting around Copenhagen, and everything else you need for your stay. ' + link('https://yogabible.dk/en/accommodation/', 'See accommodation options here') + ' — reply to this email anytime with questions.</p>';
  } else if (accommodation === 'self_arranged') {
    html += '<p>If you change your mind about accommodation, we\'re always happy to help. ' + link('https://yogabible.dk/en/accommodation/', 'See accommodation options here') + '.</p>';
  }

  if (accommodation === 'accommodation' || accommodation === 'accommodation_plus' || accommodation === 'self_arranged') {
    html += '<p>The Preparation Phase (' + localizedPrice + ') reserves your place in the July cohort. You\'ll get access to the member area with optional study materials, and once paid we can help you reserve accommodation in Copenhagen too. ' + link(checkoutUrl, 'Start the Preparation Phase here') + '.</p>';
  } else if (accommodation === 'lives_in_copenhagen') {
    html += '<p>The Preparation Phase (' + localizedPrice + ') reserves your place in the July cohort. You\'ll get access to the member area with optional study materials, and you can start practising at our studio in Christianshavn right away — the more hours you complete before July, the stronger your foundation will be. ' + link(checkoutUrl, 'Start the Preparation Phase here') + '.</p>';
  } else {
    html += '<p>The Preparation Phase (' + localizedPrice + ') reserves your place in the July cohort. You\'ll get access to the member area with optional study materials. ' + link(checkoutUrl, 'Start the Preparation Phase here') + '.</p>';
  }

  html += '<p>If you\'d like to talk through any of this, ' + link('https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation', 'book a free online consultation here') + ', or just reply to this email — easier than you\'d think.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hi ' + firstName + ',\n\n';
  plain += 'Thanks for your interest in our 4-Week Vinyasa Plus Yoga Teacher Training (July 2026). Here are all the training days and times:\n' + sUrl + '\n\n';
  plain += 'About the format: 70% Vinyasa Flow + 30% Yin Yoga + Hot Yoga. You\'ll be certified to teach both non-heated and heated classes.\n\n';
  plain += '200 hours, Yoga Alliance certified (RYT-200). All levels welcome.\n\n';
  if (yogaExp === 'regular') plain += 'Your existing practice gives you a strong foundation. The training will deepen your understanding.\n\n';
  else if (yogaExp === 'beginner') plain += 'You\'re welcome exactly as you are. The Preparation Phase gives you time to build strength and confidence before training starts.\n\n';
  else if (yogaExp === 'previous_ytt') plain += 'Welcome back to the mat. Vinyasa Plus will add a new dimension to your teaching.\n\n';
  if (lang !== 'en' && lang !== 'da' && englishComfort === 'needs_patience') plain += 'Don\'t worry — the English we use is clear and practical, not academic.\n\n';
  else if (lang !== 'en' && lang !== 'da' && englishComfort === 'unsure') plain += 'The English we use is clear and practical. Many graduates had the same concern before starting — it was never an issue.\n\n';
  if (travel) plain += travel + '\n\n';
  if (accommodation === 'accommodation') plain += 'Accommodation: once you secure your spot, we\'ll help you reserve accommodation in Copenhagen.\n\n';
  else if (accommodation === 'accommodation_plus') plain += 'Accommodation and logistics: once you secure your spot, we\'ll help with everything you need for your stay.\n\n';
  plain += 'The Preparation Phase (' + localizedPrice + ') reserves your place in the July cohort.\nStart here: ' + checkoutUrl + '\n\n';
  plain += 'Want to talk? https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation\n\n';
  plain += 'Shamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:4-week-jul', lang: lang
  });
  return { ...result, subject };
}

// =========================================================================
// July Vinyasa Plus — German
// =========================================================================
async function sendJulyVinyasaPlusDeEmail(leadData, tokenData) {
  const firstName = leadData.first_name || '';
  const country = (leadData.country || 'OTHER').toUpperCase();
  const yogaExp = leadData.yoga_experience || '';
  const accommodation = leadData.accommodation || '';
  const englishComfort = leadData.english_comfort || '';

  const subject = 'Termine für die 4-Wochen Vinyasa Plus Ausbildung (Juli)';
  const sUrl = tokenize('https://yogabible.dk/en/schedule/4-weeks-july-plan/', tokenData);
  const localizedPrice = getLocalizedPrepPrice(country);
  const checkoutUrl = 'https://www.yogabible.dk/en/schedule/4-weeks-july-plan/?product=100211';

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Vielen Dank für dein Interesse an unserer 4-wöchigen Vinyasa Plus Yogalehrerausbildung (Juli 2026). Ich schreibe dir auf Deutsch, damit du dich direkt wohlfühlst — im Alltag spreche ich Englisch, und du kannst mir jederzeit auf Deutsch oder Englisch antworten.</p>';
  html += '<p>Hier sind alle Trainingstage und -zeiten: ' + link(sUrl, 'Deinen Stundenplan ansehen') + '. Du kannst alle Termine direkt in deinen Kalender übernehmen.</p>';
  html += '<p>Zum Format: 70% Vinyasa Flow — kreatives Sequencing, Klassenleitung und fortgeschrittene Unterrichtstechniken — und 30% Yin Yoga + Hot Yoga — Regeneration, tiefe Dehnungen und Unterrichten in einer beheizten Umgebung. Du wirst zertifiziert, um sowohl unbeheizte als auch beheizte Vinyasa-, Yin- und Hot-Yoga-Stunden zu unterrichten. ' + link('https://yogabible.dk/en/yoga-journal/vinyasa-plus-metoden/', 'Mehr über die Vinyasa Plus Methode erfahren') + '.</p>';
  html += '<p>Praktisches: 200 Stunden, Yoga Alliance zertifiziert (RYT-200). Vinyasa Flow, Yin Yoga, Hot Yoga und Meditation. Anatomie, Philosophie, Sequencing und Unterrichtsmethodik. Alle Levels willkommen.</p>';

  if (yogaExp === 'regular') {
    html += '<p>Super — deine bestehende Praxis gibt dir eine starke Grundlage. Die Ausbildung vertieft dein Verständnis und fügt Unterrichtsmethodik, Sequencing und Anatomie zu dem hinzu, was du bereits weißt.</p>';
  } else if (yogaExp === 'beginner') {
    html += '<p>Du bist genau richtig, so wie du bist. Viele unserer Absolventen haben an derselben Stelle angefangen. Die Vorbereitungsphase gibt dir Zeit, Kraft, Flexibilität und Selbstvertrauen aufzubauen, bevor das Training im Juli beginnt.</p>';
  } else if (yogaExp === 'previous_ytt') {
    html += '<p>Willkommen zurück auf der Matte. Vinyasa Plus wird deinem Unterrichten eine neue Dimension verleihen — besonders das 70/30-Verhältnis von Flow zu Yin und die Techniken für beheizten Unterricht.</p>';
  }

  if (englishComfort === 'needs_patience') {
    html += '<p>Keine Sorge — das Englisch, das wir verwenden, ist klar und praktisch, nicht akademisch. Deine Mitschüler werden ebenfalls international sein, sodass sich alle gegenseitig unterstützen.</p>';
  } else if (englishComfort === 'unsure') {
    html += '<p>Das verstehen wir vollkommen. Viele unserer Absolventen hatten vor dem Start dieselbe Sorge — und es war nie ein Problem. Wenn du darüber sprechen möchtest, antworte einfach auf diese E-Mail.</p>';
  }

  html += '<p>Wir bilden seit 2014 Yogalehrer aus, und unsere Absolventen unterrichten in ganz Europa und darüber hinaus.</p>';

  const travel = travelSentenceDe(country);
  if (travel) html += '<p>' + travel + ' ' + link('https://yogabible.dk/en/about-copenhagen/', 'Hier findest du etwas über Kopenhagen') + ', falls du einen Eindruck von der Stadt bekommen möchtest.</p>';

  if (accommodation === 'accommodation') {
    html += '<p>Zur Unterkunft: Wir sehen, dass du Hilfe wünschst. Sobald du deinen Platz über die Vorbereitungsphase gesichert hast, helfen wir dir, eine Unterkunft in Kopenhagen zu reservieren. ' + link('https://yogabible.dk/en/accommodation/', 'Hier findest du Unterkunftsoptionen') + '.</p>';
  } else if (accommodation === 'accommodation_plus') {
    html += '<p>Zur Unterkunft und Logistik: Wir kümmern uns darum. Sobald du deinen Platz gesichert hast, helfen wir dir mit Unterkunft, Fortbewegung in Kopenhagen und allem anderen, was du für deinen Aufenthalt brauchst. ' + link('https://yogabible.dk/en/accommodation/', 'Hier findest du Unterkunftsoptionen') + '.</p>';
  } else if (accommodation === 'self_arranged') {
    html += '<p>Falls du es dir mit der Unterkunft anders überlegst, helfen wir dir gerne. ' + link('https://yogabible.dk/en/accommodation/', 'Hier findest du Unterkunftsoptionen') + '.</p>';
  }

  if (accommodation === 'accommodation' || accommodation === 'accommodation_plus' || accommodation === 'self_arranged') {
    html += '<p>Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz im Juli-Kurs. Du erhältst Zugang zum Mitgliederbereich mit optionalen Lernmaterialien, und nach der Zahlung helfen wir dir auch, eine Unterkunft in Kopenhagen zu reservieren. ' + link(checkoutUrl, 'Vorbereitungsphase hier starten') + '.</p>';
  } else if (accommodation === 'lives_in_copenhagen') {
    html += '<p>Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz im Juli-Kurs. Du erhältst Zugang zum Mitgliederbereich mit optionalen Lernmaterialien und kannst sofort in unserem Studio in Christianshavn mit dem Üben beginnen. ' + link(checkoutUrl, 'Vorbereitungsphase hier starten') + '.</p>';
  } else {
    html += '<p>Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz im Juli-Kurs. Du erhältst Zugang zum Mitgliederbereich mit optionalen Lernmaterialien. ' + link(checkoutUrl, 'Vorbereitungsphase hier starten') + '.</p>';
  }

  html += '<p>Wenn du darüber sprechen möchtest, ' + link('https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation', 'buche hier ein kostenloses Online-Gespräch') + ', oder antworte einfach auf diese E-Mail.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Vielen Dank für dein Interesse an unserer 4-wöchigen Vinyasa Plus Yogalehrerausbildung (Juli 2026).\n\n';
  plain += 'Trainingstage und -zeiten:\n' + sUrl + '\n\n';
  plain += 'Format: 70% Vinyasa Flow + 30% Yin Yoga + Hot Yoga. Du wirst zertifiziert, sowohl unbeheizte als auch beheizte Stunden zu unterrichten.\n\n';
  plain += '200 Stunden, Yoga Alliance zertifiziert (RYT-200). Alle Levels willkommen.\n\n';
  if (travel) plain += travel + '\n\n';
  plain += 'Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz im Juli-Kurs.\nHier starten: ' + checkoutUrl + '\n\n';
  plain += 'Möchtest du sprechen? https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation\n\n';
  plain += 'Shamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:4-week-jul', lang: 'de'
  });
  return { ...result, subject };
}

// =========================================================================
// July Vinyasa Plus — Danish (international DA, non-CPH)
// =========================================================================
async function sendJulyVinyasaPlusDaEmail(leadData, tokenData) {
  const firstName = leadData.first_name || '';
  const yogaExp = leadData.yoga_experience || '';
  const accommodation = leadData.accommodation || '';

  const subject = 'Datoer til 4-ugers Vinyasa Plus uddannelsen (juli)';
  const sUrl = tokenize('https://yogabible.dk/skema/4-uger-juli/', tokenData);

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 4-ugers Vinyasa Plus yogalæreruddannelse i juli 2026. Her er alle træningsdage og -tidspunkter: ' + link(sUrl, 'Se din tidsplan') + '. Du kan tilføje datoerne direkte til din kalender.</p>';
  html += '<p>Om formatet: 70% Vinyasa Flow — kreativ sekvensering, klasseledelse og avancerede undervisningsteknikker — og 30% Yin Yoga + Hot Yoga — restitution, dybe stræk og undervisning i opvarmet miljø. Du bliver certificeret til at undervise både opvarmede og ikke-opvarmede klasser. ' + link('https://yogabible.dk/yoga-journal/vinyasa-plus-metoden/', 'Læs mere om Vinyasa Plus-metoden her') + '.</p>';
  html += '<p>200 timer, Yoga Alliance-certificeret. Anatomi, filosofi, sekvensering og undervisningsmetodik. Alle niveauer er velkomne. Vi har uddannet yogalærere siden 2014.</p>';

  if (yogaExp === 'regular') {
    html += '<p>Din nuværende praksis giver dig et godt fundament. Uddannelsen vil uddybe din forståelse og tilføje undervisningsmetodik, sekvensering og anatomi til det, du allerede ved.</p>';
  } else if (yogaExp === 'beginner') {
    html += '<p>Du er velkommen præcis som du er. Mange af vores dimittender startede samme sted. Forberedelsesfasen giver dig tid til at opbygge styrke, fleksibilitet og selvtillid før uddannelsen starter i juli.</p>';
  } else if (yogaExp === 'previous_ytt') {
    html += '<p>Velkommen tilbage på måtten. Vinyasa Plus tilføjer en ny dimension til din undervisning — særligt 70/30-forholdet mellem Flow og Yin og teknikker til opvarmet undervisning.</p>';
  }

  if (accommodation === 'accommodation') {
    html += '<p>Om bolig: vi kan se, du gerne vil have hjælp. Når du har sikret din plads gennem Forberedelsesfasen, hjælper vi dig med at booke et sted at bo i København. ' + link('https://yogabible.dk/accommodation', 'Se boligmuligheder her') + '.</p>';
  } else if (accommodation === 'accommodation_plus') {
    html += '<p>Om bolig og logistik: vi tager os af det. Når du har sikret din plads, hjælper vi dig med bolig, transport i København og alt andet du har brug for. ' + link('https://yogabible.dk/accommodation', 'Se boligmuligheder her') + '.</p>';
  }

  if (accommodation === 'lives_in_copenhagen') {
    html += '<p>Forberedelsesfasen (3.750 kr.) sikrer din plads på juli-holdet. Du får adgang til medlemsområdet med valgfrit studiemateriale og kan begynde at træne i vores studie i Christianshavn med det samme — jo flere timer du når inden juli, desto stærkere er dit fundament. ' + link('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100211', 'Start Forberedelsesfasen her') + '.</p>';
  } else {
    html += '<p>Forberedelsesfasen (3.750 kr.) sikrer din plads på juli-holdet. Du får adgang til medlemsområdet med valgfrit studiemateriale, og hvis du har brug for det, hjælper vi dig også med at booke et sted at bo i København. ' + link('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100211', 'Start Forberedelsesfasen her') + '.</p>';
  }

  html += '<p>Hvis du vil snakke om det, ' + link(CONFIG.MEETING_LINK, 'book et gratis infomøde her') + ' — eller bare svar på denne mail.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse i vores 4-ugers Vinyasa Plus yogalæreruddannelse i juli 2026.\n\n';
  plain += 'Træningsdage og tidspunkter:\n' + sUrl + '\n\n';
  plain += 'Formatet: 70% Vinyasa Flow + 30% Yin Yoga + Hot Yoga. Du bliver certificeret til både opvarmede og ikke-opvarmede klasser.\n\n';
  plain += '200 timer, Yoga Alliance-certificeret. Alle niveauer er velkomne.\n\n';
  plain += 'Forberedelsesfasen (3.750 kr.) sikrer din plads på juli-holdet.\nStart her: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs/?product=100211\n\n';
  plain += 'Book infomøde: ' + CONFIG.MEETING_LINK + '\n\n';
  plain += 'Shamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:4-week-jul', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// 8-Week YTT (Danish)
// =========================================================================
async function sendEmail8wYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = 'Datoer til 8-ugers yogalæreruddannelsen';

  const sUrl = tokenize('https://www.yogabible.dk/skema/8-uger/', tokenData);

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 8-ugers semi-intensive 200-timers yogalæreruddannelse. Her er alle 22 workshopdatoer og tidspunkter: ' + link(sUrl, 'Se skemaet her') + '. Du kan tilføje datoerne direkte til din kalender.</p>';
  html += '<p>8-ugers formatet giver en god balance: nok intensitet til at holde fokus og gøre reelle fremskridt, men stadig plads til arbejde, familie eller andre forpligtelser. Et populært valg for dem, der gerne vil have en dyb oplevelse uden at sætte hele livet på pause.</p>';
  html += '<p>200 timer, Yoga Alliance-certificeret. Hatha, Vinyasa, Yin, Hot Yoga og Meditation. Anatomi, filosofi, sekvensering og undervisningsmetodik. Online backup hvis du ikke kan møde op en dag. Alle niveauer er velkomne. Vi har uddannet yogalærere siden 2014.</p>';
  if (needsHousing) html += '<p>Om bolig: jeg kan se du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for sted at bo i København. ' + link('https://yogabible.dk/accommodation', 'Se boligmuligheder her') + '.</p>';
  html += '<p>Pris: 23.750 kr. Forberedelsesfasen på 3.750 kr. sikrer din plads — beløbet trækkes fra den fulde pris, så resten på 20.000 kr. kan betales i fleksible rater. ' + link('https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs', 'Start Forberedelsesfasen her') + '.</p>';
  html += '<p>Hvis du vil snakke om uddannelsen, ' + link(CONFIG.MEETING_LINK, 'book et gratis infomøde her') + ' — eller bare svar på denne mail.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse i vores 8-ugers semi-intensive 200-timers yogalæreruddannelse.\n\nSkema og datoer:\n' + sUrl + '\n\n';
  plain += '8 uger giver balance: nok intensitet til reelle fremskridt, men stadig plads til arbejde og familie.\n\n';
  plain += '200 timer, Yoga Alliance-certificeret. Online backup hvis du ikke kan deltage en dag. Alle niveauer er velkomne.\n\n';
  if (needsHousing) plain += 'Om bolig: https://yogabible.dk/accommodation\n\n';
  plain += 'Pris: 23.750 kr. Forberedelsesfasen 3.750 kr. Resten (20.000 kr.) i rater.\nStart: https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs\n\n';
  plain += 'Book infomøde: ' + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:8-week', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// 18-Week YTT — Spring (Danish, "just started this week" tone)
// =========================================================================
async function sendEmail18wYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = 'Uddannelsen er startet — du kan stadig nå med denne uge';

  const sUrl = tokenize('https://www.yogabible.dk/skema/18-uger/', tokenData);

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 18-ugers fleksible yogalæreruddannelse. Holdet er netop gået i gang — intromodulerne er allerede afholdt, men vi har dem på optagelse, så du nemt kan indhente det. Som tak for din hurtige beslutning får du 1.000 kr. i last-minute-rabat.</p>';
  html += '<p>Her er alle datoer og tidspunkter: ' + link(sUrl, 'Se skemaet her') + '. Du kan tilføje datoerne direkte til din kalender og se præcis hvilke dage der er hverdagshold og weekendhold.</p>';
  html += '<p>Det unikke ved formatet er fleksibiliteten. Hver workshop kører to gange — én på en hverdag og én i weekenden — så du altid kan følge med, uanset hvordan din uge ser ud. Du kan vælge hverdags- eller weekendspor og skifte frit undervejs. Online backup hvis du ikke kan møde op en dag, og 60 yogaklasser i studiet er inkluderet.</p>';
  html += '<p>200 timer, Yoga Alliance-certificeret. Hatha, Vinyasa, Yin, Hot Yoga og Meditation. Alle niveauer er velkomne. Vi har uddannet yogalærere siden 2014.</p>';
  if (needsHousing) html += '<p>Om bolig: jeg kan se du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for sted at bo i København. ' + link('https://yogabible.dk/accommodation', 'Se boligmuligheder her') + '.</p>';
  html += '<p>Normalpris er 23.750 kr. — med last-minute-rabatten er din pris 22.750 kr. Forberedelsesfasen på 3.750 kr. sikrer din plads, og resten på 19.000 kr. kan betales i fleksible rater. ' + link('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs', 'Start Forberedelsesfasen her') + ' — last-minute-rabatten gælder kun denne uge.</p>';
  html += '<p>Hvis du vil snakke om det, ' + link(CONFIG.MEETING_LINK, 'book et gratis infomøde her') + '.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse i vores 18-ugers fleksible yogalæreruddannelse. Holdet er netop gået i gang — du kan stadig nå med denne uge. Du får 1.000 kr. i last-minute-rabat for din hurtige beslutning.\n\nSkema og datoer:\n' + sUrl + '\n\n';
  plain += 'Hver workshop kører to gange (hverdag + weekend). Du kan skifte spor undervejs. Online backup hvis du ikke kan møde op. 60 yogaklasser inkluderet.\n\n';
  plain += '200 timer, Yoga Alliance-certificeret. Alle niveauer er velkomne.\n\n';
  if (needsHousing) plain += 'Om bolig: https://yogabible.dk/accommodation\n\n';
  plain += 'Normalpris: 23.750 kr. Din pris med last-minute-rabat: 22.750 kr. Forberedelsesfasen 3.750 kr. Resten (19.000 kr.) i rater.\nStart: https://www.yogabible.dk/200-hours-18-weeks-flexible-programs\n\n';
  plain += 'Book infomøde: ' + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:18-week', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// 18-Week YTT — Autumn (Danish)
// =========================================================================
async function sendEmail18wAugYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = 'Skemaet til efterårets 18-ugers program';

  const sUrl = tokenize('https://www.yogabible.dk/skema/18-uger-august/', tokenData);

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 18-ugers fleksible yogalæreruddannelse — efterårsholdet august–december 2026. Her er alle datoer og tidspunkter: ' + link(sUrl, 'Se skemaet her') + '. Du kan tilføje datoerne direkte til din kalender og se præcis hvilke dage der er hverdagshold og weekendhold.</p>';
  html += '<p>Det unikke ved formatet er fleksibiliteten. Hver workshop kører to gange — én på en hverdag og én i weekenden — så du altid kan følge med, uanset hvordan din uge ser ud. Du kan vælge hverdags- eller weekendspor og skifte frit undervejs. Online backup hvis du ikke kan møde op en dag, og 60 yogaklasser i studiet er inkluderet. Start 10. august, graduation 13. december.</p>';
  html += '<p>200 timer, Yoga Alliance-certificeret. Hatha, Vinyasa, Yin, Hot Yoga og Meditation. Alle niveauer er velkomne. Vi har uddannet yogalærere siden 2014. Holdene er små for personlig feedback, så tilmeld dig tidligt — pladser fyldes.</p>';
  if (needsHousing) html += '<p>Om bolig: jeg kan se du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for sted at bo i København. ' + link('https://yogabible.dk/accommodation', 'Se boligmuligheder her') + '.</p>';
  html += '<p>Pris: 23.750 kr. Forberedelsesfasen på 3.750 kr. sikrer din plads — beløbet trækkes fra den fulde pris, så resten på 20.000 kr. kan betales i fleksible rater. ' + link('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs', 'Start Forberedelsesfasen her') + '.</p>';
  html += '<p>Hvis du vil snakke om uddannelsen, ' + link(CONFIG.MEETING_LINK, 'book et gratis infomøde her') + '.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse i vores 18-ugers fleksible yogalæreruddannelse — efterårsholdet august–december 2026.\n\nSkema og datoer:\n' + sUrl + '\n\n';
  plain += 'Hver workshop kører to gange (hverdag + weekend). Du kan skifte spor undervejs. 60 yogaklasser inkluderet. Start 10. august, graduation 13. december.\n\n';
  plain += '200 timer, Yoga Alliance-certificeret. Alle niveauer er velkomne.\n\n';
  if (needsHousing) plain += 'Om bolig: https://yogabible.dk/accommodation\n\n';
  plain += 'Pris: 23.750 kr. Forberedelsesfasen 3.750 kr. Resten (20.000 kr.) i rater.\nStart: https://www.yogabible.dk/200-hours-18-weeks-flexible-programs\n\n';
  plain += 'Book infomøde: ' + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:18-week-aug', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// Multi-format YTT (Danish, lead requested 2+ formats)
// =========================================================================

const FORMAT_INFO_DA = {
  '18w':     { name: '18-ugers fleksible program (forår)',     period: 'marts–juni 2026',     sched: 'https://www.yogabible.dk/skema/18-uger/',         page: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',  desc: 'Det mest fleksible format — vælg hverdags- eller weekendspor og skift frit. Perfekt hvis du har arbejde, studie eller familie ved siden af.' },
  '18w-mar': { name: '18-ugers fleksible program (forår)',     period: 'marts–juni 2026',     sched: 'https://www.yogabible.dk/skema/18-uger/',         page: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',  desc: 'Forårsholdet — vælg hverdags- eller weekendspor og skift frit undervejs.' },
  '18w-aug': { name: '18-ugers fleksible program (efterår)',   period: 'august–december 2026',page: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs', sched: 'https://www.yogabible.dk/skema/18-uger-august/', desc: 'Efterårsholdet — start 10. august, graduation 13. december.' },
  '8w':      { name: '8-ugers semi-intensive program',         period: 'maj–juni 2026',       sched: 'https://www.yogabible.dk/skema/8-uger/',          page: 'https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs', desc: 'En god balance mellem intensitet og hverdagsliv.' },
  '4w':      { name: '4-ugers intensive program (juni)',       period: 'juni 2026',           sched: 'https://www.yogabible.dk/skema/4-uger-juni/',     page: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs', desc: 'Fuldt fordybende — daglig træning og teori i 4 uger.' },
  '4w-jun':  { name: '4-ugers Complete Program (juni)',        period: 'juni 2026',           sched: 'https://www.yogabible.dk/skema/4-uger-juni/',     page: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs', desc: 'Daglig træning og teori i 4 uger. Hatha, Vinyasa, Yin, Hot Yoga og Meditation.' },
  '4w-apr':  { name: '4-ugers Complete Program (april - udsolgt)', period: 'april 2026',      sched: 'https://www.yogabible.dk/skema/4-uger/',          page: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs', desc: 'Daglig træning og teori i 4 uger.' },
  '4w-jul':  { name: '4-ugers Vinyasa Plus (juli)',            period: 'juli 2026',           sched: 'https://www.yogabible.dk/skema/4-uger-juli/',     page: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs', desc: '70% Vinyasa Flow + 30% Yin Yoga + Hot Yoga.' }
};

async function sendEmailMultiYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const formats = (leadData.all_formats || '').split(',').map(s => s.trim()).filter(Boolean);

  const formatNames = formats.map(f => (FORMAT_INFO_DA[f] || {}).name || f);
  const formatList = formatNames.length > 1
    ? formatNames.slice(0, -1).join(', ') + ' og ' + formatNames[formatNames.length - 1]
    : (formatNames[0] || '');

  const subject = 'Dine YTT-skemaer';

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 200-timers yogalæreruddannelse. Jeg kan se, du gerne vil sammenligne vores ' + escapeHtml(formatList) + '. Godt tænkt — herunder finder du skemaer og datoer for hvert format.</p>';
  html += '<p>Et hurtigt spørgsmål mens jeg har dig: er det fordi du har arbejde, studie eller andre forpligtelser, der påvirker hvilken form der passer bedst? Svar gerne på denne mail, så hjælper jeg dig med at finde det rigtige match.</p>';
  formats.forEach(f => {
    const info = FORMAT_INFO_DA[f];
    if (!info) return;
    var sUrl = tokenize(info.sched, tokenData);
    html += '<p><strong>' + escapeHtml(info.name) + '</strong> (' + escapeHtml(info.period) + '): ' + info.desc + ' ' + link(sUrl, 'Se skemaet') + ' · ' + link(info.page, 'læs mere om programmet') + '.</p>';
  });
  html += '<p>Alle formater giver det samme certifikat — 200 timer, Yoga Alliance, samme pensum. Hatha, Vinyasa, Yin, Hot Yoga og Meditation. Anatomi, filosofi, sekvensering og undervisningsmetodik. Vi har uddannet yogalærere siden 2014.</p>';
  if (needsHousing) html += '<p>Om bolig: jeg kan se du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for sted at bo i København. ' + link('https://yogabible.dk/accommodation', 'Se boligmuligheder her') + '.</p>';
  html += '<p>Pris: 23.750 kr. — samme for alle formater. Forberedelsesfasen på 3.750 kr. sikrer din plads (beløbet trækkes fra den fulde pris), og resten kan betales i fleksible rater. Du får øjeblikkelig adgang til alle yogaklasser i studiet, så du kan opbygge styrke og rutine inden uddannelsesstart. ' + link('https://www.yogabible.dk/om-200hrs-yogalaereruddannelser', 'Start Forberedelsesfasen her') + '.</p>';
  html += '<p>Hvis du vil se studiet eller have hjælp til at vælge, ' + link(CONFIG.MEETING_LINK, 'book et infomøde her') + '.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse. Du sammenligner: ' + formatList + '\n\n';
  plain += 'Et hurtigt spørgsmål — er det fordi du har andre forpligtelser der påvirker dit valg? Svar gerne, så hjælper jeg.\n\n';
  formats.forEach(f => {
    const info = FORMAT_INFO_DA[f];
    if (!info) return;
    var sUrl = tokenize(info.sched, tokenData);
    plain += info.name + ' (' + info.period + '): ' + info.desc + '\nSkema: ' + sUrl + '\nLæs mere: ' + info.page + '\n\n';
  });
  plain += 'Alle formater giver samme certifikat. Pris: 23.750 kr. Forberedelsesfasen 3.750 kr. Resten i rater.\nStart: https://www.yogabible.dk/om-200hrs-yogalaereruddannelser\n\n';
  plain += 'Book infomøde: ' + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:multi-format', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// Undecided YTT (Danish — overview of all formats)
// =========================================================================
async function sendEmailUndecidedYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';

  const subject = 'Find dit perfekte yogalæreruddannelses-format';

  const formats = [
    { name: '4-ugers intensiv', period: 'Juni 2026', sched: 'https://www.yogabible.dk/skema/4-uger-juni/', page: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs', desc: 'Fuldt fordybende daglig træning i 4 uger — det mest intense format.', good: 'Dig der vil have komplet immersion og kan dedikere 4 uger fuld tid.' },
    { name: '8-ugers semi-intensiv', period: 'Maj–Juni 2026', sched: 'https://www.yogabible.dk/skema/8-uger/', page: 'https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs', desc: 'God balance mellem intensitet og hverdagsliv.', good: 'Dig der vil have fokuseret uddannelse men har brug for lidt mere tid end 4 uger.' },
    { name: '4-ugers Vinyasa Plus', period: 'Juli 2026', sched: 'https://www.yogabible.dk/skema/4-uger-juli/', page: 'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs', desc: '70% Vinyasa Flow + 30% Yin Yoga + Hot Yoga.', good: 'Dig der vil specialisere dig i Vinyasa Flow.' },
    { name: '18-ugers fleksibel', period: 'August–December 2026', sched: 'https://www.yogabible.dk/skema/18-uger-august/', page: 'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs', desc: 'Det mest fleksible format — vælg hverdags- eller weekendspor og skift frit undervejs. 60 yogaklasser inkluderet.', good: 'Dig der vil tage uddannelsen uden at sætte hverdagen på pause.' }
  ];

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 200-timers yogalæreruddannelse. Det er helt normalt ikke at vide, hvilket format der passer bedst — det afhænger af din hverdag, dine mål og din læringsstil. Lad mig give dig et overblik.</p>';
  html += '<p>Alle formater giver dig det samme 200-timers Yoga Alliance-certifikat med samme pensum: Hatha, Vinyasa, Yin, Hot Yoga, Meditation, anatomi, filosofi og undervisningsmetodik.</p>';
  formats.forEach(f => {
    var sUrl = tokenize(f.sched, tokenData);
    html += '<p><strong>' + escapeHtml(f.name) + '</strong> (' + escapeHtml(f.period) + '): ' + f.desc + ' God til: ' + f.good + ' ' + link(sUrl, 'Se skema') + ' · ' + link(f.page, 'læs mere') + '.</p>';
  });
  html += '<p>Hvis du vil sammenligne formaterne side om side: ' + link('https://www.yogabible.dk/om-200hrs-yogalaereruddannelser', 'Sammenlign alle formater her') + '. Vi har uddannet yogalærere siden 2014.</p>';
  if (needsHousing) html += '<p>Om bolig: jeg kan se du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for sted at bo i København. ' + link('https://yogabible.dk/accommodation', 'Se boligmuligheder her') + '.</p>';
  html += '<p>Pris: 23.750 kr. — samme for alle formater. Forberedelsesfasen på 3.750 kr. sikrer din plads, og resten kan betales i fleksible rater. ' + link('https://www.yogabible.dk/om-200hrs-yogalaereruddannelser', 'Start Forberedelsesfasen her') + '.</p>';
  html += '<p>Det bedste du kan gøre nu er at ' + link(CONFIG.MEETING_LINK, 'booke et gratis infomøde') + ' — så hjælper jeg dig personligt med at finde det rigtige format. Du er også velkommen til bare at svare på denne mail.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse. Det er helt normalt ikke at vide hvilket format der passer bedst. Her er et overblik:\n\n';
  plain += 'Alle formater giver samme 200-timers Yoga Alliance-certifikat.\n\n';
  formats.forEach(f => {
    var sUrl = tokenize(f.sched, tokenData);
    plain += f.name + ' (' + f.period + '): ' + f.desc + '\nGod til: ' + f.good + '\nSkema: ' + sUrl + '\nLæs mere: ' + f.page + '\n\n';
  });
  plain += 'Sammenlign formater: https://www.yogabible.dk/om-200hrs-yogalaereruddannelser\n\n';
  plain += 'Pris: 23.750 kr. Forberedelsesfasen 3.750 kr. Resten i rater.\n\n';
  plain += 'Book infomøde: ' + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:undecided', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// 300h Advanced YTT (Danish, with optional schedule PDF attachment)
// =========================================================================
async function sendEmail300hYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '300-Hour Advanced YTT';
  const subject = '300-timers avanceret yogalæreruddannelse — din forespørgsel';

  const attachment = await fetchSchedulePdfAttachment('300h', program);
  const hasSchedule = !!attachment;

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores 300-timers avancerede yogalæreruddannelse — 24 uger, maj–december 2026. Programmet er designet til certificerede yogalærere, der vil fordybe deres praksis og undervisning på højeste niveau.</p>';
  if (hasSchedule) html += '<p>Jeg har vedhæftet det fulde skema, så du kan se hvordan programmet er bygget op.</p>';
  else html += '<p>Vi er ved at lægge sidste hånd på det detaljerede skema — jeg sender det til dig, så snart det er klart.</p>';
  html += '<p>Hvis du vil snakke om det, ' + link(CONFIG.MEETING_LINK, 'book en uforpligtende samtale her') + ' — eller bare svar på denne mail med dine spørgsmål.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  plain += 'Tak for din interesse i vores 300-timers avancerede yogalæreruddannelse (24 uger, maj–december 2026).\n\n';
  plain += hasSchedule ? 'Det fulde skema er vedhæftet.\n\n' : 'Det detaljerede skema er snart klart — jeg sender det til dig.\n\n';
  plain += 'Book en samtale: ' + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:300h', lang: 'da',
    attachments: attachment ? [attachment] : []
  });
  return { ...result, subject };
}

// =========================================================================
// 300h Waitlist (bilingual)
// =========================================================================
async function sendWaitlist300hEmail(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const lang = (leadData.lang || 'da').toLowerCase();
  const isEn = lang === 'en';

  const subject = isEn
    ? 'You\'re on the waitlist — 300-Hour Advanced Yoga Teacher Training'
    : 'Du er på ventelisten — 300-timers avanceret yogalæreruddannelse';

  let html, plain;
  if (isEn) {
    html = '<p>Hi ' + escapeHtml(firstName) + ',</p>';
    html += '<p>Thank you for your interest in our 300-Hour Advanced Yoga Teacher Training — we\'re thrilled to have you on the waitlist. We\'re currently designing the most comprehensive 300-hour program in Scandinavia, and as soon as it opens for applications you\'ll be among the first to know.</p>';
    html += '<p>What to expect: 24 weeks of advanced training in Copenhagen, RYT-500 certification through Yoga Alliance, specializations in Yin Yoga, Yoga Therapy, Pre/Postnatal, Ayurveda and more, with small cohorts for close mentoring.</p>';
    html += '<p>Feel free to reply to this email if you have any questions, or ' + link(CONFIG.MEETING_LINK, 'book a free info session here') + '.</p>';
    html += '<p>Shamir</p>';

    plain = 'Hi ' + firstName + ',\n\nThank you for your interest in our 300-Hour Advanced Yoga Teacher Training — you\'re on the waitlist. We\'ll be in touch as soon as it opens for applications.\n\n24 weeks · RYT-500 certification · small cohorts.\n\nBook a free info session: ' + CONFIG.MEETING_LINK + '\n\nShamir';
  } else {
    html = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
    html += '<p>Tak for din interesse i vores 300-timers avancerede yogalæreruddannelse — vi er glade for at have dig på ventelisten. Vi er i gang med at designe det mest ambitiøse 300-timers program i Skandinavien, og så snart uddannelsen åbner for ansøgning, vil du være blandt de første til at høre det.</p>';
    html += '<p>Hvad du kan forvente: 24 ugers avanceret uddannelse i København, RYT-500 certificering gennem Yoga Alliance, specialiseringer i Yin Yoga, Yoga Terapi, Pre/Postnatal, Ayurveda og mere, og små hold for tæt mentoring.</p>';
    html += '<p>Du er velkommen til at svare på denne mail med spørgsmål, eller ' + link(CONFIG.MEETING_LINK, 'book et gratis infomøde her') + '.</p>';
    html += '<p>Shamir</p>';

    plain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores 300-timers avancerede yogalæreruddannelse — du er på ventelisten. Vi vender tilbage så snart uddannelsen åbner for ansøgning.\n\n24 uger · RYT-500 certificering · små hold.\n\nBook et infomøde: ' + CONFIG.MEETING_LINK + '\n\nShamir';
  }

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:waitlist-300h', lang: isEn ? 'en' : 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// Specialty YTT 50h / 30h (Danish)
// =========================================================================
async function sendEmailSpecialtyYTT(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || 'Specialty Teacher Training';
  const specialty = leadData.subcategories || '';
  const subject = program + ' — din forespørgsel';

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores ' + escapeHtml(program) + '.' + (specialty ? ' Du nævnte interesse for: ' + escapeHtml(specialty) + '.' : '') + ' Vores specialmoduler er perfekte for lærere, der vil fordybe sig inden for specifikke områder. Vi er ved at finalisere 2026-skemaet.</p>';
  html += '<p>Hvis du vil vide mere, ' + link(CONFIG.MEETING_LINK, 'book en uforpligtende samtale her') + ' — eller bare svar på denne mail med dine spørgsmål.</p>';
  html += '<p>Shamir</p>';

  const plain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores ' + program + '.' + (specialty ? ' Interesse: ' + specialty + '.' : '') + '\n\nBook en samtale: ' + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:specialty', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// Courses (Danish, with optional schedule PDF attachment)
// =========================================================================
async function sendEmailCourses(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const courses = leadData.program || '';
  const preferredMonth = leadData.preferred_month || leadData.cohort_label || '';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';

  const courseList = courses.split(/[,+]/).map(c => c.trim()).filter(c => c);
  const isBundle = courseList.length > 1;
  const subject = isBundle ? 'Dine kursus-detaljer' : 'Dit kursus';

  const attachment = preferredMonth ? await fetchSchedulePdfAttachment('courses', preferredMonth) : null;
  const hasSchedule = !!attachment;

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  if (isBundle) {
    var bundleDescParts = courseList.map(c => {
      var cfg = COURSE_CONFIG[c] || {};
      return escapeHtml(c) + (cfg.description ? ' (' + cfg.description + ')' : '');
    });
    var bundlePrice = '';
    if (courseList.length === 2) bundlePrice = ' Bundle-pris (2 kurser): 4.140 kr. — du sparer 10%.';
    else if (courseList.length === 3) bundlePrice = ' All-In Bundle: 5.865 kr. — du sparer 15% og får et gratis 1-måneds yogapas.';
    html += '<p>Tak for din interesse i vores kursusbundle. Du valgte: ' + bundleDescParts.join(', ') + '.' + bundlePrice + '</p>';
  } else {
    html += '<p>Tak for din interesse i vores ' + escapeHtml(courses) + '-kursus. Pris: 2.300 kr.</p>';
  }

  if (preferredMonth) html += '<p>Foretrukken måned: ' + escapeHtml(preferredMonth) + '. ' + (hasSchedule ? 'Jeg har vedhæftet kursusskemaet for ' + escapeHtml(preferredMonth) + '.' : 'Skemaet er ved at blive finaliseret — jeg sender det til dig snart.') + '</p>';

  if (needsHousing) html += '<p>Om bolig: jeg kan se du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for sted at bo i København. ' + link('https://yogabible.dk/accommodation', 'Se boligmuligheder her') + '.</p>';

  // Direct enrollment link (if single course + month known)
  if (!isBundle && courseList.length === 1 && preferredMonth) {
    var paymentUrl = getCoursePaymentUrl(courseList[0], preferredMonth);
    if (paymentUrl) html += '<p>Klar til at tilmelde dig? ' + link(paymentUrl, 'Tilmeld dig her') + '.</p>';
  } else if (isBundle && preferredMonth) {
    var bundleUrl = getBundlePaymentUrl(courseList, preferredMonth);
    if (bundleUrl) html += '<p>Klar til at tilmelde dig? ' + link(bundleUrl, 'Få din bundle her') + '.</p>';
  }

  html += '<p>Hvis du har spørgsmål, ' + link(CONFIG.MEETING_LINK, 'book en samtale her') + ' — eller bare svar på denne mail.</p>';
  html += '<p>Shamir</p>';

  let plain = 'Hej ' + firstName + ',\n\n';
  if (isBundle) plain += 'Du valgte: ' + courseList.join(', ') + '\n';
  else plain += 'Kursus: ' + courses + '. Pris: 2.300 kr.\n';
  if (preferredMonth) plain += 'Foretrukken måned: ' + preferredMonth + '\n';
  plain += '\n';
  if (needsHousing) plain += 'Om bolig: https://yogabible.dk/accommodation\n\n';
  plain += 'Book en samtale: ' + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:courses', lang: 'da',
    attachments: attachment ? [attachment] : []
  });
  return { ...result, subject };
}

// =========================================================================
// Mentorship (Danish)
// =========================================================================
async function sendEmailMentorship(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const service = leadData.service || 'Mentorship';
  const subcategories = leadData.subcategories || '';
  const message = leadData.message || '';
  const subject = 'Din mentorship-forespørgsel';

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak for din interesse i vores ' + escapeHtml(service) + '-program.' + (subcategories ? ' Interesseområder: ' + escapeHtml(subcategories) + '.' : '') + (message ? ' Din besked: ' + escapeHtml(message) : '') + '</p>';
  html += '<p>Jeg vil gerne høre mere om dine mål. Lad os ' + link(CONFIG.MEETING_LINK, 'booke en kort samtale her') + ' — eller bare svar direkte på denne mail.</p>';
  html += '<p>Shamir</p>';

  const plain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores ' + service + '-program.\n\nBook en gratis samtale: ' + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:mentorship', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// Generic / Contact (Danish)
// =========================================================================
async function sendEmailGeneric(leadData, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const subject = 'Tak for din henvendelse';

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  html += '<p>Tak fordi du tog kontakt til Yoga Bible. Vi har modtaget din forespørgsel og vender tilbage snarest.</p>';
  html += '<p>I mellemtiden er du velkommen til at ' + link(CONFIG.MEETING_LINK, 'booke en samtale her') + ', eller besøge ' + link('https://www.yogabible.dk', 'yogabible.dk') + '. Du kan også bare svare på denne mail med spørgsmål.</p>';
  html += '<p>Shamir</p>';

  const plain = 'Hej ' + firstName + ',\n\nTak fordi du tog kontakt. Vi vender tilbage snarest.\n\nBook en samtale: ' + CONFIG.MEETING_LINK + '\nBesøg: https://www.yogabible.dk\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:generic', lang: 'da'
  });
  return { ...result, subject };
}

// =========================================================================
// Bilingual program email — used for EN/DE leads with a known YTT program
// =========================================================================

const PROGRAM_COPY = {
  '4-week': {
    en: { name: '4-Week Intensive Yoga Teacher Training', cohort: 'April 2026', schedPath: '/en/schedule/4-weeks-intensive/', page: 'https://www.yogabible.dk/en/200-hours-4-weeks-intensive-programs', desc: 'Fully immersive — daily training and theory across 4 weeks. Hatha, Vinyasa, Yin, Hot Yoga and Meditation. Most students who start have practised for 1–2 years; the format meets you where you are.' },
    de: { name: '4-wöchige Intensiv-Yogalehrerausbildung', cohort: 'April 2026', schedPath: '/en/schedule/4-weeks-intensive/', page: 'https://www.yogabible.dk/en/200-hours-4-weeks-intensive-programs', desc: 'Voll immersiv — tägliches Training und Theorie über 4 Wochen. Hatha, Vinyasa, Yin, Hot Yoga und Meditation.' }
  },
  '4-week-jun': {
    en: { name: '4-Week Complete Program', cohort: 'June 2026', schedPath: '/en/schedule/4-weeks-june/', page: 'https://www.yogabible.dk/en/200-hours-4-weeks-intensive-programs', desc: 'Fully immersive — daily training and theory across 4 weeks. Hatha, Vinyasa, Yin, Hot Yoga and Meditation. Starts June 1, graduates June 28.' },
    de: { name: '4-wöchiges Complete-Programm', cohort: 'Juni 2026', schedPath: '/en/schedule/4-weeks-june/', page: 'https://www.yogabible.dk/en/200-hours-4-weeks-intensive-programs', desc: 'Voll immersiv — tägliches Training und Theorie über 4 Wochen. Beginnt am 1. Juni, Abschluss am 28. Juni.' }
  },
  '4-week-jul': {
    en: { name: '4-Week Vinyasa Plus', cohort: 'July 2026', schedPath: '/en/schedule/4-weeks-july-plan/', page: 'https://www.yogabible.dk/en/200-hours-4-weeks-intensive-programs', desc: '70% Vinyasa Flow + 30% Yin Yoga + Hot Yoga. You\'ll be certified to teach both non-heated and heated classes.' },
    de: { name: '4-Wochen Vinyasa Plus', cohort: 'Juli 2026', schedPath: '/en/schedule/4-weeks-july-plan/', page: 'https://www.yogabible.dk/en/200-hours-4-weeks-intensive-programs', desc: '70% Vinyasa Flow + 30% Yin Yoga + Hot Yoga. Du wirst zertifiziert, sowohl unbeheizte als auch beheizte Stunden zu unterrichten.' }
  },
  '8-week': {
    en: { name: '8-Week Semi-Intensive Program', cohort: 'May–June 2026', schedPath: '/en/schedule/8-weeks/', page: 'https://www.yogabible.dk/en/200-hours-8-weeks-semi-intensive-programs', desc: 'A balance of intensity and everyday life — focused enough to make real progress, with room for work or family alongside.' },
    de: { name: '8-wöchiges Semi-Intensiv-Programm', cohort: 'Mai–Juni 2026', schedPath: '/en/schedule/8-weeks/', page: 'https://www.yogabible.dk/en/200-hours-8-weeks-semi-intensive-programs', desc: 'Eine Balance aus Intensität und Alltag — fokussiert genug für echte Fortschritte, mit Raum für Arbeit oder Familie nebenbei.' }
  },
  '18-week': {
    en: { name: '18-Week Flexible Program', cohort: 'Spring 2026', schedPath: '/en/schedule/18-weeks/', page: 'https://www.yogabible.dk/en/200-hours-18-weeks-flexible-programs', desc: 'The most flexible format — choose weekday or weekend track and switch freely. 60 yoga classes included.' },
    de: { name: '18-wöchiges Flexibles Programm', cohort: 'Frühjahr 2026', schedPath: '/en/schedule/18-weeks/', page: 'https://www.yogabible.dk/en/200-hours-18-weeks-flexible-programs', desc: 'Das flexibelste Format — wähle Wochentag- oder Wochenend-Track und wechsle frei. 60 Yogaklassen inklusive.' }
  },
  '18-week-aug': {
    en: { name: '18-Week Flexible Program', cohort: 'August–December 2026', schedPath: '/en/schedule/18-weeks-august/', page: 'https://www.yogabible.dk/en/200-hours-18-weeks-flexible-programs', desc: 'Autumn cohort — start August 10, graduate December 13. Choose weekday or weekend track and switch freely. 60 yoga classes included.' },
    de: { name: '18-wöchiges Flexibles Programm', cohort: 'August–Dezember 2026', schedPath: '/en/schedule/18-weeks-august/', page: 'https://www.yogabible.dk/en/200-hours-18-weeks-flexible-programs', desc: 'Herbstkurs — Start am 10. August, Abschluss am 13. Dezember. Wähle Wochentag- oder Wochenend-Track und wechsle frei.' }
  },
  '300h': {
    en: { name: '300-Hour Advanced Yoga Teacher Training', cohort: 'May–December 2026', schedPath: '/en/schedule/300-hour/', page: 'https://www.yogabible.dk/en/300-hour-advanced-yoga-teacher-training', desc: '24 weeks of advanced training in Copenhagen. RYT-500 certification through Yoga Alliance.' },
    de: { name: '300-Stunden Advanced Yogalehrerausbildung', cohort: 'Mai–Dezember 2026', schedPath: '/en/schedule/300-hour/', page: 'https://www.yogabible.dk/en/300-hour-advanced-yoga-teacher-training', desc: '24 Wochen fortgeschrittenes Training in Kopenhagen. RYT-500 Zertifizierung durch Yoga Alliance.' }
  },
  'specialty': {
    en: { name: 'Specialty Teacher Training', cohort: '2026', schedPath: '', page: 'https://www.yogabible.dk/en/specialty-teacher-trainings', desc: 'Specialised modules for teachers who want to deepen their expertise in specific areas.' },
    de: { name: 'Spezialisierungs-Lehrerausbildung', cohort: '2026', schedPath: '', page: 'https://www.yogabible.dk/en/specialty-teacher-trainings', desc: 'Spezialisierte Module für Lehrer, die ihr Fachwissen in bestimmten Bereichen vertiefen möchten.' }
  }
};

async function sendProgramEmail(leadData, programKey, lang, tokenData) {
  const firstName = leadData.first_name || '';
  const isEn = lang === 'en';
  const copy = (PROGRAM_COPY[programKey] || PROGRAM_COPY['4-week'])[isEn ? 'en' : 'de'];
  const country = (leadData.country || 'OTHER').toUpperCase();
  const localizedPrice = getLocalizedPrepPrice(country);
  const fullPrice = isEn ? '23,750 DKK' : '23.750 DKK';
  const remaining = isEn ? '20,000 DKK' : '20.000 DKK';

  const sUrl = copy.schedPath ? tokenize('https://www.yogabible.dk' + copy.schedPath, tokenData) : '';
  const subject = isEn
    ? 'Dates for the ' + copy.name + ' (' + copy.cohort + ')'
    : 'Termine für die ' + copy.name + ' (' + copy.cohort + ')';

  let html = '';
  html += '<p>' + (isEn ? 'Hi ' : 'Hej ') + escapeHtml(firstName) + ',</p>';

  if (isEn) {
    html += '<p>Thanks for your interest in our ' + copy.name + ' (' + copy.cohort + ').' + (sUrl ? ' Here are all the training days and times: ' + link(sUrl, 'View the schedule') + '.' : '') + ' You can add the dates directly to your calendar.</p>';
    html += '<p>' + copy.desc + '</p>';
    html += '<p>200 hours, Yoga Alliance certified (RYT-200). Anatomy, philosophy, sequencing and teaching methodology. All levels welcome. We\'ve been training yoga teachers since 2014.</p>';
    html += '<p>The Preparation Phase (' + localizedPrice + ') reserves your place — the amount is deducted from the full price of ' + fullPrice + ', so the remaining ' + remaining + ' can be paid in flexible instalments. ' + link(copy.page, 'Start the Preparation Phase here') + '.</p>';
    html += '<p>If you\'d like to talk about it, ' + link(CONFIG.MEETING_LINK, 'book a free info session here') + ' — or just reply to this email.</p>';
  } else {
    html += '<p>Vielen Dank für dein Interesse an unserer ' + copy.name + ' (' + copy.cohort + ').' + (sUrl ? ' Hier sind alle Trainingstage und -zeiten: ' + link(sUrl, 'Stundenplan ansehen') + '.' : '') + ' Du kannst die Termine direkt in deinen Kalender übernehmen.</p>';
    html += '<p>' + copy.desc + '</p>';
    html += '<p>200 Stunden, Yoga Alliance zertifiziert (RYT-200). Anatomie, Philosophie, Sequencing und Unterrichtsmethodik. Alle Levels willkommen. Wir bilden seit 2014 Yogalehrer aus.</p>';
    html += '<p>Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz — der Betrag wird vom Gesamtpreis von ' + fullPrice + ' abgezogen, sodass der Rest von ' + remaining + ' in flexiblen Raten bezahlt werden kann. ' + link(copy.page, 'Vorbereitungsphase hier starten') + '.</p>';
    html += '<p>Wenn du darüber sprechen möchtest, ' + link(CONFIG.MEETING_LINK, 'buche hier ein kostenloses Online-Gespräch') + ' — oder antworte einfach auf diese E-Mail.</p>';
  }
  html += '<p>Shamir</p>';

  let plain = (isEn ? 'Hi ' : 'Hej ') + firstName + ',\n\n';
  plain += (isEn ? 'Thanks for your interest in our ' : 'Vielen Dank für dein Interesse an unserer ') + copy.name + ' (' + copy.cohort + ').\n\n';
  if (sUrl) plain += (isEn ? 'Schedule and dates: ' : 'Stundenplan und Termine: ') + sUrl + '\n\n';
  plain += copy.desc + '\n\n';
  plain += (isEn ? 'Preparation Phase: ' : 'Vorbereitungsphase: ') + localizedPrice + '\nStart: ' + copy.page + '\n\n';
  plain += (isEn ? 'Book a call: ' : 'Gespräch buchen: ') + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:' + programKey, lang: lang
  });
  return { ...result, subject };
}

// =========================================================================
// Multi-format (EN/DE)
// =========================================================================
async function sendMultiFormatEmail(leadData, lang, tokenData) {
  const firstName = leadData.first_name || '';
  const isEn = lang === 'en';
  const formats = (leadData.all_formats || '').split(',').map(s => s.trim()).filter(Boolean);
  const country = (leadData.country || 'OTHER').toUpperCase();
  const localizedPrice = getLocalizedPrepPrice(country);

  const subject = isEn ? 'Your YTT schedules' : 'Deine YTT-Stundenpläne';

  let html = '';
  html += '<p>' + (isEn ? 'Hi ' : 'Hej ') + escapeHtml(firstName) + ',</p>';
  html += '<p>' + (isEn ? 'Thanks for your interest in our 200-Hour Yoga Teacher Training. You\'re comparing a few formats — good thinking. Below are the schedules and dates for each.'
                       : 'Vielen Dank für dein Interesse an unserer 200-Stunden Yogalehrerausbildung. Du vergleichst mehrere Formate — gute Überlegung. Hier sind die Stundenpläne und Termine für jedes.') + '</p>';
  html += '<p>' + (isEn ? 'A quick question: is it because you have work, study, or other commitments that affect which format fits best? Just reply and I\'ll help you find the right match.'
                       : 'Eine kurze Frage: Liegt es daran, dass du Arbeit, Studium oder andere Verpflichtungen hast, die beeinflussen, welches Format am besten passt? Antworte einfach, und ich helfe dir, das richtige Match zu finden.') + '</p>';

  formats.forEach(f => {
    var copy = PROGRAM_COPY[f === '18w' ? '18-week' : f === '18w-aug' ? '18-week-aug' : f === '18w-mar' ? '18-week' : f === '8w' ? '8-week' : f === '4w' ? '4-week' : f === '4w-jun' ? '4-week-jun' : f === '4w-jul' ? '4-week-jul' : f];
    if (!copy) return;
    var c = copy[isEn ? 'en' : 'de'];
    var sUrl = c.schedPath ? tokenize('https://www.yogabible.dk' + c.schedPath, tokenData) : '';
    html += '<p><strong>' + escapeHtml(c.name) + '</strong> (' + escapeHtml(c.cohort) + '): ' + c.desc + (sUrl ? ' ' + link(sUrl, isEn ? 'View schedule' : 'Stundenplan ansehen') : '') + ' · ' + link(c.page, isEn ? 'read more' : 'mehr erfahren') + '.</p>';
  });

  html += '<p>' + (isEn ? 'All formats give you the same 200-Hour Yoga Alliance certification with the same curriculum.'
                       : 'Alle Formate führen zur gleichen 200-Stunden Yoga Alliance Zertifizierung mit demselben Curriculum.') + '</p>';
  html += '<p>' + (isEn ? 'The Preparation Phase (' + localizedPrice + ') reserves your place — same price for any format. Pay the rest in flexible instalments. '
                       : 'Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz — gleicher Preis für jedes Format. Den Rest in flexiblen Raten zahlen. ')
            + link('https://www.yogabible.dk/en/200-hours-yoga-teacher-trainings', isEn ? 'Start the Preparation Phase here' : 'Vorbereitungsphase hier starten') + '.</p>';
  html += '<p>' + (isEn ? 'If you\'d like to talk it through, ' : 'Wenn du darüber sprechen möchtest, ')
            + link(CONFIG.MEETING_LINK, isEn ? 'book a free info session here' : 'buche hier ein kostenloses Online-Gespräch') + '.</p>';
  html += '<p>Shamir</p>';

  let plain = (isEn ? 'Hi ' : 'Hej ') + firstName + ',\n\n';
  plain += (isEn ? 'Thanks for your interest. You\'re comparing several formats. Below are the details:\n\n' : 'Vielen Dank für dein Interesse. Du vergleichst mehrere Formate:\n\n');
  formats.forEach(f => {
    var copy = PROGRAM_COPY[f === '18w' ? '18-week' : f === '18w-aug' ? '18-week-aug' : f === '8w' ? '8-week' : f === '4w' ? '4-week' : f === '4w-jun' ? '4-week-jun' : f === '4w-jul' ? '4-week-jul' : f];
    if (!copy) return;
    var c = copy[isEn ? 'en' : 'de'];
    plain += c.name + ' (' + c.cohort + '): ' + c.desc + '\n' + (isEn ? 'Read more: ' : 'Mehr: ') + c.page + '\n\n';
  });
  plain += (isEn ? 'Preparation Phase: ' : 'Vorbereitungsphase: ') + localizedPrice + '\n\n';
  plain += (isEn ? 'Book a call: ' : 'Gespräch buchen: ') + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:multi-format', lang: lang
  });
  return { ...result, subject };
}

// =========================================================================
// Undecided (EN/DE)
// =========================================================================
async function sendUndecidedEmail(leadData, lang, tokenData) {
  const firstName = leadData.first_name || '';
  const isEn = lang === 'en';
  const country = (leadData.country || 'OTHER').toUpperCase();
  const localizedPrice = getLocalizedPrepPrice(country);

  const subject = isEn ? 'Find your perfect YTT format' : 'Finde dein perfektes YTT-Format';

  const formatKeys = ['4-week-jun', '8-week', '4-week-jul', '18-week-aug'];

  let html = '';
  html += '<p>' + (isEn ? 'Hi ' : 'Hej ') + escapeHtml(firstName) + ',</p>';
  html += '<p>' + (isEn ? 'Thanks for your interest in our 200-Hour Yoga Teacher Training. It\'s normal not to know which format suits you best — it depends on your everyday life, your goals and how you learn. Here\'s an overview.'
                       : 'Vielen Dank für dein Interesse an unserer 200-Stunden Yogalehrerausbildung. Es ist normal, nicht zu wissen, welches Format am besten passt — es hängt von deinem Alltag, deinen Zielen und deinem Lernstil ab. Hier ist eine Übersicht.') + '</p>';
  html += '<p>' + (isEn ? 'All formats give you the same 200-hour Yoga Alliance certification with the same curriculum: Hatha, Vinyasa, Yin, Hot Yoga, Meditation, anatomy, philosophy and teaching methodology.'
                       : 'Alle Formate führen zur gleichen 200-Stunden Yoga Alliance Zertifizierung mit demselben Curriculum: Hatha, Vinyasa, Yin, Hot Yoga, Meditation, Anatomie, Philosophie und Unterrichtsmethodik.') + '</p>';

  formatKeys.forEach(k => {
    var copy = (PROGRAM_COPY[k] || {})[isEn ? 'en' : 'de'];
    if (!copy) return;
    var sUrl = copy.schedPath ? tokenize('https://www.yogabible.dk' + copy.schedPath, tokenData) : '';
    html += '<p><strong>' + escapeHtml(copy.name) + '</strong> (' + escapeHtml(copy.cohort) + '): ' + copy.desc + (sUrl ? ' ' + link(sUrl, isEn ? 'See schedule' : 'Stundenplan ansehen') : '') + ' · ' + link(copy.page, isEn ? 'read more' : 'mehr erfahren') + '.</p>';
  });

  html += '<p>' + (isEn ? 'The Preparation Phase (' + localizedPrice + ') reserves your place — same price for any format. '
                       : 'Die Vorbereitungsphase (' + localizedPrice + ') reserviert deinen Platz — gleicher Preis für jedes Format. ')
            + link('https://www.yogabible.dk/en/200-hours-yoga-teacher-trainings', isEn ? 'Start the Preparation Phase here' : 'Vorbereitungsphase hier starten') + '.</p>';
  html += '<p>' + (isEn ? 'The best thing you can do now is ' : 'Das Beste, was du jetzt tun kannst, ist ')
            + link(CONFIG.MEETING_LINK, isEn ? 'book a free info session' : 'ein kostenloses Online-Gespräch zu buchen')
            + (isEn ? ' so I can help you personally find the right format. Or just reply to this email.'
                    : ', damit ich dir persönlich helfen kann, das richtige Format zu finden. Oder antworte einfach auf diese E-Mail.') + '</p>';
  html += '<p>Shamir</p>';

  let plain = (isEn ? 'Hi ' : 'Hej ') + firstName + ',\n\n';
  plain += (isEn ? 'Thanks for your interest. Here\'s an overview of all formats:\n\n' : 'Vielen Dank für dein Interesse. Hier ist eine Übersicht aller Formate:\n\n');
  formatKeys.forEach(k => {
    var copy = (PROGRAM_COPY[k] || {})[isEn ? 'en' : 'de'];
    if (!copy) return;
    plain += copy.name + ' (' + copy.cohort + '): ' + copy.desc + '\n' + (isEn ? 'Read more: ' : 'Mehr: ') + copy.page + '\n\n';
  });
  plain += (isEn ? 'Preparation Phase: ' : 'Vorbereitungsphase: ') + localizedPrice + '\n\n';
  plain += (isEn ? 'Book an info session: ' : 'Infogespräch buchen: ') + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:undecided', lang: lang
  });
  return { ...result, subject };
}

// =========================================================================
// Generic / Contact (EN/DE)
// =========================================================================
async function sendEmailGenericBilingual(leadData, lang, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const isEn = lang === 'en';
  const subject = isEn ? 'Thanks for getting in touch' : 'Vielen Dank für deine Nachricht';

  let html = '';
  html += '<p>' + (isEn ? 'Hi ' : 'Hej ') + escapeHtml(firstName) + ',</p>';
  html += '<p>' + (isEn ? 'Thanks for getting in touch with Yoga Bible. We\'ve received your message and will be back to you soon.'
                       : 'Vielen Dank für deine Nachricht an Yoga Bible. Wir haben sie erhalten und melden uns bald bei dir.') + '</p>';
  html += '<p>' + (isEn ? 'In the meantime, feel free to ' : 'In der Zwischenzeit kannst du gerne ')
            + link(CONFIG.MEETING_LINK, isEn ? 'book a call here' : 'hier ein Gespräch buchen')
            + ' ' + (isEn ? 'or visit ' : 'oder ') + link(isEn ? 'https://www.yogabible.dk/en/' : 'https://www.yogabible.dk/en/', 'yogabible.dk') + (isEn ? '. You can also just reply to this email with questions.' : ' besuchen. Du kannst auch einfach auf diese E-Mail antworten.') + '</p>';
  html += '<p>Shamir</p>';

  const plain = (isEn ? 'Hi ' : 'Hej ') + firstName + ',\n\n' +
    (isEn ? 'Thanks for getting in touch. We\'ll be back to you soon.\n\nBook a call: ' : 'Vielen Dank. Wir melden uns bald.\n\nGespräch buchen: ') + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:generic', lang: lang
  });
  return { ...result, subject };
}

// =========================================================================
// Mentorship (EN/DE)
// =========================================================================
async function sendMentorshipEmail(leadData, lang, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const isEn = lang === 'en';
  const service = leadData.service || leadData.program || 'Mentorship';
  const subject = isEn ? 'Your mentorship request' : 'Deine Mentorship-Anfrage';

  let html = '';
  html += '<p>' + (isEn ? 'Hi ' : 'Hej ') + escapeHtml(firstName) + ',</p>';
  html += '<p>' + (isEn ? 'Thanks for your interest in our ' : 'Vielen Dank für dein Interesse an unserem ') + escapeHtml(service) + (isEn ? ' program. I\'d love to hear more about your goals.' : '-Programm. Ich würde gerne mehr über deine Ziele erfahren.') + '</p>';
  html += '<p>' + (isEn ? 'Let\'s ' : 'Lass uns ') + link(CONFIG.MEETING_LINK, isEn ? 'book a short call here' : 'hier ein kurzes Gespräch buchen') + (isEn ? ' — or just reply to this email directly.' : ' — oder antworte einfach direkt auf diese E-Mail.') + '</p>';
  html += '<p>Shamir</p>';

  const plain = (isEn ? 'Hi ' : 'Hej ') + firstName + ',\n\n' +
    (isEn ? 'Thanks for your interest in our ' : 'Vielen Dank für dein Interesse an unserem ') + service + (isEn ? ' program.\n\nBook a free call: ' : '-Programm.\n\nKostenloses Gespräch buchen: ') + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:mentorship', lang: lang
  });
  return { ...result, subject };
}

// =========================================================================
// Courses (EN/DE)
// =========================================================================
async function sendCoursesEmail(leadData, lang, tokenData = {}) {
  const firstName = leadData.first_name || '';
  const isEn = lang === 'en';
  const courses = leadData.program || '';
  const courseList = courses.split(/[,+]/).map(s => s.trim()).filter(Boolean);
  const isBundle = courseList.length > 1;

  const subject = isEn ? (isBundle ? 'Your course bundle details' : 'Your course') : (isBundle ? 'Deine Kurspaket-Details' : 'Dein Kurs');

  let html = '';
  html += '<p>' + (isEn ? 'Hi ' : 'Hej ') + escapeHtml(firstName) + ',</p>';
  if (isBundle) {
    html += '<p>' + (isEn ? 'Thanks for your interest in our course bundle. You chose: ' : 'Vielen Dank für dein Interesse an unserem Kurspaket. Du hast gewählt: ') + escapeHtml(courseList.join(', ')) + '.';
    if (courseList.length === 2) html += ' ' + (isEn ? 'Bundle price: 4,140 DKK — you save 10%.' : 'Paketpreis: 4.140 DKK — du sparst 10%.');
    else if (courseList.length >= 3) html += ' ' + (isEn ? 'All-In Bundle: 5,865 DKK — you save 15% and get a free 1-month yoga pass.' : 'All-In Paket: 5.865 DKK — du sparst 15% und bekommst einen kostenlosen 1-Monats-Yogapass.');
    html += '</p>';
  } else {
    html += '<p>' + (isEn ? 'Thanks for your interest in our ' : 'Vielen Dank für dein Interesse an unserem ') + escapeHtml(courses) + (isEn ? ' course. Price: 2,300 DKK.' : '-Kurs. Preis: 2.300 DKK.') + '</p>';
  }
  html += '<p>' + (isEn ? 'If you have questions, ' : 'Wenn du Fragen hast, ') + link(CONFIG.MEETING_LINK, isEn ? 'book a call here' : 'buche hier ein Gespräch') + ' — ' + (isEn ? 'or just reply to this email.' : 'oder antworte einfach auf diese E-Mail.') + '</p>';
  html += '<p>Shamir</p>';

  const plain = (isEn ? 'Hi ' : 'Hej ') + firstName + ',\n\n' + (isBundle ? (isEn ? 'You chose: ' : 'Du hast gewählt: ') + courseList.join(', ') : (isEn ? 'Course: ' : 'Kurs: ') + courses) + '\n\n' + (isEn ? 'Book a call: ' : 'Gespräch buchen: ') + CONFIG.MEETING_LINK + '\n\nShamir';

  const result = await sendSingleViaResend({
    to: leadData.email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: (tokenData || {}).leadId, campaignId: 'welcome:courses', lang: lang
  });
  return { ...result, subject };
}

// =========================================================================
// Application Confirmation (Danish)
// =========================================================================
async function sendApplicationConfirmation(email, applicationId, firstName) {
  const subject = 'Tak for din ansøgning';

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName || '') + ',</p>';
  html += '<p>Tak for din ansøgning til Yoga Bible. Dit ansøgnings-ID er ' + escapeHtml(applicationId) + '. Vi kigger din ansøgning igennem og vender tilbage med næste skridt.</p>';
  html += '<p>Har du spørgsmål i mellemtiden? Svar bare på denne mail eller ring til ' + link('tel:+4553881209', '+45 53 88 12 09') + '.</p>';
  html += '<p>Shamir</p>';

  const plain = 'Hej ' + (firstName || '') + ',\n\nTak for din ansøgning til Yoga Bible. Ansøgnings-ID: ' + applicationId + '. Vi vender tilbage.\n\nSpørgsmål? Svar på denne mail eller ring +45 53 88 12 09.\n\nShamir';

  const result = await sendSingleViaResend({
    to: email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: null, campaignId: 'welcome:application', lang: 'da'
  });
  await logWelcomeEmail(email, subject, null);
  return { ...result, subject };
}

// =========================================================================
// Careers Auto-Reply (Danish)
// =========================================================================
async function sendCareersConfirmation(email, firstName, category, role) {
  const subject = 'Tak for din ansøgning — Yoga Bible Careers';

  let html = '';
  html += '<p>Hej ' + escapeHtml(firstName || '') + ',</p>';
  html += '<p>Tak for din interesse i at blive en del af Yoga Bible-teamet. Vi har modtaget din ansøgning' + (category ? ' inden for ' + escapeHtml(category) : '') + (role ? ' som ' + escapeHtml(role) : '') + '. Vi gennemgår alle ansøgninger løbende og vender tilbage, hvis der er et match.</p>';
  html += '<p>Har du spørgsmål? Svar bare på denne mail.</p>';
  html += '<p>Shamir</p>';

  const plain = 'Hej ' + (firstName || '') + ',\n\nTak for din interesse i Yoga Bible-teamet. Vi har modtaget din ansøgning' + (category ? ' inden for ' + category : '') + (role ? ' som ' + role : '') + '. Vi vender tilbage hvis der er et match.\n\nShamir';

  const result = await sendSingleViaResend({
    to: email, subject, bodyHtml: html, bodyPlain: plain,
    leadId: null, campaignId: 'welcome:careers', lang: 'da'
  });
  await logWelcomeEmail(email, subject, null);
  return { ...result, subject };
}

module.exports = {
  sendWelcomeEmail,
  sendApplicationConfirmation,
  sendCareersConfirmation
};
