// ==================== EMAIL V2 FUNCTIONS ====================
// File: 13_EmailV2.gs
// Send to selected leads with attachments
// ============================================================

/**
 * Send template email to specific selected leads (by row index)
 */
function sendBulkToSelected(rowIndexes, templateId, scheduleOption, attachment) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Leads (RAW)');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  var results = { sent: 0, scheduled: 0, failed: 0, skipped: 0 };
  
  // Get column indexes
  var cols = {};
  headers.forEach(function(h, i) { cols[String(h).toLowerCase().replace(/\s+/g, '_')] = i; });
  
  for (var i = 0; i < rowIndexes.length; i++) {
    var rowIndex = rowIndexes[i];
    try {
      var row = data[rowIndex - 1]; // rowIndex is 1-based
      if (!row) {
        results.skipped++;
        continue;
      }
      
      var email = row[cols['email']];
      if (!email || !email.includes('@')) {
        results.skipped++;
        continue;
      }

      // Skip unsubscribed leads
      var leadStatus = String(row[cols['status']] || '').toLowerCase();
      if (leadStatus === CONFIG.UNSUBSCRIBE_STATUS.toLowerCase()) {
        results.skipped++;
        continue;
      }

      var leadData = {
        first_name: row[cols['first_name']] || row[cols['firstname']] || '',
        last_name: row[cols['last_name']] || row[cols['lastname']] || '',
        email: email,
        program: row[cols['program']] || row[cols['ytt_program_top_program']] || row[cols['service']] || '',
        cohort_label: row[cols['cohort_label']] || row[cols['preferred_month']] || '',
        rowIndex: rowIndex
      };

      if (scheduleOption === 'now') {
        sendTemplateEmailWithAttachment(templateId, leadData, attachment);
        results.sent++;
      } else {
        scheduleTemplateEmailWithAttachment(rowIndex, templateId, leadData, scheduleOption, attachment);
        results.scheduled++;
      }
    } catch (e) {
      console.error('Error sending to row ' + rowIndex + ': ' + e.message);
      results.failed++;
    }
  }
  
  return { success: true, results: results };
}

/**
 * Send custom email to specific selected leads (by row index)
 */
function sendCustomBulkToSelected(rowIndexes, subject, bodyHtml, scheduleOption, attachment) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Leads (RAW)');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  var results = { sent: 0, scheduled: 0, failed: 0, skipped: 0 };
  
  var cols = {};
  headers.forEach(function(h, i) { cols[String(h).toLowerCase().replace(/\s+/g, '_')] = i; });
  
  for (var i = 0; i < rowIndexes.length; i++) {
    var rowIndex = rowIndexes[i];
    try {
      var row = data[rowIndex - 1];
      if (!row) {
        results.skipped++;
        continue;
      }
      
      var email = row[cols['email']];
      if (!email || !email.includes('@')) {
        results.skipped++;
        continue;
      }

      // Skip unsubscribed leads
      var leadStatus = String(row[cols['status']] || '').toLowerCase();
      if (leadStatus === CONFIG.UNSUBSCRIBE_STATUS.toLowerCase()) {
        results.skipped++;
        continue;
      }

      var leadData = {
        first_name: row[cols['first_name']] || row[cols['firstname']] || '',
        last_name: row[cols['last_name']] || row[cols['lastname']] || '',
        email: email,
        program: row[cols['program']] || row[cols['ytt_program_top_program']] || row[cols['service']] || '',
        cohort_label: row[cols['cohort_label']] || row[cols['preferred_month']] || '',
        rowIndex: rowIndex
      };

      if (scheduleOption === 'now') {
        sendCustomEmailWithAttachment(subject, bodyHtml, leadData, attachment);
        results.sent++;
      } else {
        scheduleCustomEmailWithAttachment(rowIndex, subject, bodyHtml, leadData, scheduleOption, attachment);
        results.scheduled++;
      }
    } catch (e) {
      console.error('Error sending to row ' + rowIndex + ': ' + e.message);
      results.failed++;
    }
  }
  
  return { success: true, results: results };
}

/**
 * Send template email with optional attachment
 */
function sendTemplateEmailWithAttachment(templateId, leadData, attachment) {
  // Load template from Email Templates sheet (not client-side variable)
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var templatesSheet = ss.getSheetByName('Email Templates');
  if (!templatesSheet) throw new Error('Email Templates sheet not found');

  var templatesData = templatesSheet.getDataRange().getValues();
  var tHeaders = templatesData[0];
  var template = null;

  for (var i = 1; i < templatesData.length; i++) {
    if (String(templatesData[i][0]).trim() === templateId) {
      template = {};
      for (var j = 0; j < tHeaders.length; j++) {
        template[tHeaders[j]] = templatesData[i][j];
      }
      break;
    }
  }

  if (!template) throw new Error('Template not found: ' + templateId);

  var htmlContent = template.body_html;
  if (!htmlContent) throw new Error('Template has no body_html: ' + templateId);

  var firstName = leadData.first_name || 'there';
  var program = leadData.program || 'yoga teacher training';
  var cohort = leadData.cohort_label || '';

  htmlContent = htmlContent
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{program\}\}/gi, program)
    .replace(/\{\{cohort\}\}/gi, cohort);

  var subject = String(template.subject || '')
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{program\}\}/gi, program)
    .replace(/\{\{cohort\}\}/gi, cohort);

  // Append unsubscribe footer
  var unsubUrl = buildUnsubscribeUrl(leadData.email);
  htmlContent += '<div style="text-align:center;padding:20px 0 10px;border-top:1px solid #eee;margin-top:30px;">' +
    '<p style="font-size:11px;color:#999;margin:0;"><a href="' + unsubUrl + '" style="color:#999;text-decoration:underline;">Afmeld nyhedsbrev</a></p></div>';

  var emailOptions = {
    to: leadData.email,
    subject: subject,
    htmlBody: htmlContent,
    name: 'Yoga Bible',
    replyTo: 'hello@yogabible.dk'
  };

  if (attachment && attachment.data) {
    var blob = Utilities.newBlob(
      Utilities.base64Decode(attachment.data),
      attachment.type,
      attachment.name
    );
    emailOptions.attachments = [blob];
  }

  GmailApp.sendEmail(emailOptions.to, emailOptions.subject, '', emailOptions);
  logEmailToNotes(leadData.rowIndex, template.name || templateId);
}

/**
 * Send custom email with optional attachment
 */
function sendCustomEmailWithAttachment(subject, bodyHtml, leadData, attachment) {
  var firstName = leadData.first_name || 'there';
  var program = leadData.program || 'yoga teacher training';
  var cohort = leadData.cohort_label || '';
  
  var personalizedSubject = subject
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{program\}\}/gi, program)
    .replace(/\{\{cohort\}\}/gi, cohort);
  
  var personalizedBody = bodyHtml
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{program\}\}/gi, program)
    .replace(/\{\{cohort\}\}/gi, cohort);

  // Append unsubscribe footer before wrapping in template
  var unsubUrl = buildUnsubscribeUrl(leadData.email);
  personalizedBody += '<div style="text-align:center;padding:20px 0 10px;">' +
    '<p style="font-size:11px;color:#999;margin:0;"><a href="' + unsubUrl + '" style="color:#999;text-decoration:underline;">Afmeld nyhedsbrev</a></p></div>';

  var htmlContent = buildEmailHtml(personalizedBody, leadData);
  
  var emailOptions = {
    to: leadData.email,
    subject: personalizedSubject,
    htmlBody: htmlContent,
    name: 'Yoga Bible',
    replyTo: 'hello@yogabible.dk'
  };
  
  if (attachment && attachment.data) {
    var blob = Utilities.newBlob(
      Utilities.base64Decode(attachment.data),
      attachment.type,
      attachment.name
    );
    emailOptions.attachments = [blob];
  }
  
  GmailApp.sendEmail(emailOptions.to, emailOptions.subject, '', emailOptions);
  logEmailToNotes(leadData.rowIndex, 'Custom: ' + personalizedSubject.substring(0, 30));
}

/**
 * Schedule template email with attachment
 */
function scheduleTemplateEmailWithAttachment(rowIndex, templateId, leadData, scheduleOption, attachment) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var queueSheet = ss.getSheetByName('EmailQueue');
  
  if (!queueSheet) {
    queueSheet = ss.insertSheet('EmailQueue');
    queueSheet.appendRow(['queue_id', 'lead_email', 'lead_name', 'lead_row_index', 'template_id', 'template_name', 'scheduled_for', 'status', 'created_at', 'sent_at', 'error', 'custom_subject', 'custom_body', 'attachment_name', 'attachment_type', 'attachment_data']);
  }
  
  var scheduledFor = calculateScheduledTime(scheduleOption);
  // Look up template name from sheet (emailTemplates is client-side only)
  var templateName = templateId;
  try {
    var tSheet = ss.getSheetByName('Email Templates');
    if (tSheet) {
      var tData = tSheet.getDataRange().getValues();
      for (var t = 1; t < tData.length; t++) {
        if (String(tData[t][0]).trim() === templateId) {
          templateName = tData[t][1] || templateId; // column 1 = name
          break;
        }
      }
    }
  } catch(e) { /* use templateId as fallback */ }
  
  queueSheet.appendRow([
    Utilities.getUuid(),
    leadData.email,
    leadData.first_name + ' ' + leadData.last_name,
    rowIndex,
    templateId,
    templateName,
    scheduledFor.toISOString(),
    'pending',
    new Date().toISOString(),
    '',
    '',
    '',
    '',
    attachment ? attachment.name : '',
    attachment ? attachment.type : '',
    attachment ? attachment.data : ''
  ]);
}

/**
 * Schedule custom email with attachment
 */
function scheduleCustomEmailWithAttachment(rowIndex, subject, bodyHtml, leadData, scheduleOption, attachment) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var queueSheet = ss.getSheetByName('EmailQueue');
  
  if (!queueSheet) {
    queueSheet = ss.insertSheet('EmailQueue');
    queueSheet.appendRow(['queue_id', 'lead_email', 'lead_name', 'lead_row_index', 'template_id', 'template_name', 'scheduled_for', 'status', 'created_at', 'sent_at', 'error', 'custom_subject', 'custom_body', 'attachment_name', 'attachment_type', 'attachment_data']);
  }
  
  var scheduledFor = calculateScheduledTime(scheduleOption);
  
  queueSheet.appendRow([
    Utilities.getUuid(),
    leadData.email,
    leadData.first_name + ' ' + leadData.last_name,
    rowIndex,
    'CUSTOM',
    'Custom Email',
    scheduledFor.toISOString(),
    'pending',
    new Date().toISOString(),
    '',
    '',
    subject,
    bodyHtml,
    attachment ? attachment.name : '',
    attachment ? attachment.type : '',
    attachment ? attachment.data : ''
  ]);
}

// ==================== EMAIL ARCHIVE ====================

/**
 * Save a custom email to the EmailArchive sheet for reuse
 */
function archiveCustomEmail(subject, bodyHtml) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('EmailArchive');

  if (!sheet) {
    sheet = ss.insertSheet('EmailArchive');
    sheet.appendRow(['archive_id', 'subject', 'body_html', 'created_at', 'last_used', 'use_count']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 300);
    sheet.setColumnWidth(3, 400);
    sheet.setColumnWidth(4, 160);
    sheet.setColumnWidth(5, 160);
    sheet.setColumnWidth(6, 80);
  }

  var archiveId = 'ARC-' + Utilities.getUuid().substring(0, 8).toUpperCase();

  sheet.appendRow([
    archiveId,
    subject,
    bodyHtml,
    new Date().toISOString(),
    '',
    0
  ]);

  return { success: true, archive_id: archiveId };
}

/**
 * Get all archived emails
 */
function getArchivedEmails() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('EmailArchive');

  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0];
  var results = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    results.push({
      archive_id: row[0],
      subject: row[1],
      body_html: row[2],
      created_at: row[3],
      last_used: row[4],
      use_count: row[5] || 0
    });
  }

  // Most recent first
  results.reverse();
  return results;
}

/**
 * Load an archived email (and bump use_count)
 */
function loadArchivedEmail(archiveId) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('EmailArchive');
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === archiveId) {
      // Update last_used and use_count
      sheet.getRange(i + 1, 5).setValue(new Date().toISOString());
      sheet.getRange(i + 1, 6).setValue((data[i][5] || 0) + 1);
      return {
        archive_id: data[i][0],
        subject: data[i][1],
        body_html: data[i][2]
      };
    }
  }
  return null;
}

/**
 * Delete an archived email
 */
function deleteArchivedEmail(archiveId) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName('EmailArchive');
  if (!sheet) return { success: false };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === archiveId) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false };
}

/**
 * Log email to lead notes
 */
function logEmailToNotes(rowIndex, emailName) {
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
    var newNote = 'Email Sent: ' + emailName + ' (' + dateStr + ')';
    
    sheet.getRange(rowIndex, notesCol).setValue(newNote + '\n' + currentNotes);
  } catch (e) {
    console.error('Error logging email to notes: ' + e.message);
  }
}