/**
 * Lead Capture Endpoint — Yoga Bible
 * Replaces doPost/doGet lead handling from Apps Script
 *
 * POST /.netlify/functions/lead
 * Also supports GET with query params (JSONP callback)
 */

const { getSheetData, appendRow, parseSheetData } = require('./shared/google-sheets');
const { downloadFile } = require('./shared/google-drive');
const { CONFIG } = require('./shared/config');
const {
  jsonResponse, optionsResponse, formatDate, normalizeYesNo,
  getScheduleFileId, detectAction, LEADS_SCHEMA
} = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  try {
    let payload;
    let callback = '';

    if (event.httpMethod === 'POST') {
      payload = JSON.parse(event.body || '{}');
    } else if (event.httpMethod === 'GET') {
      payload = event.queryStringParameters || {};
      callback = payload.callback || '';
    } else {
      return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }

    const action = detectAction(payload);
    if (!action || !action.startsWith('lead_')) {
      return wrapCallback(callback, jsonResponse(400, { ok: false, error: 'Could not determine lead type' }));
    }

    // Process the lead
    const leadData = processLead(payload, action);

    // Check for existing applicant
    const existingAppId = await getExistingApplicationId(leadData.email);
    if (existingAppId) {
      leadData.notes = `EXISTING APPLICANT (App ID: ${existingAppId})`;
      leadData.status = 'Existing Applicant';
    }

    // Get headers from existing sheet or use schema
    let data;
    try {
      data = await getSheetData('Leads (RAW)');
    } catch (err) {
      console.error('Could not read Leads (RAW):', err.message);
      return wrapCallback(callback, jsonResponse(500, { ok: false, error: 'Database error' }));
    }

    const headers = (data && data.length > 0) ? data[0] : LEADS_SCHEMA;

    // Build row array matching header order
    const rowArray = headers.map(h => leadData[h] || '');
    await appendRow('Leads (RAW)', rowArray);

    // TODO: Phase 3 — send confirmation email
    // TODO: Phase 3 — send welcome SMS
    // TODO: Phase 3 — send admin notification

    const response = jsonResponse(200, { ok: true, message: 'Request received successfully' });
    return wrapCallback(callback, response);
  } catch (error) {
    console.error('Lead handler error:', error);
    return jsonResponse(500, { ok: false, error: 'Server error: ' + error.message });
  }
};

/**
 * Wrap response in JSONP callback if provided
 */
function wrapCallback(callback, response) {
  if (!callback) return response;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/javascript' },
    body: `${callback}(${response.body});`
  };
}

/**
 * Process lead data based on action type
 */
function processLead(payload, action) {
  const timestamp = formatDate(new Date());
  const base = {
    timestamp,
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(),
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(),
    converted: 'No',
    converted_at: '',
    application_id: '',
    status: 'New',
    notes: ''
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
    const data = await getSheetData('Applications (RAW)');
    if (!data || data.length < 2) return null;
    const headers = data[0];
    const emailCol = headers.indexOf('email');
    const appIdCol = headers.indexOf('application_id');
    if (emailCol === -1) return null;

    for (let i = 1; i < data.length; i++) {
      if (data[i][emailCol] === email.toLowerCase()) {
        return data[i][appIdCol] || 'Unknown';
      }
    }
    return null;
  } catch (err) {
    console.error('getExistingApplicationId error:', err.message);
    return null;
  }
}
