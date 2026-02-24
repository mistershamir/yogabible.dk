/**
 * YOGA BIBLE — BILLING ADMIN (e-conomic)
 * Create customers + instalment invoices via the e-conomic REST API.
 * Talks to /.netlify/functions/economic-admin (server-side proxy).
 *
 * Supports:
 * - e-conomic customer search + create
 * - Firestore applicant picker (from applications collection)
 * - "Bill Applicant" from Applications tab (auto-fill)
 * - Description presets from course catalog
 * - Instalment invoice lines with monthly schedule
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var T = {};
  var isDa = true;
  var settingsLoaded = false;
  var settingsLoading = false;
  var settings = { paymentTerms: [], layouts: [], customerGroups: [], vatZones: [] };
  var selectedCustomer = null; // { customerNumber, name, email }
  var selectedApplicant = null; // { name, email, phone, course, appId } — pre-e-conomic
  var currentDraftNumber = null;
  var currentBookedNumber = null;
  var currentBookedEmail = null;
  var busy = false;
  var applicantsCache = []; // cached from Firestore

  /* ══════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════ */
  function t(k) { return T[k] || k; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function $(id) { return document.getElementById(id); }

  function toast(msg, isError) {
    var el = $('yb-admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'yb-admin__toast' + (isError ? ' yb-admin__toast--error' : '');
    el.hidden = false;
    clearTimeout(el._tid);
    el._tid = setTimeout(function () { el.hidden = true; }, 4000);
  }

  function getAuthToken() {
    if (!window.firebase || !firebase.auth || !firebase.auth().currentUser) {
      return Promise.reject(new Error(isDa ? 'Du er ikke logget ind.' : 'You are not signed in.'));
    }
    return firebase.auth().currentUser.getIdToken();
  }

  function apiCall(body) {
    return getAuthToken().then(function (token) {
      return fetch('/.netlify/functions/economic-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
    }).then(function (res) { return res.json(); });
  }

  /* ══════════════════════════════════════════
     MONTH HELPERS
     ══════════════════════════════════════════ */
  var MONTHS_DA = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
  var MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function monthName(monthIndex) {
    return isDa ? MONTHS_DA[monthIndex] : MONTHS_EN[monthIndex];
  }

  function formatDate(year, month, day) {
    if (isDa) return day + '. ' + monthName(month) + ' ' + year;
    return monthName(month) + ' ' + day + ', ' + year;
  }

  function isoDate(year, month, day) {
    return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  /* ══════════════════════════════════════════
     LOAD E-CONOMIC SETTINGS
     ══════════════════════════════════════════ */
  function loadSettings() {
    if (settingsLoading) return;
    settingsLoading = true;
    console.log('[billing] Loading e-conomic settings...');

    apiCall({ action: 'settings' }).then(function (res) {
      settingsLoading = false;
      if (!res.ok) {
        console.error('[billing] Settings load failed:', res.error);
        toast(res.error || 'Failed to load e-conomic settings', true);
        return;
      }
      settings = res.data;
      settingsLoaded = true;
      console.log('[billing] Settings loaded:', Object.keys(settings).map(function (k) { return k + '=' + settings[k].length; }).join(', '));
      populateDropdowns();
    }).catch(function (err) {
      settingsLoading = false;
      console.error('[billing] Settings error:', err);
      toast('e-conomic: ' + err.message, true);
    });
  }

  function populateDropdowns() {
    // Payment terms — invoice + new customer
    var ptOpts = settings.paymentTerms.map(function (pt) {
      return '<option value="' + pt.paymentTermsNumber + '">' + esc(pt.name) + '</option>';
    }).join('');
    if (!ptOpts) ptOpts = '<option value="1">Netto 8 dage</option>';
    var ptSel = $('yb-billing-payment-terms');
    if (ptSel) ptSel.innerHTML = ptOpts;
    var ptSel2 = $('yb-billing-nc-payment');
    if (ptSel2) ptSel2.innerHTML = ptOpts;

    // Layouts
    var layOpts = settings.layouts.map(function (l) {
      return '<option value="' + l.layoutNumber + '">' + esc(l.name) + '</option>';
    }).join('');
    if (!layOpts) layOpts = '<option value="19">Standard</option>';
    var laySel = $('yb-billing-layout');
    if (laySel) laySel.innerHTML = layOpts;

    // Customer groups
    var cgOpts = settings.customerGroups.map(function (cg) {
      return '<option value="' + cg.customerGroupNumber + '">' + esc(cg.name) + '</option>';
    }).join('');
    if (!cgOpts) cgOpts = '<option value="1">Standard</option>';
    var cgSel = $('yb-billing-nc-group');
    if (cgSel) cgSel.innerHTML = cgOpts;

    // VAT zones
    var vzOpts = settings.vatZones.map(function (vz) {
      return '<option value="' + vz.vatZoneNumber + '">' + esc(vz.name) + '</option>';
    }).join('');
    if (!vzOpts) vzOpts = '<option value="1">Hjemme</option>';
    var vzSel = $('yb-billing-nc-vat');
    if (vzSel) vzSel.innerHTML = vzOpts;
  }

  /* ══════════════════════════════════════════
     SOURCE TABS (e-conomic / Applicants)
     ══════════════════════════════════════════ */
  function switchSource(source) {
    var econPanel = $('yb-billing-source-economic');
    var appPanel = $('yb-billing-source-applicants');
    if (!econPanel || !appPanel) return;

    document.querySelectorAll('.yb-billing__source-tab').forEach(function (btn) { btn.classList.remove('is-active'); });
    var activeBtn = document.querySelector('[data-action="billing-source-' + source + '"]');
    if (activeBtn) activeBtn.classList.add('is-active');

    if (source === 'economic') {
      econPanel.hidden = false;
      appPanel.hidden = true;
    } else {
      econPanel.hidden = true;
      appPanel.hidden = false;
    }
  }

  /* ══════════════════════════════════════════
     E-CONOMIC CUSTOMER SEARCH
     ══════════════════════════════════════════ */
  function searchCustomers() {
    var q = ($('yb-billing-customer-search') || {}).value || '';
    if (q.length < 2) { toast(isDa ? 'Skriv mindst 2 tegn' : 'Type at least 2 characters', true); return; }
    console.log('[billing] Searching e-conomic customers:', q);
    apiCall({ action: 'searchCustomers', query: q }).then(function (res) {
      if (!res.ok) { toast(res.error, true); return; }
      renderCustomerResults(res.data);
    }).catch(function (err) { toast(err.message, true); });
  }

  function renderCustomerResults(customers) {
    var el = $('yb-billing-customer-results');
    if (!el) return;
    if (!customers.length) {
      el.innerHTML = '<p class="yb-billing__no-results">' + (isDa ? 'Ingen kunder fundet.' : 'No customers found.') + '</p>';
      el.hidden = false;
      return;
    }
    var html = '<div class="yb-billing__customer-list">';
    customers.forEach(function (c) {
      html += '<button type="button" class="yb-billing__customer-row" data-action="billing-select-customer" '
        + 'data-customer-number="' + c.customerNumber + '" '
        + 'data-customer-name="' + esc(c.name) + '" '
        + 'data-customer-email="' + esc(c.email || '') + '">'
        + '<span class="yb-billing__cr-name">' + esc(c.name) + '</span>'
        + '<span class="yb-billing__cr-num">#' + c.customerNumber + '</span>'
        + (c.email ? '<span class="yb-billing__cr-email">' + esc(c.email) + '</span>' : '')
        + '</button>';
    });
    html += '</div>';
    el.innerHTML = html;
    el.hidden = false;
  }

  function selectCustomer(num, name, email) {
    selectedCustomer = { customerNumber: parseInt(num), name: name, email: email };
    selectedApplicant = null;
    $('yb-billing-cust-name').textContent = name;
    $('yb-billing-cust-num').textContent = '#' + num;
    $('yb-billing-cust-email').textContent = email || '';
    $('yb-billing-selected-customer').hidden = false;
    $('yb-billing-customer-results').hidden = true;
    $('yb-billing-applicant-results') && ($('yb-billing-applicant-results').hidden = true);
    var ncForm = $('yb-billing-new-customer-form');
    if (ncForm) ncForm.hidden = true;
    console.log('[billing] Customer selected:', num, name);
    updatePreview();
    updateBtnState();
  }

  function clearCustomer() {
    selectedCustomer = null;
    selectedApplicant = null;
    $('yb-billing-selected-customer').hidden = true;
    var banner = $('yb-billing-applicant-banner');
    if (banner) banner.hidden = true;
    updateBtnState();
  }

  /* ══════════════════════════════════════════
     FIRESTORE APPLICANT SEARCH
     ══════════════════════════════════════════ */
  function searchApplicants() {
    var q = ($('yb-billing-applicant-search') || {}).value || '';
    if (q.length < 2) { toast(isDa ? 'Skriv mindst 2 tegn' : 'Type at least 2 characters', true); return; }
    console.log('[billing] Searching applicants:', q);

    // Search from Firestore applications collection
    var db = firebase.firestore();
    db.collection('applications').orderBy('created_at', 'desc').limit(200).get().then(function (snap) {
      var results = [];
      var qLower = q.toLowerCase();
      snap.forEach(function (doc) {
        var d = doc.data();
        d.id = doc.id;
        var match = (d.first_name || '').toLowerCase().includes(qLower)
          || (d.last_name || '').toLowerCase().includes(qLower)
          || (d.email || '').toLowerCase().includes(qLower)
          || ((d.first_name || '') + ' ' + (d.last_name || '')).toLowerCase().includes(qLower);
        if (match) results.push(d);
      });
      renderApplicantResults(results);
    }).catch(function (err) { toast(err.message, true); });
  }

  function renderApplicantResults(applicants) {
    var el = $('yb-billing-applicant-results');
    if (!el) return;
    if (!applicants.length) {
      el.innerHTML = '<p class="yb-billing__no-results">' + (isDa ? 'Ingen ansøgere fundet.' : 'No applicants found.') + '</p>';
      el.hidden = false;
      return;
    }
    var html = '<div class="yb-billing__customer-list">';
    applicants.forEach(function (a) {
      var name = (a.first_name || '') + ' ' + (a.last_name || '');
      var statusBadge = a.status ? '<span class="yb-billing__cr-status">' + esc(a.status) + '</span>' : '';
      html += '<button type="button" class="yb-billing__customer-row" data-action="billing-select-applicant" '
        + 'data-app-name="' + esc(name.trim()) + '" '
        + 'data-app-email="' + esc(a.email || '') + '" '
        + 'data-app-phone="' + esc(a.phone || '') + '" '
        + 'data-app-course="' + esc(a.course_name || '') + '" '
        + 'data-app-type="' + esc(a.type || '') + '" '
        + 'data-app-id="' + esc(a.app_id || a.id || '') + '">'
        + '<span class="yb-billing__cr-name">' + esc(name.trim()) + '</span>'
        + statusBadge
        + (a.course_name ? '<span class="yb-billing__cr-course">' + esc(a.course_name) + '</span>' : '')
        + (a.email ? '<span class="yb-billing__cr-email">' + esc(a.email) + '</span>' : '')
        + '</button>';
    });
    html += '</div>';
    el.innerHTML = html;
    el.hidden = false;
  }

  function selectApplicant(data) {
    selectedApplicant = {
      name: data.appName,
      email: data.appEmail,
      phone: data.appPhone,
      course: data.appCourse,
      type: data.appType,
      appId: data.appId
    };
    selectedCustomer = null;

    // Show as selected customer badge (but without e-conomic number)
    $('yb-billing-cust-name').textContent = data.appName;
    $('yb-billing-cust-num').textContent = data.appId ? '(' + data.appId + ')' : '';
    $('yb-billing-cust-email').textContent = data.appEmail || '';
    $('yb-billing-selected-customer').hidden = false;
    $('yb-billing-applicant-results') && ($('yb-billing-applicant-results').hidden = true);
    $('yb-billing-customer-results') && ($('yb-billing-customer-results').hidden = true);

    // Pre-fill new customer form with applicant data
    prefillNewCustomerForm(data.appName, data.appEmail, data.appPhone);

    // Auto-match description if course known
    if (data.appCourse) {
      autoMatchDescription(data.appCourse, data.appType);
    }

    // Set ref to app ID
    var refEl = $('yb-billing-ref');
    if (refEl && data.appId) refEl.value = data.appId;

    console.log('[billing] Applicant selected:', data.appName, data.appCourse);
    updatePreview();
    updateBtnState();
  }

  function prefillNewCustomerForm(name, email, phone) {
    // Show new customer form pre-filled
    var ncForm = $('yb-billing-new-customer-form');
    if (ncForm) ncForm.hidden = false;
    var ncName = $('yb-billing-nc-name');
    if (ncName) ncName.value = name || '';
    var ncEmail = $('yb-billing-nc-email');
    if (ncEmail) ncEmail.value = email || '';
    var ncPhone = $('yb-billing-nc-phone');
    if (ncPhone) ncPhone.value = phone || '';
  }

  function autoMatchDescription(courseName, appType) {
    var preset = $('yb-billing-desc-preset');
    var descInput = $('yb-billing-description');
    if (!preset || !descInput) return;

    var cn = (courseName || '').toLowerCase();
    var matched = false;

    // Try to match preset options
    for (var i = 0; i < preset.options.length; i++) {
      var val = preset.options[i].value.toLowerCase();
      if (val && cn && (val.includes(cn) || cn.includes(val.split(' — ')[1] || ''))) {
        preset.selectedIndex = i;
        descInput.value = preset.options[i].value;
        matched = true;
        break;
      }
    }

    // Fallback: use course name as custom description
    if (!matched && courseName) {
      preset.value = 'custom';
      descInput.value = courseName;
    }

    updatePreview();
  }

  /* ══════════════════════════════════════════
     CREATE CUSTOMER
     ══════════════════════════════════════════ */
  function showNewCustomerForm() {
    var form = $('yb-billing-new-customer-form');
    if (form) form.hidden = false;
    $('yb-billing-customer-results').hidden = true;
  }

  function cancelNewCustomer() {
    var form = $('yb-billing-new-customer-form');
    if (form) form.hidden = true;
  }

  function saveNewCustomer() {
    var name = ($('yb-billing-nc-name') || {}).value || '';
    if (!name.trim()) { toast(isDa ? 'Kundenavn er påkrævet' : 'Customer name is required', true); return; }

    var customer = {
      name: name.trim(),
      email: ($('yb-billing-nc-email') || {}).value || '',
      address: ($('yb-billing-nc-address') || {}).value || '',
      zip: ($('yb-billing-nc-zip') || {}).value || '',
      city: ($('yb-billing-nc-city') || {}).value || '',
      phone: ($('yb-billing-nc-phone') || {}).value || '',
      corporateIdentificationNumber: ($('yb-billing-nc-cvr') || {}).value || '',
      customerGroupNumber: parseInt(($('yb-billing-nc-group') || {}).value) || 1,
      vatZoneNumber: parseInt(($('yb-billing-nc-vat') || {}).value) || 1,
      paymentTermsNumber: parseInt(($('yb-billing-nc-payment') || {}).value) || 1
    };

    // Check for duplicate customer before creating
    console.log('[billing] Checking for duplicate customer:', customer.name);
    apiCall({ action: 'searchCustomers', query: customer.name }).then(function (res) {
      if (!res.ok) { doCreateCustomer(customer); return; } // If search fails, proceed anyway
      var existing = res.data || [];

      // Also check by email if provided
      var emailCheck = customer.email
        ? apiCall({ action: 'searchCustomers', query: customer.email })
        : Promise.resolve({ ok: true, data: [] });

      return emailCheck.then(function (emailRes) {
        var emailMatches = (emailRes.ok ? emailRes.data : []) || [];
        // Merge unique matches
        var allMatches = existing.slice();
        emailMatches.forEach(function (em) {
          var found = allMatches.some(function (m) { return m.customerNumber === em.customerNumber; });
          if (!found) allMatches.push(em);
        });

        if (allMatches.length > 0) {
          var matchList = allMatches.map(function (m) { return m.name + ' (#' + m.customerNumber + ')' + (m.email ? ' — ' + m.email : ''); }).join('\n');
          var msg = isDa
            ? 'Der findes allerede kunde(r) med lignende navn/email:\n\n' + matchList + '\n\nVil du stadig oprette en ny kunde?'
            : 'Customer(s) with similar name/email already exist:\n\n' + matchList + '\n\nDo you still want to create a new customer?';
          if (!confirm(msg)) {
            // Let admin select existing customer instead
            renderCustomerResults(allMatches);
            $('yb-billing-source-economic') && ($('yb-billing-source-economic').hidden = false);
            $('yb-billing-customer-results').hidden = false;
            switchSource('economic');
            return;
          }
        }
        doCreateCustomer(customer);
      });
    }).catch(function () { doCreateCustomer(customer); }); // On error, proceed anyway
  }

  function doCreateCustomer(customer) {
    console.log('[billing] Creating e-conomic customer:', customer.name);
    apiCall({ action: 'createCustomer', customer: customer }).then(function (res) {
      if (!res.ok) { toast(res.error, true); return; }
      var c = res.data;
      toast(t('billing_customer_created'));
      selectCustomer(c.customerNumber, c.name, c.email || customer.email);
      cancelNewCustomer();
    }).catch(function (err) { toast(err.message, true); });
  }

  /* ══════════════════════════════════════════
     DESCRIPTION PRESETS
     ══════════════════════════════════════════ */
  function handleDescPresetChange() {
    var preset = $('yb-billing-desc-preset');
    var descInput = $('yb-billing-description');
    if (!preset || !descInput) return;

    var val = preset.value;
    if (val === 'custom') {
      descInput.value = '';
      descInput.focus();
    } else if (val) {
      descInput.value = val;
    } else {
      descInput.value = '';
    }
    updatePreview();
  }

  /* ══════════════════════════════════════════
     NOTES PRESET
     ══════════════════════════════════════════ */
  function handleNotesPresetChange() {
    var preset = $('yb-billing-notes-preset');
    var customRow = $('yb-billing-notes-custom-row');
    var notesArea = $('yb-billing-notes');
    if (!preset) return;

    var val = preset.value;
    if (val === 'bank_ref') {
      if (customRow) customRow.hidden = true;
      if (notesArea) notesArea.value = t('billing_notes_bank_ref_text');
    } else if (val === 'custom') {
      if (customRow) customRow.hidden = false;
      if (notesArea) { notesArea.value = ''; notesArea.focus(); }
    } else {
      if (customRow) customRow.hidden = true;
      if (notesArea) notesArea.value = '';
    }
    updatePreview();
  }

  /* ══════════════════════════════════════════
     PREVIEW
     ══════════════════════════════════════════ */
  function getFormValues() {
    var total = parseFloat(($('yb-billing-total') || {}).value) || 0;
    var instalments = parseInt(($('yb-billing-instalments') || {}).value) || 1;
    var startMonth = ($('yb-billing-start-month') || {}).value || '';
    var description = ($('yb-billing-description') || {}).value || '';
    return { total: total, instalments: instalments, startMonth: startMonth, description: description };
  }

  function buildLines(vals) {
    if (!vals.total || !vals.startMonth) return [];
    var parts = vals.startMonth.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]) - 1;
    var perInstalment = Math.round((vals.total / vals.instalments) * 100) / 100;
    var lines = [];

    for (var i = 0; i < vals.instalments; i++) {
      var m = (month + i) % 12;
      var y = year + Math.floor((month + i) / 12);
      var dateStr = formatDate(y, m, 1);
      var isoStr = isoDate(y, m, 1);
      var desc;
      if (vals.instalments === 1) {
        desc = (vals.description ? vals.description + ' — ' : '') + t('billing_line_full_payment');
      } else {
        desc = (vals.description ? vals.description + ' — ' : '')
          + t('billing_line_instalment') + ' ' + (i + 1) + ' ' + t('billing_line_of') + ' ' + vals.instalments
          + ' — ' + dateStr;
      }

      var amount = (i === vals.instalments - 1) ? vals.total - (perInstalment * (vals.instalments - 1)) : perInstalment;
      amount = Math.round(amount * 100) / 100;

      lines.push({ description: desc, unitNetPrice: amount, quantity: 1, date: isoStr, month: m, year: y });
    }
    return lines;
  }

  function updatePreview() {
    var vals = getFormValues();
    var el = $('yb-billing-preview');
    if (!el) return;

    if (!vals.total || !vals.startMonth) {
      el.innerHTML = '<p class="yb-billing__preview-empty">' + t('billing_preview_empty') + '</p>';
      return;
    }

    var lines = buildLines(vals);
    var perInstalment = lines.length ? lines[0].unitNetPrice : 0;
    var custName = selectedCustomer ? selectedCustomer.name : (selectedApplicant ? selectedApplicant.name : null);

    var html = '';

    // Summary
    html += '<div class="yb-billing__preview-summary">';
    if (custName) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_col_customer') + '</span><span>' + esc(custName);
      if (selectedCustomer) html += ' (#' + selectedCustomer.customerNumber + ')';
      html += '</span></div>';
    } else {
      html += '<div class="yb-billing__preview-row yb-billing__preview-row--missing"><span class="yb-billing__preview-label">' + t('billing_col_customer') + '</span><span>' + (isDa ? '⚠ Ikke valgt endnu' : '⚠ Not selected yet') + '</span></div>';
    }
    if (vals.description) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_description') + '</span><span>' + esc(vals.description) + '</span></div>';
    }
    html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_total') + '</span><span class="yb-billing__preview-amount">' + formatAmount(vals.total) + '</span></div>';
    if (vals.instalments > 1) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_instalments') + '</span><span>' + vals.instalments + ' (' + formatAmount(perInstalment) + ' ' + t('billing_preview_per_instalment') + ')</span></div>';
    }
    var notesVal = ($('yb-billing-notes') || {}).value || '';
    if (notesVal) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_notes') + '</span><span>' + esc(notesVal) + '</span></div>';
    }
    html += '</div>';

    // Lines table
    html += '<h4 class="yb-billing__preview-heading">' + t('billing_preview_schedule') + '</h4>';
    html += '<table class="yb-billing__preview-table"><thead><tr><th>#</th><th>' + t('billing_inv_description') + '</th><th>' + t('billing_col_total') + '</th></tr></thead><tbody>';
    lines.forEach(function (line, i) {
      html += '<tr><td>' + (i + 1) + '</td><td>' + esc(line.description) + '</td><td class="yb-billing__preview-amount">' + formatAmount(line.unitNetPrice) + '</td></tr>';
    });
    html += '</tbody></table>';

    el.innerHTML = html;
  }

  function formatAmount(n) {
    return new Intl.NumberFormat(isDa ? 'da-DK' : 'en-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 }).format(n);
  }

  function updateBtnState() {
    var btn = document.querySelector('[data-action="billing-create-invoice"]');
    if (!btn) return;
    var vals = getFormValues();
    var hasCustomer = selectedCustomer || selectedApplicant;
    var ready = hasCustomer && vals.total && vals.startMonth;
    btn.classList.toggle('yb-btn--muted', !ready);
  }

  /* ══════════════════════════════════════════
     CREATE INVOICE
     ══════════════════════════════════════════ */
  function createInvoice() {
    console.log('[billing] Create invoice clicked');
    if (busy) return;

    // Validate amount + month first
    var vals = getFormValues();
    if (!vals.total) { console.log('[billing] Blocked: no amount'); toast(t('billing_error_no_amount'), true); return; }
    if (!vals.startMonth) { console.log('[billing] Blocked: no month'); toast(t('billing_error_no_month'), true); return; }

    if (!selectedCustomer && !selectedApplicant) {
      console.log('[billing] Blocked: no customer or applicant');
      toast(t('billing_error_no_customer'), true);
      return;
    }

    // If applicant selected but no e-conomic customer yet, auto-create from form
    if (selectedApplicant && !selectedCustomer) {
      console.log('[billing] Applicant selected without e-conomic customer — auto-creating...');
      autoCreateCustomerThenInvoice(vals);
      return;
    }

    // Customer already selected — go straight to invoice
    sendInvoice(vals);
  }

  /**
   * Auto-create e-conomic customer from the pre-filled new customer form,
   * then immediately create the invoice. One-click flow for applicants.
   */
  function autoCreateCustomerThenInvoice(vals) {
    var name = ($('yb-billing-nc-name') || {}).value || (selectedApplicant ? selectedApplicant.name : '');
    if (!name.trim()) {
      console.log('[billing] Blocked: no customer name for auto-create');
      toast(isDa ? 'Kundenavn mangler — udfyld kundeformularen' : 'Customer name missing — fill in the customer form', true);
      return;
    }

    var customer = {
      name: name.trim(),
      email: ($('yb-billing-nc-email') || {}).value || '',
      address: ($('yb-billing-nc-address') || {}).value || '',
      zip: ($('yb-billing-nc-zip') || {}).value || '',
      city: ($('yb-billing-nc-city') || {}).value || '',
      phone: ($('yb-billing-nc-phone') || {}).value || '',
      corporateIdentificationNumber: ($('yb-billing-nc-cvr') || {}).value || '',
      customerGroupNumber: parseInt(($('yb-billing-nc-group') || {}).value) || 1,
      vatZoneNumber: parseInt(($('yb-billing-nc-vat') || {}).value) || 1,
      paymentTermsNumber: parseInt(($('yb-billing-nc-payment') || {}).value) || 1
    };

    var btn = document.querySelector('[data-action="billing-create-invoice"]');
    busy = true;
    if (btn) { btn.textContent = isDa ? 'Opretter kunde...' : 'Creating customer...'; btn.classList.add('yb-btn--muted'); }

    console.log('[billing] Auto-creating customer:', customer.name);
    apiCall({ action: 'createCustomer', customer: customer }).then(function (res) {
      if (!res.ok) {
        busy = false;
        if (btn) { btn.textContent = t('billing_create_draft'); btn.classList.remove('yb-btn--muted'); }
        console.error('[billing] Auto-create customer failed:', res.error);
        toast(res.error, true);
        return;
      }
      var c = res.data;
      console.log('[billing] Customer auto-created:', c.customerNumber, c.name);
      toast(t('billing_customer_created'));
      selectCustomer(c.customerNumber, c.name, c.email || customer.email);

      // Hide the new customer form
      var ncForm = $('yb-billing-new-customer-form');
      if (ncForm) ncForm.hidden = true;

      // Now create the invoice
      if (btn) { btn.textContent = isDa ? 'Opretter faktura...' : 'Creating invoice...'; }
      sendInvoice(vals);
    }).catch(function (err) {
      busy = false;
      if (btn) { btn.textContent = t('billing_create_draft'); btn.classList.remove('yb-btn--muted'); }
      console.error('[billing] Auto-create customer error:', err);
      toast(err.message, true);
    });
  }

  /**
   * Build and send the invoice to e-conomic.
   * Requires selectedCustomer to be set.
   */
  function sendInvoice(vals) {
    var lines = buildLines(vals);
    var paymentTermsNum = parseInt(($('yb-billing-payment-terms') || {}).value) || 1;
    var layoutNum = parseInt(($('yb-billing-layout') || {}).value) || (settings.layouts.length ? settings.layouts[0].layoutNumber : 19);
    var notes = ($('yb-billing-notes') || {}).value || '';
    var ref = ($('yb-billing-ref') || {}).value || '';

    var invoice = {
      customerNumber: selectedCustomer.customerNumber,
      recipientName: selectedCustomer.name,
      date: lines[0].date,
      dueDate: lines[0].date,
      paymentTermsNumber: paymentTermsNum,
      layoutNumber: layoutNum,
      currency: 'DKK',
      lines: lines.map(function (l) {
        return { description: l.description, unitNetPrice: l.unitNetPrice, quantity: 1 };
      })
    };
    if (notes) invoice.notes = notes;
    if (ref) invoice.references = { text1: ref };

    console.log('[billing] Sending invoice:', JSON.stringify(invoice, null, 2));

    var btn = document.querySelector('[data-action="billing-create-invoice"]');
    busy = true;
    if (btn) { btn.textContent = isDa ? 'Opretter faktura...' : 'Creating invoice...'; btn.classList.add('yb-btn--muted'); }

    apiCall({ action: 'createInvoice', invoice: invoice }).then(function (res) {
      busy = false;
      if (btn) { btn.textContent = t('billing_create_draft'); btn.classList.remove('yb-btn--muted'); }
      if (!res.ok) {
        console.error('[billing] Invoice creation failed:', res.error);
        toast(res.error, true);
        return;
      }
      console.log('[billing] Invoice created:', res.data);
      toast(t('billing_invoice_created'));
      resetForm();
    }).catch(function (err) {
      busy = false;
      if (btn) { btn.textContent = t('billing_create_draft'); btn.classList.remove('yb-btn--muted'); }
      console.error('[billing] Invoice error:', err);
      toast(err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     MASTER: CREATE, BOOK & SEND (one-click)
     ══════════════════════════════════════════ */
  function createBookAndSend() {
    console.log('[billing] Master: Create, Book & Send clicked');
    if (busy) return;

    var vals = getFormValues();
    if (!vals.total) { toast(t('billing_error_no_amount'), true); return; }
    if (!vals.startMonth) { toast(t('billing_error_no_month'), true); return; }
    if (!selectedCustomer && !selectedApplicant) { toast(t('billing_error_no_customer'), true); return; }

    var btn = document.querySelector('[data-action="billing-create-book-send"]');
    busy = true;

    // Determine customer email for sending later
    var customerEmail = selectedCustomer ? (selectedCustomer.email || '') : (selectedApplicant ? (selectedApplicant.email || '') : '');

    // Step 1: Create customer if needed
    if (selectedApplicant && !selectedCustomer) {
      var name = ($('yb-billing-nc-name') || {}).value || (selectedApplicant ? selectedApplicant.name : '');
      if (!name.trim()) {
        busy = false;
        toast(isDa ? 'Kundenavn mangler — udfyld kundeformularen' : 'Customer name missing — fill in the customer form', true);
        return;
      }
      var customer = {
        name: name.trim(),
        email: ($('yb-billing-nc-email') || {}).value || '',
        address: ($('yb-billing-nc-address') || {}).value || '',
        zip: ($('yb-billing-nc-zip') || {}).value || '',
        city: ($('yb-billing-nc-city') || {}).value || '',
        phone: ($('yb-billing-nc-phone') || {}).value || '',
        corporateIdentificationNumber: ($('yb-billing-nc-cvr') || {}).value || '',
        customerGroupNumber: parseInt(($('yb-billing-nc-group') || {}).value) || 1,
        vatZoneNumber: parseInt(($('yb-billing-nc-vat') || {}).value) || 1,
        paymentTermsNumber: parseInt(($('yb-billing-nc-payment') || {}).value) || 1
      };

      if (btn) btn.textContent = t('billing_master_creating_customer');
      customerEmail = customer.email || customerEmail;

      apiCall({ action: 'createCustomer', customer: customer }).then(function (res) {
        if (!res.ok) { busy = false; if (btn) btn.textContent = t('billing_create_book_send'); toast(res.error, true); return; }
        var c = res.data;
        selectCustomer(c.customerNumber, c.name, c.email || customer.email);
        var ncForm = $('yb-billing-new-customer-form');
        if (ncForm) ncForm.hidden = true;
        masterCreateInvoice(vals, btn, customerEmail);
      }).catch(function (err) { busy = false; if (btn) btn.textContent = t('billing_create_book_send'); toast(err.message, true); });
      return;
    }

    // Customer already selected — go straight to invoice
    masterCreateInvoice(vals, btn, customerEmail);
  }

  function masterCreateInvoice(vals, btn, customerEmail) {
    if (btn) btn.textContent = t('billing_master_creating_invoice');

    var lines = buildLines(vals);
    var paymentTermsNum = parseInt(($('yb-billing-payment-terms') || {}).value) || 1;
    var layoutNum = parseInt(($('yb-billing-layout') || {}).value) || (settings.layouts.length ? settings.layouts[0].layoutNumber : 19);
    var notes = ($('yb-billing-notes') || {}).value || '';
    var ref = ($('yb-billing-ref') || {}).value || '';

    var invoice = {
      customerNumber: selectedCustomer.customerNumber,
      recipientName: selectedCustomer.name,
      date: lines[0].date,
      dueDate: lines[0].date,
      paymentTermsNumber: paymentTermsNum,
      layoutNumber: layoutNum,
      currency: 'DKK',
      lines: lines.map(function (l) {
        return { description: l.description, unitNetPrice: l.unitNetPrice, quantity: 1 };
      })
    };
    if (notes) invoice.notes = notes;
    if (ref) invoice.references = { text1: ref };

    console.log('[billing] Master: Creating draft invoice...');
    apiCall({ action: 'createInvoice', invoice: invoice }).then(function (res) {
      if (!res.ok) { busy = false; if (btn) btn.textContent = t('billing_create_book_send'); toast(res.error, true); return; }
      var draft = res.data;
      var draftNum = draft.draftInvoiceNumber;
      console.log('[billing] Master: Draft created #' + draftNum + ', booking...');
      masterBookInvoice(draftNum, btn, customerEmail);
    }).catch(function (err) { busy = false; if (btn) btn.textContent = t('billing_create_book_send'); toast(err.message, true); });
  }

  function masterBookInvoice(draftNumber, btn, customerEmail) {
    if (btn) btn.textContent = t('billing_master_booking');

    console.log('[billing] Master: Booking draft #' + draftNumber + '...');
    apiCall({ action: 'bookInvoice', draftNumber: draftNumber }).then(function (res) {
      if (!res.ok) { busy = false; if (btn) btn.textContent = t('billing_create_book_send'); toast(res.error, true); return; }
      var booked = res.data;
      var bookedNum = booked.bookedInvoiceNumber;
      console.log('[billing] Master: Booked as #' + bookedNum + ', sending email...');
      masterSendEmail(bookedNum, btn, customerEmail);
    }).catch(function (err) { busy = false; if (btn) btn.textContent = t('billing_create_book_send'); toast(err.message, true); });
  }

  function masterSendEmail(bookedNumber, btn, customerEmail) {
    // If no email, skip sending and inform admin
    if (!customerEmail) {
      busy = false;
      if (btn) btn.textContent = t('billing_create_book_send');
      toast(t('billing_master_no_email'));
      resetForm();
      return;
    }

    // Prompt admin to confirm/edit the email address
    var email = prompt(isDa
      ? 'Faktura er bogført! Send til denne email:'
      : 'Invoice booked! Send to this email:', customerEmail);

    if (!email) {
      // Admin cancelled — still a success (invoice was created and booked)
      busy = false;
      if (btn) btn.textContent = t('billing_create_book_send');
      toast(isDa ? 'Faktura oprettet & bogført! Email ikke sendt.' : 'Invoice created & booked! Email not sent.');
      resetForm();
      return;
    }

    email = email.trim();
    if (!email || email.indexOf('@') < 1) {
      busy = false;
      if (btn) btn.textContent = t('billing_create_book_send');
      toast(isDa ? 'Ugyldig email — faktura er bogført men ikke sendt.' : 'Invalid email — invoice booked but not sent.', true);
      resetForm();
      return;
    }

    if (btn) btn.textContent = t('billing_master_sending');
    console.log('[billing] Master: Sending invoice #' + bookedNumber + ' to ' + email);

    apiCall({ action: 'sendInvoice', bookedNumber: bookedNumber, email: email }).then(function (res) {
      busy = false;
      if (!res.ok) {
        if (btn) btn.textContent = t('billing_create_book_send');
        toast(isDa ? 'Faktura bogført men email fejlede: ' + res.error : 'Invoice booked but email failed: ' + res.error, true);
        return;
      }
      console.log('[billing] Master: All done! Invoice #' + bookedNumber + ' sent to ' + email);
      if (btn) { btn.textContent = t('billing_master_done'); setTimeout(function () { btn.textContent = '⚡ ' + t('billing_create_book_send'); }, 3000); }
      toast(t('billing_master_done'));
      resetForm();
    }).catch(function (err) {
      busy = false;
      if (btn) btn.textContent = t('billing_create_book_send');
      toast(isDa ? 'Faktura bogført men email fejlede: ' + err.message : 'Invoice booked but email failed: ' + err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     DRAFTS LIST
     ══════════════════════════════════════════ */
  function showDrafts() {
    $('yb-billing-v-create').hidden = true;
    $('yb-billing-v-drafts').hidden = false;
    var bookedView = $('yb-billing-v-booked');
    if (bookedView) bookedView.hidden = true;
    loadDrafts();
  }

  function showCreate() {
    $('yb-billing-v-create').hidden = false;
    $('yb-billing-v-drafts').hidden = true;
    var bookedView = $('yb-billing-v-booked');
    if (bookedView) bookedView.hidden = true;
  }

  function loadDrafts() {
    apiCall({ action: 'listDrafts' }).then(function (res) {
      if (!res.ok) { toast(res.error, true); return; }
      renderDrafts(res.data.drafts || []);
    }).catch(function (err) { toast(err.message, true); });
  }

  function renderDrafts(drafts) {
    var body = $('yb-billing-drafts-body');
    var empty = $('yb-billing-drafts-empty');
    if (!body) return;

    if (!drafts.length) {
      body.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    body.innerHTML = drafts.map(function (d) {
      var custName = d.customer ? d.customer.customerNumber : '—';
      if (d.recipient && d.recipient.name) custName = d.recipient.name;
      var total = d.grossAmount != null ? formatAmount(d.grossAmount) : (d.netAmount != null ? formatAmount(d.netAmount) : '—');
      var lineCount = d.lines ? d.lines.length : '—';
      return '<tr>'
        + '<td>' + d.draftInvoiceNumber + '</td>'
        + '<td>' + esc(custName) + '</td>'
        + '<td>' + (d.date || '—') + '</td>'
        + '<td>' + (d.dueDate || '—') + '</td>'
        + '<td>' + total + '</td>'
        + '<td>' + lineCount + '</td>'
        + '<td><button class="yb-btn yb-btn--outline yb-btn--sm" data-action="billing-view-draft" data-draft="' + d.draftInvoiceNumber + '">' + (isDa ? 'Vis' : 'View') + '</button></td>'
        + '</tr>';
    }).join('');
  }

  /* ══════════════════════════════════════════
     DRAFT DETAIL MODAL
     ══════════════════════════════════════════ */
  function viewDraft(draftNumber) {
    currentDraftNumber = parseInt(draftNumber);
    currentBookedNumber = null;
    currentBookedEmail = null;
    var modal = $('yb-billing-draft-modal');
    var body = $('yb-billing-modal-body');
    var title = $('yb-billing-modal-title');
    var bookBtn = document.querySelector('[data-action="billing-book-draft"]');
    var sendBtn = document.querySelector('[data-action="billing-send-invoice"]');
    var pdfBtn = document.querySelector('[data-action="billing-download-pdf"]');
    if (!modal || !body) return;
    if (title) title.textContent = t('billing_draft_detail');
    if (bookBtn) bookBtn.hidden = false;
    if (sendBtn) sendBtn.hidden = true;
    if (pdfBtn) pdfBtn.hidden = true;
    body.innerHTML = '<p>' + t('loading') + '</p>';
    modal.hidden = false;

    apiCall({ action: 'getDraft', draftNumber: currentDraftNumber }).then(function (res) {
      if (!res.ok) { body.innerHTML = '<p class="yb-billing__error">' + esc(res.error) + '</p>'; return; }
      renderDraftDetail(res.data);
    }).catch(function (err) { body.innerHTML = '<p class="yb-billing__error">' + esc(err.message) + '</p>'; });
  }

  function renderDraftDetail(d) {
    var body = $('yb-billing-modal-body');
    if (!body) return;
    var html = '<div class="yb-billing__detail">';
    html += '<div class="yb-billing__detail-row"><strong>' + t('billing_col_customer') + ':</strong> ' + esc(d.recipient && d.recipient.name || '—') + '</div>';
    html += '<div class="yb-billing__detail-row"><strong>' + t('billing_col_date') + ':</strong> ' + (d.date || '—') + '</div>';
    html += '<div class="yb-billing__detail-row"><strong>' + t('billing_col_due') + ':</strong> ' + (d.dueDate || '—') + '</div>';
    html += '<div class="yb-billing__detail-row"><strong>' + t('billing_col_total') + ':</strong> ' + (d.grossAmount != null ? formatAmount(d.grossAmount) : formatAmount(d.netAmount || 0)) + '</div>';
    if (d.notes && d.notes.heading) {
      html += '<div class="yb-billing__detail-row"><strong>' + t('billing_inv_notes') + ':</strong> ' + esc(d.notes.heading) + '</div>';
    }
    if (d.lines && d.lines.length) {
      html += '<table class="yb-billing__preview-table"><thead><tr><th>#</th><th>' + t('billing_inv_description') + '</th><th>' + t('billing_col_total') + '</th></tr></thead><tbody>';
      d.lines.forEach(function (line, i) {
        html += '<tr><td>' + (i + 1) + '</td><td>' + esc(line.description) + '</td><td>' + formatAmount(line.totalNetAmount || line.unitNetPrice || 0) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    body.innerHTML = html;
  }

  function closeDraftModal() {
    var modal = $('yb-billing-draft-modal');
    if (modal) modal.hidden = true;
    currentDraftNumber = null;
    currentBookedNumber = null;
    currentBookedEmail = null;
  }

  function bookDraft() {
    if (!currentDraftNumber) return;
    if (!confirm(t('billing_confirm_book'))) return;
    apiCall({ action: 'bookInvoice', draftNumber: currentDraftNumber }).then(function (res) {
      if (!res.ok) { toast(res.error, true); return; }
      toast(t('billing_booked'));
      closeDraftModal();
      loadDrafts();
    }).catch(function (err) { toast(err.message, true); });
  }

  /* ══════════════════════════════════════════
     BOOKED INVOICES
     ══════════════════════════════════════════ */
  function showBooked() {
    $('yb-billing-v-create').hidden = true;
    $('yb-billing-v-drafts').hidden = true;
    $('yb-billing-v-booked').hidden = false;
    loadBooked();
  }

  function loadBooked() {
    apiCall({ action: 'listBooked' }).then(function (res) {
      if (!res.ok) { toast(res.error, true); return; }
      renderBooked(res.data.invoices || []);
    }).catch(function (err) { toast(err.message, true); });
  }

  function renderBooked(invoices) {
    var body = $('yb-billing-booked-body');
    var empty = $('yb-billing-booked-empty');
    if (!body) return;

    if (!invoices.length) {
      body.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    body.innerHTML = invoices.map(function (inv) {
      var custName = inv.recipient && inv.recipient.name ? inv.recipient.name : '—';
      var total = inv.grossAmount != null ? formatAmount(inv.grossAmount) : (inv.netAmount != null ? formatAmount(inv.netAmount) : '—');
      var remainder = inv.remainder != null ? formatAmount(inv.remainder) : '—';
      var isPaid = inv.remainder != null && inv.remainder === 0;
      var isPartial = inv.remainder != null && inv.remainder > 0 && inv.remainder < (inv.grossAmount || inv.netAmount || 0);
      var statusLabel = isPaid ? t('billing_status_paid') : (isPartial ? t('billing_status_partial') : t('billing_status_unpaid'));
      var statusClass = isPaid ? 'yb-billing__status--paid' : (isPartial ? 'yb-billing__status--partial' : 'yb-billing__status--unpaid');

      return '<tr>'
        + '<td>' + inv.bookedInvoiceNumber + '</td>'
        + '<td>' + esc(custName) + '</td>'
        + '<td>' + (inv.date || '—') + '</td>'
        + '<td>' + (inv.dueDate || '—') + '</td>'
        + '<td>' + total + '</td>'
        + '<td>' + remainder + '</td>'
        + '<td><span class="' + statusClass + '">' + statusLabel + '</span></td>'
        + '<td><button class="yb-btn yb-btn--outline yb-btn--sm" data-action="billing-view-booked-detail" data-booked="' + inv.bookedInvoiceNumber + '">' + (isDa ? 'Vis' : 'View') + '</button></td>'
        + '</tr>';
    }).join('');
  }

  function viewBookedDetail(bookedNumber) {
    currentBookedNumber = parseInt(bookedNumber);
    currentBookedEmail = null;
    currentDraftNumber = null;
    var modal = $('yb-billing-draft-modal');
    var body = $('yb-billing-modal-body');
    var title = $('yb-billing-modal-title');
    var bookBtn = document.querySelector('[data-action="billing-book-draft"]');
    var sendBtn = document.querySelector('[data-action="billing-send-invoice"]');
    var pdfBtn = document.querySelector('[data-action="billing-download-pdf"]');
    if (!modal || !body) return;

    if (title) title.textContent = t('billing_booked_title') + ' #' + bookedNumber;
    if (bookBtn) bookBtn.hidden = true;
    if (sendBtn) sendBtn.hidden = false;
    if (pdfBtn) pdfBtn.hidden = false;
    body.innerHTML = '<p>' + t('loading') + '</p>';
    modal.hidden = false;

    apiCall({ action: 'getBooked', bookedNumber: currentBookedNumber }).then(function (res) {
      if (!res.ok) { body.innerHTML = '<p class="yb-billing__error">' + esc(res.error) + '</p>'; return; }
      var d = res.data;

      // Try to extract customer email for send button
      if (d.customer && d.customer.customerNumber) {
        apiCall({ action: 'searchCustomers', query: (d.recipient && d.recipient.name) || '' }).then(function (sr) {
          if (sr.ok && sr.data) {
            var match = sr.data.find(function (c) { return c.customerNumber === d.customer.customerNumber; });
            if (match && match.email) {
              currentBookedEmail = match.email;
              console.log('[billing] Booked invoice customer email:', currentBookedEmail);
            }
          }
        });
      }

      var html = '<div class="yb-billing__detail">';
      html += '<div class="yb-billing__detail-row"><strong>' + t('billing_col_customer') + ':</strong> ' + esc(d.recipient && d.recipient.name || '—') + '</div>';
      html += '<div class="yb-billing__detail-row"><strong>' + t('billing_col_date') + ':</strong> ' + (d.date || '—') + '</div>';
      html += '<div class="yb-billing__detail-row"><strong>' + t('billing_col_due') + ':</strong> ' + (d.dueDate || '—') + '</div>';
      html += '<div class="yb-billing__detail-row"><strong>' + t('billing_col_total') + ':</strong> ' + (d.grossAmount != null ? formatAmount(d.grossAmount) : formatAmount(d.netAmount || 0)) + '</div>';
      if (d.remainder != null) {
        var isPaid = d.remainder === 0;
        html += '<div class="yb-billing__detail-row"><strong>' + t('billing_col_remainder') + ':</strong> ' + formatAmount(d.remainder) + ' <span class="' + (isPaid ? 'yb-billing__status--paid' : 'yb-billing__status--unpaid') + '">' + (isPaid ? t('billing_status_paid') : t('billing_status_unpaid')) + '</span></div>';
      }
      if (d.lines && d.lines.length) {
        html += '<table class="yb-billing__preview-table"><thead><tr><th>#</th><th>' + t('billing_inv_description') + '</th><th>' + t('billing_col_total') + '</th></tr></thead><tbody>';
        d.lines.forEach(function (line, i) {
          html += '<tr><td>' + (i + 1) + '</td><td>' + esc(line.description) + '</td><td>' + formatAmount(line.totalNetAmount || line.unitNetPrice || 0) + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';
      body.innerHTML = html;
    }).catch(function (err) { body.innerHTML = '<p class="yb-billing__error">' + esc(err.message) + '</p>'; });
  }

  /* ══════════════════════════════════════════
     SEND INVOICE / DOWNLOAD PDF
     ══════════════════════════════════════════ */
  function sendInvoiceEmail() {
    if (!currentBookedNumber) return;

    var email = currentBookedEmail || '';
    var inputEmail = prompt(isDa
      ? 'Send faktura #' + currentBookedNumber + ' til email:\n(PDF vedhæftes automatisk)'
      : 'Send invoice #' + currentBookedNumber + ' to email:\n(PDF will be attached)', email);

    if (!inputEmail) return; // cancelled
    inputEmail = inputEmail.trim();
    if (!inputEmail || inputEmail.indexOf('@') < 1) {
      toast(isDa ? 'Ugyldig email-adresse' : 'Invalid email address', true);
      return;
    }

    var sendBtn = document.querySelector('[data-action="billing-send-invoice"]');
    if (sendBtn) { sendBtn.textContent = isDa ? 'Sender...' : 'Sending...'; sendBtn.classList.add('yb-btn--muted'); }

    console.log('[billing] Sending invoice', currentBookedNumber, 'to', inputEmail);
    apiCall({ action: 'sendInvoice', bookedNumber: currentBookedNumber, email: inputEmail }).then(function (res) {
      if (sendBtn) { sendBtn.innerHTML = '&#9993; ' + t('billing_send_invoice'); sendBtn.classList.remove('yb-btn--muted'); }
      if (!res.ok) {
        console.error('[billing] Send invoice failed:', res.error);
        toast(res.error, true);
        return;
      }
      console.log('[billing] Invoice sent:', res.data);
      toast(isDa ? 'Faktura sendt til ' + inputEmail : 'Invoice sent to ' + inputEmail);
    }).catch(function (err) {
      if (sendBtn) { sendBtn.innerHTML = '&#9993; ' + t('billing_send_invoice'); sendBtn.classList.remove('yb-btn--muted'); }
      console.error('[billing] Send invoice error:', err);
      toast(err.message, true);
    });
  }

  function downloadInvoicePdf() {
    if (!currentBookedNumber) return;

    var pdfBtn = document.querySelector('[data-action="billing-download-pdf"]');
    if (pdfBtn) { pdfBtn.textContent = isDa ? 'Henter...' : 'Loading...'; pdfBtn.classList.add('yb-btn--muted'); }

    console.log('[billing] Getting PDF for invoice', currentBookedNumber);
    apiCall({ action: 'getInvoicePdf', bookedNumber: currentBookedNumber }).then(function (res) {
      if (pdfBtn) { pdfBtn.innerHTML = '&#128196; ' + t('billing_download_pdf'); pdfBtn.classList.remove('yb-btn--muted'); }
      if (!res.ok) {
        console.error('[billing] Get PDF failed:', res.error);
        toast(res.error, true);
        return;
      }
      if (res.data && res.data.download) {
        window.open(res.data.download, '_blank');
      } else {
        toast(isDa ? 'Kunne ikke hente PDF-link' : 'Could not get PDF link', true);
      }
    }).catch(function (err) {
      if (pdfBtn) { pdfBtn.innerHTML = '&#128196; ' + t('billing_download_pdf'); pdfBtn.classList.remove('yb-btn--muted'); }
      toast(err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     BILL FROM APPLICATION TAB
     ══════════════════════════════════════════ */
  // Called from lead-admin.js via window.billingFromApp()
  window.billingFromApp = function (appData) {
    console.log('[billing] Bill from application:', appData);

    // Switch to billing tab
    var billingTabBtn = document.querySelector('[data-yb-admin-tab="billing"]');
    if (billingTabBtn) billingTabBtn.click();

    // Ensure settings are loaded
    if (!settingsLoaded && !settingsLoading) loadSettings();

    // Show create view
    showCreate();

    // Show applicant banner
    var banner = $('yb-billing-applicant-banner');
    var bannerInfo = $('yb-billing-applicant-info');
    if (banner && bannerInfo) {
      bannerInfo.textContent = t('billing_billing_for') + ': ' + (appData.name || '') + (appData.appId ? ' (' + appData.appId + ')' : '');
      banner.hidden = false;
    }

    // Select applicant
    selectApplicant({
      appName: appData.name || '',
      appEmail: appData.email || '',
      appPhone: appData.phone || '',
      appCourse: appData.course || '',
      appType: appData.type || '',
      appId: appData.appId || ''
    });

    // Switch source to applicants
    switchSource('applicants');
  };

  /* ══════════════════════════════════════════
     RESET
     ══════════════════════════════════════════ */
  function resetForm() {
    selectedCustomer = null;
    selectedApplicant = null;
    $('yb-billing-selected-customer').hidden = true;
    var ncForm = $('yb-billing-new-customer-form');
    if (ncForm) ncForm.hidden = true;
    $('yb-billing-customer-results') && ($('yb-billing-customer-results').hidden = true);
    $('yb-billing-applicant-results') && ($('yb-billing-applicant-results').hidden = true);
    var banner = $('yb-billing-applicant-banner');
    if (banner) banner.hidden = true;

    var fields = ['yb-billing-customer-search', 'yb-billing-applicant-search', 'yb-billing-total', 'yb-billing-description', 'yb-billing-notes', 'yb-billing-ref',
      'yb-billing-nc-name', 'yb-billing-nc-email', 'yb-billing-nc-address', 'yb-billing-nc-zip', 'yb-billing-nc-city', 'yb-billing-nc-phone', 'yb-billing-nc-cvr'];
    fields.forEach(function (id) { var el = $(id); if (el) el.value = ''; });

    var instSel = $('yb-billing-instalments');
    if (instSel) instSel.value = '1';

    var presetSel = $('yb-billing-desc-preset');
    if (presetSel) presetSel.value = '';

    var notesPreset = $('yb-billing-notes-preset');
    if (notesPreset) notesPreset.value = '';
    var notesCustomRow = $('yb-billing-notes-custom-row');
    if (notesCustomRow) notesCustomRow.hidden = true;

    var now = new Date();
    var monthInput = $('yb-billing-start-month');
    if (monthInput) monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    switchSource('economic');
    updatePreview();
    updateBtnState();
  }

  /* ══════════════════════════════════════════
     EVENT DELEGATION
     ══════════════════════════════════════════ */
  function isBillingAction(action) {
    return action && action.indexOf('billing-') === 0;
  }

  function handleAction(action, el) {
    switch (action) {
      case 'billing-search-customer': searchCustomers(); break;
      case 'billing-search-applicants': searchApplicants(); break;
      case 'billing-new-customer': showNewCustomerForm(); break;
      case 'billing-save-customer': saveNewCustomer(); break;
      case 'billing-cancel-new-customer': cancelNewCustomer(); break;
      case 'billing-clear-customer': clearCustomer(); break;
      case 'billing-clear-applicant': clearCustomer(); break;
      case 'billing-select-customer':
        selectCustomer(el.dataset.customerNumber, el.dataset.customerName, el.dataset.customerEmail);
        break;
      case 'billing-select-applicant':
        selectApplicant(el.dataset);
        break;
      case 'billing-source-economic': switchSource('economic'); break;
      case 'billing-source-applicants': switchSource('applicants'); break;
      case 'billing-create-invoice': createInvoice(); break;
      case 'billing-create-book-send': createBookAndSend(); break;
      case 'billing-reset-form': resetForm(); break;
      case 'billing-view-drafts': showDrafts(); break;
      case 'billing-back-create': showCreate(); break;
      case 'billing-refresh-drafts': loadDrafts(); break;
      case 'billing-refresh-settings': loadSettings(); break;
      case 'billing-view-draft': viewDraft(el.dataset.draft); break;
      case 'billing-book-draft': bookDraft(); break;
      case 'billing-view-booked': showBooked(); break;
      case 'billing-refresh-booked': loadBooked(); break;
      case 'billing-view-booked-detail': viewBookedDetail(el.dataset.booked); break;
      case 'billing-send-invoice': sendInvoiceEmail(); break;
      case 'billing-download-pdf': downloadInvoicePdf(); break;
      case 'billing-from-app': handleBillFromApp(); break;
    }
  }

  function handleBillFromApp() {
    // Read current application from lead-admin's global currentApp
    // This is called from the applications detail view
    if (window._ybCurrentApp) {
      var a = window._ybCurrentApp;
      window.billingFromApp({
        name: ((a.first_name || '') + ' ' + (a.last_name || '')).trim(),
        email: a.email || '',
        phone: a.phone || '',
        course: a.course_name || '',
        type: a.type || a.program_type || '',
        appId: a.app_id || a.id || ''
      });
    }
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function init() {
    T = window._ybAdminT || {};
    isDa = (window._ybAdminLang || 'da') === 'da';
    console.log('[billing] Init, lang=' + (isDa ? 'da' : 'en'));

    // Event delegation — only handle billing-* actions
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (btn && isBillingAction(btn.dataset.action)) {
        handleAction(btn.dataset.action, btn);
      }
      if (e.target.closest('[data-close-billing-modal]')) closeDraftModal();
    });

    // Search on enter
    ['yb-billing-customer-search', 'yb-billing-applicant-search'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (id.includes('applicant')) searchApplicants();
            else searchCustomers();
          }
        });
      }
    });

    // Live preview on changes
    ['yb-billing-total', 'yb-billing-instalments', 'yb-billing-start-month', 'yb-billing-description'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.addEventListener('input', function () { updatePreview(); updateBtnState(); });
        el.addEventListener('change', function () { updatePreview(); updateBtnState(); });
      }
    });

    // Description preset change
    var presetSel = $('yb-billing-desc-preset');
    if (presetSel) presetSel.addEventListener('change', handleDescPresetChange);

    // Notes preset change
    var notesPresetSel = $('yb-billing-notes-preset');
    if (notesPresetSel) notesPresetSel.addEventListener('change', handleNotesPresetChange);

    // Set default start month
    var now = new Date();
    var monthInput = $('yb-billing-start-month');
    if (monthInput && !monthInput.value) {
      monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }

    // Load settings when billing tab is activated
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-yb-admin-tab="billing"]');
      if (tab && !settingsLoaded && !settingsLoading) loadSettings();
    });

    console.log('[billing] Ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
