/**
 * Lead Capture Endpoint — Yoga Bible
 * Public endpoint for website forms. Writes to Firestore.
 *
 * POST /.netlify/functions/lead
 * Also supports GET with query params (JSONP callback)
 */

const { getDb } = require('./shared/firestore');
const { CONFIG } = require('./shared/config');
const {
  jsonResponse, optionsResponse, formatDate, normalizeYesNo,
  detectAction
} = require('./shared/utils');
const { sendAdminNotification } = require('./shared/email-service');
const { sendWelcomeSMS } = require('./shared/sms-service');

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

    // Fire-and-forget: admin notification + welcome SMS
    // These run in background — don't block the form response
    triggerNotifications(leadData, docRef.id).catch(err => {
      console.error('[lead] Notification error (non-blocking):', err.message);
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
    followup_date: null
  };

  switch (action) {
    case 'lead_schedule_18w':
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
        source: payload.source || '200H YTT - 18-week landing page'
      };

    case 'lead_schedule_4w':
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
        source: payload.source || '200H YTT - 4-week landing page'
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
        source: payload.source || '200H YTT - 8-week landing page'
      };

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
        source: payload.source || '300H Advanced YTT landing page'
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
        source: payload.source || '50H Specialty landing page'
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
        source: payload.source || '30H Module landing page'
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
        source: payload.source || 'Courses - landing page'
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
        source: payload.sourceUrl || 'Mentorship intake form'
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
        source: payload.source || 'Contact form'
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
async function triggerNotifications(leadData, leadDocId) {
  const promises = [];

  // 1. Admin notification email
  if (process.env.GMAIL_APP_PASSWORD) {
    promises.push(
      sendAdminNotification(leadData).catch(err => {
        console.error('[lead] Admin notification failed:', err.message);
      })
    );
  }

  // 2. Welcome SMS
  if (process.env.GATEWAYAPI_TOKEN && leadData.phone) {
    promises.push(
      sendWelcomeSMS(leadData, leadDocId).catch(err => {
        console.error('[lead] Welcome SMS failed:', err.message);
      })
    );
  }

  await Promise.all(promises);
}
