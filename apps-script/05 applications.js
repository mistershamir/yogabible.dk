// =========================================================================
// 05_Applications.gs — Application Processing
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// Main Application Handler
// =========================================================================

function handleMasterApply(payload) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var appsRaw = ss.getSheetByName('Applications (RAW)');
    if (!appsRaw) return jsonResponse({ ok: false, error: 'Applications (RAW) sheet not found' });
    
    var applicant = payload.applicant || {};
    var selections = payload.selections || {};
    var source = payload.source || 'Apply page';
    
    if (!applicant.email || !applicant.first_name || !applicant.last_name) {
      return jsonResponse({ ok: false, error: 'Missing required applicant information' });
    }
    
    var timestamp = new Date();
    var applicationId = generateApplicationId();
    
    // Build base row data
    var baseRow = {
      timestamp: formatDate(timestamp), 
      application_id: applicationId,
      email: applicant.email.toLowerCase().trim(), 
      first_name: applicant.first_name.trim(),
      last_name: applicant.last_name.trim(), 
      phone: "'" + (applicant.phone || '').trim(),
      hear_about: applicant.hear_about || '', 
      hear_about_other: applicant.hear_about_other || '',
      source: source, 
      status: 'Pending', 
      mentorship_selected: applicant.mentorship_selected ? 'Yes' : 'No'
    };
    
    var rowsToAdd = [];
    
    // Process YTT selection
    if (selections.ytt) {
      var ytt = selections.ytt;
      var yttRow = JSON.parse(JSON.stringify(baseRow));
      yttRow.type = 'ytt';
      yttRow.ytt_program_type = detectYTTProgramType(ytt.course_name || ytt.program || '', ytt.course_id || '', ytt.cohort_label || '');
      yttRow.course_id = ytt.course_id || ''; 
      yttRow.course_name = ytt.course_name || '';
      yttRow.cohort_id = ytt.cohort_id || ''; 
      yttRow.cohort_label = ytt.cohort_label || '';
      yttRow.track = ytt.track || ''; 
      yttRow.payment_choice = ytt.payment_choice || '';
      yttRow.bundle_type = ''; 
      yttRow.bundle_payment_url = '';
      rowsToAdd.push(yttRow);
    }
    
    // Process course selection
    if (selections.course) {
      var course = selections.course;
      var isBundle = course.course_id === CONFIG.BUNDLE_PROGRAM_ID;
      var courseRow = JSON.parse(JSON.stringify(baseRow));
      courseRow.type = isBundle ? 'bundle' : 'course';
      courseRow.ytt_program_type = ''; 
      courseRow.course_id = course.course_id || '';
      courseRow.course_name = course.course_name || ''; 
      courseRow.cohort_id = course.cohort_id || '';
      courseRow.cohort_label = course.cohort_label || ''; 
      courseRow.track = '';
      courseRow.payment_choice = course.payment_choice || '';
      courseRow.bundle_type = course.bundle_type || ''; 
      courseRow.bundle_payment_url = course.bundle_payment_url || '';
      rowsToAdd.push(courseRow);
    }
    
    // Process accommodation selection
    var accom = selections.accommodation || {};
    if (accom.need === 'yes' && accom.months && accom.months.length > 0) {
      var accomRow = JSON.parse(JSON.stringify(baseRow));
      accomRow.type = 'accommodation'; 
      accomRow.ytt_program_type = '';
      accomRow.course_id = 'ACCOMMODATION'; 
      accomRow.course_name = 'Accommodation';
      accomRow.cohort_id = ''; 
      accomRow.cohort_label = accom.months.join(', ');
      accomRow.track = ''; 
      accomRow.payment_choice = accom.payment_choice || '';
      accomRow.bundle_type = ''; 
      accomRow.bundle_payment_url = '';
      rowsToAdd.push(accomRow);
    }
    
    // Write rows to sheet
    var headers = getOrCreateHeaders(appsRaw, getApplicationsSchema());
    for (var i = 0; i < rowsToAdd.length; i++) {
      var rowData = rowsToAdd[i];
      var rowArray = [];
      for (var j = 0; j < headers.length; j++) rowArray.push(rowData[headers[j]] || '');
      appsRaw.appendRow(rowArray);
      applyRowColor(appsRaw, appsRaw.getLastRow(), rowData.type);
    }
    
    // Mark leads as converted
    markLeadsAsConverted(applicant.email, applicationId);
    
    // Refresh master views
    try { 
      refreshMasterApplications(); 
      refreshMasterLeads(); 
    } catch (refreshError) { 
      logError('Refresh master views', refreshError); 
    }
    
    // Send confirmation email
    try { 
      sendApplicationConfirmation(applicant.email, applicationId, applicant.first_name); 
    } catch (emailError) { 
      logError('Email sending', emailError); 
    }
    
    return jsonResponse({ 
      ok: true, 
      message: 'Application received successfully', 
      application_id: applicationId 
    });
  } catch (error) { 
    logError('handleMasterApply', error); 
    return jsonResponse({ ok: false, error: 'Failed to process application' }); 
  }
}
// =========================================================================
// Get Applications for LeadManager Web App
// =========================================================================

function getApplicationsForApp() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Applications (RAW)');
    if (!sheet) return [];
    
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    
    var headers = data[0].map(function(h) { 
      return String(h).toLowerCase().replace(/\s+/g, '_'); 
    });
    
    var apps = [];
    for (var i = 1; i < data.length; i++) {
      var row = {};
      for (var j = 0; j < headers.length; j++) {
        var val = data[i][j];
        // Convert dates to strings to avoid serialization errors
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
        }
        row[headers[j]] = val;
      }
      row.rowIndex = i + 1;
      apps.push(row);
    }
    
    return apps;
  } catch (e) {
    console.error('getApplicationsForApp error:', e);
    return [];
  }
}