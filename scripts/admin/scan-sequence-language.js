/**
 * Scan & clean sequence email bodies for banned phrases
 *
 * GET  /.netlify/functions/scan-sequence-language → scan only, show matches
 * POST /.netlify/functions/scan-sequence-language → apply fixes
 * Auth: X-Internal-Secret header
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// Patterns to find (case-insensitive)
var PATTERNS = [
  { pattern: /undervises på engelsk/gi, replacement: '', label: 'undervises på engelsk' },
  { pattern: /taught in English/gi, replacement: '', label: 'taught in English' },
  { pattern: /på engelsk/gi, replacement: '', label: 'på engelsk', skipIfContext: /svar.*på engelsk|skriv.*på engelsk|reply.*på engelsk|write.*på engelsk|respond.*på engelsk|communicate.*på engelsk|besked.*på engelsk|message.*på engelsk/i },
  { pattern: /in English/gi, replacement: '', label: 'in English (course language)', skipIfContext: /reply in English|write .* in English|respond in English|communicate in English|feel free .* in English|welcome .* in English|can .* in English|PS.*in English/i },
  { pattern: /internationale sommerhold/gi, replacement: 'sommerhold', label: 'internationale sommerhold' },
  { pattern: /international summer cohort/gi, replacement: 'summer cohort', label: 'international summer cohort' }
];

function findMatches(text, fieldName) {
  if (!text) return [];
  var matches = [];
  PATTERNS.forEach(function (p) {
    var regex = new RegExp(p.pattern.source, p.pattern.flags);
    var m;
    while ((m = regex.exec(text)) !== null) {
      // Get surrounding context (40 chars each side)
      var start = Math.max(0, m.index - 40);
      var end = Math.min(text.length, m.index + m[0].length + 40);
      var context = text.slice(start, end);

      // Check if this is a communication context we should skip
      if (p.skipIfContext) {
        // Get a wider context window to check
        var wideStart = Math.max(0, m.index - 100);
        var wideEnd = Math.min(text.length, m.index + m[0].length + 100);
        var wideContext = text.slice(wideStart, wideEnd);
        if (p.skipIfContext.test(wideContext)) {
          matches.push({
            field: fieldName,
            matched: m[0],
            label: p.label,
            context: '...' + context + '...',
            action: 'SKIP — communication context, not course language',
            index: m.index
          });
          continue;
        }
      }

      matches.push({
        field: fieldName,
        matched: m[0],
        label: p.label,
        context: '...' + context + '...',
        action: p.replacement ? 'REPLACE with "' + p.replacement + '"' : 'REMOVE',
        index: m.index
      });
    }
  });
  return matches;
}

function applyFixes(text) {
  if (!text) return { text: text, changed: false, fixes: 0 };
  var original = text;
  var fixes = 0;

  PATTERNS.forEach(function (p) {
    if (p.skipIfContext) {
      // Need to apply selectively — only replace non-skipped matches
      text = text.replace(p.pattern, function (match, offset) {
        var wideStart = Math.max(0, offset - 100);
        var wideEnd = Math.min(text.length, offset + match.length + 100);
        // Use original text for context check since we're modifying text
        var wideContext = original.slice(wideStart, wideEnd);
        if (p.skipIfContext.test(wideContext)) return match; // Keep it
        fixes++;
        return p.replacement;
      });
    } else {
      var before = text;
      text = text.replace(p.pattern, p.replacement);
      if (text !== before) {
        var count = (before.match(p.pattern) || []).length;
        fixes += count;
      }
    }
  });

  // Clean up double spaces and empty tags left behind
  text = text.replace(/  +/g, ' ');
  text = text.replace(/<p>\s*<\/p>/g, '');
  text = text.replace(/<li>\s*<\/li>/g, '');

  return { text: text, changed: text !== original, fixes: fixes };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var isApply = event.httpMethod === 'POST';

  var sequencesSnap = await db.collection('sequences').get();
  var allMatches = [];
  var applied = [];

  sequencesSnap.forEach(function (doc) {
    var data = doc.data();
    var steps = data.steps || [];

    steps.forEach(function (step, idx) {
      var fields = [
        { key: 'email_body', value: step.email_body },
        { key: 'email_body_en', value: step.email_body_en },
        { key: 'email_subject', value: step.email_subject },
        { key: 'email_subject_en', value: step.email_subject_en },
        { key: 'sms_message', value: step.sms_message }
      ];

      fields.forEach(function (f) {
        var matches = findMatches(f.value, f.key);
        if (matches.length > 0) {
          allMatches.push({
            sequence_id: doc.id,
            sequence_name: data.name,
            step_index: idx,
            step_subject: step.email_subject || step.email_subject_en || '(no subject)',
            matches: matches
          });
        }
      });
    });
  });

  if (!isApply) {
    // Scan mode — just return matches
    var totalMatches = allMatches.reduce(function (sum, m) { return sum + m.matches.length; }, 0);
    var actionable = allMatches.reduce(function (sum, m) {
      return sum + m.matches.filter(function (x) { return x.action.indexOf('SKIP') === -1; }).length;
    }, 0);

    return jsonResponse(200, {
      ok: true,
      mode: 'SCAN',
      total_matches: totalMatches,
      actionable: actionable,
      skipped: totalMatches - actionable,
      matches: allMatches,
      note: 'POST to this endpoint to apply fixes'
    });
  }

  // Apply mode — fix all matches
  for (var i = 0; i < sequencesSnap.docs.length; i++) {
    var doc = sequencesSnap.docs[i];
    var data = doc.data();
    var steps = data.steps || [];
    var docChanged = false;

    for (var j = 0; j < steps.length; j++) {
      var step = steps[j];
      var stepChanged = false;

      ['email_body', 'email_body_en', 'email_subject', 'email_subject_en', 'sms_message'].forEach(function (field) {
        if (step[field]) {
          var result = applyFixes(step[field]);
          if (result.changed) {
            steps[j][field] = result.text;
            stepChanged = true;
            docChanged = true;
            applied.push({
              sequence_name: data.name,
              step_index: j,
              field: field,
              fixes: result.fixes
            });
          }
        }
      });
    }

    if (docChanged) {
      await db.collection('sequences').doc(doc.id).update({
        steps: steps,
        updated_at: new Date().toISOString()
      });
    }
  }

  return jsonResponse(200, {
    ok: true,
    mode: 'APPLIED',
    total_fixes: applied.length,
    details: applied
  });
};
