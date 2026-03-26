/**
 * Lead Capture Endpoint — Yoga Bible
 * Public endpoint for website forms. Writes to Firestore.
 *
 * POST /.netlify/functions/lead
 * Also supports GET with query params (JSONP callback)
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { CONFIG, getDisplayProgram } = require('./shared/config');
const {
  jsonResponse, optionsResponse, formatDate, normalizeYesNo,
  detectAction
} = require('./shared/utils');
const { sendAdminNotification } = require('./shared/email-service');
const { sendWelcomeSMS } = require('./shared/sms-service');
const { sendWelcomeEmail } = require('./shared/lead-emails');
const { triggerNewLeadSequences } = require('./shared/sequence-trigger');
const { detectLeadCountry } = require('./shared/country-detect');

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

function generateScheduleToken(leadId, email) {
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(leadId + ':' + email.toLowerCase().trim());
  return hmac.digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  try {
    let payload;
    let callback = '';

    if (event.httpMethod === 'POST') {
      payload = parseBody(event);
    } else if (event.httpMethod === 'GET') {
      payload = event.queryStringParameters || {};
      callback = payload.callback || '';
    } else {
      return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }

    const action = detectAction(payload);
    if (!action || !(action.startsWith('lead_') || action === 'contact')) {
      // NOTE: lead_meta is included via startsWith('lead_')
      return wrapCallback(callback, jsonResponse(400, { ok: false, error: 'Could not determine lead type' }));
    }

    // Process the lead
    const leadData = processLead(payload, action);

    // Detect and normalize country for nurture sequence country blocks
    if (!leadData.country) {
      leadData.country = detectLeadCountry(leadData);
    }

    // Check for existing applicant in Firestore
    const existingAppId = await getExistingApplicationId(leadData.email);
    if (existingAppId) {
      leadData.notes = `EXISTING APPLICANT (App ID: ${existingAppId})`;
      leadData.status = 'Existing Applicant';
    }

    // Write to Firestore
    const db = getDb();
    const docRef = await db.collection('leads').add({
      ...leadData,
      created_at: new Date(),
      updated_at: new Date()
    });

    // Store schedule tracking token on lead doc for sequence email injection
    const scheduleTokenForDoc = generateScheduleToken(docRef.id, leadData.email);
    await db.collection('leads').doc(docRef.id).update({
      schedule_token: scheduleTokenForDoc
    });

    // Identity stitching: merge anonymous browsing history into lead profile
    const visitorId = payload.visitor_id || payload.visitorId || '';
    if (visitorId) {
      stitchAnonymousVisits(db, docRef.id, visitorId).catch(err => {
        console.error('[lead] Anonymous visit stitching error (non-blocking):', err.message);
      });
    }

    console.log(`[lead] New lead saved: ${docRef.id} (${leadData.email})`);

    // Send notifications (admin email + welcome email + welcome SMS)
    // Must await — Netlify Functions terminate after response is sent
    await triggerNotifications(leadData, docRef.id, action).catch(err => {
      console.error('[lead] Notification error (non-blocking):', err.message);
    });

    // Auto-enroll in matching sequences (non-blocking)
    triggerNewLeadSequences(docRef.id, leadData).catch(err => {
      console.error('[lead] Sequence enrollment error (non-blocking):', err.message);
    });

    // Auto-add to lead-synced email lists (non-blocking)
    autoAddLeadToLists(db, docRef.id, leadData).catch(err => {
      console.error('[lead] Auto-add to email list error (non-blocking):', err.message);
    });

    const response = jsonResponse(200, { ok: true, message: 'Request received successfully' });
    return wrapCallback(callback, response);
  } catch (error) {
    console.error('Lead handler error:', error);
    return jsonResponse(500, { ok: false, error: 'Server error: ' + error.message });
  }
};

/**
 * Parse POST body — supports JSON, URL-encoded (FormData / URLSearchParams), and plain text JSON
 */
function parseBody(event) {
  const contentType = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  const body = event.body || '';

  // URL-encoded (FormData or URLSearchParams)
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const params = new URLSearchParams(body);
    const obj = {};
    for (const [key, value] of params) {
      obj[key] = value;
    }
    return obj;
  }

  // JSON or text/plain with JSON inside
  try {
    return JSON.parse(body);
  } catch (e) {
    // Last resort: try URL-encoded
    try {
      const params = new URLSearchParams(body);
      if (params.has('email') || params.has('firstName') || params.has('action')) {
        const obj = {};
        for (const [key, value] of params) {
          obj[key] = value;
        }
        return obj;
      }
    } catch (e2) {}
    return {};
  }
}

function wrapCallback(callback, response) {
  if (!callback) return response;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/javascript' },
    body: `${callback}(${response.body});`
  };
}

/**
 * Auto-add new lead to email lists with lead_auto_sync enabled
 */
async function autoAddLeadToLists(db, leadId, leadData) {
  const listSnap = await db.collection('email_lists')
    .where('lead_auto_sync', '==', true)
    .get();

  if (listSnap.empty) return;

  const email = (leadData.email || '').toLowerCase().trim();
  if (!email) return;

  const tags = ['lead', 'new-lead'];
  if (leadData.type) tags.push(leadData.type);
  if (leadData.temperature) tags.push(leadData.temperature);

  for (const listDoc of listSnap.docs) {
    // Check for duplicate
    const existing = await db.collection('email_list_contacts')
      .where('list_id', '==', listDoc.id)
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!existing.empty) continue;

    await db.collection('email_list_contacts').add({
      list_id: listDoc.id,
      email,
      first_name: leadData.first_name || '',
      last_name: leadData.last_name || '',
      lead_id: leadId,
      lead_data: {
        status: leadData.status || 'New',
        type: leadData.type || '',
        program: leadData.program || leadData.ytt_program_type || '',
        ytt_program_type: leadData.ytt_program_type || '',
        temperature: leadData.temperature || '',
        source: leadData.source || '',
        channel: leadData.channel || '',
        phone: leadData.phone || '',
        lang: leadData.lang || 'da',
        lead_created_at: new Date().toISOString()
      },
      lead_synced_at: new Date().toISOString(),
      tags,
      status: 'active',
      created_at: new Date().toISOString(),
      engagement: {
        emails_sent: 0, emails_opened: 0, emails_clicked: 0,
        last_sent_at: null, last_opened_at: null, last_clicked_at: null
      }
    });

    await db.collection('email_lists').doc(listDoc.id).update({
      contact_count: (listDoc.data().contact_count || 0) + 1,
      updated_at: new Date().toISOString()
    });
  }
}

function processLead(payload, action) {
  const base = {
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(),
    last_name: (payload.lastName || '').trim(),
    phone: (payload.phone || '').trim(),
    converted: false,
    converted_at: null,
    application_id: null,
    status: 'New',
    notes: '',
    unsubscribed: false,
    call_attempts: 0,
    sms_status: '',
    last_contact: null,
    followup_date: null,
    multi_format: payload.multiFormat || '',
    all_formats: payload.allFormats || '',
    lang: payload.lang || '',
    // Attribution / channel tracking
    channel: payload.channel || '',
    utm_source: payload.utm_source || '',
    utm_medium: payload.utm_medium || '',
    utm_campaign: payload.utm_campaign || '',
    gclid: payload.gclid || '',
    fbclid: payload.fbclid || '',
    referrer: payload.referrer || '',
    landing_page: payload.landing_page || ''
  };

  switch (action) {
    case 'lead_schedule_18w':
    case 'lead_schedule_18w-mar':
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: '18-week',
        program: payload.program || '18-Week Flexible YTT (March–June 2026)',
        course_id: '',
        cohort_label: 'March–June 2026',
        preferred_month: '',
        accommodation: normalizeYesNo(payload.housing || payload.accommodation || 'No'),
        city_country: payload.origin || payload.cityCountry || '',
        housing_months: getHousingMonths(payload),
        service: '',
        subcategories: '',
        message: '',
        source: 'Website'
      };

    case 'lead_schedule_18w-aug':
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: '18-week-aug',
        program: payload.program || '18-Week Flexible YTT (August–December 2026)',
        course_id: '',
        cohort_label: 'August–December 2026',
        preferred_month: '',
        accommodation: normalizeYesNo(payload.housing || payload.accommodation || 'No'),
        city_country: payload.origin || payload.cityCountry || '',
        housing_months: getHousingMonths(payload),
        service: '',
        subcategories: '',
        message: '',
        source: 'Website'
      };

    case 'lead_schedule_4w':
    case 'lead_schedule_4w-apr':
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: '4-week',
        program: payload.program || '4-Week Intensive YTT (April 2026)',
        course_id: '',
        cohort_label: payload.program || 'April 2026',
        preferred_month: '',
        accommodation: normalizeYesNo(payload.accommodation || 'No'),
        city_country: payload.cityCountry || '',
        housing_months: '',
        service: '',
        subcategories: '',
        message: '',
        source: 'Website'
      };

    case 'lead_schedule_4w-jul':
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: '4-week-jul',
        program: payload.program || '4-Week Vinyasa Plus YTT (July 2026)',
        course_id: '',
        cohort_label: 'July 2026',
        preferred_month: '',
        accommodation: normalizeYesNo(payload.accommodation || 'No'),
        city_country: payload.cityCountry || '',
        housing_months: '',
        service: '',
        subcategories: '',
        message: '',
        source: 'Website'
      };

    case 'lead_schedule_8w':
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: '8-week',
        program: payload.program || '8-Week Semi-Intensive YTT (May–June 2026)',
        course_id: '',
        cohort_label: payload.cohort || 'May–June 2026',
        preferred_month: '',
        accommodation: normalizeYesNo(payload.accommodation || 'No'),
        city_country: payload.cityCountry || '',
        housing_months: '',
        service: '',
        subcategories: '',
        message: '',
        source: 'Website'
      };

    case 'lead_schedule_multi': {
      // User selected multiple 200h formats (e.g. 4w,8w,18w)
      const allFmts = (payload.allFormats || '').split(',').filter(f => f);
      const fmtMap = { '4w': '4-week', '8w': '8-week', '18w': '18-week', '4w-apr': '4-week', '4w-jul': '4-week-jul', '18w-aug': '18-week-aug' };
      const programTypes = allFmts.map(f => fmtMap[f] || f);
      // Human-readable names with cohort dates
      const displayMap = {
        '4-week': '4-Week Intensive (April 2026)',
        '4-week-jul': '4-Week Vinyasa Plus (July 2026)',
        '8-week': '8-Week Semi-Intensive (May–June 2026)',
        '18-week': '18-Week Flexible (March–June 2026)',
        '18-week-aug': '18-Week Flexible (August–December 2026)'
      };
      const displayNames = programTypes.map(t => displayMap[t] || t);
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: programTypes.join(','),
        program: displayNames.join(' + ') + ' YTT',
        course_id: '',
        cohort_label: displayNames.join(' + '),
        preferred_month: '',
        accommodation: normalizeYesNo(payload.accommodation || 'No'),
        city_country: payload.cityCountry || '',
        housing_months: '',
        service: '',
        subcategories: '',
        message: '',
        source: 'Website',
        all_formats: payload.allFormats || ''
      };
    }

    case 'lead_schedule_300h':
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: '300h',
        program: payload.program || '300-Hour Advanced Yoga Teacher Training',
        course_id: '',
        cohort_label: payload.cohort || '2026',
        preferred_month: '',
        accommodation: normalizeYesNo(payload.accommodation || 'No'),
        city_country: payload.cityCountry || '',
        housing_months: '',
        service: '',
        subcategories: '',
        message: payload.message || '',
        source: 'Website'
      };

    case 'lead_schedule_50h':
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: '50h',
        program: payload.program || '50-Hour Specialty Teacher Training',
        course_id: '',
        cohort_label: payload.cohort || '',
        preferred_month: '',
        accommodation: 'No',
        city_country: payload.cityCountry || '',
        housing_months: '',
        service: '',
        subcategories: payload.specialty || '',
        message: payload.message || '',
        source: 'Website'
      };

    case 'lead_schedule_30h':
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: '30h',
        program: payload.program || '30-Hour Module',
        course_id: '',
        cohort_label: payload.cohort || '',
        preferred_month: '',
        accommodation: 'No',
        city_country: payload.cityCountry || '',
        housing_months: '',
        service: '',
        subcategories: payload.module || '',
        message: payload.message || '',
        source: 'Website'
      };

    case 'lead_courses': {
      const courses = payload.courses || '';
      const isBundle = courses.includes(',') || courses.includes(' + ');
      return {
        ...base,
        type: isBundle ? 'bundle' : 'course',
        ytt_program_type: '',
        program: courses,
        course_id: '',
        cohort_label: payload.preferredMonth || '',
        preferred_month: payload.preferredMonth || 'Not sure yet',
        accommodation: normalizeYesNo(payload.accommodation || payload.housing || 'No'),
        city_country: payload.cityCountry || payload.origin || '',
        housing_months: payload.housingMonths || '',
        service: '',
        subcategories: '',
        message: '',
        source: 'Website'
      };
    }

    case 'lead_mentorship': {
      let subcategories = payload.subcategories || '';
      if (Array.isArray(subcategories)) subcategories = subcategories.join(', ');
      return {
        ...base,
        type: 'mentorship',
        ytt_program_type: '',
        program: payload.service || '',
        course_id: '',
        cohort_label: '',
        preferred_month: '',
        accommodation: 'No',
        city_country: '',
        housing_months: '',
        service: payload.service || '',
        subcategories,
        message: payload.message || '',
        source: 'Website'
      };
    }

    case 'lead_meta': {
      // Meta (Facebook/Instagram) Lead Forms via Zapier webhook
      // Meta provides: full_name, email, phone_number, city, and custom questions
      const fullName = payload.full_name || payload.fullName || '';
      const nameParts = fullName.trim().split(/\s+/);
      const metaFirst = payload.firstName || payload.first_name || nameParts[0] || '';
      const metaLast = payload.lastName || payload.last_name || nameParts.slice(1).join(' ') || '';
      const metaPhone = payload.phone_number || payload.phone || '';
      const metaEmail = (payload.email || '').toLowerCase().trim();
      // Try to detect program interest from Meta form fields
      const metaProgram = payload.program || payload.which_program || payload.interested_in || '';
      const metaFormName = payload.form_name || payload.ad_name || payload.campaign_name || '';
      const metaCity = payload.city || payload.cityCountry || '';

      // Override base with Meta-specific values
      base.email = metaEmail;
      base.first_name = metaFirst;
      base.last_name = metaLast;
      base.phone = metaPhone;

      return {
        ...base,
        type: 'ytt',
        ytt_program_type: detectMetaYTTType(metaProgram, metaFormName),
        program: metaProgram || metaFormName || 'Meta Lead Form',
        course_id: '',
        cohort_label: '',
        preferred_month: '',
        accommodation: normalizeYesNo(payload.housing || payload.accommodation || 'No'),
        city_country: metaCity,
        housing_months: '',
        service: '',
        subcategories: '',
        message: payload.message || '',
        source: 'Facebook Ad',
        channel: payload.meta_platform === 'instagram' ? 'Instagram Ads' : 'Meta Ads',
        meta_form_id: payload.form_id || '',
        meta_ad_id: payload.ad_id || '',
        meta_campaign: payload.campaign_name || ''
      };
    }

    case 'contact':
      return {
        ...base,
        type: 'contact',
        ytt_program_type: '',
        program: '',
        course_id: '',
        cohort_label: '',
        preferred_month: '',
        accommodation: 'No',
        city_country: '',
        housing_months: '',
        service: '',
        subcategories: '',
        message: payload.message || '',
        source: 'Contact page'
      };

    default:
      return { ...base, type: 'unknown', source: 'Unknown' };
  }
}

function extractCohortLabel(program) {
  if (!program) return 'March-June 2026';
  if (program.includes('August') || program.includes('December')) return 'August-December 2026';
  return 'March-June 2026';
}

function getHousingMonths(payload) {
  if (payload.housingMonths) return payload.housingMonths;
  if (Array.isArray(payload.months)) return payload.months.join(', ');
  if (payload.months) return payload.months;
  return '';
}

async function getExistingApplicationId(email) {
  try {
    const db = getDb();
    const snap = await db.collection('applications')
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data().application_id || 'Unknown';
  } catch (err) {
    console.error('getExistingApplicationId error:', err.message);
    return null;
  }
}

/**
 * Fire-and-forget notifications when a new lead comes in
 * - Admin notification email
 * - Welcome SMS to the lead
 */
/**
 * Detect YTT program type from Meta Lead Form fields
 */
function detectMetaYTTType(program, formName) {
  const combined = `${program} ${formName}`.toLowerCase();
  if (combined.includes('300')) return '300h';
  if (combined.includes('50h') || combined.includes('50 hour')) return '50h';
  if (combined.includes('30h') || combined.includes('30 hour')) return '30h';
  if (combined.includes('18') || combined.includes('fleksib') || combined.includes('flexible')) return '18-week';
  if (combined.includes('8') && (combined.includes('uge') || combined.includes('week') || combined.includes('semi'))) return '8-week';
  if (combined.includes('4') && (combined.includes('uge') || combined.includes('week') || combined.includes('intensi'))) return '4-week';
  if (combined.includes('course') || combined.includes('kursus')) return '';
  // Default to general YTT interest
  return '4-week';
}

async function triggerNotifications(leadData, leadDocId, action) {
  const promises = [];

  // 1. Admin notification email
  if (process.env.GMAIL_APP_PASSWORD) {
    promises.push(
      sendAdminNotification(leadData).catch(err => {
        console.error('[lead] Admin notification failed:', err.message);
      })
    );
  }

  // 2. Welcome email to the lead (with tokenized schedule link)
  if (process.env.GMAIL_APP_PASSWORD && leadData.email) {
    const scheduleToken = generateScheduleToken(leadDocId, leadData.email);
    promises.push(
      sendWelcomeEmail(leadData, action, { leadId: leadDocId, token: scheduleToken }).catch(err => {
        console.error('[lead] Welcome email failed:', err.message);
      })
    );
  }

  // 3. Welcome SMS
  if (process.env.GATEWAYAPI_TOKEN && leadData.phone) {
    promises.push(
      sendWelcomeSMS(leadData, leadDocId).catch(err => {
        console.error('[lead] Welcome SMS failed:', err.message);
      })
    );
  }

  await Promise.all(promises);
}

// ── Anonymous visit stitching ─────────────────────────────────────────────────

/**
 * Merge anonymous browsing history into the lead profile and calculate heat score.
 * Called when a lead form includes a visitor_id (yb_vid cookie).
 */
async function stitchAnonymousVisits(db, leadId, visitorId) {
  const anonRef = db.collection('anonymous_visits').doc(visitorId);
  const anonDoc = await anonRef.get();
  if (!anonDoc.exists) return;

  const anon = anonDoc.data();
  const pages = anon.pages || {};
  const visits = anon.visits || [];
  const ctaClicks = anon.cta_clicks || [];

  // Build pre-lead journey summary
  const uniquePages = Object.keys(pages);
  const totalPageviews = anon.total_pageviews || 0;
  const totalSessions = anon.total_sessions || 0;

  // Calculate days between first visit and now (lead signup)
  let daysBeforeSignup = 0;
  if (anon.created_at) {
    const firstMs = anon.created_at.toDate ? anon.created_at.toDate().getTime() : new Date(anon.created_at).getTime();
    daysBeforeSignup = Math.max(0, Math.round((Date.now() - firstMs) / (1000 * 60 * 60 * 24)));
  }

  // Key page flags
  const allPaths = uniquePages.map(s => (pages[s].path || '').toLowerCase());
  const viewedSchedule = allPaths.some(p => p.includes('/skema/') || p.includes('/schedule/') || p.includes('/tidsplan/'));
  const viewedAccommodation = allPaths.some(p => p.includes('/bolig') || p.includes('/accommodation') || p.includes('/housing'));
  const viewedCopenhagen = allPaths.some(p => p.includes('/koebenhavn') || p.includes('/copenhagen'));
  const viewedPricing = allPaths.some(p =>
    p.includes('/4-ugers-') || p.includes('/8-ugers-') || p.includes('/18-ugers-') ||
    p.includes('/4-week-') || p.includes('/8-week-') || p.includes('/18-week-') ||
    p.includes('/om-200') || p.includes('/about-200') || p.includes('/priser') || p.includes('/prices')
  );
  const viewedJournal = allPaths.some(p => p.includes('/yoga-journal'));

  // Calculate heat score (1-5)
  let leadHeat = 1;
  if (totalSessions >= 4 && viewedSchedule && viewedAccommodation) {
    leadHeat = 5;
  } else if (totalSessions >= 2 && viewedSchedule) {
    leadHeat = 4;
  } else if (totalSessions === 1 && totalPageviews >= 3 && viewedSchedule) {
    leadHeat = 3;
  } else if (totalSessions >= 1 && totalPageviews >= 2) {
    leadHeat = 2;
  }

  // Merge into lead doc
  const updates = {
    // Pre-lead journey summary
    'pre_lead_journey.visitor_id': visitorId,
    'pre_lead_journey.total_sessions': totalSessions,
    'pre_lead_journey.total_pageviews': totalPageviews,
    'pre_lead_journey.days_before_signup': daysBeforeSignup,
    'pre_lead_journey.return_visitor': totalSessions > 1,
    'pre_lead_journey.first_visit': anon.created_at || null,
    'pre_lead_journey.pages': pages,
    'pre_lead_journey.visits': visits.slice(-100), // keep last 100 entries
    'pre_lead_journey.attribution': anon.attribution || null,
    // Key page flags
    'pre_lead_journey.viewed_schedule': viewedSchedule,
    'pre_lead_journey.viewed_accommodation': viewedAccommodation,
    'pre_lead_journey.viewed_copenhagen': viewedCopenhagen,
    'pre_lead_journey.viewed_pricing': viewedPricing,
    'pre_lead_journey.viewed_journal': viewedJournal,
    // Heat score
    lead_heat: leadHeat,
    updated_at: new Date()
  };

  // Also seed site_engagement from anonymous data so it's immediately visible
  updates['site_engagement.total_pageviews'] = totalPageviews;
  updates['site_engagement.total_sessions'] = totalSessions;
  updates['site_engagement.first_visit'] = anon.created_at || null;
  updates['site_engagement.last_visit'] = anon.last_visit || null;
  updates['site_engagement.pages'] = pages;
  if (ctaClicks.length > 0) {
    updates['site_engagement.cta_clicks'] = ctaClicks;
  }

  // Detect interests from pages
  const interests = [];
  allPaths.forEach(p => {
    if ((p.includes('/skema/') || p.includes('/schedule/') || p.includes('/tidsplan/')) && interests.indexOf('schedule') === -1) interests.push('schedule');
    if ((p.includes('/4-ugers-') || p.includes('/4-week-')) && interests.indexOf('4-week') === -1) interests.push('4-week');
    if ((p.includes('/8-ugers-') || p.includes('/8-week-')) && interests.indexOf('8-week') === -1) interests.push('8-week');
    if ((p.includes('/18-ugers-') || p.includes('/18-week-')) && interests.indexOf('18-week') === -1) interests.push('18-week');
    if ((p.includes('/om-200') || p.includes('/about-200')) && interests.indexOf('teacher-training') === -1) interests.push('teacher-training');
    if ((p.includes('/priser') || p.includes('/prices')) && interests.indexOf('pricing') === -1) interests.push('pricing');
    if (p.includes('/yoga-journal') && interests.indexOf('blog') === -1) interests.push('blog');
    if ((p.includes('/kurser') || p.includes('/courses')) && interests.indexOf('courses') === -1) interests.push('courses');
  });
  if (interests.length > 0) {
    updates['site_engagement.interests'] = interests;
  }

  await db.collection('leads').doc(leadId).update(updates);

  // Archive the anonymous visits doc (delete to save storage)
  await anonRef.delete();

  console.log(`[lead] Stitched anonymous visits for ${visitorId} → lead ${leadId} (heat: ${leadHeat}, sessions: ${totalSessions}, pages: ${totalPageviews})`);
}
