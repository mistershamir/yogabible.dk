/**
 * Unsubscribe Endpoint — Yoga Bible
 * Two-step flow: confirmation page -> process unsubscribe
 * Uses Firestore for lead storage.
 *
 * GET /.netlify/functions/unsubscribe?email=X&token=Y
 * GET /.netlify/functions/unsubscribe?email=X&token=Y&confirmed=yes
 */

const { getDb } = require('./shared/firestore');
const { CONFIG } = require('./shared/config');
const {
  htmlResponse, optionsResponse, jsonResponse,
  verifyUnsubscribeToken, formatDate
} = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'GET') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  const params = event.queryStringParameters || {};
  const email = String(params.email || '').toLowerCase().trim();
  const token = params.token || '';
  const confirmed = params.confirmed || '';
  const lang = (params.lang || 'da').toLowerCase().substring(0, 2);

  if (!email || !token) {
    return htmlResponse(200, buildPage('error', t(lang, 'invalidLink'), null, lang));
  }

  if (!verifyUnsubscribeToken(email, token)) {
    return htmlResponse(200, buildPage('error', t(lang, 'invalidToken'), null, lang));
  }

  if (confirmed !== 'yes') {
    return htmlResponse(200, buildPage('confirm', email, token, lang));
  }

  // Process unsubscribe
  const result = await processUnsubscribe(email);
  if (result.success) {
    return htmlResponse(200, buildPage('success', email, null, lang));
  }
  return htmlResponse(200, buildPage('error', t(lang, 'genericError'), null, lang));
};

/**
 * Process unsubscribe: update all lead docs for this email in Firestore
 */
async function processUnsubscribe(email) {
  try {
    const db = getDb();
    const snap = await db.collection('leads')
      .where('email', '==', email)
      .get();

    if (snap.empty) {
      // No leads found — still count as success (user won't get emails anyway)
      console.log(`[unsubscribe] No leads found for ${email}`);
      return { success: true, updated: 0 };
    }

    const now = formatDate(new Date());
    const batch = db.batch();
    let updated = 0;

    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        status: CONFIG.UNSUBSCRIBE_STATUS,
        unsubscribed: true,
        notes: `UNSUBSCRIBED via email link (${now})\n${doc.data().notes || ''}`,
        updated_at: new Date()
      });
      updated++;
    }

    // Also flag email_list_contacts with this email across all lists
    const contactSnap = await db.collection('email_list_contacts')
      .where('email', '==', email)
      .get();

    for (const contactDoc of contactSnap.docs) {
      batch.update(contactDoc.ref, {
        status: 'unsubscribed',
        unsubscribed_at: new Date()
      });
    }

    await batch.commit();
    console.log(`[unsubscribe] Updated ${updated} leads + ${contactSnap.size} list contacts for ${email}`);
    return { success: true, updated };
  } catch (err) {
    console.error('[unsubscribe] Error:', err);
    return { success: false };
  }
}

// ── Bilingual translations ──────────────────────────────────────────────
const UNSUB_I18N = {
  da: {
    title: 'Afmeld nyhedsbrev',
    pageTitle: 'Yoga Bible - Afmelding',
    confirmQuestion: 'Er du sikker p\u00e5, at du vil afmelde <strong>{{email}}</strong> fra vores nyhedsbrev?',
    confirmNote: 'Du vil ikke l\u00e6ngere modtage e-mails fra Yoga Bible.',
    confirmBtn: 'Ja, afmeld mig',
    cancelBtn: 'Nej, g\u00e5 tilbage',
    successTitle: 'Du er nu afmeldt',
    successMsg: '<strong>{{email}}</strong> er blevet fjernet fra vores nyhedsbrev.',
    successNote: 'Du vil ikke modtage flere e-mails fra os.',
    goBack: 'G\u00e5 til yogabible.dk',
    errorTitle: 'Noget gik galt',
    invalidLink: 'Ugyldigt link.',
    invalidToken: 'Ugyldigt eller udl\u00f8bet link.',
    genericError: 'Der opstod en fejl. Pr\u00f8v igen senere.'
  },
  en: {
    title: 'Unsubscribe',
    pageTitle: 'Yoga Bible - Unsubscribe',
    confirmQuestion: 'Are you sure you want to unsubscribe <strong>{{email}}</strong> from our emails?',
    confirmNote: 'You will no longer receive emails from Yoga Bible.',
    confirmBtn: 'Yes, unsubscribe me',
    cancelBtn: 'No, go back',
    successTitle: 'You have been unsubscribed',
    successMsg: '<strong>{{email}}</strong> has been removed from our mailing list.',
    successNote: 'You will not receive any more emails from us.',
    goBack: 'Go to yogabible.dk',
    errorTitle: 'Something went wrong',
    invalidLink: 'Invalid link.',
    invalidToken: 'Invalid or expired link.',
    genericError: 'An error occurred. Please try again later.'
  },
  de: {
    title: 'Abmelden',
    pageTitle: 'Yoga Bible - Abmeldung',
    confirmQuestion: 'Bist du sicher, dass du <strong>{{email}}</strong> von unserem Newsletter abmelden m\u00f6chtest?',
    confirmNote: 'Du wirst keine E-Mails mehr von Yoga Bible erhalten.',
    confirmBtn: 'Ja, abmelden',
    cancelBtn: 'Nein, zur\u00fcck',
    successTitle: 'Du bist abgemeldet',
    successMsg: '<strong>{{email}}</strong> wurde von unserem Newsletter entfernt.',
    successNote: 'Du wirst keine weiteren E-Mails von uns erhalten.',
    goBack: 'Zu yogabible.dk',
    errorTitle: 'Etwas ist schiefgelaufen',
    invalidLink: 'Ung\u00fcltiger Link.',
    invalidToken: 'Ung\u00fcltiger oder abgelaufener Link.',
    genericError: 'Ein Fehler ist aufgetreten. Bitte versuche es sp\u00e4ter erneut.'
  }
};

function t(lang, key) {
  var l = (['da', 'dk'].includes(lang)) ? 'da' : (lang === 'de' ? 'de' : 'en');
  return (UNSUB_I18N[l] && UNSUB_I18N[l][key]) || UNSUB_I18N.da[key] || key;
}

/**
 * Build bilingual unsubscribe HTML page
 */
function buildPage(state, emailOrMessage, token, lang) {
  var l = (['da', 'dk'].includes(lang)) ? 'da' : (lang === 'de' ? 'de' : (lang === 'en' ? 'en' : 'da'));
  var htmlLang = l === 'da' ? 'da' : (l === 'de' ? 'de' : 'en');
  var homeUrl = l === 'en' ? 'https://yogabible.dk/en/' : 'https://yogabible.dk';

  const orange = '#f75c03';
  const styles = `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f5f5f0; margin: 0; padding: 40px 20px; color: #1a1a1a; }
    .container { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    p { font-size: 15px; line-height: 1.6; color: #555; margin: 12px 0; }
    .btn { display: inline-block; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px; margin: 8px; }
    .btn-primary { background: ${orange}; color: #fff; }
    .btn-secondary { background: #eee; color: #333; }
    .logo { font-size: 24px; font-weight: 700; color: ${orange}; margin-bottom: 24px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
  `;

  let content = '';

  if (state === 'confirm') {
    var langParam = (l === 'da') ? '' : '&lang=' + l;
    const confirmUrl = `${CONFIG.SITE_URL}/.netlify/functions/unsubscribe?email=${encodeURIComponent(emailOrMessage)}&token=${token}&confirmed=yes${langParam}`;
    content = `
      <div class="icon">\u{1F4E7}</div>
      <h1>${t(l, 'title')}</h1>
      <p>${t(l, 'confirmQuestion').replace('{{email}}', emailOrMessage)}</p>
      <p>${t(l, 'confirmNote')}</p>
      <div style="margin-top:24px;">
        <a href="${confirmUrl}" class="btn btn-primary">${t(l, 'confirmBtn')}</a>
        <a href="${homeUrl}" class="btn btn-secondary">${t(l, 'cancelBtn')}</a>
      </div>
    `;
  } else if (state === 'success') {
    content = `
      <div class="icon">\u2705</div>
      <h1>${t(l, 'successTitle')}</h1>
      <p>${t(l, 'successMsg').replace('{{email}}', emailOrMessage)}</p>
      <p>${t(l, 'successNote')}</p>
      <p style="margin-top:24px;"><a href="${homeUrl}" class="btn btn-secondary">${t(l, 'goBack')}</a></p>
    `;
  } else {
    content = `
      <div class="icon">\u26a0\ufe0f</div>
      <h1>${t(l, 'errorTitle')}</h1>
      <p>${emailOrMessage}</p>
      <p style="margin-top:24px;"><a href="${homeUrl}" class="btn btn-secondary">${t(l, 'goBack')}</a></p>
    `;
  }

  return `<!DOCTYPE html><html lang="${htmlLang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t(l, 'pageTitle')}</title><style>${styles}</style></head><body><div class="container"><div class="logo">YOGA BIBLE</div>${content}</div></body></html>`;
}
