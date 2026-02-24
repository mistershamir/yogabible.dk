/**
 * YOGA BIBLE — BILLING ADMIN (e-conomic)
 * Create customers + instalment invoices via the e-conomic REST API.
 * Talks to /.netlify/functions/economic-admin (server-side proxy).
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var T = {};
  var isDa = true;
  var settingsLoaded = false;
  var settings = { paymentTerms: [], layouts: [], customerGroups: [], vatZones: [] };
  var selectedCustomer = null; // { customerNumber, name, email }
  var currentDraftNumber = null;

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
    el._tid = setTimeout(function () { el.hidden = true; }, 3000);
  }

  function getAuthToken() {
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
     LOAD SETTINGS
     ══════════════════════════════════════════ */
  function loadSettings() {
    apiCall({ action: 'settings' }).then(function (res) {
      if (!res.ok) { toast(res.error || 'Failed to load settings', true); return; }
      settings = res.data;
      settingsLoaded = true;
      populateDropdowns();
    }).catch(function (err) { toast('e-conomic: ' + err.message, true); });
  }

  function populateDropdowns() {
    // Payment terms — invoice + new customer
    var ptOpts = settings.paymentTerms.map(function (pt) {
      return '<option value="' + pt.paymentTermsNumber + '">' + esc(pt.name) + '</option>';
    }).join('');
    var ptSel = $('yb-billing-payment-terms');
    if (ptSel) ptSel.innerHTML = ptOpts;
    var ptSel2 = $('yb-billing-nc-payment');
    if (ptSel2) ptSel2.innerHTML = ptOpts;

    // Layouts
    var layOpts = settings.layouts.map(function (l) {
      return '<option value="' + l.layoutNumber + '">' + esc(l.name) + '</option>';
    }).join('');
    var laySel = $('yb-billing-layout');
    if (laySel) laySel.innerHTML = layOpts;

    // Customer groups
    var cgOpts = settings.customerGroups.map(function (cg) {
      return '<option value="' + cg.customerGroupNumber + '">' + esc(cg.name) + '</option>';
    }).join('');
    var cgSel = $('yb-billing-nc-group');
    if (cgSel) cgSel.innerHTML = cgOpts;

    // VAT zones
    var vzOpts = settings.vatZones.map(function (vz) {
      return '<option value="' + vz.vatZoneNumber + '">' + esc(vz.name) + '</option>';
    }).join('');
    var vzSel = $('yb-billing-nc-vat');
    if (vzSel) vzSel.innerHTML = vzOpts;
  }

  /* ══════════════════════════════════════════
     CUSTOMER SEARCH
     ══════════════════════════════════════════ */
  function searchCustomers() {
    var q = ($('yb-billing-customer-search') || {}).value || '';
    if (q.length < 2) { toast(isDa ? 'Skriv mindst 2 tegn' : 'Type at least 2 characters', true); return; }
    apiCall({ action: 'searchCustomers', query: q }).then(function (res) {
      if (!res.ok) { toast(res.error, true); return; }
      renderCustomerResults(res.data);
    });
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
    $('yb-billing-cust-name').textContent = name;
    $('yb-billing-cust-num').textContent = '#' + num;
    $('yb-billing-cust-email').textContent = email || '';
    $('yb-billing-selected-customer').hidden = false;
    $('yb-billing-customer-results').hidden = true;
    var ncForm = $('yb-billing-new-customer-form');
    if (ncForm) ncForm.hidden = true;
    updatePreview();
    updateCreateBtn();
  }

  function clearCustomer() {
    selectedCustomer = null;
    $('yb-billing-selected-customer').hidden = true;
    updateCreateBtn();
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
    if (!name.trim()) { toast(t('billing_nc_name') + ' is required', true); return; }

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

    apiCall({ action: 'createCustomer', customer: customer }).then(function (res) {
      if (!res.ok) { toast(res.error, true); return; }
      var c = res.data;
      toast(t('billing_customer_created'));
      selectCustomer(c.customerNumber, c.name, c.email || customer.email);
      cancelNewCustomer();
    }).catch(function (err) { toast(err.message, true); });
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
    var month = parseInt(parts[1]) - 1; // 0-based
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

      // Last instalment gets the remainder to avoid rounding issues
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

    var html = '';

    // Summary
    html += '<div class="yb-billing__preview-summary">';
    if (selectedCustomer) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_col_customer') + '</span><span>' + esc(selectedCustomer.name) + ' (#' + selectedCustomer.customerNumber + ')</span></div>';
    }
    if (vals.description) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_description') + '</span><span>' + esc(vals.description) + '</span></div>';
    }
    html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_total') + '</span><span class="yb-billing__preview-amount">' + formatAmount(vals.total) + '</span></div>';
    if (vals.instalments > 1) {
      html += '<div class="yb-billing__preview-row"><span class="yb-billing__preview-label">' + t('billing_inv_instalments') + '</span><span>' + vals.instalments + ' (' + formatAmount(perInstalment) + ' ' + t('billing_preview_per_instalment') + ')</span></div>';
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

  function updateCreateBtn() {
    var btn = document.querySelector('[data-action="billing-create-invoice"]');
    if (!btn) return;
    var vals = getFormValues();
    btn.disabled = !selectedCustomer || !vals.total || !vals.startMonth;
  }

  /* ══════════════════════════════════════════
     CREATE INVOICE
     ══════════════════════════════════════════ */
  function createInvoice() {
    if (!selectedCustomer) { toast(t('billing_error_no_customer'), true); return; }
    var vals = getFormValues();
    if (!vals.total) { toast(t('billing_error_no_amount'), true); return; }
    if (!vals.startMonth) { toast(t('billing_error_no_month'), true); return; }

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

    var btn = document.querySelector('[data-action="billing-create-invoice"]');
    if (btn) { btn.disabled = true; btn.textContent = isDa ? 'Opretter...' : 'Creating...'; }

    apiCall({ action: 'createInvoice', invoice: invoice }).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = t('billing_create_draft'); }
      if (!res.ok) { toast(res.error, true); return; }
      toast(t('billing_invoice_created'));
      resetForm();
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = t('billing_create_draft'); }
      toast(err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     DRAFTS LIST
     ══════════════════════════════════════════ */
  function showDrafts() {
    $('yb-billing-v-create').hidden = true;
    $('yb-billing-v-drafts').hidden = false;
    loadDrafts();
  }

  function showCreate() {
    $('yb-billing-v-create').hidden = false;
    $('yb-billing-v-drafts').hidden = true;
  }

  function loadDrafts() {
    apiCall({ action: 'listDrafts' }).then(function (res) {
      if (!res.ok) { toast(res.error, true); return; }
      renderDrafts(res.data.drafts || []);
    });
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
    var modal = $('yb-billing-draft-modal');
    var body = $('yb-billing-modal-body');
    if (!modal || !body) return;
    body.innerHTML = '<p>' + t('loading') + '</p>';
    modal.hidden = false;

    apiCall({ action: 'getDraft', draftNumber: currentDraftNumber }).then(function (res) {
      if (!res.ok) { body.innerHTML = '<p class="yb-billing__error">' + esc(res.error) + '</p>'; return; }
      renderDraftDetail(res.data);
    });
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
     RESET
     ══════════════════════════════════════════ */
  function resetForm() {
    selectedCustomer = null;
    $('yb-billing-selected-customer').hidden = true;
    var ncForm = $('yb-billing-new-customer-form');
    if (ncForm) ncForm.hidden = true;
    $('yb-billing-customer-results').hidden = true;

    var fields = ['yb-billing-customer-search', 'yb-billing-total', 'yb-billing-description', 'yb-billing-notes', 'yb-billing-ref',
      'yb-billing-nc-name', 'yb-billing-nc-email', 'yb-billing-nc-address', 'yb-billing-nc-zip', 'yb-billing-nc-city', 'yb-billing-nc-phone', 'yb-billing-nc-cvr'];
    fields.forEach(function (id) { var el = $(id); if (el) el.value = ''; });

    var instSel = $('yb-billing-instalments');
    if (instSel) instSel.value = '1';

    // Set default start month to current month
    var now = new Date();
    var monthInput = $('yb-billing-start-month');
    if (monthInput) monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    updatePreview();
    updateCreateBtn();
  }

  /* ══════════════════════════════════════════
     EVENT DELEGATION
     ══════════════════════════════════════════ */
  function handleAction(action, el) {
    switch (action) {
      case 'billing-search-customer': searchCustomers(); break;
      case 'billing-new-customer': showNewCustomerForm(); break;
      case 'billing-save-customer': saveNewCustomer(); break;
      case 'billing-cancel-new-customer': cancelNewCustomer(); break;
      case 'billing-clear-customer': clearCustomer(); break;
      case 'billing-select-customer':
        selectCustomer(el.dataset.customerNumber, el.dataset.customerName, el.dataset.customerEmail);
        break;
      case 'billing-create-invoice': createInvoice(); break;
      case 'billing-reset-form': resetForm(); break;
      case 'billing-view-drafts': showDrafts(); break;
      case 'billing-back-create': showCreate(); break;
      case 'billing-refresh-drafts': loadDrafts(); break;
      case 'billing-refresh-settings': loadSettings(); break;
      case 'billing-view-draft': viewDraft(el.dataset.draft); break;
      case 'billing-book-draft': bookDraft(); break;
    }
    if (action === 'close-billing-modal' || el.hasAttribute('data-close-billing-modal')) {
      closeDraftModal();
    }
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function init() {
    T = window._ybAdminT || {};
    isDa = (window._ybAdminLang || 'da') === 'da';

    // Event delegation
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (btn) handleAction(btn.dataset.action, btn);
      if (e.target.closest('[data-close-billing-modal]')) closeDraftModal();
    });

    // Search on enter
    var searchInput = $('yb-billing-customer-search');
    if (searchInput) {
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); searchCustomers(); }
      });
    }

    // Live preview on changes
    ['yb-billing-total', 'yb-billing-instalments', 'yb-billing-start-month', 'yb-billing-description'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', function () { updatePreview(); updateCreateBtn(); });
      if (el) el.addEventListener('change', function () { updatePreview(); updateCreateBtn(); });
    });

    // Set default start month
    var now = new Date();
    var monthInput = $('yb-billing-start-month');
    if (monthInput && !monthInput.value) {
      monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }

    // Load settings when billing tab is activated
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-yb-admin-tab="billing"]');
      if (tab && !settingsLoaded) loadSettings();
    });
  }

  // Run when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
