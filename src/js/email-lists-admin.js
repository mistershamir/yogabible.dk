/**
 * YOGA BIBLE — EMAIL LISTS ADMIN
 * Manages email contact lists: CRUD, CSV import, engagement tracking, campaign reports.
 * Loaded on the admin panel under the "Email Lists" tab.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════ */
  var lists = [];
  var currentList = null;
  var currentContacts = [];
  var csvData = null; // parsed CSV rows
  var csvHeaders = []; // CSV column headers
  var contactPage = 0;
  var CONTACTS_PER_PAGE = 50;
  var contactSearch = '';
  var contactFilter = 'all';

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function toast(msg, isError) {
    if (window._ybLeadData && window._ybLeadData.toast) {
      window._ybLeadData.toast(msg, isError);
    } else {
      alert(msg);
    }
  }

  function getToken() {
    if (window.firebase && firebase.auth().currentUser) {
      return firebase.auth().currentUser.getIdToken();
    }
    return Promise.reject(new Error('Not authenticated'));
  }

  function api(method, path, body) {
    return getToken().then(function (token) {
      var opts = {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
      };
      if (body) opts.body = JSON.stringify(body);
      return fetch('/.netlify/functions/' + path, opts).then(function (r) { return r.json(); });
    });
  }

  function formatDate(d) {
    if (!d) return '—';
    var date = new Date(d);
    return date.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */
  function init() {
    // Only init once, when tab is first shown
    var panel = document.querySelector('[data-yb-admin-panel="email-lists"]');
    if (!panel) return;

    panel.addEventListener('click', handleClick);
    panel.addEventListener('change', handleChange);
    panel.addEventListener('input', handleInput);

    loadLists();
  }

  // Listen for tab activation
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-yb-admin-tab="email-lists"]');
    if (tab && !tab._elInit) {
      tab._elInit = true;
      setTimeout(init, 50);
    }
  });

  /* ═══════════════════════════════════════════
     EVENT HANDLERS
     ═══════════════════════════════════════════ */
  function handleClick(e) {
    var action = e.target.closest('[data-action]');
    if (!action) return;
    var a = action.getAttribute('data-action');

    switch (a) {
      case 'el-new-list':       openListModal(); break;
      case 'el-refresh':        loadLists(); break;
      case 'el-back':           showListsView(); break;
      case 'el-import-csv':     openImportModal(); break;
      case 'el-import-close':   closeImportModal(); break;
      case 'el-list-modal-close': closeListModal(); break;
      case 'el-contact-modal-close': closeContactModal(); break;
      case 'el-add-contact':    openContactModal(); break;
      case 'el-export-csv':     exportCSV(); break;
      case 'el-send-to-list':   sendToList(); break;
    }

    // Row actions
    var listId = action.getAttribute('data-list-id');
    if (a === 'el-view' && listId) openListDetail(listId);
    if (a === 'el-edit' && listId) openListModal(listId);
    if (a === 'el-delete-list' && listId) deleteList(listId);

    var contactId = action.getAttribute('data-contact-id');
    if (a === 'el-delete-contact' && contactId) deleteContact(contactId);
    if (a === 'el-tag-contact' && contactId) tagContact(contactId);

    // Pagination
    if (a === 'el-page') {
      contactPage = parseInt(action.getAttribute('data-page') || '0');
      renderContacts();
    }
  }

  function handleChange(e) {
    if (e.target.id === 'yb-el-contact-filter') {
      contactFilter = e.target.value;
      contactPage = 0;
      renderContacts();
    }
    if (e.target.id === 'yb-el-select-all') {
      var boxes = document.querySelectorAll('.yb-el__contact-cb');
      boxes.forEach(function (cb) { cb.checked = e.target.checked; });
    }
  }

  function handleInput(e) {
    if (e.target.id === 'yb-el-contact-search') {
      contactSearch = e.target.value.toLowerCase();
      contactPage = 0;
      renderContacts();
    }
  }

  /* ═══════════════════════════════════════════
     LISTS VIEW
     ═══════════════════════════════════════════ */
  function showListsView() {
    $('yb-el-v-lists').hidden = false;
    $('yb-el-v-detail').hidden = true;
    $('yb-el-v-reports').hidden = true;
    currentList = null;
    currentContacts = [];
  }

  function loadLists() {
    api('GET', 'email-lists').then(function (data) {
      if (!data.ok) { toast('Failed to load lists', true); return; }
      lists = data.lists || [];
      renderLists();
      renderStats();
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  function renderLists() {
    var tbody = $('yb-el-tbody');
    if (!tbody) return;

    if (lists.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="yb-admin__empty">No email lists yet. Click "New List" to create one.</td></tr>';
      return;
    }

    tbody.innerHTML = lists.map(function (list) {
      var tags = (list.tags || []).map(function (t) {
        return '<span class="yb-el__tag">' + esc(t) + '</span>';
      }).join(' ');
      return '<tr>' +
        '<td><a href="#" data-action="el-view" data-list-id="' + list.id + '" style="color:#f75c03;font-weight:600;">' + esc(list.name) + '</a>' +
          (list.description ? '<br><small style="color:#6F6A66;">' + esc(list.description) + '</small>' : '') + '</td>' +
        '<td><strong>' + (list.contact_count || 0) + '</strong></td>' +
        '<td>' + (tags || '—') + '</td>' +
        '<td>' + esc(list.source || 'manual') + '</td>' +
        '<td>' + formatDate(list.created_at) + '</td>' +
        '<td>' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="el-view" data-list-id="' + list.id + '">View</button> ' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="el-edit" data-list-id="' + list.id + '">Edit</button> ' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="el-delete-list" data-list-id="' + list.id + '" style="color:#ef5350;">Delete</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function renderStats() {
    var totalContacts = lists.reduce(function (sum, l) { return sum + (l.contact_count || 0); }, 0);
    var statLists = $('yb-el-stat-lists');
    var statContacts = $('yb-el-stat-contacts');
    if (statLists) statLists.textContent = lists.length;
    if (statContacts) statContacts.textContent = totalContacts.toLocaleString();
  }

  /* ═══════════════════════════════════════════
     LIST DETAIL VIEW
     ═══════════════════════════════════════════ */
  function openListDetail(listId) {
    api('GET', 'email-lists?id=' + listId + '&contacts=1').then(function (data) {
      if (!data.ok) { toast('Failed to load list', true); return; }
      currentList = data.list;
      currentContacts = data.list.contacts || [];
      contactPage = 0;
      contactSearch = '';
      contactFilter = 'all';

      $('yb-el-v-lists').hidden = true;
      $('yb-el-v-detail').hidden = false;
      $('yb-el-v-reports').hidden = true;

      var title = $('yb-el-detail-title');
      if (title) title.textContent = currentList.name + ' (' + currentContacts.length + ' contacts)';

      var search = $('yb-el-contact-search');
      if (search) search.value = '';
      var filter = $('yb-el-contact-filter');
      if (filter) filter.value = 'all';

      renderListStats();
      renderContacts();
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  function renderListStats() {
    var container = $('yb-el-list-stats');
    if (!container || !currentList) return;

    var active = currentContacts.filter(function (c) { return c.status === 'active'; }).length;
    var unsub = currentContacts.filter(function (c) { return c.status === 'unsubscribed'; }).length;
    var totalSent = currentContacts.reduce(function (s, c) { return s + ((c.engagement && c.engagement.emails_sent) || 0); }, 0);
    var totalOpened = currentContacts.reduce(function (s, c) { return s + ((c.engagement && c.engagement.emails_opened) || 0); }, 0);

    container.innerHTML =
      '<div class="yb-admin__stat-card"><span class="yb-admin__stat-value">' + active + '</span><span class="yb-admin__stat-label">Active</span></div>' +
      '<div class="yb-admin__stat-card"><span class="yb-admin__stat-value">' + unsub + '</span><span class="yb-admin__stat-label">Unsubscribed</span></div>' +
      '<div class="yb-admin__stat-card"><span class="yb-admin__stat-value">' + totalSent + '</span><span class="yb-admin__stat-label">Emails Sent</span></div>' +
      '<div class="yb-admin__stat-card"><span class="yb-admin__stat-value">' + totalOpened + '</span><span class="yb-admin__stat-label">Total Opens</span></div>';
  }

  function renderContacts() {
    var tbody = $('yb-el-contact-tbody');
    if (!tbody) return;

    var filtered = currentContacts.filter(function (c) {
      if (contactFilter !== 'all' && c.status !== contactFilter) return false;
      if (contactSearch) {
        var hay = (c.email + ' ' + c.first_name + ' ' + c.last_name).toLowerCase();
        if (hay.indexOf(contactSearch) === -1) return false;
      }
      return true;
    });

    var start = contactPage * CONTACTS_PER_PAGE;
    var page = filtered.slice(start, start + CONTACTS_PER_PAGE);

    if (page.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="yb-admin__empty">No contacts found.</td></tr>';
      renderPagination(filtered.length);
      return;
    }

    tbody.innerHTML = page.map(function (c) {
      var eng = c.engagement || {};
      var tags = (c.tags || []).map(function (t) {
        return '<span class="yb-el__tag">' + esc(t) + '</span>';
      }).join(' ');
      var statusCls = c.status === 'active' ? 'yb-el__status--active' :
                      c.status === 'unsubscribed' ? 'yb-el__status--unsub' : 'yb-el__status--bounced';
      return '<tr>' +
        '<td><input type="checkbox" class="yb-el__contact-cb" value="' + c.id + '"></td>' +
        '<td>' + esc(c.email) + '</td>' +
        '<td>' + esc(c.first_name) + '</td>' +
        '<td>' + esc(c.last_name) + '</td>' +
        '<td><span class="yb-el__status ' + statusCls + '">' + esc(c.status) + '</span></td>' +
        '<td>' + (eng.emails_sent || 0) + '</td>' +
        '<td>' + (eng.emails_opened || 0) + '</td>' +
        '<td>' + (eng.emails_clicked || 0) + '</td>' +
        '<td>' + (tags || '—') + '</td>' +
        '<td>' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="el-tag-contact" data-contact-id="' + c.id + '">Tag</button> ' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="el-delete-contact" data-contact-id="' + c.id + '" style="color:#ef5350;">Del</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    renderPagination(filtered.length);
  }

  function renderPagination(total) {
    var container = $('yb-el-pagination');
    if (!container) return;

    var totalPages = Math.ceil(total / CONTACTS_PER_PAGE);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    var html = '<div style="display:flex;gap:6px;align-items:center;justify-content:center;margin-top:12px;">';
    html += '<span style="color:#6F6A66;">' + total + ' contacts · Page ' + (contactPage + 1) + '/' + totalPages + '</span> ';
    if (contactPage > 0) {
      html += '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="el-page" data-page="' + (contactPage - 1) + '">&laquo; Prev</button>';
    }
    if (contactPage < totalPages - 1) {
      html += '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="el-page" data-page="' + (contactPage + 1) + '">Next &raquo;</button>';
    }
    html += '</div>';
    container.innerHTML = html;
  }

  /* ═══════════════════════════════════════════
     LIST MODAL (CREATE/EDIT)
     ═══════════════════════════════════════════ */
  function openListModal(editId) {
    var modal = $('yb-el-list-modal');
    if (!modal) return;

    $('yb-el-list-id').value = '';
    $('yb-el-list-name').value = '';
    $('yb-el-list-desc').value = '';
    $('yb-el-list-tags').value = '';
    $('yb-el-list-source').value = 'squarespace';
    $('yb-el-list-modal-title').textContent = 'New List';

    if (editId) {
      var list = lists.find(function (l) { return l.id === editId; });
      if (list) {
        $('yb-el-list-id').value = list.id;
        $('yb-el-list-name').value = list.name;
        $('yb-el-list-desc').value = list.description || '';
        $('yb-el-list-tags').value = (list.tags || []).join(', ');
        $('yb-el-list-source').value = list.source || 'manual';
        $('yb-el-list-modal-title').textContent = 'Edit List';
      }
    }

    modal.hidden = false;

    // Save handler
    var saveBtn = $('yb-el-list-save-btn');
    saveBtn.onclick = function () { saveList(); };
  }

  function closeListModal() {
    var modal = $('yb-el-list-modal');
    if (modal) modal.hidden = true;
  }

  function saveList() {
    var id = $('yb-el-list-id').value;
    var name = $('yb-el-list-name').value.trim();
    if (!name) { toast('Name is required', true); return; }

    var tags = $('yb-el-list-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);

    var body = {
      name: name,
      description: $('yb-el-list-desc').value.trim(),
      tags: tags,
      source: $('yb-el-list-source').value
    };

    if (id) {
      body.id = id;
      api('PUT', 'email-lists', body).then(function (data) {
        if (data.ok) { toast('List updated'); closeListModal(); loadLists(); }
        else toast('Error: ' + data.error, true);
      });
    } else {
      api('POST', 'email-lists', body).then(function (data) {
        if (data.ok) { toast('List created'); closeListModal(); loadLists(); }
        else toast('Error: ' + data.error, true);
      });
    }
  }

  function deleteList(listId) {
    var list = lists.find(function (l) { return l.id === listId; });
    var name = list ? list.name : listId;
    if (!confirm('Delete list "' + name + '" and all its contacts? This cannot be undone.')) return;

    api('DELETE', 'email-lists?id=' + listId).then(function (data) {
      if (data.ok) { toast('List deleted'); loadLists(); }
      else toast('Error: ' + data.error, true);
    });
  }

  /* ═══════════════════════════════════════════
     CONTACT MODAL
     ═══════════════════════════════════════════ */
  function openContactModal() {
    var modal = $('yb-el-contact-modal');
    if (!modal || !currentList) return;
    $('yb-el-c-email').value = '';
    $('yb-el-c-first').value = '';
    $('yb-el-c-last').value = '';
    $('yb-el-c-tags').value = '';
    modal.hidden = false;

    $('yb-el-contact-save-btn').onclick = function () { addContact(); };
  }

  function closeContactModal() {
    var modal = $('yb-el-contact-modal');
    if (modal) modal.hidden = true;
  }

  function addContact() {
    var email = $('yb-el-c-email').value.trim();
    if (!email) { toast('Email is required', true); return; }

    var tags = $('yb-el-c-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);

    api('POST', 'email-lists?action=add', {
      listId: currentList.id,
      email: email,
      first_name: $('yb-el-c-first').value.trim(),
      last_name: $('yb-el-c-last').value.trim(),
      tags: tags
    }).then(function (data) {
      if (data.ok) {
        toast('Contact added');
        closeContactModal();
        openListDetail(currentList.id); // Reload
      } else {
        toast('Error: ' + data.error, true);
      }
    });
  }

  function deleteContact(contactId) {
    if (!confirm('Delete this contact?')) return;
    api('DELETE', 'email-lists?contactId=' + contactId).then(function (data) {
      if (data.ok) {
        toast('Contact deleted');
        currentContacts = currentContacts.filter(function (c) { return c.id !== contactId; });
        renderContacts();
        renderListStats();
      } else toast('Error: ' + data.error, true);
    });
  }

  function tagContact(contactId) {
    var contact = currentContacts.find(function (c) { return c.id === contactId; });
    var currentTags = contact && contact.tags ? contact.tags.join(', ') : '';
    var newTags = prompt('Edit tags (comma-separated):', currentTags);
    if (newTags === null) return;

    var tags = newTags.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    api('PUT', 'email-lists', {
      id: currentList.id,
      contactId: contactId,
      contact_tags: tags
    }).then(function (data) {
      if (data.ok) {
        if (contact) contact.tags = tags;
        renderContacts();
        toast('Tags updated');
      } else toast('Error: ' + data.error, true);
    });
  }

  /* ═══════════════════════════════════════════
     CSV IMPORT
     ═══════════════════════════════════════════ */
  function openImportModal() {
    if (!currentList) { toast('Open a list first', true); return; }
    var modal = $('yb-el-import-modal');
    if (!modal) return;

    csvData = null;
    csvHeaders = [];
    $('yb-el-import-preview').hidden = true;
    $('yb-el-column-mapping').hidden = true;
    $('yb-el-import-progress').hidden = true;
    $('yb-el-import-btn').disabled = true;
    modal.hidden = false;

    // Setup drag/drop + file input
    var dropZone = $('yb-el-drop-zone');
    var fileInput = $('yb-el-file-input');

    dropZone.onclick = function () { fileInput.click(); };
    dropZone.ondragover = function (e) { e.preventDefault(); dropZone.classList.add('yb-el__drop-zone--active'); };
    dropZone.ondragleave = function () { dropZone.classList.remove('yb-el__drop-zone--active'); };
    dropZone.ondrop = function (e) {
      e.preventDefault();
      dropZone.classList.remove('yb-el__drop-zone--active');
      if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    };
    fileInput.onchange = function () {
      if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
    };

    $('yb-el-import-btn').onclick = function () { doImport(); };
  }

  function closeImportModal() {
    var modal = $('yb-el-import-modal');
    if (modal) modal.hidden = true;
  }

  function handleFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var text = e.target.result;
      parseCSV(text);
    };
    reader.readAsText(file);
  }

  function parseCSV(text) {
    // Handle different line endings and delimiters
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) { toast('CSV must have a header row + at least 1 data row', true); return; }

    // Detect delimiter (comma, semicolon, tab)
    var firstLine = lines[0];
    var delimiter = ',';
    if (firstLine.indexOf(';') > -1 && firstLine.indexOf(',') === -1) delimiter = ';';
    if (firstLine.indexOf('\t') > -1 && firstLine.indexOf(',') === -1 && firstLine.indexOf(';') === -1) delimiter = '\t';

    csvHeaders = parseLine(firstLine, delimiter).map(function (h) { return h.trim().toLowerCase(); });
    csvData = [];

    for (var i = 1; i < lines.length; i++) {
      var vals = parseLine(lines[i], delimiter);
      if (vals.length === 0) continue;
      var row = {};
      csvHeaders.forEach(function (h, idx) { row[h] = (vals[idx] || '').trim(); });
      csvData.push(row);
    }

    showPreview();
    showColumnMapping();
  }

  function parseLine(line, delim) {
    // Simple CSV parser that handles quoted fields
    var result = [];
    var current = '';
    var inQuote = false;

    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQuote && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === delim && !inQuote) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function showPreview() {
    $('yb-el-import-preview').hidden = false;

    var headRow = $('yb-el-preview-head');
    headRow.innerHTML = csvHeaders.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('');

    var bodyEl = $('yb-el-preview-body');
    var preview = csvData.slice(0, 5);
    bodyEl.innerHTML = preview.map(function (row) {
      return '<tr>' + csvHeaders.map(function (h) { return '<td>' + esc(row[h] || '') + '</td>'; }).join('') + '</tr>';
    }).join('');

    $('yb-el-import-summary').textContent = csvData.length + ' rows found' + (csvData.length > 5 ? ' (showing first 5)' : '');
  }

  function showColumnMapping() {
    $('yb-el-column-mapping').hidden = false;

    var opts = '<option value="">(skip)</option>' +
      csvHeaders.map(function (h) { return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join('');

    $('yb-el-map-email').innerHTML = opts;
    $('yb-el-map-first').innerHTML = opts;
    $('yb-el-map-last').innerHTML = opts;

    // Auto-detect columns (Squarespace format: email, first_name, last_name)
    var emailGuesses = ['email', 'e-mail', 'email_address', 'emailaddress', 'mail'];
    var firstGuesses = ['first_name', 'firstname', 'first name', 'fornavn', 'first', 'name'];
    var lastGuesses = ['last_name', 'lastname', 'last name', 'efternavn', 'last', 'surname'];

    autoSelect('yb-el-map-email', emailGuesses);
    autoSelect('yb-el-map-first', firstGuesses);
    autoSelect('yb-el-map-last', lastGuesses);

    $('yb-el-import-btn').disabled = false;
  }

  function autoSelect(selectId, guesses) {
    var select = $(selectId);
    for (var i = 0; i < guesses.length; i++) {
      for (var j = 0; j < csvHeaders.length; j++) {
        if (csvHeaders[j].toLowerCase() === guesses[i]) {
          select.value = csvHeaders[j];
          return;
        }
      }
    }
  }

  function doImport() {
    if (!csvData || !currentList) return;

    var emailCol = $('yb-el-map-email').value;
    var firstCol = $('yb-el-map-first').value;
    var lastCol = $('yb-el-map-last').value;

    if (!emailCol) { toast('Email column mapping is required', true); return; }

    // Build contacts array
    var contacts = csvData.map(function (row) {
      return {
        email: row[emailCol] || '',
        first_name: firstCol ? (row[firstCol] || '') : '',
        last_name: lastCol ? (row[lastCol] || '') : ''
      };
    }).filter(function (c) { return c.email && c.email.includes('@'); });

    if (contacts.length === 0) { toast('No valid email addresses found', true); return; }

    // Show progress
    $('yb-el-import-progress').hidden = false;
    $('yb-el-import-btn').disabled = true;
    $('yb-el-progress-text').textContent = 'Importing ' + contacts.length + ' contacts...';
    $('yb-el-progress-fill').style.width = '30%';

    // Send in chunks of 500 to the backend
    var CHUNK = 500;
    var totalImported = 0;
    var totalSkipped = 0;
    var totalInvalid = 0;
    var chunks = [];
    for (var i = 0; i < contacts.length; i += CHUNK) {
      chunks.push(contacts.slice(i, i + CHUNK));
    }

    var idx = 0;
    function sendChunk() {
      if (idx >= chunks.length) {
        $('yb-el-progress-fill').style.width = '100%';
        $('yb-el-progress-text').textContent = 'Done! Imported: ' + totalImported + ', Skipped (duplicates): ' + totalSkipped + ', Invalid: ' + totalInvalid;
        setTimeout(function () {
          closeImportModal();
          openListDetail(currentList.id);
          toast('Import complete: ' + totalImported + ' new contacts');
        }, 1500);
        return;
      }

      api('POST', 'email-lists?action=import', {
        listId: currentList.id,
        contacts: chunks[idx]
      }).then(function (data) {
        if (data.ok) {
          totalImported += data.imported || 0;
          totalSkipped += data.skipped || 0;
          totalInvalid += data.invalid || 0;
        }
        idx++;
        var pct = Math.round(30 + (idx / chunks.length) * 70);
        $('yb-el-progress-fill').style.width = pct + '%';
        $('yb-el-progress-text').textContent = 'Importing... (' + (idx) + '/' + chunks.length + ' batches)';
        sendChunk();
      }).catch(function (err) {
        toast('Import error: ' + err.message, true);
        $('yb-el-import-btn').disabled = false;
      });
    }

    sendChunk();
  }

  /* ═══════════════════════════════════════════
     EXPORT CSV
     ═══════════════════════════════════════════ */
  function exportCSV() {
    if (!currentContacts.length) { toast('No contacts to export', true); return; }

    var header = 'email,first_name,last_name,status,emails_sent,emails_opened,emails_clicked,tags';
    var rows = currentContacts.map(function (c) {
      var eng = c.engagement || {};
      return [
        '"' + (c.email || '') + '"',
        '"' + (c.first_name || '') + '"',
        '"' + (c.last_name || '') + '"',
        c.status || 'active',
        eng.emails_sent || 0,
        eng.emails_opened || 0,
        eng.emails_clicked || 0,
        '"' + (c.tags || []).join(';') + '"'
      ].join(',');
    });

    var csv = header + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (currentList ? currentList.name.replace(/\s+/g, '-') : 'contacts') + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ═══════════════════════════════════════════
     SEND TO LIST (opens campaign wizard)
     ═══════════════════════════════════════════ */
  function sendToList() {
    if (!currentList) { toast('No list selected', true); return; }
    // Bridge to campaign wizard — pass list info
    if (window.openEmailCampaignForList) {
      window.openEmailCampaignForList(currentList);
    } else if (window.openEmailCampaign) {
      // Fallback: open campaign wizard with notification
      toast('List send mode: ' + currentList.name + ' (' + (currentList.contact_count || 0) + ' contacts). Select recipients from campaign wizard.');
      window.openEmailCampaign([]);
    } else {
      toast('Campaign wizard not loaded', true);
    }
  }

})();
