/**
 * YOGA BIBLE — LEAD ADMIN
 * Lead Manager tab for the admin panel.
 * Reads/writes directly to Firestore (client-side SDK).
 */
(function () {
  'use strict';

  var db;
  var T = {};
  var leads = [];
  var leadsLoaded = false;
  var currentLeadId = null;
  var currentLead = null;
  var lastDoc = null; // pagination cursor
  var PAGE_SIZE = 50;
  var searchTerm = '';
  var filterStatus = '';
  var filterType = '';

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

  function fmtDate(d) {
    if (!d) return '\u2014';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '\u2014';
    return date.toLocaleDateString('da-DK', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(d) {
    if (!d) return '\u2014';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '\u2014';
    return date.toLocaleDateString('da-DK', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  }

  /* ═══════════════════════════════════════
     STATUS BADGE COLORS
     ═══════════════════════════════════════ */
  function statusBadgeClass(status) {
    switch ((status || '').toLowerCase()) {
      case 'new': return 'yb-lead__badge--new';
      case 'contacted': return 'yb-lead__badge--contacted';
      case 'follow-up': return 'yb-lead__badge--followup';
      case 'converted': return 'yb-lead__badge--converted';
      case 'existing applicant': return 'yb-lead__badge--existing';
      case 'unsubscribed': return 'yb-lead__badge--unsub';
      case 'closed': return 'yb-lead__badge--closed';
      default: return '';
    }
  }

  function typeBadge(type) {
    switch ((type || '').toLowerCase()) {
      case 'ytt': return 'YTT';
      case 'course': return 'Course';
      case 'bundle': return 'Bundle';
      case 'mentorship': return 'Mentorship';
      default: return type || '\u2014';
    }
  }

  /* ═══════════════════════════════════════
     LOAD LEADS
     ═══════════════════════════════════════ */
  function loadLeads(append) {
    if (!append) {
      leads = [];
      lastDoc = null;
    }

    var query = db.collection('leads').orderBy('created_at', 'desc');

    if (filterStatus) {
      query = query.where('status', '==', filterStatus);
    }
    if (filterType) {
      query = query.where('type', '==', filterType);
    }
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    query.limit(PAGE_SIZE).get().then(function (snap) {
      snap.forEach(function (doc) {
        leads.push(Object.assign({ id: doc.id }, doc.data()));
      });
      lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

      renderLeadTable();
      renderLeadStats();

      // Show/hide load more
      var loadMore = $('yb-lead-load-more-wrap');
      if (loadMore) loadMore.hidden = snap.docs.length < PAGE_SIZE;

    }).catch(function (err) {
      console.error('[lead-admin] Load error:', err);
      toast(t('error_load'), true);
    });
  }

  /* ═══════════════════════════════════════
     RENDER LEAD TABLE
     ═══════════════════════════════════════ */
  function renderLeadTable() {
    var tbody = $('yb-lead-table-body');
    if (!tbody) return;

    var filtered = leads;
    if (searchTerm) {
      var s = searchTerm.toLowerCase();
      filtered = leads.filter(function (l) {
        return (l.email || '').toLowerCase().indexOf(s) !== -1 ||
          (l.first_name || '').toLowerCase().indexOf(s) !== -1 ||
          (l.last_name || '').toLowerCase().indexOf(s) !== -1 ||
          (l.phone || '').indexOf(s) !== -1;
      });
    }

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--yb-muted)">' + t('leads_no_leads') + '</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (l) {
      return '<tr class="yb-lead__row" data-action="view-lead" data-id="' + l.id + '">' +
        '<td class="yb-lead__cell-date">' + fmtDate(l.created_at) + '</td>' +
        '<td>' + esc((l.first_name || '') + ' ' + (l.last_name || '')).trim() + '</td>' +
        '<td class="yb-lead__cell-email">' + esc(l.email || '') + '</td>' +
        '<td><span class="yb-lead__type-badge">' + typeBadge(l.type) + '</span></td>' +
        '<td class="yb-lead__cell-program">' + esc((l.program || '').substring(0, 35)) + '</td>' +
        '<td><span class="yb-lead__badge ' + statusBadgeClass(l.status) + '">' + esc(l.status || 'New') + '</span></td>' +
        '<td><button class="yb-admin__icon-btn" data-action="view-lead" data-id="' + l.id + '" title="' + t('users_view') + '">\u2192</button></td>' +
        '</tr>';
    }).join('');
  }

  /* ═══════════════════════════════════════
     RENDER STATS
     ═══════════════════════════════════════ */
  function renderLeadStats() {
    var el = $('yb-lead-stats');
    if (!el) return;

    var total = leads.length;
    var newCount = leads.filter(function (l) { return l.status === 'New'; }).length;
    var contacted = leads.filter(function (l) { return l.status === 'Contacted' || l.status === 'Follow-up'; }).length;
    var converted = leads.filter(function (l) { return l.status === 'Converted'; }).length;

    el.innerHTML =
      '<div class="yb-admin__stat-card"><span class="yb-admin__stat-value">' + total + '</span><span class="yb-admin__stat-label">' + t('leads_stat_total') + '</span></div>' +
      '<div class="yb-admin__stat-card"><span class="yb-admin__stat-value">' + newCount + '</span><span class="yb-admin__stat-label">' + t('leads_stat_new') + '</span></div>' +
      '<div class="yb-admin__stat-card"><span class="yb-admin__stat-value">' + contacted + '</span><span class="yb-admin__stat-label">' + t('leads_stat_contacted') + '</span></div>' +
      '<div class="yb-admin__stat-card"><span class="yb-admin__stat-value">' + converted + '</span><span class="yb-admin__stat-label">' + t('leads_stat_converted') + '</span></div>';
  }

  /* ═══════════════════════════════════════
     VIEW LEAD DETAIL
     ═══════════════════════════════════════ */
  function showLeadDetail(leadId) {
    currentLeadId = leadId;
    currentLead = leads.find(function (l) { return l.id === leadId; });
    if (!currentLead) return;

    $('yb-admin-v-lead-list').hidden = true;
    $('yb-admin-v-lead-detail').hidden = false;

    $('yb-lead-detail-heading').textContent = (currentLead.first_name || '') + ' ' + (currentLead.last_name || '');

    renderLeadDetailCard();
    renderLeadActions();
    populateStatusForm();
    loadLeadActivity();
  }

  function backToLeadList() {
    $('yb-admin-v-lead-list').hidden = false;
    $('yb-admin-v-lead-detail').hidden = true;
    currentLeadId = null;
    currentLead = null;
  }

  function renderLeadDetailCard() {
    var el = $('yb-lead-detail-card');
    if (!el || !currentLead) return;
    var l = currentLead;

    var rows = [
      ['Email', l.email],
      [t('users_profile_phone'), l.phone],
      [t('leads_col_type'), typeBadge(l.type)],
      [t('leads_col_program'), l.program],
      ['Source', l.source],
      [t('leads_col_status'), '<span class="yb-lead__badge ' + statusBadgeClass(l.status) + '">' + esc(l.status || 'New') + '</span>'],
      [t('leads_col_date'), fmtDateTime(l.created_at)],
      ['SMS Status', l.sms_status || '\u2014'],
      ['Accommodation', l.accommodation || '\u2014'],
      ['City / Country', l.city_country || '\u2014']
    ];

    if (l.ytt_program_type) rows.push(['YTT Type', l.ytt_program_type]);
    if (l.cohort_label) rows.push(['Cohort', l.cohort_label]);
    if (l.message) rows.push(['Message', l.message]);

    el.innerHTML = '<div class="yb-lead__detail-card">' +
      '<table class="yb-lead__detail-table">' +
      rows.map(function (r) {
        return '<tr><td class="yb-lead__detail-label">' + r[0] + '</td><td>' + (r[1] || '\u2014') + '</td></tr>';
      }).join('') +
      '</table></div>';
  }

  function renderLeadActions() {
    var el = $('yb-lead-actions');
    if (!el || !currentLead) return;

    var phone = currentLead.phone || '';
    var email = currentLead.email || '';

    el.innerHTML =
      (phone ? '<a href="tel:' + esc(phone) + '" class="yb-btn yb-btn--outline yb-btn--sm">\ud83d\udcde ' + t('leads_call') + '</a>' : '') +
      (phone ? '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="lead-sms">\ud83d\udcf1 ' + t('leads_sms') + '</button>' : '') +
      (email ? '<a href="mailto:' + esc(email) + '" class="yb-btn yb-btn--outline yb-btn--sm">\u2709\ufe0f ' + t('leads_email') + '</a>' : '') +
      '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="delete-lead" data-id="' + currentLeadId + '">\ud83d\uddd1 ' + t('delete') + '</button>';
  }

  function populateStatusForm() {
    if (!currentLead) return;
    var statusSelect = $('yb-lead-status-select');
    var notesInput = $('yb-lead-notes-input');
    if (statusSelect) statusSelect.value = currentLead.status || 'New';
    if (notesInput) notesInput.value = currentLead.notes || '';
  }

  /* ═══════════════════════════════════════
     SAVE STATUS / NOTES
     ═══════════════════════════════════════ */
  function saveLeadStatus(e) {
    e.preventDefault();
    if (!currentLeadId) return;

    var newStatus = $('yb-lead-status-select').value;
    var newNotes = $('yb-lead-notes-input').value;

    var updates = {
      status: newStatus,
      notes: newNotes,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (newStatus === 'Contacted' && !currentLead.last_contact) {
      updates.last_contact = firebase.firestore.FieldValue.serverTimestamp();
    }

    db.collection('leads').doc(currentLeadId).update(updates).then(function () {
      // Update local state
      currentLead.status = newStatus;
      currentLead.notes = newNotes;
      var idx = leads.findIndex(function (l) { return l.id === currentLeadId; });
      if (idx !== -1) {
        leads[idx].status = newStatus;
        leads[idx].notes = newNotes;
      }
      renderLeadDetailCard();
      renderLeadActions();
      toast(t('saved'));
    }).catch(function (err) {
      console.error('[lead-admin] Save error:', err);
      toast(t('error_save'), true);
    });
  }

  /* ═══════════════════════════════════════
     DELETE LEAD
     ═══════════════════════════════════════ */
  function deleteLead(leadId) {
    if (!confirm(t('leads_confirm_delete'))) return;

    db.collection('leads').doc(leadId).delete().then(function () {
      leads = leads.filter(function (l) { return l.id !== leadId; });
      backToLeadList();
      renderLeadTable();
      renderLeadStats();
      toast(t('saved'));
    }).catch(function (err) {
      console.error('[lead-admin] Delete error:', err);
      toast(t('error_save'), true);
    });
  }

  /* ═══════════════════════════════════════
     ACTIVITY LOG
     ═══════════════════════════════════════ */
  function loadLeadActivity() {
    var el = $('yb-lead-activity');
    if (!el || !currentLead) return;

    // Check email_log for sent emails
    db.collection('email_log')
      .where('to', '==', currentLead.email)
      .orderBy('sent_at', 'desc')
      .limit(20)
      .get()
      .then(function (snap) {
        if (snap.empty) {
          // Show notes as activity if no email log
          var notes = currentLead.notes || '';
          if (notes) {
            el.innerHTML = '<div class="yb-lead__activity-item"><pre style="white-space:pre-wrap;font-size:0.85rem;color:var(--yb-muted)">' + esc(notes) + '</pre></div>';
          } else {
            el.innerHTML = '<p style="color:var(--yb-muted);font-size:0.85rem">' + t('leads_no_activity') + '</p>';
          }
          return;
        }

        var html = '';
        snap.forEach(function (doc) {
          var d = doc.data();
          html += '<div class="yb-lead__activity-item">' +
            '<span class="yb-lead__activity-icon">\u2709\ufe0f</span>' +
            '<div><strong>' + esc(d.subject || 'Email') + '</strong>' +
            '<br><span style="font-size:0.8rem;color:var(--yb-muted)">' + fmtDateTime(d.sent_at) + '</span></div>' +
            '</div>';
        });

        // Also show notes
        if (currentLead.notes) {
          html += '<div class="yb-lead__activity-item" style="margin-top:1rem">' +
            '<span class="yb-lead__activity-icon">\ud83d\udcdd</span>' +
            '<pre style="white-space:pre-wrap;font-size:0.85rem;color:var(--yb-muted);margin:0">' + esc(currentLead.notes) + '</pre></div>';
        }

        el.innerHTML = html;
      })
      .catch(function (err) {
        console.error('[lead-admin] Activity load error:', err);
        // Fallback: just show notes
        var notes = currentLead.notes || '';
        el.innerHTML = notes ?
          '<pre style="white-space:pre-wrap;font-size:0.85rem;color:var(--yb-muted)">' + esc(notes) + '</pre>' :
          '<p style="color:var(--yb-muted);font-size:0.85rem">' + t('leads_no_activity') + '</p>';
      });
  }

  /* ═══════════════════════════════════════
     EVENT BINDING
     ═══════════════════════════════════════ */
  function bindLeadEvents() {
    // Delegated click handler
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');

      switch (action) {
        case 'view-lead': e.preventDefault(); showLeadDetail(id); break;
        case 'back-leads': backToLeadList(); break;
        case 'leads-refresh': loadLeads(); break;
        case 'leads-load-more': loadLeads(true); break;
        case 'delete-lead': deleteLead(id || currentLeadId); break;
        case 'lead-sms': promptSendSMS(); break;
      }
    });

    // Search form
    var searchForm = $('yb-lead-search-form');
    if (searchForm) {
      searchForm.addEventListener('submit', function (e) {
        e.preventDefault();
        searchTerm = ($('yb-lead-search-input') || {}).value || '';
        renderLeadTable();
      });
    }

    // Status filter
    var statusFilter = $('yb-lead-status-filter');
    if (statusFilter) {
      statusFilter.addEventListener('change', function () {
        filterStatus = statusFilter.value;
        loadLeads();
      });
    }

    // Type filter
    var typeFilter = $('yb-lead-type-filter');
    if (typeFilter) {
      typeFilter.addEventListener('change', function () {
        filterType = typeFilter.value;
        loadLeads();
      });
    }

    // Status save form
    var statusForm = $('yb-lead-status-form');
    if (statusForm) statusForm.addEventListener('submit', saveLeadStatus);

    // Row click in table
    var table = $('yb-lead-table');
    if (table) {
      table.addEventListener('click', function (e) {
        var row = e.target.closest('.yb-lead__row');
        if (row && !e.target.closest('button')) {
          var id = row.getAttribute('data-id');
          if (id) showLeadDetail(id);
        }
      });
    }
  }

  /* ═══════════════════════════════════════
     SMS PROMPT
     ═══════════════════════════════════════ */
  function promptSendSMS() {
    if (!currentLead || !currentLead.phone) return;
    var message = prompt('SMS message to ' + currentLead.phone + ':', 'Hi ' + (currentLead.first_name || '') + '! ');
    if (!message) return;

    // Get auth token
    firebase.auth().currentUser.getIdToken().then(function (token) {
      return fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ leadId: currentLeadId, message: message })
      });
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          toast('SMS sent!');
          // Update local sms_status
          currentLead.sms_status = 'sent';
          renderLeadDetailCard();
        } else {
          toast('SMS failed: ' + (data.error || 'Unknown'), true);
        }
      }).catch(function (err) {
        console.error('[lead-admin] SMS error:', err);
        toast('SMS error: ' + err.message, true);
      });
  }

  /* ═══════════════════════════════════════
     INIT — hooks into the admin tab system
     ═══════════════════════════════════════ */
  function initLeadAdmin() {
    T = window._ybAdminT || {};

    // Wait for firebase
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
    db = firebase.firestore();

    bindLeadEvents();

    // Hook into tab switching: load leads when Leads tab first clicked
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-yb-admin-tab') === 'leads' && !leadsLoaded) {
          loadLeads();
          leadsLoaded = true;
        }
      });
    });
  }

  // Bootstrap — wait for firebase like course-admin.js does
  var checkInterval = setInterval(function () {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      initLeadAdmin();
    }
  }, 100);

})();
