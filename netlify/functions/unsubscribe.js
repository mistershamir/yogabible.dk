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

  if (!email || !token) {
    return htmlResponse(200, buildPage('error', 'Ugyldigt link.'));
  }

  if (!verifyUnsubscribeToken(email, token)) {
    return htmlResponse(200, buildPage('error', 'Ugyldigt eller udløbet link.'));
  }

  if (confirmed !== 'yes') {
    return htmlResponse(200, buildPage('confirm', email, token));
  }

  // Process unsubscribe
  const result = await processUnsubscribe(email);
  if (result.success) {
    return htmlResponse(200, buildPage('success', email));
  }
  return htmlResponse(200, buildPage('error', 'Der opstod en fejl. Prøv igen senere.'));
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

    await batch.commit();
    console.log(`[unsubscribe] Updated ${updated} leads for ${email}`);
    return { success: true, updated };
  } catch (err) {
    console.error('[unsubscribe] Error:', err);
    return { success: false };
  }
}

/**
 * Build Danish unsubscribe HTML page
 */
function buildPage(state, emailOrMessage, token) {
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
    const confirmUrl = `${CONFIG.SITE_URL}/.netlify/functions/unsubscribe?email=${encodeURIComponent(emailOrMessage)}&token=${token}&confirmed=yes`;
    content = `
      <div class="icon">\u{1F4E7}</div>
      <h1>Afmeld nyhedsbrev</h1>
      <p>Er du sikker p\u00e5, at du vil afmelde <strong>${emailOrMessage}</strong> fra vores nyhedsbrev?</p>
      <p>Du vil ikke l\u00e6ngere modtage e-mails fra Yoga Bible.</p>
      <div style="margin-top:24px;">
        <a href="${confirmUrl}" class="btn btn-primary">Ja, afmeld mig</a>
        <a href="https://yogabible.dk" class="btn btn-secondary">Nej, g\u00e5 tilbage</a>
      </div>
    `;
  } else if (state === 'success') {
    content = `
      <div class="icon">\u2705</div>
      <h1>Du er nu afmeldt</h1>
      <p><strong>${emailOrMessage}</strong> er blevet fjernet fra vores nyhedsbrev.</p>
      <p>Du vil ikke modtage flere e-mails fra os.</p>
      <p style="margin-top:24px;"><a href="https://yogabible.dk" class="btn btn-secondary">G\u00e5 til yogabible.dk</a></p>
    `;
  } else {
    content = `
      <div class="icon">\u26a0\ufe0f</div>
      <h1>Noget gik galt</h1>
      <p>${emailOrMessage}</p>
      <p style="margin-top:24px;"><a href="https://yogabible.dk" class="btn btn-secondary">G\u00e5 til yogabible.dk</a></p>
    `;
  }

  return `<!DOCTYPE html><html lang="da"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yoga Bible - Afmelding</title><style>${styles}</style></head><body><div class="container"><div class="logo">YOGA BIBLE</div>${content}</div></body></html>`;
}
