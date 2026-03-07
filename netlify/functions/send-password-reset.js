/**
 * Netlify Function: /.netlify/functions/send-password-reset
 *
 * Sends a branded password-reset email via Resend instead of Firebase's
 * built-in email (which sends from noreply@*.firebaseapp.com with poor
 * deliverability).
 *
 * Flow:
 *   1. Ensure a Firebase account exists (migrate from Mindbody if needed)
 *   2. Generate a password-reset link via Firebase Admin SDK
 *   3. Send a branded email via Resend (yogabible.dk domain, SPF/DKIM verified)
 *
 * POST { email: "user@example.com", lang: "da"|"en" }
 * Returns: { ok: true } or { ok: false, error: "..." }
 */

'use strict';

const { jsonResponse, optionsResponse } = require('./shared/utils');
const { getAuth } = require('./shared/firestore');
const { mbFetch } = require('./shared/mb-api');
const crypto = require('crypto');
const https = require('https');

// ── Resend helper (lightweight, avoids importing the full resend-service) ────

function resendPost(body) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');

  const bodyStr = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(json.message || 'Resend API error ' + res.statusCode));
            }
          } catch (e) {
            reject(new Error('Resend parse error: ' + data.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Email HTML template ─────────────────────────────────────────────────────

function buildResetEmail(resetLink, lang) {
  const isDa = lang !== 'en';
  const orange = '#f75c03';

  const heading = isDa ? 'Nulstil din adgangskode' : 'Reset your password';
  const intro = isDa
    ? 'Vi modtog en anmodning om at nulstille adgangskoden til din Yoga Bible-konto. Klik p\u00e5 knappen herunder for at v\u00e6lge en ny adgangskode.'
    : 'We received a request to reset the password for your Yoga Bible account. Click the button below to choose a new password.';
  const btnText = isDa ? 'Nulstil adgangskode' : 'Reset password';
  const expiry = isDa
    ? 'Linket udl\u00f8ber om 1 time. Hvis du ikke har anmodet om dette, kan du ignorere denne email.'
    : 'This link expires in 1 hour. If you didn\u2019t request this, you can safely ignore this email.';
  const fallback = isDa
    ? 'Virker knappen ikke? Kopi\u00e9r dette link til din browser:'
    : 'Button not working? Copy this link into your browser:';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a1a;line-height:1.6;">
  <div style="text-align:center;margin-bottom:28px;">
    <img src="https://www.yogabible.dk/assets/images/brand/logo-orange-on-transparent.png" alt="Yoga Bible" width="140" style="width:140px;height:auto;" />
  </div>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;text-align:center;">${heading}</h1>
  <p style="font-size:16px;margin:0 0 24px;">${intro}</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${resetLink}" style="display:inline-block;background:${orange};color:#fff;font-size:16px;font-weight:600;padding:14px 36px;border-radius:50px;text-decoration:none;">${btnText}</a>
  </div>
  <p style="font-size:14px;color:#6F6A66;margin:0 0 20px;">${expiry}</p>
  <p style="font-size:13px;color:#999;margin:0 0 6px;">${fallback}</p>
  <p style="font-size:13px;color:#999;word-break:break-all;margin:0 0 24px;"><a href="${resetLink}" style="color:${orange};">${resetLink}</a></p>
  <div style="border-top:1px solid #EBE7E3;padding-top:14px;font-size:14px;color:#6F6A66;text-align:center;">
    Yoga Bible &middot; Torvegade 66 &middot; 1400 K\u00f8benhavn K
  </div>
</div>`;

  const text = isDa
    ? `${heading}\n\n${intro}\n\nNulstil her: ${resetLink}\n\n${expiry}\n\nYoga Bible - Torvegade 66, 1400 K\u00f8benhavn K`
    : `${heading}\n\n${intro}\n\nReset here: ${resetLink}\n\n${expiry}\n\nYoga Bible - Torvegade 66, 1400 Copenhagen K`;

  return { html, text };
}

// ── Ensure Firebase account exists (mirror of migrate-mb-user logic) ────────

async function ensureFirebaseAccount(email) {
  const auth = getAuth();

  // Check if Firebase account already exists
  try {
    await auth.getUserByEmail(email);
    return true; // account exists
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }

  // No Firebase account — check Mindbody
  try {
    const qs = new URLSearchParams({ searchText: email, limit: '10' }).toString();
    const clientData = await mbFetch(`/client/clients?${qs}`);
    const clients = (clientData.Clients || []).filter(
      (c) => c.Email && c.Email.toLowerCase() === email
    );

    if (clients.length === 0) return false; // not found anywhere

    const mbClient = clients[0];
    const displayName = ((mbClient.FirstName || '') + ' ' + (mbClient.LastName || '')).trim();

    // Create Firebase account with random password (user will reset it)
    await auth.createUser({
      email,
      password: crypto.randomBytes(32).toString('hex'),
      displayName: displayName || undefined,
      emailVerified: false
    });

    return true;
  } catch (mbErr) {
    console.error('MB lookup failed:', mbErr.message);
    return false;
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON' });
  }

  const email = (body.email || '').toLowerCase().trim();
  const lang = body.lang === 'en' ? 'en' : 'da';

  if (!email) return jsonResponse(400, { ok: false, error: 'email is required' });

  try {
    // 1. Ensure Firebase account exists (create from MB if needed)
    const exists = await ensureFirebaseAccount(email);
    if (!exists) {
      // Don't reveal whether the email exists — always show success to the user
      return jsonResponse(200, { ok: true });
    }

    // 2. Generate password reset link via Firebase Admin
    const siteUrl = process.env.URL || 'https://yogabible.dk';
    const continueUrl = siteUrl + (lang === 'en' ? '/en/auth-action/' : '/auth-action/');

    const auth = getAuth();
    const resetLink = await auth.generatePasswordResetLink(email, { url: continueUrl });

    // 3. Send branded email via Resend
    const fromAddr = process.env.RESEND_FROM || '"Yoga Bible" <hej@yogabible.dk>';
    const { html, text } = buildResetEmail(resetLink, lang);

    await resendPost({
      from: fromAddr,
      to: [email],
      subject: lang === 'en' ? 'Reset your password — Yoga Bible' : 'Nulstil din adgangskode — Yoga Bible',
      html,
      text,
      reply_to: 'info@yogabible.dk'
    });

    return jsonResponse(200, { ok: true });

  } catch (err) {
    console.error('[send-password-reset] Error:', err.message);
    return jsonResponse(500, { ok: false, error: 'Could not send reset email' });
  }
};
