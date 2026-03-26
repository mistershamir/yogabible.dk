/**
 * Test July Vinyasa Plus Welcome Emails
 *
 * GET /.netlify/functions/test-july-emails?secret=AI_INTERNAL_SECRET
 *
 * Sends all July welcome email variants to shamir@hotyogacph.dk:
 *  1. Danish (DA) — Copenhagen lead
 *  2. English (EN) — UK lead
 *  3. English (EN) — Norwegian lead (country-specific block)
 *  4. English (EN) — Swedish lead
 *  5. English (EN) — Finnish lead
 *  6. English (EN) — Dutch lead
 *  7. German (DE) — German lead
 *
 * One-time deploy function for testing. Delete after use.
 */

const { sendWelcomeEmail } = require('./shared/lead-emails');

const TEST_EMAIL = 'shamir@hotyogacph.dk';

// Fake token data (schedule links will work but not be personalized)
var TOKEN = { leadId: 'test-july-audit', token: 'test-token-july-2026' };

// Base lead template
function baseLead(overrides) {
  return Object.assign({
    email: TEST_EMAIL,
    first_name: 'Shamir',
    last_name: 'Test',
    phone: '+4553881209',
    type: 'ytt',
    ytt_program_type: '4-week-jul',
    program: '4-Week Vinyasa Plus YTT (July 2026)',
    source: 'Test',
    status: 'New',
    accommodation: 'accommodation',
    yoga_experience: 'regular',
    english_comfort: '',
    city_country: '',
    country: '',
    lang: 'en',
    meta_lang: '',
    unsubscribed: false,
    created_at: new Date()
  }, overrides);
}

// All test variants
var VARIANTS = [
  {
    label: '1/7 — DANISH (Copenhagen lead)',
    lead: baseLead({
      lang: 'da',
      country: 'DK',
      city_country: 'København',
      accommodation: 'No',
      yoga_experience: 'regular',
      english_comfort: ''
    })
  },
  {
    label: '2/7 — ENGLISH — UK lead',
    lead: baseLead({
      lang: 'en',
      country: 'UK',
      city_country: 'London, UK',
      accommodation: 'accommodation',
      yoga_experience: 'beginner',
      english_comfort: ''
    })
  },
  {
    label: '3/7 — ENGLISH — Norwegian lead',
    lead: baseLead({
      lang: 'no',
      country: 'NO',
      city_country: 'Oslo, Norway',
      accommodation: 'accommodation_plus',
      yoga_experience: 'regular',
      english_comfort: 'needs_patience'
    })
  },
  {
    label: '4/7 — ENGLISH — Swedish lead',
    lead: baseLead({
      lang: 'sv',
      country: 'SE',
      city_country: 'Stockholm, Sweden',
      accommodation: 'self_arranged',
      yoga_experience: 'previous_ytt',
      english_comfort: 'unsure'
    })
  },
  {
    label: '5/7 — ENGLISH — Finnish lead',
    lead: baseLead({
      lang: 'fi',
      country: 'FI',
      city_country: 'Helsinki, Finland',
      accommodation: 'accommodation',
      yoga_experience: 'beginner',
      english_comfort: 'needs_patience'
    })
  },
  {
    label: '6/7 — ENGLISH — Dutch lead',
    lead: baseLead({
      lang: 'nl',
      country: 'NL',
      city_country: 'Amsterdam, Netherlands',
      accommodation: 'accommodation_plus',
      yoga_experience: 'regular',
      english_comfort: ''
    })
  },
  {
    label: '7/7 — GERMAN — Germany lead',
    lead: baseLead({
      lang: 'de',
      country: 'DE',
      city_country: 'Berlin, Germany',
      accommodation: 'accommodation',
      yoga_experience: 'beginner',
      english_comfort: 'unsure'
    })
  }
];

exports.handler = async (event) => {
  // Auth
  var secret = process.env.AI_INTERNAL_SECRET;
  var q = event.queryStringParameters || {};
  if (!secret || q.secret !== secret) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  var results = [];

  for (var i = 0; i < VARIANTS.length; i++) {
    var v = VARIANTS[i];
    console.log('[test-july] Sending: ' + v.label);
    try {
      var res = await sendWelcomeEmail(v.lead, 'lead_schedule_4w-jul', TOKEN);
      results.push({ variant: v.label, success: res.success, subject: res.subject || '', error: res.error || null });
      console.log('[test-july] Result: ' + JSON.stringify(res.success));
    } catch (err) {
      results.push({ variant: v.label, success: false, error: err.message });
      console.error('[test-july] Error: ' + err.message);
    }

    // Small delay between sends to avoid rate limits
    if (i < VARIANTS.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  var allOk = results.every(r => r.success);

  return {
    statusCode: allOk ? 200 : 207,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: allOk ? 'All 7 July emails sent to ' + TEST_EMAIL : 'Some emails failed',
      results: results
    }, null, 2)
  };
};
