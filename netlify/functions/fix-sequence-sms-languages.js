/**
 * Fix Sequence SMS Languages — Add EN/DE translations to all SMS steps
 *
 * POST /.netlify/functions/fix-sequence-sms-languages
 * Auth: X-Internal-Secret header
 * Query: ?dry=1 to preview without writing
 *
 * Adds sms_message_en (and sms_message_de where relevant) to every
 * sequence step that has a sms_message but is missing translations.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// ═══════════════════════════════════════════════════════════════════════════
// SMS translations keyed by sequence ID + step index
// ═══════════════════════════════════════════════════════════════════════════

var SMS_TRANSLATIONS = {
  // ── YTT Onboarding — 2026 ──────────────────────────────────────────────
  'Un1xmmriIpUyy2Kui97N': {
    1: {
      en: 'Hi {{first_name}}, did you see our email about the yoga teacher training? Feel free to reply here or call us with any questions. /Shamir, Yoga Bible',
      de: 'Hi {{first_name}}, hast du unsere E-Mail zur Yogalehrer-Ausbildung gesehen? Antworte gerne hier oder ruf uns an. /Shamir, Yoga Bible'
    },
    4: {
      en: 'Hi {{first_name}}, have you found the format that fits you? Remember our Preparation Phase (3,750 DKK) \u2014 the amount is deducted from the full price. /Shamir',
      de: 'Hi {{first_name}}, hast du das passende Format gefunden? Denk an unsere Vorbereitungsphase (3.750 DKK) \u2014 der Betrag wird vom Gesamtpreis abgezogen. /Shamir'
    }
  },

  // ── April 4W Intensive — Conversion Push ───────────────────────────────
  'ZwvSVLsqRZcIv8C0IG0y': {
    0: {
      en: 'Hi {{first_name}}, only 3 spots left on our April intensive. Want to secure yours? Reply here or call 53 88 12 09. /Shamir',
      de: 'Hi {{first_name}}, nur noch 3 Pl\u00E4tze in unserem April-Intensivkurs. M\u00F6chtest du dir einen sichern? Antworte hier oder ruf an: 53 88 12 09. /Shamir'
    }
  },

  // ── July Vinyasa Plus — International Nurture (DK flow) ────────────────
  // Step 4 already has English SMS. Add DA + DE.
  'Yoq6RCVqTYlF10OPmkSw': {
    3: {
      // sms_message is already EN for this sequence — add DE
      de: 'Hi {{first_name}}, kurze Info \u2014 die Juli-Pl\u00E4tze f\u00FCllen sich. Die Vorbereitungsphase (3.750 DKK) sichert deinen Platz \u2014 der Betrag wird vom Gesamtpreis abgezogen. Fragen? /Shamir, Yoga Bible'
    }
  },

  // ── 8W Semi-Intensive May–Jun — DK Nurture ────────────────────────────
  'uDST1Haj1dMyQy0Qifhu': {
    1: {
      en: 'Hi {{first_name}}, our 8-week semi-intensive starts in May and fits alongside your job. Full RYT-200 certification. Questions? /Shamir',
      de: 'Hi {{first_name}}, unser 8-Wochen-Semi-Intensivkurs startet im Mai und passt neben deinem Job. Volle RYT-200 Zertifizierung. Fragen? /Shamir'
    }
  },

  // ── 18W Flexible Aug–Dec — DK Nurture ─────────────────────────────────
  'ab2dSOrmaQnneUyRojCf': {
    2: {
      en: 'Hi {{first_name}}, did you know you can start preparing for the August cohort right now? Preparation Phase for 3,750 DKK (deducted from the full price). /Shamir',
      de: 'Hi {{first_name}}, wusstest du, dass du dich schon jetzt auf den August-Kurs vorbereiten kannst? Vorbereitungsphase f\u00FCr 3.750 DKK (wird vom Gesamtpreis abgezogen). /Shamir'
    }
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var dry = (event.queryStringParameters || {}).dry === '1';
  var db = getDb();
  var results = [];

  for (var seqId in SMS_TRANSLATIONS) {
    var seqRef = db.collection('sequences').doc(seqId);
    var seqSnap = await seqRef.get();

    if (!seqSnap.exists) {
      results.push({ sequence_id: seqId, status: 'not_found' });
      continue;
    }

    var data = seqSnap.data();
    var steps = data.steps || [];
    var seqName = data.name || seqId;
    var changed = false;

    var stepTranslations = SMS_TRANSLATIONS[seqId];

    for (var stepIdx in stepTranslations) {
      var idx = parseInt(stepIdx, 10);
      if (idx >= steps.length) {
        results.push({ sequence: seqName, step_index: idx, status: 'step_not_found' });
        continue;
      }

      var translations = stepTranslations[stepIdx];
      var step = steps[idx];
      var stepResult = { sequence: seqName, step_index: idx, updates: {} };

      if (translations.en && !step.sms_message_en) {
        steps[idx].sms_message_en = translations.en;
        stepResult.updates.sms_message_en = translations.en;
        changed = true;
      } else if (translations.en && step.sms_message_en) {
        stepResult.updates.sms_message_en = '(already exists, skipped)';
      }

      if (translations.de && !step.sms_message_de) {
        steps[idx].sms_message_de = translations.de;
        stepResult.updates.sms_message_de = translations.de;
        changed = true;
      } else if (translations.de && step.sms_message_de) {
        stepResult.updates.sms_message_de = '(already exists, skipped)';
      }

      results.push(stepResult);
    }

    if (changed && !dry) {
      await seqRef.update({ steps: steps, updated_at: new Date().toISOString() });
    }
  }

  return jsonResponse(200, {
    ok: true,
    dry_run: dry,
    updates: results
  });
};
