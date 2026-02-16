// =========================================================================
// 03_Handlers.gs — Main Request Handlers
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// doGet - Handle GET requests
// =========================================================================

function doGet(e) {
  try {
    var params = e.parameter || {};
    var callback = params.callback || '';
    var action = (params.action || '').toLowerCase();
    var mode = (params.mode || '').toLowerCase();
    
    Logger.log('=== doGet called === Params: ' + JSON.stringify(params));
    
    // Serve Lead Manager Web App
    if (mode === 'app' || action === 'app') {
      return HtmlService.createHtmlOutputFromFile('LeadManager')
        .setTitle('Yoga Bible - Lead Manager')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
    
    // Serve simple test page
    if (mode === 'test' || action === 'test') {
      return HtmlService.createHtmlOutputFromFile('LeadManagerTest')
        .setTitle('Lead Manager - Test')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // Unsubscribe flow
    if (mode === 'unsubscribe') {
      return handleUnsubscribe(params);
    }

    var response;
    if (action === 'catalog') { 
      response = handleCatalogRequest(); 
    }
    else if (action === 'ping' || action === 'health') { 
      response = jsonResponse({ ok: true, status: 'healthy', timestamp: new Date().toISOString() }); 
    }
    else if (action.indexOf('lead_') === 0) {
      response = handleLead(params, action);
    }
    else {
      var isFormSubmission = callback && (params.email || params.firstName);
      if (isFormSubmission) { 
        response = handleGetFormSubmission(params); 
      }
      else { 
        response = jsonResponse({ ok: false, error: 'Unknown action' }); 
      }
    }
    
    if (callback) { 
      return ContentService.createTextOutput(callback + '(' + response.getContent() + ');').setMimeType(ContentService.MimeType.JAVASCRIPT); 
    }
    return response;
  } catch (error) {
    Logger.log('ERROR in doGet: ' + error.message);
    var cb = '';
    try { cb = (e && e.parameter) ? (e.parameter.callback || '') : ''; } catch(x) {}
    var errorResponse = JSON.stringify({ ok: false, error: 'Server error: ' + error.message });
    if (cb) { 
      return ContentService.createTextOutput(cb + '(' + errorResponse + ');').setMimeType(ContentService.MimeType.JAVASCRIPT); 
    }
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}

// =========================================================================
// doPost - Handle POST requests
// =========================================================================

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    Logger.log('=== doPost called ===');
    
    var payload = parsePayload(e);
    if (!payload) return jsonResponse({ ok: false, error: 'Invalid payload format' });
    
    var action = detectAction(payload);
    if (!action) return jsonResponse({ ok: false, error: 'Could not determine action' });
    
    switch (action) {
      case 'apply_builder': 
        return handleMasterApply(payload);
      case 'lead_schedule_18w': 
      case 'lead_schedule_4w': 
      case 'lead_schedule_8w':
      case 'lead_schedule_300h': 
      case 'lead_schedule_50h': 
      case 'lead_schedule_30h':
      case 'lead_courses': 
      case 'lead_mentorship': 
        return handleLead(payload, action);
      case 'status': 
        return handleStatusLookup(payload);
      case 'change_request': 
        return handleChangeRequest(payload);
      default: 
        return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (error) { 
    logError('doPost', error); 
    return jsonResponse({ ok: false, error: 'Server error: ' + error.message }); 
  }
  finally { 
    lock.releaseLock(); 
  }
}

// =========================================================================
// Handle GET Form Submission (JSONP)
// =========================================================================

function handleGetFormSubmission(params) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var action = detectAction(params);
    if (!action) return jsonResponse({ ok: false, error: 'Could not determine form type' });
    if (action.indexOf('lead_schedule_') === 0) return handleLead(params, action);
    return jsonResponse({ ok: false, error: 'Unknown form type: ' + action });
  } catch (error) { 
    logError('handleGetFormSubmission', error); 
    return jsonResponse({ ok: false, error: 'Server error: ' + error.message }); 
  }
  finally { 
    lock.releaseLock(); 
  }
}

// =========================================================================
// Parse Payload from Request
// =========================================================================

function parsePayload(e) {
  try {
    if (e.postData && e.postData.contents) { 
      try { 
        return JSON.parse(e.postData.contents); 
      } catch (jsonError) {} 
    }
    if (e.parameter && Object.keys(e.parameter).length > 0) {
      var params = {};
      for (var key in e.parameter) { 
        if (key !== 'callback' && key !== 'mode' && key !== '_') 
          params[key] = e.parameter[key]; 
      }
      if (e.parameters) {
        if (e.parameters.subcategories && e.parameters.subcategories.length > 1) 
          params.subcategories = e.parameters.subcategories.join(', ');
        if (e.parameters.months && e.parameters.months.length > 1) 
          params.months = e.parameters.months.join(', ');
        if (e.parameters.courses && e.parameters.courses.length > 1) 
          params.courses = e.parameters.courses.join(', ');
      }
      return params;
    }
    return null;
  } catch (error) { 
    logError('parsePayload', error); 
    return null; 
  }
}

// =========================================================================
// Detect Action from Payload
// =========================================================================

function detectAction(payload) {
  if (payload.action) return payload.action.toLowerCase();
  if (payload.applicant && payload.selections) return 'apply_builder';
  if (payload.form === 'yb4w') return 'lead_schedule_4w';
  if (payload.form === 'yb8w') return 'lead_schedule_8w';
  if (payload.form === 'yb300h') return 'lead_schedule_300h';
  if (payload.form === 'yb50h') return 'lead_schedule_50h';
  if (payload.form === 'yb30h') return 'lead_schedule_30h';
  
  if (payload.program) {
    var prog = String(payload.program).toLowerCase();
    if (prog.indexOf('300') !== -1) return 'lead_schedule_300h';
    if (prog.indexOf('50 hour') !== -1 || prog.indexOf('50h') !== -1) return 'lead_schedule_50h';
    if (prog.indexOf('30 hour') !== -1 || prog.indexOf('30h') !== -1) return 'lead_schedule_30h';
    if (prog.indexOf('18 uger') !== -1 || prog.indexOf('18-week') !== -1 || prog.indexOf('fleksib') !== -1) return 'lead_schedule_18w';
    if (prog.indexOf('8 uger') !== -1 || prog.indexOf('8-week') !== -1 || prog.indexOf('8 ukers') !== -1 || 
        prog.indexOf('8 veckors') !== -1 || prog.indexOf('8-wöchig') !== -1 || prog.indexOf('8 viikon') !== -1 || 
        prog.indexOf('8 weken') !== -1 || prog.indexOf('semi-intensiv') !== -1) return 'lead_schedule_8w';
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
// Status Lookup Handler
// =========================================================================

function handleStatusLookup(payload) {
  try {
    var email = (payload.email || '').toLowerCase().trim();
    var applicationId = (payload.application_id || '').trim();
    if (!email || !applicationId) return jsonResponse({ ok: false, message: 'Email and application ID required' });
    
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var appsRaw = ss.getSheetByName('Applications (RAW)');
    if (!appsRaw) return jsonResponse({ ok: false, message: 'System error' });
    
    var data = appsRaw.getDataRange().getValues();
    var headers = data[0];
    var emailCol = headers.indexOf('email');
    var idCol = headers.indexOf('application_id');
    var statusCol = headers.indexOf('status');
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][emailCol] === email && data[i][idCol] === applicationId) {
        var status = data[i][statusCol] || 'Pending';
        return jsonResponse({ ok: true, message: 'Application status: ' + status, status: status });
      }
    }
    return jsonResponse({ ok: false, message: 'No application found with these details' });
  } catch (error) { 
    logError('handleStatusLookup', error); 
    return jsonResponse({ ok: false, message: 'System error' }); 
  }
}

// =========================================================================
// Change Request Handler
// =========================================================================

function handleChangeRequest(payload) {
  try {
    var email = (payload.email || '').toLowerCase().trim();
    var applicationId = (payload.application_id || '').trim();
    var toCohortId = payload.to_cohort_id || '';
    var toCohortLabel = payload.to_cohort_label || '';
    if (!email || !applicationId || !toCohortId) return jsonResponse({ ok: false, message: 'Required fields missing' });
    
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var changesSheet = ss.getSheetByName('Change Requests');
    if (!changesSheet) return jsonResponse({ ok: false, message: 'System error' });
    
    changesSheet.appendRow([
      formatDate(new Date()), email, applicationId, 
      payload.to_course_id || '', toCohortId, toCohortLabel, 
      'Pending', ''
    ]);
    return jsonResponse({ ok: true, message: 'Change request received' });
  } catch (error) { 
    logError('handleChangeRequest', error); 
    return jsonResponse({ ok: false, message: 'System error' }); 
  }
}

// =========================================================================
// Catalog Request Handler
// =========================================================================

function handleCatalogRequest() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Course Catalog');
    if (!sheet) return jsonResponse({ ok: false, error: 'Course Catalog sheet not found' });
    
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ ok: true, catalog: [] });
    
    var headers = data[0];
    var catalog = [];
    
    for (var i = 1; i < data.length; i++) {
      var row = {};
      for (var j = 0; j < headers.length; j++) row[headers[j]] = data[i][j];
      if (String(row.active || '').toLowerCase() !== 'true') continue;
      row.category = normalizeToEnglish(row.category);
      row.open_status = normalizeToEnglish(row.open_status);
      catalog.push(row);
    }
    return jsonResponse({ ok: true, catalog: catalog });
  } catch (error) {
    logError('handleCatalogRequest', error);
    return jsonResponse({ ok: false, error: 'Failed to load catalog' });
  }
}

// =========================================================================
// Unsubscribe Handler (two-step: confirm page -> process)
// =========================================================================

function handleUnsubscribe(params) {
  var email = String(params.email || '').toLowerCase().trim();
  var token = params.token || '';
  var confirmed = params.confirmed || '';

  if (!email || !token) {
    return HtmlService.createHtmlOutput(buildUnsubscribePageHtml('error', 'Ugyldigt link.'))
      .setTitle('Yoga Bible - Afmelding')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (!verifyUnsubscribeToken(email, token)) {
    return HtmlService.createHtmlOutput(buildUnsubscribePageHtml('error', 'Ugyldigt eller udl\u00f8bet link.'))
      .setTitle('Yoga Bible - Afmelding')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (confirmed !== 'yes') {
    return HtmlService.createHtmlOutput(buildUnsubscribePageHtml('confirm', email, token))
      .setTitle('Yoga Bible - Bekr\u00e6ft afmelding')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var result = processUnsubscribe(email);
  if (result.success) {
    return HtmlService.createHtmlOutput(buildUnsubscribePageHtml('success', email))
      .setTitle('Yoga Bible - Afmeldt')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutput(buildUnsubscribePageHtml('error', 'Der opstod en fejl. Pr\u00f8v igen senere.'))
    .setTitle('Yoga Bible - Fejl')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
