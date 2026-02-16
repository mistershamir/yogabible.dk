// =========================================================================
// 04_Leads.gs — Lead Processing
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// Main Lead Handler
// =========================================================================

function handleLead(payload, action) {
  try {
    // =====================================================================
    // MULTI-FORMAT CHECK — Route to dedicated handler if multiple formats
    // =====================================================================
    if (payload.multiFormat === 'Yes' && payload.allFormats) {
      return handleMultiFormatLead(payload, action);
    }
    // =====================================================================
    
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var leadsRaw = ss.getSheetByName('Leads (RAW)');
    if (!leadsRaw) return jsonResponse({ ok: false, error: 'Leads (RAW) sheet not found' });
    
    var leadData;
    switch (action) {
      case 'lead_schedule_18w': leadData = processLead18w(payload); break;
      case 'lead_schedule_4w': leadData = processLead4w(payload); break;
      case 'lead_schedule_8w': leadData = processLead8w(payload); break;
      case 'lead_schedule_300h': leadData = processLead300h(payload); break;
      case 'lead_schedule_50h': leadData = processLead50h(payload); break;
      case 'lead_schedule_30h': leadData = processLead30h(payload); break;
      case 'lead_courses': leadData = processLeadCourses(payload); break;
      case 'lead_mentorship': leadData = processLeadMentorship(payload); break;
      default: return jsonResponse({ ok: false, error: 'Unknown lead type' });
    }
    
    // Check for existing applicant
    var existingAppId = getExistingApplicationId(leadData.email);
    if (existingAppId) { 
      leadData.notes = 'EXISTING APPLICANT (App ID: ' + existingAppId + ')'; 
      leadData.status = 'Existing Applicant'; 
    }
    
    // Save to sheet
    var headers = getOrCreateHeaders(leadsRaw, getLeadsSchema());
    var rowArray = [];
    for (var i = 0; i < headers.length; i++) rowArray.push(leadData[headers[i]] || '');
    leadsRaw.appendRow(rowArray);
    var newRowIndex = leadsRaw.getLastRow();
    applyRowColor(leadsRaw, newRowIndex, leadData.type);
    
    // Send confirmation email
    try {
      switch (action) {
        case 'lead_schedule_4w': sendEmail4wYTT(leadData); break;
        case 'lead_schedule_8w': sendEmail8wYTT(leadData); break;
        case 'lead_schedule_18w': sendEmail18wYTT(leadData); break;
        case 'lead_schedule_300h': sendEmail300hYTT(leadData); break;
        case 'lead_schedule_50h': 
        case 'lead_schedule_30h': sendEmailSpecialtyYTT(leadData); break;
        case 'lead_courses': sendEmailCourses(leadData); break;
        case 'lead_mentorship': sendEmailMentorship(leadData); break;
        default: sendLeadConfirmationGeneric(leadData);
      }
    } catch (emailError) { 
      logError('Email sending', emailError); 
    }
    
    // Send welcome SMS (after email)
    try {
      if (typeof sendWelcomeSMS === 'function') {
        sendWelcomeSMS({
          first_name: leadData.first_name,
          phone: leadData.phone,
          program: leadData.program
        }, newRowIndex);
      }
    } catch (smsError) {
      logError('Welcome SMS', smsError);
    }
    
    // Send admin notification
    try { 
      sendAdminNotification(leadData, action); 
    } catch (notifyError) { 
      logError('Admin notification', notifyError); 
    }
    
    return jsonResponse({ ok: true, message: 'Request received successfully' });
  } catch (error) { 
    logError('handleLead', error); 
    return jsonResponse({ ok: false, error: 'Failed to process lead: ' + error.message }); 
  }
}

// =========================================================================
// Lead Processors - 18 Week
// =========================================================================

function processLead18w(payload) {
  var timestamp = new Date();
  var housingMonths = payload.housingMonths || '';
  if (Array.isArray(payload.months)) housingMonths = payload.months.join(', ');
  else if (payload.months) housingMonths = payload.months;
  
  return { 
    timestamp: formatDate(timestamp), 
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(), 
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(), 
    type: 'ytt', 
    ytt_program_type: '18-week',
    program: payload.program || '18 UGERS FLEKSIBELT PROGRAM - Marts-Juni 2026',
    course_id: '', 
    cohort_label: extractCohortLabel(payload.program), 
    preferred_month: '',
    accommodation: normalizeYesNo(payload.housing || payload.accommodation || 'No'),
    city_country: payload.origin || payload.cityCountry || '', 
    housing_months: housingMonths,
    service: '', 
    subcategories: '', 
    message: '', 
    source: payload.source || '200H YTT - 18-week landing page',
    converted: 'No', 
    converted_at: '', 
    application_id: '', 
    status: 'New', 
    notes: '' 
  };
}

// =========================================================================
// Lead Processors - 4 Week
// =========================================================================

function processLead4w(payload) {
  var timestamp = new Date();
  return { 
    timestamp: formatDate(timestamp), 
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(), 
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(), 
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
    source: payload.source || '200H YTT - 4-week landing page', 
    converted: 'No', 
    converted_at: '',
    application_id: '', 
    status: 'New', 
    notes: '' 
  };
}

// =========================================================================
// Lead Processors - 8 Week
// =========================================================================

function processLead8w(payload) {
  var timestamp = new Date();
  return { 
    timestamp: formatDate(timestamp), 
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(), 
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(), 
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
    source: payload.source || '200H YTT - 8-week landing page', 
    converted: 'No', 
    converted_at: '',
    application_id: '', 
    status: 'New', 
    notes: '' 
  };
}

// =========================================================================
// Lead Processors - 300h
// =========================================================================

function processLead300h(payload) {
  var timestamp = new Date();
  return { 
    timestamp: formatDate(timestamp), 
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(), 
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(), 
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
    source: payload.source || '300H Advanced YTT landing page', 
    converted: 'No', 
    converted_at: '',
    application_id: '', 
    status: 'New', 
    notes: '' 
  };
}

// =========================================================================
// Lead Processors - 50h
// =========================================================================

function processLead50h(payload) {
  var timestamp = new Date();
  return { 
    timestamp: formatDate(timestamp), 
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(), 
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(), 
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
    source: payload.source || '50H Specialty landing page', 
    converted: 'No', 
    converted_at: '',
    application_id: '', 
    status: 'New', 
    notes: '' 
  };
}

// =========================================================================
// Lead Processors - 30h
// =========================================================================

function processLead30h(payload) {
  var timestamp = new Date();
  return { 
    timestamp: formatDate(timestamp), 
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(), 
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(), 
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
    source: payload.source || '30H Module landing page', 
    converted: 'No', 
    converted_at: '',
    application_id: '', 
    status: 'New', 
    notes: '' 
  };
}

// =========================================================================
// Lead Processors - Courses
// =========================================================================

function processLeadCourses(payload) {
  var timestamp = new Date();
  var courses = payload.courses || '';
  var isBundle = courses.indexOf(',') !== -1 || courses.indexOf(' + ') !== -1;
  
  return { 
    timestamp: formatDate(timestamp), 
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(), 
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(), 
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
    source: payload.source || 'Courses - landing page',
    converted: 'No', 
    converted_at: '', 
    application_id: '', 
    status: 'New', 
    notes: '' 
  };
}

// =========================================================================
// Lead Processors - Mentorship
// =========================================================================

function processLeadMentorship(payload) {
  var timestamp = new Date();
  var subcategories = payload.subcategories || '';
  if (Array.isArray(subcategories)) subcategories = subcategories.join(', ');
  
  return { 
    timestamp: formatDate(timestamp), 
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(), 
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(), 
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
    subcategories: subcategories, 
    message: payload.message || '',
    source: payload.sourceUrl || 'Mentorship intake form', 
    converted: 'No', 
    converted_at: '',
    application_id: '', 
    status: 'New', 
    notes: '' 
  };
}

// =========================================================================
// Helper Functions
// =========================================================================

function extractCohortLabel(program) {
  if (!program) return 'March-June 2026';
  if (program.indexOf('August') !== -1 || program.indexOf('December') !== -1) return 'August-December 2026';
  return 'March-June 2026';
}

function getExistingApplicationId(email) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var appsRaw = ss.getSheetByName('Applications (RAW)');
    if (!appsRaw) return null;
    
    var data = appsRaw.getDataRange().getValues();
    var headers = data[0];
    var emailCol = headers.indexOf('email');
    var appIdCol = headers.indexOf('application_id');
    if (emailCol === -1) return null;
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][emailCol] === email.toLowerCase()) return data[i][appIdCol] || 'Unknown';
    }
    return null;
  } catch (error) { 
    logError('getExistingApplicationId', error); 
    return null; 
  }
}

function markLeadsAsConverted(email, applicationId) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var leadsRaw = ss.getSheetByName('Leads (RAW)');
    if (!leadsRaw) return;
    
    var data = leadsRaw.getDataRange().getValues();
    var headers = data[0];
    var emailCol = headers.indexOf('email');
    var convertedCol = headers.indexOf('converted');
    var convertedAtCol = headers.indexOf('converted_at');
    var appIdCol = headers.indexOf('application_id');
    if (emailCol === -1 || convertedCol === -1) return;
    
    var timestamp = formatDate(new Date());
    for (var i = 1; i < data.length; i++) {
      if (data[i][emailCol] === email.toLowerCase() && data[i][convertedCol] !== 'Yes') {
        leadsRaw.getRange(i + 1, convertedCol + 1).setValue('Yes');
        if (convertedAtCol !== -1) leadsRaw.getRange(i + 1, convertedAtCol + 1).setValue(timestamp);
        if (appIdCol !== -1) leadsRaw.getRange(i + 1, appIdCol + 1).setValue(applicationId);
      }
    }
  } catch (error) { 
    logError('markLeadsAsConverted', error); 
  }
}


// =========================================================================
// MULTI-FORMAT LEAD HANDLER
// Handles unified modal submissions with multiple program selections
// Creates SEPARATE lead entries per format for LeadManager tracking
// =========================================================================

/**
 * Process multi-format schedule request from unified modal
 * Creates one lead entry per selected format
 * @param {Object} payload - Form data with multiFormat and allFormats fields
 * @param {string} primaryAction - The primary action (lead_schedule_18w, etc.)
 * @returns {Object} JSON response
 */
function handleMultiFormatLead(payload, primaryAction) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var leadsRaw = ss.getSheetByName('Leads (RAW)');
    if (!leadsRaw) return jsonResponse({ ok: false, error: 'Leads (RAW) sheet not found' });
    
    // Check if this is a multi-format submission
    var isMultiFormat = payload.multiFormat === 'Yes' && payload.allFormats;
    var formats = isMultiFormat ? payload.allFormats.split(',') : [getFormatFromAction(primaryAction)];
    
    var leadsCreated = [];
    var headers = getOrCreateHeaders(leadsRaw, getLeadsSchema());
    
    // Create a lead entry for each selected format
    for (var i = 0; i < formats.length; i++) {
      var format = formats[i].trim();
      var leadData = buildLeadDataForFormat(payload, format, isMultiFormat);
      
      // Check for existing applicant
      var existingAppId = getExistingApplicationId(leadData.email);
      if (existingAppId) { 
        leadData.notes = 'EXISTING APPLICANT (App ID: ' + existingAppId + ')'; 
        leadData.status = 'Existing Applicant'; 
      }
      
      // If multi-format, add note about comparison
      if (isMultiFormat && i === 0) {
        var existingNotes = leadData.notes || '';
        leadData.notes = (existingNotes ? existingNotes + ' | ' : '') + 
          'MULTI-FORMAT: Interested in ' + formats.join(', ') + ' (comparing options)';
      }
      
      // Save to sheet
      var rowArray = [];
      for (var j = 0; j < headers.length; j++) {
        rowArray.push(leadData[headers[j]] || '');
      }
      leadsRaw.appendRow(rowArray);
      var newRowIndex = leadsRaw.getLastRow();
      applyRowColor(leadsRaw, newRowIndex, leadData.type);
      
      leadsCreated.push({
        format: format,
        rowIndex: newRowIndex,
        leadData: leadData
      });
    }
    
    // Send appropriate email based on single vs multi format
    try {
      if (isMultiFormat) {
        sendEmailMultiFormat(leadsCreated[0].leadData, formats);
      } else {
        // Use existing email functions for single format
        switch (primaryAction) {
          case 'lead_schedule_4w': sendEmail4wYTT(leadsCreated[0].leadData); break;
          case 'lead_schedule_8w': sendEmail8wYTT(leadsCreated[0].leadData); break;
          case 'lead_schedule_18w': sendEmail18wYTT(leadsCreated[0].leadData); break;
          default: sendLeadConfirmationGeneric(leadsCreated[0].leadData);
        }
      }
    } catch (emailError) { 
      logError('Multi-format email sending', emailError); 
    }
    
    // Send welcome SMS (only once, not per format)
    try {
      if (typeof sendWelcomeSMS === 'function') {
        sendWelcomeSMS({
          first_name: leadsCreated[0].leadData.first_name,
          phone: leadsCreated[0].leadData.phone,
          program: isMultiFormat ? 'Multiple YTT formats' : leadsCreated[0].leadData.program
        }, leadsCreated[0].rowIndex);
      }
    } catch (smsError) {
      logError('Welcome SMS', smsError);
    }
    
    // Send admin notification
    try { 
      var notifyData = Object.assign({}, leadsCreated[0].leadData);
      if (isMultiFormat) {
        notifyData.notes = 'MULTI-FORMAT REQUEST: ' + formats.join(', ');
      }
      sendAdminNotification(notifyData, primaryAction); 
    } catch (notifyError) { 
      logError('Admin notification', notifyError); 
    }
    
    return jsonResponse({ 
      ok: true, 
      message: 'Request received successfully',
      leadsCreated: leadsCreated.length
    });
    
  } catch (error) { 
    logError('handleMultiFormatLead', error); 
    return jsonResponse({ ok: false, error: 'Failed to process lead: ' + error.message }); 
  }
}

/**
 * Build lead data object for a specific format
 */
function buildLeadDataForFormat(payload, format, isMultiFormat) {
  var timestamp = new Date();
  var programInfo = getProgramInfoForFormat(format);
  
  return { 
    timestamp: formatDate(timestamp), 
    email: (payload.email || '').toLowerCase().trim(),
    first_name: (payload.firstName || '').trim(), 
    last_name: (payload.lastName || '').trim(),
    phone: "'" + (payload.phone || '').trim(), 
    type: 'ytt', 
    ytt_program_type: programInfo.type,
    program: programInfo.program,
    course_id: '', 
    cohort_label: programInfo.cohort,
    preferred_month: '',
    accommodation: normalizeYesNo(payload.accommodation || 'No'),
    city_country: payload.cityCountry || '', 
    housing_months: '',
    service: '', 
    subcategories: '', 
    message: '', 
    source: payload.source || 'Unified Schedule Modal',
    converted: 'No', 
    converted_at: '', 
    application_id: '', 
    status: 'New', 
    notes: '' 
  };
}

/**
 * Get program info based on format ID
 */
function getProgramInfoForFormat(format) {
  var programs = {
    '18w': {
      type: '18-week',
      program: '18 UGERS FLEKSIBELT PROGRAM - Marts-Juni 2026',
      cohort: 'March-June 2026'
    },
    '8w': {
      type: '8-week',
      program: '8-Week Semi-Intensive YTT - May-June 2026',
      cohort: 'May-June 2026'
    },
    '4w': {
      type: '4-week',
      program: '4-Week Intensive YTT - March/April 2026',
      cohort: 'March/April 2026'
    }
  };
  
  return programs[format] || programs['18w'];
}

/**
 * Extract format from action string
 */
function getFormatFromAction(action) {
  if (action.indexOf('18w') !== -1) return '18w';
  if (action.indexOf('8w') !== -1) return '8w';
  if (action.indexOf('4w') !== -1) return '4w';
  return '18w';
}