/**
 * Campaign: July 2026 Accommodation Urgency — Preview / Debug (sync)
 *
 * GET /.netlify/functions/campaign-july-accommodation?mode=debug
 *   → Discovers which accommodation field exists on July 4W leads and
 *     reports distinct values + counts for every candidate field.
 *
 * GET /.netlify/functions/campaign-july-accommodation?mode=preview
 *   → Eligible counts (DA vs EN), 3 samples per language, fully-processed
 *     sample HTML (after schedule tokens + lead tracking).
 *
 * Auth: X-Internal-Secret (AI_INTERNAL_SECRET).
 *
 * To send: POST /.netlify/functions/campaign-july-accommodation-send-background
 *          headers X-Internal-Secret, body { "confirm": "YES" }.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { substituteVars } = require('./shared/email-service');
const { prepareTrackedEmail } = require('./shared/email-tracking');
const {
  CAMPAIGN_ID, SOURCE_TAG, DA, EN, EXCLUDE_STATUSES,
  ACCOMMODATION_FIELDS, ACCOMMODATION_EXCLUDE_VALUES,
  injectScheduleTokens, isEligible, detectLang, programMatchesJulyFourWeek, accommodationExcluded
} = require('./shared/campaign-july-accommodation-shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || provided !== secret) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  var params = event.queryStringParameters || {};
  var mode = params.mode || 'preview';

  if (mode === 'debug') return await runDebug();
  if (mode === 'preview') return await runPreview();
  return jsonResponse(400, { ok: false, error: 'mode must be debug or preview' });
};

// ── Debug: discover accommodation field on July 4W audience ─────────────────

async function runDebug() {
  var db = getDb();
  var snap = await db.collection('leads').where('type', '==', 'ytt').get();

  var julyLeads = [];
  snap.forEach(function (doc) {
    var d = doc.data();
    if (programMatchesJulyFourWeek(d)) julyLeads.push({ id: doc.id, data: d });
  });

  // For each candidate accommodation field, count occurrences and distinct values
  var fieldReport = {};
  ACCOMMODATION_FIELDS.forEach(function (f) {
    fieldReport[f] = { present: 0, distinct: {} };
  });

  // Also collect any other fields with 'accom' or 'hous' or 'live' in the name
  var dynamicFieldHits = {};

  julyLeads.forEach(function (l) {
    var d = l.data;
    ACCOMMODATION_FIELDS.forEach(function (f) {
      if (d[f] !== undefined && d[f] !== null && d[f] !== '') {
        fieldReport[f].present++;
        var val = String(d[f]);
        fieldReport[f].distinct[val] = (fieldReport[f].distinct[val] || 0) + 1;
      }
    });
    Object.keys(d).forEach(function (key) {
      var lk = key.toLowerCase();
      if (
        (lk.indexOf('accom') !== -1 || lk.indexOf('hous') !== -1 || lk.indexOf('live') !== -1)
        && ACCOMMODATION_FIELDS.indexOf(key) === -1
      ) {
        if (!dynamicFieldHits[key]) dynamicFieldHits[key] = { present: 0, distinct: {} };
        if (d[key] !== undefined && d[key] !== null && d[key] !== '') {
          dynamicFieldHits[key].present++;
          var val = String(d[key]);
          dynamicFieldHits[key].distinct[val] = (dynamicFieldHits[key].distinct[val] || 0) + 1;
        }
      }
    });
  });

  // Sort each distinct map for readability
  function shape(report) {
    var out = {};
    Object.keys(report).forEach(function (f) {
      var distinct = Object.keys(report[f].distinct)
        .map(function (k) { return { value: k, count: report[f].distinct[k] }; })
        .sort(function (a, b) { return b.count - a.count; });
      out[f] = { present: report[f].present, distinct: distinct };
    });
    return out;
  }

  // 5 sample raw lead docs so we can eyeball the schema
  var samples = julyLeads.slice(0, 5).map(function (l) {
    return {
      id: l.id,
      email: l.data.email || '',
      first_name: l.data.first_name || '',
      ytt_program_type: l.data.ytt_program_type || '',
      lang: l.data.lang || '',
      status: l.data.status || '',
      country: l.data.country || '',
      // Echo back any field that looks accommodation-related
      _all_keys: Object.keys(l.data).filter(function (k) {
        var lk = k.toLowerCase();
        return lk.indexOf('accom') !== -1 || lk.indexOf('hous') !== -1 || lk.indexOf('live') !== -1;
      }).reduce(function (acc, k) { acc[k] = l.data[k]; return acc; }, {})
    };
  });

  return jsonResponse(200, {
    ok: true,
    mode: 'debug',
    july_4week_total: julyLeads.length,
    candidate_fields: shape(fieldReport),
    other_accom_like_fields_found: shape(dynamicFieldHits),
    forbidden_accommodation_values: Array.from(ACCOMMODATION_EXCLUDE_VALUES),
    sample_leads: samples
  });
}

// ── Preview ──────────────────────────────────────────────────────────────────

async function runPreview() {
  var db = getDb();
  var snap = await db.collection('leads').where('type', '==', 'ytt').get();

  var daLeads = [];
  var enLeads = [];
  var skipped = {
    not_july_program: 0,
    status_excluded: 0,
    unsubscribed: 0,
    bounced: 0,
    no_email: 0,
    accommodation_excluded: 0
  };

  // Track accommodation-value distribution among kept leads so we can sanity-check
  var keptAccommodationValues = {};

  snap.forEach(function (doc) {
    var d = doc.data();
    if (!programMatchesJulyFourWeek(d)) { skipped.not_july_program++; return; }
    if (!d.email) { skipped.no_email++; return; }
    if (d.unsubscribed) { skipped.unsubscribed++; return; }
    if (d.email_bounced) { skipped.bounced++; return; }
    var status = (d.status || '').trim();
    if (EXCLUDE_STATUSES.has(status)) { skipped.status_excluded++; return; }
    if (accommodationExcluded(d)) { skipped.accommodation_excluded++; return; }

    var accomKey = (d.accommodation === undefined || d.accommodation === null || d.accommodation === '') ? '(empty)' : String(d.accommodation);
    keptAccommodationValues[accomKey] = (keptAccommodationValues[accomKey] || 0) + 1;

    var lang = detectLang(d);
    var entry = {
      id: doc.id,
      email: d.email,
      first_name: d.first_name || '',
      status: status || '(none)',
      lang: d.lang || '(unset)',
      country: d.country || '',
      accommodation: d.accommodation || '(empty)',
      ytt_program_type: d.ytt_program_type || ''
    };
    if (lang === 'da') daLeads.push(entry); else enLeads.push(entry);
  });

  function processSample(sample, template) {
    if (!sample) return null;
    var withVars = substituteVars(template.bodyHtml, {
      first_name: sample.first_name || (template === DA ? 'der' : 'there')
    });
    var withTokens = injectScheduleTokens(withVars, sample.id, sample.email);
    var tracked = prepareTrackedEmail(withTokens, sample.id, SOURCE_TAG);
    return {
      lead_id: sample.id,
      after_schedule_tokens: withTokens,
      after_lead_tracking: tracked
    };
  }

  return jsonResponse(200, {
    ok: true,
    mode: 'preview',
    campaign_id: CAMPAIGN_ID,
    counts: {
      total_eligible: daLeads.length + enLeads.length,
      da: daLeads.length,
      en: enLeads.length
    },
    skipped: skipped,
    kept_accommodation_values: Object.keys(keptAccommodationValues)
      .map(function (k) { return { value: k, count: keptAccommodationValues[k] }; })
      .sort(function (a, b) { return b.count - a.count; }),
    forbidden_accommodation_values: Array.from(ACCOMMODATION_EXCLUDE_VALUES),
    samples_da: daLeads.slice(0, 3),
    samples_en: enLeads.slice(0, 3),
    subjects: { da: DA.subject, en: EN.subject },
    sample_processed_da: processSample(daLeads[0], DA),
    sample_processed_en: processSample(enLeads[0], EN)
  });
}
