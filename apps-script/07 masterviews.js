// =========================================================================
// 07_MasterViews.gs — Master Views Configuration & Refresh
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// MASTER LEADS CONFIG
// =========================================================================

var MASTER_LEADS_CONFIG = {
  sheetName: 'Master Leads',
  columns: [
    { key: 'first_name', label: 'First Name', width: 100 }, 
    { key: 'last_name', label: 'Last Name', width: 100 },
    { key: 'phone', label: 'Phone', width: 130 }, 
    { key: 'email', label: 'Email', width: 200 },
    { key: 'program', label: 'Program / Interest', width: 220 }, 
    { key: 'preferred_month', label: 'Preferred Month', width: 120 },
    { key: 'accommodation', label: 'Housing?', width: 80 }, 
    { key: 'city_country', label: 'Location', width: 120 },
    { key: 'status', label: 'Status', width: 100 }, 
    { key: 'notes', label: 'Notes', width: 180 }, 
    { key: 'timestamp', label: 'Date', width: 140 }
  ],
  yttSections: [
    { yttType: '18-week', label: '18-WEEK FLEXIBLE YTT (200H)', color: '#1B5E20', bgColor: '#E8F5E9' },
    { yttType: '4-week', label: '4-WEEK INTENSIVE YTT (200H)', color: '#2E7D32', bgColor: '#C8E6C9' },
    { yttType: '8-week', label: '8-WEEK SEMI-INTENSIVE YTT (200H)', color: '#388E3C', bgColor: '#A5D6A7' },
    { yttType: '300h', label: '300-HOUR ADVANCED YTT', color: '#7B1FA2', bgColor: '#E1BEE7' },
    { yttType: '50h', label: '50-HOUR SPECIALTY TRAINING', color: '#C62828', bgColor: '#FFCDD2' },
    { yttType: '30h', label: '30-HOUR MODULES', color: '#AD1457', bgColor: '#F8BBD9' },
    { yttType: 'other', label: 'OTHER YTT INQUIRIES', color: '#455A64', bgColor: '#CFD8DC' }
  ],
  otherSections: [
    { type: 'course', label: 'COURSE LEADS (Single Courses)', color: '#0D47A1', bgColor: '#E3F2FD' },
    { type: 'bundle', label: 'BUNDLE LEADS (Course Bundles)', color: '#E65100', bgColor: '#FFF3E0' },
    { type: 'mentorship', label: 'MENTORSHIP LEADS', color: '#6A1B9A', bgColor: '#F3E5F5' }
  ]
};

// =========================================================================
// MASTER APPLICATIONS CONFIG
// =========================================================================

var MASTER_APPS_CONFIG = {
  sheetName: 'Master Applications',
  columns: [
    { key: 'first_name', label: 'First Name', width: 100 }, 
    { key: 'last_name', label: 'Last Name', width: 100 },
    { key: 'phone', label: 'Phone', width: 130 }, 
    { key: 'email', label: 'Email', width: 200 },
    { key: 'application_id', label: 'App ID', width: 120 }, 
    { key: 'course_name', label: 'Program', width: 220 },
    { key: 'cohort_label', label: 'Cohort', width: 140 }, 
    { key: 'track', label: 'Track', width: 120 },
    { key: 'status', label: 'Status', width: 100 }, 
    { key: 'payment_choice', label: 'Payment', width: 100 },
    { key: 'notes', label: 'Notes', width: 180 }, 
    { key: 'timestamp', label: 'Date', width: 140 }
  ],
  yttSections: [
    { yttType: '18-week', label: '18-WEEK FLEXIBLE YTT (200H)', color: '#1B5E20', bgColor: '#E8F5E9' },
    { yttType: '4-week', label: '4-WEEK INTENSIVE YTT (200H)', color: '#2E7D32', bgColor: '#C8E6C9' },
    { yttType: '8-week', label: '8-WEEK SEMI-INTENSIVE YTT (200H)', color: '#388E3C', bgColor: '#A5D6A7' },
    { yttType: '300h', label: '300-HOUR ADVANCED YTT', color: '#7B1FA2', bgColor: '#E1BEE7' },
    { yttType: '50h', label: '50-HOUR SPECIALTY TRAINING', color: '#C62828', bgColor: '#FFCDD2' },
    { yttType: '30h', label: '30-HOUR MODULES', color: '#AD1457', bgColor: '#F8BBD9' },
    { yttType: 'other', label: 'OTHER YTT APPLICATIONS', color: '#455A64', bgColor: '#CFD8DC' }
  ],
  otherSections: [
    { type: 'course', label: 'COURSE APPLICATIONS', color: '#0D47A1', bgColor: '#E3F2FD' },
    { type: 'bundle', label: 'BUNDLE APPLICATIONS', color: '#E65100', bgColor: '#FFF3E0' },
    { type: 'accommodation', label: 'ACCOMMODATION REQUESTS', color: '#F9A825', bgColor: '#FFFDE7' }
  ]
};

// =========================================================================
// REFRESH MASTER LEADS
// =========================================================================

function refreshMasterLeads() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var leadsRaw = ss.getSheetByName('Leads (RAW)');
  if (!leadsRaw) { Logger.log('Error: Leads (RAW) sheet not found'); return 'Error: Leads (RAW) not found'; }
  
  var masterSheet = ss.getSheetByName(MASTER_LEADS_CONFIG.sheetName);
  if (!masterSheet) masterSheet = ss.insertSheet(MASTER_LEADS_CONFIG.sheetName);
  masterSheet.clear(); 
  masterSheet.clearFormats();
  
  var rawData = leadsRaw.getDataRange().getValues();
  if (rawData.length < 2) { masterSheet.getRange('A1').setValue('No leads yet'); return 'No data'; }
  
  var headers = rawData[0]; 
  var rows = rawData.slice(1);
  
  // Filter out converted leads
  var convertedCol = headers.indexOf('converted');
  if (convertedCol !== -1) rows = rows.filter(function(row) { return String(row[convertedCol] || '').toLowerCase() !== 'yes'; });
  
  var typeCol = headers.indexOf('type'); 
  var yttTypeCol = headers.indexOf('ytt_program_type');
  
  // Group by type
  var yttGrouped = {}; 
  MASTER_LEADS_CONFIG.yttSections.forEach(function(section) { yttGrouped[section.yttType] = []; });
  var otherGrouped = {}; 
  MASTER_LEADS_CONFIG.otherSections.forEach(function(section) { otherGrouped[section.type] = []; });
  
  rows.forEach(function(row) {
    var type = String(row[typeCol] || '').toLowerCase();
    if (type === 'ytt') {
      var yttType = String(row[yttTypeCol] || '').toLowerCase() || 'other';
      if (yttGrouped[yttType] !== undefined) yttGrouped[yttType].push(row);
      else yttGrouped['other'].push(row);
    } else if (otherGrouped[type] !== undefined) otherGrouped[type].push(row);
  });
  
  // Build column map
  var colMap = {}; 
  MASTER_LEADS_CONFIG.columns.forEach(function(col) { colMap[col.key] = headers.indexOf(col.key); });
  
  var currentRow = 1; 
  var numCols = MASTER_LEADS_CONFIG.columns.length;
  
  // Title
  masterSheet.getRange(currentRow, 1, 1, numCols).merge();
  masterSheet.getRange(currentRow, 1).setValue('MASTER LEADS - Yoga Bible').setFontSize(20).setFontWeight('bold').setFontColor('#1a1a1a');
  masterSheet.setRowHeight(currentRow, 45); 
  currentRow++;
  
  // Subtitle
  masterSheet.getRange(currentRow, 1, 1, numCols).merge();
  masterSheet.getRange(currentRow, 1).setValue('Last updated: ' + formatDate(new Date()) + '  |  Active leads only (converted leads hidden)').setFontSize(11).setFontColor('#666666').setFontStyle('italic');
  currentRow += 2;
  
  // Stats
  var totalYTT = 0; 
  MASTER_LEADS_CONFIG.yttSections.forEach(function(s) { totalYTT += yttGrouped[s.yttType].length; });
  var totalOther = 0; 
  MASTER_LEADS_CONFIG.otherSections.forEach(function(s) { totalOther += otherGrouped[s.type].length; });
  
  masterSheet.getRange(currentRow, 1, 1, numCols).merge();
  masterSheet.getRange(currentRow, 1).setValue('QUICK STATS:  Total Active: ' + (totalYTT + totalOther) + '  |  YTT Leads: ' + totalYTT + '  |  Course/Bundle/Mentorship: ' + totalOther)
    .setFontSize(12).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#37474F');
  masterSheet.setRowHeight(currentRow, 35); 
  currentRow += 2;
  
  // Render YTT sections
  MASTER_LEADS_CONFIG.yttSections.forEach(function(section) { 
    currentRow = renderMasterSection(masterSheet, currentRow, numCols, section, yttGrouped[section.yttType] || [], headers, colMap, MASTER_LEADS_CONFIG.columns); 
    currentRow++; 
  });
  currentRow++;
  
  // Render other sections
  MASTER_LEADS_CONFIG.otherSections.forEach(function(section) { 
    currentRow = renderMasterSection(masterSheet, currentRow, numCols, section, otherGrouped[section.type] || [], headers, colMap, MASTER_LEADS_CONFIG.columns); 
    currentRow++; 
  });
  
  // Set column widths
  MASTER_LEADS_CONFIG.columns.forEach(function(col, idx) { masterSheet.setColumnWidth(idx + 1, col.width); });
  masterSheet.setFrozenRows(5); 
  masterSheet.setHiddenGridlines(true);
  
  Logger.log('Master Leads refreshed: ' + (totalYTT + totalOther) + ' active leads');
  return 'Done! ' + (totalYTT + totalOther) + ' leads displayed';
}

// =========================================================================
// REFRESH MASTER APPLICATIONS
// =========================================================================

function refreshMasterApplications() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var appsRaw = ss.getSheetByName('Applications (RAW)');
  if (!appsRaw) { Logger.log('Error: Applications (RAW) sheet not found'); return 'Error: Applications (RAW) not found'; }
  
  var masterSheet = ss.getSheetByName(MASTER_APPS_CONFIG.sheetName);
  if (!masterSheet) masterSheet = ss.insertSheet(MASTER_APPS_CONFIG.sheetName);
  masterSheet.clear(); 
  masterSheet.clearFormats();
  
  var rawData = appsRaw.getDataRange().getValues();
  if (rawData.length < 2) { masterSheet.getRange('A1').setValue('No applications yet'); return 'No data'; }
  
  var headers = rawData[0]; 
  var rows = rawData.slice(1);
  var typeCol = headers.indexOf('type'); 
  var yttTypeCol = headers.indexOf('ytt_program_type');
  
  // Group by type
  var yttGrouped = {}; 
  MASTER_APPS_CONFIG.yttSections.forEach(function(section) { yttGrouped[section.yttType] = []; });
  var otherGrouped = {}; 
  MASTER_APPS_CONFIG.otherSections.forEach(function(section) { otherGrouped[section.type] = []; });
  
  rows.forEach(function(row) {
    var type = String(row[typeCol] || '').toLowerCase();
    if (type === 'ytt') {
      var yttType = String(row[yttTypeCol] || '').toLowerCase() || 'other';
      if (yttGrouped[yttType] !== undefined) yttGrouped[yttType].push(row);
      else yttGrouped['other'].push(row);
    } else if (otherGrouped[type] !== undefined) otherGrouped[type].push(row);
  });
  
  // Build column map
  var colMap = {}; 
  MASTER_APPS_CONFIG.columns.forEach(function(col) { colMap[col.key] = headers.indexOf(col.key); });
  
  var currentRow = 1; 
  var numCols = MASTER_APPS_CONFIG.columns.length;
  
  // Title
  masterSheet.getRange(currentRow, 1, 1, numCols).merge();
  masterSheet.getRange(currentRow, 1).setValue('MASTER APPLICATIONS - Yoga Bible').setFontSize(20).setFontWeight('bold').setFontColor('#1a1a1a');
  masterSheet.setRowHeight(currentRow, 45); 
  currentRow++;
  
  // Subtitle
  masterSheet.getRange(currentRow, 1, 1, numCols).merge();
  masterSheet.getRange(currentRow, 1).setValue('Last updated: ' + formatDate(new Date()) + '  |  All confirmed applications').setFontSize(11).setFontColor('#666666').setFontStyle('italic');
  currentRow += 2;
  
  // Stats
  var totalYTT = 0; 
  MASTER_APPS_CONFIG.yttSections.forEach(function(s) { totalYTT += yttGrouped[s.yttType].length; });
  var totalOther = 0; 
  MASTER_APPS_CONFIG.otherSections.forEach(function(s) { totalOther += otherGrouped[s.type].length; });
  
  masterSheet.getRange(currentRow, 1, 1, numCols).merge();
  masterSheet.getRange(currentRow, 1).setValue('QUICK STATS:  Total Applications: ' + (totalYTT + totalOther) + '  |  YTT: ' + totalYTT + '  |  Course/Bundle/Accommodation: ' + totalOther)
    .setFontSize(12).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1B5E20');
  masterSheet.setRowHeight(currentRow, 35); 
  currentRow += 2;
  
  // Render YTT sections
  MASTER_APPS_CONFIG.yttSections.forEach(function(section) { 
    currentRow = renderMasterSection(masterSheet, currentRow, numCols, section, yttGrouped[section.yttType] || [], headers, colMap, MASTER_APPS_CONFIG.columns); 
    currentRow++; 
  });
  currentRow++;
  
  // Render other sections
  MASTER_APPS_CONFIG.otherSections.forEach(function(section) { 
    currentRow = renderMasterSection(masterSheet, currentRow, numCols, section, otherGrouped[section.type] || [], headers, colMap, MASTER_APPS_CONFIG.columns); 
    currentRow++; 
  });
  
  // Set column widths
  MASTER_APPS_CONFIG.columns.forEach(function(col, idx) { masterSheet.setColumnWidth(idx + 1, col.width); });
  masterSheet.setFrozenRows(5); 
  masterSheet.setHiddenGridlines(true);
  
  Logger.log('Master Applications refreshed: ' + (totalYTT + totalOther) + ' applications');
  return 'Done! ' + (totalYTT + totalOther) + ' applications displayed';
}

// =========================================================================
// SHARED SECTION RENDERER
// =========================================================================

function renderMasterSection(sheet, startRow, numCols, section, rows, headers, colMap, columnsConfig) {
  var currentRow = startRow;
  
  // Section header
  sheet.getRange(currentRow, 1, 1, numCols).merge();
  sheet.getRange(currentRow, 1).setValue(section.label + '  (' + rows.length + ')').setFontSize(13).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(section.color);
  sheet.setRowHeight(currentRow, 32); 
  currentRow++;
  
  if (rows.length === 0) {
    sheet.getRange(currentRow, 1, 1, numCols).merge();
    sheet.getRange(currentRow, 1).setValue('No items in this category').setFontColor('#999999').setFontStyle('italic').setBackground('#FAFAFA');
    currentRow++;
  } else {
    // Column headers
    var headerValues = columnsConfig.map(function(col) { return col.label; });
    sheet.getRange(currentRow, 1, 1, numCols).setValues([headerValues]).setFontWeight('bold').setFontSize(10).setBackground('#F5F5F5');
    sheet.setRowHeight(currentRow, 28); 
    currentRow++;
    
    // Sort by timestamp
    var timestampCol = headers.indexOf('timestamp');
    if (timestampCol !== -1) rows.sort(function(a, b) { return new Date(a[timestampCol]) - new Date(b[timestampCol]); });
    
    // Data rows
    rows.forEach(function(rawRow, idx) {
      var rowValues = columnsConfig.map(function(col) {
        var colIdx = colMap[col.key]; 
        if (colIdx === -1 || colIdx === undefined) return '';
        var val = rawRow[colIdx];
        if (col.key === 'timestamp' && val) { 
          try { return Utilities.formatDate(new Date(val), CONFIG.TIMEZONE, 'dd MMM yyyy HH:mm'); } 
          catch(e) { return val; } 
        }
        if (col.key === 'phone' && val) return String(val).replace(/^'/, '');
        return val || '';
      });
      sheet.getRange(currentRow, 1, 1, numCols).setValues([rowValues]).setFontSize(11).setVerticalAlignment('middle').setBackground(idx % 2 === 0 ? section.bgColor : '#FFFFFF');
      sheet.setRowHeight(currentRow, 26); 
      currentRow++;
    });
  }
  
  return currentRow;
}

// =========================================================================
// FORMULA-BASED MASTER LEADS (Instant Updates)
// =========================================================================

function setupMasterLeadsFormula() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Master Leads');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('Master Leads');
  
  var currentRow = 1;
  
  // Title
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('MASTER LEADS - Auto-Updating View').setFontSize(18).setFontWeight('bold').setFontColor('#1B5E20');
  sheet.setRowHeight(currentRow, 40); 
  currentRow++;
  
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('Shows active leads only (converted=No). Updates instantly when new leads arrive.').setFontSize(10).setFontColor('#666666').setFontStyle('italic');
  currentRow += 2;
  
  // YTT LEADS
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('YTT LEADS (Teacher Training)').setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1B5E20');
  sheet.setRowHeight(currentRow, 30); 
  currentRow++;
  sheet.getRange(currentRow, 1).setFormula("=IFERROR(QUERY('Leads (RAW)'!A:W, \"SELECT C, D, B, E, H, J, K, L, M, A WHERE F = 'ytt' AND R = 'No' ORDER BY A DESC LABEL C 'First Name', D 'Last Name', B 'Email', E 'Phone', H 'Program', J 'Cohort', K 'Pref Month', L 'Housing', M 'Location', A 'Date'\", 1), \"No YTT leads yet\")");
  currentRow += 12;
  
  // COURSE LEADS
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('COURSE LEADS (Single Courses)').setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#0D47A1');
  sheet.setRowHeight(currentRow, 30); 
  currentRow++;
  sheet.getRange(currentRow, 1).setFormula("=IFERROR(QUERY('Leads (RAW)'!A:W, \"SELECT C, D, B, E, H, J, K, L, M, A WHERE F = 'course' AND R = 'No' ORDER BY A DESC LABEL C 'First Name', D 'Last Name', B 'Email', E 'Phone', H 'Program', J 'Cohort', K 'Pref Month', L 'Housing', M 'Location', A 'Date'\", 1), \"No course leads yet\")");
  currentRow += 12;
  
  // BUNDLE LEADS
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('BUNDLE LEADS (Course Bundles)').setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#E65100');
  sheet.setRowHeight(currentRow, 30); 
  currentRow++;
  sheet.getRange(currentRow, 1).setFormula("=IFERROR(QUERY('Leads (RAW)'!A:W, \"SELECT C, D, B, E, H, J, K, L, M, A WHERE F = 'bundle' AND R = 'No' ORDER BY A DESC LABEL C 'First Name', D 'Last Name', B 'Email', E 'Phone', H 'Program', J 'Cohort', K 'Pref Month', L 'Housing', M 'Location', A 'Date'\", 1), \"No bundle leads yet\")");
  currentRow += 12;
  
  // MENTORSHIP LEADS
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('MENTORSHIP LEADS').setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#6A1B9A');
  sheet.setRowHeight(currentRow, 30); 
  currentRow++;
  sheet.getRange(currentRow, 1).setFormula("=IFERROR(QUERY('Leads (RAW)'!A:W, \"SELECT C, D, B, E, O, P, Q, A WHERE F = 'mentorship' AND R = 'No' ORDER BY A DESC LABEL C 'First Name', D 'Last Name', B 'Email', E 'Phone', O 'Service', P 'Subcategories', Q 'Message', A 'Date'\", 1), \"No mentorship leads yet\")");
  
  // Column widths
  sheet.setColumnWidth(1, 100); sheet.setColumnWidth(2, 100); sheet.setColumnWidth(3, 200); sheet.setColumnWidth(4, 120);
  sheet.setColumnWidth(5, 250); sheet.setColumnWidth(6, 120); sheet.setColumnWidth(7, 100); sheet.setColumnWidth(8, 80);
  sheet.setColumnWidth(9, 100); sheet.setColumnWidth(10, 140);
  sheet.setFrozenRows(2);
  
  return 'Master Leads set up with instant formulas!';
}

// =========================================================================
// FORMULA-BASED MASTER APPLICATIONS (Instant Updates)
// =========================================================================

function setupMasterApplicationsFormula() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Master Applications');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('Master Applications');
  
  var currentRow = 1;
  
  // Title
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('MASTER APPLICATIONS - Auto-Updating View').setFontSize(18).setFontWeight('bold').setFontColor('#1B5E20');
  sheet.setRowHeight(currentRow, 40); 
  currentRow++;
  
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('All applications. Updates instantly.').setFontSize(10).setFontColor('#666666').setFontStyle('italic');
  currentRow += 2;
  
  // YTT APPLICATIONS
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('YTT APPLICATIONS').setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1B5E20');
  sheet.setRowHeight(currentRow, 30); 
  currentRow++;
  sheet.getRange(currentRow, 1).setFormula("=IFERROR(QUERY('Applications (RAW)'!A:V, \"SELECT * WHERE B = 'ytt' ORDER BY A DESC\", 1), \"No YTT applications yet\")");
  currentRow += 12;
  
  // COURSE APPLICATIONS
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('COURSE APPLICATIONS').setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#0D47A1');
  sheet.setRowHeight(currentRow, 30); 
  currentRow++;
  sheet.getRange(currentRow, 1).setFormula("=IFERROR(QUERY('Applications (RAW)'!A:V, \"SELECT * WHERE B = 'course' ORDER BY A DESC\", 1), \"No course applications yet\")");
  currentRow += 12;
  
  // BUNDLE APPLICATIONS
  sheet.getRange(currentRow, 1, 1, 10).merge();
  sheet.getRange(currentRow, 1).setValue('BUNDLE APPLICATIONS').setFontSize(14).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#E65100');
  sheet.setRowHeight(currentRow, 30); 
  currentRow++;
  sheet.getRange(currentRow, 1).setFormula("=IFERROR(QUERY('Applications (RAW)'!A:V, \"SELECT * WHERE B = 'bundle' ORDER BY A DESC\", 1), \"No bundle applications yet\")");
  
  // Column widths
  for (var i = 1; i <= 10; i++) sheet.setColumnWidth(i, 120);
  sheet.setFrozenRows(2);
  
  return 'Master Applications set up with instant formulas!';
}