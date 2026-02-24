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
  return '<p style="margin-top:20px;">Har du lyst til at se studiet, eller har du sp\u00f8rgsm\u00e5l? Book en uforpligtende rundvisning eller en kort samtale:</p>' +
    '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book rundvisning eller samtale</a></p>';
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
    '\u2705 Fuldt refunderbar \u2014 uden betingelser<br><br>' +
    '<span style="font-size:13px;color:#555;">Forberedelsesfasen g\u00e6lder for alle tre 200-timers formater (4, 8 og 18 uger) \u2014 du v\u00e6lger format senere, s\u00e5 du kan starte uden at binde dig til \u00e9t.</span><br><br>' +
    '<a href="' + programPageUrl + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;">Start forberedelsesfasen \u2014 3.750 kr.</a>' +
    '</div>';
}

function getPreparationPhasePlain(programPageUrl) {
  return '\nVidste du? De fleste studerende starter med forberedelsesfasen allerede nu:\n' +
    '- Deltag i klasser i studiet med det samme\n' +
    '- Opbyg styrke, fleksibilitet og rutine inden uddannelsesstart\n' +
    '- M\u00f8d dine kommende medstuderende\n' +
    '- Fuldt refunderbar \u2014 uden betingelser\n' +
    'Forberedelsesfasen g\u00e6lder for alle tre 200-timers formater \u2014 du v\u00e6lger format senere.\n' +
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

async function sendWelcomeEmail(leadData, action) {
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
    let result;
    switch (action) {
      case 'lead_schedule_4w':
        result = await sendEmail4wYTT(leadData);
        break;
      case 'lead_schedule_8w':
        result = await sendEmail8wYTT(leadData);
        break;
      case 'lead_schedule_18w':
        result = await sendEmail18wYTT(leadData);
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

async function sendEmail4wYTT(leadData) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '4-Week Intensive YTT';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', dit skema til 4-ugers intensiv yogauddannelsen';

  const isFebruary = program.toLowerCase().includes('feb');
  const fullPrice = isFebruary ? '20.750' : '23.750';
  const remaining = isFebruary ? '17.000' : '20.000';
  const discountNote = isFebruary ? ' (inkl. 3.000 kr. early bird-rabat)' : '';
  const rateNote = 'kan betales i 2\u20134 rater';

  const attachment = await fetchSchedulePdfAttachment('4-week', program);
  const hasSchedule = !!attachment;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>4-ugers intensive 200-timers yogal\u00e6reruddannelse</strong>.</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedh\u00e6ftet det fulde skema for <strong>' + escapeHtml(program) + '</strong>, s\u00e5 du kan se pr\u00e6cis hvordan dagene ser ud.</p>';
  } else {
    bodyHtml += '<p>Skemaet for <strong>' + escapeHtml(program) + '</strong> er ved at blive f\u00e6rdiggjort. Jeg sender det til dig, s\u00e5 snart det er klar.</p>';
  }

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
  bodyPlain += hasSchedule ? 'Jeg har vedh\u00e6ftet det fulde skema for ' + program + '.\n\n' : 'Skemaet for ' + program + ' er ved at blive f\u00e6rdiggjort. Jeg sender det snarest.\n\n';
  bodyPlain += programHighlightsPlain();
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\nPris: ' + fullPrice + ' kr.' + discountNote + '\nForberedelsesfasen: 3.750 kr.\nRest: ' + remaining + ' kr. (' + rateNote + ')\n\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-4-weeks-intensive-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs\n';
  bodyPlain += 'Book rundvisning: ' + CONFIG.MEETING_LINK + '\n';
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
// 8-Week YTT Email
// =========================================================================

async function sendEmail8wYTT(leadData) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '8-Week Semi-Intensive YTT';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', dit skema til 8-ugers yogauddannelsen';

  const attachment = await fetchSchedulePdfAttachment('8-week', program);
  const hasSchedule = !!attachment;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>8-ugers semi-intensive 200-timers yogal\u00e6reruddannelse</strong>.</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedh\u00e6ftet det fulde skema for <strong>' + escapeHtml(program) + '</strong>, s\u00e5 du kan se hvordan ugerne er bygget op.</p>';
  } else {
    bodyHtml += '<p>Skemaet for <strong>' + escapeHtml(program) + '</strong> er ved at blive f\u00e6rdiggjort. Jeg sender det til dig, s\u00e5 snart det er klar.</p>';
  }

  bodyHtml += '<p style="margin-top:16px;">8-ugers formatet giver en god balance: nok intensitet til at holde fokus og g\u00f8re reelle fremskridt, men stadig plads til arbejde, familie eller andre forpligtelser. Det er et popul\u00e6rt valg for dem, der gerne vil have en dyb oplevelse uden at s\u00e6tte hele livet p\u00e5 pause.</p>';
  bodyHtml += programHighlightsHtml(['Online backup hvis du ikke kan m\u00f8de op en dag']);
  bodyHtml += alumniNote();

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'kan betales i 2\u20134 rater');
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs" style="color:#f75c03;">L\u00e6s mere om 8-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 8-ugers semi-intensive 200-timers yogal\u00e6reruddannelse.\n\n';
  bodyPlain += hasSchedule ? 'Jeg har vedh\u00e6ftet det fulde skema for ' + program + '.\n\n' : 'Skemaet for ' + program + ' er ved at blive f\u00e6rdiggjort. Jeg sender det snarest.\n\n';
  bodyPlain += programHighlightsPlain(['Online backup hvis du ikke kan m\u00f8de op']);
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += '\n' + getPricingSectionPlain('23.750', '3.750', '20.000', 'kan betales i 2\u20134 rater') + '\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs\n';
  bodyPlain += 'Book rundvisning: ' + CONFIG.MEETING_LINK + '\n';
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
// 18-Week YTT Email
// =========================================================================

async function sendEmail18wYTT(leadData) {
  const firstName = leadData.first_name || '';
  const program = leadData.program || '18-Week Flexible YTT';
  const needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  const cityCountry = leadData.city_country || '';
  const subject = firstName + ', dit skema til 18-ugers yogauddannelsen';

  const attachment = await fetchSchedulePdfAttachment('18-week', program);
  const hasSchedule = !!attachment;

  let bodyHtml = '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>18-ugers fleksible yogal\u00e6reruddannelse</strong>.</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedh\u00e6ftet det fulde skema, s\u00e5 du kan se hvordan ugerne er bygget op.</p>';
  } else {
    bodyHtml += '<p>Vi er ved at l\u00e6gge sidste h\u00e5nd p\u00e5 skemaet for dette hold \u2014 jeg sender det til dig, s\u00e5 snart det er klar.</p>';
  }

  bodyHtml += programHighlightsHtml([
    'V\u00e6lg hverdags- eller weekendspor \u2014 og skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op en dag',
    '60 yogaklasser i studiet inkluderet'
  ]);

  bodyHtml += '<p style="margin-top:12px;">Det, der g\u00f8r dette program unikt, er fleksibiliteten. Hver workshop k\u00f8rer to gange \u2014 \u00e9n p\u00e5 en hverdag og \u00e9n i weekenden \u2014 s\u00e5 du altid kan f\u00f8lge med, uanset hvad din uge ser ud.</p>';
  bodyHtml += '<p style="margin-top:12px;">Holdene starter i <strong>slutningen af februar/marts 2026</strong>, og vi holder bevidst holdene sm\u00e5 for at sikre personlig feedback. Der er stadig ledige pladser, men de fylder stille og roligt op.</p>';

  if (needsHousing) bodyHtml += getAccommodationSectionHtml(cityCountry);
  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'kan betales i op til 5 rater');
  bodyHtml += getPreparationPhaseHtml('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');

  bodyHtml += '<p style="margin-top:20px;"><a href="https://www.yogabible.dk/200-hours-18-weeks-flexible-programs" style="color:#f75c03;">L\u00e6s mere om 18-ugers programmet</a>';
  bodyHtml += ' \u00b7 <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a></p>';
  bodyHtml += bookingCta() + questionPrompt();
  bodyHtml += getEnglishNoteHtml() + getSignatureHtml() + getUnsubscribeFooterHtml(leadData.email);

  let bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 18-ugers fleksible yogal\u00e6reruddannelse.\n\n';
  bodyPlain += hasSchedule ? 'Jeg har vedh\u00e6ftet det fulde skema.\n\n' : 'Skemaet er ved at blive f\u00e6rdiggjort \u2014 jeg sender det til dig snarest.\n\n';
  bodyPlain += programHighlightsPlain([
    'V\u00e6lg hverdags- eller weekendspor \u2014 skift frit undervejs',
    'Online backup hvis du ikke kan m\u00f8de op',
    '60 yogaklasser inkluderet'
  ]);
  bodyPlain += '\nDet unikke er fleksibiliteten: hver workshop k\u00f8rer to gange, \u00e9n hverdag og \u00e9n weekend.\n\n';
  bodyPlain += 'Holdene starter slutningen af februar/marts 2026. Vi holder holdene sm\u00e5 \u2014 der er stadig ledige pladser.\n\n';
  if (needsHousing) bodyPlain += getAccommodationSectionPlain(cityCountry);
  bodyPlain += getPricingSectionPlain('23.750', '3.750', '20.000', 'op til 5 rater') + '\n';
  bodyPlain += getPreparationPhasePlain('https://www.yogabible.dk/200-hours-18-weeks-flexible-programs');
  bodyPlain += '\nL\u00e6s mere: https://www.yogabible.dk/200-hours-18-weeks-flexible-programs\n';
  bodyPlain += 'Book rundvisning: ' + CONFIG.MEETING_LINK + '\n';
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
