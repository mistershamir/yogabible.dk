// =========================================================================
// 11_WebApp.gs — Lead Manager Web App
// YogaBible.dk Lead & Application System
// =========================================================================

// =========================================================================
// WEB APP ENTRY POINT
// =========================================================================

function doGetApp(e) {   // <-- Change back to doGetApp
  return HtmlService.createHtmlOutputFromFile('LeadManager')
    .setTitle('Yoga Bible - Lead Manager')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// =========================================================================
// DEBUG: Check what's in Leads sheet
// =========================================================================

function debugLeadsSheet() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheets = ss.getSheets();
  Logger.log('All sheet names:');
  for (var i = 0; i < sheets.length; i++) {
    Logger.log('  - "' + sheets[i].getName() + '"');
  }
  
  var sheet = ss.getSheetByName('Leads (RAW)');
  
  if (!sheet) {
    Logger.log('ERROR: "Leads (RAW)" sheet not found!');
    return 'Sheet not found';
  }
  
  var data = sheet.getDataRange().getValues();
  Logger.log('Total rows (including header): ' + data.length);
  Logger.log('Headers: ' + JSON.stringify(data[0]));
  
  return 'Found ' + (data.length - 1) + ' leads';
}

// =========================================================================
// DEBUG: Test returning an array
// =========================================================================

function testReturnArray() {
  return [
    { first_name: 'Test1', last_name: 'User', email: 'test1@example.com', phone: '12345', program: '4-Week YTT', type: 'ytt' },
    { first_name: 'Test2', last_name: 'Person', email: 'test2@example.com', phone: '67890', program: '18-Week YTT', type: 'ytt' }
  ];
}

// =========================================================================
// DEBUG: Super simple leads fetch - just ONE lead
// =========================================================================

function getLeadsSimple() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Leads (RAW)');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  // Build just ONE lead object
  var row = data[1];
  var lead = {};
  for (var j = 0; j < headers.length; j++) {
    var key = String(headers[j]).trim();
    var value = row[j];
    // Convert dates to strings
    if (value instanceof Date) {
      value = value.toISOString();
    }
    if (key) {
      lead[key] = value;
    }
  }
  
  // Return as array with one item
  return [lead];
}

// =========================================================================
// API: GET ALL LEADS (unique name to avoid conflicts)
// =========================================================================

function fetchLeadsForWebApp() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    
    if (!sheet) {
      return [];
    }
    
    var data = sheet.getDataRange().getValues();
    
    if (data.length < 2) {
      return [];
    }
    
    var headers = data[0];
    var allLeads = [];
    var emailMap = {};  // Track all entries by email
    
    // First pass: collect all leads
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var lead = { rowIndex: i + 1 };
      
      for (var j = 0; j < headers.length; j++) {
        var key = String(headers[j]).trim();
        var value = row[j];
        
        // Convert Date objects to strings
        if (value instanceof Date) {
          value = Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
        }
        
        if (key) {
          lead[key] = value;
        }
      }
      
      // Clean phone
      if (lead.phone) {
        lead.phone_clean = String(lead.phone).replace(/^'/, '');
      }
      
      // Skip converted leads
      var converted = String(lead.converted || '').toLowerCase();
      if (converted === 'yes' || converted === 'true') {
        continue;
      }
      
      allLeads.push(lead);
    }
    
    // Sort by timestamp descending (newest first)
    allLeads.sort(function(a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    // Group by email - keep only ONE lead per email (newest), merge interests
    var mergedLeads = [];
    var seenEmails = {};
    
    for (var k = 0; k < allLeads.length; k++) {
      var lead = allLeads[k];
      var email = String(lead.email || '').toLowerCase().trim();
      
      if (!email) {
        // No email - keep as separate lead
        mergedLeads.push(lead);
        continue;
      }
      
      if (!seenEmails[email]) {
        // First time seeing this email - this becomes the primary lead
        seenEmails[email] = {
          lead: lead,
          interests: [{
            program: lead.program || lead.service || '',
            cohort: lead.cohort_label || lead.preferred_month || '',
            timestamp: lead.timestamp,
            rowIndex: lead.rowIndex
          }],
          allRowIndices: [lead.rowIndex]
        };
      } else {
        // Already seen this email - merge into existing
        var existing = seenEmails[email];
        existing.interests.push({
          program: lead.program || lead.service || '',
          cohort: lead.cohort_label || lead.preferred_month || '',
          timestamp: lead.timestamp,
          rowIndex: lead.rowIndex
        });
        existing.allRowIndices.push(lead.rowIndex);
        
        // Keep the best data (prefer non-empty values, prefer newer status/notes)
        if (!existing.lead.status && lead.status) existing.lead.status = lead.status;
        if (!existing.lead.notes && lead.notes) existing.lead.notes = lead.notes;
        if (lead.notes && existing.lead.notes && lead.notes !== existing.lead.notes) {
          // Merge notes
          existing.lead.notes = existing.lead.notes + '\n' + lead.notes;
        }
        if (!existing.lead.followup_date && lead.followup_date) existing.lead.followup_date = lead.followup_date;
        if (!existing.lead.last_contact && lead.last_contact) existing.lead.last_contact = lead.last_contact;
        if (!existing.lead.call_attempts && lead.call_attempts) existing.lead.call_attempts = lead.call_attempts;
        if (lead.accommodation === 'Yes') existing.lead.accommodation = 'Yes';
      }
    }
    
    // Build final list with multi-interest info
    for (var email in seenEmails) {
      var entry = seenEmails[email];
      var lead = entry.lead;
      
      if (entry.interests.length > 1) {
        lead.hasMultipleInterests = true;
        lead.interestCount = entry.interests.length;
        lead.allInterests = entry.interests.map(function(e) { 
          return e.program + (e.cohort ? ' (' + e.cohort + ')' : ''); 
        });
        lead.allRowIndices = entry.allRowIndices;
      }
      
      mergedLeads.push(lead);
    }
    
    // Re-sort merged leads by timestamp
    mergedLeads.sort(function(a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    return mergedLeads;
    
  } catch (error) {
    return [];
  }
}

// =========================================================================
// API: GET ALL LEADS (original name - calls the unique function)
// =========================================================================

function getLeadsForApp() {
  return fetchLeadsForWebApp();
}

// =========================================================================
// API: GET ALL APPLICATIONS
// =========================================================================

function getApplicationsForApp() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Applications (RAW)');
  if (!sheet) return [];
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  var headers = data[0];
  var apps = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var app = { rowIndex: i + 1 };
    for (var j = 0; j < headers.length; j++) {
      var key = String(headers[j]).trim();
      var value = row[j];
      
      // Convert Date objects to strings
      if (value instanceof Date) {
        value = Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
      }
      
      if (key) {
        app[key] = value;
      }
    }
    // Clean phone
    if (app.phone) {
      app.phone_clean = String(app.phone).replace(/^'/, '');
    }
    apps.push(app);
  }
  
  // Sort by timestamp descending
  apps.sort(function(a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
  
  return apps;
}

// =========================================================================
// API: UPDATE LEAD STATUS
// =========================================================================

function updateLeadStatus(rowIndex, newStatus) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Leads (RAW)');
  if (!sheet) return { success: false, error: 'Sheet not found' };
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var statusCol = headers.indexOf('status');
  if (statusCol === -1) return { success: false, error: 'Status column not found' };
  
  sheet.getRange(rowIndex, statusCol + 1).setValue(newStatus);
  return { success: true };
}

// =========================================================================
// API: UPDATE APPLICATION STATUS
// =========================================================================

function updateApplicationStatus(rowIndex, newStatus) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Applications (RAW)');
  if (!sheet) return { success: false, error: 'Sheet not found' };
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var statusCol = headers.indexOf('status');
  if (statusCol === -1) return { success: false, error: 'Status column not found' };
  
  sheet.getRange(rowIndex, statusCol + 1).setValue(newStatus);
  return { success: true };
}

// =========================================================================
// API: ADD NOTE TO LEAD
// =========================================================================

function addLeadNote(rowIndex, note) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Leads (RAW)');
  if (!sheet) return { success: false, error: 'Sheet not found' };
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var notesCol = headers.indexOf('notes');
  if (notesCol === -1) return { success: false, error: 'Notes column not found' };
  
  var currentNote = sheet.getRange(rowIndex, notesCol + 1).getValue() || '';
  var timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
  var newNote = currentNote ? currentNote + '\n[' + timestamp + '] ' + note : '[' + timestamp + '] ' + note;
  
  sheet.getRange(rowIndex, notesCol + 1).setValue(newNote);
  return { success: true, notes: newNote };
}

// =========================================================================
// API: PROCESS UNSUBSCRIBE (updates all rows for an email)
// =========================================================================

function processUnsubscribe(email) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    if (!sheet) return { success: false, error: 'Sheet not found' };

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var emailCol = -1, statusCol = -1, notesCol = -1;
    for (var j = 0; j < headers.length; j++) {
      var h = String(headers[j]).toLowerCase().trim();
      if (h === 'email') emailCol = j;
      if (h === 'status') statusCol = j;
      if (h === 'notes') notesCol = j;
    }
    if (emailCol === -1 || statusCol === -1) return { success: false, error: 'Required columns not found' };

    var normalizedEmail = String(email).toLowerCase().trim();
    var updatedCount = 0;
    var timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][emailCol] || '').toLowerCase().trim() === normalizedEmail) {
        sheet.getRange(i + 1, statusCol + 1).setValue(CONFIG.UNSUBSCRIBE_STATUS);
        if (notesCol !== -1) {
          var currentNote = sheet.getRange(i + 1, notesCol + 1).getValue() || '';
          var newNote = '[' + timestamp + '] UNSUBSCRIBED via email link';
          sheet.getRange(i + 1, notesCol + 1).setValue(newNote + (currentNote ? '\n' + currentNote : ''));
        }
        updatedCount++;
      }
    }
    return { success: true, updatedRows: updatedCount };
  } catch (error) {
    logError('processUnsubscribe', error);
    return { success: false, error: error.message };
  }
}

// =========================================================================
// API: TOGGLE UNSUBSCRIBE (manual, from Lead Manager UI)
// =========================================================================

function toggleLeadUnsubscribe(rowIndex) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    if (!sheet) return { success: false, error: 'Sheet not found' };

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var statusCol = headers.indexOf('status');
    var notesCol = headers.indexOf('notes');
    if (statusCol === -1) return { success: false, error: 'Status column not found' };

    var currentStatus = sheet.getRange(rowIndex, statusCol + 1).getValue();
    var isCurrentlyUnsubscribed = String(currentStatus || '').toLowerCase() === CONFIG.UNSUBSCRIBE_STATUS.toLowerCase();
    var newStatus = isCurrentlyUnsubscribed ? 'Not Interested' : CONFIG.UNSUBSCRIBE_STATUS;
    sheet.getRange(rowIndex, statusCol + 1).setValue(newStatus);

    if (notesCol !== -1) {
      var currentNote = sheet.getRange(rowIndex, notesCol + 1).getValue() || '';
      var timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
      var action = isCurrentlyUnsubscribed ? 'RE-SUBSCRIBED manually' : 'UNSUBSCRIBED manually (phone/in-person request)';
      sheet.getRange(rowIndex, notesCol + 1).setValue('[' + timestamp + '] ' + action + (currentNote ? '\n' + currentNote : ''));
    }

    return { success: true, newStatus: newStatus, unsubscribed: !isCurrentlyUnsubscribed };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// =========================================================================
// UNSUBSCRIBE LANDING PAGE HTML (Danish)
// =========================================================================

function buildUnsubscribePageHtml(state, emailOrMessage, token) {
  var css = '<style>' +
    'body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;color:#333;display:flex;justify-content:center;align-items:center;min-height:100vh;}' +
    '.container{background:white;border-radius:12px;padding:40px;max-width:480px;width:90%;box-shadow:0 4px 12px rgba(0,0,0,0.08);text-align:center;}' +
    'h1{font-size:24px;margin-bottom:16px;color:#111;}' +
    'p{font-size:16px;line-height:1.6;color:#555;margin-bottom:24px;}' +
    '.btn{display:inline-block;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;cursor:pointer;border:none;}' +
    '.btn-confirm{background:#dc2626;color:white;}.btn-confirm:hover{background:#b91c1c;}' +
    '.btn-cancel{background:#f3f4f6;color:#333;margin-left:12px;}.btn-cancel:hover{background:#e5e7eb;}' +
    '.logo{font-size:20px;font-weight:700;color:#f75c03;margin-bottom:24px;}' +
    '.email-hl{font-weight:600;color:#111;}' +
    '.icon{font-size:48px;margin-bottom:16px;}' +
    '</style>';

  if (state === 'confirm') {
    var confirmUrl = ScriptApp.getService().getUrl() +
      '?mode=unsubscribe&email=' + encodeURIComponent(emailOrMessage) +
      '&token=' + token + '&confirmed=yes';
    return '<!DOCTYPE html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      css + '</head><body><div class="container">' +
      '<div class="logo">Yoga Bible</div>' +
      '<h1>Afmeld e-mails</h1>' +
      '<p>Er du sikker p\u00e5, at du vil afmelde <span class="email-hl">' + escapeHtml(emailOrMessage) + '</span> fra vores e-mails?</p>' +
      '<p style="font-size:14px;color:#888;">Du vil ikke l\u00e6ngere modtage e-mails fra Yoga Bible.</p>' +
      '<a href="' + confirmUrl + '" class="btn btn-confirm">Ja, afmeld mig</a> ' +
      '<a href="https://yogabible.dk" class="btn btn-cancel">Annuller</a>' +
      '</div></body></html>';
  }

  if (state === 'success') {
    return '<!DOCTYPE html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      css + '</head><body><div class="container">' +
      '<div class="logo">Yoga Bible</div>' +
      '<div class="icon">\u2705</div>' +
      '<h1>Du er nu afmeldt</h1>' +
      '<p><span class="email-hl">' + escapeHtml(emailOrMessage) + '</span> er blevet fjernet fra vores mailingliste.</p>' +
      '<p style="font-size:14px;color:#888;">Hvis dette var en fejl, er du velkommen til at kontakte os p\u00e5 <a href="mailto:info@yogabible.dk" style="color:#f75c03;">info@yogabible.dk</a></p>' +
      '<a href="https://yogabible.dk" class="btn btn-cancel">G\u00e5 til yogabible.dk</a>' +
      '</div></body></html>';
  }

  // Error state
  return '<!DOCTYPE html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    css + '</head><body><div class="container">' +
    '<div class="logo">Yoga Bible</div>' +
    '<div class="icon">\u26a0\ufe0f</div>' +
    '<h1>Fejl</h1>' +
    '<p>' + escapeHtml(emailOrMessage) + '</p>' +
    '<p style="font-size:14px;color:#888;">Kontakt os p\u00e5 <a href="mailto:info@yogabible.dk" style="color:#f75c03;">info@yogabible.dk</a> for hj\u00e6lp.</p>' +
    '<a href="https://yogabible.dk" class="btn btn-cancel">G\u00e5 til yogabible.dk</a>' +
    '</div></body></html>';
}

// =========================================================================
// API: ADD NOTE TO APPLICATION
// =========================================================================

function addApplicationNote(rowIndex, note) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Applications (RAW)');
  if (!sheet) return { success: false, error: 'Sheet not found' };
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var notesCol = headers.indexOf('notes');
  if (notesCol === -1) return { success: false, error: 'Notes column not found' };
  
  var currentNote = sheet.getRange(rowIndex, notesCol + 1).getValue() || '';
  var timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
  var newNote = currentNote ? currentNote + '\n[' + timestamp + '] ' + note : '[' + timestamp + '] ' + note;
  
  sheet.getRange(rowIndex, notesCol + 1).setValue(newNote);
  return { success: true, notes: newNote };
}

// =========================================================================
// API: GET STATS
// =========================================================================

function getStatsForApp() {
  var leads = fetchLeadsForWebApp();  // Use the unique function
  var apps = getApplicationsForApp();
  
  // Handle error response
  if (leads && leads.error) {
    leads = [];
  }
  
  var yttLeads = leads.filter(function(l) { 
    return String(l.type || '').toLowerCase() === 'ytt'; 
  });
  var courseLeads = leads.filter(function(l) { 
    var t = String(l.type || '').toLowerCase();
    return t === 'course' || t === 'bundle'; 
  });
  
  var yttApps = apps.filter(function(a) { 
    return String(a.type || '').toLowerCase() === 'ytt'; 
  });
  var pendingApps = apps.filter(function(a) { 
    return String(a.status || '').toLowerCase() === 'pending'; 
  });
  
  return {
    totalLeads: leads.length,
    yttLeads: yttLeads.length,
    courseLeads: courseLeads.length,
    totalApps: apps.length,
    yttApps: yttApps.length,
    pendingApps: pendingApps.length
  };
}

// =========================================================================
// API: DELETE LEAD ROW
// =========================================================================

function deleteLeadRow(rowIndex) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    
    if (!sheet) {
      throw new Error('Leads sheet not found');
    }
    
    // Validate row index
    if (!rowIndex || rowIndex < 2) {
      throw new Error('Invalid row index');
    }
    
    // Delete the row
    sheet.deleteRow(rowIndex);
    
    return { success: true, message: 'Lead deleted successfully' };
    
  } catch (error) {
    throw new Error('Failed to delete lead: ' + error.message);
  }
}

// =========================================================================
// API: DELETE APPLICATION ROW
// =========================================================================

function deleteApplicationRow(rowIndex) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Applications (RAW)');
    
    if (!sheet) {
      throw new Error('Applications sheet not found');
    }
    
    // Validate row index
    if (!rowIndex || rowIndex < 2) {
      throw new Error('Invalid row index');
    }
    
    // Delete the row
    sheet.deleteRow(rowIndex);
    
    return { success: true, message: 'Application deleted successfully' };
    
  } catch (error) {
    throw new Error('Failed to delete application: ' + error.message);
  }
}

// =========================================================================
// API: UPDATE LEAD FOLLOW-UP DATE
// =========================================================================

function updateLeadFollowup(rowIndex, date) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    
    if (!sheet) {
      throw new Error('Leads sheet not found');
    }
    
    // Find or create followup_date column
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colIndex = headers.indexOf('followup_date');
    
    if (colIndex === -1) {
      // Create the column
      colIndex = sheet.getLastColumn();
      sheet.getRange(1, colIndex + 1).setValue('followup_date');
    }
    
    // Update the cell
    sheet.getRange(rowIndex, colIndex + 1).setValue(date);
    
    return { success: true };
    
  } catch (error) {
    throw new Error('Failed to update follow-up: ' + error.message);
  }
}

// =========================================================================
// API: UPDATE LEAD LAST CONTACT
// =========================================================================

function updateLeadLastContact(rowIndex, date) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    
    if (!sheet) {
      throw new Error('Leads sheet not found');
    }
    
    // Find or create last_contact column
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colIndex = headers.indexOf('last_contact');
    
    if (colIndex === -1) {
      // Create the column
      colIndex = sheet.getLastColumn();
      sheet.getRange(1, colIndex + 1).setValue('last_contact');
    }
    
    // Update the cell
    sheet.getRange(rowIndex, colIndex + 1).setValue(date);
    
    return { success: true };
    
  } catch (error) {
    throw new Error('Failed to update last contact: ' + error.message);
  }
}

// =========================================================================
// API: INCREMENT CALL ATTEMPTS (No Answer)
// =========================================================================

function incrementCallAttempts(rowIndex) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    
    if (!sheet) {
      throw new Error('Leads sheet not found');
    }
    
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    // Find or create call_attempts column
    var attemptsCol = headers.indexOf('call_attempts');
    if (attemptsCol === -1) {
      attemptsCol = sheet.getLastColumn();
      sheet.getRange(1, attemptsCol + 1).setValue('call_attempts');
    }
    
    // Find or create status column
    var statusCol = headers.indexOf('status');
    if (statusCol === -1) {
      statusCol = sheet.getLastColumn();
      sheet.getRange(1, statusCol + 1).setValue('status');
    }
    
    // Find or create last_contact column
    var lastContactCol = headers.indexOf('last_contact');
    if (lastContactCol === -1) {
      lastContactCol = sheet.getLastColumn();
      sheet.getRange(1, lastContactCol + 1).setValue('last_contact');
    }
    
    // Get current attempts and increment
    var currentAttempts = parseInt(sheet.getRange(rowIndex, attemptsCol + 1).getValue()) || 0;
    var newAttempts = currentAttempts + 1;
    
    // Update call attempts
    sheet.getRange(rowIndex, attemptsCol + 1).setValue(newAttempts);
    
    // Set status to "Called (No Answer)"
    sheet.getRange(rowIndex, statusCol + 1).setValue('Called (No Answer)');
    
    // Update last contact date
    var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    sheet.getRange(rowIndex, lastContactCol + 1).setValue(today);
    
    return { success: true, attempts: newAttempts };
    
  } catch (error) {
    throw new Error('Failed to increment call attempts: ' + error.message);
  }
}

// =========================================================================
// API: SEND DAILY SUMMARY EMAIL
// =========================================================================

function sendDailySummary() {
  try {
    var leads = fetchLeadsForWebApp();
    var today = new Date().toISOString().split('T')[0];
    
    // Count new leads (last 24h)
    var yesterday = new Date(Date.now() - 24*60*60*1000).toISOString();
    var newLeads = leads.filter(function(l) {
      return l.timestamp && l.timestamp > yesterday;
    });
    
    // Count overdue follow-ups
    var overdue = leads.filter(function(l) {
      return l.followup_date && l.followup_date < today;
    });
    
    // Count due today
    var dueToday = leads.filter(function(l) {
      return l.followup_date && l.followup_date === today;
    });
    
    // Count hot leads
    var hot = leads.filter(function(l) {
      return String(l.status || '').toLowerCase() === 'strongly interested';
    });
    
    if (newLeads.length === 0 && overdue.length === 0 && dueToday.length === 0) {
      Logger.log('No summary needed - no new activity');
      return;
    }
    
    var subject = 'Yoga Bible Daily Summary - ' + today;
    var body = '<html><body style="font-family: Arial, sans-serif; max-width: 600px;">';
    body += '<h2 style="color: #f75c03;">Yoga Bible Lead Summary</h2>';
    body += '<p style="color: #666;">' + today + '</p>';
    
    body += '<div style="background: #f9fafb; padding: 20px; border-radius: 10px; margin: 20px 0;">';
    body += '<h3 style="margin: 0 0 15px 0;">Quick Stats</h3>';
    body += '<p><strong>' + newLeads.length + '</strong> new leads in last 24h</p>';
    body += '<p><strong>' + dueToday.length + '</strong> follow-ups due today</p>';
    body += '<p><strong style="color: #dc2626;">' + overdue.length + '</strong> overdue follow-ups</p>';
    body += '<p><strong style="color: #f59e0b;">' + hot.length + '</strong> hot leads</p>';
    body += '</div>';
    
    if (dueToday.length > 0) {
      body += '<h3>Due Today</h3><ul>';
      dueToday.slice(0, 10).forEach(function(l) {
        body += '<li><strong>' + (l.first_name || '') + ' ' + (l.last_name || '') + '</strong> - ' + (l.program || l.service || 'Unknown') + ' - <a href="mailto:' + (l.email || '') + '">' + (l.email || '') + '</a></li>';
      });
      if (dueToday.length > 10) body += '<li>...and ' + (dueToday.length - 10) + ' more</li>';
      body += '</ul>';
    }
    
    if (overdue.length > 0) {
      body += '<h3 style="color: #dc2626;">Overdue</h3><ul>';
      overdue.slice(0, 10).forEach(function(l) {
        body += '<li><strong>' + (l.first_name || '') + ' ' + (l.last_name || '') + '</strong> - Due: ' + l.followup_date + ' - <a href="mailto:' + (l.email || '') + '">' + (l.email || '') + '</a></li>';
      });
      if (overdue.length > 10) body += '<li>...and ' + (overdue.length - 10) + ' more</li>';
      body += '</ul>';
    }
    
    if (newLeads.length > 0) {
      body += '<h3>New Leads</h3><ul>';
      newLeads.slice(0, 10).forEach(function(l) {
        body += '<li><strong>' + (l.first_name || '') + ' ' + (l.last_name || '') + '</strong> - ' + (l.program || l.service || 'Unknown') + ' - ' + (l.email || '') + '</li>';
      });
      if (newLeads.length > 10) body += '<li>...and ' + (newLeads.length - 10) + ' more</li>';
      body += '</ul>';
    }
    
    body += '<p style="margin-top: 30px;"><a href="https://script.google.com/macros/s/AKfycbyhs4bfPcvcqaJRTmAlPTFf_uIOkFatZviKKO20nckBfGi78JqkNzy4FNpWztl7nQsSAA/exec?mode=app" style="background: #f75c03; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Open Lead Manager</a></p>';
    body += '</body></html>';
    
    // Send to admin email
    MailApp.sendEmail({
      to: CONFIG.EMAIL_ADMIN,
      subject: subject,
      htmlBody: body
    });
    
    Logger.log('Daily summary sent');
    return { success: true };
    
  } catch (error) {
    Logger.log('Failed to send summary: ' + error.message);
    throw error;
  }
}

// =========================================================================
// TRIGGER: Set up daily email (run once manually)
// =========================================================================

function setupDailyTrigger() {
  // Delete existing triggers
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sendDailySummary') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new trigger at 8 AM
  ScriptApp.newTrigger('sendDailySummary')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
  
  Logger.log('Daily trigger created for 8 AM');
}

// =========================================================================
// EMAIL TEMPLATES SYSTEM
// =========================================================================

/**
 * Initialize Email Templates sheet with starter templates
 * Run this once to set up the templates
 */
function initializeEmailTemplates() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  
  // Create or get Email Templates sheet
  var templatesSheet = ss.getSheetByName('Email Templates');
  if (!templatesSheet) {
    templatesSheet = ss.insertSheet('Email Templates');
  }
  
  // Set headers (expanded)
  var headers = ['template_id', 'name', 'category', 'style', 'segment_tags', 'subject', 'body_html', 'active'];
  templatesSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  templatesSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  
  // Starter templates with style and segments
  var templates = [
    // PERSONAL STYLE - sounds like 1-on-1 conversation
    [
      'personal_followup_chat',
      'Thanks for Our Chat',
      'followup',
      'personal',
      'all',
      'Following up on our conversation',
      getTemplate_PersonalFollowup(),
      'yes'
    ],
    [
      'personal_clarify',
      'Quick Clarification',
      'followup',
      'personal',
      'all',
      'I wanted to clarify something...',
      getTemplate_PersonalClarify(),
      'yes'
    ],
    
    // OBJECTION: DOUBT
    [
      'doubt_10_reasons',
      '10 Reasons to Become a Yoga Teacher',
      'objection_doubt',
      'newsletter',
      'doubt,new',
      'Why Becoming a Yoga Teacher Might Be Your Best Decision Yet',
      getTemplate_10Reasons(),
      'yes'
    ],
    
    // OBJECTION: MONEY
    [
      'money_payment_plans',
      'Flexible Payment Plans Available',
      'objection_money',
      'newsletter',
      'no_money,price_sensitive',
      'Making Your Yoga Teacher Training Affordable',
      getTemplate_PaymentPlans(),
      'yes'
    ],
    [
      'money_early_bird',
      'Early Bird Discount Reminder',
      'objection_money',
      'newsletter',
      'no_money,price_sensitive,hot',
      'Save 3,000 DKK on Your YTT - Limited Time',
      getTemplate_EarlyBird(),
      'yes'
    ],
    
    // OBJECTION: NO TIME
    [
      'time_flexible_formats',
      'Flexible Training Options',
      'objection_time',
      'newsletter',
      'no_time,busy,working_professional',
      'Yoga Teacher Training That Fits Your Life',
      getTemplate_FlexibleFormats(),
      'yes'
    ],
    [
      'time_working_parents',
      'Perfect for Busy Parents',
      'objection_time',
      'newsletter',
      'no_time,parents,busy',
      'How Our Students Balance Training with Family Life',
      getTemplate_WorkingParents(),
      'yes'
    ],
    
    // OBJECTION: TOO FAR / LOCATION
    [
      'location_train_time',
      'Make Your Commute Count',
      'objection_location',
      'newsletter',
      'too_far,commute',
      'Turn Travel Time into Study Time',
      getTemplate_TrainTime(),
      'yes'
    ],
    [
      'location_online_option',
      'Online Training Available',
      'objection_location',
      'newsletter',
      'too_far,online,remote',
      'Train from Anywhere - Our Online YTT Option',
      getTemplate_OnlineOption(),
      'yes'
    ],
    
    // FOLLOW-UP
    [
      'followup_nice_chat',
      'Great Talking to You',
      'followup',
      'personal',
      'called,meeting',
      'Thanks for Chatting - Your Next Steps',
      getTemplate_NiceChat(),
      'yes'
    ],
    [
      'followup_no_answer',
      'Sorry I Missed You',
      'followup',
      'personal',
      'no_answer',
      'I tried calling - here\'s another way to reach me',
      getTemplate_MissedCall(),
      'yes'
    ],
    
    // PROMO / URGENCY
    [
      'promo_last_chance',
      'Last Spots Available',
      'promo',
      'newsletter',
      'hot,interested',
      'Only a Few Spots Left for {{cohort}}',
      getTemplate_LastChance(),
      'yes'
    ],
    
    // INFO
    [
      'info_copenhagen',
      'Why Train in Copenhagen',
      'info',
      'newsletter',
      'international,housing',
      'Discover Why Copenhagen is Perfect for Your YTT',
      getTemplate_Copenhagen(),
      'yes'
    ],
    [
      'info_housing',
      'Accommodation Options',
      'info',
      'newsletter',
      'housing,international',
      'Your Home Away from Home During YTT',
      getTemplate_Housing(),
      'yes'
    ]
  ];
  
  // Clear and add templates
  if (templatesSheet.getLastRow() > 1) {
    templatesSheet.getRange(2, 1, templatesSheet.getLastRow() - 1, headers.length).clearContent();
  }
  templatesSheet.getRange(2, 1, templates.length, templates[0].length).setValues(templates);
  
  // Create Email Log sheet
  var logSheet = ss.getSheetByName('Email Log');
  if (!logSheet) {
    logSheet = ss.insertSheet('Email Log');
    var logHeaders = ['timestamp', 'lead_email', 'lead_name', 'template_id', 'template_name', 'subject', 'sent_by', 'lead_row_index', 'style', 'campaign_id'];
    logSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]);
    logSheet.getRange(1, 1, 1, logHeaders.length).setFontWeight('bold');
  }
  
  // Create Email Queue sheet (for scheduled emails)
  var queueSheet = ss.getSheetByName('Email Queue');
  if (!queueSheet) {
    queueSheet = ss.insertSheet('Email Queue');
    var queueHeaders = ['queue_id', 'lead_email', 'lead_name', 'lead_row_index', 'template_id', 'template_name', 'scheduled_for', 'status', 'created_at', 'sent_at', 'error'];
    queueSheet.getRange(1, 1, 1, queueHeaders.length).setValues([queueHeaders]);
    queueSheet.getRange(1, 1, 1, queueHeaders.length).setFontWeight('bold');
  }
  
  // Set column widths
  templatesSheet.setColumnWidth(1, 180);
  templatesSheet.setColumnWidth(2, 250);
  templatesSheet.setColumnWidth(3, 120);
  templatesSheet.setColumnWidth(4, 100);
  templatesSheet.setColumnWidth(5, 200);
  templatesSheet.setColumnWidth(6, 300);
  templatesSheet.setColumnWidth(7, 500);
  
  Logger.log('Email Templates initialized with ' + templates.length + ' templates');
  return 'Success! Created ' + templates.length + ' templates + Email Queue sheet';
}

/**
 * Schedule an email for later sending
 */
function scheduleEmail(leadRowIndex, templateId, leadData, scheduledFor) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var queueSheet = ss.getSheetByName('Email Queue');
    
    if (!queueSheet) {
      // Try to create it
      queueSheet = ss.insertSheet('Email Queue');
      var queueHeaders = ['queue_id', 'lead_email', 'lead_name', 'lead_row_index', 'template_id', 'template_name', 'scheduled_for', 'status', 'created_at', 'sent_at', 'error'];
      queueSheet.getRange(1, 1, 1, queueHeaders.length).setValues([queueHeaders]);
      queueSheet.getRange(1, 1, 1, queueHeaders.length).setFontWeight('bold');
      Logger.log('Created Email Queue sheet');
    }
    
    // Get template name
    var template = getTemplateById(templateId);
    if (!template) throw new Error('Template not found');
    
    // Convert preset options to actual datetime
    var scheduledDate = new Date();
    if (scheduledFor === '30min') {
      scheduledDate.setMinutes(scheduledDate.getMinutes() + 30);
    } else if (scheduledFor === '2hours') {
      scheduledDate.setHours(scheduledDate.getHours() + 2);
    } else if (scheduledFor === 'tomorrow9am') {
      scheduledDate.setDate(scheduledDate.getDate() + 1);
      scheduledDate.setHours(9, 0, 0, 0);
    } else if (scheduledFor === '1hour') {
      // Legacy support
      scheduledDate.setHours(scheduledDate.getHours() + 1);
    } else if (scheduledFor === '24hours') {
      // Legacy support
      scheduledDate.setHours(scheduledDate.getHours() + 24);
    } else {
      // Assume it's a datetime string
      scheduledDate = new Date(scheduledFor);
    }
    
    var scheduledForStr = Utilities.formatDate(scheduledDate, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    
    var queueId = 'Q' + new Date().getTime();
    var leadName = ((leadData.first_name || '') + ' ' + (leadData.last_name || '')).trim();
    var now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    
    queueSheet.appendRow([
      queueId,
      leadData.email,
      leadName,
      leadRowIndex,
      templateId,
      template.name,
      scheduledForStr,
      'pending',
      now,
      '',
      ''
    ]);
    
    // Add note to lead about scheduled email
    var formattedDate = Utilities.formatDate(scheduledDate, CONFIG.TIMEZONE, 'MMM d, HH:mm');
    addLeadNote(leadRowIndex, '⏰ Scheduled: "' + template.name + '" for ' + formattedDate);
    
    return { success: true, queueId: queueId, scheduledFor: formattedDate };
    
  } catch (error) {
    Logger.log('Schedule email error: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Process email queue - run this on a time trigger (every 15 min)
 * Handles both template emails and custom emails
 */
function processEmailQueue() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var queueSheet = ss.getSheetByName('Email Queue');
  
  if (!queueSheet || queueSheet.getLastRow() < 2) return;
  
  var data = queueSheet.getDataRange().getValues();
  var headers = data[0];
  var now = new Date();
  var processed = 0;
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = row[7]; // status column
    var scheduledFor = row[6]; // scheduled_for column
    
    if (status !== 'pending') continue;
    
    var scheduledDate = new Date(scheduledFor);
    if (scheduledDate > now) continue; // Not yet time
    
    // Time to send!
    var leadEmail = row[1];
    var leadRowIndex = row[3];
    var templateId = row[4];
    
    // Get lead data
    var leadData = getLeadByRowIndex(leadRowIndex);
    if (!leadData) {
      queueSheet.getRange(i + 1, 8).setValue('failed');
      queueSheet.getRange(i + 1, 11).setValue('Lead not found');
      continue;
    }
    
    var result;
    
    // Check if this is a custom email or template email
    if (templateId === 'CUSTOM') {
      // Custom email - get subject and body from columns 12 and 13
      var customSubject = row[11] || '';
      var customBody = row[12] || '';
      
      if (!customSubject || !customBody) {
        queueSheet.getRange(i + 1, 8).setValue('failed');
        queueSheet.getRange(i + 1, 11).setValue('Missing custom email data');
        continue;
      }
      
      result = sendCustomEmailDirect(customSubject, customBody, leadData);
    } else {
      // Template email
      result = sendTemplateEmailDirect(templateId, leadData);
    }
    
    if (result.success) {
      queueSheet.getRange(i + 1, 8).setValue('sent');
      queueSheet.getRange(i + 1, 10).setValue(Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'));
      processed++;
    } else {
      queueSheet.getRange(i + 1, 8).setValue('failed');
      queueSheet.getRange(i + 1, 11).setValue(result.error);
    }
    
    // Rate limiting
    Utilities.sleep(1000);
  }
  
  Logger.log('Processed ' + processed + ' queued emails');
  return processed;
}

/**
 * Setup time trigger for processing email queue
 * Run this once to enable scheduled email sending
 */
function setupEmailQueueTrigger() {
  // First, delete any existing triggers for this function
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processEmailQueue') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Create new trigger - runs every 15 minutes
  ScriptApp.newTrigger('processEmailQueue')
    .timeBased()
    .everyMinutes(15)
    .create();
  
  Logger.log('Email queue trigger created - will check every 15 minutes');
  return 'Email queue trigger created! Scheduled emails will be processed every 15 minutes.';
}

/**
 * Check if email queue trigger is set up
 */
function checkEmailQueueTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processEmailQueue') {
      return { 
        exists: true, 
        message: 'Email queue trigger is active. Scheduled emails will be processed every 15 minutes.' 
      };
    }
  }
  return { 
    exists: false, 
    message: 'Email queue trigger not found. Run setupEmailQueueTrigger() to enable scheduled emails.' 
  };
}

/**
 * Get a template by ID
 */
function getTemplateById(templateId) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Email Templates');
  if (!sheet) return null;
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === templateId) {
      var template = {};
      for (var j = 0; j < headers.length; j++) {
        template[headers[j]] = data[i][j];
      }
      return template;
    }
  }
  return null;
}

/**
 * Get lead by row index
 */
function getLeadByRowIndex(rowIndex) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Leads (RAW)');
  if (!sheet) return null;
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  var lead = {};
  for (var i = 0; i < headers.length; i++) {
    lead[headers[i]] = row[i];
  }
  lead.rowIndex = rowIndex;
  
  return lead;
}

/**
 * Send email directly (without logging to lead notes - used by queue)
 */
function sendTemplateEmailDirect(templateId, leadData) {
  try {
    var template = getTemplateById(templateId);
    if (!template) throw new Error('Template not found');
    
    var subject = personalizeContent(template.subject, leadData);
    var body = personalizeContent(template.body_html, leadData);

    // Append unsubscribe footer
    var unsubUrl = buildUnsubscribeUrl(leadData.email);
    body += '<div style="text-align:center;padding:20px 0 10px;border-top:1px solid #eee;margin-top:30px;">' +
      '<p style="font-size:11px;color:#999;margin:0;"><a href="' + unsubUrl + '" style="color:#999;text-decoration:underline;">Afmeld nyhedsbrev</a></p></div>';

    GmailApp.sendEmail(leadData.email, subject, '', {
      htmlBody: body,
      name: CONFIG.SENDER_NAME || 'Yoga Bible'
    });

    // Log the email
    logEmailSent(leadData, template, subject);
    
    return { success: true };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Log email to Email Log sheet
 */
function logEmailSent(leadData, template, subject, campaignId) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var logSheet = ss.getSheetByName('Email Log');
  if (!logSheet) return;
  
  var timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var leadName = ((leadData.first_name || '') + ' ' + (leadData.last_name || '')).trim();
  
  logSheet.appendRow([
    timestamp,
    leadData.email,
    leadName,
    template.template_id,
    template.name,
    subject,
    Session.getActiveUser().getEmail(),
    leadData.rowIndex || '',
    template.style || 'newsletter',
    campaignId || ''
  ]);
}

/**
 * Get leads matching segment filters
 */
function getLeadsForSegment(filters) {
  var leads = fetchLeadsForWebApp();
  var now = new Date();
  
  return leads.filter(function(lead) {
    // Status filter
    if (filters.statuses && filters.statuses.length > 0) {
      var st = String(lead.status || '').toLowerCase();
      var matched = filters.statuses.some(function(s) {
        if (s === 'new') return st === 'new' || st === '';
        if (s === 'no_answer') return st.includes('no answer');
        if (s === 'hot') return st === 'strongly interested';
        if (s === 'contacted') return st === 'contacted';
        if (s === 'called') return st === 'called' && !st.includes('no answer');
        if (s === 'follow_up') return st === 'follow up';
        if (s === 'not_interested') return st === 'not interested';
        return st.includes(s.replace('_', ' '));
      });
      if (!matched) return false;
    }
    
    // Program/Type filter - YTT formats
    if (filters.programs && filters.programs.length > 0) {
      var prog = String(lead.program || lead.ytt_program_top_program || lead.service || '').toLowerCase();
      
      var matched = filters.programs.some(function(p) {
        // For YTT formats, check program text (English and Danish)
        if (p === '4-week') return prog.includes('4-week') || prog.includes('4 ugers') || prog.includes('4-uge');
        if (p === '8-week') return prog.includes('8-week') || prog.includes('8 ugers') || prog.includes('8-uge');
        if (p === '18-week') return prog.includes('18-week') || prog.includes('18 ugers') || prog.includes('18-uge');
        return prog.includes(p.toLowerCase());
      });
      if (!matched) return false;
    }
    
    // Subtype filter - Courses (inversions, backbends, splits) and Mentorship
    if (filters.subtypes && filters.subtypes.length > 0) {
      var prog = String(lead.program || lead.ytt_program_top_program || '').toLowerCase();
      var svc = String(lead.service || '').toLowerCase();
      var sub = String(lead.subcategories || '').toLowerCase();
      var type = String(lead.type || 'ytt').toLowerCase();
      
      var matched = filters.subtypes.some(function(s) {
        // Course types
        if (s === 'inversions') return sub.includes('inversion') || svc.includes('inversion') || prog.includes('inversion');
        if (s === 'backbends') return sub.includes('backbend') || svc.includes('backbend') || prog.includes('backbend');
        if (s === 'splits') return sub.includes('split') || svc.includes('split') || prog.includes('split');
        if (s === 'bundles') return sub.includes('bundle') || svc.includes('bundle') || prog.includes('bundle');
        // Mentorship types
        if (s === 'personlig') return svc.includes('personlig') || type === 'mentorship';
        if (s === 'undervisning') return svc.includes('undervisning');
        if (s === 'business') return svc.includes('business');
        return false;
      });
      if (!matched) return false;
    }
    
    // Period filter
    if (filters.periods && filters.periods.length > 0) {
      var period = String(lead.cohort_label || lead.preferred_month || '').toLowerCase();
      var matched = filters.periods.some(function(p) {
        return period.includes(p.toLowerCase());
      });
      if (!matched) return false;
    }
    
    // Housing filter
    if (filters.housing === true) {
      var housing = String(lead.accommodation || '').toLowerCase();
      if (housing !== 'yes') return false;
    }
    
    // Country filter (NEW) - check source code and phone prefix
    if (filters.countries && filters.countries.length > 0) {
      var source = String(lead.source || '').toUpperCase();
      var phone = String(lead.phone || '').replace(/\s/g, '');
      var country = detectCountryBackend(source, phone);
      if (!filters.countries.includes(country)) return false;
    }
    
    // Source filter
    if (filters.sources && filters.sources.length > 0) {
      var source = String(lead.source || '').toLowerCase();
      var matched = filters.sources.some(function(s) {
        return source.includes(s.toLowerCase());
      });
      if (!matched) return false;
    }
    
    // Days range filter
    if (filters.daysRange) {
      var timestamp = lead.timestamp ? new Date(lead.timestamp) : null;
      if (timestamp) {
        var daysSince = Math.floor((now - timestamp) / (1000 * 60 * 60 * 24));
        if (filters.daysRange === '7' && daysSince > 7) return false;
        if (filters.daysRange === '30' && daysSince > 30) return false;
        if (filters.daysRange === '90' && daysSince > 90) return false;
        if (filters.daysRange === 'older' && daysSince < 30) return false;
      }
    }
    
    // Exclude converted
    if (filters.excludeConverted === true) {
      var converted = String(lead.converted || '').toLowerCase();
      if (converted === 'yes' || converted === 'true') return false;
    }
    
    return true;
  });
}

/**
 * Detect country from source code or phone prefix
 */
function detectCountryBackend(source, phone) {
  var src = source.toUpperCase();
  var ph = phone.replace(/\s/g, '');
  
  // Check source for country codes like "- DA -", "- SE -", etc.
  if (src.indexOf('- DA ') > -1 || src.indexOf('- DA-') > -1 || src.indexOf(' DA:') > -1 || src.endsWith('- DA')) return 'DA';
  if (src.indexOf('- SE ') > -1 || src.indexOf('- SE-') > -1 || src.indexOf(' SE:') > -1 || src.endsWith('- SE')) return 'SE';
  if (src.indexOf('- NO ') > -1 || src.indexOf('- NO-') > -1 || src.indexOf(' NO:') > -1 || src.endsWith('- NO')) return 'NO';
  if (src.indexOf('- DE ') > -1 || src.indexOf('- DE-') > -1 || src.indexOf(' DE:') > -1 || src.endsWith('- DE')) return 'DE';
  if (src.indexOf('- NL ') > -1 || src.indexOf('- NL-') > -1 || src.indexOf(' NL:') > -1 || src.endsWith('- NL')) return 'NL';
  if (src.indexOf('- FI ') > -1 || src.indexOf('- FI-') > -1 || src.indexOf(' FI:') > -1 || src.endsWith('- FI')) return 'FI';
  if (src.indexOf('- EN ') > -1 || src.indexOf('- EN-') > -1 || src.indexOf(' EN:') > -1 || src.endsWith('- EN')) return 'EN';
  
  // Check phone prefix
  if (ph.indexOf('+45') === 0 || ph.indexOf('0045') === 0) return 'DA';
  if (ph.indexOf('+46') === 0 || ph.indexOf('0046') === 0) return 'SE';
  if (ph.indexOf('+47') === 0 || ph.indexOf('0047') === 0) return 'NO';
  if (ph.indexOf('+49') === 0 || ph.indexOf('0049') === 0) return 'DE';
  if (ph.indexOf('+31') === 0 || ph.indexOf('0031') === 0) return 'NL';
  if (ph.indexOf('+358') === 0 || ph.indexOf('00358') === 0) return 'FI';
  if (ph.indexOf('+44') === 0 || ph.indexOf('+1') === 0 || ph.indexOf('+353') === 0) return 'EN';
  
  // If phone is 8 digits (Danish format without prefix)
  if (ph.length === 8 && /^\d+$/.test(ph)) return 'DA';
  
  return 'OTHER';
}

/**
 * Send bulk email to segment
 */
function sendBulkToSegment(filters, templateId, scheduleOption) {
  var leads = getLeadsForSegment(filters);
  var results = { total: leads.length, scheduled: 0, sent: 0, failed: 0, errors: [] };
  
  if (leads.length === 0) {
    return { success: false, error: 'No leads match the selected filters' };
  }
  
  var template = getTemplateById(templateId);
  if (!template) {
    return { success: false, error: 'Template not found' };
  }
  
  // Calculate scheduled time based on option
  var scheduledFor = new Date();
  var isImmediate = scheduleOption === 'now' || !scheduleOption;
  
  if (scheduleOption === '30min') {
    scheduledFor.setMinutes(scheduledFor.getMinutes() + 30);
  } else if (scheduleOption === '2hours') {
    scheduledFor.setHours(scheduledFor.getHours() + 2);
  } else if (scheduleOption === 'tomorrow9am') {
    scheduledFor.setDate(scheduledFor.getDate() + 1);
    scheduledFor.setHours(9, 0, 0, 0);
  } else if (scheduleOption === '1hour') {
    // Legacy support
    scheduledFor.setHours(scheduledFor.getHours() + 1);
  } else if (scheduleOption === '24hours') {
    // Legacy support
    scheduledFor.setHours(scheduledFor.getHours() + 24);
  } else if (scheduleOption && scheduleOption !== 'now') {
    // Custom datetime string
    scheduledFor = new Date(scheduleOption);
  }
  
  var scheduledForStr = Utilities.formatDate(scheduledFor, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  
  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    
    if (isImmediate) {
      // Send now
      var result = sendTemplateEmailDirect(templateId, lead);
      if (result.success) {
        results.sent++;
        // Add note to lead
        addLeadNote(lead.rowIndex, 'Email Sent: "' + template.name + '"');
      } else {
        results.failed++;
        results.errors.push(lead.email + ': ' + result.error);
      }
      Utilities.sleep(1000); // Rate limit
    } else {
      // Schedule for later
      var schedResult = scheduleEmail(lead.rowIndex, templateId, lead, scheduledForStr);
      if (schedResult.success) {
        results.scheduled++;
      } else {
        results.failed++;
        results.errors.push(lead.email + ': ' + schedResult.error);
      }
    }
  }
  
  return { success: true, results: results };
}

/**
 * Send custom email to test (to the owner's email)
 */
function sendCustomTestEmail(subject, bodyHtml, sampleLead, testEmail, attachment) {
  try {
    var recipientEmail = testEmail || Session.getActiveUser().getEmail();
    if (!recipientEmail) {
      return { success: false, error: 'No test email address provided' };
    }

    // Personalize the email
    var personalizedSubject = personalizeContent(subject, sampleLead);
    var personalizedBody = personalizeContent(bodyHtml, sampleLead);

    // Append unsubscribe footer
    var unsubUrl = buildUnsubscribeUrl(sampleLead.email || recipientEmail);
    personalizedBody += '<div style="text-align:center;padding:20px 0 10px;">' +
      '<p style="font-size:11px;color:#999;margin:0;"><a href="' + unsubUrl + '" style="color:#999;text-decoration:underline;">Afmeld nyhedsbrev</a></p></div>';

    // Wrap in simple HTML template for deliverability
    var fullHtml = buildEmailHtml(personalizedBody, sampleLead);

    var emailOptions = {
      htmlBody: fullHtml,
      name: 'Yoga Bible'
    };

    if (attachment && attachment.data) {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(attachment.data),
        attachment.type,
        attachment.name
      );
      emailOptions.attachments = [blob];
    }

    GmailApp.sendEmail(recipientEmail, '[TEST] ' + personalizedSubject,
      personalizedBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      emailOptions
    );

    return { success: true, sentTo: recipientEmail };

  } catch (error) {
    Logger.log('sendCustomTestEmail error: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send custom email to a segment of leads
 */
function sendCustomBulkToSegment(filters, subject, bodyHtml, scheduleOption) {
  var leads = getLeadsForSegment(filters);
  var results = { total: leads.length, scheduled: 0, sent: 0, failed: 0, errors: [] };
  
  if (leads.length === 0) {
    return { success: false, error: 'No leads match the selected filters' };
  }
  
  // Calculate scheduled time based on option
  var scheduledFor = new Date();
  var isImmediate = scheduleOption === 'now' || !scheduleOption;
  
  if (scheduleOption === '30min') {
    scheduledFor.setMinutes(scheduledFor.getMinutes() + 30);
  } else if (scheduleOption === '2hours') {
    scheduledFor.setHours(scheduledFor.getHours() + 2);
  } else if (scheduleOption === 'tomorrow9am') {
    scheduledFor.setDate(scheduledFor.getDate() + 1);
    scheduledFor.setHours(9, 0, 0, 0);
  } else if (scheduleOption && scheduleOption !== 'now') {
    scheduledFor = new Date(scheduleOption);
  }
  
  var scheduledForStr = Utilities.formatDate(scheduledFor, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  
  // Get a truncated version of subject for notes
  var subjectShort = subject.length > 30 ? subject.substring(0, 30) + '...' : subject;
  
  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    
    if (isImmediate) {
      // Send now
      var result = sendCustomEmailDirect(subject, bodyHtml, lead);
      if (result.success) {
        results.sent++;
        addLeadNote(lead.rowIndex, 'Email Sent: "' + subjectShort + '"');
      } else {
        results.failed++;
        results.errors.push(lead.email + ': ' + result.error);
      }
      Utilities.sleep(1000); // Rate limit
    } else {
      // Schedule for later - store custom email in queue with special template_id
      var schedResult = scheduleCustomEmail(lead.rowIndex, subject, bodyHtml, lead, scheduledForStr);
      if (schedResult.success) {
        results.scheduled++;
      } else {
        results.failed++;
        results.errors.push(lead.email + ': ' + schedResult.error);
      }
    }
  }
  
  return { success: true, results: results };
}

/**
 * Send a custom email directly (not from template)
 */
function sendCustomEmailDirect(subject, bodyHtml, leadData) {
  try {
    if (!leadData.email) {
      return { success: false, error: 'No email address' };
    }
    
    // Personalize the email
    var personalizedSubject = personalizeEmailContent(subject, leadData);
    var personalizedBody = personalizeEmailContent(bodyHtml, leadData);

    // Append unsubscribe footer
    var unsubUrl = buildUnsubscribeUrl(leadData.email);
    personalizedBody += '<div style="text-align:center;padding:20px 0 10px;">' +
      '<p style="font-size:11px;color:#999;margin:0;"><a href="' + unsubUrl + '" style="color:#999;text-decoration:underline;">Afmeld nyhedsbrev</a></p></div>';

    // Build full HTML with proper formatting for deliverability
    var fullHtml = buildEmailHtml(personalizedBody, leadData);
    
    // Plain text fallback
    var plainText = personalizedBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
    GmailApp.sendEmail(leadData.email, personalizedSubject, plainText, {
      htmlBody: fullHtml,
      name: 'Yoga Bible',
      replyTo: 'hello@yogabible.dk'
    });
    
    // Log to email history
    logEmailSent(leadData.email, 'custom', subject, personalizedSubject);
    
    return { success: true };
    
  } catch (error) {
    Logger.log('sendCustomEmailDirect error: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Schedule a custom email for later sending
 */
function scheduleCustomEmail(leadRowIndex, subject, bodyHtml, leadData, scheduledFor) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var queueSheet = ss.getSheetByName('Email Queue');
    
    if (!queueSheet) {
      queueSheet = ss.insertSheet('Email Queue');
      var queueHeaders = ['queue_id', 'lead_email', 'lead_name', 'lead_row_index', 'template_id', 'template_name', 'scheduled_for', 'status', 'created_at', 'sent_at', 'error', 'custom_subject', 'custom_body'];
      queueSheet.getRange(1, 1, 1, queueHeaders.length).setValues([queueHeaders]);
      queueSheet.getRange(1, 1, 1, queueHeaders.length).setFontWeight('bold');
    }
    
    var queueId = 'Q' + new Date().getTime() + Math.random().toString(36).substring(2, 5);
    var leadName = ((leadData.first_name || '') + ' ' + (leadData.last_name || '')).trim();
    var now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    var subjectShort = subject.length > 30 ? subject.substring(0, 30) + '...' : subject;
    
    // Store custom email data in extra columns
    queueSheet.appendRow([
      queueId,
      leadData.email,
      leadName,
      leadRowIndex,
      'CUSTOM', // Special template_id for custom emails
      subjectShort,
      scheduledFor,
      'pending',
      now,
      '',
      '',
      subject,    // Full subject in column 12
      bodyHtml    // Full body in column 13
    ]);
    
    // Add note to lead
    var scheduledDate = new Date(scheduledFor);
    var formattedDate = Utilities.formatDate(scheduledDate, CONFIG.TIMEZONE, 'MMM d, HH:mm');
    addLeadNote(leadRowIndex, '⏰ Scheduled: "' + subjectShort + '" for ' + formattedDate);
    
    return { success: true, queueId: queueId, scheduledFor: formattedDate };
    
  } catch (error) {
    Logger.log('scheduleCustomEmail error: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Build email HTML with proper structure for deliverability
 * Follows anti-spam best practices
 */
function buildEmailHtml(bodyContent, leadData) {
  var firstName = leadData.first_name || 'there';
  
  // Clean, simple HTML structure - avoid spam triggers
  var html = '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#333333;background-color:#ffffff;">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:0 auto;padding:20px;">' +
    '<tr><td style="padding:20px;">' +
    bodyContent +
    '</td></tr>' +
    '<tr><td style="padding:20px;font-size:12px;color:#888888;border-top:1px solid #eeeeee;margin-top:30px;">' +
    '<p style="margin:0 0 10px;">Best regards,<br>Yoga Bible Team</p>' +
    '<p style="margin:0;font-size:11px;color:#999999;">' +
    'Yoga Bible • Copenhagen, Denmark<br>' +
    '<a href="https://yogabible.dk" style="color:#f75c03;">yogabible.dk</a>' +
    '</p>' +
    '</td></tr>' +
    '</table>' +
    '</body></html>';
  
  return html;
}

/**
 * Get email queue status - pending scheduled emails
 */
function getEmailQueueStatus() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var queueSheet = ss.getSheetByName('Email Queue');
  
  if (!queueSheet || queueSheet.getLastRow() < 2) {
    return { pending: 0, emails: [] };
  }
  
  var data = queueSheet.getDataRange().getValues();
  var pending = [];
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][7] === 'pending') { // status column
      pending.push({
        queueId: data[i][0],
        email: data[i][1],
        name: data[i][2],
        templateName: data[i][5],
        scheduledFor: data[i][6],
        createdAt: data[i][8]
      });
    }
  }
  
  return { 
    pending: pending.length, 
    emails: pending,
    triggerStatus: checkEmailQueueTrigger()
  };
}

/**
 * Cancel a scheduled email
 */
function cancelScheduledEmail(queueId) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var queueSheet = ss.getSheetByName('Email Queue');
  
  if (!queueSheet) return { success: false, error: 'Email Queue sheet not found' };
  
  var data = queueSheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === queueId && data[i][7] === 'pending') {
      queueSheet.getRange(i + 1, 8).setValue('cancelled');
      return { success: true };
    }
  }
  
  return { success: false, error: 'Scheduled email not found or already processed' };
}

/**
 * Send a test campaign email to yourself
 */
function sendTestCampaignEmail(templateId, sampleLead, testEmail, attachment) {
  try {
    var template = getTemplateById(templateId);
    if (!template) throw new Error('Template not found');

    var recipientEmail = testEmail || Session.getActiveUser().getEmail();
    if (!recipientEmail) throw new Error('No test email address provided');

    // Personalize content with sample lead data
    var subject = '[TEST] ' + personalizeContent(template.subject, sampleLead);
    var body = personalizeContent(template.body_html, sampleLead);

    // Add test banner to body
    var testBanner = '<div style="background:#fef3c7;padding:15px;text-align:center;font-family:sans-serif;border-bottom:2px solid #f59e0b;">' +
      '<strong style="color:#b45309;">TEST EMAIL</strong><br>' +
      '<span style="font-size:12px;color:#78350f;">This is how your campaign will look. Sent to: ' + recipientEmail + '</span>' +
      '</div>';
    body = body.replace('<body', '<body').replace('>', '>' + testBanner);

    // Append unsubscribe footer
    var unsubUrl = buildUnsubscribeUrl(sampleLead.email || recipientEmail);
    body += '<div style="text-align:center;padding:20px 0 10px;border-top:1px solid #eee;margin-top:30px;">' +
      '<p style="font-size:11px;color:#999;margin:0;"><a href="' + unsubUrl + '" style="color:#999;text-decoration:underline;">Afmeld nyhedsbrev</a></p></div>';

    var emailOptions = {
      htmlBody: body,
      name: CONFIG.SENDER_NAME || 'Yoga Bible'
    };

    if (attachment && attachment.data) {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(attachment.data),
        attachment.type,
        attachment.name
      );
      emailOptions.attachments = [blob];
    }

    // Send to test recipient
    GmailApp.sendEmail(recipientEmail, subject, '', emailOptions);

    return { success: true, sentTo: recipientEmail };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get pending scheduled emails count
 */
function getPendingEmailCount() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var queueSheet = ss.getSheetByName('Email Queue');
  if (!queueSheet || queueSheet.getLastRow() < 2) return 0;
  
  var data = queueSheet.getDataRange().getValues();
  var count = 0;
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][7] === 'pending') count++;
  }
  
  return count;
}

/**
 * Get all email templates for the web app
 */
function getEmailTemplates() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Email Templates');
  
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var templates = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var template = {};
    for (var j = 0; j < headers.length; j++) {
      template[headers[j]] = row[j];
    }
    if (template.active === 'yes') {
      templates.push(template);
    }
  }
  
  return templates;
}

/**
 * Send email to a lead using a template
 */
function sendTemplateEmail(leadRowIndex, templateId, leadData) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    
    // Get template
    var templatesSheet = ss.getSheetByName('Email Templates');
    if (!templatesSheet) throw new Error('Email Templates sheet not found');
    
    var templatesData = templatesSheet.getDataRange().getValues();
    var headers = templatesData[0];
    var template = null;
    
    for (var i = 1; i < templatesData.length; i++) {
      if (templatesData[i][0] === templateId) {
        template = {};
        for (var j = 0; j < headers.length; j++) {
          template[headers[j]] = templatesData[i][j];
        }
        break;
      }
    }
    
    if (!template) throw new Error('Template not found: ' + templateId);
    
    // Personalize content
    var subject = personalizeContent(template.subject, leadData);
    var body = personalizeContent(template.body_html, leadData);

    // Append unsubscribe footer
    var unsubUrl = buildUnsubscribeUrl(leadData.email);
    body += '<div style="text-align:center;padding:20px 0 10px;border-top:1px solid #eee;margin-top:30px;">' +
      '<p style="font-size:11px;color:#999;margin:0;"><a href="' + unsubUrl + '" style="color:#999;text-decoration:underline;">Afmeld nyhedsbrev</a></p></div>';

    // Send email
    GmailApp.sendEmail(leadData.email, subject, '', {
      htmlBody: body,
      name: CONFIG.SENDER_NAME || 'Yoga Bible'
    });

    // Log the email
    var logSheet = ss.getSheetByName('Email Log');
    if (!logSheet) {
      logSheet = ss.insertSheet('Email Log');
      logSheet.getRange(1, 1, 1, 8).setValues([['timestamp', 'lead_email', 'lead_name', 'template_id', 'template_name', 'subject', 'sent_by', 'lead_row_index']]);
    }
    
    var timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    var leadName = (leadData.first_name || '') + ' ' + (leadData.last_name || '');
    logSheet.appendRow([timestamp, leadData.email, leadName.trim(), templateId, template.name, subject, Session.getActiveUser().getEmail(), leadRowIndex]);
    
    // Add note to lead
    addLeadNote(leadRowIndex, 'Email Sent: "' + template.name + '"');
    
    return { success: true, message: 'Email sent to ' + leadData.email };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send template email to multiple leads (bulk)
 */
function sendBulkTemplateEmail(leadRowIndices, templateId) {
  var results = { sent: 0, failed: 0, errors: [] };
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var leadsSheet = ss.getSheetByName('Leads (RAW)');
  var headers = leadsSheet.getRange(1, 1, 1, leadsSheet.getLastColumn()).getValues()[0];
  
  for (var i = 0; i < leadRowIndices.length; i++) {
    var rowIndex = leadRowIndices[i];
    var rowData = leadsSheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    
    var leadData = {};
    for (var j = 0; j < headers.length; j++) {
      leadData[headers[j]] = rowData[j];
    }
    
    var result = sendTemplateEmail(rowIndex, templateId, leadData);
    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push(leadData.email + ': ' + result.error);
    }
    
    // Rate limiting - wait 1 second between emails
    Utilities.sleep(1000);
  }
  
  return results;
}

/**
 * Get email history for a lead
 */
function getEmailHistory(leadEmail) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var logSheet = ss.getSheetByName('Email Log');
  
  if (!logSheet || logSheet.getLastRow() < 2) {
    return [];
  }
  
  var data = logSheet.getDataRange().getValues();
  var headers = data[0];
  var history = [];
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] && data[i][1].toString().toLowerCase() === leadEmail.toLowerCase()) {
      var entry = {};
      for (var j = 0; j < headers.length; j++) {
        entry[headers[j]] = data[i][j];
      }
      history.push(entry);
    }
  }
  
  // Sort by timestamp descending
  history.sort(function(a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
  
  return history;
}

/**
 * Personalize email content with lead data
 */
function personalizeContent(content, leadData) {
  var text = content;
  
  // Replace placeholders
  text = text.replace(/\{\{first_name\}\}/gi, leadData.first_name || 'there');
  text = text.replace(/\{\{last_name\}\}/gi, leadData.last_name || '');
  text = text.replace(/\{\{name\}\}/gi, ((leadData.first_name || '') + ' ' + (leadData.last_name || '')).trim() || 'there');
  text = text.replace(/\{\{email\}\}/gi, leadData.email || '');
  text = text.replace(/\{\{phone\}\}/gi, leadData.phone || '');
  text = text.replace(/\{\{program\}\}/gi, leadData.program || leadData.service || 'our yoga teacher training');
  text = text.replace(/\{\{cohort\}\}/gi, leadData.cohort_label || leadData.preferred_month || 'the upcoming program');
  text = text.replace(/\{\{city\}\}/gi, leadData.city_country || '');
  
  return text;
}

// =========================================================================
// EMAIL TEMPLATE CONTENT
// =========================================================================

function getTemplate_10Reasons() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Hi {{first_name}},
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        It was great speaking with you! I understand you're considering whether becoming a yoga teacher is the right path for you. Here are 10 reasons our graduates say it was the best decision they ever made:
      </p>
      
      <div style="margin:30px 0;">
        <div style="padding:15px 20px;background:#fef3ed;border-radius:12px;margin-bottom:12px;">
          <strong style="color:#f75c03;">1.</strong> <span style="color:#161616;">Transform your own practice to a deeper level</span>
        </div>
        <div style="padding:15px 20px;background:#fff;border:1px solid #e5e0db;border-radius:12px;margin-bottom:12px;">
          <strong style="color:#f75c03;">2.</strong> <span style="color:#161616;">Gain confidence and find your authentic voice</span>
        </div>
        <div style="padding:15px 20px;background:#fef3ed;border-radius:12px;margin-bottom:12px;">
          <strong style="color:#f75c03;">3.</strong> <span style="color:#161616;">Join a supportive global community of yogis</span>
        </div>
        <div style="padding:15px 20px;background:#fff;border:1px solid #e5e0db;border-radius:12px;margin-bottom:12px;">
          <strong style="color:#f75c03;">4.</strong> <span style="color:#161616;">Create a flexible career on your own terms</span>
        </div>
        <div style="padding:15px 20px;background:#fef3ed;border-radius:12px;margin-bottom:12px;">
          <strong style="color:#f75c03;">5.</strong> <span style="color:#161616;">Help others improve their health and wellbeing</span>
        </div>
        <div style="padding:15px 20px;background:#fff;border:1px solid #e5e0db;border-radius:12px;margin-bottom:12px;">
          <strong style="color:#f75c03;">6.</strong> <span style="color:#161616;">Learn anatomy, philosophy, and teaching methodology</span>
        </div>
        <div style="padding:15px 20px;background:#fef3ed;border-radius:12px;margin-bottom:12px;">
          <strong style="color:#f75c03;">7.</strong> <span style="color:#161616;">Internationally recognized Yoga Alliance certification</span>
        </div>
        <div style="padding:15px 20px;background:#fff;border:1px solid #e5e0db;border-radius:12px;margin-bottom:12px;">
          <strong style="color:#f75c03;">8.</strong> <span style="color:#161616;">Discover hidden strengths you never knew you had</span>
        </div>
        <div style="padding:15px 20px;background:#fef3ed;border-radius:12px;margin-bottom:12px;">
          <strong style="color:#f75c03;">9.</strong> <span style="color:#161616;">Make lifelong friendships with like-minded people</span>
        </div>
        <div style="padding:15px 20px;background:#fff;border:1px solid #e5e0db;border-radius:12px;">
          <strong style="color:#f75c03;">10.</strong> <span style="color:#161616;">Start each day doing what you love</span>
        </div>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0;">
        You don't need to be "advanced" or super flexible. You just need the desire to learn and grow. Our program meets you exactly where you are.
      </p>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/200h-ytt" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          Explore the Program →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Have questions? Just reply to this email - I'm here to help!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
      <p><a href="https://yogabible.dk" style="color:#f75c03;">yogabible.dk</a></p>
    </div>
    
  </div>
</body>
</html>`;
}

function getTemplate_PaymentPlans() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Hi {{first_name}},
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        I completely understand that investing in your yoga teacher training is a big decision. That's why we offer flexible payment options to make it accessible for everyone.
      </p>
      
      <div style="background:#fef3ed;border-radius:16px;padding:25px;margin:25px 0;border:2px solid #f75c03;">
        <h2 style="color:#f75c03;font-size:20px;margin:0 0 15px;font-weight:800;">
          Payment Plan Options
        </h2>
        <ul style="color:#161616;font-size:16px;line-height:1.8;margin:0;padding-left:20px;">
          <li><strong>3 Monthly Payments</strong> - Split into 3 easy instalments</li>
          <li><strong>6 Monthly Payments</strong> - Even smaller monthly amounts</li>
          <li><strong>Custom Plan</strong> - We can work out what suits you best</li>
        </ul>
      </div>
      
      <div style="background:#d1fae5;border-radius:12px;padding:20px;margin:25px 0;">
        <p style="color:#047857;font-size:16px;margin:0;font-weight:600;">
          Tip: Many of our students use their CPR-registered education accounts or employer training budgets to fund their training!
        </p>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0;">
        The investment in yourself pays back many times over - both personally and professionally. Many graduates start teaching within weeks of completing the program.
      </p>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/200h-ytt#pricing" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          See Pricing & Payment Options →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Want to discuss what works best for your situation? Just reply to this email or give us a call!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}

function getTemplate_EarlyBird() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <div style="background:#fef3c7;border-radius:12px;padding:15px 20px;margin-bottom:25px;text-align:center;">
        <span style="font-size:14px;font-weight:800;color:#b45309;text-transform:uppercase;letter-spacing:0.05em;">Limited Time Offer</span>
      </div>
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Save 3,000 DKK on Your Training!
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Just a quick reminder that our <strong>early bird discount</strong> is still available for {{cohort}}. This is your chance to save 3,000 DKK on the full program price!
      </p>
      
      <div style="background:linear-gradient(135deg,#fef3ed 0%,#fff 100%);border:2px solid #f75c03;border-radius:16px;padding:25px;margin:25px 0;text-align:center;">
        <p style="color:#6F6A66;font-size:14px;margin:0 0 5px;text-decoration:line-through;">Regular Price: 22,000 DKK</p>
        <p style="color:#f75c03;font-size:36px;font-weight:900;margin:0;">19,000 DKK</p>
        <p style="color:#047857;font-size:14px;font-weight:600;margin:10px 0 0;">You save 3,000 DKK!</p>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0;">
        This discount won't last forever - secure your spot today and lock in the lower price!
      </p>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/apply" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          Claim Your Discount →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Questions? Just hit reply!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}

function getTemplate_NiceChat() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Great Talking to You!
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Thank you so much for taking the time to chat with us today! It was wonderful hearing about your yoga journey and your interest in {{program}}.
      </p>
      
      <div style="background:#fef3ed;border-radius:12px;padding:20px;margin:25px 0;">
        <h3 style="color:#f75c03;font-size:16px;margin:0 0 10px;font-weight:800;">Quick Recap:</h3>
        <ul style="color:#161616;font-size:15px;line-height:1.8;margin:0;padding-left:20px;">
          <li>Program: {{program}}</li>
          <li>Starting: {{cohort}}</li>
          <li>Location: Copenhagen, Denmark</li>
          <li>Certification: Yoga Alliance 200H RYT</li>
        </ul>
      </div>
      
      <h3 style="color:#161616;font-size:18px;margin:25px 0 15px;font-weight:800;">Your Next Steps:</h3>
      
      <div style="margin-bottom:15px;padding-left:15px;border-left:3px solid #f75c03;">
        <p style="color:#222;font-size:15px;margin:0;"><strong>1.</strong> Review the program details on our website</p>
      </div>
      <div style="margin-bottom:15px;padding-left:15px;border-left:3px solid #f75c03;">
        <p style="color:#222;font-size:15px;margin:0;"><strong>2.</strong> Submit your application when ready</p>
      </div>
      <div style="margin-bottom:15px;padding-left:15px;border-left:3px solid #f75c03;">
        <p style="color:#222;font-size:15px;margin:0;"><strong>3.</strong> We'll confirm your spot within 24 hours</p>
      </div>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/apply" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          Apply Now →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        If you have any more questions, just reply to this email or call us anytime. We're here to help!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Looking forward to welcoming you to Yoga Bible!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}

function getTemplate_LastChance() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <div style="background:#fee2e2;border-radius:12px;padding:15px 20px;margin-bottom:25px;text-align:center;">
        <span style="font-size:14px;font-weight:800;color:#dc2626;text-transform:uppercase;letter-spacing:0.05em;">Only a Few Spots Left!</span>
      </div>
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Hi {{first_name}}, Don't Miss Out!
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        I wanted to reach out because our <strong>{{cohort}}</strong> program is almost full! We have just a few spots remaining, and I didn't want you to miss your chance.
      </p>
      
      <div style="background:linear-gradient(135deg,#fef2f2 0%,#fff 100%);border:2px solid #dc2626;border-radius:16px;padding:25px;margin:25px 0;text-align:center;">
        <p style="color:#dc2626;font-size:48px;font-weight:900;margin:0;">3</p>
        <p style="color:#161616;font-size:16px;font-weight:600;margin:10px 0 0;">spots remaining for {{cohort}}</p>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0;">
        Once these spots are gone, the next available program won't be for several months. If you've been thinking about taking the leap, now is the time!
      </p>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/apply" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          Reserve Your Spot Now →
        </a>
      </div>
      
      <p style="color:#6F6A66;font-size:14px;line-height:1.6;margin:20px 0 0;text-align:center;">
        Questions? Just reply to this email - we're here to help!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}

function getTemplate_Copenhagen() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Why Copenhagen?
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Thinking about where to do your yoga teacher training? Here's why Copenhagen is becoming Europe's favorite destination for YTT:
      </p>
      
      <div style="margin:25px 0;">
        <div style="display:flex;margin-bottom:20px;">
          <div style="width:40px;height:40px;background:#fef3ed;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-right:15px;flex-shrink:0;color:#f75c03;font-weight:700;">1</div>
          <div>
            <h3 style="color:#161616;font-size:16px;margin:0 0 5px;font-weight:700;">Historic Studio in Christianshavn</h3>
            <p style="color:#6F6A66;font-size:14px;margin:0;line-height:1.5;">Train in a beautiful 400-year-old building next to the famous Christiania, one of Copenhagen's most unique neighborhoods.</p>
          </div>
        </div>
        
        <div style="display:flex;margin-bottom:20px;">
          <div style="width:40px;height:40px;background:#fef3ed;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-right:15px;flex-shrink:0;color:#f75c03;font-weight:700;">2</div>
          <div>
            <h3 style="color:#161616;font-size:16px;margin:0 0 5px;font-weight:700;">Europe's Safest City</h3>
            <p style="color:#6F6A66;font-size:14px;margin:0;line-height:1.5;">Copenhagen consistently ranks as one of the world's safest cities - perfect for solo travelers and international students.</p>
          </div>
        </div>
        
        <div style="display:flex;margin-bottom:20px;">
          <div style="width:40px;height:40px;background:#fef3ed;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-right:15px;flex-shrink:0;color:#f75c03;font-weight:700;">3</div>
          <div>
            <h3 style="color:#161616;font-size:16px;margin:0 0 5px;font-weight:700;">World-Famous Bike Culture</h3>
            <p style="color:#6F6A66;font-size:14px;margin:0;line-height:1.5;">Experience the Danish lifestyle - bike to class, explore the city, and embrace the healthy Scandinavian way of living.</p>
          </div>
        </div>
        
        <div style="display:flex;margin-bottom:20px;">
          <div style="width:40px;height:40px;background:#fef3ed;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-right:15px;flex-shrink:0;color:#f75c03;font-weight:700;">4</div>
          <div>
            <h3 style="color:#161616;font-size:16px;margin:0 0 5px;font-weight:700;">Hygge Lifestyle</h3>
            <p style="color:#6F6A66;font-size:14px;margin:0;line-height:1.5;">Immerse yourself in Danish "hygge" - the art of cozy, mindful living that perfectly complements your yoga journey.</p>
          </div>
        </div>
        
        <div style="display:flex;">
          <div style="width:40px;height:40px;background:#fef3ed;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-right:15px;flex-shrink:0;color:#f75c03;font-weight:700;">5</div>
          <div>
            <h3 style="color:#161616;font-size:16px;margin:0 0 5px;font-weight:700;">Easy to Reach</h3>
            <p style="color:#6F6A66;font-size:14px;margin:0;line-height:1.5;">Copenhagen airport connects to all major European cities. Plus, everyone speaks English!</p>
          </div>
        </div>
      </div>
      
      <div style="background:#d1fae5;border-radius:12px;padding:20px;margin:25px 0;">
        <p style="color:#047857;font-size:15px;margin:0;font-weight:600;">
          Need accommodation? We partner with local apartments to offer affordable housing during your training!
        </p>
      </div>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/200h-ytt" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          Explore Copenhagen Training
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}


// =========================================================================
// ADDITIONAL EMAIL TEMPLATES
// =========================================================================

function getTemplate_PersonalFollowup() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Thank you so much for taking the time to speak with me earlier! It was really great to hear about your interest in {{program}} and your yoga journey so far.
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        I wanted to follow up with a few things we discussed:
      </p>
      
      <ul style="color:#222;font-size:16px;line-height:1.8;margin:0 0 20px;padding-left:20px;">
        <li>Program dates for {{cohort}}</li>
        <li>What to expect during the training</li>
        <li>Any questions you might have thought of since we spoke</li>
      </ul>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        If anything came up or you need any clarification, please don't hesitate to reach out. I'm happy to hop on another call or answer via email - whatever works best for you!
      </p>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/apply" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          Reserve Your Spot →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Looking forward to hearing from you!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Warm regards,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
  </div>
</body>
</html>`;
}

function getTemplate_PersonalClarify() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        I wanted to quickly follow up and clarify something from our recent conversation about {{program}}.
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        I realize I might not have explained everything as clearly as I could have, so I wanted to make sure you have all the information you need to make your decision.
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Is there anything specific you'd like me to go over in more detail? I'm happy to answer any questions - no question is too small!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        You can reply to this email or give me a call anytime. I'm here to help!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Talk soon,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
  </div>
</body>
</html>`;
}

function getTemplate_MissedCall() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        I tried giving you a call earlier but couldn't reach you - no worries at all, I know life gets busy!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        I wanted to chat about your inquiry for {{program}}. I'd love to answer any questions you might have and help you figure out if this is the right fit for you.
      </p>
      
      <div style="background:#fef3ed;border-radius:12px;padding:20px;margin:25px 0;">
        <p style="color:#161616;font-size:15px;margin:0;font-weight:600;">Easy ways to reach me:</p>
        <ul style="color:#222;font-size:15px;line-height:1.8;margin:10px 0 0;padding-left:20px;">
          <li>Reply to this email</li>
          <li>Call back at your convenience</li>
          <li>WhatsApp: +45 XX XX XX XX</li>
        </ul>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Or if you prefer, let me know a good time to call you back!
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Talk soon,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
  </div>
</body>
</html>`;
}

function getTemplate_FlexibleFormats() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Training That Fits Your Life
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        We understand that finding time for a 200-hour yoga teacher training can feel overwhelming when you have a busy life. That's why we've designed multiple format options to fit different schedules:
      </p>
      
      <div style="margin:25px 0;">
        <div style="background:#fef3ed;border-radius:12px;padding:20px;margin-bottom:15px;">
          <h3 style="color:#f75c03;font-size:18px;margin:0 0 10px;font-weight:800;">4-Week Intensive</h3>
          <p style="color:#222;font-size:14px;margin:0;line-height:1.5;">Full immersion - perfect if you can take time off work. Complete your training in one focused month.</p>
        </div>
        
        <div style="background:#e0f2fe;border-radius:12px;padding:20px;margin-bottom:15px;">
          <h3 style="color:#0369a1;font-size:18px;margin:0 0 10px;font-weight:800;">8-Week Semi-Intensive</h3>
          <p style="color:#222;font-size:14px;margin:0;line-height:1.5;">Weekends only - train while keeping your weekday job. Great work-life balance.</p>
        </div>
        
        <div style="background:#d1fae5;border-radius:12px;padding:20px;">
          <h3 style="color:#047857;font-size:18px;margin:0 0 10px;font-weight:800;">18-Week Flexible</h3>
          <p style="color:#222;font-size:14px;margin:0;line-height:1.5;">One evening + one weekend day per week. The gentlest pace for busy professionals and parents.</p>
        </div>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0;">
        All formats lead to the same Yoga Alliance certification. The only difference is the pace - choose what works for YOUR life!
      </p>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/200h-ytt#formats" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          Compare All Formats →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}

function getTemplate_WorkingParents() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Yes, Parents Can Do This Too!
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        We know what you're thinking: "I have kids, a job, a household to run... how can I possibly find time for yoga teacher training?"
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        The truth is - many of our most successful graduates are parents just like you. Here's how they made it work:
      </p>
      
      <div style="margin:25px 0;">
        <div style="padding:15px 20px;border-left:3px solid #f75c03;margin-bottom:15px;">
          <p style="color:#222;font-size:15px;margin:0;"><strong>"I did the 18-week format while my kids were in school. The homework was actually my me-time!"</strong></p>
          <p style="color:#6F6A66;font-size:13px;margin:5px 0 0;">- Sarah, mother of two</p>
        </div>
        
        <div style="padding:15px 20px;border-left:3px solid #f75c03;margin-bottom:15px;">
          <p style="color:#222;font-size:15px;margin:0;"><strong>"My partner watched the kids on weekends. It was like having a regular date with myself."</strong></p>
          <p style="color:#6F6A66;font-size:13px;margin:5px 0 0;">- Maria, single mom</p>
        </div>
        
        <div style="padding:15px 20px;border-left:3px solid #f75c03;">
          <p style="color:#222;font-size:15px;margin:0;"><strong>"The online modules meant I could study after bedtime. Best investment in myself ever."</strong></p>
          <p style="color:#6F6A66;font-size:13px;margin:5px 0 0;">- Thomas, father of three</p>
        </div>
      </div>
      
      <div style="background:#fef3ed;border-radius:12px;padding:20px;margin:25px 0;">
        <p style="color:#161616;font-size:15px;margin:0;font-weight:600;">
          Bonus: Many parents tell us that taking this time for themselves actually made them BETTER parents - more patient, more present, more grounded.
        </p>
      </div>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/200h-ytt" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          See How It Can Work For You →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}

function getTemplate_TrainTime() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Turn Your Commute Into Study Time
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Thinking Copenhagen is too far? We hear this a lot - but many of our best students actually love the train ride! Here's why:
      </p>
      
      <div style="margin:25px 0;">
        <div style="display:flex;align-items:flex-start;margin-bottom:20px;">
          <div style="font-size:22px;margin-right:15px;font-weight:bold;color:#f75c03;">&#9656;</div>
          <div>
            <h3 style="color:#161616;font-size:16px;margin:0 0 5px;font-weight:700;">Built-in Study Time</h3>
            <p style="color:#6F6A66;font-size:14px;margin:0;line-height:1.5;">That train ride? It's perfect for watching lecture videos, reading course materials, or reviewing notes. You'll arrive prepared!</p>
          </div>
        </div>
        
        <div style="display:flex;align-items:flex-start;margin-bottom:20px;">
          <div style="width:40px;height:40px;background:#fef3ed;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-right:15px;flex-shrink:0;color:#f75c03;font-weight:700;">Y</div>
          <div>
            <h3 style="color:#161616;font-size:16px;margin:0 0 5px;font-weight:700;">Transition Time</h3>
            <p style="color:#6F6A66;font-size:14px;margin:0;line-height:1.5;">The journey becomes a ritual - leaving daily stress behind on the way there, and integrating what you learned on the way back.</p>
          </div>
        </div>
        
        <div style="display:flex;align-items:flex-start;">
          <div style="font-size:22px;margin-right:15px;font-weight:bold;color:#047857;">&#9656;</div>
          <div>
            <h3 style="color:#161616;font-size:16px;margin:0 0 5px;font-weight:700;">Me-Time</h3>
            <p style="color:#6F6A66;font-size:14px;margin:0;line-height:1.5;">For many, this is the only quiet time they get. Podcasts, meditation apps, or just gazing out the window.</p>
          </div>
        </div>
      </div>
      
      <div style="background:#d1fae5;border-radius:12px;padding:20px;margin:25px 0;">
        <p style="color:#047857;font-size:15px;margin:0;font-weight:600;">
          Students come from Odense, Aarhus, Malmö and beyond. A 1-2 hour train ride is nothing when you're pursuing your dream!
        </p>
      </div>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/200h-ytt" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          Learn More About the Program →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}

function getTemplate_OnlineOption() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Train From Anywhere
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Can't make it to Copenhagen? No problem! We offer online training options that bring the full Yoga Bible experience to your living room.
      </p>
      
      <div style="background:#e0f2fe;border-radius:16px;padding:25px;margin:25px 0;">
        <h2 style="color:#0369a1;font-size:20px;margin:0 0 15px;font-weight:800;">
          What's Included Online:
        </h2>
        <ul style="color:#161616;font-size:15px;line-height:1.8;margin:0;padding-left:20px;">
          <li>Live interactive sessions via Zoom</li>
          <li>HD video library of all techniques</li>
          <li>Virtual practice teaching with feedback</li>
          <li>Access to online student community</li>
          <li>Same Yoga Alliance certification</li>
          <li>Personal mentorship throughout</li>
        </ul>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0;">
        The online format works especially well for our 18-week program, where you'll have plenty of time to practice, integrate, and develop your teaching skills from anywhere in the world.
      </p>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/online-ytt" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          Explore Online Training →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}

function getTemplate_Housing() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#FFFCF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    
    <div style="text-align:center;margin-bottom:30px;">
      <img src="https://yogabible.dk/logo.png" alt="Yoga Bible" style="height:50px;">
    </div>
    
    <div style="background:#fff;border-radius:16px;padding:40px 30px;border:1px solid #e5e0db;">
      
      <h1 style="color:#161616;font-size:28px;margin:0 0 20px;font-weight:800;">
        Your Home Away From Home
      </h1>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi {{first_name}},
      </p>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Coming to Copenhagen for your yoga teacher training? We've got you covered! We partner with local accommodations to offer affordable, convenient housing options:
      </p>
      
      <div style="margin:25px 0;">
        <div style="background:#fef3ed;border-radius:12px;padding:20px;margin-bottom:15px;">
          <h3 style="color:#f75c03;font-size:18px;margin:0 0 10px;font-weight:800;">Private Studio</h3>
          <p style="color:#222;font-size:14px;margin:0;line-height:1.5;">Your own space with kitchenette. Perfect for introverts who need quiet time to study.</p>
        </div>
        
        <div style="background:#e0f2fe;border-radius:12px;padding:20px;">
          <h3 style="color:#0369a1;font-size:18px;margin:0 0 10px;font-weight:800;">Shared Apartment</h3>
          <p style="color:#222;font-size:14px;margin:0;line-height:1.5;">Share with fellow students. More affordable and great for making lifelong yoga friends!</p>
        </div>
      </div>
      
      <div style="background:#d1fae5;border-radius:12px;padding:20px;margin:25px 0;">
        <h3 style="color:#047857;font-size:16px;margin:0 0 10px;font-weight:700;">All accommodations are:</h3>
        <ul style="color:#047857;font-size:14px;line-height:1.8;margin:0;padding-left:20px;">
          <li>Within 15 min of the studio</li>
          <li>In safe, central neighborhoods</li>
          <li>Near public transport</li>
          <li>Equipped with WiFi and essentials</li>
        </ul>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0;">
        Housing fills up fast - especially for our intensive formats. Let us know your dates and preferences, and we'll help you find the perfect spot!
      </p>
      
      <div style="text-align:center;margin:30px 0;">
        <a href="https://yogabible.dk/accommodation" style="display:inline-block;background:#f75c03;color:#fff;padding:16px 32px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">
          View Accommodation Options →
        </a>
      </div>
      
      <p style="color:#222;font-size:16px;line-height:1.6;margin:20px 0 0;">
        Namaste,<br>
        <strong>The Yoga Bible Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;margin-top:30px;color:#6F6A66;font-size:13px;">
      <p>Yoga Bible • Copenhagen, Denmark</p>
    </div>
    
  </div>
</body>
</html>`;
}

function testLeadsReturn() {
  var result = fetchLeadsForWebApp();
  Logger.log('Type: ' + typeof result);
  Logger.log('Is Array: ' + Array.isArray(result));
  Logger.log('Length: ' + (result ? result.length : 'null'));
  if (result && result.length > 0) {
    Logger.log('First lead: ' + JSON.stringify(result[0]).substring(0, 500));
  }
  return result;
}