// =========================================================================
// 06_Emails.gs — Email Functions (Danish, unified tone)
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// SIGNATURES
// =========================================================================

function getSignaturePlain() {
  return '\n\nKærlig hilsen,\nShamir - Kursusdirektør\nYoga Bible (DK)\nwww.yogabible.dk\nTorvegade 66, 1400 København K, Danmark\n+45 53 88 12 09';
}

function getSignatureHtml() {
  var orange = '#f75c03';
  return '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #EBE7E3;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;">' +
    '<div style="margin:0 0 2px;">Kærlig hilsen,</div>' +
    '<div style="margin:0 0 2px;"><strong>Shamir</strong> - Kursusdirektør</div>' +
    '<div style="margin:0 0 2px;">Yoga Bible (DK)</div>' +
    '<div style="margin:0 0 2px;"><a href="https://www.yogabible.dk" style="color:' + orange + ';text-decoration:none;">www.yogabible.dk</a></div>' +
    '<div style="margin:0 0 2px;"><a href="' + CONFIG.STUDIO_MAPS_URL + '" target="_blank" style="color:' + orange + ';text-decoration:none;">Torvegade 66, 1400 København K, Danmark</a></div>' +
    '<div style="margin:0;"><a href="tel:+4553881209" style="color:' + orange + ';text-decoration:none;">+45 53 88 12 09</a></div>' +
    '</div>';
}

// =========================================================================
// English Note (appended to all lead emails)
// =========================================================================

function getEnglishNoteHtml() {
  return '<p style="margin-top:16px;font-size:13px;color:#888;border-top:1px solid #EBE7E3;padding-top:12px;">' +
    '🇬🇧 Are you an English speaker? No problem — just reply in English and I will be happy to help.</p>';
}

function getEnglishNotePlain() {
  return '\n\nAre you an English speaker? No problem — just reply in English and I will be happy to help.\n';
}

// =========================================================================
// Accommodation Section Helper (Danish)
// =========================================================================

function getAccommodationSectionHtml(cityCountry) {
  return '<div style="margin-top:16px;padding:14px;background:#E8F5E9;border-radius:6px;border-left:3px solid #4CAF50;">' +
    '<strong style="color:#2E7D32;">🏠 Bolig:</strong> ' +
    'Jeg kan se, at du' + (cityCountry ? ' kommer fra ' + escapeHtml(cityCountry) + ' og' : '') + ' har brug for bolig i København.<br><br>' +
    'Vi samarbejder med lokale udbydere. ' +
    '<strong><a href="https://yogabible.dk/accommodation" style="color:#f75c03;">Se boligmuligheder her →</a></strong><br>' +
    '<span style="color:#666;">Har du spørgsmål om bolig? Svar bare på denne e-mail.</span>' +
    '</div>';
}

function getAccommodationSectionPlain(cityCountry) {
  return '\n\nBolig: Jeg kan se du' + (cityCountry ? ' kommer fra ' + cityCountry + ' og' : '') + ' har brug for bolig i København.\n' +
    'Se muligheder: https://yogabible.dk/accommodation\n' +
    'Har du spørgsmål? Svar bare på denne e-mail.\n';
}

// =========================================================================
// Pricing Section Helper (reusable across YTT emails)
// =========================================================================

function getPricingSectionHtml(fullPrice, deposit, remaining, rateNote) {
  return '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">' +
    '<strong>Pris:</strong> ' + fullPrice + ' kr. (ingen ekstra gebyrer)<br>' +
    '<strong>Depositum:</strong> ' + deposit + ' kr. sikrer din plads<br>' +
    '<strong>Rest:</strong> ' + remaining + ' kr. (' + rateNote + ')' +
    '</div>';
}

function getPricingSectionPlain(fullPrice, deposit, remaining, rateNote) {
  return 'Pris: ' + fullPrice + ' kr. (ingen ekstra gebyrer)\n' +
    'Depositum: ' + deposit + ' kr.\n' +
    'Rest: ' + remaining + ' kr. (' + rateNote + ')\n';
}

// =========================================================================
// Application Confirmation
// =========================================================================

function sendApplicationConfirmation(email, applicationId, firstName) {
  var subject = 'Tak for din ansøgning — Yoga Bible';

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din ansøgning til <strong>Yoga Bible</strong>!</p>';
  bodyHtml += '<p>Dit ansøgnings-ID er: <strong>' + escapeHtml(applicationId) + '</strong></p>';
  bodyHtml += '<p>Vi kigger din ansøgning igennem og vender tilbage med næste skridt.</p>';
  bodyHtml += '<p>Har du spørgsmål i mellemtiden? Svar bare på denne e-mail eller ring til os på <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a>.</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  var bodyPlain = 'Hej ' + firstName + ',\n\nTak for din ansøgning til Yoga Bible!\n\nDit ansøgnings-ID er: ' + applicationId + '\n\nVi kigger din ansøgning igennem og vender tilbage.\n\nHar du spørgsmål? Svar på denne e-mail eller ring +45 53 88 12 09.' + getEnglishNotePlain() + getSignaturePlain();

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  });
}

// =========================================================================
// 4-Week YTT Email
// =========================================================================

function sendEmail4wYTT(leadData) {
  var firstName = leadData.first_name || '';
  var program = leadData.program || '4-Week Intensive YTT';
  var email = leadData.email || '';
  var programLower = program.toLowerCase();
  var needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  var cityCountry = leadData.city_country || '';
  var subject = firstName + ', dit skema til 4-ugers intensiv yogauddannelsen';

  // Check if February (has discount)
  var isFebruary = programLower.indexOf('feb') !== -1;
  var fullPrice = isFebruary ? '20.750' : '23.750';
  var remaining = isFebruary ? '17.000' : '20.000';
  var discountNote = isFebruary ? ' (inkl. 3.000 kr. early bird-rabat)' : '';
  var rateNote = 'kan betales i 2–4 rater';

  // Check if schedule is available
  var scheduleId = getScheduleFileId('4-week', program);
  var hasSchedule = scheduleId ? true : false;

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>4-ugers intensive 200-timers yogalæreruddannelse</strong>.</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedhæftet det fulde skema for <strong>' + escapeHtml(program) + '</strong>, så du kan se præcis hvordan dagene ser ud.</p>';
  } else {
    bodyHtml += '<p>Skemaet for <strong>' + escapeHtml(program) + '</strong> er ved at blive færdiggjort. Jeg sender det til dig, så snart det er klar.</p>';
  }

  bodyHtml += '<p style="margin-top:16px;">Det intensive format er til dig, der vil fordybe dig fuldt ud. På 4 uger gennemfører du hele certificeringen med daglig træning og teori — mange af vores dimittender fortæller, at det intensive format hjalp dem med at lære mere, fordi de var 100% dedikerede.</p>';

  bodyHtml += '<p style="margin-top:16px;">Kort om uddannelsen:</p>';
  bodyHtml += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  bodyHtml += '<li>200 timer · Yoga Alliance-certificeret</li>';
  bodyHtml += '<li>Hatha, Vinyasa, Yin, Hot Yoga & Meditation</li>';
  bodyHtml += '<li>Anatomi, filosofi, sekvensering & undervisningsmetodik</li>';
  bodyHtml += '<li>Alle niveauer er velkomne</li>';
  bodyHtml += '</ul>';

  bodyHtml += '<p style="margin-top:12px;">Vi har uddannet yogalærere siden 2014, og vores dimittender underviser i hele Europa og videre. Kan du ikke møde op en dag, tilbyder vi online backup på udvalgte workshops.</p>';

  if (needsHousing) {
    bodyHtml += getAccommodationSectionHtml(cityCountry);
  }

  // Pricing
  bodyHtml += '<div style="margin-top:20px;padding:14px;background:#FFFCF9;border-left:3px solid #f75c03;border-radius:4px;">';
  bodyHtml += '<strong>Pris:</strong> ' + fullPrice + ' kr.' + discountNote + '<br>';
  bodyHtml += '<strong>Depositum:</strong> 3.750 kr. sikrer din plads<br>';
  bodyHtml += '<strong>Rest:</strong> ' + remaining + ' kr. (' + rateNote + ')';
  bodyHtml += '</div>';

  // Links
  bodyHtml += '<p style="margin-top:20px;">';
  bodyHtml += '<a href="https://www.yogabible.dk/200-hours-4-weeks-intensive-programs" style="color:#f75c03;">Læs mere om 4-ugers programmet</a>';
  bodyHtml += ' · <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a>';
  bodyHtml += '</p>';

  // CTA
  bodyHtml += '<p style="margin-top:20px;">Har du lyst til at se studiet, eller har du spørgsmål? Book en uforpligtende rundvisning eller en kort samtale:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book rundvisning eller samtale</a></p>';

  bodyHtml += '<p style="margin-top:20px;">Jeg vil også gerne høre: <strong>Hvad fik dig til at overveje en yogauddannelse?</strong> Du er velkommen til bare at svare på denne mail.</p>';

  bodyHtml += '<p>Glæder mig til at høre fra dig.</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  // ---- Plain text ----
  var bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 4-ugers intensive 200-timers yogalæreruddannelse.\n\n';
  if (hasSchedule) {
    bodyPlain += 'Jeg har vedhæftet det fulde skema for ' + program + '.\n\n';
  } else {
    bodyPlain += 'Skemaet for ' + program + ' er ved at blive færdiggjort. Jeg sender det snarest.\n\n';
  }
  bodyPlain += 'Det intensive format er til dig, der vil fordybe dig fuldt ud på 4 uger.\n\n';
  bodyPlain += 'Kort om uddannelsen:\n';
  bodyPlain += '- 200 timer · Yoga Alliance-certificeret\n';
  bodyPlain += '- Hatha, Vinyasa, Yin, Hot Yoga & Meditation\n';
  bodyPlain += '- Anatomi, filosofi, sekvensering & undervisningsmetodik\n';
  bodyPlain += '- Alle niveauer velkomne\n\n';
  if (needsHousing) {
    bodyPlain += getAccommodationSectionPlain(cityCountry);
  }
  bodyPlain += 'Pris: ' + fullPrice + ' kr.' + discountNote + '\n';
  bodyPlain += 'Depositum: 3.750 kr.\n';
  bodyPlain += 'Rest: ' + remaining + ' kr. (' + rateNote + ')\n\n';
  bodyPlain += 'Læs mere: https://www.yogabible.dk/200-hours-4-weeks-intensive-programs\n';
  bodyPlain += 'Om uddannelsen: https://www.yogabible.dk/om-200hrs-yogalreruddannelser\n\n';
  bodyPlain += 'Book rundvisning eller samtale: ' + CONFIG.MEETING_LINK + '\n\n';
  bodyPlain += 'Hvad fik dig til at overveje en yogauddannelse? Svar gerne på denne mail.\n\n';
  bodyPlain += 'Glæder mig til at høre fra dig.';
  bodyPlain += getEnglishNotePlain();
  bodyPlain += getSignaturePlain();

  var options = {
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  };

  if (hasSchedule) {
    var blob = fetchDriveFileAsBlob(scheduleId);
    if (blob) options.attachments = [blob];
  }

  MailApp.sendEmail(options);
}

// =========================================================================
// 8-Week YTT Email
// =========================================================================

function sendEmail8wYTT(leadData) {
  var firstName = leadData.first_name || '';
  var program = leadData.program || '8-Week Semi-Intensive YTT';
  var email = leadData.email || '';
  var needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  var cityCountry = leadData.city_country || '';
  var subject = firstName + ', dit skema til 8-ugers yogauddannelsen';

  var scheduleId = getScheduleFileId('8-week', program);
  var hasSchedule = scheduleId ? true : false;

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>8-ugers semi-intensive 200-timers yogalæreruddannelse</strong>.</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedhæftet det fulde skema for <strong>' + escapeHtml(program) + '</strong>, så du kan se hvordan ugerne er bygget op.</p>';
  } else {
    bodyHtml += '<p>Skemaet for <strong>' + escapeHtml(program) + '</strong> er ved at blive færdiggjort. Jeg sender det til dig, så snart det er klar.</p>';
  }

  bodyHtml += '<p style="margin-top:16px;">8-ugers formatet giver en god balance: nok intensitet til at holde fokus og gøre reelle fremskridt, men stadig plads til arbejde, familie eller andre forpligtelser. Det er et populært valg for dem, der gerne vil have en dyb oplevelse uden at sætte hele livet på pause.</p>';

  bodyHtml += '<p style="margin-top:16px;">Kort om uddannelsen:</p>';
  bodyHtml += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  bodyHtml += '<li>200 timer · Yoga Alliance-certificeret</li>';
  bodyHtml += '<li>Hatha, Vinyasa, Yin, Hot Yoga & Meditation</li>';
  bodyHtml += '<li>Anatomi, filosofi, sekvensering & undervisningsmetodik</li>';
  bodyHtml += '<li>Online backup hvis du ikke kan møde op en dag</li>';
  bodyHtml += '<li>Alle niveauer er velkomne</li>';
  bodyHtml += '</ul>';

  bodyHtml += '<p style="margin-top:12px;">Vi har uddannet yogalærere siden 2014, og vores dimittender underviser i hele Europa og videre.</p>';

  if (needsHousing) {
    bodyHtml += getAccommodationSectionHtml(cityCountry);
  }

  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'kan betales i 2–4 rater');

  bodyHtml += '<p style="margin-top:20px;">';
  bodyHtml += '<a href="https://www.yogabible.dk/200-hours-8-weeks-flexible-programs" style="color:#f75c03;">Læs mere om 8-ugers programmet</a>';
  bodyHtml += ' · <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a>';
  bodyHtml += '</p>';

  bodyHtml += '<p style="margin-top:20px;">Har du lyst til at se studiet, eller har du spørgsmål? Book en uforpligtende rundvisning eller en kort samtale:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book rundvisning eller samtale</a></p>';

  bodyHtml += '<p style="margin-top:20px;">Jeg vil også gerne høre: <strong>Hvad fik dig til at overveje en yogauddannelse?</strong> Du er velkommen til bare at svare på denne mail.</p>';

  bodyHtml += '<p>Glæder mig til at høre fra dig.</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  // ---- Plain text ----
  var bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 8-ugers semi-intensive 200-timers yogalæreruddannelse.\n\n';
  if (hasSchedule) {
    bodyPlain += 'Jeg har vedhæftet det fulde skema for ' + program + '.\n\n';
  } else {
    bodyPlain += 'Skemaet for ' + program + ' er ved at blive færdiggjort. Jeg sender det snarest.\n\n';
  }
  bodyPlain += '8-ugers formatet giver en god balance mellem intensitet og plads til andre forpligtelser.\n\n';
  bodyPlain += 'Kort om uddannelsen:\n';
  bodyPlain += '- 200 timer · Yoga Alliance-certificeret\n';
  bodyPlain += '- Hatha, Vinyasa, Yin, Hot Yoga & Meditation\n';
  bodyPlain += '- Anatomi, filosofi, sekvensering & undervisningsmetodik\n';
  bodyPlain += '- Online backup hvis du ikke kan møde op\n';
  bodyPlain += '- Alle niveauer velkomne\n\n';
  if (needsHousing) {
    bodyPlain += getAccommodationSectionPlain(cityCountry);
  }
  bodyPlain += getPricingSectionPlain('23.750', '3.750', '20.000', 'kan betales i 2–4 rater') + '\n';
  bodyPlain += 'Læs mere: https://www.yogabible.dk/200-hours-8-weeks-flexible-programs\n';
  bodyPlain += 'Om uddannelsen: https://www.yogabible.dk/om-200hrs-yogalreruddannelser\n\n';
  bodyPlain += 'Book rundvisning eller samtale: ' + CONFIG.MEETING_LINK + '\n\n';
  bodyPlain += 'Hvad fik dig til at overveje en yogauddannelse? Svar gerne på denne mail.\n\n';
  bodyPlain += 'Glæder mig til at høre fra dig.';
  bodyPlain += getEnglishNotePlain();
  bodyPlain += getSignaturePlain();

  var options = {
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  };

  if (hasSchedule) {
    var blob = fetchDriveFileAsBlob(scheduleId);
    if (blob) options.attachments = [blob];
  }

  MailApp.sendEmail(options);
}

// =========================================================================
// 18-Week YTT Email
// =========================================================================

function sendEmail18wYTT(leadData) {
  var firstName = leadData.first_name || '';
  var program = leadData.program || '18-Week Flexible YTT';
  var email = leadData.email || '';
  var needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  var cityCountry = leadData.city_country || '';
  var subject = firstName + ', dit skema til 18-ugers yogauddannelsen';

  var scheduleId = getScheduleFileId('18-week', program);
  var hasSchedule = scheduleId ? true : false;

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>18-ugers fleksible yogalæreruddannelse</strong>.</p>';

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedhæftet det fulde skema, så du kan se hvordan ugerne er bygget op.</p>';
  } else {
    bodyHtml += '<p>Vi er ved at lægge sidste hånd på skemaet for dette hold — jeg sender det til dig, så snart det er klar.</p>';
  }

  bodyHtml += '<p style="margin-top:16px;">Kort om uddannelsen:</p>';
  bodyHtml += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  bodyHtml += '<li>200 timer · Yoga Alliance-certificeret</li>';
  bodyHtml += '<li>Hatha, Vinyasa, Yin, Hot Yoga & Meditation</li>';
  bodyHtml += '<li>Vælg hverdags- eller weekendspor — og skift frit undervejs</li>';
  bodyHtml += '<li>Online backup hvis du ikke kan møde op en dag</li>';
  bodyHtml += '<li>60 yogaklasser i studiet inkluderet</li>';
  bodyHtml += '<li>Alle niveauer er velkomne</li>';
  bodyHtml += '</ul>';

  bodyHtml += '<p style="margin-top:12px;">Det, der gør dette program unikt, er fleksibiliteten. Hver workshop kører to gange — én på en hverdag og én i weekenden — så du altid kan følge med, uanset hvad din uge ser ud.</p>';

  bodyHtml += '<p style="margin-top:12px;">Holdene starter i <strong>slutningen af februar/marts 2026</strong>, og vi holder bevidst holdene små for at sikre personlig feedback. Der er stadig ledige pladser, men de fylder stille og roligt op.</p>';

  if (needsHousing) {
    bodyHtml += getAccommodationSectionHtml(cityCountry);
  }

  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'kan betales i op til 5 rater');

  bodyHtml += '<p style="margin-top:20px;">';
  bodyHtml += '<a href="https://www.yogabible.dk/200-hours-18-weeks-flexible-programs" style="color:#f75c03;">Læs mere om 18-ugers programmet</a>';
  bodyHtml += ' · <a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores 200-timers uddannelse</a>';
  bodyHtml += '</p>';

  bodyHtml += '<p style="margin-top:20px;">Har du lyst til at se studiet, eller har du spørgsmål? Book en uforpligtende rundvisning eller en kort samtale:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book rundvisning eller samtale</a></p>';

  bodyHtml += '<p style="margin-top:20px;">Jeg vil også gerne høre: <strong>Hvad fik dig til at overveje en yogauddannelse?</strong> Du er velkommen til bare at svare på denne mail.</p>';

  bodyHtml += '<p>Glæder mig til at høre fra dig.</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  // ---- Plain text ----
  var bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 18-ugers fleksible yogalæreruddannelse.\n\n';
  if (hasSchedule) {
    bodyPlain += 'Jeg har vedhæftet det fulde skema.\n\n';
  } else {
    bodyPlain += 'Skemaet er ved at blive færdiggjort — jeg sender det til dig snarest.\n\n';
  }
  bodyPlain += 'Kort om uddannelsen:\n';
  bodyPlain += '- 200 timer · Yoga Alliance-certificeret\n';
  bodyPlain += '- Hatha, Vinyasa, Yin, Hot Yoga & Meditation\n';
  bodyPlain += '- Vælg hverdags- eller weekendspor — skift frit undervejs\n';
  bodyPlain += '- Online backup hvis du ikke kan møde op\n';
  bodyPlain += '- 60 yogaklasser inkluderet\n';
  bodyPlain += '- Alle niveauer velkomne\n\n';
  bodyPlain += 'Det unikke er fleksibiliteten: hver workshop kører to gange, én hverdag og én weekend.\n\n';
  bodyPlain += 'Holdene starter slutningen af februar/marts 2026. Vi holder holdene små — der er stadig ledige pladser.\n\n';
  if (needsHousing) {
    bodyPlain += getAccommodationSectionPlain(cityCountry);
  }
  bodyPlain += getPricingSectionPlain('23.750', '3.750', '20.000', 'op til 5 rater') + '\n';
  bodyPlain += 'Læs mere: https://www.yogabible.dk/200-hours-18-weeks-flexible-programs\n';
  bodyPlain += 'Om uddannelsen: https://www.yogabible.dk/om-200hrs-yogalreruddannelser\n\n';
  bodyPlain += 'Book rundvisning eller samtale: ' + CONFIG.MEETING_LINK + '\n\n';
  bodyPlain += 'Hvad fik dig til at overveje en yogauddannelse? Svar gerne på denne mail.\n\n';
  bodyPlain += 'Glæder mig til at høre fra dig.';
  bodyPlain += getEnglishNotePlain();
  bodyPlain += getSignaturePlain();

  var options = {
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  };

  if (hasSchedule) {
    var blob = fetchDriveFileAsBlob(scheduleId);
    if (blob) options.attachments = [blob];
  }

  MailApp.sendEmail(options);
}

// =========================================================================
// MULTI-FORMAT EMAIL
// =========================================================================

var MULTIFORMAT_SCHEDULE_IDS = {
  '18w': '1p6V-lR4fuVsFWqM9ctocY6YrErjGVMRT',
  '8w': '1KGPe73JYMJAxvCNirwoYeehr58irdfwP',
  '4w': '1Fjedi0yqJrL6oLMMPGtQ5FOab9zAc3IQ'
};

function sendEmailMultiFormat(leadData, formats) {
  var firstName = leadData.first_name || 'there';
  var email = leadData.email || '';
  var needsAccommodation = (leadData.accommodation || '').toLowerCase() === 'yes';
  var cityCountry = leadData.city_country || '';

  var formatNames = formats.map(function(f) {
    if (f === '18w') return '18-ugers fleksible program';
    if (f === '8w') return '8-ugers semi-intensive program';
    if (f === '4w') return '4-ugers intensive program';
    return f;
  });

  var formatList = formatNames.join(', ');
  if (formatNames.length > 1) {
    var allButLast = formatNames.slice(0, -1);
    var last = formatNames[formatNames.length - 1];
    formatList = allButLast.join(', ') + ' og ' + last;
  }

  var subject = firstName + ', dine YTT-skemaer er klar';

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  bodyHtml += '<p>Tak fordi du viste interesse for vores <strong>200-timers yogalæreruddannelse</strong>!</p>';

  bodyHtml += '<p>Jeg kan se, at du gerne vil sammenligne vores <strong>' + escapeHtml(formatList) + '</strong>. ';
  bodyHtml += 'Godt tænkt — jeg har vedhæftet skemaerne for alle de valgte formater, så du kan se præcis hvordan hvert program er opbygget.</p>';

  if (formats.length > 1) {
    bodyHtml += '<div style="margin:20px 0;padding:14px;background:#E3F2FD;border-radius:6px;border-left:3px solid #1976D2;">';
    bodyHtml += '<strong style="color:#1565C0;">💭 Et hurtigt spørgsmål:</strong><br>';
    bodyHtml += 'Jeg kan se du sammenligner flere formater. Er det fordi du har arbejde, studie eller andre forpligtelser, der påvirker hvilken form der passer bedst?<br><br>';
    bodyHtml += '<span style="color:#666;">Svar gerne på denne e-mail — så hjælper jeg dig med at finde det perfekte match!</span>';
    bodyHtml += '</div>';
  }

  bodyHtml += '<p style="margin-top:20px;"><strong>📎 Vedhæftede skemaer:</strong></p>';
  bodyHtml += '<ul style="margin:10px 0;padding-left:20px;">';
  formats.forEach(function(f) {
    if (f === '18w') bodyHtml += '<li>18-ugers fleksibelt program (marts–juni 2026)</li>';
    if (f === '8w') bodyHtml += '<li>8-ugers semi-intensivt program (maj–juni 2026)</li>';
    if (f === '4w') bodyHtml += '<li>4-ugers intensivt program (marts & april 2026)</li>';
  });
  bodyHtml += '</ul>';

  bodyHtml += '<p style="margin-top:16px;">Kort om uddannelsen:</p>';
  bodyHtml += '<ul style="margin:8px 0;padding-left:20px;color:#333;">';
  bodyHtml += '<li>200 timer · Yoga Alliance-certificeret</li>';
  bodyHtml += '<li>Hatha, Vinyasa, Yin, Hot Yoga & Meditation</li>';
  bodyHtml += '<li>Anatomi, filosofi, sekvensering & undervisningsmetodik</li>';
  bodyHtml += '<li>Alle niveauer er velkomne</li>';
  bodyHtml += '</ul>';

  bodyHtml += '<p style="margin-top:12px;">Vi har uddannet yogalærere siden 2014, og vores dimittender underviser i hele Europa og videre.</p>';

  if (needsAccommodation) {
    bodyHtml += getAccommodationSectionHtml(cityCountry);
  }

  bodyHtml += getPricingSectionHtml('23.750', '3.750', '20.000', 'samme pris for alle formater — rater mulig');

  bodyHtml += '<p style="margin-top:20px;">';
  if (formats.indexOf('18w') !== -1) bodyHtml += '<a href="https://www.yogabible.dk/200-hours-18-weeks-flexible-programs" style="color:#f75c03;">18-ugers detaljer</a> · ';
  if (formats.indexOf('8w') !== -1) bodyHtml += '<a href="https://www.yogabible.dk/200-hours-8-weeks-flexible-programs" style="color:#f75c03;">8-ugers detaljer</a> · ';
  if (formats.indexOf('4w') !== -1) bodyHtml += '<a href="https://www.yogabible.dk/200-hours-4-weeks-intensive-programs" style="color:#f75c03;">4-ugers detaljer</a> · ';
  bodyHtml += '<a href="https://www.yogabible.dk/om-200hrs-yogalreruddannelser" style="color:#f75c03;">Om vores uddannelse</a>';
  bodyHtml += '</p>';

  bodyHtml += '<p style="margin-top:20px;">Har du lyst til at se studiet eller få hjælp til at vælge det rigtige format?</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book rundvisning eller samtale</a></p>';

  bodyHtml += '<p>Glæder mig til at høre fra dig!</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  // ---- Plain text ----
  var bodyPlain = 'Hej ' + firstName + ',\n\n';
  bodyPlain += 'Tak fordi du viste interesse for vores 200-timers yogalæreruddannelse!\n\n';
  bodyPlain += 'Jeg kan se du gerne vil sammenligne vores ' + formatList + '. Jeg har vedhæftet skemaerne for alle valgte formater.\n\n';
  if (formats.length > 1) {
    bodyPlain += 'Et hurtigt spørgsmål: Er det fordi du har andre forpligtelser der påvirker dit valg? Svar gerne så jeg kan hjælpe!\n\n';
  }
  bodyPlain += 'Kort om uddannelsen:\n';
  bodyPlain += '- 200 timer · Yoga Alliance-certificeret\n';
  bodyPlain += '- Hatha, Vinyasa, Yin, Hot Yoga & Meditation\n';
  bodyPlain += '- Alle niveauer velkomne\n\n';
  if (needsAccommodation) {
    bodyPlain += getAccommodationSectionPlain(cityCountry);
  }
  bodyPlain += getPricingSectionPlain('23.750', '3.750', '20.000', 'samme pris for alle formater — rater mulig') + '\n';
  bodyPlain += 'Book rundvisning eller samtale: ' + CONFIG.MEETING_LINK + '\n\n';
  bodyPlain += 'Glæder mig til at høre fra dig!';
  bodyPlain += getEnglishNotePlain();
  bodyPlain += getSignaturePlain();

  var options = {
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  };

  var attachments = [];
  formats.forEach(function(format) {
    var scheduleId = MULTIFORMAT_SCHEDULE_IDS[format];
    if (scheduleId) {
      try {
        var blob = fetchDriveFileAsBlob(scheduleId);
        if (blob) {
          attachments.push(blob);
          Logger.log('Attached schedule for ' + format + ' (ID: ' + scheduleId + ')');
        } else {
          Logger.log('Could not fetch blob for ' + format + ' (ID: ' + scheduleId + ')');
        }
      } catch (e) {
        Logger.log('Error fetching schedule for ' + format + ': ' + e.message);
      }
    } else {
      Logger.log('No schedule ID found for format: ' + format);
    }
  });

  if (attachments.length > 0) {
    options.attachments = attachments;
    Logger.log('Total attachments: ' + attachments.length);
  }

  MailApp.sendEmail(options);
  Logger.log('Multi-format email sent to ' + email + ' with ' + attachments.length + ' attachments for formats: ' + formats.join(', '));
}

// =========================================================================
// 300h YTT Email
// =========================================================================

function sendEmail300hYTT(leadData) {
  var firstName = leadData.first_name || '';
  var email = leadData.email || '';
  var subject = 'Din forespørgsel — 300-timers avanceret yogalæreruddannelse';

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>300-timers avancerede yogalæreruddannelse</strong>!</p>';
  bodyHtml += '<p>Dette program er designet til certificerede yogalærere, der ønsker at fordybe deres praksis og undervisning.</p>';
  bodyHtml += '<p>Vi er i gang med at planlægge 2026-programmet. Vil du være blandt de første, der hører nyt?</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en uforpligtende samtale</a></p>';
  bodyHtml += '<p>Du er også velkommen til at svare på denne e-mail med dine spørgsmål.</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  var bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores 300-timers avancerede yogalæreruddannelse!\n\nVi er i gang med at planlægge 2026-programmet.\n\nBook en samtale: ' + CONFIG.MEETING_LINK + getEnglishNotePlain() + getSignaturePlain();

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  });
}

// =========================================================================
// Specialty YTT Email (50h, 30h)
// =========================================================================

function sendEmailSpecialtyYTT(leadData) {
  var firstName = leadData.first_name || '';
  var program = leadData.program || 'Specialty Teacher Training';
  var email = leadData.email || '';
  var specialty = leadData.subcategories || '';
  var subject = 'Din forespørgsel — ' + program;

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>' + escapeHtml(program) + '</strong>!</p>';
  if (specialty) bodyHtml += '<p>Du nævnte interesse for: <strong>' + escapeHtml(specialty) + '</strong></p>';
  bodyHtml += '<p>Vores specialmoduler er perfekte for lærere, der vil fordybe sig inden for specifikke områder.</p>';
  bodyHtml += '<p>Vi er ved at finalisere 2026-skemaet. Vil du vide mere?</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en uforpligtende samtale</a></p>';
  bodyHtml += '<p>Svar også gerne på denne e-mail med dine spørgsmål.</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  var bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores ' + program + '!\n\nBook en samtale: ' + CONFIG.MEETING_LINK + getEnglishNotePlain() + getSignaturePlain();

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  });
}

// =========================================================================
// Courses Email
// =========================================================================

function sendEmailCourses(leadData) {
  var firstName = leadData.first_name || '';
  var courses = leadData.program || '';
  var preferredMonth = leadData.preferred_month || leadData.cohort_label || '';
  var email = leadData.email || '';
  var needsHousing = (leadData.accommodation || '').toLowerCase() === 'yes';
  var cityCountry = leadData.city_country || '';

  var courseList = courses.split(/[,+]/).map(function(c) { return c.trim(); }).filter(function(c) { return c; });
  var isBundle = courseList.length > 1;
  var subject = isBundle ? 'Dine kursus-detaljer — Yoga Bible' : 'Dit kursus — Yoga Bible';

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';

  if (isBundle) {
    bodyHtml += '<p>Tak for din interesse i vores kursusbundle! Du valgte:</p><ul style="margin:10px 0;padding-left:20px;">';
    courseList.forEach(function(course) {
      var config = COURSE_CONFIG[course] || {};
      bodyHtml += '<li><strong>' + escapeHtml(course) + '</strong>' + (config.description ? ' — ' + config.description : '') + '</li>';
    });
    bodyHtml += '</ul>';
    if (courseList.length === 2) bodyHtml += '<p><strong>Bundle-pris (2 kurser):</strong> 4.140 kr. (spar 10%!)</p>';
    else if (courseList.length === 3) bodyHtml += '<p><strong>All-In Bundle:</strong> 5.865 kr. (spar 15% + GRATIS 1-måneds yogapas!)</p>';
  } else {
    bodyHtml += '<p>Tak for din interesse i vores <strong>' + escapeHtml(courses) + '</strong>-kursus!</p>';
    bodyHtml += '<p><strong>Pris:</strong> 2.300 kr.</p>';
  }

  if (preferredMonth) bodyHtml += '<p><strong>Foretrukken måned:</strong> ' + escapeHtml(preferredMonth) + '</p>';

  // Schedule attachment check
  var scheduleId = MONTH_SCHEDULES[preferredMonth];
  var hasSchedule = scheduleId ? true : false;

  if (hasSchedule) {
    bodyHtml += '<p>Jeg har vedhæftet skemaet for <strong>' + escapeHtml(preferredMonth) + '</strong>, så du kan se præcis hvornår sessionerne ligger.</p>';
  } else if (preferredMonth) {
    bodyHtml += '<p>Skemaet for <strong>' + escapeHtml(preferredMonth) + '</strong> er ikke helt klar endnu — jeg sender det til dig, så snart det er på plads.</p>';
  }

  if (needsHousing) {
    bodyHtml += getAccommodationSectionHtml(cityCountry);
  }

  bodyHtml += '<p style="margin-top:16px;">Du kan tilmelde dig direkte på vores hjemmeside, eller book en kort samtale hvis du har spørgsmål:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en samtale</a></p>';

  if (!isBundle && courseList.length === 1 && preferredMonth) {
    var paymentUrl = getCoursePaymentUrl(courseList[0], preferredMonth);
    if (paymentUrl) {
      bodyHtml += '<p>Klar til at tilmelde dig? <a href="' + paymentUrl + '" style="color:#f75c03;font-weight:600;">Tilmeld dig her →</a></p>';
    }
  } else if (isBundle && preferredMonth) {
    var bundleUrl = getBundlePaymentUrl(courseList, preferredMonth);
    if (bundleUrl) {
      bodyHtml += '<p>Klar til at tilmelde dig? <a href="' + bundleUrl + '" style="color:#f75c03;font-weight:600;">Få din bundle her →</a></p>';
    }
  }

  bodyHtml += '<p>Svar gerne på denne e-mail hvis du har spørgsmål!</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  var bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores kurser!\n\n';
  if (hasSchedule) {
    bodyPlain += 'Jeg har vedhæftet skemaet for ' + preferredMonth + '.\n\n';
  } else if (preferredMonth) {
    bodyPlain += 'Skemaet for ' + preferredMonth + ' er ikke helt klar endnu — jeg sender det til dig snarest.\n\n';
  }
  if (needsHousing) {
    bodyPlain += getAccommodationSectionPlain(cityCountry);
  }
  bodyPlain += 'Book en samtale: ' + CONFIG.MEETING_LINK;
  bodyPlain += getEnglishNotePlain();
  bodyPlain += getSignaturePlain();

  var options = {
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  };

  if (hasSchedule) {
    var blob = fetchDriveFileAsBlob(scheduleId);
    if (blob) options.attachments = [blob];
  }

  MailApp.sendEmail(options);
}

// =========================================================================
// Mentorship Email
// =========================================================================

function sendEmailMentorship(leadData) {
  var firstName = leadData.first_name || '';
  var service = leadData.service || 'Mentorship';
  var subcategories = leadData.subcategories || '';
  var message = leadData.message || '';
  var email = leadData.email || '';
  var subject = 'Din mentorship-forespørgsel — Yoga Bible';

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak for din interesse i vores <strong>' + escapeHtml(service) + '</strong>-program!</p>';
  if (subcategories) bodyHtml += '<p><strong>Interesseområder:</strong> ' + escapeHtml(subcategories) + '</p>';
  if (message) bodyHtml += '<p><strong>Din besked:</strong> ' + escapeHtml(message) + '</p>';
  bodyHtml += '<p>Jeg vil gerne høre mere om dine mål. Lad os booke en kort samtale:</p>';
  bodyHtml += '<p><a href="' + CONFIG.MEETING_LINK + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Book en gratis samtale</a></p>';
  bodyHtml += '<p>Du er også velkommen til at svare direkte på denne e-mail.</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  var bodyPlain = 'Hej ' + firstName + ',\n\nTak for din interesse i vores ' + service + '-program!\n\nBook en gratis samtale: ' + CONFIG.MEETING_LINK + getEnglishNotePlain() + getSignaturePlain();

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  });
}

// =========================================================================
// Generic Lead Confirmation
// =========================================================================

function sendLeadConfirmationGeneric(leadData) {
  var firstName = leadData.first_name || '';
  var email = leadData.email || '';
  var subject = 'Tak for din henvendelse — Yoga Bible';

  var bodyHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  bodyHtml += '<p>Hej ' + escapeHtml(firstName) + ',</p>';
  bodyHtml += '<p>Tak fordi du tog kontakt til <strong>Yoga Bible</strong>!</p>';
  bodyHtml += '<p>Vi har modtaget din forespørgsel og vender tilbage snarest.</p>';
  bodyHtml += '<p>I mellemtiden:</p>';
  bodyHtml += '<ul style="margin:10px 0;padding-left:20px;">';
  bodyHtml += '<li>Book en samtale: <a href="' + CONFIG.MEETING_LINK + '" style="color:#f75c03;">Klik her</a></li>';
  bodyHtml += '<li>Besøg vores hjemmeside: <a href="https://www.yogabible.dk" style="color:#f75c03;">yogabible.dk</a></li>';
  bodyHtml += '</ul>';
  bodyHtml += '<p>Du er velkommen til at svare på denne e-mail med spørgsmål.</p>';
  bodyHtml += getEnglishNoteHtml();
  bodyHtml += getSignatureHtml() + '</div>';

  var bodyPlain = 'Hej ' + firstName + ',\n\nTak fordi du tog kontakt til Yoga Bible!\n\nVi vender tilbage snarest.\n\nBook en samtale: ' + CONFIG.MEETING_LINK + '\nBesøg: https://www.yogabible.dk' + getEnglishNotePlain() + getSignaturePlain();

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: bodyPlain,
    htmlBody: bodyHtml,
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.EMAIL_FROM
  });
}

// =========================================================================
// Admin Notification (kept in English — internal only)
// =========================================================================

function sendAdminNotification(leadData, action) {
  var fullName = ((leadData.first_name || '') + ' ' + (leadData.last_name || '')).trim();
  var typeLabel = action.replace('lead_schedule_', '').replace('lead_', '').toUpperCase();
  var subject = 'NEW LEAD - ' + typeLabel + ' - ' + (fullName || leadData.email);

  var html = '<div style="font-family:sans-serif;max-width:600px;">';
  html += '<h2 style="color:#f75c03;margin-bottom:20px;">New Lead: ' + escapeHtml(typeLabel) + '</h2>';
  html += '<table style="border-collapse:collapse;width:100%;">';

  var fields = [
    ['Name', fullName],
    ['Email', leadData.email],
    ['Phone', (leadData.phone || '').replace(/^'/, '')],
    ['Type', leadData.type],
    ['YTT Program Type', leadData.ytt_program_type || '-'],
    ['Program', leadData.program],
    ['Cohort', leadData.cohort_label],
    ['Accommodation', leadData.accommodation],
    ['Location', leadData.city_country],
    ['Source', leadData.source],
    ['Status', leadData.status],
    ['Notes', leadData.notes]
  ];

  fields.forEach(function(field) {
    if (field[1]) {
      html += '<tr><td style="padding:8px;border:1px solid #ddd;background:#f9f9f9;font-weight:bold;width:140px;">' + field[0] + '</td>';
      html += '<td style="padding:8px;border:1px solid #ddd;">';
      if (field[0] === 'Email') html += '<a href="mailto:' + escapeHtml(field[1]) + '">' + escapeHtml(field[1]) + '</a>';
      else html += escapeHtml(field[1]);
      html += '</td></tr>';
    }
  });

  html += '</table>';
  html += '<p style="margin-top:20px;"><a href="https://docs.google.com/spreadsheets/d/' + CONFIG.SPREADSHEET_ID + '" style="display:inline-block;background:#f75c03;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:4px;">Open Spreadsheet</a></p></div>';

  MailApp.sendEmail({
    to: CONFIG.EMAIL_ADMIN,
    subject: subject,
    htmlBody: html,
    replyTo: leadData.email || CONFIG.EMAIL_FROM,
    name: CONFIG.FROM_NAME
  });
}