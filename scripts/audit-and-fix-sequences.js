#!/usr/bin/env node
/**
 * Audit & Fix Sequences — Standalone Script
 *
 * Reads live Firestore, reports all sequence data, then fixes:
 *   1. Exit conditions → approved 6 statuses
 *   2. Channel mismatches → sms→email/both when email content exists
 *
 * Usage:
 *   node scripts/audit-and-fix-sequences.js              # Audit only (no changes)
 *   node scripts/audit-and-fix-sequences.js --fix         # Audit + apply fixes
 *
 * Requires firebase-service-account.json in project root or lead-agent/ dir.
 */

const path = require('path');
const admin = require('firebase-admin');

// ── Firebase setup ──────────────────────────────────────────────────────────
let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, '..', 'firebase-service-account.json'));
} catch (_) {
  try {
    serviceAccount = require(path.join(__dirname, '..', 'lead-agent', 'firebase-service-account.json'));
  } catch (__) {
    if (process.env.FIREBASE_PROJECT_ID) {
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
      };
    } else {
      console.error('No Firebase credentials found. Place firebase-service-account.json in project root or lead-agent/ dir.');
      process.exit(1);
    }
  }
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

// ── Constants ───────────────────────────────────────────────────────────────

var CORRECT_EXIT_CONDITIONS = [
  'Converted',
  'Existing Applicant',
  'Unsubscribed',
  'Lost',
  'Closed',
  'Archived'
];

var REFUND_TERMS = [
  'fuld refusion',
  'fully refundable',
  'refund',
  'refusion',
  'money back',
  'pengene tilbage'
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '');
}

function truncate(str, len) {
  if (!str) return null;
  return str.length > len ? str.substring(0, len) + '...' : str;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  var doFix = process.argv.includes('--fix');

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          Firestore Sequence Audit & Fix                      ║');
  console.log('║' + (doFix ? '                  🟢 FIX MODE — WILL WRITE                    ' : '                  🔵 AUDIT ONLY — READ ONLY                    ') + '║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Load all sequences ──────────────────────────────────────────────────
  var seqSnap = await db.collection('sequences').get();
  console.log('Found ' + seqSnap.size + ' sequences in Firestore.\n');

  // ── Load all enrollments ────────────────────────────────────────────────
  var enrollSnap = await db.collection('sequence_enrollments').get();
  var enrollmentsBySeq = {};
  var totalEnrollments = 0;

  enrollSnap.forEach(function (doc) {
    var d = doc.data();
    var sid = d.sequence_id;
    if (!sid) return;
    totalEnrollments++;
    if (!enrollmentsBySeq[sid]) {
      enrollmentsBySeq[sid] = { total: 0, active: 0, paused: 0, completed: 0, exited: 0, at_step_1: 0, at_step_2_plus: 0 };
    }
    enrollmentsBySeq[sid].total++;
    var status = d.status || 'active';
    if (enrollmentsBySeq[sid][status] !== undefined) enrollmentsBySeq[sid][status]++;
    var step = d.current_step || 1;
    if (step <= 1) enrollmentsBySeq[sid].at_step_1++;
    else enrollmentsBySeq[sid].at_step_2_plus++;
  });

  console.log('Total enrollments across all sequences: ' + totalEnrollments + '\n');

  // ── Audit + Fix each sequence ───────────────────────────────────────────
  var refundMatches = [];
  var exitConditionFixes = [];
  var channelFixes = [];

  for (var i = 0; i < seqSnap.docs.length; i++) {
    var doc = seqSnap.docs[i];
    var data = doc.data();
    var docRef = doc.ref;
    var stats = enrollmentsBySeq[doc.id] || { total: 0, active: 0, paused: 0, completed: 0, exited: 0, at_step_1: 0, at_step_2_plus: 0 };

    console.log('━'.repeat(70));
    console.log('📋 ' + (data.name || doc.id));
    console.log('   ID: ' + doc.id);
    console.log('   Active: ' + (data.active === true));
    console.log('   Trigger: ' + JSON.stringify(data.trigger || {}));
    console.log('   Exit conditions: ' + JSON.stringify(data.exit_conditions || []));
    console.log('   enrollment_closes: ' + (data.enrollment_closes || 'NOT SET'));
    console.log('   Enrollments: ' + stats.total + ' (active: ' + stats.active + ', completed: ' + stats.completed + ', exited: ' + stats.exited + ', at_step_1: ' + stats.at_step_1 + ', step_2+: ' + stats.at_step_2_plus + ')');

    var steps = data.steps || [];
    var needsUpdate = false;
    var updateData = {};

    // ── Check exit conditions ─────────────────────────────────────────
    var currentExit = data.exit_conditions || [];
    var exitMatch = currentExit.length === CORRECT_EXIT_CONDITIONS.length &&
      CORRECT_EXIT_CONDITIONS.every(function (c) { return currentExit.includes(c); });

    if (!exitMatch) {
      var removed = currentExit.filter(function (c) { return !CORRECT_EXIT_CONDITIONS.includes(c); });
      var added = CORRECT_EXIT_CONDITIONS.filter(function (c) { return !currentExit.includes(c); });
      console.log('   ⚠️  EXIT CONDITIONS MISMATCH');
      if (removed.length) console.log('       Removing: ' + JSON.stringify(removed));
      if (added.length) console.log('       Adding: ' + JSON.stringify(added));
      exitConditionFixes.push({ name: data.name || doc.id, previous: currentExit, removed: removed, added: added });

      if (doFix) {
        updateData.exit_conditions = CORRECT_EXIT_CONDITIONS;
        needsUpdate = true;
      }
    } else {
      console.log('   ✅ Exit conditions correct');
    }

    // ── Check steps ───────────────────────────────────────────────────
    console.log('   Steps (' + steps.length + '):');
    var stepsChanged = false;

    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];
      var channel = step.channel || 'email';
      var daSubject = step.email_subject || '';
      var daBody = step.email_body || '';
      var enSubject = step.email_subject_en || '';
      var enBody = step.email_body_en || '';
      var smsMsg = step.sms_message || '';
      var hasEmailBody = !!(daBody || enBody);
      var hasSms = !!smsMsg;

      // Channel status
      var channelStatus = '✅';
      var channelNote = '';
      if (hasEmailBody && channel === 'sms') {
        channelStatus = '❌';
        var newChannel = hasSms ? 'both' : 'email';
        channelNote = ' → FIX to "' + newChannel + '"';
        channelFixes.push({
          sequence: data.name || doc.id,
          step_index: s,
          previous: channel,
          new_channel: newChannel,
          da_subject: daSubject || '(none)'
        });
        if (doFix) {
          steps[s].channel = newChannel;
          stepsChanged = true;
        }
      }

      // Content status
      var daStatus = daBody ? '✅' : '❌ EMPTY';
      var enStatus = enBody ? '✅' : '❌ MISSING';

      console.log('     Step ' + (s + 1) + ' (idx ' + s + '):');
      console.log('       Channel: ' + channel + ' ' + channelStatus + channelNote);
      console.log('       Delay: ' + (step.delay_minutes || 0) + ' min (' + Math.round((step.delay_minutes || 0) / 60 / 24 * 10) / 10 + ' days)');
      console.log('       DA subject: ' + (daSubject || '(empty)'));
      console.log('       DA body: ' + daStatus + (daBody ? ' — ' + truncate(stripHtml(daBody), 60) : ''));
      console.log('       EN subject: ' + (enSubject || '(empty)'));
      console.log('       EN body: ' + enStatus + (enBody ? ' — ' + truncate(stripHtml(enBody), 60) : ''));
      if (hasSms) console.log('       SMS: ' + truncate(smsMsg, 60));

      // Refund scan
      var textsToScan = [daBody, enBody, daSubject, enSubject, smsMsg];
      var fieldNames = ['email_body', 'email_body_en', 'email_subject', 'email_subject_en', 'sms_message'];
      for (var t = 0; t < textsToScan.length; t++) {
        var text = textsToScan[t].toLowerCase();
        for (var r = 0; r < REFUND_TERMS.length; r++) {
          if (text.includes(REFUND_TERMS[r])) {
            console.log('       🚨 REFUND LANGUAGE: "' + REFUND_TERMS[r] + '" in ' + fieldNames[t]);
            refundMatches.push({
              sequence: data.name || doc.id,
              step: s,
              term: REFUND_TERMS[r],
              field: fieldNames[t]
            });
          }
        }
      }
    }

    if (stepsChanged) {
      updateData.steps = steps;
      needsUpdate = true;
    }

    // ── Write fixes ───────────────────────────────────────────────────
    if (needsUpdate && doFix) {
      updateData.updated_at = new Date().toISOString();
      await docRef.update(updateData);
      console.log('   💾 FIXED in Firestore');
    }

    console.log('');
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('═'.repeat(70));
  console.log('');
  console.log('AUDIT SUMMARY');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Total sequences: ' + seqSnap.size);
  console.log('Total enrollments: ' + totalEnrollments);
  console.log('');

  // Refund
  if (refundMatches.length === 0) {
    console.log('✅ Refund language: ZERO matches across all content');
  } else {
    console.log('🚨 Refund language: ' + refundMatches.length + ' matches found!');
    refundMatches.forEach(function (m) {
      console.log('   - ' + m.sequence + ' step ' + m.step + ': "' + m.term + '" in ' + m.field);
    });
  }
  console.log('');

  // Exit conditions
  if (exitConditionFixes.length === 0) {
    console.log('✅ Exit conditions: All sequences have correct 6 statuses');
  } else {
    console.log((doFix ? '💾 ' : '⚠️  ') + 'Exit conditions: ' + exitConditionFixes.length + ' sequences ' + (doFix ? 'FIXED' : 'need fixing'));
    exitConditionFixes.forEach(function (f) {
      console.log('   - ' + f.name + ': removed ' + JSON.stringify(f.removed) + ', added ' + JSON.stringify(f.added));
    });
  }
  console.log('');

  // Channel fixes
  if (channelFixes.length === 0) {
    console.log('✅ Channel fields: All steps with email content have correct channel');
  } else {
    console.log((doFix ? '💾 ' : '⚠️  ') + 'Channel mismatches: ' + channelFixes.length + ' steps ' + (doFix ? 'FIXED' : 'need fixing'));
    channelFixes.forEach(function (f) {
      console.log('   - ' + f.sequence + ' step ' + f.step_index + ': ' + f.previous + ' → ' + f.new_channel + ' (subject: ' + f.da_subject + ')');
    });
  }
  console.log('');

  // Enrollment counts
  console.log('ENROLLMENT COUNTS');
  console.log('─'.repeat(40));
  for (var j = 0; j < seqSnap.docs.length; j++) {
    var seqDoc = seqSnap.docs[j];
    var seqData = seqDoc.data();
    var seqStats = enrollmentsBySeq[seqDoc.id] || { total: 0, active: 0, completed: 0, exited: 0, at_step_1: 0, at_step_2_plus: 0 };
    console.log('  ' + (seqData.name || seqDoc.id));
    console.log('    Total: ' + seqStats.total + ' | Active: ' + seqStats.active + ' | Completed: ' + seqStats.completed + ' | Exited: ' + seqStats.exited);
    console.log('    At step 1: ' + seqStats.at_step_1 + ' | At step 2+: ' + seqStats.at_step_2_plus);
  }

  console.log('');
  if (!doFix && (exitConditionFixes.length > 0 || channelFixes.length > 0)) {
    console.log('Run with --fix to apply changes:');
    console.log('  node scripts/audit-and-fix-sequences.js --fix');
    console.log('');
  }

  process.exit(0);
}

main().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
