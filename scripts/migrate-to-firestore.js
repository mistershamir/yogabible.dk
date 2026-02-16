/**
 * One-time migration: CSV exports from Google Sheets → Firestore
 * Run locally: node scripts/migrate-to-firestore.js
 *
 * Requires: firebase-admin (already in package.json)
 * Usage: FIREBASE_KEY=/path/to/key.json node scripts/migrate-to-firestore.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// --- Config ---
const CSV_DIR = '/Users/mistershamir/Library/Mobile Documents/com~apple~CloudDocs/Yoga Bible/yoga-bible-apps-script';
const KEY_PATH = process.env.FIREBASE_KEY ||
  path.join(CSV_DIR, 'yoga-bible-dk-com-firebase-adminsdk-fbsvc-ae51705ec1.json');

const DRY_RUN = process.argv.includes('--dry-run');

// --- Init Firebase ---
const serviceAccount = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// --- CSV Parser (handles quoted fields with commas and newlines) ---
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field);
        field = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        current.push(field);
        field = '';
        if (current.length > 1 || current[0] !== '') {
          rows.push(current);
        }
        current = [];
        if (ch === '\r') i++; // skip \n after \r
      } else {
        field += ch;
      }
    }
  }
  // Last field/row
  if (field || current.length > 0) {
    current.push(field);
    if (current.length > 1 || current[0] !== '') {
      rows.push(current);
    }
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(row => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      if (headers[i]) {
        obj[headers[i]] = (row[i] || '').trim();
      }
    }
    return obj;
  });
}

// --- Safe date parser ---
function safeDate(str) {
  if (!str || str === 'null' || str === 'undefined') return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return d;
}

// --- Transform functions ---

function transformLead(row) {
  const doc = {
    email: (row.email || '').toLowerCase().trim(),
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    phone: row.phone || '',
    type: row.type || '',
    ytt_program_type: row.ytt_program_type || '',
    program: row.program || '',
    course_id: row.course_id || '',
    cohort_label: row.cohort_label || '',
    preferred_month: row.preferred_month || '',
    accommodation: row.accommodation || '',
    city_country: row.city_country || '',
    housing_months: row.housing_months || '',
    service: row.service || '',
    subcategories: row.subcategories || '',
    message: row.message || '',
    source: row.source || '',
    status: row.status || 'New',
    converted: row.converted === 'Yes' || row.converted === 'TRUE',
    converted_at: row.converted_at || null,
    application_id: row.application_id || null,
    sms_status: row.sms_status || '',
    call_attempts: parseInt(row.call_attempts) || 0,
    unsubscribed: (row.status || '').toLowerCase().includes('unsubscribed'),
    // Parse notes into text (keep as string for now, can structure later)
    notes: row.notes || '',
    last_contact: row.last_contact || null,
    followup_date: row.followup_date || null,
    created_at: safeDate(row.timestamp) || new Date(),
    updated_at: new Date(),
    _migrated_from: 'google_sheets'
  };

  // Skip rows with no email
  if (!doc.email) return null;
  return doc;
}

function transformApplication(row) {
  const doc = {
    application_id: row.application_id || '',
    email: (row.email || '').toLowerCase().trim(),
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    phone: row.phone || '',
    type: row.type || '',
    ytt_program_type: row.ytt_program_type || '',
    course_id: row.course_id || '',
    course_name: row.course_name || '',
    cohort_id: row.cohort_id || '',
    cohort_label: row.cohort_label || '',
    track: row.track || '',
    payment_choice: row.payment_choice || '',
    bundle_type: row.bundle_type || '',
    bundle_payment_url: row.bundle_payment_url || '',
    mentorship_selected: row.mentorship_selected || '',
    hear_about: row.hear_about || '',
    hear_about_other: row.hear_about_other || '',
    source: row.source || '',
    status: row.status || 'Pending',
    notes: row.notes || '',
    created_at: safeDate(row.timestamp) || new Date(),
    updated_at: new Date(),
    _migrated_from: 'google_sheets'
  };

  if (!doc.email) return null;
  return doc;
}

function transformEmailTemplate(row) {
  const doc = {
    template_id: row.template_id || '',
    name: row.name || '',
    category: row.category || '',
    style: row.style || '',
    segment_tags: row.segment_tags ? row.segment_tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    subject: row.subject || '',
    body_html: row.body_html || '',
    active: row.active !== 'FALSE' && row.active !== 'false',
    _migrated_from: 'google_sheets'
  };

  if (!doc.template_id) return null;
  return doc;
}

function transformEmailLog(row) {
  return {
    lead_email: (row.lead_email || '').toLowerCase().trim(),
    lead_name: row.lead_name || '',
    template_id: row.template_id || '',
    template_name: row.template_name || '',
    subject: row.subject || '',
    sent_by: row.sent_by || '',
    created_at: safeDate(row.timestamp) || new Date(),
    _migrated_from: 'google_sheets'
  };
}

function transformEmailArchive(row) {
  return {
    archive_id: row.archive_id || '',
    subject: row.subject || '',
    body_html: row.body_html || '',
    created_at: safeDate(row.created_at) || new Date(),
    last_used: row.last_used || null,
    use_count: parseInt(row.use_count) || 0,
    _migrated_from: 'google_sheets'
  };
}

function transformCourseCatalog(row) {
  // Skip empty rows
  if (!row.course_id && !row.course_name) return null;

  return {
    course_id: row.course_id || '',
    course_name: row.course_name || '',
    category: row.category || '',
    track: row.track || '',
    cohort_id: row.cohort_id || '',
    cohort_label: row.cohort_label || '',
    start_date: row.start_date || '',
    end_date: row.end_date || '',
    capacity: parseInt(row.capacity) || 0,
    waitlist_enabled: row.waitlist_enabled === 'TRUE',
    active: row.active === 'TRUE',
    external_only: row.external_only === 'TRUE',
    external_url: row.external_url || '',
    payment_url_full: row.payment_url_full || '',
    payment_url_deposit: row.payment_url_deposit || '',
    price_full: parseInt(row.price_full) || 0,
    currency: row.currency || 'DKK',
    deposit_amount: row.deposit_amount || '',
    allow_deposit: row.allow_deposit === 'TRUE',
    allow_instalments: row.allow_instalments === 'TRUE',
    max_instalments: parseInt(row.max_instalments) || 0,
    notes: row.notes || '',
    sort_key: row.sort_key || '',
    open_status: row.open_status || '',
    _migrated_from: 'google_sheets'
  };
}

// --- Batch write helper (Firestore limit: 500 per batch) ---
async function writeBatch(collectionName, docs, useDocId = null) {
  console.log(`  Writing ${docs.length} docs to "${collectionName}"...`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} docs`);
    if (docs.length > 0) {
      console.log('  Sample:', JSON.stringify(docs[0], null, 2).substring(0, 300));
    }
    return;
  }

  const batchSize = 450; // stay under 500 limit
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + batchSize);

    for (const doc of chunk) {
      let ref;
      if (useDocId && doc[useDocId]) {
        ref = db.collection(collectionName).doc(doc[useDocId]);
      } else {
        ref = db.collection(collectionName).doc();
      }
      batch.set(ref, doc);
    }

    await batch.commit();
    console.log(`  Batch ${Math.floor(i / batchSize) + 1}: wrote ${chunk.length} docs`);
  }
}

// --- Main ---
async function main() {
  console.log('=== Yoga Bible: Sheets → Firestore Migration ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`CSV dir: ${CSV_DIR}`);
  console.log('');

  const files = {
    leads: 'Applications - Leads (RAW).csv',
    applications: 'Applications - Applications (RAW).csv',
    emailTemplates: 'Applications - Email Templates.csv',
    emailLog: 'Applications - Email Log.csv',
    emailArchive: 'Applications - EmailArchive.csv',
    courseCatalog: 'Applications - Course Catalog.csv'
  };

  // 1. Leads
  console.log('--- LEADS ---');
  const leadsRaw = parseCSV(path.join(CSV_DIR, files.leads));
  const leads = leadsRaw.map(transformLead).filter(Boolean);
  console.log(`  Parsed: ${leadsRaw.length} rows → ${leads.length} valid leads`);
  await writeBatch('leads', leads);

  // 2. Applications
  console.log('\n--- APPLICATIONS ---');
  const appsRaw = parseCSV(path.join(CSV_DIR, files.applications));
  const apps = appsRaw.map(transformApplication).filter(Boolean);
  console.log(`  Parsed: ${appsRaw.length} rows → ${apps.length} valid applications`);
  await writeBatch('applications', apps, 'application_id');

  // 3. Email Templates (use template_id as doc ID)
  console.log('\n--- EMAIL TEMPLATES ---');
  const templatesRaw = parseCSV(path.join(CSV_DIR, files.emailTemplates));
  const templates = templatesRaw.map(transformEmailTemplate).filter(Boolean);
  console.log(`  Parsed: ${templatesRaw.length} rows → ${templates.length} valid templates`);
  await writeBatch('email_templates', templates, 'template_id');

  // 4. Email Log
  console.log('\n--- EMAIL LOG ---');
  const logRaw = parseCSV(path.join(CSV_DIR, files.emailLog));
  const logs = logRaw.map(transformEmailLog).filter(Boolean);
  console.log(`  Parsed: ${logRaw.length} rows → ${logs.length} valid log entries`);
  await writeBatch('email_log', logs);

  // 5. Email Archive
  console.log('\n--- EMAIL ARCHIVE ---');
  const archiveRaw = parseCSV(path.join(CSV_DIR, files.emailArchive));
  const archives = archiveRaw.map(transformEmailArchive).filter(Boolean);
  console.log(`  Parsed: ${archiveRaw.length} rows → ${archives.length} valid archive entries`);
  await writeBatch('email_archive', archives, 'archive_id');

  // 6. Course Catalog
  console.log('\n--- COURSE CATALOG ---');
  const catalogRaw = parseCSV(path.join(CSV_DIR, files.courseCatalog));
  const catalog = catalogRaw.map(transformCourseCatalog).filter(Boolean);
  console.log(`  Parsed: ${catalogRaw.length} rows → ${catalog.length} valid courses`);
  await writeBatch('course_catalog', catalog);

  console.log('\n=== Migration complete! ===');

  // Summary
  console.log('\nSummary:');
  console.log(`  leads: ${leads.length}`);
  console.log(`  applications: ${apps.length}`);
  console.log(`  email_templates: ${templates.length}`);
  console.log(`  email_log: ${logs.length}`);
  console.log(`  email_archive: ${archives.length}`);
  console.log(`  course_catalog: ${catalog.length}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
