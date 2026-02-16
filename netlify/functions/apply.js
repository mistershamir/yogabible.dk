/**
 * Apply (Application Builder) — Yoga Bible
 * Public endpoint for application form submissions.
 *
 * POST /.netlify/functions/apply
 * Body: { action: "apply_builder", applicant: {...}, selections: {...} }
 *
 * Returns: { ok: true, application_id: "YB-260216-1234" }
 */

const { getDb } = require('./shared/firestore');
const {
  jsonResponse, optionsResponse, generateApplicationId,
  detectYTTProgramType
} = require('./shared/utils');
const { sendAdminNotification } = require('./shared/email-service');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    let payload;
    const contentType = (event.headers['content-type'] || '').toLowerCase();

    // Support text/plain;charset=utf-8 which the apply form sends
    if (contentType.includes('text/plain') || contentType.includes('application/json')) {
      payload = JSON.parse(event.body || '{}');
    } else {
      payload = JSON.parse(event.body || '{}');
    }

    if (!payload.applicant || !payload.applicant.email) {
      return jsonResponse(400, { ok: false, error: 'Applicant email is required' });
    }

    const applicant = payload.applicant;
    const selections = payload.selections || {};
    const applicationId = generateApplicationId();

    // Determine type
    let type = 'unknown';
    let yttProgramType = '';
    if (selections.ytt) {
      type = 'education';
      yttProgramType = detectYTTProgramType(
        selections.ytt.course_name,
        selections.ytt.course_id,
        selections.ytt.cohort_label
      );
    } else if (selections.course) {
      type = selections.course.bundle_type ? 'bundle' : 'course';
    }
    if (applicant.mentorship_selected) {
      type = type === 'unknown' ? 'mentorship' : type;
    }

    // Build application document
    const appDoc = {
      application_id: applicationId,
      email: (applicant.email || '').toLowerCase().trim(),
      first_name: (applicant.first_name || '').trim(),
      last_name: (applicant.last_name || '').trim(),
      phone: (applicant.phone || '').trim(),
      type,
      ytt_program_type: yttProgramType,
      hear_about: applicant.hear_about || '',
      hear_about_other: applicant.hear_about_other || '',
      source: payload.source || 'Apply page',
      status: 'New',
      notes: [],
      mentorship_selected: !!applicant.mentorship_selected,
      created_at: new Date(),
      updated_at: new Date()
    };

    // YTT-specific fields
    if (selections.ytt) {
      appDoc.course_id = selections.ytt.course_id || '';
      appDoc.course_name = selections.ytt.course_name || '';
      appDoc.cohort_id = selections.ytt.cohort_id || '';
      appDoc.cohort_label = selections.ytt.cohort_label || '';
      appDoc.track = selections.ytt.track || '';
      appDoc.payment_choice = selections.ytt.payment_choice || '';
    }

    // Course-specific fields
    if (selections.course) {
      appDoc.course_id = appDoc.course_id || selections.course.course_id || '';
      appDoc.course_name = appDoc.course_name || selections.course.course_name || '';
      appDoc.cohort_id = appDoc.cohort_id || selections.course.cohort_id || '';
      appDoc.cohort_label = appDoc.cohort_label || selections.course.cohort_label || '';
      appDoc.bundle_type = selections.course.bundle_type || '';
      appDoc.bundle_payment_url = selections.course.bundle_payment_url || '';
      if (!appDoc.payment_choice) {
        appDoc.payment_choice = selections.course.payment_choice || '';
      }
    }

    // Accommodation
    if (selections.accommodation) {
      appDoc.accommodation_need = selections.accommodation.need || 'no';
      appDoc.accommodation_months = selections.accommodation.months || [];
      appDoc.accommodation_payment = selections.accommodation.payment_choice || '';
    }

    // Write to Firestore
    const db = getDb();
    await db.collection('applications').add(appDoc);

    console.log(`[apply] New application: ${applicationId} (${appDoc.email})`);

    // Also create a lead entry for tracking
    const leadDoc = {
      email: appDoc.email,
      first_name: appDoc.first_name,
      last_name: appDoc.last_name,
      phone: appDoc.phone,
      type: appDoc.type,
      ytt_program_type: appDoc.ytt_program_type,
      program: appDoc.course_name || '',
      course_id: appDoc.course_id || '',
      cohort_label: appDoc.cohort_label || '',
      preferred_month: '',
      accommodation: appDoc.accommodation_need === 'yes' ? 'Yes' : 'No',
      city_country: '',
      housing_months: (appDoc.accommodation_months || []).join(', '),
      service: applicant.mentorship_selected ? 'Mentorship' : '',
      subcategories: '',
      message: '',
      source: payload.source || 'Apply page',
      status: 'New',
      notes: `Application submitted (ID: ${applicationId})`,
      converted: true,
      converted_at: new Date(),
      application_id: applicationId,
      unsubscribed: false,
      call_attempts: 0,
      sms_status: '',
      last_contact: null,
      followup_date: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    await db.collection('leads').add(leadDoc);

    // Fire-and-forget admin notification
    if (process.env.GMAIL_APP_PASSWORD) {
      sendAdminNotification({
        ...leadDoc,
        notes: `NEW APPLICATION: ${applicationId}\nType: ${type}\nProgram: ${appDoc.course_name || 'N/A'}\nCohort: ${appDoc.cohort_label || 'N/A'}`
      }).catch(err => {
        console.error('[apply] Admin notification failed:', err.message);
      });
    }

    return jsonResponse(200, {
      ok: true,
      application_id: applicationId,
      message: 'Application received successfully'
    });
  } catch (error) {
    console.error('[apply] Error:', error);
    return jsonResponse(500, { ok: false, error: 'Server error: ' + error.message });
  }
};
