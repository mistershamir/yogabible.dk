/**
 * Careers Form Endpoint — Yoga Bible
 * Public endpoint for career/collaboration form submissions.
 *
 * POST /.netlify/functions/careers
 * Body: { payload: JSON string with fields + files }
 *   OR: JSON body with fields directly
 *
 * The careers form submits a JSON-encoded payload field containing:
 *   fields: { firstName, lastName, email, phone, category, subcategory, role, ... }
 *   files: [{ kind, filename, mimeType, base64 }]
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { sendAdminNotification } = require('./shared/email-service');
const { sendCareersConfirmation } = require('./shared/lead-emails');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    let fields = {};
    let files = [];
    const contentType = (event.headers['content-type'] || '').toLowerCase();

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      // iframe form submission — payload is in a hidden field
      const params = new URLSearchParams(event.body || '');
      const payloadStr = params.get('payload');
      if (payloadStr) {
        try {
          const parsed = JSON.parse(payloadStr);
          fields = parsed.fields || {};
          files = parsed.files || [];
        } catch (e) {
          // fallback: treat all params as fields
          for (const [key, value] of params) {
            fields[key] = value;
          }
        }
      } else {
        for (const [key, value] of params) {
          fields[key] = value;
        }
      }
    } else {
      // Direct JSON submission
      const body = JSON.parse(event.body || '{}');
      if (body.fields) {
        fields = body.fields;
        files = body.files || [];
      } else if (body.payload) {
        const parsed = JSON.parse(body.payload);
        fields = parsed.fields || {};
        files = parsed.files || [];
      } else {
        fields = body;
      }
    }

    const email = (fields.email || '').toLowerCase().trim();
    if (!email) {
      return jsonResponse(400, { ok: false, error: 'Email is required' });
    }

    // Build lead document with career-specific fields
    const firstName = (fields.firstName || '').trim();
    const lastName = (fields.lastName || '').trim();
    const phone = (fields.phone || '').trim();
    const category = fields.category || '';
    const subcategory = fields.subcategory || '';
    const role = fields.role || '';
    const experience = fields.experience || '';
    const message = fields.message || fields.otherTopic || '';

    // File metadata (base64 stored only if < 500KB to stay within Firestore 1MB doc limit)
    const fileData = files.length > 0 ? files.map(f => ({
      kind: f.kind || 'extra',
      filename: f.filename || 'unnamed',
      mimeType: f.mimeType || 'application/octet-stream',
      base64: (f.base64 && f.base64.length < 500000) ? f.base64 : null,
      size_bytes: f.base64 ? Math.round(f.base64.length * 0.75) : 0
    })) : [];

    // All career data stored directly in the leads collection
    const leadDoc = {
      email,
      first_name: firstName,
      last_name: lastName,
      phone,
      type: 'careers',
      // Career-specific fields
      category,
      subcategory,
      role,
      experience,
      background: fields.background || '',
      languages: fields.languages || '',
      city_country: fields.cityCountry || '',
      links: fields.links || '',
      file_count: files.length,
      file_names: files.map(f => f.filename || 'unnamed').join(', '),
      files: fileData,
      // Standard lead fields
      ytt_program_type: '',
      program: '',
      course_id: '',
      cohort_label: '',
      preferred_month: '',
      accommodation: 'No',
      housing_months: '',
      service: category || 'Careers',
      subcategories: subcategory || '',
      message,
      page_url: fields.pageUrl || '',
      source: 'Careers page',
      status: 'New',
      notes: [],
      converted: false,
      converted_at: null,
      application_id: null,
      unsubscribed: false,
      call_attempts: 0,
      sms_status: '',
      last_contact: null,
      followup_date: null,
      created_at: new Date(),
      updated_at: new Date()
    };

    const db = getDb();
    const docRef = await db.collection('leads').add(leadDoc);

    console.log(`[careers] New career submission: ${docRef.id} (${email})`);

    // Send notifications — must await before returning (Netlify kills Lambda after response)
    if (process.env.GMAIL_APP_PASSWORD) {
      await Promise.all([
        sendAdminNotification({
          ...leadDoc,
          notes: `NEW CAREER APPLICATION\nCategory: ${category}\nRole: ${role}\nFiles: ${files.length}`
        }).catch(err => {
          console.error('[careers] Admin notification failed:', err.message);
        }),
        sendCareersConfirmation(email, firstName, category, role).catch(err => {
          console.error('[careers] Careers confirmation email failed:', err.message);
        })
      ]);
    }

    // Return success — for iframe submissions, wrap in HTML with postMessage
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      // iframe submission — send postMessage back
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: `<!DOCTYPE html><html><body><script>
          window.parent.postMessage({ source: "yb-careers-webapp", ok: true }, "*");
        </script></body></html>`
      };
    }

    return jsonResponse(200, { ok: true, message: 'Career application received' });
  } catch (error) {
    console.error('[careers] Error:', error);

    // For iframe submissions, send error via postMessage
    const contentType = (event.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: `<!DOCTYPE html><html><body><script>
          window.parent.postMessage({ source: "yb-careers-webapp", ok: false, error: "${error.message.replace(/"/g, '\\"')}" }, "*");
        </script></body></html>`
      };
    }

    return jsonResponse(500, { ok: false, error: 'Server error: ' + error.message });
  }
};
