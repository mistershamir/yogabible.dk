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
        program: payload.program || '18 UGERS FLEKSIBELT PROGRAM - Marts-Juni 2026',
        course_id: '',
        cohort_label: extractCohortLabel(payload.program),
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
        program: payload.program || '18 UGERS FLEKSIBELT PROGRAM - August-December 2026',
        course_id: '',
        cohort_label: 'August-December 2026',
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
        program: payload.program || '4-Week Intensive YTT',
        course_id: '',
        cohort_label: payload.program || '',
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
        program: payload.program || '4-Week Vinyasa Plus YTT (July)',
        course_id: '',
        cohort_label: 'Juli 2026',
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
        program: payload.program || '8-Week Semi-Intensive YTT',
        course_id: '',
        cohort_label: payload.cohort || '',
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
      // Store raw program types; getDisplayProgram() handles display names per language
      return {
        ...base,
        type: 'ytt',
        ytt_program_type: programTypes.join(','),
        program: programTypes.join(' + ') + ' Yoga Teacher Training',
        course_id: '',
        cohort_label: '',
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
