/**
 * YOGA BIBLE — CAREER APPLICATIONS ADMIN
 * Manages the "Careers" tab in the admin panel.
 * Reads/writes from Firestore `leads` collection (type='careers').
 *
 * Features:
 *  - Sortable table (date)
 *  - Filters: status, category, role, experience
 *  - Search by name / email
 *  - Detail view with status update, notes timeline, file links
 *  - CSV export
 *  - Quick actions: email, call
 *  - Pagination (load more)
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var db;
  var T = {};

  var careers = [];
  var careersLoaded = false;
  var currentCareerId = null;
  var currentCareer = null;
  var careerLastDoc = null;
  var PAGE_SIZE = 10000; // Load all at once for instant search
  var careerSearch = '';
  var careerFilterStatus = '';
  var careerFilterCategory = '';
  var careerFilterRole = '';
  var careerFilterExp = '';
  var careerSortField = 'created_at';
  var careerSortDir = 'desc';
  var expandedCareerIds = new Set();
  var selectedCareerIds = new Set();
  var showArchivedCareers = false;

  /* ══════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════ */
  function t(k) { return T[k] || k; } // legacy helper — prefer T.key directly

  // Resolve the Firestore doc ref for a career entry (legacy 'careers' or 'leads' collection)
  function careerDocRef(entry) {
    var col = (entry && entry._col === 'careers') ? 'careers' : 'leads';
    return db.collection(col).doc(entry.id);
  }
  function careerDocRefById(id) {
    var entry = careers.find(function (c) { return c.id === id; });
    return careerDocRef(entry || { id: id });
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function $(id) { return document.getElementById(id); }

  function toast(msg, isError) {
    var el = $('yb-admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'yb-admin__toast' + (isError ? ' yb-admin__toast--error' : '');
    el.hidden = false;
    clearTimeout(el._tid);
    el._tid = setTimeout(function () { el.hidden = true; }, 3500);
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

  /* ══════════════════════════════════════════
     STATUS SYSTEM
     ══════════════════════════════════════════ */
  var CAREER_STATUSES = [
    { value: 'New',              label: 'New',              color: '#fff3cd', text: '#856404', icon: '\u2728' },
    { value: 'Reviewing',        label: 'Reviewing',        color: '#d1ecf1', text: '#0c5460', icon: '\ud83d\udd0d' },
    { value: 'Interviewed',      label: 'Interviewed',      color: '#DCEDC8', text: '#33691E', icon: '\ud83d\udcac' },
    { value: 'Trial Scheduled',  label: 'Trial Scheduled',  color: '#e8daef', text: '#6c3483', icon: '\ud83d\udcc5' },
    { value: 'Offered',          label: 'Offered',          color: '#cce5ff', text: '#004085', icon: '\ud83c\udf89' },
    { value: 'Hired',            label: 'Hired',            color: '#d4edda', text: '#155724', icon: '\u2705' },
    { value: 'On Hold',          label: 'On Hold',          color: '#FFF9C4', text: '#F57F17', icon: '\u23f8\ufe0f' },
    { value: 'Rejected',         label: 'Rejected',         color: '#f8d7da', text: '#721c24', icon: '\ud83d\udc4e' },
    { value: 'Withdrawn',        label: 'Withdrawn',        color: '#ECEFF1', text: '#546E7F', icon: '\u21a9\ufe0f' }
  ];

  function getCareerStatusMeta(status) {
    return CAREER_STATUSES.find(function (s) { return s.value === status; }) || CAREER_STATUSES[0];
  }

  function careerStatusBadgeHtml(status) {
    var m = getCareerStatusMeta(status || 'New');
    return '<span class="yb-lead__badge" style="background:' + m.color + ';color:' + m.text + '">' +
      m.icon + ' ' + esc(m.label) + '</span>';
  }

  /* ══════════════════════════════════════════
     LOAD CAREERS
     ══════════════════════════════════════════ */
  /* ══════════════════════════════════════════
     BULK SELECTION
     ══════════════════════════════════════════ */
  function updateBulkBar() {
    var bar = $('yb-career-bulk-bar');
    var countEl = $('yb-career-bulk-count');
    var selectAllCb = $('yb-career-select-all');
    var n = selectedCareerIds.size;

    if (bar) bar.hidden = n === 0;
    if (countEl) countEl.textContent = n + ' ' + (T.leads_selected || 'valgt');

    // Update select-all indeterminate state
    if (selectAllCb) {
      var filtered = getFilteredCareers();
      var allSelected = filtered.length > 0 && filtered.every(function (c) { return selectedCareerIds.has(c.id); });
      var someSelected = filtered.some(function (c) { return selectedCareerIds.has(c.id); });
      selectAllCb.checked = allSelected;
      selectAllCb.indeterminate = someSelected && !allSelected;
    }
  }

  function openBulkStatusModal() {
    var modal = $('yb-career-bulk-modal');
    if (modal) modal.hidden = false;
  }

  function closeBulkStatusModal() {
    var modal = $('yb-career-bulk-modal');
    if (modal) modal.hidden = true;
  }

  function applyBulkStatus() {
    var sel = $('yb-career-bulk-status-select');
    var newStatus = sel ? sel.value : '';
    if (!newStatus || !selectedCareerIds.size) return;

    var ids = Array.from(selectedCareerIds);
    var batch = db.batch();
    ids.forEach(function (id) {
      batch.update(careerDocRefById(id), { status: newStatus, updated_at: new Date() });
    });

    batch.commit().then(function () {
      // Update in-memory
      ids.forEach(function (id) {
        var c = careers.find(function (c) { return c.id === id; });
        if (c) c.status = newStatus;
      });
      selectedCareerIds.clear();
      closeBulkStatusModal();
      renderCareersTable();
      renderCareerStats();
      updateBulkBar();
      toast(T.saved || 'Saved!');
    }).catch(function (err) {
      console.error('[careers-admin] Bulk status error:', err);
      toast(T.error_save || 'Error.', true);
    });
  }

  function bulkEmail() {
    var filtered = getFilteredCareers();
    var emails = filtered
      .filter(function (c) { return selectedCareerIds.has(c.id) && c.email; })
      .map(function (c) { return c.email; });
    if (!emails.length) return;
    window.open('mailto:' + emails.join(','), '_blank');
  }

  function bulkArchive() {
    if (!selectedCareerIds.size) return;
    if (!confirm((T.leads_confirm_archive || 'Archive') + ' ' + selectedCareerIds.size + ' entries?')) return;

    var ids = Array.from(selectedCareerIds);
    var batch = db.batch();
    ids.forEach(function (id) {
      batch.update(careerDocRefById(id), { archived: true, status: 'Archived', updated_at: new Date() });
    });

    batch.commit().then(function () {
      if (!showArchivedCareers) {
        careers = careers.filter(function (c) { return ids.indexOf(c.id) === -1; });
      } else {
        ids.forEach(function (id) {
          var c = careers.find(function (c) { return c.id === id; });
          if (c) { c.archived = true; c.status = 'Archived'; }
        });
      }
      selectedCareerIds.clear();
      renderCareersTable();
      renderCareerStats();
      updateBulkBar();
      toast(T.saved || 'Archived!');
    }).catch(function (err) {
      console.error('[careers-admin] Bulk archive error:', err);
      toast(T.error_save || 'Error.', true);
    });
  }

  function toggleArchivedView() {
    showArchivedCareers = !showArchivedCareers;
    var btn = $('yb-career-archive-toggle');
    if (btn) {
      btn.textContent = showArchivedCareers
        ? '\ud83d\udce6 ' + (T.leads_hide_archived || 'Hide archived')
        : '\ud83d\udce6 ' + (T.leads_show_archived || 'Show archived');
    }
    // Reset and reload with archived toggle
    careers = [];
    careerLastDoc = null;
    selectedCareerIds.clear();
    loadCareers();
  }

  var spamCleaned = false;

  function loadCareers(append) {
    if (!append) {
      careers = [];
      careerLastDoc = null;
      expandedCareerIds.clear();
    }

    // Single source of truth: leads collection (type=careers)
    db.collection('leads')
      .where('type', '==', 'careers')
      .get()
      .then(function (snap) {
        snap.forEach(function (doc) {
          var d = Object.assign({ id: doc.id, _col: 'leads' }, doc.data());
          careers.push(d);
        });

        // Sort client-side
        careers.sort(function (a, b) {
          var av = a[careerSortField], bv = b[careerSortField];
          if (av && av.toDate) av = av.toDate();
          if (bv && bv.toDate) bv = bv.toDate();
          if (av < bv) return careerSortDir === 'asc' ? -1 : 1;
          if (av > bv) return careerSortDir === 'asc' ? 1 : -1;
          return 0;
        });

        // Auto-delete spam: on first load, permanently delete all records that
        // have gibberish names (no category, no role, no experience) — these are spam.
        if (!spamCleaned) {
          spamCleaned = true;
          var spamIds = [];
          careers.forEach(function (c) {
            // Spam indicators: no category AND no role AND no experience
            if (!c.category && !c.role && !c.experience) {
              spamIds.push({ id: c.id, col: c._col || 'leads' });
            }
          });
          if (spamIds.length > 0) {
            console.log('[careers-admin] Deleting ' + spamIds.length + ' spam records…');
            var batch = db.batch();
            spamIds.forEach(function (s) {
              batch.delete(db.collection(s.col).doc(s.id));
            });
            batch.commit().then(function () {
              console.log('[careers-admin] Deleted ' + spamIds.length + ' spam records');
              // Remove deleted spam from local array
              var deletedIds = {};
              spamIds.forEach(function (s) { deletedIds[s.id] = true; });
              careers = careers.filter(function (c) { return !deletedIds[c.id]; });
              renderCareersTable();
              renderCareerStats();
            }).catch(function (err) {
              console.error('[careers-admin] Spam cleanup failed:', err);
            });
          }
        }

        renderCareersTable();
        renderCareerStats();

        // Hide Load More — everything is already loaded
        var loadMore = $('yb-career-load-more-wrap');
        if (loadMore) loadMore.hidden = true;

      }).catch(function (err) {
        console.error('[careers-admin] Load error:', err);
        toast(t('error_load'), true);
      });
  }

  /* ══════════════════════════════════════════
     FILTER + SEARCH
     ══════════════════════════════════════════ */
  function getFilteredCareers() {
    var filtered = careers;

    // Filter archived / status client-side (avoids Firestore composite index requirements)
    if (showArchivedCareers) {
      filtered = filtered.filter(function (c) { return c.status === 'Archived' || c.archived; });
    } else {
      filtered = filtered.filter(function (c) { return c.status !== 'Archived' && !c.archived; });
    }

    if (careerFilterStatus) {
      filtered = filtered.filter(function (c) { return (c.status || 'New') === careerFilterStatus; });
    }

    // Client-side category + role + exp filters
    if (careerFilterCategory) {
      filtered = filtered.filter(function (c) {
        return (c.category || '').indexOf(careerFilterCategory) !== -1;
      });
    }
    if (careerFilterRole) {
      filtered = filtered.filter(function (c) {
        return (c.role || '') === careerFilterRole;
      });
    }
    if (careerFilterExp) {
      filtered = filtered.filter(function (c) {
        return (c.experience || '') === careerFilterExp;
      });
    }

    if (careerSearch) {
      var s = careerSearch.toLowerCase();
      filtered = filtered.filter(function (c) {
        return (c.email || '').toLowerCase().indexOf(s) !== -1 ||
          (c.first_name || '').toLowerCase().indexOf(s) !== -1 ||
          (c.last_name || '').toLowerCase().indexOf(s) !== -1 ||
          (c.phone || '').indexOf(s) !== -1 ||
          (c.category || '').toLowerCase().indexOf(s) !== -1 ||
          (c.role || '').toLowerCase().indexOf(s) !== -1 ||
          (c.message || '').toLowerCase().indexOf(s) !== -1;
      });
    }

    return filtered;
  }

  /* ══════════════════════════════════════════
     RENDER STATS
     ══════════════════════════════════════════ */
  function renderCareerStats() {
    var el = $('yb-career-stats');
    if (!el) return;

    var counts = {};
    CAREER_STATUSES.forEach(function (s) { counts[s.value] = 0; });
    careers.forEach(function (c) {
      var st = c.status || 'New';
      if (counts[st] !== undefined) counts[st]++;
    });

    var html = CAREER_STATUSES.filter(function (s) {
      return counts[s.value] > 0 || s.value === 'New';
    }).map(function (s) {
      return '<div class="yb-lead__stat-card" data-filter-career-status="' + esc(s.value) + '" style="cursor:pointer">' +
        '<span class="yb-lead__stat-num" style="color:' + s.text + '">' + counts[s.value] + '</span>' +
        '<span class="yb-lead__stat-label">' + s.icon + ' ' + esc(s.label) + '</span>' +
        '</div>';
    }).join('');

    el.innerHTML = html;
  }

  /* ══════════════════════════════════════════
     RENDER TABLE
     ══════════════════════════════════════════ */
  function renderCareersTable() {
    var tbody = $('yb-career-table-body');
    if (!tbody) return;

    var filtered = getFilteredCareers();
    var countEl = $('yb-career-count');
    if (countEl) countEl.textContent = filtered.length + ' / ' + careers.length;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--yb-muted)">' +
        (T.leads_no_leads || 'No entries found') + '</td></tr>';
      return;
    }

    var rows = filtered.map(function (c) {
      var name = esc((c.first_name || '') + ' ' + (c.last_name || '')).trim() || '\u2014';
      var email = esc(c.email || '\u2014');
      var phone = esc(c.phone || '');
      var category = esc(c.category || '\u2014');
      var role = esc(c.role || '\u2014');
      var exp = esc(c.experience || '\u2014');
      var fileCount = c.file_count || (c.files ? c.files.length : 0);
      var filesHtml = fileCount > 0
        ? '<span style="color:#f75c03;font-weight:700">📎 ' + fileCount + '</span>'
        : '<span style="color:#ccc">—</span>';
      var isExpanded = expandedCareerIds.has(c.id);
      var isSelected = selectedCareerIds.has(c.id);

      var row = '<tr class="yb-lead__row' + (isSelected ? ' is-selected' : '') + '" data-career-id="' + esc(c.id) + '">' +
        '<td class="yb-lead__td-chevron"><button class="yb-lead__expand-btn" data-career-expand="' + esc(c.id) + '">' +
          (isExpanded ? '▾' : '▸') + '</button></td>' +
        '<td class="yb-lead__td-cb"><input type="checkbox" class="yb-career-cb" data-career-cb="' + esc(c.id) + '"' +
          (isSelected ? ' checked' : '') + '></td>' +
        '<td style="white-space:nowrap">' + fmtDate(c.created_at) + '</td>' +
        '<td><strong>' + name + '</strong></td>' +
        '<td><div style="font-size:0.85rem">' + email + (phone ? '<br><a href="tel:' + phone + '" class="yb-lead__cell-phone-link" onclick="event.stopPropagation()">' + phone + '</a>' : '') + '</div></td>' +
        '<td style="font-size:0.85rem;max-width:160px">' + category + '</td>' +
        '<td style="font-size:0.85rem">' + role + '</td>' +
        '<td style="font-size:0.85rem">' + exp + '</td>' +
        '<td>' + careerStatusBadgeHtml(c.status) + '</td>' +
        '<td>' + filesHtml + '</td>' +
        '<td><button class="yb-btn yb-btn--sm yb-btn--outline" data-career-open="' + esc(c.id) + '">' +
          (T.leads_view || 'View') + '</button></td>' +
        '</tr>';

      // Expandable detail row
      if (isExpanded) {
        row += '<tr class="yb-lead__expand-row" data-career-expand-body="' + esc(c.id) + '">' +
          '<td colspan="11">' + buildCareerExpandHtml(c) + '</td></tr>';
      }

      return row;
    }).join('');

    tbody.innerHTML = rows;
  }

  function buildCareerExpandHtml(c) {
    var bg = esc(c.background || '');
    var msg = esc(c.message || '');
    var links = esc(c.links || '');
    var sub = esc(c.subcategory || '');
    var city = esc(c.city_country || '');
    var langs = esc(c.languages || '');

    var filesHtml = '';
    if (c.files && c.files.length) {
      filesHtml = '<div style="margin-top:0.75rem"><strong>Files:</strong><ul style="margin:0.25rem 0 0;padding-left:1.25rem">';
      c.files.forEach(function (f) {
        if (f.filename) {
          filesHtml += '<li style="font-size:0.85rem">' + esc(f.filename) +
            ' <span style="color:#888">(' + f.kind + ')</span></li>';
        }
      });
      filesHtml += '</ul></div>';
    } else if (c.file_names) {
      filesHtml = '<div style="margin-top:0.75rem;font-size:0.85rem"><strong>Files:</strong> ' + esc(c.file_names) + '</div>';
    }

    var html = '<div class="yb-lead__expand-body" style="padding:0.75rem 1rem">' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.5rem 1.5rem;font-size:0.85rem;margin-bottom:0.75rem">';

    if (sub)   html += '<div><strong>Subcategory:</strong> ' + sub + '</div>';
    if (city)  html += '<div><strong>City:</strong> ' + city + '</div>';
    if (langs) html += '<div><strong>Languages:</strong> ' + langs + '</div>';
    if (links) html += '<div><strong>Links:</strong> <a href="' + esc(links) + '" target="_blank" rel="noopener" style="color:#f75c03">' + esc(links) + '</a></div>';

    html += '</div>';

    if (bg)  html += '<div style="font-size:0.85rem;margin-bottom:0.5rem"><strong>Background:</strong><br><span style="white-space:pre-wrap">' + bg + '</span></div>';
    if (msg) html += '<div style="font-size:0.85rem"><strong>Message:</strong><br><span style="white-space:pre-wrap">' + msg + '</span></div>';

    html += filesHtml + '</div>';
    return html;
  }

  /* ══════════════════════════════════════════
     DETAIL VIEW
     ══════════════════════════════════════════ */
  function showCareerDetail(id) {
    var career = careers.find(function (c) { return c.id === id; });
    if (!career) return;

    currentCareerId = id;
    currentCareer = career;

    var listView = $('yb-admin-v-career-list');
    var detailView = $('yb-admin-v-career-detail');
    if (listView) listView.hidden = true;
    if (detailView) detailView.hidden = false;

    var heading = $('yb-career-detail-heading');
    if (heading) heading.textContent = (career.first_name || '') + ' ' + (career.last_name || '');

    // Render main card
    renderCareerDetailCard(career);
    renderCareerQuickActions(career);
    renderCareerNotes(career);

    // Set current status in form
    var sel = $('yb-career-status-select');
    if (sel) sel.value = career.status || 'New';
  }

  function renderCareerDetailCard(c) {
    var el = $('yb-career-detail-card');
    if (!el) return;

    var filesHtml = '';
    if (c.files && c.files.length) {
      filesHtml = '<div class="yb-lead__detail-field yb-lead__detail-field--full">' +
        '<span class="yb-lead__detail-label">Files</span>' +
        '<ul style="margin:0;padding-left:1.25rem">';
      c.files.forEach(function (f) {
        if (f.filename) {
          filesHtml += '<li style="font-size:0.9rem">📎 ' + esc(f.filename) +
            ' <span style="color:#888">(' + f.kind + ')</span></li>';
        }
      });
      filesHtml += '</ul></div>';
    } else if (c.file_names) {
      filesHtml = '<div class="yb-lead__detail-field yb-lead__detail-field--full">' +
        '<span class="yb-lead__detail-label">Files</span>' +
        '<span>📎 ' + esc(c.file_names) + '</span></div>';
    }

    var statusHtml = careerStatusBadgeHtml(c.status);

    el.innerHTML = '<div class="yb-lead__detail-grid">' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Name</span><strong>' +
        esc((c.first_name || '') + ' ' + (c.last_name || '')) + '</strong></div>' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Status</span>' + statusHtml + '</div>' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Email</span>' +
        '<a href="mailto:' + esc(c.email || '') + '" style="color:#f75c03">' + esc(c.email || '—') + '</a></div>' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Phone</span>' + (c.phone ? '<a href="tel:' + esc(c.phone) + '" style="color:#f75c03">' + esc(c.phone) + '</a>' : '—') + '</div>' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Category</span>' + esc(c.category || '—') + '</div>' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Subcategory</span>' + esc(c.subcategory || '—') + '</div>' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Role</span>' + esc(c.role || '—') + '</div>' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Experience</span>' + esc(c.experience || '—') + '</div>' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">City / Country</span>' + esc(c.city_country || '—') + '</div>' +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Languages</span>' + esc(c.languages || '—') + '</div>' +
      (c.links ? '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Links</span>' +
        '<a href="' + esc(c.links) + '" target="_blank" rel="noopener" style="color:#f75c03;word-break:break-all">' + esc(c.links) + '</a></div>' : '') +
      '<div class="yb-lead__detail-field"><span class="yb-lead__detail-label">Submitted</span>' + fmtDateTime(c.created_at) + '</div>' +
      '<div class="yb-lead__detail-field yb-lead__detail-field--full"><span class="yb-lead__detail-label">Background</span>' +
        '<span style="white-space:pre-wrap;font-size:0.9rem">' + esc(c.background || '—') + '</span></div>' +
      '<div class="yb-lead__detail-field yb-lead__detail-field--full"><span class="yb-lead__detail-label">Message</span>' +
        '<span style="white-space:pre-wrap;font-size:0.9rem">' + esc(c.message || '—') + '</span></div>' +
      filesHtml +
      '</div>';
  }

  function renderCareerQuickActions(c) {
    var el = $('yb-career-actions');
    if (!el) return;
    el.innerHTML =
      '<button class="yb-btn yb-btn--outline yb-btn--sm" data-career-action="email">\u2709\uFE0F Email</button>' +
      (c.phone ? '<button class="yb-btn yb-btn--outline yb-btn--sm" data-career-action="call">\ud83d\udcde Call</button>' : '');
  }

  /* ══════════════════════════════════════════
     NOTES TIMELINE
     ══════════════════════════════════════════ */
  function renderCareerNotes(c) {
    var el = $('yb-career-notes-timeline');
    if (!el) return;

    var notes = c.notes || [];
    if (!notes.length) {
      el.innerHTML = '<p class="yb-lead__empty-text">' + (t('leads_no_notes') || 'No notes yet.') + '</p>';
      return;
    }

    el.innerHTML = notes.slice().reverse().map(function (n) {
      var text = typeof n === 'string' ? n : (n.text || '');
      var ts = typeof n === 'object' && n.created_at ? fmtDateTime(n.created_at) : '';
      return '<div class="yb-lead__note-item">' +
        '<div class="yb-lead__note-meta">' + esc(ts) + '</div>' +
        '<div class="yb-lead__note-text">' + esc(text) + '</div>' +
        '</div>';
    }).join('');
  }

  function addCareerNote() {
    if (!currentCareerId) return;
    var inp = $('yb-career-note-input');
    var text = inp ? inp.value.trim() : '';
    if (!text) return;

    var note = {
      text: text,
      created_at: new Date(),
      author: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
    };

    careerDocRef(currentCareer).update({
      notes: firebase.firestore.FieldValue.arrayUnion(note),
      updated_at: new Date()
    }).then(function () {
      if (!currentCareer.notes) currentCareer.notes = [];
      currentCareer.notes.push(note);
      renderCareerNotes(currentCareer);
      if (inp) inp.value = '';
      toast(t('saved') || 'Saved!');
    }).catch(function (err) {
      console.error('[careers-admin] Note error:', err);
      toast(t('error_save') || 'Error saving.', true);
    });
  }

  /* ══════════════════════════════════════════
     STATUS UPDATE
     ══════════════════════════════════════════ */
  function saveCareerStatus() {
    if (!currentCareerId) return;
    var sel = $('yb-career-status-select');
    var archiveCb = $('yb-career-archive-check');
    var newStatus = sel ? sel.value : '';
    var doArchive = archiveCb ? archiveCb.checked : false;
    if (!newStatus) return;

    var update = { status: newStatus, updated_at: new Date() };
    if (doArchive) update.archived = true;

    careerDocRef(currentCareer).update(update).then(function () {
      currentCareer.status = newStatus;
      if (doArchive) currentCareer.archived = true;
      // Also update in-memory list
      var idx = careers.findIndex(function (c) { return c.id === currentCareerId; });
      if (idx !== -1) {
        careers[idx].status = newStatus;
        if (doArchive) careers[idx].archived = true;
      }

      renderCareerDetailCard(currentCareer);
      toast(T.saved || 'Saved!');

      // If archived and not showing archived, go back to list
      if (doArchive && !showArchivedCareers) {
        careers = careers.filter(function (c) { return c.id !== currentCareerId; });
        showCareerList();
      }
    }).catch(function (err) {
      console.error('[careers-admin] Status save error:', err);
      toast(T.error_save || 'Error saving.', true);
    });
  }

  /* ══════════════════════════════════════════
     CSV EXPORT
     ══════════════════════════════════════════ */
  function exportCareersCsv() {
    var filtered = getFilteredCareers();
    if (!filtered.length) { toast('No data to export.', true); return; }

    var cols = ['Date', 'First Name', 'Last Name', 'Email', 'Phone', 'Category', 'Subcategory', 'Role', 'Experience', 'City', 'Languages', 'Links', 'Status', 'Files', 'Message'];
    var rows = filtered.map(function (c) {
      return [
        fmtDate(c.created_at),
        c.first_name || '',
        c.last_name || '',
        c.email || '',
        c.phone || '',
        c.category || '',
        c.subcategory || '',
        c.role || '',
        c.experience || '',
        c.city_country || '',
        c.languages || '',
        c.links || '',
        c.status || '',
        c.file_names || (c.files ? c.files.map(function (f) { return f.filename; }).join('; ') : ''),
        (c.message || '').replace(/\n/g, ' ').substring(0, 300)
      ].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    });

    var csv = [cols.map(function (h) { return '"' + h + '"'; }).join(',')].concat(rows).join('\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'careers-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ══════════════════════════════════════════
     NAVIGATION
     ══════════════════════════════════════════ */
  function showCareerList() {
    currentCareerId = null;
    currentCareer = null;
    var listView = $('yb-admin-v-career-list');
    var detailView = $('yb-admin-v-career-detail');
    if (listView) listView.hidden = false;
    if (detailView) detailView.hidden = true;
    renderCareersTable();
  }

  /* ══════════════════════════════════════════
     EVENT BINDING
     ══════════════════════════════════════════ */
  function bindCareerEvents() {

    // Search form
    var searchForm = $('yb-career-search-form');
    if (searchForm) {
      var inp = $('yb-career-search-input');
      if (inp) {
        inp.addEventListener('input', function () {
          careerSearch = inp.value.trim();
          renderCareersTable();
        });
      }
      searchForm.addEventListener('submit', function (e) { e.preventDefault(); });
    }

    // Status filter (client-side to avoid composite index requirements)
    var statusFilter = $('yb-career-status-filter');
    if (statusFilter) {
      statusFilter.addEventListener('change', function () {
        careerFilterStatus = statusFilter.value;
        renderCareersTable();
        renderCareerStats();
      });
    }

    // Category filter
    var catFilter = $('yb-career-category-filter');
    if (catFilter) {
      catFilter.addEventListener('change', function () {
        careerFilterCategory = catFilter.value;
        renderCareersTable();
      });
    }

    // Role filter
    var roleFilter = $('yb-career-role-filter');
    if (roleFilter) {
      roleFilter.addEventListener('change', function () {
        careerFilterRole = roleFilter.value;
        renderCareersTable();
      });
    }

    // Experience filter
    var expFilter = $('yb-career-exp-filter');
    if (expFilter) {
      expFilter.addEventListener('change', function () {
        careerFilterExp = expFilter.value;
        renderCareersTable();
      });
    }

    // Select-all checkbox
    var selectAllCb = $('yb-career-select-all');
    if (selectAllCb) {
      selectAllCb.addEventListener('change', function () {
        var filtered = getFilteredCareers();
        if (selectAllCb.checked) {
          filtered.forEach(function (c) { selectedCareerIds.add(c.id); });
        } else {
          filtered.forEach(function (c) { selectedCareerIds.delete(c.id); });
        }
        renderCareersTable();
        updateBulkBar();
      });
    }

    // Delegated clicks
    document.addEventListener('click', function (e) {

      // Individual row checkbox
      var cb = e.target.closest('[data-career-cb]');
      if (cb) {
        var cbId = cb.getAttribute('data-career-cb');
        if (cb.checked) {
          selectedCareerIds.add(cbId);
        } else {
          selectedCareerIds.delete(cbId);
        }
        updateBulkBar();
        // Update row selected class
        var row = document.querySelector('[data-career-id="' + cbId + '"]');
        if (row) row.classList.toggle('is-selected', cb.checked);
        return;
      }

      // Expand row
      var expandBtn = e.target.closest('[data-career-expand]');
      if (expandBtn) {
        var cid = expandBtn.getAttribute('data-career-expand');
        if (expandedCareerIds.has(cid)) {
          expandedCareerIds.delete(cid);
        } else {
          expandedCareerIds.add(cid);
        }
        renderCareersTable();
        return;
      }

      // Open detail
      var openBtn = e.target.closest('[data-career-open]');
      if (openBtn) {
        var id = openBtn.getAttribute('data-career-open');
        showCareerDetail(id);
        return;
      }

      // Back to list
      if (e.target.closest('[data-action="back-careers"]')) {
        showCareerList();
        return;
      }

      // Archive toggle
      if (e.target.closest('[data-action="careers-toggle-archived"]')) {
        toggleArchivedView();
        return;
      }

      // Bulk: open status modal
      if (e.target.closest('[data-action="career-bulk-status"]')) {
        if (selectedCareerIds.size) openBulkStatusModal();
        return;
      }

      // Bulk: email
      if (e.target.closest('[data-action="career-bulk-email"]')) {
        bulkEmail();
        return;
      }

      // Bulk: archive
      if (e.target.closest('[data-action="career-bulk-archive"]')) {
        bulkArchive();
        return;
      }

      // Bulk: deselect
      if (e.target.closest('[data-action="career-bulk-deselect"]')) {
        selectedCareerIds.clear();
        renderCareersTable();
        updateBulkBar();
        return;
      }

      // Bulk modal: close
      if (e.target.closest('[data-action="career-bulk-modal-close"]')) {
        closeBulkStatusModal();
        return;
      }

      // Bulk modal: apply status
      if (e.target.closest('[data-action="career-bulk-status-apply"]')) {
        applyBulkStatus();
        return;
      }

      // Refresh
      if (e.target.closest('[data-action="careers-refresh"]')) {
        careers = [];
        careerLastDoc = null;
        selectedCareerIds.clear();
        loadCareers();
        return;
      }

      // Export CSV
      if (e.target.closest('[data-action="careers-export-csv"]')) {
        exportCareersCsv();
        return;
      }

      // Load more
      if (e.target.closest('[data-action="careers-load-more"]')) {
        loadCareers(true);
        return;
      }

      // Sort by date (client-side sort of loaded data)
      var sortBtn = e.target.closest('[data-career-sort]');
      if (sortBtn) {
        var field = sortBtn.getAttribute('data-career-sort');
        if (careerSortField === field) {
          careerSortDir = careerSortDir === 'desc' ? 'asc' : 'desc';
        } else {
          careerSortField = field;
          careerSortDir = 'desc';
        }
        careers.sort(function (a, b) {
          var av = a[field], bv = b[field];
          if (av && av.toDate) av = av.toDate();
          if (bv && bv.toDate) bv = bv.toDate();
          if (av < bv) return careerSortDir === 'asc' ? -1 : 1;
          if (av > bv) return careerSortDir === 'asc' ? 1 : -1;
          return 0;
        });
        renderCareersTable();
        return;
      }

      // Stats card click — filter by status (client-side)
      var statCard = e.target.closest('[data-filter-career-status]');
      if (statCard) {
        var st = statCard.getAttribute('data-filter-career-status');
        careerFilterStatus = st || '';
        var sel = $('yb-career-status-filter');
        if (sel) sel.value = careerFilterStatus;
        renderCareersTable();
        return;
      }

      // Quick action: email
      var qBtn = e.target.closest('[data-career-action]');
      if (qBtn && currentCareer) {
        var action = qBtn.getAttribute('data-career-action');
        if (action === 'email') {
          window.open('mailto:' + encodeURIComponent(currentCareer.email || ''), '_blank');
        } else if (action === 'call' && currentCareer.phone) {
          window.open('tel:' + currentCareer.phone.replace(/\s/g, ''), '_blank');
        }
        return;
      }
    });

    // Status form
    var statusForm = $('yb-career-status-form');
    if (statusForm) {
      statusForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveCareerStatus();
      });
    }

    // Note form
    var noteForm = $('yb-career-note-form');
    if (noteForm) {
      noteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        addCareerNote();
      });
    }
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function initCareersAdmin() {
    T = window._ybAdminT || {};

    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
    db = firebase.firestore();

    bindCareerEvents();

    // Hook into tab switching
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-yb-admin-tab');
        if (tab === 'careers' && !careersLoaded) {
          loadCareers();
          careersLoaded = true;
        }
      });
    });
  }

  // Bootstrap
  var checkInterval = setInterval(function () {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      initCareersAdmin();
    }
  }, 100);

})();
