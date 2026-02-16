// ==================== SMS FUNCTIONALITY ====================
// File: 12_SMS.gs
// SMS sending via GatewayAPI EU (Danish provider)
// ============================================================

// GatewayAPI EU Credentials
var GATEWAYAPI_ENDPOINT = 'https://gatewayapi.eu/rest/mtsms';
var GATEWAYAPI_TOKEN = 'Kj7UHGlkRgOu-UH7iybKCR8xJ5r8CoBOT2b7h93tN1_jLx_FEFTB9HZO9tK_HGhJ';

// SMS Status Column Name (will be auto-created if missing)
var SMS_STATUS_COLUMN = 'sms_status';

/**
 * TEST FUNCTION - Run this manually to test SMS
 * This will send a test SMS to YOUR phone number
 */
function testSendSMS() {
  var testPhone = '+4553881209';
  var testMessage = "Hi Shahab! Thanks for your interest in Yoga Bible YTT. Check your email for details. Questions? Reply here! - Yoga Bible";
  
  console.log('Testing SMS to: ' + testPhone);
  var result = sendSMS(testPhone, testMessage);
  console.log('Result:', JSON.stringify(result));
  
  if (result.success) {
    console.log('✅ SMS sent successfully!');
  } else {
    console.log('❌ SMS failed: ' + result.error);
  }
  
  return result;
}

/**
 * TEST FUNCTION - Test welcome SMS with a specific lead row
 * Change the rowIndex to test with different leads
 */
function testWelcomeSMSForRow() {
  var rowIndex = 2; // Change this to the row number you want to test
  
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Leads (RAW)');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  var cols = {};
  headers.forEach(function(h, i) { cols[String(h).toLowerCase().replace(/\s+/g, '_')] = i; });
  
  var row = data[rowIndex - 1];
  if (!row) {
    console.log('Row ' + rowIndex + ' not found');
    return;
  }
  
  var leadData = {
    first_name: row[cols['first_name']] || row[cols['firstname']] || '',
    phone: row[cols['phone']] || row[cols['telefon']] || '',
    program: row[cols['program']] || ''
  };
  
  console.log('Testing welcome SMS for:', JSON.stringify(leadData));
  
  var result = sendWelcomeSMS(leadData, rowIndex);
  console.log('Result:', JSON.stringify(result));
  
  return result;
}

/**
 * Send welcome SMS to new leads automatically
 * Call this after processing a new lead
 * @param {Object} leadData - Lead data with first_name, phone, program
 * @param {number} rowIndex - Row index in sheet
 * @returns {Object} Result with success status
 */
function sendWelcomeSMS(leadData, rowIndex) {
  console.log('=== sendWelcomeSMS CALLED ===');
  console.log('leadData: ' + JSON.stringify(leadData));
  console.log('rowIndex: ' + rowIndex);
  
  // Validate input
  if (!leadData || typeof leadData !== 'object') {
    console.log('sendWelcomeSMS: Invalid leadData - received: ' + typeof leadData);
    return { success: false, reason: 'invalid_input', error: 'leadData must be an object' };
  }
  
  // Check if auto-SMS is enabled
  console.log('AUTO_SMS_CONFIG exists: ' + (typeof AUTO_SMS_CONFIG !== 'undefined'));
  console.log('AUTO_SMS_CONFIG.enabled: ' + (AUTO_SMS_CONFIG ? AUTO_SMS_CONFIG.enabled : 'N/A'));
  
  if (typeof AUTO_SMS_CONFIG === 'undefined' || !AUTO_SMS_CONFIG || !AUTO_SMS_CONFIG.enabled) {
    console.log('Auto-SMS is disabled or config not found');
    return { success: false, reason: 'disabled' };
  }
  
  // Check if phone exists (strip leading apostrophe used for Excel)
  var phone = String(leadData.phone || '').replace(/^'/, '').replace(/\s/g, '');
  console.log('Phone after cleanup: ' + phone);
  if (phone.length < 8) {
    console.log('No valid phone for welcome SMS: "' + phone + '"');
    updateSMSStatus(rowIndex, 'no_phone', 'No valid phone number');
    return { success: false, reason: 'no_phone' };
  }
  
  // Check if SMS already sent (prevent duplicates)
  var existingStatus = getSMSStatus(rowIndex);
  if (existingStatus && existingStatus.includes('sent')) {
    console.log('SMS already sent to this lead');
    return { success: false, reason: 'already_sent' };
  }
  
  // Determine program type and select template
  var program = String(leadData.program || '').toLowerCase();
  var templateKey = 'default';
  
  if (program.includes('4-week') || program.includes('8-week') || program.includes('18-week') || 
      program.includes('4 week') || program.includes('8 week') || program.includes('18 week') ||
      program.includes('4uge') || program.includes('8uge') || program.includes('18uge') ||
      program.includes('intensive') || program.includes('flexible') || program.includes('ytt') ||
      program.includes('200') || program.includes('teacher training')) {
    templateKey = 'ytt';
  } else if (program.includes('inversion') || program.includes('backbend') || program.includes('split') || program.includes('bundle')) {
    templateKey = 'course';
  } else if (program.includes('mentorship') || program.includes('personlig')) {
    templateKey = 'mentorship';
  }
  
  // Get template and personalize
  var template = AUTO_SMS_CONFIG.templates[templateKey] || AUTO_SMS_CONFIG.templates['default'];
  var firstName = leadData.first_name || 'there';
  var programName = leadData.program || 'yoga program';
  
  var message = template
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{program\}\}/gi, programName);
  
  // Update status to 'sending'
  updateSMSStatus(rowIndex, 'sending', 'Attempting to send...');
  
  // Send SMS
  console.log('Sending welcome SMS to: ' + phone);
  var result = sendSMS(phone, message, rowIndex);
  
  if (result.success) {
    console.log('Welcome SMS sent successfully');
    updateSMSStatus(rowIndex, 'sent', 'Sent ' + new Date().toLocaleString('en-GB', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}));
  } else {
    console.log('Welcome SMS failed: ' + result.error);
    updateSMSStatus(rowIndex, 'failed', 'Error: ' + (result.error || 'Unknown').substring(0, 50));
  }
  
  return result;
}

/**
 * Send individual SMS via GatewayAPI EU
 * @param {string} phone - Phone number
 * @param {string} message - SMS message
 * @param {number} leadRowIndex - Optional row index to log to notes
 * @returns {Object} Result with success status
 */
function sendTestSMS(phone, message) {
  // Send a test SMS without logging to any lead notes
  return sendSMS(phone, '[TEST] ' + message, null);
}

function sendSMS(phone, message, leadRowIndex) {
  var cleanPhone = String(phone).replace(/\s+/g, '').replace(/[^\d+]/g, '');
  
  // Add country code if missing
  if (!cleanPhone.startsWith('+')) {
    if (cleanPhone.startsWith('00')) {
      cleanPhone = '+' + cleanPhone.substring(2);
    } else if (cleanPhone.length === 8) {
      cleanPhone = '+45' + cleanPhone; // Default Danish
    } else {
      cleanPhone = '+45' + cleanPhone;
    }
  }
  
  // Remove + for API (expects MSISDN format: 4553881209)
  var msisdn = cleanPhone.replace('+', '');
  
  try {
    var payload = {
      sender: '+4553881209',
      message: message,
      recipients: [{ msisdn: msisdn }]
    };
    
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Token ' + GATEWAYAPI_TOKEN
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(GATEWAYAPI_ENDPOINT, options);
    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();
    
    console.log('GatewayAPI EU response: ' + responseCode + ' - ' + responseText);
    
    if (responseCode === 200) {
      var result = JSON.parse(responseText);
      
      // Log success to notes
      if (leadRowIndex) {
        logSMSToNotes(leadRowIndex, message.substring(0, 30) + '...', 'sent');
      }
      
      return { 
        success: true, 
        method: 'api',
        messageId: result.ids ? result.ids[0] : null,
        message: 'SMS sent successfully!'
      };
    } else {
      var errorMsg = 'SMS send failed: ' + responseCode;
      try {
        var errorData = JSON.parse(responseText);
        errorMsg = errorData.message || errorData.error || errorMsg;
      } catch(e) {}
      throw new Error(errorMsg);
    }
  } catch (e) {
    console.error('GatewayAPI EU error: ' + e.message);
    return {
      success: false,
      error: e.message
    };
  }
}

/**
 * Get SMS status for a row
 */
function getSMSStatus(rowIndex) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    var smsCol = -1;
    headers.forEach(function(h, i) {
      if (String(h).toLowerCase().replace(/\s+/g, '_') === SMS_STATUS_COLUMN) smsCol = i + 1;
    });
    
    if (smsCol === -1) return null;
    
    return sheet.getRange(rowIndex, smsCol).getValue();
  } catch (e) {
    console.error('Error getting SMS status: ' + e.message);
    return null;
  }
}

/**
 * Update SMS status column for a lead
 * @param {number} rowIndex - Row index in sheet
 * @param {string} status - Status code: 'sent', 'failed', 'no_phone', 'sending'
 * @param {string} details - Additional details
 */
function updateSMSStatus(rowIndex, status, details) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    // Find or create SMS status column
    var smsCol = -1;
    headers.forEach(function(h, i) {
      if (String(h).toLowerCase().replace(/\s+/g, '_') === SMS_STATUS_COLUMN) smsCol = i + 1;
    });
    
    // Create column if not found
    if (smsCol === -1) {
      smsCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, smsCol).setValue('sms_status');
      console.log('Created sms_status column at column ' + smsCol);
    }
    
    // Build status value with emoji
    var statusEmoji = {
      'sent': '✅',
      'failed': '❌',
      'no_phone': '📵',
      'sending': '⏳',
      'disabled': '⏸️'
    };
    
    var emoji = statusEmoji[status] || '❓';
    var value = emoji + ' ' + (details || status);
    
    sheet.getRange(rowIndex, smsCol).setValue(value);
    console.log('Updated SMS status for row ' + rowIndex + ': ' + value);
    
  } catch (e) {
    console.error('Error updating SMS status: ' + e.message);
  }
}

/**
 * Log SMS to lead notes
 */
function logSMSToNotes(rowIndex, messageSummary, status) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Leads (RAW)');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    var notesCol = -1;
    headers.forEach(function(h, i) {
      if (String(h).toLowerCase() === 'notes') notesCol = i + 1;
    });
    
    if (notesCol === -1) return;
    
    var currentNotes = sheet.getRange(rowIndex, notesCol).getValue() || '';
    var now = new Date();
    var dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    var icon = status === 'sent' ? '📱' : '📲';
    var newNote = icon + ' SMS: ' + messageSummary + ' (' + dateStr + ')';
    
    sheet.getRange(rowIndex, notesCol).setValue(newNote + '\n' + currentNotes);
  } catch (e) {
    console.error('Error logging SMS to notes: ' + e.message);
  }
}

/**
 * Send bulk SMS via GatewayAPI
 */
function sendBulkSMS(rowIndexes, message) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  
  // Default to Leads sheet
  var sheet = ss.getSheetByName('Leads (RAW)');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var cols = {};
  headers.forEach(function(h, i) { cols[String(h).toLowerCase().replace(/\s+/g, '_')] = i; });
  
  var results = { sent: 0, failed: 0, skipped: 0, errors: [] };
  
  for (var i = 0; i < rowIndexes.length; i++) {
    var rowIndex = rowIndexes[i];
    try {
      var row = data[rowIndex - 1];
      if (!row) {
        results.skipped++;
        continue;
      }
      
      var phone = row[cols['phone']] || row[cols['telefon']];
      if (!phone) {
        results.skipped++;
        continue;
      }
      
      var firstName = row[cols['first_name']] || row[cols['firstname']] || '';
      
      var personalizedMessage = message
        .replace(/\{\{first_name\}\}/gi, firstName || 'there')
        .replace(/\{\{name\}\}/gi, firstName || 'there');
      
      var result = sendSMS(phone, personalizedMessage, rowIndex);
      
      if (result.success) {
        results.sent++;
        updateSMSStatus(rowIndex, 'sent', 'Bulk SMS sent ' + new Date().toLocaleString('en-GB', {day:'2-digit', month:'short'}));
      } else {
        results.failed++;
        results.errors.push({ name: firstName, error: result.error });
        updateSMSStatus(rowIndex, 'failed', 'Bulk error: ' + (result.error || 'Unknown').substring(0, 30));
      }
      
      // Small delay to avoid rate limiting
      Utilities.sleep(100);
      
    } catch (e) {
      console.error('Error sending SMS to row ' + rowIndex + ': ' + e.message);
      results.failed++;
    }
  }
  
  return { success: true, results: results };
}

/**
 * Get SMS templates
 */
function getSMSTemplates() {
  return [
    {
      id: 'follow_up',
      name: 'Follow Up',
      category: 'Follow-up',
      message: 'Hi {{first_name}}! Just following up on your yoga teacher training inquiry. Do you have any questions I can help with? - Yoga Bible'
    },
    {
      id: 'reminder',
      name: 'Application Reminder',
      category: 'Reminder',
      message: 'Hi {{first_name}}! Quick reminder - spots are filling for our upcoming YTT. Let me know if you need help with your application! - Yoga Bible'
    },
    {
      id: 'call_missed',
      name: 'Missed Call',
      category: 'Follow-up',
      message: 'Hi {{first_name}}, I tried calling but couldn\'t reach you. When\'s a good time to chat about your yoga training goals? - Yoga Bible'
    },
    {
      id: 'welcome',
      name: 'Welcome',
      category: 'Welcome',
      message: 'Hi {{first_name}}! Thanks for your interest in Yoga Bible. I\'ll be in touch soon with more info. Feel free to text back with any questions!'
    },
    {
      id: 'confirmation',
      name: 'Booking Confirmed',
      category: 'Confirmation',
      message: 'Hi {{first_name}}! Your spot is confirmed! Check your email for all the details. Can\'t wait to see you! - Yoga Bible'
    },
    {
      id: 'last_spot',
      name: 'Last Spot',
      category: 'Promo',
      message: 'Hi {{first_name}}! Just 1 spot left for our February YTT! Want me to hold it for you? Reply quick! - Yoga Bible'
    }
  ];
}

/**
 * Setup function - run once to ensure SMS status column exists
 */
function setupSMSStatusColumn() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Leads (RAW)');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  var found = false;
  headers.forEach(function(h) {
    if (String(h).toLowerCase().replace(/\s+/g, '_') === SMS_STATUS_COLUMN) found = true;
  });
  
  if (!found) {
    var newCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, newCol).setValue('sms_status');
    console.log('Created sms_status column');
  } else {
    console.log('sms_status column already exists');
  }
}