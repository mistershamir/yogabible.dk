/**
 * Fix English Email URLs — Add /en/ Prefix
 *
 * POST /.netlify/functions/fix-english-urls
 * Auth: X-Internal-Secret header
 *
 * Reads ALL sequences from Firestore. For every step with email_body_en,
 * finds all yogabible.dk URLs and:
 *   1. Adds /en/ after the domain for page URLs
 *   2. Maps Danish schedule paths to English equivalents
 *   3. Preserves: query params, image/asset URLs, Instagram links, already-/en/ URLs
 *
 * Returns a detailed report of every URL changed.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// Danish schedule path → English schedule path
var SCHEDULE_MAP = {
  '/skema/4-uger/': '/en/schedule/4-weeks/',
  '/skema/4-uger-juni/': '/en/schedule/4-weeks-june/',
  '/skema/4-uger-juli/': '/en/schedule/4-weeks-july-plan/',
  '/skema/8-uger/': '/en/schedule/8-weeks/',
  '/skema/18-uger/': '/en/schedule/18-weeks/',
  '/skema/18-uger-august/': '/en/schedule/18-weeks-august/',
  '/tidsplan/4-uger/': '/en/schedule/4-weeks/',
  '/tidsplan/4-uger-juni/': '/en/schedule/4-weeks-june/',
  '/tidsplan/4-uger-juli/': '/en/schedule/4-weeks-july-plan/',
  '/tidsplan/8-uger/': '/en/schedule/8-weeks/',
  '/tidsplan/18-uger/': '/en/schedule/18-weeks/',
  '/tidsplan/18-uger-august/': '/en/schedule/18-weeks-august/'
};

// Paths that should NOT get /en/ prefix (assets, images, API endpoints)
var SKIP_PREFIXES = [
  '/assets/',
  '/images/',
  '/.netlify/',
  '/admin/',
  '/api/'
];

function fixUrlsInHtml(html) {
  var changes = [];

  // Match all yogabible.dk URLs (both http and https, with or without www)
  var result = html.replace(
    /https?:\/\/(www\.)?yogabible\.dk(\/[^"'\s<>]*)/g,
    function (fullMatch, www, path) {
      // Already has /en/ prefix — skip
      if (path.indexOf('/en/') === 0) {
        return fullMatch;
      }

      // Asset/image URLs — skip
      for (var i = 0; i < SKIP_PREFIXES.length; i++) {
        if (path.indexOf(SKIP_PREFIXES[i]) === 0) {
          return fullMatch;
        }
      }

      // Check schedule path mapping first (Danish path → English path)
      // Extract just the path portion before any query string
      var pathOnly = path.split('?')[0];
      var query = path.indexOf('?') !== -1 ? path.substring(path.indexOf('?')) : '';

      for (var schedDa in SCHEDULE_MAP) {
        if (pathOnly === schedDa || pathOnly === schedDa.replace(/\/$/, '')) {
          var newPath = SCHEDULE_MAP[schedDa] + query;
          var newUrl = 'https://yogabible.dk' + newPath;
          changes.push({
            original: fullMatch,
            fixed: newUrl,
            type: 'schedule_path_mapped'
          });
          return newUrl;
        }
      }

      // General case: add /en/ prefix
      var fixedPath = '/en' + path;
      var fixedUrl = 'https://yogabible.dk' + fixedPath;
      changes.push({
        original: fullMatch,
        fixed: fixedUrl,
        type: 'en_prefix_added'
      });
      return fixedUrl;
    }
  );

  return { html: result, changes: changes };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  // Check for dry-run mode (GET = dry run, POST = apply)
  var dryRun = event.httpMethod === 'GET';

  var db = getDb();
  var allChanges = [];
  var sequencesModified = 0;
  var stepsModified = 0;
  var totalUrlsFixed = 0;

  var seqSnap = await db.collection('sequences').get();

  for (var i = 0; i < seqSnap.docs.length; i++) {
    var doc = seqSnap.docs[i];
    var data = doc.data();
    var steps = data.steps || [];
    var seqChanged = false;
    var seqName = data.name || doc.id;

    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];

      // Only process email_body_en
      if (!step.email_body_en) continue;

      var result = fixUrlsInHtml(step.email_body_en);

      if (result.changes.length > 0) {
        steps[s].email_body_en = result.html;
        seqChanged = true;
        stepsModified++;
        totalUrlsFixed += result.changes.length;

        allChanges.push({
          sequence: seqName,
          sequence_id: doc.id,
          step_index: s,
          step_subject: step.email_subject_en || step.email_subject || '(no subject)',
          urls_fixed: result.changes.length,
          details: result.changes
        });
      }
    }

    // Also check email_subject_en for URLs (unlikely but thorough)
    for (var s2 = 0; s2 < steps.length; s2++) {
      if (!steps[s2].email_subject_en) continue;
      var subjResult = fixUrlsInHtml(steps[s2].email_subject_en);
      if (subjResult.changes.length > 0) {
        steps[s2].email_subject_en = subjResult.html;
        seqChanged = true;
        totalUrlsFixed += subjResult.changes.length;
        allChanges.push({
          sequence: seqName,
          sequence_id: doc.id,
          step_index: s2,
          field: 'email_subject_en',
          urls_fixed: subjResult.changes.length,
          details: subjResult.changes
        });
      }
    }

    if (seqChanged) {
      sequencesModified++;
      if (!dryRun) {
        await doc.ref.update({ steps: steps, updated_at: new Date().toISOString() });
      }
    }
  }

  // Post-fix verification: scan for any remaining non-/en/ URLs in email_body_en
  var remainingIssues = [];
  if (!dryRun) {
    var verifySnap = await db.collection('sequences').get();
    for (var v = 0; v < verifySnap.docs.length; v++) {
      var vDoc = verifySnap.docs[v];
      var vData = vDoc.data();
      var vSteps = vData.steps || [];
      for (var vs = 0; vs < vSteps.length; vs++) {
        var enBody = vSteps[vs].email_body_en || '';
        // Find yogabible.dk URLs that don't have /en/ and aren't assets
        var matches = enBody.match(/https?:\/\/(www\.)?yogabible\.dk(\/[^"'\s<>]*)/g) || [];
        for (var m = 0; m < matches.length; m++) {
          var url = matches[m];
          // Skip /en/ URLs and asset URLs
          if (url.indexOf('/en/') !== -1) continue;
          if (url.indexOf('/assets/') !== -1) continue;
          if (url.indexOf('/images/') !== -1) continue;
          if (url.indexOf('/.netlify/') !== -1) continue;
          remainingIssues.push({
            sequence: vData.name || vDoc.id,
            step_index: vs,
            url: url
          });
        }
      }
    }
  }

  return jsonResponse(200, {
    ok: true,
    mode: dryRun ? 'DRY_RUN (GET request — no changes written)' : 'APPLIED',
    summary: {
      sequences_scanned: seqSnap.docs.length,
      sequences_modified: sequencesModified,
      steps_modified: stepsModified,
      total_urls_fixed: totalUrlsFixed
    },
    changes: allChanges,
    verification: dryRun ? 'skipped (dry run)' : {
      remaining_non_en_urls: remainingIssues.length,
      details: remainingIssues
    },
    timestamp: new Date().toISOString()
  });
};
