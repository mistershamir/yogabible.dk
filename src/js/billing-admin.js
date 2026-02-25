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
  var extraLines = []; // { description, amount } — custom lines appended to invoice

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
    }).then(function (res) {
      // Handle non-JSON responses (e.g. 502 timeout, 504 gateway errors)
      return res.text().then(function (text) {
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error('[billing] Non-JSON response (' + res.status + '):', text.substring(0, 200));
          var msg = res.status === 502 || res.status === 504
            ? (isDa ? 'Serveren svarede for langsomt (timeout). Prøv igen.' : 'Server timed out. Please try again.')
            : (isDa ? 'Serverfejl (' + res.status + '). Prøv igen.' : 'Server error (' + res.status + '). Please try again.');
          return { ok: false, error: msg };
        }
      });
    });
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
     INVOICE ↔ APPLICATION TRACKING
     ══════════════════════════════════════════ */
  /**
   * Save invoice metadata to the application's Firestore doc.
   * Only runs if the invoice was created from the "Bill Applicant" flow
   * (selectedApplicant with appId). Merges into `invoice` field on doc.
   */
  function saveInvoiceToApp(invoiceData) {
    if (!selectedApplicant || !selectedApplicant.appId) return;
    var appId = selectedApplicant.appId;
    var fdb = firebase.firestore();
    // Find the Firestore doc ID (appId may be the custom app_id field, not doc ID)
    fdb.collection('applications').where('app_id', '==', appId).limit(1).get()
      .then(function (snap) {
        if (!snap.empty) return { docId: snap.docs[0].id, existing: snap.docs[0].data().invoice || {} };
        // Try direct doc ID lookup
        return fdb.collection('applications').doc(appId).get().then(function (doc) {
          if (doc.exists) return { docId: doc.id, existing: doc.data().invoice || {} };
          return null;
        });
      })
      .then(function (result) {
        if (!result || !result.docId) { console.log('[billing] No app doc found for', appId); return; }
        // Merge with existing invoice data
        var merged = {};
        Object.keys(result.existing).forEach(function (k) { merged[k] = result.existing[k]; });
        Object.keys(invoiceData).forEach(function (k) { merged[k] = invoiceData[k]; });
        return fdb.collection('applications').doc(result.docId).update({
          invoice: merged,
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      })
      .then(function () {
        console.log('[billing] Invoice data saved to app:', appId, invoiceData);
        // Notify lead-admin to refresh if it has the app open
        if (window._ybRefreshAppInvoice) window._ybRefreshAppInvoice();
      })
      .catch(function (err) {
        console.error('[billing] Failed to save invoice to app doc:', err);
      });
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

    // Products
    var products = settings.products || [];
    var prodOpts = products.map(function (p) {
      return '<option value="' + esc(p.productNumber) + '">' + esc(p.productNumber + ' — ' + p.name) + '</option>';
    }).join('');
    if (!prodOpts) prodOpts = '<option value="">' + (isDa ? 'Ingen produkter fundet' : 'No products found') + '</option>';
    var prodSel = $('yb-billing-product');
    if (prodSel) prodSel.innerHTML = prodOpts;
  }

  /* ══════════════════════════════════════════
     E-CONOMIC CUSTOMER SEARCH (dedicated)
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

  /* ══════════════════════════════════════════
     UNIFIED CUSTOMER SEARCH
     (searches e-conomic, applicants, and users)
     ══════════════════════════════════════════ */
  function unifiedSearch() {
    var q = ($('yb-billing-unified-search') || {}).value || '';
    if (q.length < 2) { toast(isDa ? 'Skriv mindst 2 tegn' : 'Type at least 2 characters', true); return; }
    console.log('[billing] Unified search:', q);

    var resultsEl = $('yb-billing-unified-results');
    if (resultsEl) {
      resultsEl.innerHTML = '<p style="padding:0.5rem;color:var(--yb-muted)">' + (isDa ? 'Søger...' : 'Searching...') + '</p>';
      resultsEl.hidden = false;
    }

    var qLower = q.toLowerCase();

    // Run all three searches in parallel
    var econPromise = apiCall({ action: 'searchCustomers', query: q })
      .then(function (res) { return (res.ok ? res.data : []) || []; })
      .catch(function () { return []; });

    var fdb = firebase.firestore();
    var appPromise = fdb.collection('applications').orderBy('created_at', 'desc').limit(200).get()
      .then(function (snap) {
        var results = [];
        snap.forEach(function (doc) {
          var d = doc.data();
          d.id = doc.id;
          var match = (d.first_name || '').toLowerCase().includes(qLower)
            || (d.last_name || '').toLowerCase().includes(qLower)
            || (d.email || '').toLowerCase().includes(qLower)
            || ((d.first_name || '') + ' ' + (d.last_name || '')).toLowerCase().includes(qLower);
          if (match) results.push(d);
        });
        return results;
      })
      .catch(function () { return []; });

    var userPromise = fdb.collection('users').limit(500).get()
      .then(function (snap) {
        var results = [];
        snap.forEach(function (doc) {
          var d = doc.data();
          d.id = doc.id;
          var name = (d.name || ((d.firstName || '') + ' ' + (d.lastName || '')).trim() || '').toLowerCase();
          var email = (d.email || '').toLowerCase();
          var phone = (d.phone || '').toLowerCase();
          if (name.includes(qLower) || email.includes(qLower) || phone.includes(qLower)) {
            results.push(d);
          }
        });
        return results;
      })
      .catch(function () { return []; });

    Promise.all([econPromise, appPromise, userPromise]).then(function (results) {
      renderUnifiedResults(results[0], results[1], results[2]);
    });
  }

  function renderUnifiedResults(customers, applicants, users) {
    var el = $('yb-billing-unified-results');
    if (!el) return;

    var totalResults = customers.length + applicants.length + users.length;
    if (!totalResults) {
      el.innerHTML = '<p class="yb-billing__no-results">' + (isDa ? 'Ingen resultater fundet.' : 'No results found.') + '</p>';
      el.hidden = false;
      return;
    }

    var html = '';

    // e-conomic customers
    if (customers.length) {
      html += '<div class="yb-billing__result-group">';
      html += '<div class="yb-billing__result-group-header">e-conomic ' + (isDa ? 'kunder' : 'customers') + ' <span class="yb-billing__result-group-count">' + customers.length + '</span></div>';
      html += '<div class="yb-billing__customer-list">';
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
      html += '</div></div>';
    }

    // Applicants
    if (applicants.length) {
      html += '<div class="yb-billing__result-group">';
      html += '<div class="yb-billing__result-group-header">' + (isDa ? 'Ansøgere' : 'Applicants') + ' <span class="yb-billing__result-group-count">' + applicants.length + '</span></div>';
      html += '<div class="yb-billing__customer-list">';
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
      html += '</div></div>';
    }

    // Users
    if (users.length) {
      html += '<div class="yb-billing__result-group">';
      html += '<div class="yb-billing__result-group-header">' + (isDa ? 'Brugere' : 'Users') + ' <span class="yb-billing__result-group-count">' + users.length + '</span></div>';
      html += '<div class="yb-billing__customer-list">';
      users.forEach(function (u) {
        var name = u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '';
        var role = u.role || 'member';
        if (role === 'user') role = 'member';
        html += '<button type="button" class="yb-billing__customer-row" data-action="billing-select-user" '
          + 'data-user-name="' + esc(name) + '" '
          + 'data-user-email="' + esc(u.email || '') + '" '
          + 'data-user-phone="' + esc(u.phone || '') + '" '
          + 'data-user-id="' + esc(u.id || '') + '" '
          + 'data-user-role="' + esc(role) + '">'
          + '<span class="yb-billing__cr-name">' + esc(name) + '</span>'
          + '<span class="yb-billing__cr-status">' + esc(role) + '</span>'
          + (u.email ? '<span class="yb-billing__cr-email">' + esc(u.email) + '</span>' : '')
          + '</button>';
      });
      html += '</div></div>';
    }

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
    // Hide all result panels
    var econResults = $('yb-billing-customer-results');
    if (econResults) econResults.hidden = true;
    var unifiedResults = $('yb-billing-unified-results');
    if (unifiedResults) unifiedResults.hidden = true;
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
    var resultsEl = $('yb-billing-unified-results');
    if (resultsEl) resultsEl.hidden = true;

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

  function selectUser(data) {
    selectedApplicant = {
      name: data.userName,
      email: data.userEmail,
      phone: data.userPhone,
      course: '',
      type: '',
      appId: ''
    };
    selectedCustomer = null;

    // Show as selected customer badge
    $('yb-billing-cust-name').textContent = data.userName;
    $('yb-billing-cust-num').textContent = data.userRole ? '(' + data.userRole + ')' : '';
    $('yb-billing-cust-email').textContent = data.userEmail || '';
    $('yb-billing-selected-customer').hidden = false;
    var resultsEl = $('yb-billing-unified-results');
    if (resultsEl) resultsEl.hidden = true;

    // Pre-fill new customer form with user data
    prefillNewCustomerForm(data.userName, data.userEmail, data.userPhone);

    console.log('[billing] User selected:', data.userName, data.userEmail);
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
    var econResults = $('yb-billing-customer-results');
    if (econResults) econResults.hidden = true;
    var unifiedResults = $('yb-billing-unified-results');
    if (unifiedResults) unifiedResults.hidden = true;
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
            // Let admin select existing customer instead — show in unified results
            renderUnifiedResults(allMatches, [], []);
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
     EXTRA INVOICE LINES
     ══════════════════════════════════════════ */
  function addExtraLine() {
    extraLines.push({ description: '', amount: 0 });
    renderExtraLines();
    updatePreview();
    updateBtnState();
  }

  function removeExtraLine(index) {
    extraLines.splice(index, 1);
    renderExtraLines();
    updatePreview();
    updateBtnState();
  }

  function renderExtraLines() {
    var container = $('yb-billing-extra-lines');
    if (!container) return;
    if (!extraLines.length) { container.innerHTML = ''; return; }

    container.innerHTML = extraLines.map(function (line, i) {
      return '<div class="yb-billing__extra-line" data-line-index="' + i + '">'
        + '<input type="text" class="yb-lead__search-input yb-billing__extra-desc" value="' + esc(line.description) + '" placeholder="' + t('billing_extra_desc_ph') + '" data-field="desc" data-idx="' + i + '">'
        + '<div class="yb-billing__input-with-suffix">'
        + '<input type="number" step="1" value="' + (line.amount || '') + '" placeholder="0" data-field="amount" data-idx="' + i + '">'
        + '<span class="yb-billing__input-suffix">DKK</span>'
        + '</div>'
        + '<button type="button" class="yb-billing__extra-remove" data-action="billing-remove-line" data-idx="' + i + '">&times;</button>'
        + '</div>';
    }).join('');
  }

  function syncExtraLineFromInput(el) {
    var idx = parseInt(el.dataset.idx);
    if (isNaN(idx) || idx < 0 || idx >= extraLines.length) return;
    if (el.dataset.field === 'desc') {
      extraLines[idx].description = el.value;
    } else if (el.dataset.field === 'amount') {
      extraLines[idx].amount = parseFloat(el.value) || 0;
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
    var lines = [];

    // Calculate extra lines total first (can be negative, e.g. "Already paid -3300")
    var extraTotal = 0;
    extraLines.forEach(function (el) {
      if (el.description && el.amount) extraTotal += el.amount;
    });

    // Instalment lines (from total + start month)
    // The instalment base is the total PLUS extra lines (negative extra lines reduce the amount to split)
    // e.g. Total 23300 + extra -3300 (already paid) = 20000 remaining → 4 × 5000
    if (vals.total && vals.startMonth) {
      var instalmentBase = vals.total + extraTotal;
      if (instalmentBase < 0) instalmentBase = 0;

      var parts = vals.startMonth.split('-');
      var year = parseInt(parts[0]);
      var month = parseInt(parts[1]) - 1;
      var perInstalment = Math.round((instalmentBase / vals.instalments) * 100) / 100;

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

        var amount = (i === vals.instalments - 1) ? instalmentBase - (perInstalment * (vals.instalments - 1)) : perInstalment;
        amount = Math.round(amount * 100) / 100;

        lines.push({ description: desc, unitNetPrice: amount, quantity: 1, date: isoStr, month: m, year: y });
      }
    }

    // Extra lines are included in the preview for reference but flagged
    // so they can be optionally excluded from the actual e-conomic invoice
    extraLines.forEach(function (el) {
      if (el.description && el.amount) {
        lines.push({ description: el.description, unitNetPrice: el.amount, quantity: 1, isExtraLine: true });
      }
    });

    return lines;
  }

  function updatePreview() {
    var vals = getFormValues();
    var el = $('yb-billing-preview');
    if (!el) return;

    var lines = buildLines(vals);
    var hasInstalments = vals.total && vals.startMonth;
    var hasExtraLines = extraLines.some(function (l) { return l.description && l.amount; });

    if (!hasInstalments && !hasExtraLines) {
      el.innerHTML = '<p class="yb-billing__preview-empty">' + t('billing_preview_empty') + '</p>';
      return;
    }

    var instalmentLines = hasInstalments ? lines.filter(function (l) { return l.date; }) : [];
    var extraPreviewLines = lines.filter(function (l) { return l.isExtraLine; });
    var perInstalment = instalmentLines.length ? instalmentLines[0].unitNetPrice : 0;
    var invoiceTotal = instalmentLines.reduce(function (sum, l) { return sum + l.unitNetPrice; }, 0);
    var extraTotal = extraPreviewLines.reduce(function (sum, l) { return sum + l.unitNetPrice; }, 0);
    var custName = selectedCustomer ? selectedCustomer.name : (selectedApplicant ? selectedApplicant.name : null);

    var html = '';

    // Summary
    html += '<div class="yb-billing__preview-summary">';
    if (custName) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_col_customer') + '</span><span>' + esc(custName);
      if (selectedCustomer) html += ' (#' + selectedCustomer.customerNumber + ')';
      html += '</span></div>';
    } else {
      html += '<div class="yb-billing__preview-row yb-billing__preview-row--missing"><span class="yb-billing__preview-label">' + t('billing_col_customer') + '</span><span>' + (isDa ? '\u26a0 Ikke valgt endnu' : '\u26a0 Not selected yet') + '</span></div>';
    }
    if (vals.description) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_description') + '</span><span>' + esc(vals.description) + '</span></div>';
    }
    // Show original total and adjustments if there are extra lines
    if (hasInstalments && extraTotal !== 0) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + (isDa ? 'Samlet pris' : 'Total price') + '</span><span>' + formatAmount(vals.total) + '</span></div>';
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + (isDa ? 'Justeringer' : 'Adjustments') + '</span><span style="color:' + (extraTotal < 0 ? '#16a34a' : '#0F0F0F') + '">' + formatAmount(extraTotal) + '</span></div>';
    }
    html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + (isDa ? 'Fakturabeløb' : 'Invoice Total') + '</span><span class="yb-billing__preview-amount">' + formatAmount(invoiceTotal) + '</span></div>';
    if (instalmentLines.length > 1) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_instalments') + '</span><span>' + instalmentLines.length + ' (' + formatAmount(perInstalment) + ' ' + t('billing_preview_per_instalment') + ')</span></div>';
    }
    var notesVal = ($('yb-billing-notes') || {}).value || '';
    if (notesVal) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_notes') + '</span><span>' + esc(notesVal) + '</span></div>';
    }
    html += '</div>';

    // Lines table — show instalment lines (what goes to e-conomic)
    html += '<h4 class="yb-billing__preview-heading">' + t('billing_preview_schedule') + '</h4>';
    html += '<table class="yb-billing__preview-table"><thead><tr><th>#</th><th>' + t('billing_inv_description') + '</th><th>' + t('billing_col_total') + '</th></tr></thead><tbody>';
    instalmentLines.forEach(function (line, i) {
      html += '<tr><td>' + (i + 1) + '</td><td>' + esc(line.description) + '</td><td class="yb-billing__preview-amount">' + formatAmount(line.unitNetPrice) + '</td></tr>';
    });
    // Show extra lines in preview (muted, with note that they adjust the instalment amounts)
    if (extraPreviewLines.length) {
      extraPreviewLines.forEach(function (line) {
        html += '<tr style="color:#6F6A66;font-style:italic"><td></td><td>' + esc(line.description) + ' <span style="font-size:0.75rem">(' + (isDa ? 'justeret i rater' : 'adjusted in instalments') + ')</span></td><td class="yb-billing__preview-amount">' + formatAmount(line.unitNetPrice) + '</td></tr>';
      });
    }
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
    var hasInstalments = vals.total && vals.startMonth;
    var hasExtraLines = extraLines.some(function (l) { return l.description && l.amount; });
    var ready = hasCustomer && (hasInstalments || hasExtraLines);
    btn.classList.toggle('yb-btn--muted', !ready);
  }

  /* ══════════════════════════════════════════
     CREATE INVOICE
     ══════════════════════════════════════════ */
  function createInvoice() {
    console.log('[billing] Create invoice clicked');
    if (busy) return;

    // Validate: need instalments OR extra lines
    var vals = getFormValues();
    var hasInstalments = vals.total && vals.startMonth;
    var hasExtraLines = extraLines.some(function (l) { return l.description && l.amount; });
    if (!hasInstalments && !hasExtraLines) {
      console.log('[billing] Blocked: no amount/month and no extra lines');
      toast(t('billing_error_no_amount'), true);
      return;
    }

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
   * Find existing e-conomic customer by email, or create a new one.
   * Then create the invoice. Prevents duplicate customers.
   */
  function autoCreateCustomerThenInvoice(vals) {
    var name = ($('yb-billing-nc-name') || {}).value || (selectedApplicant ? selectedApplicant.name : '');
    if (!name.trim()) {
      console.log('[billing] Blocked: no customer name for auto-create');
      toast(isDa ? 'Kundenavn mangler — udfyld kundeformularen' : 'Customer name missing — fill in the customer form', true);
      return;
    }

    var email = ($('yb-billing-nc-email') || {}).value || '';

    var customer = {
      name: name.trim(),
      email: email,
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
    if (btn) { btn.textContent = isDa ? 'Søger kunde...' : 'Searching customer...'; btn.classList.add('yb-btn--muted'); }

    // Search by email first to prevent duplicates
    var searchQuery = email || customer.name;
    console.log('[billing] Searching for existing customer:', searchQuery);
    apiCall({ action: 'searchCustomers', query: searchQuery }).then(function (res) {
      var existing = (res.ok && res.data) ? res.data : [];
      // Find exact email match
      var match = null;
      if (email) {
        match = existing.find(function (c) { return c.email && c.email.toLowerCase() === email.toLowerCase(); });
      }
      if (!match) {
        match = existing.find(function (c) { return c.name && c.name.toLowerCase() === customer.name.toLowerCase(); });
      }

      if (match) {
        console.log('[billing] Found existing customer #' + match.customerNumber + ' (' + match.name + ') — reusing');
        toast(isDa ? 'Eksisterende kunde fundet: #' + match.customerNumber : 'Existing customer found: #' + match.customerNumber);
        selectCustomer(match.customerNumber, match.name, match.email || email);
        var ncForm = $('yb-billing-new-customer-form');
        if (ncForm) ncForm.hidden = true;
        if (btn) { btn.textContent = isDa ? 'Opretter faktura...' : 'Creating invoice...'; }
        sendInvoice(vals);
        return;
      }

      // No match — create new customer
      if (btn) { btn.textContent = isDa ? 'Opretter kunde...' : 'Creating customer...'; }
      console.log('[billing] No existing customer found, creating:', customer.name);
      return apiCall({ action: 'createCustomer', customer: customer }).then(function (cRes) {
        if (!cRes.ok) {
          busy = false;
          if (btn) { btn.textContent = t('billing_create_draft'); btn.classList.remove('yb-btn--muted'); }
          console.error('[billing] Auto-create customer failed:', cRes.error);
          toast(cRes.error, true);
          return;
        }
        var c = cRes.data;
        console.log('[billing] Customer created:', c.customerNumber, c.name);
        toast(t('billing_customer_created'));
        selectCustomer(c.customerNumber, c.name, c.email || customer.email);
        var ncForm = $('yb-billing-new-customer-form');
        if (ncForm) ncForm.hidden = true;
        if (btn) { btn.textContent = isDa ? 'Opretter faktura...' : 'Creating invoice...'; }
        sendInvoice(vals);
      });
    }).catch(function (err) {
      busy = false;
      if (btn) { btn.textContent = t('billing_create_draft'); btn.classList.remove('yb-btn--muted'); }
      console.error('[billing] Find-or-create customer error:', err);
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
    var productNum = ($('yb-billing-product') || {}).value || '';
    var notes = ($('yb-billing-notes') || {}).value || '';
    var ref = ($('yb-billing-ref') || {}).value || '';

    if (!productNum) { toast(isDa ? 'Vælg et produkt' : 'Select a product', true); busy = false; return; }

    // Filter out extra lines — they already adjusted instalment amounts
    var invoiceLines = lines.filter(function (l) { return !l.isExtraLine; });
    var invoice = {
      customerNumber: selectedCustomer.customerNumber,
      recipientName: selectedCustomer.name,
      date: invoiceLines[0].date,
      dueDate: invoiceLines[0].date,
      paymentTermsNumber: paymentTermsNum,
      layoutNumber: layoutNum,
      productNumber: productNum,
      currency: 'DKK',
      lines: invoiceLines.map(function (l) {
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
      var draft = res.data;
      // Track invoice on application doc
      saveInvoiceToApp({
        draftNumber: draft.draftInvoiceNumber,
        status: 'draft',
        amount: draft.grossAmount || draft.netAmount || 0,
        date: draft.date || new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString()
      });
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
    var hasInstalments = vals.total && vals.startMonth;
    var hasExtraLines = extraLines.some(function (l) { return l.description && l.amount; });
    if (!hasInstalments && !hasExtraLines) { toast(t('billing_error_no_amount'), true); return; }
    if (!selectedCustomer && !selectedApplicant) { toast(t('billing_error_no_customer'), true); return; }

    var btn = document.querySelector('[data-action="billing-create-book-send"]');
    busy = true;

    // Determine customer email for sending later
    var customerEmail = selectedCustomer ? (selectedCustomer.email || '') : (selectedApplicant ? (selectedApplicant.email || '') : '');

    // Step 1: Find or create customer if needed
    if (selectedApplicant && !selectedCustomer) {
      var name = ($('yb-billing-nc-name') || {}).value || (selectedApplicant ? selectedApplicant.name : '');
      if (!name.trim()) {
        busy = false;
        toast(isDa ? 'Kundenavn mangler — udfyld kundeformularen' : 'Customer name missing — fill in the customer form', true);
        return;
      }
      var custEmail = ($('yb-billing-nc-email') || {}).value || '';
      var customer = {
        name: name.trim(),
        email: custEmail,
        address: ($('yb-billing-nc-address') || {}).value || '',
        zip: ($('yb-billing-nc-zip') || {}).value || '',
        city: ($('yb-billing-nc-city') || {}).value || '',
        phone: ($('yb-billing-nc-phone') || {}).value || '',
        corporateIdentificationNumber: ($('yb-billing-nc-cvr') || {}).value || '',
        customerGroupNumber: parseInt(($('yb-billing-nc-group') || {}).value) || 1,
        vatZoneNumber: parseInt(($('yb-billing-nc-vat') || {}).value) || 1,
        paymentTermsNumber: parseInt(($('yb-billing-nc-payment') || {}).value) || 1
      };

      customerEmail = custEmail || customerEmail;
      if (btn) btn.textContent = isDa ? 'Søger kunde...' : 'Searching customer...';

      // Search by email/name first to prevent duplicates
      var sq = custEmail || customer.name;
      apiCall({ action: 'searchCustomers', query: sq }).then(function (res) {
        var existing = (res.ok && res.data) ? res.data : [];
        var match = null;
        if (custEmail) {
          match = existing.find(function (c) { return c.email && c.email.toLowerCase() === custEmail.toLowerCase(); });
        }
        if (!match) {
          match = existing.find(function (c) { return c.name && c.name.toLowerCase() === customer.name.toLowerCase(); });
        }

        if (match) {
          console.log('[billing] Master: Found existing customer #' + match.customerNumber);
          selectCustomer(match.customerNumber, match.name, match.email || custEmail);
          var ncForm = $('yb-billing-new-customer-form');
          if (ncForm) ncForm.hidden = true;
          masterCreateInvoice(vals, btn, customerEmail);
          return;
        }

        if (btn) btn.textContent = t('billing_master_creating_customer');
        return apiCall({ action: 'createCustomer', customer: customer }).then(function (cRes) {
          if (!cRes.ok) { busy = false; if (btn) btn.textContent = t('billing_create_book_send'); toast(cRes.error, true); return; }
          var c = cRes.data;
          selectCustomer(c.customerNumber, c.name, c.email || customer.email);
          var ncForm = $('yb-billing-new-customer-form');
          if (ncForm) ncForm.hidden = true;
          masterCreateInvoice(vals, btn, customerEmail);
        });
      }).catch(function (err) { busy = false; if (btn) btn.textContent = t('billing_create_book_send'); toast(err.message, true); });
      return;
    }

    // Customer already selected — go straight to invoice
    masterCreateInvoice(vals, btn, customerEmail);
  }

  function masterCreateInvoice(vals, btn, customerEmail) {
    if (btn) btn.textContent = t('billing_master_creating_invoice');

    var lines = buildLines(vals);
    // Filter out extra lines — they already adjusted instalment amounts
    var invoiceLines = lines.filter(function (l) { return !l.isExtraLine; });
    var paymentTermsNum = parseInt(($('yb-billing-payment-terms') || {}).value) || 1;
    var layoutNum = parseInt(($('yb-billing-layout') || {}).value) || (settings.layouts.length ? settings.layouts[0].layoutNumber : 19);
    var productNum = ($('yb-billing-product') || {}).value || '';
    var notes = ($('yb-billing-notes') || {}).value || '';
    var ref = ($('yb-billing-ref') || {}).value || '';

    if (!productNum) { busy = false; if (btn) btn.textContent = t('billing_create_book_send'); toast(isDa ? 'Vælg et produkt' : 'Select a product', true); return; }

    var invoice = {
      customerNumber: selectedCustomer.customerNumber,
      recipientName: selectedCustomer.name,
      date: invoiceLines[0].date,
      dueDate: invoiceLines[0].date,
      paymentTermsNumber: paymentTermsNum,
      layoutNumber: layoutNum,
      productNumber: productNum,
      currency: 'DKK',
      lines: invoiceLines.map(function (l) {
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
      // Track booked status on application
      saveInvoiceToApp({
        draftNumber: draftNumber,
        bookedNumber: bookedNum,
        status: 'booked',
        amount: booked.grossAmount || booked.netAmount || 0,
        date: booked.date || new Date().toISOString().split('T')[0],
        dueDate: booked.dueDate || '',
        createdAt: new Date().toISOString()
      });
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
      // Update invoice tracking with sent info
      saveInvoiceToApp({
        bookedNumber: bookedNumber,
        status: 'sent',
        sentAt: new Date().toISOString(),
        sentTo: email
      });
      if (btn) { btn.textContent = t('billing_master_done'); setTimeout(function () { btn.textContent = '\u26a1 ' + t('billing_create_book_send'); }, 3000); }
      toast(t('billing_master_done'));
      resetForm();
    }).catch(function (err) {
      busy = false;
      if (btn) btn.textContent = t('billing_create_book_send');
      toast(isDa ? 'Faktura bogført men email fejlede: ' + err.message : 'Invoice booked but email failed: ' + err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     INVOICES VIEW (combined drafts + booked)
     ══════════════════════════════════════════ */
  var allInvoices = []; // cached combined list for filtering

  function showInvoices() {
    $('yb-billing-v-create').hidden = true;
    var invView = $('yb-billing-v-invoices');
    if (invView) invView.hidden = false;
    loadInvoices();
  }

  function showCreate() {
    $('yb-billing-v-create').hidden = false;
    var invView = $('yb-billing-v-invoices');
    if (invView) invView.hidden = true;
  }

  function loadInvoices() {
    var body = $('yb-billing-invoices-body');
    if (body) body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:1rem;color:var(--yb-muted)">' + t('loading') + '</td></tr>';

    // Load both drafts and booked in parallel
    Promise.all([
      apiCall({ action: 'listDrafts' }).then(function (res) { return res.ok ? (res.data.drafts || []) : []; }).catch(function () { return []; }),
      apiCall({ action: 'listBooked' }).then(function (res) { return res.ok ? (res.data.invoices || []) : []; }).catch(function () { return []; })
    ]).then(function (results) {
      var drafts = results[0];
      var booked = results[1];

      // Normalize into unified list
      allInvoices = [];
      drafts.forEach(function (d) {
        allInvoices.push({
          number: d.draftInvoiceNumber,
          type: 'draft',
          customer: d.recipient && d.recipient.name ? d.recipient.name : (d.customer ? '#' + d.customer.customerNumber : '—'),
          date: d.date || '—',
          dueDate: d.dueDate || '—',
          total: d.grossAmount != null ? d.grossAmount : (d.netAmount || 0),
          remainder: null,
          status: 'draft',
          actionType: 'draft'
        });
      });
      booked.forEach(function (inv) {
        var isPaid = inv.remainder != null && inv.remainder === 0;
        var isPartial = inv.remainder != null && inv.remainder > 0 && inv.remainder < (inv.grossAmount || inv.netAmount || 0);
        var hasSent = inv.sentDate || inv.sent;
        var status = isPaid ? 'paid' : (isPartial ? 'partial' : (hasSent ? 'sent' : 'booked'));
        allInvoices.push({
          number: inv.bookedInvoiceNumber,
          type: 'booked',
          customer: inv.recipient && inv.recipient.name ? inv.recipient.name : '—',
          date: inv.date || '—',
          dueDate: inv.dueDate || '—',
          total: inv.grossAmount != null ? inv.grossAmount : (inv.netAmount || 0),
          remainder: inv.remainder,
          status: status,
          actionType: 'booked'
        });
      });

      renderInvoices();
    });
  }

  function renderInvoices() {
    var body = $('yb-billing-invoices-body');
    var empty = $('yb-billing-invoices-empty');
    var countEl = $('yb-billing-invoice-count');
    if (!body) return;

    // Apply filter
    var filter = ($('yb-billing-invoice-filter') || {}).value || '';
    var filtered = filter ? allInvoices.filter(function (inv) {
      if (filter === 'draft') return inv.type === 'draft';
      if (filter === 'booked') return inv.status === 'booked';
      if (filter === 'sent') return inv.status === 'sent';
      if (filter === 'paid') return inv.status === 'paid';
      if (filter === 'unpaid') return inv.status !== 'paid' && inv.status !== 'partial' && inv.type === 'booked';
      if (filter === 'partial') return inv.status === 'partial';
      return true;
    }) : allInvoices;

    if (countEl) {
      countEl.textContent = filtered.length + (filter ? ' ' + (isDa ? 'match' : 'matching') : '') + ' ' + (isDa ? 'af' : 'of') + ' ' + allInvoices.length;
    }

    if (!filtered.length) {
      body.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    body.innerHTML = filtered.map(function (inv) {
      var typeLabel = inv.type === 'draft' ? t('billing_filter_draft') : t('billing_filter_booked');
      var typeBadge = '<span class="yb-billing__type-badge yb-billing__type-badge--' + inv.type + '">' + typeLabel + '</span>';

      var statusLabel, statusClass;
      switch (inv.status) {
        case 'draft': statusLabel = t('billing_filter_draft'); statusClass = 'yb-billing__status--draft'; break;
        case 'booked': statusLabel = t('billing_filter_booked'); statusClass = 'yb-billing__status--booked'; break;
        case 'sent': statusLabel = t('billing_filter_sent'); statusClass = 'yb-billing__status--sent'; break;
        case 'paid': statusLabel = t('billing_status_paid'); statusClass = 'yb-billing__status--paid'; break;
        case 'partial': statusLabel = t('billing_status_partial'); statusClass = 'yb-billing__status--partial'; break;
        default: statusLabel = t('billing_status_unpaid'); statusClass = 'yb-billing__status--unpaid';
      }

      var remainder = inv.remainder != null ? formatAmount(inv.remainder) : '—';
      var actionBtn = inv.actionType === 'draft'
        ? '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="billing-view-draft" data-draft="' + inv.number + '">' + (isDa ? 'Vis' : 'View') + '</button>'
        : '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="billing-view-booked-detail" data-booked="' + inv.number + '">' + (isDa ? 'Vis' : 'View') + '</button>';

      return '<tr>'
        + '<td>' + inv.number + '</td>'
        + '<td>' + typeBadge + '</td>'
        + '<td>' + esc(inv.customer) + '</td>'
        + '<td>' + inv.date + '</td>'
        + '<td>' + inv.dueDate + '</td>'
        + '<td>' + formatAmount(inv.total) + '</td>'
        + '<td>' + remainder + '</td>'
        + '<td><span class="' + statusClass + '">' + statusLabel + '</span></td>'
        + '<td>' + actionBtn + '</td>'
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
    var deleteBtn = document.querySelector('[data-action="billing-delete-draft"]');
    var sendBtn = document.querySelector('[data-action="billing-send-invoice"]');
    var pdfBtn = document.querySelector('[data-action="billing-download-pdf"]');
    var creditBtn = document.querySelector('[data-action="billing-create-credit-note"]');
    if (!modal || !body) return;
    if (title) title.textContent = t('billing_draft_detail');
    if (bookBtn) bookBtn.hidden = false;
    if (deleteBtn) deleteBtn.hidden = false;
    if (sendBtn) sendBtn.hidden = true;
    if (pdfBtn) pdfBtn.hidden = true;
    if (creditBtn) creditBtn.hidden = true;
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
      loadInvoices();
    }).catch(function (err) { toast(err.message, true); });
  }

  function deleteDraft() {
    if (!currentDraftNumber) return;
    if (!confirm(isDa
      ? 'Slet kladde #' + currentDraftNumber + '? Denne handling kan ikke fortrydes.'
      : 'Delete draft #' + currentDraftNumber + '? This cannot be undone.')) return;

    var btn = document.querySelector('[data-action="billing-delete-draft"]');
    if (btn) { btn.textContent = isDa ? 'Sletter...' : 'Deleting...'; btn.classList.add('yb-btn--muted'); }

    apiCall({ action: 'deleteDraft', draftNumber: currentDraftNumber }).then(function (res) {
      if (btn) { btn.innerHTML = '\ud83d\uddd1 ' + t('billing_delete_draft'); btn.classList.remove('yb-btn--muted'); }
      if (!res.ok) { toast(res.error, true); return; }
      toast(isDa ? 'Kladde #' + currentDraftNumber + ' slettet' : 'Draft #' + currentDraftNumber + ' deleted');
      closeDraftModal();
      loadInvoices();
    }).catch(function (err) {
      if (btn) { btn.innerHTML = '\ud83d\uddd1 ' + t('billing_delete_draft'); btn.classList.remove('yb-btn--muted'); }
      toast(err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     CREDIT NOTES
     ══════════════════════════════════════════ */
  function createCreditNote() {
    if (!currentBookedNumber) return;

    // Show credit note options: full refund or partial (custom amount)
    var choice = prompt(isDa
      ? 'Kreditnota for faktura #' + currentBookedNumber + ':\n\nIndtast beløb at kreditere (negativt), eller tryk OK for fuld kreditnota.\n\n(Lad feltet stå tomt for fuld kreditnota)'
      : 'Credit note for invoice #' + currentBookedNumber + ':\n\nEnter amount to credit (negative), or press OK for full credit note.\n\n(Leave empty for full credit note)',
      '');

    if (choice === null) return; // cancelled

    var creditBtn = document.querySelector('[data-action="billing-create-credit-note"]');
    if (creditBtn) { creditBtn.textContent = isDa ? 'Opretter...' : 'Creating...'; creditBtn.classList.add('yb-btn--muted'); }

    var payload = { action: 'createCreditNote', bookedNumber: currentBookedNumber };

    if (choice.trim()) {
      // Partial credit — parse amount
      var amount = parseFloat(choice.replace(/[^0-9.,\-]/g, '').replace(',', '.'));
      if (isNaN(amount) || amount === 0) {
        if (creditBtn) { creditBtn.innerHTML = '\u21ba ' + t('billing_credit_note'); creditBtn.classList.remove('yb-btn--muted'); }
        toast(isDa ? 'Ugyldigt beløb' : 'Invalid amount', true);
        return;
      }
      // Ensure negative
      if (amount > 0) amount = -amount;

      var desc = prompt(isDa
        ? 'Beskrivelse for kreditlinjen:'
        : 'Description for credit line:',
        isDa ? 'Kreditnota — faktura #' + currentBookedNumber : 'Credit note — invoice #' + currentBookedNumber);

      if (!desc) {
        if (creditBtn) { creditBtn.innerHTML = '\u21ba ' + t('billing_credit_note'); creditBtn.classList.remove('yb-btn--muted'); }
        return;
      }

      payload.lines = [{ description: desc, unitNetPrice: amount, quantity: 1 }];
    }

    if (!confirm(isDa
      ? 'Opretter kreditnota for faktura #' + currentBookedNumber + (payload.lines ? ' (' + payload.lines[0].unitNetPrice + ' DKK)' : ' (fuld kreditering)') + '. Fortsæt?'
      : 'Create credit note for invoice #' + currentBookedNumber + (payload.lines ? ' (' + payload.lines[0].unitNetPrice + ' DKK)' : ' (full credit)') + '. Continue?')) {
      if (creditBtn) { creditBtn.innerHTML = '\u21ba ' + t('billing_credit_note'); creditBtn.classList.remove('yb-btn--muted'); }
      return;
    }

    apiCall(payload).then(function (res) {
      if (creditBtn) { creditBtn.innerHTML = '\u21ba ' + t('billing_credit_note'); creditBtn.classList.remove('yb-btn--muted'); }
      if (!res.ok) { toast(res.error, true); return; }
      var data = res.data;
      var msg = isDa
        ? 'Kreditnota oprettet' + (data.booked ? ' & bogført (#' + data.booked + ')' : ' som kladde #' + data.draft)
        : 'Credit note created' + (data.booked ? ' & booked (#' + data.booked + ')' : ' as draft #' + data.draft);
      toast(msg);
      closeDraftModal();
      loadInvoices();
    }).catch(function (err) {
      if (creditBtn) { creditBtn.innerHTML = '\u21ba ' + t('billing_credit_note'); creditBtn.classList.remove('yb-btn--muted'); }
      toast(err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     BOOKED INVOICES (kept for detail + credit note reload)
     ══════════════════════════════════════════ */

  function viewBookedDetail(bookedNumber) {
    currentBookedNumber = parseInt(bookedNumber);
    currentBookedEmail = null;
    currentDraftNumber = null;
    var modal = $('yb-billing-draft-modal');
    var body = $('yb-billing-modal-body');
    var title = $('yb-billing-modal-title');
    var bookBtn = document.querySelector('[data-action="billing-book-draft"]');
    var deleteBtn = document.querySelector('[data-action="billing-delete-draft"]');
    var sendBtn = document.querySelector('[data-action="billing-send-invoice"]');
    var pdfBtn = document.querySelector('[data-action="billing-download-pdf"]');
    var creditBtn = document.querySelector('[data-action="billing-create-credit-note"]');
    if (!modal || !body) return;

    if (title) title.textContent = t('billing_booked_title') + ' #' + bookedNumber;
    if (bookBtn) bookBtn.hidden = true;
    if (deleteBtn) deleteBtn.hidden = true;
    if (sendBtn) sendBtn.hidden = false;
    if (pdfBtn) pdfBtn.hidden = false;
    if (creditBtn) creditBtn.hidden = false;
    body.innerHTML = '<p>' + t('loading') + '</p>';
    modal.hidden = false;

    apiCall({ action: 'getBooked', bookedNumber: currentBookedNumber }).then(function (res) {
      if (!res.ok) { body.innerHTML = '<p class="yb-billing__error">' + esc(res.error) + '</p>'; return; }
      var d = res.data;

      // Get customer email for send button (direct lookup by customer number)
      if (d.customer && d.customer.customerNumber) {
        apiCall({ action: 'getCustomer', customerNumber: d.customer.customerNumber }).then(function (cr) {
          if (cr.ok && cr.data && cr.data.email) {
            currentBookedEmail = cr.data.email;
            console.log('[billing] Customer email for invoice:', currentBookedEmail);
          }
        }).catch(function () { /* ignore — email will just be empty in prompt */ });
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
      // Broadcast sent event for any listening app profile
      if (window._ybInvoiceSent) window._ybInvoiceSent(currentBookedNumber, inputEmail);
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
    if (pdfBtn) { pdfBtn.textContent = isDa ? 'Henter PDF...' : 'Downloading PDF...'; pdfBtn.classList.add('yb-btn--muted'); }

    console.log('[billing] Getting PDF for invoice', currentBookedNumber);
    apiCall({ action: 'getInvoicePdf', bookedNumber: currentBookedNumber }).then(function (res) {
      if (pdfBtn) { pdfBtn.innerHTML = '&#128196; ' + t('billing_download_pdf'); pdfBtn.classList.remove('yb-btn--muted'); }
      if (!res.ok) {
        console.error('[billing] Get PDF failed:', res.error);
        toast(res.error, true);
        return;
      }
      if (res.data && res.data.base64) {
        // Convert base64 to blob and trigger download
        var byteChars = atob(res.data.base64);
        var byteNums = new Array(byteChars.length);
        for (var i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        var blob = new Blob([new Uint8Array(byteNums)], { type: 'application/pdf' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = res.data.filename || ('Faktura-' + currentBookedNumber + '.pdf');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast(isDa ? 'PDF downloadet' : 'PDF downloaded');
      } else {
        toast(isDa ? 'Kunne ikke hente PDF' : 'Could not get PDF', true);
      }
    }).catch(function (err) {
      if (pdfBtn) { pdfBtn.innerHTML = '&#128196; ' + t('billing_download_pdf'); pdfBtn.classList.remove('yb-btn--muted'); }
      console.error('[billing] PDF download error:', err);
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

  };

  // Expose modal openers for cross-module usage (e.g. user detail invoice view)
  window._ybBillingViewDraft = function (draftNum) { viewDraft(draftNum); };
  window._ybBillingViewBooked = function (bookedNum) { viewBookedDetail(bookedNum); };

  // Called from course-admin.js via window.billingFromUser()
  window.billingFromUser = function (userData) {
    console.log('[billing] Bill from user:', userData);

    // Switch to billing tab
    var billingTabBtn = document.querySelector('[data-yb-admin-tab="billing"]');
    if (billingTabBtn) billingTabBtn.click();

    // Ensure settings are loaded
    if (!settingsLoaded && !settingsLoading) loadSettings();

    // Show create view
    showCreate();

    // Show banner
    var banner = $('yb-billing-applicant-banner');
    var bannerInfo = $('yb-billing-applicant-info');
    if (banner && bannerInfo) {
      bannerInfo.textContent = t('billing_billing_for') + ': ' + (userData.name || '');
      banner.hidden = false;
    }

    // Select as user (pre-fills new customer form)
    selectUser({
      userName: userData.name || '',
      userEmail: userData.email || '',
      userPhone: userData.phone || '',
      userRole: '',
      userId: ''
    });
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
    var econResults = $('yb-billing-customer-results');
    if (econResults) econResults.hidden = true;
    var unifiedResults = $('yb-billing-unified-results');
    if (unifiedResults) unifiedResults.hidden = true;
    var banner = $('yb-billing-applicant-banner');
    if (banner) banner.hidden = true;

    var fields = ['yb-billing-customer-search', 'yb-billing-unified-search', 'yb-billing-total', 'yb-billing-description', 'yb-billing-notes', 'yb-billing-ref',
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

    // Clear extra lines
    extraLines = [];
    renderExtraLines();

    var now = new Date();
    var monthInput = $('yb-billing-start-month');
    if (monthInput) monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

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
      case 'billing-unified-search': unifiedSearch(); break;
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
      case 'billing-select-user':
        selectUser(el.dataset);
        break;
      case 'billing-add-line': addExtraLine(); break;
      case 'billing-remove-line': removeExtraLine(parseInt(el.dataset.idx)); break;
      case 'billing-create-invoice': createInvoice(); break;
      case 'billing-create-book-send': createBookAndSend(); break;
      case 'billing-reset-form': resetForm(); break;
      case 'billing-view-invoices': showInvoices(); break;
      case 'billing-back-create': showCreate(); break;
      case 'billing-refresh-invoices': loadInvoices(); break;
      case 'billing-refresh-settings': loadSettings(); break;
      case 'billing-view-draft': viewDraft(el.dataset.draft); break;
      case 'billing-book-draft': bookDraft(); break;
      case 'billing-delete-draft': deleteDraft(); break;
      case 'billing-create-credit-note': createCreditNote(); break;
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

    // Live sync for extra line inputs (delegated)
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (el.dataset && el.dataset.idx !== undefined && (el.dataset.field === 'desc' || el.dataset.field === 'amount')) {
        syncExtraLineFromInput(el);
      }
    });

    // Search on enter — e-conomic search
    var econInput = $('yb-billing-customer-search');
    if (econInput) {
      econInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); searchCustomers(); }
      });
    }
    // Search on enter — unified search
    var unifiedInput = $('yb-billing-unified-search');
    if (unifiedInput) {
      unifiedInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); unifiedSearch(); }
      });
    }

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

    // Invoice filter change
    var invoiceFilter = $('yb-billing-invoice-filter');
    if (invoiceFilter) invoiceFilter.addEventListener('change', renderInvoices);

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
