// =========================================================================
// 08_Dashboard.gs — Dashboard Functions
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// REFRESH DASHBOARD (Manual)
// =========================================================================

function refreshDashboard() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var dashboard = ss.getSheetByName('Dashboard');
  if (!dashboard) dashboard = ss.insertSheet('Dashboard');
  dashboard.clear(); 
  dashboard.clearFormats();
  
  // Get data
  var leadsRaw = ss.getSheetByName('Leads (RAW)');
  var appsRaw = ss.getSheetByName('Applications (RAW)');
  var leadsData = leadsRaw ? leadsRaw.getDataRange().getValues() : [];
  var appsData = appsRaw ? appsRaw.getDataRange().getValues() : [];
  
  // Calculate lead stats
  var leadsHeaders = leadsData.length > 0 ? leadsData[0] : [];
  var leadsTypeCol = leadsHeaders.indexOf('type'); 
  var convertedCol = leadsHeaders.indexOf('converted');
  var totalLeads = leadsData.length > 1 ? leadsData.length - 1 : 0;
  var activeLeads = 0, convertedLeads = 0, yttLeads = 0, courseLeads = 0;
  
  for (var i = 1; i < leadsData.length; i++) {
    var leadType = String(leadsData[i][leadsTypeCol] || '').toLowerCase();
    var isConverted = String(leadsData[i][convertedCol] || '').toLowerCase() === 'yes';
    if (!isConverted) { 
      activeLeads++; 
      if (leadType === 'ytt') yttLeads++; 
      if (leadType === 'course' || leadType === 'bundle') courseLeads++; 
    }
    else convertedLeads++;
  }
  
  // Calculate app stats
  var appsHeaders = appsData.length > 0 ? appsData[0] : [];
  var appsTypeCol = appsHeaders.indexOf('type');
  var totalApps = appsData.length > 1 ? appsData.length - 1 : 0;
  var yttApps = 0, courseApps = 0;
  
  for (var j = 1; j < appsData.length; j++) {
    var appType = String(appsData[j][appsTypeCol] || '').toLowerCase();
    if (appType === 'ytt') yttApps++; 
    if (appType === 'course' || appType === 'bundle') courseApps++;
  }
  
  var conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
  
  // Build dashboard
  var currentRow = 1;
  
  // Title
  dashboard.getRange(currentRow, 1, 1, 6).merge();
  dashboard.getRange(currentRow, 1).setValue('YOGA BIBLE DASHBOARD').setFontSize(24).setFontWeight('bold');
  dashboard.setRowHeight(currentRow, 50); 
  currentRow++;
  
  // Subtitle
  dashboard.getRange(currentRow, 1, 1, 6).merge();
  dashboard.getRange(currentRow, 1).setValue('Last updated: ' + formatDate(new Date())).setFontSize(11).setFontColor('#666666').setFontStyle('italic');
  currentRow += 2;
  
  // KPI boxes
  var kpiData = [
    { label: 'Total Leads', value: totalLeads, color: '#1976D2' }, 
    { label: 'Active Leads', value: activeLeads, color: '#388E3C' },
    { label: 'Converted', value: convertedLeads, color: '#7B1FA2' }, 
    { label: 'Conversion Rate', value: conversionRate + '%', color: '#F57C00' },
    { label: 'Applications', value: totalApps, color: '#D32F2F' }
  ];
  
  kpiData.forEach(function(kpi, idx) {
    var col = idx + 1;
    dashboard.getRange(currentRow, col, 3, 1).setBackground('#FAFAFA').setBorder(true, true, true, true, false, false, '#E0E0E0', SpreadsheetApp.BorderStyle.SOLID);
    dashboard.getRange(currentRow, col).setValue(kpi.label).setFontSize(10).setFontColor('#666666').setHorizontalAlignment('center');
    dashboard.getRange(currentRow + 1, col).setValue(kpi.value).setFontSize(28).setFontWeight('bold').setFontColor(kpi.color).setHorizontalAlignment('center');
    dashboard.setColumnWidth(col, 140);
  });
  
  dashboard.setRowHeight(currentRow, 30); 
  dashboard.setRowHeight(currentRow + 1, 50); 
  dashboard.setRowHeight(currentRow + 2, 10);
  dashboard.setFrozenRows(2); 
  dashboard.setHiddenGridlines(true);
  
  Logger.log('Dashboard refreshed');
  return 'Dashboard refreshed';
}

// =========================================================================
// REFRESH DASHBOARD (Auto - Formula Based)
// =========================================================================

function refreshDashboardAuto() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Dashboard (Auto)');
  if (!sheet) sheet = ss.insertSheet('Dashboard (Auto)');
  sheet.clear();
  
  // Title
  sheet.getRange('A1').setValue('AUTO-UPDATING METRICS').setFontSize(18).setFontWeight('bold');
  sheet.getRange('A2').setValue('These metrics update automatically').setFontSize(10).setFontColor('#666666');
  
  // Headers
  sheet.getRange('A4').setValue('Metric'); 
  sheet.getRange('B4').setValue('Value'); 
  sheet.getRange('C4').setValue('Description');
  sheet.getRange('A4:C4').setFontWeight('bold').setBackground('#F5F5F5');
  
  // Lead metrics
  sheet.getRange('A5').setValue('Total Leads'); 
  sheet.getRange('B5').setFormula("=COUNTA('Leads (RAW)'!A:A)-1"); 
  sheet.getRange('C5').setValue('Count of leads');
  
  sheet.getRange('A6').setValue('Active Leads'); 
  sheet.getRange('B6').setFormula("=COUNTIF('Leads (RAW)'!R:R,\"No\")"); 
  sheet.getRange('C6').setValue('Leads not converted');
  
  sheet.getRange('A7').setValue('Converted Leads'); 
  sheet.getRange('B7').setFormula("=COUNTIF('Leads (RAW)'!R:R,\"Yes\")"); 
  sheet.getRange('C7').setValue('Leads converted to apps');
  
  sheet.getRange('A8').setValue('YTT Leads'); 
  sheet.getRange('B8').setFormula("=COUNTIFS('Leads (RAW)'!F:F,\"ytt\",'Leads (RAW)'!R:R,\"No\")"); 
  sheet.getRange('C8').setValue('Active YTT leads');
  
  sheet.getRange('A9').setValue('Course Leads'); 
  sheet.getRange('B9').setFormula("=COUNTIFS('Leads (RAW)'!F:F,\"course\",'Leads (RAW)'!R:R,\"No\")"); 
  sheet.getRange('C9').setValue('Active course leads');
  
  sheet.getRange('A10').setValue('Bundle Leads'); 
  sheet.getRange('B10').setFormula("=COUNTIFS('Leads (RAW)'!F:F,\"bundle\",'Leads (RAW)'!R:R,\"No\")"); 
  sheet.getRange('C10').setValue('Active bundle leads');
  
  // Application metrics
  sheet.getRange('A12').setValue('Total Applications'); 
  sheet.getRange('B12').setFormula("=COUNTA('Applications (RAW)'!A:A)-1"); 
  sheet.getRange('C12').setValue('Count of applications');
  
  sheet.getRange('A13').setValue('YTT Applications'); 
  sheet.getRange('B13').setFormula("=COUNTIF('Applications (RAW)'!B:B,\"ytt\")"); 
  sheet.getRange('C13').setValue('YTT applications');
  
  sheet.getRange('A14').setValue('Course Applications'); 
  sheet.getRange('B14').setFormula("=COUNTIF('Applications (RAW)'!B:B,\"course\")"); 
  sheet.getRange('C14').setValue('Course applications');
  
  sheet.getRange('A15').setValue('Bundle Applications'); 
  sheet.getRange('B15').setFormula("=COUNTIF('Applications (RAW)'!B:B,\"bundle\")"); 
  sheet.getRange('C15').setValue('Bundle applications');
  
  // Formatting
  sheet.getRange('B5:B15').setFontWeight('bold').setFontSize(14);
  sheet.getRange('C5:C15').setFontSize(9).setFontColor('#999999');
  sheet.setColumnWidth(1, 150); 
  sheet.setColumnWidth(2, 80); 
  sheet.setColumnWidth(3, 180);
  
  return 'Dashboard (Auto) refreshed';
}