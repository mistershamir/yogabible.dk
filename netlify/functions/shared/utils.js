/**
 * Shared Utilities — Yoga Bible
 * Netlify Functions helpers
 */

const crypto = require('crypto');
const { CONFIG, YTT_PROGRAM_TYPES } = require('./config');

// =========================================================================
// CORS & Response Helpers
// =========================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: JSON.stringify(body)
  };
}

function htmlResponse(statusCode, html) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
    body: html
  };
}

function optionsResponse() {
  return { statusCode: 204, headers: corsHeaders, body: '' };
}

// =========================================================================
// Basic Utilities
// =========================================================================

function formatDate(date) {
  return new Date(date).toLocaleString('sv-SE', { timeZone: CONFIG.TIMEZONE }).replace('T', ' ');
}

function escapeHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeYesNo(value) {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'ja' || v === 'yes' || v === 'true') return 'Yes';
  if (v === 'nej' || v === 'no' || v === 'false') return 'No';
  return value || 'No';
}

function normalizeToEnglish(text) {
  const str = String(text || '').trim();
  if (!str) return str;
  for (const key in CONFIG.TRANSLATIONS) {
    if (str.toLowerCase() === key.toLowerCase()) return CONFIG.TRANSLATIONS[key];
  }
  return str;
}

function generateApplicationId() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `YB-${y}${m}${d}-${random}`;
}

// =========================================================================
// YTT Program Type Detection
// =========================================================================

function detectYTTProgramType(programString, courseId, cohortLabel) {
  const allStrings = [String(programString || ''), String(courseId || ''), String(cohortLabel || '')].join(' ').toLowerCase();
  if (!allStrings.trim()) return 'other';
  for (const typeKey in YTT_PROGRAM_TYPES) {
    const typeConfig = YTT_PROGRAM_TYPES[typeKey];
    for (const keyword of typeConfig.keywords) {
      if (allStrings.includes(keyword.toLowerCase())) return typeKey;
    }
  }
  return 'other';
}

// =========================================================================
// Payment URL Helpers
// =========================================================================

function getCoursePaymentUrl(courseName, month) {
  const { COURSE_PAYMENT_URLS } = require('./config');
  const courseUrls = COURSE_PAYMENT_URLS[courseName];
  if (!courseUrls) return '';
  return courseUrls[month] || courseUrls['default'] || '';
}

function getBundlePaymentUrl(courseList, month) {
  const { BUNDLE_PAYMENT_URLS } = require('./config');
  const monthUrls = BUNDLE_PAYMENT_URLS[month];
  if (!monthUrls) return '';
  if (courseList.length === 3) return monthUrls['ALL'] || '';
  if (courseList.length === 2) {
    const key = courseList.slice().sort().join('|');
    return monthUrls[key] || '';
  }
  return '';
}

function getYTTPaymentUrl(programType, cohort) {
  const { YTT_PAYMENT } = require('./config');
  const urls = YTT_PAYMENT[programType];
  if (!urls) return '';
  return urls[cohort] || urls['default'] || '';
}

// =========================================================================
// Unsubscribe Token Helpers
// =========================================================================

function generateUnsubscribeToken(email) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const hmac = crypto.createHmac('sha256', CONFIG.UNSUBSCRIBE_SECRET);
  hmac.update(normalizedEmail);
  return hmac.digest('hex');
}

function verifyUnsubscribeToken(email, token) {
  return generateUnsubscribeToken(email) === token;
}

function buildUnsubscribeUrl(email, lang) {
  const token = generateUnsubscribeToken(email);
  const baseUrl = CONFIG.SITE_URL;
  var l = (lang || 'da').toLowerCase().substring(0, 2);
  var langParam = (['da', 'dk'].includes(l)) ? '' : '&lang=' + encodeURIComponent(l);
  return `${baseUrl}/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}&token=${token}${langParam}`;
}

// =========================================================================
// Action Detection (from payload)
// =========================================================================

function detectAction(payload) {
  if (payload.action) return payload.action.toLowerCase();
  if (payload.mode === 'careers') return 'careers';
  // Meta Lead Forms via Zapier — detected by full_name or platform field
  if (payload.full_name || payload.platform === 'meta' || payload.platform === 'facebook' || payload.platform === 'instagram') return 'lead_meta';
  if (payload.applicant && payload.selections) return 'apply_builder';
  if (payload.form === 'yb4w') return 'lead_schedule_4w';
  if (payload.form === 'yb8w') return 'lead_schedule_8w';
  if (payload.form === 'yb300h') return 'lead_schedule_300h';
  if (payload.form === 'yb50h') return 'lead_schedule_50h';
  if (payload.form === 'yb30h') return 'lead_schedule_30h';

  if (payload.program) {
    const prog = String(payload.program).toLowerCase();
    if (prog.includes('300')) return 'lead_schedule_300h';
    if (prog.includes('50 hour') || prog.includes('50h')) return 'lead_schedule_50h';
    if (prog.includes('30 hour') || prog.includes('30h')) return 'lead_schedule_30h';
    if (prog.includes('18 uger') || prog.includes('18-week') || prog.includes('fleksib')) return 'lead_schedule_18w';
    if (prog.includes('8 uger') || prog.includes('8-week') || prog.includes('8 week') ||
        prog.includes('8 ukers') || prog.includes('8 veckors') || prog.includes('8-wöchig') ||
        prog.includes('8 viikon') || prog.includes('8 weken') || prog.includes('semi-intensiv')) return 'lead_schedule_8w';
    return 'lead_schedule_4w';
  }

  if (payload.housing !== undefined && !payload.form) return 'lead_schedule_18w';
  if (payload.service) return 'lead_mentorship';
  if (payload.courses) return 'lead_courses';
  if (payload.application_id && !payload.to_course_id) return 'status';
  if (payload.to_course_id || payload.to_cohort_id) return 'change_request';
  if (payload.firstName || payload.email) return 'lead_schedule_4w';

  return null;
}

// =========================================================================
// Schemas
// =========================================================================

const LEADS_SCHEMA = [
  'timestamp', 'email', 'first_name', 'last_name', 'phone', 'type', 'ytt_program_type', 'program',
  'course_id', 'cohort_label', 'preferred_month', 'accommodation', 'city_country',
  'housing_months', 'service', 'subcategories', 'message', 'converted', 'converted_at',
  'application_id', 'source', 'status', 'notes'
];

const APPLICATIONS_SCHEMA = [
  'timestamp', 'type', 'ytt_program_type', 'application_id', 'email', 'first_name', 'last_name', 'phone',
  'hear_about', 'hear_about_other', 'course_id', 'course_name', 'cohort_id', 'cohort_label',
  'track', 'payment_choice', 'bundle_type', 'bundle_payment_url', 'mentorship_selected', 'source', 'status', 'notes'
];

module.exports = {
  corsHeaders,
  jsonResponse,
  htmlResponse,
  optionsResponse,
  formatDate,
  escapeHtml,
  normalizeYesNo,
  normalizeToEnglish,
  generateApplicationId,
  detectYTTProgramType,
  getCoursePaymentUrl,
  getBundlePaymentUrl,
  getYTTPaymentUrl,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  detectAction,
  LEADS_SCHEMA,
  APPLICATIONS_SCHEMA
};
