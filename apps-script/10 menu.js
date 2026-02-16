// =========================================================================
// 10_Menu.gs — Menu, Triggers & Refresh Functions
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// ON OPEN - Create Menu
// =========================================================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Yoga Bible')
    .addItem('Refresh All Views', 'refreshAllMasterViews')
    .addSeparator()
    .addSubMenu(ui.createMenu('Refresh Individual')
      .addItem('Master Leads', 'refreshMasterLeads')
      .addItem('Master Applications', 'refreshMasterApplications')
      .addItem('Dashboard', 'refreshDashboard')
      .addItem('Dashboard (Auto)', 'refreshDashboardAuto'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Setup & Maintenance')
      .addItem('Complete Setup (Reset All)', 'setupSpreadsheet')
      .addItem('Setup Formula-Based Master Leads', 'setupMasterLeadsFormula')
      .addItem('Setup Formula-Based Master Apps', 'setupMasterApplicationsFormula')
      .addItem('Reformat Raw Tabs (Colors)', 'reformatAllRawTabs')
      .addItem('Format View Tabs', 'formatAllViewTabs'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Auto-Refresh')
      .addItem('Enable Hourly Refresh', 'setupAutoRefresh')
      .addItem('Disable Auto-Refresh', 'removeAutoRefresh'))
    .addToUi();
}

// =========================================================================
// REFRESH ALL MASTER VIEWS
// =========================================================================

function refreshAllMasterViews() {
  refreshMasterLeads(); 
  refreshMasterApplications(); 
  refreshDashboard();
  Logger.log('All master views refreshed');
  return 'All master views refreshed';
}

// =========================================================================
// AUTO-REFRESH TRIGGERS
// =========================================================================

function setupAutoRefresh() {
  // Remove existing triggers first
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    var handlerName = trigger.getHandlerFunction();
    if (handlerName === 'refreshMasterLeads' || 
        handlerName === 'refreshMasterApplications' || 
        handlerName === 'refreshAllMasterViews') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new hourly trigger
  ScriptApp.newTrigger('refreshAllMasterViews')
    .timeBased()
    .everyHours(1)
    .create();
  
  Logger.log('Auto-refresh trigger set up (every hour)');
  return 'Auto-refresh enabled (hourly)';
}

function removeAutoRefresh() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  
  triggers.forEach(function(trigger) {
    var handlerName = trigger.getHandlerFunction();
    if (handlerName === 'refreshMasterLeads' || 
        handlerName === 'refreshMasterApplications' || 
        handlerName === 'refreshAllMasterViews') { 
      ScriptApp.deleteTrigger(trigger); 
      removed++; 
    }
  });
  
  return 'Auto-refresh disabled (' + removed + ' triggers removed)';
}