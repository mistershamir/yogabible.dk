// =========================================================================
// 02_Utils.gs — Helper Functions & Schemas
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// BASIC UTILITIES
// =========================================================================

function formatDate(date) { 
  return Utilities.formatDate(date, CONFIG.TIMEZONE, CONFIG.DATE_FORMAT); 
}

function escapeHtml(text) { 
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); 
}

function normalizeYesNo(value) { 
  var v = String(value || '').toLowerCase().trim(); 
  if (v === 'ja' || v === 'yes' || v === 'true') return 'Yes'; 
  if (v === 'nej' || v === 'no' || v === 'false') return 'No'; 
  return value || 'No'; 
}

function normalizeToEnglish(text) { 
  var str = String(text || '').trim(); 
  if (!str) return str; 
  for (var key in CONFIG.TRANSLATIONS) { 
    if (str.toLowerCase() === key.toLowerCase()) return CONFIG.TRANSLATIONS[key]; 
  } 
  return str; 
}

function jsonResponse(obj) { 
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); 
}

function logError(context, error) { 
  Logger.log('ERROR in ' + context + ': ' + (error.message || error)); 
}

function generateApplicationId() { 
  var now = new Date(); 
  var dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyMMdd'); 
  var random = Math.floor(Math.random() * 9000) + 1000; 
  return 'YB-' + dateStr + '-' + random; 
}

function looksLikeDriveId(id) { 
  return (typeof id === 'string') && /^[A-Za-z0-9_-]{20,}$/.test(id); 
}

// =========================================================================
// SCHEDULE FILE HELPER
// =========================================================================

function getScheduleFileId(programType, programString) {
  var mapping = SCHEDULE_MAPPING[programType];
  if (!mapping) return null;
  var programLower = String(programString || '').toLowerCase();
  for (var month in mapping) {
    if (month !== 'default' && programLower.indexOf(month) !== -1) return mapping[month];
  }
  return mapping['default'] || null;
}

// =========================================================================
// DRIVE FILE HELPER (FIXED — preserves original filename from Drive)
// =========================================================================

function fetchDriveFileAsBlob(fileId, filename) {
  try {
    if (!looksLikeDriveId(fileId)) return null;
    
    // Get original filename from Drive if not provided
    var originalName = filename;
    if (!originalName) {
      try {
        var file = DriveApp.getFileById(fileId);
        originalName = file.getName();
      } catch (e) {
        Logger.log('Could not get filename from Drive for ' + fileId + ': ' + e.message);
        originalName = 'schedule-' + fileId + '.pdf';
      }
    }
    
    var url = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fileId);
    var resp = UrlFetchApp.fetch(url, { followRedirects: true, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      Logger.log('Drive download failed for ' + fileId + ' — status: ' + resp.getResponseCode());
      return null;
    }
    var blob = resp.getBlob();
    if ((blob.getContentType() || '').toLowerCase().indexOf('text/html') !== -1) {
      Logger.log('Drive returned HTML instead of file for ' + fileId + ' — possibly sharing restricted');
      return null;
    }
    blob.setName(originalName);
    return blob;
  } catch (error) { 
    logError('fetchDriveFileAsBlob', error); 
    return null; 
  }
}

// =========================================================================
// SHEET HELPERS
// =========================================================================

function ensureSheet(ss, name, headers) { 
  var sheet = ss.getSheetByName(name); 
  if (!sheet) { sheet = ss.insertSheet(name); } 
  if (sheet.getLastRow() === 0 && headers && headers.length > 0) { sheet.appendRow(headers); } 
  return sheet; 
}

function getOrCreateHeaders(sheet, schema) { 
  if (sheet.getLastRow() === 0) { sheet.appendRow(schema); return schema; } 
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]; 
}

// =========================================================================
// YTT PROGRAM TYPE DETECTION
// =========================================================================

function detectYTTProgramType(programString, courseId, cohortLabel) {
  var allStrings = [String(programString || ''), String(courseId || ''), String(cohortLabel || '')].join(' ').toLowerCase();
  if (!allStrings.trim()) return 'other';
  for (var typeKey in YTT_PROGRAM_TYPES) {
    var typeConfig = YTT_PROGRAM_TYPES[typeKey];
    for (var i = 0; i < typeConfig.keywords.length; i++) {
      if (allStrings.indexOf(typeConfig.keywords[i].toLowerCase()) !== -1) return typeKey;
    }
  }
  return 'other';
}

// =========================================================================
// ROW COLOR HELPER
// =========================================================================

function applyRowColor(sheet, rowNum, type) { 
  try { 
    var color = ROW_COLORS[String(type).toLowerCase()] || ROW_COLORS['default']; 
    sheet.getRange(rowNum, 1, 1, sheet.getLastColumn() || 22).setBackground(color); 
  } catch (e) { 
    Logger.log('applyRowColor error: ' + e.message); 
  } 
}

// =========================================================================
// PAYMENT URL HELPERS
// =========================================================================

function getCoursePaymentUrl(courseName, month) { 
  var courseUrls = COURSE_PAYMENT_URLS[courseName]; 
  if (!courseUrls) return ''; 
  return courseUrls[month] || courseUrls['default'] || ''; 
}

function getBundlePaymentUrl(courseList, month) { 
  var monthUrls = BUNDLE_PAYMENT_URLS[month]; 
  if (!monthUrls) return ''; 
  if (courseList.length === 3) return monthUrls['ALL'] || ''; 
  if (courseList.length === 2) { 
    var key = courseList.slice().sort().join('|'); 
    return monthUrls[key] || ''; 
  } 
  return ''; 
}

function getYTTPaymentUrl(programType, cohort) { 
  var urls = YTT_PAYMENT[programType]; 
  if (!urls) return ''; 
  return urls[cohort] || urls['default'] || ''; 
}

// =========================================================================
// UNSUBSCRIBE TOKEN HELPERS
// =========================================================================

function generateUnsubscribeToken(email) {
  var normalizedEmail = String(email || '').toLowerCase().trim();
  var signature = Utilities.computeHmacSha256Signature(normalizedEmail, CONFIG.UNSUBSCRIBE_SECRET);
  return signature.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function verifyUnsubscribeToken(email, token) {
  return generateUnsubscribeToken(email) === token;
}

function buildUnsubscribeUrl(email) {
  var token = generateUnsubscribeToken(email);
  var baseUrl = ScriptApp.getService().getUrl();
  return baseUrl + '?mode=unsubscribe&email=' + encodeURIComponent(email) + '&token=' + token;
}

// =========================================================================
// SCHEMAS
// =========================================================================

function getCatalogSchema() { 
  return ['course_id', 'course_name', 'category', 'subcategory', 'track', 'cohort_id', 'cohort_label', 
    'start_date', 'end_date', 'capacity', 'waitlist_enabled', 'active', 'external_only', 
    'external_url', 'payment_url_full', 'payment_url_deposit', 'price_full', 'currency', 
    'deposit_amount', 'allow_deposit', 'allow_spots', 'allow_installment', 'max_installment_months', 
    'hours', 'description', 'notes', 'sort_key', 'open_status']; 
}

function getApplicationsSchema() { 
  return ['timestamp', 'type', 'ytt_program_type', 'application_id', 'email', 'first_name', 'last_name', 'phone', 
    'hear_about', 'hear_about_other', 'course_id', 'course_name', 'cohort_id', 'cohort_label', 
    'track', 'payment_choice', 'bundle_type', 'bundle_payment_url', 'mentorship_selected', 'source', 'status', 'notes']; 
}

function getLeadsSchema() { 
  return ['timestamp', 'email', 'first_name', 'last_name', 'phone', 'type', 'ytt_program_type', 'program', 
    'course_id', 'cohort_label', 'preferred_month', 'accommodation', 'city_country', 
    'housing_months', 'service', 'subcategories', 'message', 'converted', 'converted_at', 
    'application_id', 'source', 'status', 'notes']; 
}