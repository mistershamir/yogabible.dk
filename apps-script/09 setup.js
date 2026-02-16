// =========================================================================
// 09_Setup.gs — Setup & Formatting Functions
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// VIEW TAB COLORS
// =========================================================================

var VIEW_TAB_COLORS = {
  'Apps - YTT (view)': '#1B5E20', 
  'Apps - Courses (view)': '#0D47A1', 
  'Apps - Bundles (view)': '#E65100',
  'Apps - Accommodation (view)': '#F9A825', 
  'Apps - Mentorship (view)': '#6A1B9A',
  'Leads - YTT (view)': '#2E7D32', 
  'Leads - Courses (view)': '#1565C0', 
  'Leads - Bundles (view)': '#EF6C00',
  'Leads - Mentorship (view)': '#7B1FA2', 
  'Leads - Accommodation (view)': '#FBC02D'
};

// =========================================================================
// MAIN SETUP FUNCTION
// =========================================================================

function setupSpreadsheet() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    Logger.log('Starting complete spreadsheet setup...');
    
    // Ensure core sheets exist
    ensureSheet(ss, 'Course Catalog', getCatalogSchema());
    ensureSheet(ss, 'Applications (RAW)', getApplicationsSchema());
    ensureSheet(ss, 'Leads (RAW)', getLeadsSchema());
    ensureSheet(ss, 'Change Requests', ['timestamp', 'email', 'application_id', 'to_course_id', 'to_cohort_id', 'to_cohort_label', 'status', 'notes']);
    ensureSheet(ss, 'Dashboard', []); 
    ensureSheet(ss, 'Dashboard (Auto)', []);
    ensureSheet(ss, 'Master Leads', []); 
    ensureSheet(ss, 'Master Applications', []);
    
    // Ensure view tabs exist
    var viewTabs = [
      'Apps - YTT (view)', 'Apps - Courses (view)', 'Apps - Bundles (view)', 
      'Apps - Accommodation (view)', 'Apps - Mentorship (view)',
      'Leads - YTT (view)', 'Leads - Courses (view)', 'Leads - Bundles (view)', 
      'Leads - Mentorship (view)', 'Leads - Accommodation (view)'
    ];
    viewTabs.forEach(function(tabName) { ensureSheet(ss, tabName, []); });
    
    // Install view formulas
    installViewFormulas(ss);
    
    // Format and refresh
    reformatAllRawTabs(); 
    refreshMasterLeads(); 
    refreshMasterApplications();
    refreshDashboard(); 
    refreshDashboardAuto(); 
    formatAllViewTabs();
    
    Logger.log('Setup complete!');
    return 'Setup completed successfully!';
  } catch (error) { 
    logError('setupSpreadsheet', error); 
    return 'Setup failed: ' + error.message; 
  }
}

// =========================================================================
// INSTALL VIEW FORMULAS
// =========================================================================

function installViewFormulas(ss) {
  var formulas = {
    'Apps - YTT (view)': "=QUERY('Applications (RAW)'!A:V; \"SELECT * WHERE B = 'ytt' ORDER BY A DESC\"; 1)",
    'Apps - Courses (view)': "=QUERY('Applications (RAW)'!A:V; \"SELECT * WHERE B = 'course' ORDER BY A DESC\"; 1)",
    'Apps - Bundles (view)': "=QUERY('Applications (RAW)'!A:V; \"SELECT * WHERE B = 'bundle' ORDER BY A DESC\"; 1)",
    'Apps - Accommodation (view)': "=QUERY('Applications (RAW)'!A:V; \"SELECT * WHERE B = 'accommodation' ORDER BY A DESC\"; 1)",
    'Apps - Mentorship (view)': "=QUERY('Applications (RAW)'!A:V; \"SELECT * WHERE S = 'Yes' ORDER BY A DESC\"; 1)",
    'Leads - YTT (view)': "=QUERY('Leads (RAW)'!A:W; \"SELECT * WHERE F = 'ytt' AND R = 'No' ORDER BY A DESC\"; 1)",
    'Leads - Courses (view)': "=QUERY('Leads (RAW)'!A:W; \"SELECT * WHERE F = 'course' AND R = 'No' ORDER BY A DESC\"; 1)",
    'Leads - Bundles (view)': "=QUERY('Leads (RAW)'!A:W; \"SELECT * WHERE F = 'bundle' AND R = 'No' ORDER BY A DESC\"; 1)",
    'Leads - Mentorship (view)': "=QUERY('Leads (RAW)'!A:W; \"SELECT * WHERE F = 'mentorship' AND R = 'No' ORDER BY A DESC\"; 1)",
    'Leads - Accommodation (view)': "=QUERY('Leads (RAW)'!A:W; \"SELECT * WHERE L = 'Yes' AND R = 'No' ORDER BY A DESC\"; 1)"
  };
  
  for (var sheetName in formulas) {
    var sheet = ss.getSheetByName(sheetName);
    if (sheet) { 
      sheet.clear(); 
      sheet.getRange('A1').setFormula(formulas[sheetName]); 
    }
  }
}

// =========================================================================
// FORMAT VIEW TABS
// =========================================================================

function formatAllViewTabs() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var formatted = 0;
  
  for (var tabName in VIEW_TAB_COLORS) {
    var sheet = ss.getSheetByName(tabName);
    if (sheet) { 
      formatViewTab(sheet, VIEW_TAB_COLORS[tabName]); 
      formatted++; 
    }
  }
  
  return 'Formatted ' + formatted + ' view tabs';
}

function formatViewTab(sheet, headerColor) {
  try {
    var lastCol = sheet.getLastColumn(); 
    if (lastCol < 1) return;
    sheet.getRange(1, 1, 1, lastCol).setBackground(headerColor).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(10);
    sheet.setFrozenRows(1);
  } catch (e) { 
    Logger.log('formatViewTab error: ' + e.message); 
  }
}

// =========================================================================
// REFORMAT RAW TABS
// =========================================================================

function reformatLeadsRaw() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Leads (RAW)');
  if (!sheet) return 'Sheet not found';
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0]; 
  var typeCol = headers.indexOf('type');
  if (typeCol === -1) return 'Type column not found';
  
  for (var i = 1; i < data.length; i++) {
    applyRowColor(sheet, i + 1, data[i][typeCol] || '');
  }
  
  return 'Formatted ' + (data.length - 1) + ' rows';
}

function reformatApplicationsRaw() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Applications (RAW)');
  if (!sheet) return 'Sheet not found';
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0]; 
  var typeCol = headers.indexOf('type');
  if (typeCol === -1) return 'Type column not found';
  
  for (var i = 1; i < data.length; i++) {
    applyRowColor(sheet, i + 1, data[i][typeCol] || '');
  }
  
  return 'Formatted ' + (data.length - 1) + ' rows';
}

function reformatAllRawTabs() { 
  return 'Leads: ' + reformatLeadsRaw() + ', Applications: ' + reformatApplicationsRaw(); 
}