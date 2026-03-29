/**
 * Social Media Manager — Admin Panel (Core)
 * Handles: init, state, API, accounts, calendar, posts list, analytics, hashtags
 */
(function () {
  'use strict';

  /* ═══ STATE ═══ */
  var T = {};
  var state = {
    view: 'accounts',
    accounts: {},
    posts: [],
    postsFilter: 'all',
    postsPlatform: 'all',
    calMonth: new Date().getMonth(),
    calYear: new Date().getFullYear(),
    hashtagSets: [],
    editingHashtagId: null,
    analyticsRange: 30,
    templates: [],
    competitors: [],
    abTests: [],
    abTestFilter: 'all',
    selectedPosts: []
  };

  /* ═══ HELPERS ═══ */
  function t(k) { return T[k] || k; }
  function $(id) { return document.getElementById(id); }
  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return document.querySelectorAll(sel); }

  function toast(msg, isError) {
    var el = $('yb-admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'yb-admin__toast' + (isError ? ' yb-admin__toast--error' : '');
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 3000);
  }

  async function getToken() {
    var user = firebase.auth().currentUser;
    if (!user) { toast('Not authenticated', true); return null; }
    return user.getIdToken();
  }

  async function api(path, opts) {
    var token = await getToken();
    if (!token) return null;
    var headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    var res = await fetch('/.netlify/functions/' + path, Object.assign({ headers: headers }, opts));
    var data = await res.json();
    if (!data.ok && data.error) { toast(data.error, true); return null; }
    return data;
  }

  function fmtDate(d) {
    if (!d) return '';
    var dt = d.toDate ? d.toDate() : new Date(d._seconds ? d._seconds * 1000 : d);
    return dt.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(d) {
    if (!d) return '';
    var dt = d.toDate ? d.toDate() : new Date(d._seconds ? d._seconds * 1000 : d);
    return dt.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }) + ' ' +
      dt.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  }

  function platformIcon(p) {
    var m = { instagram: 'IG', facebook: 'FB', tiktok: 'TT', linkedin: 'LI', youtube: 'YT', pinterest: 'PIN' };
    return '<span class="yb-social__post-platform-icon yb-social__post-platform-icon--' + p + '">' + (m[p] || p) + '</span>';
  }

  function statusBadge(s) {
    return '<span class="yb-social__post-status yb-social__post-status--' + s + '">' + s + '</span>';
  }

  function truncate(s, n) { return s && s.length > n ? s.substring(0, n) + '...' : (s || ''); }

  /* ═══ VIEW MANAGEMENT ═══ */
  function showView(name) {
    state.view = name;
    ['accounts', 'calendar', 'posts', 'analytics', 'inbox', 'hashtags', 'templates', 'competitors', 'abtesting', 'library', 'stories'].forEach(function (v) {
      var el = $('yb-social-v-' + v);
      if (el) el.hidden = (v !== name);
    });
    qsa('.yb-social__nav-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-action') === 'social-nav-' + name);
    });
    if (name === 'accounts') loadAccounts();
    if (name === 'calendar') renderCalendar();
    if (name === 'posts') loadPosts();
    if (name === 'analytics') loadAnalytics();
    if (name === 'inbox') loadInbox();
    if (name === 'hashtags') loadHashtags();
    if (name === 'templates') loadTemplates();
    if (name === 'competitors') loadCompetitors();
    if (name === 'abtesting') loadAbTests();
    if (name === 'library') { loadContentLibrary(); loadVideoLibrary(); initVideoUploadZone(); initTrimHandles(); }
    if (name === 'stories') loadStories();
  }

  /* ═══ ACCOUNTS ═══ */
  var PLATFORMS = ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'pinterest'];

  async function loadAccounts() {
    var data = await api('social-accounts?action=list');
    if (!data) return;
    state.accounts = {};
    (data.accounts || []).forEach(function (a) { state.accounts[a.platform] = a; });
    renderAccounts();
  }

  function renderAccounts() {
    PLATFORMS.forEach(function (p) {
      var a = state.accounts[p];
      var card = qs('.yb-social__account-card[data-platform="' + p + '"]');
      if (!card) return;
      var abbr = { instagram: 'ig', facebook: 'fb', tiktok: 'tt', linkedin: 'li', youtube: 'yt', pinterest: 'pin' }[p] || p.substring(0, 2);
      var handleEl = $('yb-social-' + abbr + '-handle');
      var followEl = $('yb-social-' + abbr + '-followers');
      var connectBtn = card.querySelector('[data-action="social-connect"]');
      var disconnBtn = card.querySelector('[data-action="social-disconnect"]');

      if (a) {
        card.classList.add('is-connected');
        if (handleEl) handleEl.textContent = a.pageName || a.handle || t('social_connected');
        if (followEl) followEl.textContent = (a.followerCount || 0).toLocaleString() + ' ' + t('social_followers');
        if (connectBtn) connectBtn.hidden = true;
        if (disconnBtn) disconnBtn.hidden = false;
      } else {
        card.classList.remove('is-connected');
        if (handleEl) handleEl.textContent = t('social_not_connected');
        if (followEl) followEl.textContent = '';
        if (connectBtn) connectBtn.hidden = false;
        if (disconnBtn) disconnBtn.hidden = true;
      }
    });
  }

  var PLATFORM_DEFAULTS = {
    facebook: { pageId: '878172732056415' },
    instagram: { pageId: '17841474697451627' },
    tiktok: {},
    linkedin: {},
    youtube: {},
    pinterest: {}
  };

  // OAuth support: platforms that have OAuth configured
  var OAUTH_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube'];

  function connectAccount(platform) {
    // Build and show branded connect modal
    var defaults = PLATFORM_DEFAULTS[platform] || {};
    var needsPageId = platform === 'facebook' || platform === 'instagram';
    var needsOrgId = platform === 'linkedin';
    var needsChannelId = platform === 'youtube';
    var needsBoardId = platform === 'pinterest';
    var needsRefreshToken = platform === 'youtube';
    var pageIdLabel = platform === 'facebook' ? 'Facebook Page ID' : platform === 'instagram' ? 'Instagram Business Account ID' : '';
    var hasOAuth = OAUTH_PLATFORMS.indexOf(platform) !== -1;

    var extraFields = '';
    if (needsPageId) {
      extraFields = '<div class="yb-admin__field">' +
        '<label for="yb-social-connect-pageid">' + pageIdLabel + '</label>' +
        '<input type="text" id="yb-social-connect-pageid" value="' + (defaults.pageId || '') + '">' +
        '</div>';
    } else if (needsOrgId) {
      extraFields = '<div class="yb-admin__field">' +
        '<label for="yb-social-connect-orgid">LinkedIn Organization ID</label>' +
        '<input type="text" id="yb-social-connect-orgid" placeholder="e.g. 12345678">' +
        '</div>';
    } else if (needsChannelId) {
      extraFields = '<div class="yb-admin__field">' +
        '<label for="yb-social-connect-refreshtoken">Refresh Token</label>' +
        '<input type="text" id="yb-social-connect-refreshtoken" placeholder="Required for token refresh">' +
        '</div>' +
        '<div class="yb-admin__field">' +
        '<label for="yb-social-connect-channelid">Channel ID <span style="color:var(--yb-muted)">(optional)</span></label>' +
        '<input type="text" id="yb-social-connect-channelid" placeholder="e.g. UCxxxxxxxx">' +
        '</div>';
    } else if (needsBoardId) {
      extraFields = '<div class="yb-admin__field">' +
        '<label for="yb-social-connect-boardid">Board ID <span style="color:var(--yb-muted)">(optional)</span></label>' +
        '<input type="text" id="yb-social-connect-boardid" placeholder="Pin to a specific board">' +
        '</div>';
    }

    // OAuth button section
    var oauthSection = '';
    if (hasOAuth) {
      oauthSection = '<div class="yb-social__connect-oauth">' +
        '<button class="yb-btn yb-btn--primary yb-social__oauth-btn" data-action="social-oauth-start" data-platform="' + platform + '">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> ' +
        t('social_oauth_btn') + '</button></div>' +
        '<div class="yb-social__connect-divider"><span>' + t('social_oauth_or') + '</span></div>';
    }

    var html = '<div class="yb-social__connect-modal" id="yb-social-connect-modal">' +
      '<div class="yb-social__connect-overlay" data-action="social-connect-cancel"></div>' +
      '<div class="yb-social__connect-box">' +
      '<div class="yb-social__connect-platform-badge">' + platformLabel(platform) + '</div>' +
      '<h3>Connect ' + platform.charAt(0).toUpperCase() + platform.slice(1) + '</h3>' +
      oauthSection +
      '<div class="yb-admin__field">' +
      '<label for="yb-social-connect-token">Access Token</label>' +
      '<input type="text" id="yb-social-connect-token" placeholder="Paste token here...">' +
      '</div>' +
      extraFields +
      '<div class="yb-social__connect-actions">' +
      '<button class="yb-btn yb-btn--outline" data-action="social-connect-cancel">Cancel</button>' +
      '<button class="yb-btn yb-btn--primary" data-action="social-connect-save" data-platform="' + platform + '">Connect</button>' +
      '</div></div></div>';

    // Remove existing modal if any
    var existing = $('yb-social-connect-modal');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', html);
    var input = $('yb-social-connect-token');
    if (input) setTimeout(function () { input.focus(); }, 100);
  }

  // OAuth popup flow
  var oauthPopup = null;

  function startOAuth(platform) {
    var url = '/.netlify/functions/oauth-initiate?platform=' + encodeURIComponent(platform);
    var w = 600, h = 700;
    var left = (screen.width - w) / 2;
    var top = (screen.height - h) / 2;
    oauthPopup = window.open(url, 'social-oauth', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    toast(t('social_oauth_connecting'));
  }

  // Listen for OAuth callback postMessage
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'social-oauth-result') return;
    if (oauthPopup) { try { oauthPopup.close(); } catch (x) {} oauthPopup = null; }

    if (e.data.status === 'success') {
      toast(t('social_oauth_success'));
      closeConnectModal();
      loadAccounts();
    } else {
      toast(t('social_oauth_error') + ': ' + (e.data.detail || 'Unknown error'), true);
    }
  });

  function platformLabel(p) {
    var icons = {
      instagram: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/></svg> Instagram',
      facebook: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> Facebook',
      tiktok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78c.27 0 .54.04.8.1v-3.5a6.37 6.37 0 0 0-.8-.05A6.34 6.34 0 0 0 3.15 15.3 6.34 6.34 0 0 0 9.49 21.6a6.34 6.34 0 0 0 6.34-6.34V8.7a8.16 8.16 0 0 0 4.77 1.52V6.77a4.83 4.83 0 0 1-1.01-.08z"/></svg> TikTok',
      linkedin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg> LinkedIn',
      youtube: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg> YouTube',
      pinterest: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 5 3.1 9.4 7.5 11.1-.1-1-.2-2.4 0-3.5.2-.9 1.5-6.3 1.5-6.3s-.4-.8-.4-1.9c0-1.8 1-3.1 2.3-3.1 1.1 0 1.6.8 1.6 1.8 0 1.1-.7 2.7-1.1 4.2-.3 1.3.6 2.3 1.9 2.3 2.3 0 4-2.4 4-5.9 0-3.1-2.2-5.2-5.4-5.2-3.7 0-5.8 2.7-5.8 5.6 0 1.1.4 2.3 1 3 .1.1.1.2.1.4l-.4 1.5c-.1.2-.2.3-.4.2-1.6-.8-2.6-3.1-2.6-5 0-4.1 3-7.9 8.6-7.9 4.5 0 8 3.2 8 7.5 0 4.5-2.8 8.1-6.8 8.1-1.3 0-2.5-.7-3-1.5l-.8 3.1c-.3 1.1-1.1 2.6-1.6 3.4 1.2.4 2.5.6 3.8.6 6.6 0 12-5.4 12-12S18.6 0 12 0z"/></svg> Pinterest'
    };
    return icons[p] || p;
  }

  async function saveConnection(platform) {
    var token = ($('yb-social-connect-token') || {}).value || '';
    if (!token.trim()) { toast('Enter a token', true); return; }

    var body = { platform: platform, accessToken: token.trim() };
    var pageIdEl = $('yb-social-connect-pageid');
    if (pageIdEl && pageIdEl.value.trim()) {
      if (platform === 'instagram') body.igAccountId = pageIdEl.value.trim();
      else body.pageId = pageIdEl.value.trim();
    }
    var orgIdEl = $('yb-social-connect-orgid');
    if (orgIdEl && orgIdEl.value.trim()) body.organizationId = orgIdEl.value.trim();
    var refreshTokenEl = $('yb-social-connect-refreshtoken');
    if (refreshTokenEl && refreshTokenEl.value.trim()) body.refreshToken = refreshTokenEl.value.trim();
    var channelIdEl = $('yb-social-connect-channelid');
    if (channelIdEl && channelIdEl.value.trim()) body.channelId = channelIdEl.value.trim();
    var boardIdEl = $('yb-social-connect-boardid');
    if (boardIdEl && boardIdEl.value.trim()) body.boardId = boardIdEl.value.trim();

    toast('Connecting...');
    var data = await api('social-accounts?action=save-token', {
      method: 'POST', body: JSON.stringify(body)
    });

    var modal = $('yb-social-connect-modal');
    if (modal) modal.remove();

    if (data) { toast(t('social_connected')); loadAccounts(); }
  }

  function closeConnectModal() {
    var modal = $('yb-social-connect-modal');
    if (modal) modal.remove();
  }

  async function disconnectAccount(platform) {
    if (!confirm(t('social_confirm_disconnect'))) return;
    var data = await api('social-accounts?action=disconnect', {
      method: 'POST', body: JSON.stringify({ platform: platform })
    });
    if (data) { toast('Disconnected'); loadAccounts(); }
  }

  async function refreshAccounts() {
    toast('Refreshing...');
    await api('social-accounts?action=refresh', { method: 'POST' });
    loadAccounts();
  }

  async function initCdnFolders() {
    toast('Creating CDN folders...');
    var data = await api('bunny-browser?action=init-social-folders');
    if (data && data.folders) {
      var created = data.folders.filter(function (f) { return f.status === 'created'; }).length;
      toast(created + ' CDN folders initialized');
    }
  }

  /* ═══ CALENDAR ═══ */
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function renderCalendar() {
    var monthEl = $('yb-social-cal-month');
    if (monthEl) monthEl.textContent = MONTH_NAMES[state.calMonth] + ' ' + state.calYear;

    var grid = $('yb-social-cal-grid');
    if (!grid) return;

    var first = new Date(state.calYear, state.calMonth, 1);
    var startDay = (first.getDay() + 6) % 7; // Monday=0
    var daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    var prevDays = new Date(state.calYear, state.calMonth, 0).getDate();
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    var html = '';
    var totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;

    for (var i = 0; i < totalCells; i++) {
      var dayNum, dateStr, isOther = false;

      if (i < startDay) {
        dayNum = prevDays - startDay + i + 1;
        var pm = state.calMonth === 0 ? 12 : state.calMonth;
        var py = state.calMonth === 0 ? state.calYear - 1 : state.calYear;
        dateStr = py + '-' + String(pm).padStart(2, '0') + '-' + String(dayNum).padStart(2, '0');
        isOther = true;
      } else if (i >= startDay + daysInMonth) {
        dayNum = i - startDay - daysInMonth + 1;
        var nm = state.calMonth === 11 ? 1 : state.calMonth + 2;
        var ny = state.calMonth === 11 ? state.calYear + 1 : state.calYear;
        dateStr = ny + '-' + String(nm).padStart(2, '0') + '-' + String(dayNum).padStart(2, '0');
        isOther = true;
      } else {
        dayNum = i - startDay + 1;
        dateStr = state.calYear + '-' + String(state.calMonth + 1).padStart(2, '0') + '-' + String(dayNum).padStart(2, '0');
      }

      var cls = 'yb-social__cal-day';
      if (isOther) cls += ' yb-social__cal-day--other';
      if (dateStr === todayStr) cls += ' yb-social__cal-day--today';

      html += '<div class="' + cls + '" data-action="social-cal-day" data-date="' + dateStr + '">';
      html += '<div class="yb-social__cal-day-num">' + dayNum + '</div>';

      // Show post dots for this day
      var dayPosts = getPostsForDate(dateStr);
      if (dayPosts.length > 0) {
        html += '<div class="yb-social__cal-dots">';
        dayPosts.forEach(function (p) {
          (p.platforms || []).forEach(function (pl) {
            html += '<span class="yb-social__cal-post-dot yb-social__cal-post-dot--' + pl + '"></span>';
          });
        });
        html += '</div>';
        dayPosts.slice(0, 2).forEach(function (p) {
          html += '<div class="yb-social__cal-post-card" draggable="true" data-action="social-edit-post" data-id="' + p.id + '" data-drag-post="' + p.id + '">' +
            truncate(p.caption, 25) + '</div>';
        });
        if (dayPosts.length > 2) {
          html += '<div class="yb-social__cal-post-card">+' + (dayPosts.length - 2) + ' more</div>';
        }
      }
      html += '</div>';
    }
    grid.innerHTML = html;
    initCalendarDragDrop(grid);
  }

  // ── Calendar Drag-and-Drop Rescheduling ─────────────────────────

  var calDragState = { postId: null };

  function initCalendarDragDrop(grid) {
    // Drag start on post cards
    grid.addEventListener('dragstart', function (e) {
      var card = e.target.closest('[data-drag-post]');
      if (!card) return;
      calDragState.postId = card.getAttribute('data-drag-post');
      e.dataTransfer.setData('text/plain', calDragState.postId);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    });

    grid.addEventListener('dragend', function (e) {
      var card = e.target.closest('[data-drag-post]');
      if (card) card.classList.remove('is-dragging');
      calDragState.postId = null;
      // Remove all drag-over states
      qsa('.yb-social__cal-day--drag-over').forEach(function (d) {
        d.classList.remove('yb-social__cal-day--drag-over');
      });
    });

    // Drop target on day cells
    grid.addEventListener('dragover', function (e) {
      if (!calDragState.postId) return;
      var dayCell = e.target.closest('.yb-social__cal-day');
      if (!dayCell) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Highlight drop target
      qsa('.yb-social__cal-day--drag-over').forEach(function (d) {
        d.classList.remove('yb-social__cal-day--drag-over');
      });
      dayCell.classList.add('yb-social__cal-day--drag-over');
    });

    grid.addEventListener('dragleave', function (e) {
      var dayCell = e.target.closest('.yb-social__cal-day');
      if (dayCell && !dayCell.contains(e.relatedTarget)) {
        dayCell.classList.remove('yb-social__cal-day--drag-over');
      }
    });

    grid.addEventListener('drop', function (e) {
      e.preventDefault();
      var dayCell = e.target.closest('.yb-social__cal-day');
      if (!dayCell || !calDragState.postId) return;

      dayCell.classList.remove('yb-social__cal-day--drag-over');
      var newDate = dayCell.getAttribute('data-date');
      if (!newDate) return;

      reschedulePost(calDragState.postId, newDate);
    });
  }

  async function reschedulePost(postId, newDateStr) {
    // Build a new scheduledAt datetime (keep existing time or default to 10:00)
    var post = state.posts.find(function (p) { return p.id === postId; });
    var existingDate = post ? (post.scheduledAt || post.publishedAt || post.createdAt) : null;
    var hours = '10';
    var minutes = '00';
    if (existingDate) {
      var dt = existingDate._seconds ? new Date(existingDate._seconds * 1000) : new Date(existingDate);
      hours = String(dt.getHours()).padStart(2, '0');
      minutes = String(dt.getMinutes()).padStart(2, '0');
    }
    var newScheduledAt = new Date(newDateStr + 'T' + hours + ':' + minutes + ':00');

    var data = await api('social-posts', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update',
        id: postId,
        scheduledAt: newScheduledAt.toISOString(),
        status: 'scheduled'
      })
    });

    if (data) {
      toast(t('social_post_rescheduled') || 'Post rescheduled');
      // Update local state
      if (post) {
        post.scheduledAt = { _seconds: Math.floor(newScheduledAt.getTime() / 1000) };
        post.status = 'scheduled';
      }
      renderCalendar();
    }
  }

  function getPostsForDate(dateStr) {
    return state.posts.filter(function (p) {
      var d = p.scheduledAt || p.publishedAt || p.createdAt;
      if (!d) return false;
      var dt = d._seconds ? new Date(d._seconds * 1000) : new Date(d);
      var ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
      return ds === dateStr;
    });
  }

  function openCalendarSidebar(dateStr) {
    var sidebar = $('yb-social-cal-sidebar');
    var title = $('yb-social-cal-sidebar-title');
    var container = $('yb-social-cal-sidebar-posts');
    if (!sidebar || !container) return;

    var d = new Date(dateStr + 'T12:00:00');
    title.textContent = 'Posts for ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    sidebar.hidden = false;
    sidebar.classList.add('is-open');

    var dayPosts = getPostsForDate(dateStr);
    if (dayPosts.length === 0) {
      container.innerHTML = '<p class="yb-admin__muted">' + t('social_no_posts') + '</p>' +
        '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="social-new-post" style="margin-top:12px">' + t('social_new_post') + '</button>';
      return;
    }

    container.innerHTML = dayPosts.map(function (p) {
      return '<div class="yb-social__post-card" style="margin-bottom:12px">' +
        (p.media && p.media[0] ? '<div class="yb-social__post-thumb"><img src="' + p.media[0] + '" alt=""></div>' : '') +
        '<div class="yb-social__post-body">' +
        '<p class="yb-social__post-caption">' + truncate(p.caption, 80) + '</p>' +
        '<div class="yb-social__post-meta">' +
        '<div class="yb-social__post-platforms">' + (p.platforms || []).map(platformIcon).join('') + '</div>' +
        statusBadge(p.status) +
        '</div>' +
        '<div class="yb-social__post-actions">' +
        '<button data-action="social-edit-post" data-id="' + p.id + '">' + t('social_edit') + '</button>' +
        '<button data-action="social-delete-post" data-id="' + p.id + '">' + t('social_delete') + '</button>' +
        '</div></div></div>';
    }).join('');
  }

  /* ═══ POSTS LIST ═══ */
  async function loadPosts() {
    var url = 'social-posts?action=list';
    if (state.postsFilter !== 'all') url += '&status=' + state.postsFilter;
    if (state.postsPlatform !== 'all') url += '&platform=' + state.postsPlatform;
    var grid = $('yb-social-posts-grid');
    if (grid) grid.innerHTML = '<p class="yb-admin__muted">Loading...</p>';
    var data = await api(url);
    if (!data) return;
    state.posts = data.posts || [];
    renderPosts();
    if ($('yb-social-cal-grid')) renderCalendar();
  }

  function renderPosts() {
    var grid = $('yb-social-posts-grid');
    var countEl = $('yb-social-posts-count');
    if (!grid) return;

    // Render platform filter bar
    var pfBar = $('yb-social-platform-filter');
    if (pfBar) {
      var pfs = ['all', 'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'pinterest'];
      var pfLabels = { all: 'All', instagram: 'IG', facebook: 'FB', tiktok: 'TT', linkedin: 'LI', youtube: 'YT', pinterest: 'PIN' };
      pfBar.innerHTML = '<span class="yb-social__platform-filter-label">Platform:</span>' +
        pfs.map(function (p) {
          return '<button class="yb-social__platform-filter-btn' + (state.postsPlatform === p ? ' is-active' : '') + '" data-action="social-filter-platform" data-platform="' + p + '">' + pfLabels[p] + '</button>';
        }).join('');
    }

    if (countEl) countEl.textContent = state.posts.length + ' ' + t('social_posts_title').toLowerCase();

    if (state.posts.length === 0) {
      grid.innerHTML = '<p class="yb-admin__muted">' + t('social_no_posts') + '</p>';
      return;
    }

    grid.innerHTML = state.posts.map(function (p) {
      var thumbContent = '';
      if (p.media && p.media[0]) {
        thumbContent = '<img src="' + p.media[0] + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<span class="yb-social__post-thumb-fallback" style="display:none">' +
          (p.importedPermalink ? '<a href="' + p.importedPermalink + '" target="_blank" style="color:#f75c03;font-size:11px;text-decoration:none">🔗 View on ' + ((p.platforms || [])[0] || 'platform') + '</a>' : '📝') +
          '</span>';
      } else {
        thumbContent = '<span class="yb-admin__muted" style="font-size:24px">📝</span>';
      }
      var thumb = '<div class="yb-social__post-thumb">' + thumbContent + '</div>';

      var schedTime = '';
      if (p.status === 'scheduled' && p.scheduledAt) schedTime = fmtDateTime(p.scheduledAt);
      else if (p.publishedAt) schedTime = fmtDateTime(p.publishedAt);
      else schedTime = fmtDate(p.createdAt);

      var isSelected = state.selectedPosts.indexOf(p.id) !== -1;

      return '<div class="yb-social__post-card' + (isSelected ? ' is-selected' : '') + '">' +
        '<label class="yb-social__post-check"><input type="checkbox" data-action="social-toggle-select" data-id="' + p.id + '"' + (isSelected ? ' checked' : '') + '></label>' +
        thumb +
        '<div class="yb-social__post-body">' +
        '<p class="yb-social__post-caption">' + truncate(p.caption, 80) + '</p>' +
        '<div class="yb-social__post-meta">' +
        '<div class="yb-social__post-platforms">' + (p.platforms || []).map(platformIcon).join('') + '</div>' +
        statusBadge(p.status) +
        (p.autoGenerated ? '<span class="yb-social__auto-badge">🤖 ' + t('social_auto_generated') + '</span>' : '') +
        '<span>' + schedTime + '</span>' +
        '</div>' +
        '<div class="yb-social__post-actions">' +
        '<button data-action="social-edit-post" data-id="' + p.id + '">' + t('social_edit') + '</button>' +
        '<button data-action="social-duplicate-post" data-id="' + p.id + '">' + t('social_duplicate') + '</button>' +
        (p.status === 'draft' ? '<button data-action="social-submit-review" data-id="' + p.id + '">' + t('social_submit_review') + '</button>' : '') +
        (p.status === 'pending_review' ? '<button data-action="social-approve-post" data-id="' + p.id + '" class="yb-social__approve-btn">' + t('social_approve') + '</button>' : '') +
        (p.status === 'draft' || p.status === 'approved' || p.status === 'scheduled' ? '<button data-action="social-publish-now" data-id="' + p.id + '">' + t('social_publish_now') + '</button>' : '') +
        (p.status === 'published' ? '<button data-action="social-recycle-post" data-id="' + p.id + '">' + t('social_recycle') + '</button>' : '') +
        (p.status === 'published' ? '<button data-action="social-recurring-schedule" data-id="' + p.id + '">Recurring</button>' : '') +
        '<button data-action="social-preview-link" data-id="' + p.id + '">Share</button>' +
        '<button data-action="social-delete-post" data-id="' + p.id + '">' + t('social_delete') + '</button>' +
        '</div></div></div>';
    }).join('');
  }

  async function deletePost(id) {
    if (!confirm(t('social_confirm_delete_post'))) return;
    var data = await api('social-posts?action=delete', {
      method: 'POST', body: JSON.stringify({ id: id })
    });
    if (data) { toast('Deleted'); loadPosts(); }
  }

  async function duplicatePost(id) {
    var post = state.posts.find(function (p) { return p.id === id; });
    if (!post) return;
    var copy = {
      caption: post.caption, platforms: post.platforms, media: post.media,
      hashtags: post.hashtags, hashtagSet: post.hashtagSet, firstComment: post.firstComment,
      location: post.location, altTexts: post.altTexts, status: 'draft'
    };
    var data = await api('social-posts?action=create', {
      method: 'POST', body: JSON.stringify(copy)
    });
    if (data) { toast('Duplicated'); loadPosts(); }
  }

  async function publishNow(id) {
    toast(t('social_publishing'));
    var data = await api('social-publish', {
      method: 'POST', body: JSON.stringify({ postId: id })
    });
    if (data) { toast(t('social_published')); loadPosts(); }
  }

  // ── Approval Workflow ──────────────────────────────────────
  async function submitForReview(id) {
    var data = await api('social-posts?action=update', {
      method: 'POST', body: JSON.stringify({ id: id, status: 'pending_review' })
    });
    if (data) { toast(t('social_submitted_review')); loadPosts(); }
  }

  async function approvePost(id) {
    var data = await api('social-posts?action=update', {
      method: 'POST', body: JSON.stringify({
        id: id, status: 'approved',
        approvedBy: 'admin',
        approvedAt: new Date().toISOString()
      })
    });
    if (data) { toast(t('social_approved')); loadPosts(); }
  }

  // ── Content Recycling ─────────────────────────────────────
  async function recyclePost(id) {
    var post = state.posts.find(function (p) { return p.id === id; });
    if (!post) return;

    var daysStr = prompt(t('social_recycle_prompt') || 'Re-post after how many days? (e.g., 30)', '30');
    if (!daysStr) return;
    var days = parseInt(daysStr);
    if (isNaN(days) || days < 1) { toast('Invalid number', true); return; }

    var nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + days);

    // Create a new post as a recycled copy
    var recycledPost = {
      caption: post.caption,
      platforms: post.platforms,
      media: post.media,
      hashtags: post.hashtags,
      hashtagSet: post.hashtagSet,
      firstComment: post.firstComment,
      location: post.location,
      altTexts: post.altTexts,
      mediaType: post.mediaType || 'auto',
      status: 'scheduled',
      scheduledAt: nextDate.toISOString(),
      recycledFrom: id,
      recycleConfig: { intervalDays: days, originalPostId: id }
    };

    var data = await api('social-posts?action=create', {
      method: 'POST', body: JSON.stringify(recycledPost)
    });

    // Mark original as recycled
    if (data) {
      await api('social-posts?action=update', {
        method: 'POST', body: JSON.stringify({ id: id, status: 'recycled' })
      });
      toast(t('social_recycled') || 'Recycled — re-posting in ' + days + ' days');
      loadPosts();
    }
  }

  // ── Preview Share Links ──────────────────────────────────
  async function generatePreviewLink(id) {
    var data = await api('social-preview', {
      method: 'POST',
      body: JSON.stringify({ action: 'generate-link', postId: id })
    });
    if (!data || !data.previewUrl) return;

    // Show share modal
    var html = '<div class="yb-social__modal-overlay" id="yb-social-preview-modal">' +
      '<div class="yb-social__modal-box">' +
        '<div class="yb-social__modal-header">' +
          '<h3>Share Preview Link</h3>' +
          '<button class="yb-social__btn-sm" data-action="social-close-preview-modal">&times;</button>' +
        '</div>' +
        '<div class="yb-social__modal-body">' +
          '<p style="margin-bottom:12px;font-size:13px;color:#6F6A66">Share this link to preview and approve the post from any device — no login required.</p>' +
          '<div class="yb-social__preview-link-box">' +
            '<input type="text" id="yb-social-preview-url" value="' + data.previewUrl + '" readonly class="yb-social__input" style="font-size:12px">' +
            '<button class="yb-social__btn-sm yb-social__btn-sm--primary" data-action="social-copy-preview-link">Copy</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  // ── Recurring Post Scheduler ────────────────────────────
  function openRecurringScheduler(id) {
    var post = state.posts.find(function (p) { return p.id === id; });
    if (!post) return;

    var html = '<div class="yb-social__modal-overlay" id="yb-social-recurring-modal">' +
      '<div class="yb-social__modal-box">' +
        '<div class="yb-social__modal-header">' +
          '<h3>Recurring Schedule</h3>' +
          '<button class="yb-social__btn-sm" data-action="social-close-recurring-modal">&times;</button>' +
        '</div>' +
        '<div class="yb-social__modal-body">' +
          '<p style="margin-bottom:12px;font-size:13px;color:#6F6A66">' +
            'Set this post to automatically re-publish on a recurring schedule.' +
          '</p>' +
          '<div class="yb-social__recurring-caption" style="margin-bottom:16px;padding:10px;background:#f5f3f0;border-radius:8px;font-size:13px">' +
            '"' + ((post.caption || '').substring(0, 80)) + (post.caption && post.caption.length > 80 ? '...' : '') + '"' +
          '</div>' +
          // Pattern type
          '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">Frequency</label>' +
          '<select id="yb-recurring-pattern" class="yb-social__input" style="margin-bottom:12px">' +
            '<option value="weekly">Weekly</option>' +
            '<option value="biweekly">Every 2 weeks</option>' +
            '<option value="monthly">Monthly</option>' +
            '<option value="custom">Custom interval (days)</option>' +
          '</select>' +
          // Custom interval
          '<div id="yb-recurring-custom-row" style="display:none;margin-bottom:12px">' +
            '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Repeat every (days)</label>' +
            '<input type="number" id="yb-recurring-custom-days" class="yb-social__input" value="14" min="1" max="365">' +
          '</div>' +
          // Day of week (for weekly/biweekly)
          '<div id="yb-recurring-day-row" style="margin-bottom:12px">' +
            '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">Day</label>' +
            '<div class="yb-social__recurring-days">' +
              ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d, i) {
                return '<button class="yb-social__recurring-day-btn" data-action="social-recurring-toggle-day" data-day="' + (i + 1) + '">' + d + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
          // Time
          '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Time</label>' +
          '<input type="time" id="yb-recurring-time" class="yb-social__input" value="09:00" style="margin-bottom:12px">' +
          // Max occurrences
          '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Max occurrences (0 = unlimited)</label>' +
          '<input type="number" id="yb-recurring-max" class="yb-social__input" value="0" min="0" max="52" style="margin-bottom:12px">' +
        '</div>' +
        '<div class="yb-social__modal-footer">' +
          '<button class="yb-social__btn-sm" data-action="social-close-recurring-modal">Cancel</button>' +
          '<button class="yb-social__btn-sm yb-social__btn-sm--primary" data-action="social-save-recurring" data-id="' + id + '">Start Recurring</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.body.insertAdjacentHTML('beforeend', html);

    // Pattern change handler
    var patternEl = document.getElementById('yb-recurring-pattern');
    if (patternEl) {
      patternEl.addEventListener('change', function () {
        var isCustom = patternEl.value === 'custom';
        var isMonthly = patternEl.value === 'monthly';
        document.getElementById('yb-recurring-custom-row').style.display = isCustom ? '' : 'none';
        document.getElementById('yb-recurring-day-row').style.display = isMonthly || isCustom ? 'none' : '';
      });
    }
  }

  async function saveRecurringSchedule(id) {
    var post = state.posts.find(function (p) { return p.id === id; });
    if (!post) return;

    var pattern = ($('yb-recurring-pattern') || {}).value || 'weekly';
    var time = ($('yb-recurring-time') || {}).value || '09:00';
    var maxOccurrences = parseInt(($('yb-recurring-max') || {}).value) || 0;

    // Get selected days
    var selectedDays = [];
    qsa('.yb-social__recurring-day-btn.is-active').forEach(function (btn) {
      selectedDays.push(parseInt(btn.getAttribute('data-day')));
    });

    // Calculate interval days
    var intervalDays;
    if (pattern === 'weekly') intervalDays = 7;
    else if (pattern === 'biweekly') intervalDays = 14;
    else if (pattern === 'monthly') intervalDays = 30;
    else intervalDays = parseInt(($('yb-recurring-custom-days') || {}).value) || 14;

    if (!selectedDays.length && (pattern === 'weekly' || pattern === 'biweekly')) {
      // Default to same day as today
      selectedDays = [new Date().getDay() || 7]; // 1=Mon...7=Sun
    }

    // Calculate first scheduled date
    var timeParts = time.split(':');
    var nextDate = new Date();
    nextDate.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), 0, 0);

    // Find next matching day
    if (selectedDays.length && (pattern === 'weekly' || pattern === 'biweekly')) {
      var today = nextDate.getDay() || 7;
      var daysUntil = Infinity;
      selectedDays.forEach(function (d) {
        var diff = d - today;
        if (diff <= 0) diff += 7;
        if (diff < daysUntil) daysUntil = diff;
      });
      nextDate.setDate(nextDate.getDate() + daysUntil);
    } else {
      nextDate.setDate(nextDate.getDate() + intervalDays);
    }

    var recycleConfig = {
      intervalDays: intervalDays,
      originalPostId: id,
      active: true,
      pattern: pattern,
      days: selectedDays,
      time: time,
      maxOccurrences: maxOccurrences,
      recycleCount: 0
    };

    // Create first scheduled copy
    var newPost = {
      caption: post.caption,
      platforms: post.platforms,
      media: post.media,
      hashtags: post.hashtags,
      hashtagSet: post.hashtagSet,
      firstComment: post.firstComment,
      location: post.location,
      altTexts: post.altTexts,
      mediaType: post.mediaType || 'auto',
      platformCaptions: post.platformCaptions || {},
      contentPillar: post.contentPillar || null,
      status: 'scheduled',
      scheduledAt: nextDate.toISOString(),
      recycledFrom: id,
      recycleConfig: recycleConfig
    };

    var data = await api('social-posts', {
      method: 'POST',
      body: JSON.stringify(Object.assign({ action: 'create' }, newPost))
    });

    if (data) {
      // Mark original as recycled
      await api('social-posts', {
        method: 'POST',
        body: JSON.stringify({ action: 'update', id: id, status: 'recycled', recycleConfig: recycleConfig })
      });
      toast('Recurring schedule set — first post on ' + nextDate.toLocaleDateString());
      var modal = document.getElementById('yb-social-recurring-modal');
      if (modal) modal.remove();
      loadPosts();
    }
  }

  // ── Bulk Selection ───────────────────────────────────────
  function togglePostSelect(id) {
    var idx = state.selectedPosts.indexOf(id);
    if (idx === -1) state.selectedPosts.push(id);
    else state.selectedPosts.splice(idx, 1);
    updateBulkBar();
    // Toggle card highlight without full re-render
    var cards = qsa('.yb-social__post-card');
    cards.forEach(function (card) {
      var cb = card.querySelector('[data-action="social-toggle-select"]');
      if (cb && cb.getAttribute('data-id') === id) {
        card.classList.toggle('is-selected', state.selectedPosts.indexOf(id) !== -1);
      }
    });
  }

  function toggleSelectAll() {
    var allBox = $('yb-social-select-all');
    if (!allBox) return;
    if (allBox.checked) {
      state.selectedPosts = state.posts.map(function (p) { return p.id; });
    } else {
      state.selectedPosts = [];
    }
    updateBulkBar();
    renderPosts();
  }

  function clearSelection() {
    state.selectedPosts = [];
    var allBox = $('yb-social-select-all');
    if (allBox) allBox.checked = false;
    updateBulkBar();
    renderPosts();
  }

  function updateBulkBar() {
    var bar = $('yb-social-bulk-bar');
    var countEl = $('yb-social-bulk-count');
    if (!bar) return;
    bar.hidden = state.selectedPosts.length === 0;
    if (countEl) countEl.textContent = state.selectedPosts.length + ' ' + t('social_selected');
  }

  async function bulkSchedule() {
    if (state.selectedPosts.length === 0) return;
    var dateStr = prompt(t('social_bulk_schedule_prompt') || 'Schedule date/time (YYYY-MM-DD HH:mm):', '');
    if (!dateStr) return;
    var d = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) { toast('Invalid date', true); return; }
    var data = await api('social-posts?action=bulk-update', {
      method: 'POST',
      body: JSON.stringify({ ids: state.selectedPosts, fields: { status: 'scheduled', scheduledAt: d.toISOString() } })
    });
    if (data) { toast(t('social_bulk_scheduled') || 'Scheduled ' + (data.updated || []).length + ' posts'); clearSelection(); loadPosts(); }
  }

  async function bulkApprove() {
    if (state.selectedPosts.length === 0) return;
    var data = await api('social-posts?action=bulk-update', {
      method: 'POST',
      body: JSON.stringify({ ids: state.selectedPosts, fields: { status: 'approved', approvedBy: 'admin', approvedAt: new Date().toISOString() } })
    });
    if (data) { toast(t('social_approved') + ' (' + (data.updated || []).length + ')'); clearSelection(); loadPosts(); }
  }

  async function bulkDuplicate() {
    if (state.selectedPosts.length === 0) return;
    var data = await api('social-posts?action=bulk-duplicate', {
      method: 'POST',
      body: JSON.stringify({ ids: state.selectedPosts })
    });
    if (data) { toast(t('social_duplicated') || 'Duplicated ' + (data.created || []).length + ' posts'); clearSelection(); loadPosts(); }
  }

  async function bulkDelete() {
    if (state.selectedPosts.length === 0) return;
    if (!confirm(t('social_bulk_delete_confirm') || 'Delete ' + state.selectedPosts.length + ' posts? This cannot be undone.')) return;
    var data = await api('social-posts?action=bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: state.selectedPosts })
    });
    if (data) { toast('Deleted ' + (data.deleted || []).length + ' posts'); clearSelection(); loadPosts(); }
  }

  /* ═══ ANALYTICS ═══ */
  async function loadAnalytics() {
    var days = state.analyticsRange;
    showLastSyncTime();

    // Fetch all data in parallel
    var results = await Promise.all([
      api('social-analytics?action=overview&days=' + days),
      api('social-analytics?action=recent&days=' + days),
      api('social-analytics?action=top-posts&days=' + days + '&limit=5'),
      api('social-analytics?action=best-times&days=90'),
      api('social-analytics?action=engagement-trend&days=' + days),
      api('social-analytics?action=platform-breakdown&days=' + days)
    ]);

    var overview = results[0];
    var recent = results[1];
    var topPosts = results[2];
    var bestTimes = results[3];
    var trend = results[4];
    var breakdown = results[5];

    // 1. Overview stat cards
    if (overview) {
      var s = overview.overview || {};
      var el;
      el = $('yb-social-stat-followers'); if (el) el.textContent = (s.totalFollowers || 0).toLocaleString();
      el = $('yb-social-stat-posts'); if (el) el.textContent = (s.totalPosts || 0).toLocaleString();
      el = $('yb-social-stat-engagement'); if (el) el.textContent = (s.avgEngagement || 0).toFixed(1) + '%';
      el = $('yb-social-stat-reach'); if (el) el.textContent = (s.totalReach || 0).toLocaleString();
    }

    // 2. Engagement trend chart
    if (trend) renderTrendChart(trend.trend || []);

    // 3. Platform breakdown
    if (breakdown) renderPlatformBreakdown(breakdown.platforms || []);

    // 4. Best posting times
    if (bestTimes) renderBestTimes(bestTimes.bestTimes || {});

    // 5. Top posts
    if (topPosts) renderTopPosts(topPosts.topPosts || []);

    // 6. Recent performance table
    renderRecentTable(recent);

    // 7. Cross-post comparison
    renderCrossPostComparison();

    // 8. Content pillar distribution
    renderPillarDistribution();
  }

  function renderTrendChart(trend) {
    var container = $('yb-social-trend-chart');
    if (!container || !trend.length) {
      if (container) container.innerHTML = '<p class="yb-admin__muted">No trend data yet</p>';
      return;
    }

    var maxEng = Math.max.apply(null, trend.map(function (d) { return d.engagement; })) || 1;
    var maxReach = Math.max.apply(null, trend.map(function (d) { return d.reach; })) || 1;
    var chartH = 160;
    var barW = Math.max(4, Math.floor((container.offsetWidth - 60) / trend.length) - 2);

    var html = '<div class="yb-social__chart-legend">' +
      '<span class="yb-social__chart-legend-item"><span class="yb-social__chart-dot yb-social__chart-dot--engagement"></span> Engagement</span>' +
      '<span class="yb-social__chart-legend-item"><span class="yb-social__chart-dot yb-social__chart-dot--reach"></span> Reach</span>' +
      '</div>';

    html += '<div class="yb-social__chart-bars" style="height:' + chartH + 'px">';
    trend.forEach(function (d, i) {
      var engH = maxEng > 0 ? Math.max(2, (d.engagement / maxEng) * (chartH - 20)) : 2;
      var reachH = maxReach > 0 ? Math.max(1, (d.reach / maxReach) * (chartH - 20) * 0.4) : 1;
      var label = d.date.substring(5); // MM-DD

      html += '<div class="yb-social__chart-bar-group" style="width:' + barW + 'px" title="' + d.date + '\nEngagement: ' + d.engagement + '\nReach: ' + d.reach.toLocaleString() + '\nPosts: ' + d.posts + '">';
      html += '<div class="yb-social__chart-bar yb-social__chart-bar--reach" style="height:' + reachH + 'px"></div>';
      html += '<div class="yb-social__chart-bar yb-social__chart-bar--engagement" style="height:' + engH + 'px"></div>';
      if (i % Math.ceil(trend.length / 8) === 0) {
        html += '<span class="yb-social__chart-bar-label">' + label + '</span>';
      }
      html += '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
  }

  function renderPlatformBreakdown(platforms) {
    var container = $('yb-social-platform-breakdown');
    if (!container) return;

    if (!platforms.length) {
      container.innerHTML = '<p class="yb-admin__muted">No platform data yet</p>';
      return;
    }

    var totalEng = platforms.reduce(function (s, p) { return s + p.totalEngagement; }, 0) || 1;
    var platformColors = { instagram: '#E1306C', facebook: '#1877F2', tiktok: '#000000', linkedin: '#0A66C2', youtube: '#FF0000', pinterest: '#E60023' };

    var html = '<div class="yb-social__platform-bars">';
    platforms.forEach(function (p) {
      var pct = Math.round((p.totalEngagement / totalEng) * 100);
      var color = platformColors[p.platform] || '#6F6A66';
      var name = p.platform.charAt(0).toUpperCase() + p.platform.slice(1);

      html += '<div class="yb-social__platform-row">' +
        '<div class="yb-social__platform-row-head">' +
          '<span class="yb-social__platform-row-name">' + platformIcon(p.platform) + ' ' + name + '</span>' +
          '<span class="yb-social__platform-row-pct">' + pct + '%</span>' +
        '</div>' +
        '<div class="yb-social__platform-bar-track">' +
          '<div class="yb-social__platform-bar-fill" style="width:' + pct + '%;background:' + color + '"></div>' +
        '</div>' +
        '<div class="yb-social__platform-row-stats">' +
          '<span>' + p.likes.toLocaleString() + ' likes</span>' +
          '<span>' + p.comments.toLocaleString() + ' comments</span>' +
          '<span>' + p.reach.toLocaleString() + ' reach</span>' +
          '<span>' + p.engagementRate + '% rate</span>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
  }

  function renderBestTimes(data) {
    var container = $('yb-social-best-times');
    if (!container) return;

    if (!data.byHour || !data.byDay) {
      container.innerHTML = '<p class="yb-admin__muted">Not enough data yet</p>';
      return;
    }

    var html = '';

    // Best time recommendation
    if (data.bestHour && data.bestDay && (data.bestHour.avgEngagement > 0 || data.bestDay.avgEngagement > 0)) {
      html += '<div class="yb-social__best-time-rec">' +
        '<strong>' + t('social_recommended') + ':</strong> ' +
        data.bestDay.label + ' at ' + data.bestHour.label +
        '</div>';
    }

    // Full 7×24 engagement heatmap grid
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build combined data from byHour and byDay
    // The API gives us byHour (24) and byDay (7) separately
    // We'll show both as a combined visual: hours across top, days down left
    // Use the product of normalized values as intensity
    var maxHourEng = Math.max.apply(null, data.byHour.map(function (h) { return h.avgEngagement; })) || 1;
    var maxDayEng = Math.max.apply(null, data.byDay.map(function (d) { return d.avgEngagement; })) || 1;

    html += '<div class="yb-social__heatmap-grid">';

    // Header row — hours (show every 2 hours)
    html += '<div class="yb-social__heatmap-grid-row">';
    html += '<div class="yb-social__heatmap-grid-label"></div>';
    for (var h = 0; h < 24; h++) {
      if (h % 2 === 0) {
        html += '<div class="yb-social__heatmap-grid-header">' + (h < 10 ? '0' : '') + h + '</div>';
      }
    }
    html += '</div>';

    // Day rows
    for (var d = 0; d < 7; d++) {
      html += '<div class="yb-social__heatmap-grid-row">';
      html += '<div class="yb-social__heatmap-grid-label">' + dayNames[d] + '</div>';

      var dayScore = data.byDay[d] ? data.byDay[d].avgEngagement / maxDayEng : 0;

      for (var hh = 0; hh < 24; hh++) {
        if (hh % 2 !== 0) continue; // Show every 2 hours to keep cells readable

        var hourScore = data.byHour[hh] ? data.byHour[hh].avgEngagement / maxHourEng : 0;
        // Next hour too
        var hourScore2 = data.byHour[hh + 1] ? data.byHour[hh + 1].avgEngagement / maxHourEng : 0;
        var avgHourScore = (hourScore + hourScore2) / 2;

        // Combined intensity: product of day and hour scores
        var intensity = dayScore * avgHourScore;
        // Also add base from each dimension so cells aren't all zero when one dimension is sparse
        var adjustedIntensity = intensity * 0.6 + dayScore * 0.2 + avgHourScore * 0.2;
        var opacity = Math.max(0.05, Math.min(1, adjustedIntensity));

        var hourEng = data.byHour[hh] ? data.byHour[hh].avgEngagement : 0;
        var dayEng = data.byDay[d] ? data.byDay[d].avgEngagement : 0;

        // Color: low = light cream, medium = light orange, high = brand orange
        var r, g, b;
        if (adjustedIntensity > 0.6) { r = 247; g = 92; b = 3; }
        else if (adjustedIntensity > 0.3) { r = 255; g = 153; b = 102; }
        else { r = 247; g = 92; b = 3; }

        html += '<div class="yb-social__heatmap-grid-cell" title="' + dayNames[d] + ' ' + (hh < 10 ? '0' : '') + hh + ':00\nDay avg: ' + dayEng + '\nHour avg: ' + hourEng + '" style="background:rgba(' + r + ',' + g + ',' + b + ',' + opacity.toFixed(2) + ')"></div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Legend
    html += '<div class="yb-social__heatmap-legend">' +
      '<span class="yb-social__heatmap-legend-label">Low</span>' +
      '<div class="yb-social__heatmap-legend-bar"></div>' +
      '<span class="yb-social__heatmap-legend-label">High</span>' +
      '</div>';

    container.innerHTML = html;
  }

  function renderTopPosts(posts) {
    var container = $('yb-social-top-posts');
    if (!container) return;

    if (!posts.length) {
      container.innerHTML = '<p class="yb-admin__muted">No top posts data yet</p>';
      return;
    }

    container.innerHTML = posts.map(function (p, i) {
      var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
      return '<div class="yb-social__top-post-card">' +
        '<div class="yb-social__top-post-rank">' + medal + '</div>' +
        (p.media ? '<div class="yb-social__top-post-thumb"><img src="' + p.media + '" alt="" loading="lazy"></div>' : '') +
        '<div class="yb-social__top-post-info">' +
          '<p class="yb-social__top-post-caption">' + truncate(p.caption, 80) + '</p>' +
          '<div class="yb-social__top-post-metrics">' +
            '<span title="Total Engagement">❤️ ' + p.totalEngagement.toLocaleString() + '</span>' +
            '<span title="Total Reach">👁 ' + p.totalReach.toLocaleString() + '</span>' +
            '<span>' + (p.platforms || []).map(platformIcon).join('') + '</span>' +
            '<span class="yb-admin__muted">' + fmtDate(p.publishedAt) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderRecentTable(recent) {
    var tbody = $('yb-social-analytics-body');
    if (!tbody || !recent) return;

    var posts = recent.posts || [];
    if (posts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="yb-admin__muted">No data yet</td></tr>';
      return;
    }

    var rows = [];
    posts.forEach(function (p) {
      var analytics = p.analytics || {};
      var platforms = Object.keys(analytics);
      if (platforms.length === 0) {
        // Show post with no metrics
        rows.push('<tr>' +
          '<td>' + truncate(p.caption, 40) + '</td>' +
          '<td>' + (p.platforms || []).map(platformIcon).join('') + '</td>' +
          '<td colspan="4" class="yb-admin__muted">Awaiting sync</td>' +
          '<td>' + fmtDate(p.publishedAt) + '</td>' +
          '</tr>');
      } else {
        platforms.forEach(function (plat) {
          var m = (analytics[plat] || {}).metrics || {};
          rows.push('<tr>' +
            '<td>' + truncate(p.caption, 40) + '</td>' +
            '<td>' + platformIcon(plat) + '</td>' +
            '<td>' + (m.likes || 0) + '</td>' +
            '<td>' + (m.comments || 0) + '</td>' +
            '<td>' + (m.shares || 0) + '</td>' +
            '<td>' + (m.reach || m.post_reach || 0).toLocaleString() + '</td>' +
            '<td>' + fmtDate(p.publishedAt) + '</td>' +
            '</tr>');
        });
      }
    });

    tbody.innerHTML = rows.join('');
  }

  // ── Promote to Ad — find top organic posts ──────────────
  function findPromotablePosts() {
    var grid = $('yb-social-promote-grid');
    if (!grid) return;

    // Get published posts with engagement metrics
    var published = state.posts.filter(function (p) {
      return p.status === 'published' && p.publishResults;
    });

    // Score each post by total engagement
    var scored = published.map(function (p) {
      var totalEng = 0;
      var totalReach = 0;
      var platforms = Object.keys(p.publishResults || {});
      platforms.forEach(function (plat) {
        var m = (p.publishResults[plat] || {}).metrics || {};
        totalEng += (m.likes || 0) + (m.comments || 0) * 2 + (m.shares || 0) * 3;
        totalReach += m.reach || m.post_reach || 0;
      });
      return { post: p, engagement: totalEng, reach: totalReach, platforms: platforms };
    }).filter(function (s) { return s.engagement > 0; });

    // Sort by engagement score descending
    scored.sort(function (a, b) { return b.engagement - a.engagement; });

    // Take top 5
    var top = scored.slice(0, 5);

    if (top.length === 0) {
      grid.innerHTML = '<p class="yb-admin__muted">' + t('social_promote_no_results') + '</p>';
      return;
    }

    grid.innerHTML = top.map(function (item, i) {
      var p = item.post;
      var thumb = p.media && p.media[0]
        ? '<img src="' + p.media[0] + '" alt="" class="yb-social__promote-thumb">'
        : '<span class="yb-social__promote-thumb yb-social__promote-thumb--empty">📝</span>';

      var engRate = item.reach > 0 ? ((item.engagement / item.reach) * 100).toFixed(1) + '%' : '—';

      return '<div class="yb-social__promote-card">' +
        '<div class="yb-social__promote-rank">#' + (i + 1) + '</div>' +
        thumb +
        '<div class="yb-social__promote-info">' +
        '<p class="yb-social__promote-caption">' + truncate(p.caption, 60) + '</p>' +
        '<div class="yb-social__promote-stats">' +
        '<span>❤️ ' + item.engagement + '</span>' +
        '<span>👁 ' + item.reach + '</span>' +
        '<span>📊 ' + engRate + '</span>' +
        '</div>' +
        '<div class="yb-social__promote-platforms">' + item.platforms.map(platformIcon).join('') + '</div>' +
        '</div>' +
        '<div class="yb-social__promote-actions">' +
        '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="social-promote-post" data-id="' + p.id + '">🚀 ' + t('social_promote_boost') + '</button>' +
        '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-duplicate-post" data-id="' + p.id + '">📋 ' + t('social_duplicate') + '</button>' +
        '</div></div>';
    }).join('');
  }

  // Create ad suggestion from a post (opens Meta Ads directions)
  function promotePost(id) {
    var post = state.posts.find(function (p) { return p.id === id; });
    if (!post) return;

    // Prepare ad creative data
    var creative = {
      caption: post.caption || '',
      media: post.media || [],
      hashtags: post.hashtags || [],
      platforms: post.platforms || [],
      engagement: 0
    };

    Object.keys(post.publishResults || {}).forEach(function (plat) {
      var m = (post.publishResults[plat] || {}).metrics || {};
      creative.engagement += (m.likes || 0) + (m.comments || 0) + (m.shares || 0);
    });

    // Store as ad suggestion in Firestore
    api('social-posts?action=update', {
      method: 'POST',
      body: JSON.stringify({
        id: id,
        adSuggestion: {
          suggestedAt: new Date().toISOString(),
          engagement: creative.engagement,
          status: 'suggested'
        }
      })
    }).then(function () {
      toast(t('social_promote_suggested') || 'Marked as ad candidate — use Meta Ads CLI to create the campaign');
    });
  }

  // ── Content Pillar Distribution ───────────────────────────────

  var PILLAR_CONFIG = {
    educational:   { label: 'Educational',       icon: '📚', target: 40, color: '#4CAF50' },
    social_proof:  { label: 'Social Proof',      icon: '🌟', target: 25, color: '#FF9800' },
    lifestyle:     { label: 'Lifestyle',         icon: '🌿', target: 20, color: '#2196F3' },
    promotional:   { label: 'Promotional',       icon: '🎯', target: 15, color: '#E91E63' },
    behind_scenes: { label: 'Behind the Scenes', icon: '🎬', target: 0,  color: '#9C27B0' },
    community:     { label: 'Community',         icon: '🤝', target: 0,  color: '#00BCD4' }
  };

  function renderPillarDistribution() {
    var container = $('yb-social-pillar-chart');
    if (!container) return;

    // Count posts by pillar from last 30 days
    var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    var recentPosts = state.posts.filter(function (p) {
      if (p.status !== 'published' && p.status !== 'scheduled') return false;
      var d = p.publishedAt || p.scheduledAt || p.createdAt;
      if (!d) return false;
      var dt = d._seconds ? new Date(d._seconds * 1000) : new Date(d);
      return dt >= thirtyDaysAgo;
    });

    if (recentPosts.length < 3) {
      container.innerHTML = '<p class="yb-admin__muted">Need at least 3 recent posts with content pillars assigned.</p>';
      return;
    }

    var counts = {};
    var unlabeled = 0;
    recentPosts.forEach(function (p) {
      var pillar = p.contentPillar;
      if (pillar && PILLAR_CONFIG[pillar]) {
        counts[pillar] = (counts[pillar] || 0) + 1;
      } else {
        unlabeled++;
      }
    });

    var total = recentPosts.length;
    var html = '<div class="yb-social__pillar-bars">';

    Object.keys(PILLAR_CONFIG).forEach(function (key) {
      var cfg = PILLAR_CONFIG[key];
      var count = counts[key] || 0;
      var pct = total > 0 ? Math.round((count / total) * 100) : 0;
      var diff = cfg.target > 0 ? pct - cfg.target : 0;
      var diffLabel = diff > 0 ? '+' + diff + '%' : diff < 0 ? diff + '%' : '—';
      var diffClass = diff > 5 ? 'yb-social__pillar-diff--over' : diff < -5 ? 'yb-social__pillar-diff--under' : '';

      html += '<div class="yb-social__pillar-row">' +
        '<div class="yb-social__pillar-row-head">' +
          '<span class="yb-social__pillar-row-name">' + cfg.icon + ' ' + cfg.label + '</span>' +
          '<span class="yb-social__pillar-row-pct">' + pct + '% (' + count + ')' +
          (cfg.target > 0 ? ' <span class="yb-social__pillar-diff ' + diffClass + '">' + diffLabel + ' vs ' + cfg.target + '% target</span>' : '') +
          '</span>' +
        '</div>' +
        '<div class="yb-social__pillar-bar-track">' +
          '<div class="yb-social__pillar-bar-fill" style="width:' + Math.min(pct, 100) + '%;background:' + cfg.color + '"></div>' +
          (cfg.target > 0 ? '<div class="yb-social__pillar-bar-target" style="left:' + cfg.target + '%"></div>' : '') +
        '</div>' +
      '</div>';
    });

    if (unlabeled > 0) {
      html += '<p class="yb-admin__muted" style="margin-top:8px">' + unlabeled + ' post' + (unlabeled > 1 ? 's' : '') + ' without a content pillar assigned.</p>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  function renderCrossPostComparison() {
    var grid = $('yb-social-cross-post-grid');
    if (!grid) return;

    // Find published posts that were posted to multiple platforms
    var multiPosts = state.posts.filter(function (p) {
      return p.status === 'published' && p.platforms && p.platforms.length > 1 && p.publishResults;
    });

    // Also find recycled posts that share the same caption (cross-posted separately)
    var captionMap = {};
    state.posts.forEach(function (p) {
      if (p.status !== 'published' || !p.caption) return;
      var key = p.caption.substring(0, 60);
      if (!captionMap[key]) captionMap[key] = [];
      captionMap[key].push(p);
    });

    // Build comparison cards
    var comparisons = [];

    // From multi-platform posts
    multiPosts.forEach(function (p) {
      var results = p.publishResults || {};
      var platformData = [];
      Object.keys(results).forEach(function (plat) {
        var r = results[plat];
        if (r && r.metrics) {
          platformData.push({
            platform: plat,
            likes: r.metrics.likes || 0,
            comments: r.metrics.comments || 0,
            reach: r.metrics.reach || r.metrics.post_reach || 0,
            engagement: (r.metrics.likes || 0) + (r.metrics.comments || 0) + (r.metrics.shares || 0)
          });
        }
      });
      if (platformData.length > 1) {
        comparisons.push({ caption: p.caption, platforms: platformData, date: p.publishedAt });
      }
    });

    // From duplicate-caption posts
    Object.keys(captionMap).forEach(function (key) {
      var group = captionMap[key];
      if (group.length < 2) return;
      var platformData = [];
      group.forEach(function (p) {
        var plat = p.platforms[0];
        var results = (p.publishResults || {})[plat] || {};
        platformData.push({
          platform: plat,
          likes: (results.metrics || {}).likes || 0,
          comments: (results.metrics || {}).comments || 0,
          reach: (results.metrics || {}).reach || 0,
          engagement: ((results.metrics || {}).likes || 0) + ((results.metrics || {}).comments || 0)
        });
      });
      if (platformData.length > 1) {
        comparisons.push({ caption: group[0].caption, platforms: platformData, date: group[0].publishedAt });
      }
    });

    if (comparisons.length === 0) {
      grid.innerHTML = '<p class="yb-admin__muted">' + (t('social_no_cross_post') || 'No cross-platform posts yet. Post the same content to multiple platforms to see comparison.') + '</p>';
      return;
    }

    grid.innerHTML = comparisons.slice(0, 5).map(function (comp) {
      var maxEng = Math.max.apply(null, comp.platforms.map(function (p) { return p.engagement; })) || 1;
      var winner = comp.platforms.reduce(function (a, b) { return a.engagement > b.engagement ? a : b; });

      return '<div class="yb-social__cross-post-card">' +
        '<p class="yb-social__cross-post-caption">' + truncate(comp.caption, 60) + '</p>' +
        comp.platforms.map(function (p) {
          var pct = Math.round((p.engagement / maxEng) * 100);
          var isWinner = p === winner && comp.platforms.length > 1;
          return '<div class="yb-social__cross-post-row' + (isWinner ? ' yb-social__cross-post-row--winner' : '') + '">' +
            '<span class="yb-social__cross-post-platform">' + platformIcon(p.platform) + '</span>' +
            '<div class="yb-social__cross-post-bar-wrap">' +
            '<div class="yb-social__cross-post-bar" style="width:' + pct + '%"></div>' +
            '</div>' +
            '<span class="yb-social__cross-post-stats">' + p.likes + '❤️ ' + p.comments + '💬 ' + (p.reach ? p.reach.toLocaleString() + '👁' : '') + '</span>' +
            (isWinner ? '<span class="yb-social__cross-post-winner">🏆</span>' : '') +
          '</div>';
        }).join('') +
      '</div>';
    }).join('');
  }

  async function syncMetrics() {
    toast('Syncing metrics...');
    var data = await api('social-analytics', {
      method: 'POST',
      body: JSON.stringify({ action: 'sync' })
    });
    if (data) {
      toast('Synced ' + (data.synced || 0) + ' metrics');
      loadAnalytics();
    }
  }

  function showLastSyncTime() {
    var el = $('yb-social-last-sync');
    if (!el) return;
    firebase.firestore().collection('system').doc('social_metric_sync').get().then(function (doc) {
      if (doc.exists && doc.data().lastRun) {
        var d = doc.data().lastRun.toDate ? doc.data().lastRun.toDate() : new Date(doc.data().lastRun);
        el.textContent = t('social_last_auto_sync') + ': ' + fmtDateTime(d);
        el.hidden = false;
      }
    }).catch(function () {});
  }

  /* ═══ INBOX ═══ */
  var inboxState = {
    tab: 'comments',
    comments: [],
    conversations: [],
    activeThread: null,
    openThreads: [],
    pollTimer: null,
    sentimentFilter: '',
    sentimentAnalyzed: false
  };

  async function loadInbox() {
    var results = await Promise.all([
      api('social-inbox?action=comments&days=7'),
      api('social-inbox?action=conversations')
    ]);

    var commentsData = results[0];
    var messagesData = results[1];

    if (commentsData) {
      inboxState.comments = commentsData.comments || [];
      var countEl = $('yb-social-inbox-comments-count');
      if (countEl) countEl.textContent = commentsData.unread ? '(' + commentsData.unread + ')' : '';
    }

    if (messagesData) {
      inboxState.conversations = messagesData.conversations || [];
      var countEl = $('yb-social-inbox-messages-count');
      if (countEl) countEl.textContent = messagesData.unread ? '(' + messagesData.unread + ')' : '';
    }

    // Update badge
    var totalUnread = (commentsData ? commentsData.unread || 0 : 0) + (messagesData ? messagesData.unread || 0 : 0);
    var badge = $('yb-social-inbox-badge');
    if (badge) {
      badge.textContent = totalUnread;
      badge.hidden = totalUnread === 0;
    }

    renderInbox();
    startInboxPolling();
  }

  function renderInbox() {
    if (inboxState.tab === 'comments') {
      renderComments();
    } else {
      renderConversations();
    }
  }

  function renderComments() {
    var container = $('yb-social-inbox-comments');
    if (!container) return;

    if (inboxState.comments.length === 0) {
      container.innerHTML = '<div class="yb-social__inbox-empty"><p>' + t('social_no_comments') + '</p></div>';
      return;
    }

    // Render sentiment filter bar
    var filterHtml = '<div class="yb-social__inbox-sentiment-bar">' +
      '<button class="yb-social__filter-btn yb-btn--sm' + (!inboxState.sentimentFilter ? ' is-active' : '') + '" data-action="social-inbox-sentiment-filter" data-filter="">All</button>' +
      '<button class="yb-social__filter-btn yb-btn--sm' + (inboxState.sentimentFilter === 'negative' ? ' is-active' : '') + '" data-action="social-inbox-sentiment-filter" data-filter="negative">😡 Negative</button>' +
      '<button class="yb-social__filter-btn yb-btn--sm' + (inboxState.sentimentFilter === 'question' ? ' is-active' : '') + '" data-action="social-inbox-sentiment-filter" data-filter="question">❓ Questions</button>' +
      '<button class="yb-social__filter-btn yb-btn--sm' + (inboxState.sentimentFilter === 'purchase_intent' ? ' is-active' : '') + '" data-action="social-inbox-sentiment-filter" data-filter="purchase_intent">💰 Purchase Intent</button>' +
      '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-inbox-analyze-sentiment" style="margin-left:auto">🤖 Analyze All</button>' +
      '</div>';

    var filtered = inboxState.comments;
    if (inboxState.sentimentFilter) {
      filtered = filtered.filter(function (c) {
        if (!c._sentiment) return false;
        if (inboxState.sentimentFilter === 'purchase_intent') return c._sentiment.intent === 'purchase_intent';
        return c._sentiment.sentiment === inboxState.sentimentFilter;
      });
    }

    var itemsHtml = filtered.map(function (c) {
      var sentimentBadge = '';
      if (c._sentiment) {
        var s = c._sentiment;
        var icons = { positive: '😊', negative: '😡', neutral: '😐', question: '❓' };
        var intentIcons = { purchase_intent: '💰', complaint: '🚨', spam: '🚫', support_request: '🛟' };
        sentimentBadge = '<span class="yb-social__sentiment-badge yb-social__sentiment-badge--' + s.sentiment + '">' +
          (icons[s.sentiment] || '') + '</span>';
        if (intentIcons[s.intent]) {
          sentimentBadge += '<span class="yb-social__sentiment-badge yb-social__sentiment-badge--intent">' + intentIcons[s.intent] + '</span>';
        }
        if (s.urgency === 'high') {
          sentimentBadge += '<span class="yb-social__sentiment-badge yb-social__sentiment-badge--urgent">⚡</span>';
        }
      }

      return '<div class="yb-social__inbox-item' + (c.read ? '' : ' yb-social__inbox-item--unread') +
        (c._sentiment && c._sentiment.urgency === 'high' ? ' yb-social__inbox-item--urgent' : '') +
        '" data-action="social-inbox-open-comment" data-id="' + c.commentId + '" data-platform="' + c.platform + '" data-inbox-id="' + c.id + '">' +
        '<div class="yb-social__inbox-item-head">' +
          platformIcon(c.platform) +
          '<span class="yb-social__inbox-item-author">' + (c.author || 'Unknown') + '</span>' +
          sentimentBadge +
          '<span class="yb-social__inbox-item-time">' + formatTimeAgo(c.timestamp) + '</span>' +
          (!c.read ? '<span class="yb-social__inbox-unread-dot"></span>' : '') +
        '</div>' +
        '<p class="yb-social__inbox-item-text">' + escapeHtml(c.text || '') + '</p>' +
        (c._sentiment && c._sentiment.summary ? '<p class="yb-social__inbox-item-ai-summary">' + escapeHtml(c._sentiment.summary) + '</p>' : '') +
        '<p class="yb-social__inbox-item-context">On: ' + escapeHtml(c.postCaption || '') + '</p>' +
        (c.replies && c.replies.length > 0 ? '<span class="yb-social__inbox-item-replies">' + c.replies.length + ' ' + (c.replies.length === 1 ? 'reply' : 'replies') + '</span>' : '') +
      '</div>';
    }).join('');

    container.innerHTML = filterHtml + itemsHtml;
  }

  function renderConversations() {
    var container = $('yb-social-inbox-messages');
    if (!container) return;

    if (inboxState.conversations.length === 0) {
      container.innerHTML = '<div class="yb-social__inbox-empty"><p>' + t('social_no_messages') + '</p></div>';
      return;
    }

    container.innerHTML = inboxState.conversations.map(function (c) {
      return '<div class="yb-social__inbox-item' + (c.read ? '' : ' yb-social__inbox-item--unread') + '" data-action="social-inbox-open-conversation" data-id="' + c.conversationId + '" data-platform="' + c.platform + '" data-inbox-id="' + c.id + '">' +
        '<div class="yb-social__inbox-item-head">' +
          platformIcon(c.platform) +
          '<span class="yb-social__inbox-item-author">' + (c.participants.join(', ') || 'Unknown') + '</span>' +
          '<span class="yb-social__inbox-item-time">' + formatTimeAgo(c.lastMessageAt) + '</span>' +
          (!c.read ? '<span class="yb-social__inbox-unread-dot"></span>' : '') +
        '</div>' +
        '<p class="yb-social__inbox-item-text">' +
          (c.lastMessageFrom ? '<strong>' + escapeHtml(c.lastMessageFrom) + ':</strong> ' : '') +
          escapeHtml(truncate(c.lastMessage, 100)) +
        '</p>' +
        '<span class="yb-social__inbox-item-replies">' + c.messageCount + ' messages</span>' +
      '</div>';
    }).join('');
  }

  // ── Multi-Thread Panel Helpers ─────────────────────────────
  function getThreadPanelId(type, id) { return 'thread-' + type + '-' + id; }

  function createThreadPanel(panelId, titleText) {
    var container = $('yb-social-inbox-threads-container');
    if (!container) return null;

    // If panel already open, focus it
    var existing = document.getElementById(panelId);
    if (existing) {
      existing.querySelector('.yb-social__inbox-thread-body').scrollTop = existing.querySelector('.yb-social__inbox-thread-body').scrollHeight;
      return existing;
    }

    var panel = document.createElement('div');
    panel.className = 'yb-social__inbox-thread';
    panel.id = panelId;
    panel.innerHTML =
      '<div class="yb-social__inbox-thread-header">' +
        '<button type="button" data-action="social-inbox-close-thread" data-panel-id="' + panelId + '">&times;</button>' +
        '<h4 class="yb-social__inbox-thread-title">' + escapeHtml(titleText) + '</h4>' +
        '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm yb-social__create-lead-btn" data-action="social-inbox-create-lead" data-panel-id="' + panelId + '" title="Create Lead">👤</button>' +
      '</div>' +
      '<div class="yb-social__inbox-thread-body"></div>' +
      '<div class="yb-social__inbox-reply-box">' +
        '<div class="yb-social__inbox-ai-suggestions" hidden></div>' +
        '<div class="yb-social__saved-replies-dropdown" hidden></div>' +
        '<textarea class="yb-social__inbox-reply-input" rows="2" placeholder="Type your reply..."></textarea>' +
        '<div class="yb-social__inbox-reply-actions">' +
          '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-saved-replies-toggle" data-panel-id="' + panelId + '">&#128172;</button>' +
          '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-auto-reply-suggest" data-panel-id="' + panelId + '">&#9889; Quick AI</button>' +
          '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm yb-social__ai-reply-btn" data-action="social-ai-draft-reply" data-panel-id="' + panelId + '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> AI Reply</button>' +
          '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-save-reply-template" data-panel-id="' + panelId + '">&#9734;</button>' +
          '<button type="button" class="yb-btn yb-btn--primary yb-btn--sm" data-action="social-inbox-send-reply" data-panel-id="' + panelId + '">Send</button>' +
        '</div>' +
      '</div>';

    container.appendChild(panel);
    return panel;
  }

  function getActiveThreadForPanel(panelId) {
    return inboxState.openThreads.find(function (t) { return t.panelId === panelId; });
  }

  function getActiveThread() {
    return inboxState.activeThread;
  }

  function setActiveThread(panelId) {
    inboxState.activeThread = getActiveThreadForPanel(panelId) || null;
  }

  function getReplyElForPanel(panelId) {
    var panel = document.getElementById(panelId);
    return panel ? panel.querySelector('.yb-social__inbox-reply-input') : null;
  }

  function getSuggestionsElForPanel(panelId) {
    var panel = document.getElementById(panelId);
    return panel ? panel.querySelector('.yb-social__inbox-ai-suggestions') : null;
  }

  async function openCommentThread(commentId, platform, inboxId) {
    var panelId = getThreadPanelId('comment', commentId);

    // Find the comment in state
    var comment = inboxState.comments.find(function (c) { return c.commentId === commentId; });
    var titleText = (comment ? comment.author : 'Comment') + ' — ' + platform;

    var panel = createThreadPanel(panelId, titleText);
    if (!panel) return;
    var body = panel.querySelector('.yb-social__inbox-thread-body');

    var threadData = { type: 'comment', id: commentId, platform: platform, inboxId: inboxId, panelId: panelId };
    // Add to openThreads if not already there
    if (!inboxState.openThreads.find(function (t) { return t.panelId === panelId; })) {
      inboxState.openThreads.push(threadData);
    }
    inboxState.activeThread = threadData;

    // Show the original comment + replies
    var html = '';
    if (comment) {
      html += '<div class="yb-social__inbox-msg yb-social__inbox-msg--them">' +
        '<div class="yb-social__inbox-msg-head"><strong>' + escapeHtml(comment.author) + '</strong> <span>' + formatTimeAgo(comment.timestamp) + '</span></div>' +
        '<p>' + escapeHtml(comment.text) + '</p>' +
      '</div>';

      (comment.replies || []).forEach(function (r) {
        var isOwn = r.username === 'yogabible' || (r.from && r.from.name === 'Yoga Bible');
        html += '<div class="yb-social__inbox-msg' + (isOwn ? ' yb-social__inbox-msg--own' : ' yb-social__inbox-msg--them') + '">' +
          '<div class="yb-social__inbox-msg-head"><strong>' + escapeHtml(r.username || (r.from ? r.from.name : '')) + '</strong> <span>' + formatTimeAgo(r.timestamp || r.created_time) + '</span></div>' +
          '<p>' + escapeHtml(r.text || r.message || '') + '</p>' +
        '</div>';
      });
    }

    body.innerHTML = html || '<p class="yb-admin__muted">Loading thread...</p>';
    markInboxRead([inboxId]);

    // Fetch full thread from API
    var data = await api('social-inbox?action=thread&id=' + commentId + '&platform=' + platform + '&type=comment');
    if (data && data.thread && data.thread.length > 0) {
      var extraHtml = '';
      data.thread.forEach(function (r) {
        var isOwn = r.username === 'yogabible' || (r.from && r.from.name === 'Yoga Bible');
        extraHtml += '<div class="yb-social__inbox-msg' + (isOwn ? ' yb-social__inbox-msg--own' : ' yb-social__inbox-msg--them') + '">' +
          '<div class="yb-social__inbox-msg-head"><strong>' + escapeHtml(r.username || (r.from ? r.from.name : '')) + '</strong> <span>' + formatTimeAgo(r.timestamp || r.created_time) + '</span></div>' +
          '<p>' + escapeHtml(r.text || r.message || '') + '</p>' +
        '</div>';
      });
      if (comment) {
        body.innerHTML = '<div class="yb-social__inbox-msg yb-social__inbox-msg--them">' +
          '<div class="yb-social__inbox-msg-head"><strong>' + escapeHtml(comment.author) + '</strong> <span>' + formatTimeAgo(comment.timestamp) + '</span></div>' +
          '<p>' + escapeHtml(comment.text) + '</p>' +
        '</div>' + extraHtml;
      }
    }
  }

  async function openConversationThread(conversationId, platform, inboxId) {
    var panelId = getThreadPanelId('conversation', conversationId);

    var conv = inboxState.conversations.find(function (c) { return c.conversationId === conversationId; });
    var titleText = (conv ? conv.participants.join(', ') : 'Conversation') + ' — ' + platform;

    var panel = createThreadPanel(panelId, titleText);
    if (!panel) return;
    var body = panel.querySelector('.yb-social__inbox-thread-body');

    var threadData = { type: 'conversation', id: conversationId, platform: platform, inboxId: inboxId, panelId: panelId };
    if (!inboxState.openThreads.find(function (t) { return t.panelId === panelId; })) {
      inboxState.openThreads.push(threadData);
    }
    inboxState.activeThread = threadData;

    body.innerHTML = '<p class="yb-admin__muted">Loading messages...</p>';
    markInboxRead([inboxId]);

    var data = await api('social-inbox?action=thread&id=' + conversationId + '&platform=' + platform + '&type=conversation');
    if (data && data.thread) {
      var msgs = data.thread.reverse();
      body.innerHTML = msgs.map(function (m) {
        var isOwn = (m.from && (m.from.name === 'Yoga Bible' || m.from.id === '878172732056415'));
        return '<div class="yb-social__inbox-msg' + (isOwn ? ' yb-social__inbox-msg--own' : ' yb-social__inbox-msg--them') + '">' +
          '<div class="yb-social__inbox-msg-head"><strong>' + escapeHtml(m.from ? m.from.name : '') + '</strong> <span>' + formatTimeAgo(m.created_time) + '</span></div>' +
          '<p>' + escapeHtml(m.message || '') + '</p>' +
        '</div>';
      }).join('') || '<p class="yb-admin__muted">No messages</p>';
      body.scrollTop = body.scrollHeight;
    }
  }

  function closeThread(panelId) {
    if (!panelId) {
      // Legacy fallback — close all
      var container = $('yb-social-inbox-threads-container');
      if (container) container.innerHTML = '';
      inboxState.openThreads = [];
      inboxState.activeThread = null;
      return;
    }
    var panel = document.getElementById(panelId);
    if (panel) panel.remove();
    inboxState.openThreads = inboxState.openThreads.filter(function (t) { return t.panelId !== panelId; });
    if (inboxState.activeThread && inboxState.activeThread.panelId === panelId) {
      inboxState.activeThread = inboxState.openThreads.length > 0 ? inboxState.openThreads[inboxState.openThreads.length - 1] : null;
    }
  }

  async function sendReply(panelId) {
    // Find thread data for this panel
    var threadInfo = panelId ? getActiveThreadForPanel(panelId) : inboxState.activeThread;
    if (!threadInfo) return;
    var pid = threadInfo.panelId || panelId;

    var replyEl = getReplyElForPanel(pid);
    if (!replyEl || !replyEl.value.trim()) return;

    var text = replyEl.value.trim();
    var body = {};

    if (threadInfo.type === 'comment') {
      body = { action: 'reply-comment', commentId: threadInfo.id, text: text, platform: threadInfo.platform };
    } else {
      body = { action: 'reply-message', conversationId: threadInfo.id, text: text, platform: threadInfo.platform };
    }

    toast('Sending...');
    var data = await api('social-inbox', { method: 'POST', body: JSON.stringify(body) });

    if (data) {
      replyEl.value = '';
      toast('Reply sent');

      var panel = document.getElementById(pid);
      var threadBody = panel ? panel.querySelector('.yb-social__inbox-thread-body') : null;
      if (threadBody) {
        var msgHtml = '<div class="yb-social__inbox-msg yb-social__inbox-msg--own">' +
          '<div class="yb-social__inbox-msg-head"><strong>Yoga Bible</strong> <span>Just now</span></div>' +
          '<p>' + escapeHtml(text) + '</p></div>';
        threadBody.insertAdjacentHTML('beforeend', msgHtml);
        threadBody.scrollTop = threadBody.scrollHeight;
      }
    }
  }

  async function markInboxRead(ids) {
    if (!ids || !ids.length) return;
    await api('social-inbox', { method: 'POST', body: JSON.stringify({ action: 'mark-read', ids: ids }) });
    // Update local state
    ids.forEach(function (id) {
      var c = inboxState.comments.find(function (x) { return x.id === id; });
      if (c) c.read = true;
      var m = inboxState.conversations.find(function (x) { return x.id === id; });
      if (m) m.read = true;
    });
  }

  async function markAllRead() {
    var ids = [];
    if (inboxState.tab === 'comments') {
      inboxState.comments.forEach(function (c) { if (!c.read) ids.push(c.id); });
    } else {
      inboxState.conversations.forEach(function (c) { if (!c.read) ids.push(c.id); });
    }
    if (ids.length === 0) { toast('All caught up'); return; }
    await markInboxRead(ids);
    toast('Marked ' + ids.length + ' as read');
    renderInbox();
    updateInboxBadge();
  }

  function updateInboxBadge() {
    var unreadComments = inboxState.comments.filter(function (c) { return !c.read; }).length;
    var unreadMessages = inboxState.conversations.filter(function (c) { return !c.read; }).length;
    var total = unreadComments + unreadMessages;
    var badge = $('yb-social-inbox-badge');
    if (badge) { badge.textContent = total; badge.hidden = total === 0; }
    var cc = $('yb-social-inbox-comments-count');
    if (cc) cc.textContent = unreadComments ? '(' + unreadComments + ')' : '';
    var mc = $('yb-social-inbox-messages-count');
    if (mc) mc.textContent = unreadMessages ? '(' + unreadMessages + ')' : '';
  }

  function startInboxPolling() {
    if (inboxState.pollTimer) clearInterval(inboxState.pollTimer);
    inboxState.pollTimer = setInterval(function () {
      if (state.view === 'inbox') loadInbox();
    }, 60000); // Poll every 60s when inbox is active
  }

  // ── AI Draft Reply ──────────────────────────────────────────
  async function aiDraftReply(panelId) {
    var thread = panelId ? getActiveThreadForPanel(panelId) : inboxState.activeThread;
    if (!thread) { toast('Open a thread first', true); return; }
    var pid = thread.panelId || panelId;

    var commentText = '';
    var contextText = '';
    if (thread.type === 'comment') {
      var c = inboxState.comments.find(function (x) { return x.commentId === thread.id; });
      if (c) { commentText = c.text; contextText = c.postCaption || ''; }
    } else {
      var conv = inboxState.conversations.find(function (x) { return x.conversationId === thread.id; });
      if (conv) { commentText = conv.lastMessage; }
    }

    if (!commentText) { toast('No message to reply to', true); return; }

    var sugEl = getSuggestionsElForPanel(pid);
    if (sugEl) { sugEl.hidden = false; sugEl.innerHTML = '<p class="yb-admin__muted">' + t('social_ai_generating') + '</p>'; }

    var data = await api('social-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'reply-comment',
        comment: commentText,
        context: contextText,
        platform: thread.platform
      })
    });

    if (!data || !data.replies) {
      if (sugEl) sugEl.innerHTML = '<p class="yb-admin__muted">AI could not generate replies.</p>';
      return;
    }

    state.aiReplyOptions = data.replies;
    state.aiReplyPanelId = pid;

    if (sugEl) {
      sugEl.innerHTML = '<div class="yb-social__ai-reply-label">' + t('social_ai_suggestions') + '</div>' +
        data.replies.map(function (r, i) {
          return '<div class="yb-social__ai-reply-opt">' +
            '<p>' + escapeHtml(r.text) + '</p>' +
            '<div class="yb-social__ai-reply-opt-meta">' +
            '<span class="yb-social__ai-reply-style">' + r.style + '</span>' +
            '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="social-ai-use-reply" data-index="' + i + '" data-panel-id="' + pid + '">' + t('social_ai_use') + '</button>' +
            '</div></div>';
        }).join('') +
        (data.sentiment ? '<p class="yb-admin__muted" style="margin-top:8px">Sentiment: ' + data.sentiment + (data.suggestPrivate ? ' — suggest moving to DM' : '') + '</p>' : '');
    }
  }

  function useAiReply(index, panelId) {
    if (!state.aiReplyOptions || !state.aiReplyOptions[index]) return;
    var pid = panelId || state.aiReplyPanelId;
    var replyEl = pid ? getReplyElForPanel(pid) : null;
    if (replyEl) replyEl.value = state.aiReplyOptions[index].text;
    var sugEl = pid ? getSuggestionsElForPanel(pid) : null;
    if (sugEl) sugEl.hidden = true;
  }

  // ── Create Lead from DM/Comment ───────────────────────────────
  async function createLeadFromInbox() {
    if (!inboxState.activeThread) { toast('Open a thread first', true); return; }
    var thread = inboxState.activeThread;
    var name = '';
    var source = thread.platform + '_' + thread.type;
    var messageText = '';

    if (thread.type === 'comment') {
      var c = inboxState.comments.find(function (x) { return x.commentId === thread.id; });
      if (c) { name = c.author || ''; messageText = c.text || ''; }
    } else {
      var conv = inboxState.conversations.find(function (x) { return x.conversationId === thread.id; });
      if (conv && conv.participants) name = conv.participants[0] || '';
      if (conv) messageText = conv.lastMessage || '';
    }

    // Auto-detect YTT interest from message content
    var detectedInterest = detectYTTInterest(messageText);

    // Build and show lead creation modal
    var existing = document.getElementById('yb-social-lead-modal');
    if (existing) existing.remove();

    var html = '<div class="yb-social__connect-modal" id="yb-social-lead-modal">' +
      '<div class="yb-social__connect-overlay" data-action="social-lead-modal-close"></div>' +
      '<div class="yb-social__connect-box">' +
      '<h3>👤 ' + (t('social_create_lead') || 'Create Lead') + '</h3>' +
      '<p style="color:var(--yb-muted);font-size:.85rem;margin-bottom:1rem;">' +
        'From ' + thread.platform + ' ' + thread.type +
        (detectedInterest ? ' · Detected interest: <strong style="color:var(--yb-brand)">' + detectedInterest + '</strong>' : '') +
      '</p>' +
      '<div class="yb-admin__field">' +
        '<label for="yb-social-lead-name">' + (t('social_create_lead_name') || 'Name') + '</label>' +
        '<input type="text" id="yb-social-lead-name" value="' + (name || '').replace(/"/g, '&quot;') + '">' +
      '</div>' +
      '<div class="yb-admin__field">' +
        '<label for="yb-social-lead-email">' + (t('social_create_lead_email') || 'Email') + '</label>' +
        '<input type="email" id="yb-social-lead-email" placeholder="email@example.com">' +
      '</div>' +
      '<div class="yb-admin__field">' +
        '<label for="yb-social-lead-phone">' + (t('social_lead_phone') || 'Phone') + '</label>' +
        '<input type="tel" id="yb-social-lead-phone" placeholder="+45...">' +
      '</div>' +
      '<div class="yb-admin__field">' +
        '<label for="yb-social-lead-program">' + (t('social_lead_program') || 'Program interest') + '</label>' +
        '<select id="yb-social-lead-program">' +
          '<option value="">' + (t('social_lead_undecided') || 'Undecided') + '</option>' +
          '<option value="4-week"' + (detectedInterest === '4-week' ? ' selected' : '') + '>4-Week Intensive</option>' +
          '<option value="8-week"' + (detectedInterest === '8-week' ? ' selected' : '') + '>8-Week Semi-Intensive</option>' +
          '<option value="18-week"' + (detectedInterest === '18-week' ? ' selected' : '') + '>18-Week Flexible</option>' +
          '<option value="4-week-jul"' + (detectedInterest === '4-week-jul' ? ' selected' : '') + '>4-Week Vinyasa Plus (July)</option>' +
          '<option value="300h"' + (detectedInterest === '300h' ? ' selected' : '') + '>300h Advanced</option>' +
        '</select>' +
      '</div>' +
      '<div class="yb-admin__field">' +
        '<label for="yb-social-lead-notes">' + (t('social_lead_notes') || 'Notes') + '</label>' +
        '<textarea id="yb-social-lead-notes" rows="2">' +
          'From ' + thread.platform + ' ' + thread.type + (messageText ? ': "' + messageText.substring(0, 200) + '"' : '') +
        '</textarea>' +
      '</div>' +
      '<div class="yb-social__connect-actions">' +
        '<button class="yb-btn yb-btn--outline" data-action="social-lead-modal-close">Cancel</button>' +
        '<button class="yb-btn yb-btn--primary" data-action="social-lead-modal-save">Create Lead</button>' +
      '</div></div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
    var nameEl = document.getElementById('yb-social-lead-name');
    if (nameEl) setTimeout(function () { nameEl.focus(); }, 100);
  }

  function detectYTTInterest(text) {
    if (!text) return '';
    var lower = text.toLowerCase();
    if (/4.?week.*jul|july|vinyasa plus|sommer/i.test(lower)) return '4-week-jul';
    if (/4.?week|4.?uge|intensiv/i.test(lower)) return '4-week';
    if (/8.?week|8.?uge|semi/i.test(lower)) return '8-week';
    if (/18.?week|18.?uge|flex/i.test(lower)) return '18-week';
    if (/300|advanced|videre/i.test(lower)) return '300h';
    if (/ytt|yoga.*teacher|uddannelse|training/i.test(lower)) return '';
    return '';
  }

  async function saveLeadFromModal() {
    var nameVal = (document.getElementById('yb-social-lead-name') || {}).value || '';
    if (!nameVal.trim()) { toast('Enter a name', true); return; }

    var leadData = {
      first_name: nameVal.split(' ')[0] || nameVal,
      last_name: nameVal.split(' ').slice(1).join(' ') || '',
      email: (document.getElementById('yb-social-lead-email') || {}).value || '',
      phone: (document.getElementById('yb-social-lead-phone') || {}).value || '',
      source: inboxState.activeThread ? inboxState.activeThread.platform + '_' + inboxState.activeThread.type : 'social',
      status: 'new',
      ytt_program_type: (document.getElementById('yb-social-lead-program') || {}).value || '',
      notes: (document.getElementById('yb-social-lead-notes') || {}).value || ''
    };

    toast('Creating lead...');
    var modal = document.getElementById('yb-social-lead-modal');
    if (modal) modal.remove();

    var data = await api('lead', {
      method: 'POST',
      body: JSON.stringify(leadData)
    });

    if (data) {
      toast(t('social_lead_created') || 'Lead created');
    }
  }

  // ── AI Content Planner ────────────────────────────────────────
  var aiPlanData = null;

  async function aiGeneratePlan() {
    var daysEl = $('yb-social-ai-plan-days');
    var themesEl = $('yb-social-ai-plan-themes');
    var goalsEl = $('yb-social-ai-plan-goals');
    var resultsEl = $('yb-social-ai-plan-results');
    var genBtn = $('yb-social-ai-plan-generate-btn');

    var days = daysEl ? parseInt(daysEl.value) : 14;
    var themes = themesEl && themesEl.value ? themesEl.value.split(',').map(function (s) { return s.trim(); }) : [];
    var goals = goalsEl ? goalsEl.value : '';

    // Collect existing scheduled posts for context
    var existingPosts = state.posts.filter(function (p) { return p.status === 'scheduled'; }).map(function (p) {
      return { date: p.scheduledAt, caption: p.caption };
    });

    setLoading(genBtn, true, 'Generating...');
    if (resultsEl) { resultsEl.hidden = false; resultsEl.innerHTML = '<p class="yb-admin__muted">' + t('social_ai_generating') + '</p>'; }

    var data = await api('social-ai', {
      method: 'POST',
      body: JSON.stringify({ action: 'content-plan', days: days, themes: themes, goals: goals, existingPosts: existingPosts })
    });

    setLoading(genBtn, false);

    if (!data || !data.plan) {
      if (resultsEl) resultsEl.innerHTML = '<p class="yb-admin__muted">Could not generate plan.</p>';
      return;
    }

    aiPlanData = data.plan;

    if (resultsEl) {
      var planHtml = data.strategy_notes ? '<p class="yb-social__ai-plan-strategy">' + escapeHtml(data.strategy_notes) + '</p>' : '';
      planHtml += '<div class="yb-social__ai-plan-list">';
      data.plan.forEach(function (item, i) {
        planHtml += '<div class="yb-social__ai-plan-item">' +
          '<div class="yb-social__ai-plan-item-date">' +
            '<strong>' + item.date + '</strong> ' + (item.time || '') +
            '<span class="yb-social__ai-plan-cat yb-social__ai-plan-cat--' + (item.category || 'educational') + '">' + (item.category || '') + '</span>' +
          '</div>' +
          '<p>' + escapeHtml(item.caption_idea || '') + '</p>' +
          '<div class="yb-social__ai-plan-item-meta">' +
            '<span>' + (item.visual_type || '') + '</span>' +
            '<span>' + (item.platforms || []).join(', ') + '</span>' +
            '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="social-ai-plan-create-post" data-index="' + i + '">' + t('social_ai_create_post') + '</button>' +
          '</div></div>';
      });
      planHtml += '</div>';
      resultsEl.innerHTML = planHtml;
    }
  }

  function aiPlanCreatePost(index) {
    if (!aiPlanData || !aiPlanData[index]) return;
    var item = aiPlanData[index];
    // Open composer pre-filled with the plan item
    if (window._ybSocial && window._ybSocial.openSocialComposer) {
      window._ybSocial.openSocialComposer({
        caption: item.caption_idea || '',
        platforms: item.platforms || [],
        scheduledAt: item.date && item.time ? item.date + 'T' + item.time : null
      });
    }
    // Close plan modal
    var m = $('yb-social-ai-plan-modal');
    if (m) m.hidden = true;
  }

  // ── AI Analytics Insights ─────────────────────────────────────
  async function aiGetInsights() {
    var panel = $('yb-social-ai-insights-panel');
    var bodyEl = $('yb-social-ai-insights-body');
    var insBtn = document.querySelector('[data-action="social-ai-insights"]');
    if (!panel) return;

    setLoading(insBtn, true, 'Analyzing...');
    panel.hidden = false;
    if (bodyEl) bodyEl.innerHTML = '<p class="yb-admin__muted">' + t('social_ai_analyzing') + '</p>';

    // Gather current metrics from the DOM
    var metrics = {
      followers: ($('yb-social-stat-followers') || {}).textContent || '0',
      engagement: ($('yb-social-stat-engagement') || {}).textContent || '0',
      reach: ($('yb-social-stat-reach') || {}).textContent || '0',
      posts: ($('yb-social-stat-posts') || {}).textContent || '0',
      period: ($('yb-social-analytics-range') || {}).value || '30'
    };

    var data = await api('social-ai', {
      method: 'POST',
      body: JSON.stringify({ action: 'analytics-insight', metrics: metrics, period: metrics.period + ' days' })
    });

    setLoading(insBtn, false);

    if (!data || !data.summary) {
      if (bodyEl) bodyEl.innerHTML = '<p class="yb-admin__muted">Could not generate insights.</p>';
      return;
    }

    var html = '<div class="yb-social__ai-insight-summary"><p>' + escapeHtml(data.summary) + '</p></div>';

    if (data.highlights && data.highlights.length) {
      html += '<div class="yb-social__ai-insight-section"><h4>✅ ' + t('social_ai_highlights') + '</h4><ul>' +
        data.highlights.map(function (h) { return '<li>' + escapeHtml(h) + '</li>'; }).join('') + '</ul></div>';
    }

    if (data.concerns && data.concerns.length) {
      html += '<div class="yb-social__ai-insight-section yb-social__ai-insight-section--warn"><h4>⚠️ ' + t('social_ai_concerns') + '</h4><ul>' +
        data.concerns.map(function (h) { return '<li>' + escapeHtml(h) + '</li>'; }).join('') + '</ul></div>';
    }

    if (data.recommendations && data.recommendations.length) {
      html += '<div class="yb-social__ai-insight-section"><h4>💡 ' + t('social_ai_recommendations') + '</h4>';
      data.recommendations.forEach(function (r) {
        var prioClass = r.priority === 'high' ? 'yb-social__ai-priority--high' : r.priority === 'low' ? 'yb-social__ai-priority--low' : '';
        html += '<div class="yb-social__ai-recommendation"><span class="yb-social__ai-priority ' + prioClass + '">' + (r.priority || 'medium') + '</span>' +
          '<strong>' + escapeHtml(r.action) + '</strong><p class="yb-admin__muted">' + escapeHtml(r.reason) + '</p></div>';
      });
      html += '</div>';
    }

    if (bodyEl) bodyEl.innerHTML = html;
  }

  function switchInboxTab(tab) {
    inboxState.tab = tab;
    var commentsEl = $('yb-social-inbox-comments');
    var messagesEl = $('yb-social-inbox-messages');
    var mentionsEl = $('yb-social-inbox-mentions');
    if (commentsEl) commentsEl.hidden = tab !== 'comments';
    if (messagesEl) messagesEl.hidden = tab !== 'messages';
    if (mentionsEl) mentionsEl.hidden = tab !== 'mentions';
    qsa('#yb-social-inbox-tabs .yb-social__filter-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === tab);
    });
    closeThread();
    if (tab === 'mentions') {
      loadMentions();
    } else {
      renderInbox();
    }
  }

  // ── Sentiment Analysis ──────────────────────────────────────────

  function filterInboxBySentiment(filter) {
    inboxState.sentimentFilter = filter || '';
    renderComments();
  }

  async function analyzeInboxSentiment() {
    if (inboxState.comments.length === 0) { toast('No comments to analyze', true); return; }

    toast('Analyzing sentiment...');
    var items = inboxState.comments.slice(0, 20).map(function (c) {
      return {
        id: c.id,
        text: c.text || '',
        author: c.author || 'Unknown',
        platform: c.platform
      };
    });

    var data = await api('social-inbox', {
      method: 'POST',
      body: JSON.stringify({ action: 'analyze-sentiment', items: items })
    });

    if (data && data.results) {
      data.results.forEach(function (r) {
        if (r.index !== undefined && inboxState.comments[r.index]) {
          inboxState.comments[r.index]._sentiment = r;
        }
      });
      inboxState.sentimentAnalyzed = true;
      renderComments();
      toast('Analyzed ' + data.results.length + ' comments' + (data.alertCount ? ' — ' + data.alertCount + ' alerts sent to Telegram' : ''));
    }
  }

  // ── Smart Queue (bulk) ──────────────────────────────────────────

  async function smartScheduleSelected() {
    if (state.selectedPosts.length === 0) { toast('Select posts first', true); return; }

    toast('Smart scheduling ' + state.selectedPosts.length + ' posts...');
    var data = await api('social-smart-queue', {
      method: 'POST',
      body: JSON.stringify({ action: 'auto-schedule', postIds: state.selectedPosts })
    });

    if (data) {
      var msg = 'Scheduled ' + (data.scheduled || []).length + ' posts';
      if (data.errors && data.errors.length > 0) msg += ' (' + data.errors.length + ' errors)';
      toast(msg);
      state.selectedPosts = [];
      loadPosts();
    }
  }

  // ── Social Mentions Monitoring ──────────────────────────────────

  var mentionsState = {
    mentions: [],
    keywords: [],
    stats: null,
    loaded: false
  };

  async function loadMentions() {
    var data = await api('social-mentions?action=list&days=30');
    if (!data) return;
    mentionsState.mentions = data.mentions || [];
    mentionsState.keywords = data.keywords || [];
    mentionsState.loaded = true;
    renderMentions();
    updateMentionsBadge();
  }

  function renderMentions() {
    var container = $('yb-social-mentions-list');
    if (!container) return;

    if (mentionsState.mentions.length === 0) {
      container.innerHTML = '<div class="yb-social__inbox-empty"><p>' + t('social_no_mentions') + '</p></div>';
      return;
    }

    container.innerHTML = mentionsState.mentions.map(function (m) {
      var typeIcon = m.type === 'tag' ? '🏷️' : m.type === 'mention' ? '@' : '🔍';
      var typeLabel = m.type === 'tag' ? 'Tagged' : m.type === 'mention' ? 'Mentioned' : 'Keyword';
      return '<div class="yb-social__inbox-item yb-social__mention-item' + (m.read ? '' : ' yb-social__inbox-item--unread') + '"' +
        ' data-action="social-mention-open" data-id="' + m.id + '">' +
        '<div class="yb-social__inbox-item-head">' +
          platformIcon(m.platform) +
          '<span class="yb-social__mention-type">' + typeIcon + ' ' + typeLabel + '</span>' +
          '<span class="yb-social__inbox-item-author">' + escapeHtml(m.author || 'Unknown') + '</span>' +
          '<span class="yb-social__inbox-item-time">' + formatTimeAgo(m.mentionedAt) + '</span>' +
          (!m.read ? '<span class="yb-social__inbox-unread-dot"></span>' : '') +
        '</div>' +
        (m.mediaUrl ? '<div class="yb-social__mention-media"><img src="' + m.mediaUrl + '" alt="" loading="lazy"></div>' : '') +
        '<p class="yb-social__inbox-item-text">' + escapeHtml(truncate(m.text || '', 150)) + '</p>' +
        (m.permalink ? '<a href="' + m.permalink + '" target="_blank" rel="noopener" class="yb-social__mention-link">View on ' + m.platform + ' &rarr;</a>' : '') +
      '</div>';
    }).join('');
  }

  function updateMentionsBadge() {
    var unread = mentionsState.mentions.filter(function (m) { return !m.read; }).length;
    var badge = $('yb-social-inbox-mentions-count');
    if (badge) badge.textContent = unread ? '(' + unread + ')' : '';
    // Also update main inbox badge to include mentions
    var mainBadge = $('yb-social-inbox-badge');
    if (mainBadge) {
      var totalUnread = (inboxState.comments ? inboxState.comments.filter(function (c) { return !c.read; }).length : 0) +
        (inboxState.conversations ? inboxState.conversations.filter(function (c) { return !c.read; }).length : 0) +
        unread;
      mainBadge.textContent = totalUnread;
      mainBadge.hidden = totalUnread === 0;
    }
  }

  async function openMention(id) {
    var mention = mentionsState.mentions.find(function (m) { return m.id === id; });
    if (!mention) return;

    // Mark as read
    if (!mention.read) {
      mention.read = true;
      renderMentions();
      updateMentionsBadge();
      api('social-mentions', { method: 'POST', body: JSON.stringify({ action: 'mark-read', ids: [id] }) });
    }

    // If it has a permalink, open in new tab
    if (mention.permalink) {
      window.open(mention.permalink, '_blank');
    }
  }

  async function refreshMentions() {
    toast(t('social_mentions_refreshing') || 'Scanning for mentions...');
    var data = await api('social-mentions', { method: 'POST', body: JSON.stringify({ action: 'refresh' }) });
    if (data) {
      toast((data.newMentions || 0) + ' new mentions found');
      loadMentions();
    }
  }

  function showMentionsKeywords() {
    var form = $('yb-social-mentions-keywords-form');
    var input = $('yb-social-mentions-keywords-input');
    if (form) form.hidden = !form.hidden;
    if (input && mentionsState.keywords.length) {
      input.value = mentionsState.keywords.join('\n');
    }
  }

  async function saveMentionsKeywords() {
    var input = $('yb-social-mentions-keywords-input');
    if (!input) return;
    var keywords = input.value.split('\n').map(function (k) { return k.trim(); }).filter(Boolean);
    var data = await api('social-mentions', { method: 'POST', body: JSON.stringify({ action: 'update-keywords', keywords: keywords }) });
    if (data) {
      mentionsState.keywords = keywords;
      toast(t('social_saved') || 'Keywords saved');
      var form = $('yb-social-mentions-keywords-form');
      if (form) form.hidden = true;
    }
  }

  function formatTimeAgo(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ═══ HASHTAG MANAGER ═══ */
  async function loadHashtags() {
    var db = firebase.firestore();
    var snap = await db.collection('social_hashtag_sets').orderBy('createdAt', 'desc').get();
    state.hashtagSets = [];
    snap.forEach(function (doc) { state.hashtagSets.push(Object.assign({ id: doc.id }, doc.data())); });
    renderHashtags();
    analyzeHashtagPerformance();
  }

  function renderHashtags() {
    var grid = $('yb-social-hashtag-list');
    if (!grid) return;

    if (state.hashtagSets.length === 0) {
      grid.innerHTML = '<p class="yb-admin__muted">No hashtag sets yet. Create your first one.</p>';
      return;
    }

    grid.innerHTML = state.hashtagSets.map(function (s) {
      var avgEng = s._avgEngagement ? ' · Avg engagement: ' + s._avgEngagement.toFixed(1) : '';
      return '<div class="yb-social__hashtag-card">' +
        '<h4>' + (s.name || 'Untitled') + '</h4>' +
        '<div class="yb-social__hashtag-tags">' +
        (s.hashtags || []).slice(0, 15).map(function (h) {
          var score = (state.hashtagScores || {})[h.toLowerCase()];
          var cls = score && score.avgEngagement > 10 ? ' yb-social__hashtag-tag--hot' : '';
          return '<span class="yb-social__hashtag-tag' + cls + '">' + h + '</span>';
        }).join('') +
        (s.hashtags && s.hashtags.length > 15 ? '<span class="yb-social__hashtag-tag">+' + (s.hashtags.length - 15) + '</span>' : '') +
        '</div>' +
        '<div class="yb-social__hashtag-card-meta">' + t('social_used') + ' ' + (s.timesUsed || 0) + ' ' + t('social_times') + avgEng + '</div>' +
        '<div class="yb-social__hashtag-card-actions">' +
        '<button data-action="social-edit-hashtag-set" data-id="' + s.id + '">' + t('social_edit') + '</button>' +
        '<button data-action="social-delete-hashtag-set" data-id="' + s.id + '">' + t('social_delete') + '</button>' +
        '</div></div>';
    }).join('');
  }

  // ── Hashtag Performance Analysis ────────────────────────
  function analyzeHashtagPerformance() {
    var scores = {}; // { '#hashtag': { uses: N, totalEngagement: N, totalReach: N, posts: [] } }

    // Scan all published posts for hashtag ↔ engagement correlation
    state.posts.forEach(function (p) {
      if (p.status !== 'published') return;
      var tags = (p.hashtags || []).map(function (h) { return h.toLowerCase(); });
      if (tags.length === 0) return;

      // Calculate total engagement for this post
      var eng = 0;
      var reach = 0;
      var results = p.publishResults || {};
      Object.keys(results).forEach(function (plat) {
        var m = (results[plat] || {}).metrics || {};
        eng += (m.likes || 0) + (m.comments || 0) * 2 + (m.shares || 0) * 3;
        reach += m.reach || m.post_reach || 0;
      });

      // Attribute engagement to each hashtag (shared equally)
      var share = tags.length > 0 ? eng / tags.length : 0;
      var reachShare = tags.length > 0 ? reach / tags.length : 0;

      tags.forEach(function (tag) {
        if (!scores[tag]) scores[tag] = { uses: 0, totalEngagement: 0, totalReach: 0 };
        scores[tag].uses++;
        scores[tag].totalEngagement += share;
        scores[tag].totalReach += reachShare;
      });
    });

    // Calculate averages
    Object.keys(scores).forEach(function (tag) {
      var s = scores[tag];
      s.avgEngagement = s.uses > 0 ? s.totalEngagement / s.uses : 0;
      s.avgReach = s.uses > 0 ? s.totalReach / s.uses : 0;
    });

    state.hashtagScores = scores;

    // Also calculate average engagement per hashtag set
    state.hashtagSets.forEach(function (set) {
      var setTags = (set.hashtags || []).map(function (h) { return h.toLowerCase(); });
      var totalAvg = 0;
      var counted = 0;
      setTags.forEach(function (tag) {
        if (scores[tag]) { totalAvg += scores[tag].avgEngagement; counted++; }
      });
      set._avgEngagement = counted > 0 ? totalAvg / counted : 0;
    });

    renderHashtagLeaderboard();
  }

  function renderHashtagLeaderboard() {
    var board = $('yb-social-hashtag-leaderboard');
    if (!board) return;

    var scores = state.hashtagScores || {};
    var sorted = Object.keys(scores)
      .filter(function (tag) { return scores[tag].uses >= 2; }) // at least 2 uses
      .sort(function (a, b) { return scores[b].avgEngagement - scores[a].avgEngagement; })
      .slice(0, 15);

    if (sorted.length === 0) {
      board.innerHTML = '<p class="yb-admin__muted">' + t('social_hashtag_no_data') + '</p>';
      return;
    }

    var maxEng = scores[sorted[0]].avgEngagement || 1;

    board.innerHTML = sorted.map(function (tag, i) {
      var s = scores[tag];
      var pct = Math.round((s.avgEngagement / maxEng) * 100);
      var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
      return '<div class="yb-social__hashtag-rank">' +
        '<span class="yb-social__hashtag-rank-pos">' + (medal || (i + 1)) + '</span>' +
        '<span class="yb-social__hashtag-rank-tag">' + tag + '</span>' +
        '<div class="yb-social__hashtag-rank-bar"><div style="width:' + pct + '%"></div></div>' +
        '<span class="yb-social__hashtag-rank-stats">' +
        s.avgEngagement.toFixed(1) + ' avg · ' + s.uses + ' ' + t('social_posts_title').toLowerCase() +
        '</span></div>';
    }).join('');

    // Expose top hashtags for composer auto-suggest
    window._ybTopHashtags = sorted.slice(0, 10);
  }

  function showHashtagForm(id) {
    var form = $('yb-social-hashtag-form');
    if (!form) return;
    form.hidden = false;
    state.editingHashtagId = id || null;

    if (id) {
      var set = state.hashtagSets.find(function (s) { return s.id === id; });
      if (set) {
        $('yb-social-hs-name').value = set.name || '';
        $('yb-social-hs-tags').value = (set.hashtags || []).join(', ');
      }
    } else {
      $('yb-social-hs-name').value = '';
      $('yb-social-hs-tags').value = '';
    }
  }

  async function saveHashtagSet() {
    var name = ($('yb-social-hs-name') || {}).value || '';
    var tagsRaw = ($('yb-social-hs-tags') || {}).value || '';
    if (!name.trim()) { toast('Enter a set name', true); return; }

    var hashtags = tagsRaw.split(/[,\n]+/).map(function (h) {
      h = h.trim();
      if (h && !h.startsWith('#')) h = '#' + h;
      return h;
    }).filter(Boolean);

    var db = firebase.firestore();
    var data = { name: name.trim(), hashtags: hashtags, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    if (state.editingHashtagId) {
      await db.collection('social_hashtag_sets').doc(state.editingHashtagId).update(data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.timesUsed = 0;
      await db.collection('social_hashtag_sets').add(data);
    }

    $('yb-social-hashtag-form').hidden = true;
    state.editingHashtagId = null;
    toast(t('social_saved'));
    loadHashtags();
    // Refresh composer hashtag dropdown if open
    if (window._ybSocialRefreshHashtagDropdown) window._ybSocialRefreshHashtagDropdown();
  }

  async function deleteHashtagSet(id) {
    if (!confirm('Delete this hashtag set?')) return;
    var db = firebase.firestore();
    await db.collection('social_hashtag_sets').doc(id).delete();
    toast('Deleted');
    loadHashtags();
  }

  /* ═══ BRAND PRESETS (Story/Reel quick-starts) ═══ */
  var BRAND_PRESETS = [
    {
      id: 'story-quote',
      name: 'Inspirational Quote',
      icon: '✨',
      type: 'stories',
      platforms: ['instagram', 'facebook'],
      caption: '✨ "The body is your temple. Keep it pure and clean for the soul to reside in." — B.K.S. Iyengar\n\n#yogaquote #yogainspiration #yogabible',
      hashtags: ['#yogaquote', '#yogainspiration', '#yogabible', '#mindfulness'],
      desc_da: 'Inspirerende citat med Yoga Bible-branding',
      desc_en: 'Inspirational yoga quote with brand overlay'
    },
    {
      id: 'reel-tip',
      name: 'Quick Yoga Tip',
      icon: '💡',
      type: 'reels',
      platforms: ['instagram', 'tiktok'],
      caption: '💡 Quick tip: {tip}\n\nSave this for your next practice! 🧘\n\n#yogatip #yogateacher #yogapractice',
      hashtags: ['#yogatip', '#yogateacher', '#yogapractice', '#yogabible'],
      desc_da: 'Hurtigt yogatip som reel — gem og del',
      desc_en: 'Quick yoga tip reel — save and share'
    },
    {
      id: 'story-poll',
      name: 'Community Poll',
      icon: '📊',
      type: 'stories',
      platforms: ['instagram'],
      caption: '📊 Quick poll!\n\n{question}\n\nA) {option_a}\nB) {option_b}\n\nComment below! 👇',
      hashtags: ['#yogacommunity', '#yogabible', '#yogapoll'],
      desc_da: 'Afstemning til Stories — øger engagement',
      desc_en: 'Story poll — boosts engagement'
    },
    {
      id: 'reel-transformation',
      name: 'Before/After',
      icon: '🔄',
      type: 'reels',
      platforms: ['instagram', 'tiktok', 'facebook'],
      caption: '🔄 Day 1 vs Now\n\nProgress is not about perfection — it\'s about consistency.\n\nWhat pose has changed the most in your practice? Tell us below 👇\n\n#yogaprogress #yogajourney',
      hashtags: ['#yogaprogress', '#yogajourney', '#yogabible', '#yogainspiration'],
      desc_da: 'Før/efter transformation reel',
      desc_en: 'Before/after transformation reel'
    },
    {
      id: 'story-countdown',
      name: 'Event Countdown',
      icon: '⏰',
      type: 'stories',
      platforms: ['instagram', 'facebook'],
      caption: '⏰ {days} days until {event}!\n\nSpots are limited — link in bio to secure yours 🔗\n\n#yogateachertraining #yogabible',
      hashtags: ['#yogateachertraining', '#yogabible', '#ytt', '#yoga200hr'],
      desc_da: 'Nedtælling til event/kursusstart',
      desc_en: 'Countdown to event/course start'
    },
    {
      id: 'reel-routine',
      name: 'Morning Routine',
      icon: '🌅',
      type: 'reels',
      platforms: ['instagram', 'tiktok'],
      caption: '🌅 5-minute morning yoga routine\n\n1. Cat-Cow (30s)\n2. Downward Dog (30s)\n3. Low Lunge each side (1min)\n4. Forward Fold (30s)\n5. Mountain Pose + breathe (30s)\n\nTry it tomorrow morning! ☀️\n\n#morningyoga #yogaroutine',
      hashtags: ['#morningyoga', '#yogaroutine', '#yogabible', '#yogaeveryday'],
      desc_da: 'Morgenrutine reel — 5 minutter',
      desc_en: '5-minute morning routine reel'
    }
  ];

  function renderBrandPresets() {
    var grid = $('yb-social-presets-grid');
    if (!grid) return;

    var isDa = window.location.pathname.indexOf('/en/') < 0;

    grid.innerHTML = BRAND_PRESETS.map(function (preset) {
      var desc = isDa ? (preset.desc_da || preset.desc_en) : preset.desc_en;
      var typeBadge = preset.type === 'reels'
        ? '<span class="yb-social__preset-type yb-social__preset-type--reel">Reel</span>'
        : '<span class="yb-social__preset-type yb-social__preset-type--story">Story</span>';

      return '<div class="yb-social__preset-card" data-action="social-use-preset" data-preset="' + preset.id + '">' +
        '<div class="yb-social__preset-icon">' + preset.icon + '</div>' +
        '<div class="yb-social__preset-info">' +
        '<h4>' + preset.name + ' ' + typeBadge + '</h4>' +
        '<p>' + desc + '</p>' +
        '<div class="yb-social__preset-platforms">' + preset.platforms.map(platformIcon).join('') + '</div>' +
        '</div></div>';
    }).join('');
  }

  function usePreset(presetId) {
    var preset = BRAND_PRESETS.find(function (p) { return p.id === presetId; });
    if (!preset || !window.openSocialComposer) return;

    // Open composer, then pre-fill
    window.openSocialComposer(null);

    // Wait for DOM to be ready
    setTimeout(function () {
      var captionEl = $('yb-social-caption');
      if (captionEl) captionEl.value = preset.caption;

      var hashtagsEl = $('yb-social-hashtags');
      if (hashtagsEl) hashtagsEl.value = preset.hashtags.join(', ');

      // Select matching platforms
      document.querySelectorAll('.yb-social__composer-platforms input').forEach(function (cb) {
        cb.checked = preset.platforms.indexOf(cb.value) >= 0;
      });

      // Set media type
      var typeRadio = document.querySelector('input[name="social-media-type"][value="' + preset.type + '"]');
      if (typeRadio) typeRadio.checked = true;
    }, 100);

    toast(t('social_preset_applied') || 'Preset applied — customize and publish!');
  }

  /* ═══ CONTENT TEMPLATES ═══ */

  async function loadTemplates() {
    renderBrandPresets();
    var el = $('yb-social-templates-list');
    if (!el) return;
    el.innerHTML = '<p class="yb-admin__muted">' + t('social_loading') + '</p>';

    var db = firebase.firestore();
    var snap = await db.collection('social_templates').orderBy('createdAt', 'desc').get();
    state.templates = [];
    snap.forEach(function (doc) { state.templates.push(Object.assign({ id: doc.id }, doc.data())); });
    renderTemplates();
  }

  function renderTemplates() {
    var el = $('yb-social-templates-list');
    if (!el) return;
    if (state.templates.length === 0) {
      el.innerHTML = '<p class="yb-admin__muted">' + t('social_no_templates') + '</p>';
      return;
    }

    var html = '';
    state.templates.forEach(function (tpl) {
      var platforms = (tpl.platforms || []).join(', ') || '—';
      var caption = (tpl.caption || '').substring(0, 100);
      if ((tpl.caption || '').length > 100) caption += '...';
      var hashtags = (tpl.hashtagSetName || '');
      html += '<div class="yb-social__template-card">' +
        '<div class="yb-social__template-header">' +
        '<strong>' + escapeHtml(tpl.name) + '</strong>' +
        '<div style="display:flex;gap:6px">' +
        '<button type="button" class="yb-btn yb-btn--primary yb-btn--sm" data-action="social-template-use" data-id="' + tpl.id + '">' + t('social_template_use') + '</button>' +
        '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-template-delete" data-id="' + tpl.id + '" style="color:#c00">&times;</button>' +
        '</div>' +
        '</div>' +
        '<p class="yb-social__template-caption">' + escapeHtml(caption) + '</p>' +
        '<div class="yb-social__template-meta">' +
        '<span>' + platforms + '</span>' +
        (hashtags ? '<span>&#35; ' + escapeHtml(hashtags) + '</span>' : '') +
        '</div>' +
        '</div>';
    });
    el.innerHTML = html;
  }

  function createTemplate() {
    var name = prompt(t('social_template_name') + ':', '');
    if (!name || !name.trim()) return;
    saveCurrentAsTemplate(name.trim());
  }

  async function saveAsTemplate() {
    var name = prompt(t('social_template_name') + ':', '');
    if (!name || !name.trim()) return;
    saveCurrentAsTemplate(name.trim());
  }

  async function saveCurrentAsTemplate(name) {
    // Read composer state — bridge to composer
    var caption = ($('yb-social-caption') || {}).value || '';
    var platforms = [];
    qsa('#yb-social-composer-platforms input[name="platform"]:checked').forEach(function (cb) {
      platforms.push(cb.value);
    });

    if (!caption.trim()) { toast('Write a caption first', true); return; }

    var db = firebase.firestore();
    await db.collection('social_templates').add({
      name: name,
      caption: caption,
      platforms: platforms,
      hashtagSetName: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    toast(t('social_template_saved'));
    if (state.view === 'templates') loadTemplates();
  }

  function useTemplate(id) {
    var tpl = state.templates.find(function (t) { return t.id === id; });
    if (!tpl) return;

    // Open composer with template data
    if (window.openSocialComposer) {
      window.openSocialComposer(null);
      // Short delay to let composer open
      setTimeout(function () {
        var captionEl = $('yb-social-caption');
        if (captionEl) captionEl.value = tpl.caption || '';
        // Check platforms
        (tpl.platforms || []).forEach(function (p) {
          var cb = document.querySelector('#yb-social-composer-platforms input[value="' + p + '"]');
          if (cb) cb.checked = true;
        });
      }, 100);
    }
  }

  async function deleteTemplate(id) {
    if (!confirm(t('social_template_confirm_delete'))) return;
    var db = firebase.firestore();
    await db.collection('social_templates').doc(id).delete();
    toast('Deleted');
    loadTemplates();
  }

  /* ═══ COMPETITORS ═══ */

  async function loadCompetitors() {
    var el = $('yb-social-competitors-list');
    if (!el) return;
    el.innerHTML = '<p class="yb-admin__muted">' + t('social_loading') + '</p>';

    var data = await api('social-competitors?action=list');
    if (!data) return;
    state.competitors = data.competitors || [];
    renderCompetitors();
  }

  function renderCompetitors() {
    var el = $('yb-social-competitors-list');
    if (!el) return;
    var comps = state.competitors;

    if (comps.length === 0) {
      el.innerHTML = '<p class="yb-admin__muted">' + t('social_no_competitors') + '</p>';
      var cmp = $('yb-social-competitors-comparison');
      if (cmp) cmp.hidden = true;
      return;
    }

    var platformColors = { instagram: '#E1306C', facebook: '#1877F2', tiktok: '#000000', linkedin: '#0A66C2' };
    var html = '';
    comps.forEach(function (c) {
      var color = platformColors[c.platform] || '#888';
      html += '<div class="yb-social__competitor-card">' +
        '<div class="yb-social__competitor-header">' +
        (c.profilePicture ? '<img src="' + c.profilePicture + '" class="yb-social__competitor-avatar" alt="">' : '<div class="yb-social__competitor-avatar-placeholder" style="background:' + color + '">' + (c.handle || '?').charAt(0).toUpperCase() + '</div>') +
        '<div>' +
        '<strong>' + escapeHtml(c.name) + '</strong>' +
        '<span class="yb-social__competitor-handle" style="color:' + color + '">@' + escapeHtml(c.handle) + ' · ' + c.platform + '</span>' +
        '</div>' +
        '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-competitors-remove" data-id="' + c.id + '" style="margin-left:auto" title="Remove">&times;</button>' +
        '</div>' +
        '<div class="yb-social__competitor-stats">' +
        '<div class="yb-social__competitor-stat"><span class="yb-social__competitor-stat-val">' + fmtNum(c.followerCount) + '</span><span class="yb-social__competitor-stat-label">' + t('social_stat_followers') + '</span></div>' +
        '<div class="yb-social__competitor-stat"><span class="yb-social__competitor-stat-val">' + fmtNum(c.postCount) + '</span><span class="yb-social__competitor-stat-label">' + t('social_stat_posts') + '</span></div>' +
        '<div class="yb-social__competitor-stat"><span class="yb-social__competitor-stat-val">' + (c.engagementRate || 0).toFixed(1) + '%</span><span class="yb-social__competitor-stat-label">' + t('social_stat_engagement') + '</span></div>' +
        '<div class="yb-social__competitor-stat"><span class="yb-social__competitor-stat-val">' + fmtNum(c.avgLikes) + '</span><span class="yb-social__competitor-stat-label">' + t('social_stat_avg_likes') + '</span></div>' +
        '</div>' +
        (c.lastRefreshed ? '<div class="yb-social__competitor-meta">' + t('social_last_refreshed') + ': ' + fmtDateTime(c.lastRefreshed) + '</div>' : '') +
        '</div>';
    });
    el.innerHTML = html;

    // Show comparison if 2+
    var cmp = $('yb-social-competitors-comparison');
    if (cmp && comps.length >= 2) {
      cmp.hidden = false;
      renderCompetitorComparison();
    }
  }

  function renderCompetitorComparison() {
    var el = $('yb-social-competitors-chart');
    if (!el || state.competitors.length < 2) return;

    var comps = state.competitors;
    var maxFollowers = Math.max.apply(null, comps.map(function (c) { return c.followerCount || 1; }));
    var platformColors = { instagram: '#E1306C', facebook: '#1877F2', tiktok: '#000000', linkedin: '#0A66C2' };

    var html = '<div class="yb-social__comp-bars">';
    comps.forEach(function (c) {
      var pct = Math.round(((c.followerCount || 0) / maxFollowers) * 100);
      var color = platformColors[c.platform] || '#888';
      html += '<div class="yb-social__comp-bar-row">' +
        '<span class="yb-social__comp-bar-label">' + escapeHtml(c.name) + '</span>' +
        '<div class="yb-social__comp-bar-track"><div class="yb-social__comp-bar-fill" style="width:' + pct + '%;background:' + color + '">' + fmtNum(c.followerCount) + '</div></div>' +
        '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function fmtNum(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  async function addCompetitorDirect(handle, platform, name) {
    var data = await api('social-competitors', {
      method: 'POST',
      body: JSON.stringify({ action: 'add', platform: platform || 'instagram', handle: handle, name: name || handle })
    });
    if (data) loadCompetitors();
  }

  async function addCompetitor() {
    var platform = ($('yb-social-comp-platform') || {}).value;
    var handle = ($('yb-social-comp-handle') || {}).value || '';
    var name = ($('yb-social-comp-name') || {}).value || '';

    if (!handle.trim()) { toast('Enter a handle', true); return; }

    toast('Adding...');
    var data = await api('social-competitors', {
      method: 'POST',
      body: JSON.stringify({ action: 'add', platform: platform, handle: handle.trim(), name: name.trim() || handle.trim() })
    });

    if (data) {
      toast(t('social_saved'));
      $('yb-social-competitor-form').hidden = true;
      if ($('yb-social-comp-handle')) $('yb-social-comp-handle').value = '';
      if ($('yb-social-comp-name')) $('yb-social-comp-name').value = '';
      loadCompetitors();
    }
  }

  async function removeCompetitor(id) {
    if (!confirm(t('social_comp_confirm_remove'))) return;
    var data = await api('social-competitors', {
      method: 'POST',
      body: JSON.stringify({ action: 'remove', id: id })
    });
    if (data) { toast('Removed'); loadCompetitors(); }
  }

  async function refreshCompetitors() {
    toast('Refreshing...');
    await api('social-competitors', { method: 'POST', body: JSON.stringify({ action: 'refresh' }) });
    loadCompetitors();
  }

  async function aiSuggestCompetitors() {
    // Show options modal first
    var existing = document.getElementById('yb-social-ai-competitor-modal');
    if (existing) existing.remove();

    var html = '<div class="yb-social__connect-modal" id="yb-social-ai-competitor-modal">' +
      '<div class="yb-social__connect-overlay" data-action="social-ai-competitor-close"></div>' +
      '<div class="yb-social__connect-box" style="max-width:560px;max-height:85vh;overflow-y:auto">' +
      '<h3 style="margin:0 0 14px;font-size:16px">AI Competitor Finder</h3>' +
      '<div class="yb-social__ai-comp-options">' +
      '<div><label>Business Category</label>' +
      '<div class="yb-social__ai-comp-chips" id="yb-ai-comp-cats">' +
      ['Yoga Teacher Training', 'Yoga Studios', 'Yoga Classes', 'Yoga Courses', 'Wellness & Retreats', 'Fitness Studios', 'Online Yoga'].map(function (c) {
        return '<button class="yb-social__ai-comp-chip" data-action="social-ai-comp-cat">' + c + '</button>';
      }).join('') + '</div></div>' +
      '<div><label>Platform</label>' +
      '<select id="yb-ai-comp-platform"><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="youtube">YouTube</option></select></div>' +
      '<div><label>Location</label>' +
      '<input type="text" id="yb-ai-comp-location" placeholder="e.g. Copenhagen, Denmark" value="Copenhagen, Denmark"></div>' +
      '<div><label>Scope</label>' +
      '<div class="yb-social__ai-comp-chips" id="yb-ai-comp-scope">' +
      ['Local', 'National', 'International'].map(function (s) {
        return '<button class="yb-social__ai-comp-chip' + (s === 'Local' ? ' is-active' : '') + '" data-action="social-ai-comp-scope">' + s + '</button>';
      }).join('') + '</div></div></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-ai-competitor-close">Cancel</button>' +
      '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="social-ai-competitor-search" id="yb-ai-comp-search-btn">Find Competitors</button>' +
      '</div><div id="yb-ai-comp-results"></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function aiCompetitorSearch() {
    var catEls = qsa('#yb-ai-comp-cats .is-active');
    var categories = [];
    catEls.forEach(function (el) { categories.push(el.textContent); });
    var scopeEl = document.querySelector('#yb-ai-comp-scope .is-active');
    var scope = scopeEl ? scopeEl.textContent.toLowerCase() : 'local';
    var platform = ($('yb-ai-comp-platform') || {}).value || 'instagram';
    var location = ($('yb-ai-comp-location') || {}).value || 'Copenhagen, Denmark';

    var btn = $('yb-ai-comp-search-btn');
    setLoading(btn, true, 'Searching...');

    var resultsEl = $('yb-ai-comp-results');
    if (resultsEl) resultsEl.innerHTML = '<p class="yb-admin__muted" style="text-align:center;padding:16px">Analyzing competitors with AI...</p>';

    var data = await api('social-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'suggest-competitors',
        platform: platform,
        categories: categories.length ? categories : ['Yoga Teacher Training', 'Yoga Studios'],
        location: location,
        scope: scope,
        currentCompetitors: state.competitors
      })
    });

    setLoading(btn, false);

    if (!data || !data.suggestions) {
      if (resultsEl) resultsEl.innerHTML = '<p class="yb-admin__muted" style="text-align:center;padding:12px">No results found. Try different options.</p>';
      return;
    }

    var cats = { direct_competitor: 'Direct Competitors', aspirational: 'Aspirational', content_inspiration: 'Content Inspiration', local: 'Local' };
    var grouped = {};
    data.suggestions.forEach(function (s) {
      var cat = s.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(s);
    });

    var rhtml = '';
    Object.keys(cats).forEach(function (cat) {
      if (!grouped[cat]) return;
      rhtml += '<h4 style="margin:14px 0 6px;font-size:13px;font-weight:700;color:#f75c03">' + cats[cat] + '</h4>';
      grouped[cat].forEach(function (s) {
        rhtml += '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #E8E4E0">' +
          '<div style="flex:1;min-width:0"><strong style="font-size:12px">@' + escapeHtml(s.handle) + '</strong>' +
          (s.name ? ' <span style="font-size:11px;color:#6F6A66">' + escapeHtml(s.name) + '</span>' : '') +
          '<br><span style="font-size:11px;color:#6F6A66">' + escapeHtml(s.reason) + '</span></div>' +
          '<button class="yb-btn yb-btn--primary yb-btn--xs" data-action="social-ai-competitor-add" data-handle="' + escapeHtml(s.handle) + '" data-platform="' + (s.platform || platform) + '" data-name="' + escapeHtml(s.name || '') + '">+ Add</button>' +
          '</div>';
      });
    });
    if (resultsEl) resultsEl.innerHTML = rhtml;
  }

  async function aiCompetitorContentStrategy() {
    if (state.competitors.length === 0) { toast('Add competitors first', true); return; }
    var stratBtn = document.querySelector('[data-action="social-ai-content-strategy"]');
    setLoading(stratBtn, true, 'Analyzing...');

    var data = await api('social-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'competitor-content-strategy',
        competitors: state.competitors
      })
    });
    setLoading(stratBtn, false);
    if (!data) return;

    var existing = document.getElementById('yb-social-ai-strategy-modal');
    if (existing) existing.remove();

    var a = data.analysis || {};
    var ideas = data.post_ideas || [];

    var html = '<div class="yb-social__connect-modal" id="yb-social-ai-strategy-modal">' +
      '<div class="yb-social__connect-overlay" data-action="social-ai-strategy-close"></div>' +
      '<div class="yb-social__connect-box" style="max-width:640px;max-height:80vh;overflow-y:auto">' +
      '<h3>📊 AI Content Strategy</h3>';

    if (a.competitive_position) {
      html += '<p style="background:var(--yb-light);padding:.75rem;border-radius:8px;margin-bottom:1rem">' + escapeHtml(a.competitive_position) + '</p>';
    }

    if (a.content_gaps && a.content_gaps.length) {
      html += '<h4 style="color:var(--yb-brand)">Content Gaps</h4><ul>';
      a.content_gaps.forEach(function (g) { html += '<li>' + escapeHtml(g) + '</li>'; });
      html += '</ul>';
    }
    if (a.trend_opportunities && a.trend_opportunities.length) {
      html += '<h4 style="color:var(--yb-brand)">Trend Opportunities</h4><ul>';
      a.trend_opportunities.forEach(function (t) { html += '<li>' + escapeHtml(t) + '</li>'; });
      html += '</ul>';
    }
    if (a.differentiation_angles && a.differentiation_angles.length) {
      html += '<h4 style="color:var(--yb-brand)">Differentiation</h4><ul>';
      a.differentiation_angles.forEach(function (d) { html += '<li>' + escapeHtml(d) + '</li>'; });
      html += '</ul>';
    }
    if (a.posting_recommendations) {
      var pr = a.posting_recommendations;
      html += '<h4 style="color:var(--yb-brand)">Posting Strategy</h4>' +
        '<p>' + escapeHtml(pr.frequency || '') + '. Best formats: ' + (pr.best_formats || []).join(', ') + '</p>' +
        (pr.timing_notes ? '<p style="color:var(--yb-muted);font-size:.85rem">' + escapeHtml(pr.timing_notes) + '</p>' : '');
    }

    if (ideas.length) {
      html += '<h4 style="color:var(--yb-brand);margin-top:1rem">Post Ideas</h4>';
      ideas.forEach(function (idea, i) {
        html += '<div style="background:var(--yb-light);padding:.75rem;border-radius:8px;margin-bottom:.5rem">' +
          '<strong>' + (i + 1) + '. ' + escapeHtml(idea.concept) + '</strong>' +
          '<span style="background:var(--yb-brand);color:#fff;font-size:.7rem;padding:2px 6px;border-radius:4px;margin-left:.5rem">' + (idea.format || '') + '</span>' +
          '<p style="font-size:.85rem;margin:.25rem 0">"' + escapeHtml(idea.caption_hook || '') + '"</p>' +
          '<span style="font-size:.75rem;color:var(--yb-muted)">Inspired by: ' + escapeHtml(idea.inspired_by || '') + '</span>' +
          '</div>';
      });
    }

    html += '<div style="margin-top:1rem;text-align:right"><button class="yb-btn yb-btn--outline" data-action="social-ai-strategy-close">Close</button></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  /* ═══ A/B TESTING ═══ */

  async function loadAbTests() {
    var el = $('yb-social-ab-list');
    if (!el) return;
    el.innerHTML = '<p class="yb-admin__muted">' + t('social_loading') + '</p>';

    var filter = state.abTestFilter;
    var url = 'social-ab-tests?action=list' + (filter !== 'all' ? '&status=' + filter : '');
    var data = await api(url);
    if (!data) return;
    state.abTests = data.tests || [];
    renderAbTests();
  }

  function renderAbTests() {
    var el = $('yb-social-ab-list');
    if (!el) return;
    var tests = state.abTests;

    if (tests.length === 0) {
      el.innerHTML = '<p class="yb-admin__muted">' + t('social_no_ab_tests') + '</p>';
      return;
    }

    var platformColors = { instagram: '#E1306C', facebook: '#1877F2', tiktok: '#000000', linkedin: '#0A66C2' };
    var html = '';
    tests.forEach(function (test) {
      var color = platformColors[test.platform] || '#888';
      var statusClass = test.status === 'completed' ? 'yb-social__ab-status--completed' : 'yb-social__ab-status--active';
      html += '<div class="yb-social__ab-card" data-action="social-ab-detail" data-id="' + test.id + '">' +
        '<div class="yb-social__ab-card-header">' +
        '<strong>' + escapeHtml(test.name) + '</strong>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
        '<span class="yb-social__ab-platform" style="color:' + color + '">' + test.platform + '</span>' +
        '<span class="yb-social__ab-status ' + statusClass + '">' + test.status + '</span>' +
        '</div>' +
        '</div>' +
        '<div class="yb-social__ab-card-meta">' +
        '<span>' + test.variantCount + ' variants</span>' +
        '<span>' + t('social_stat_engagement') + ': ' + fmtNum(test.totalEngagement) + '</span>' +
        (test.winnerIndex !== null ? '<span class="yb-social__ab-winner-badge">&#9733; Winner: Variant ' + String.fromCharCode(65 + test.winnerIndex) + '</span>' : '') +
        '</div>' +
        '<div class="yb-social__ab-card-date">' + fmtDate(test.createdAt) + '</div>' +
        '</div>';
    });
    el.innerHTML = html;
  }

  function showAbCreateModal() {
    var modal = $('yb-social-ab-modal');
    if (!modal) return;
    var title = $('yb-social-ab-modal-title');
    if (title) title.textContent = t('social_ab_new');

    var body = $('yb-social-ab-modal-body');
    body.innerHTML = '<div class="yb-social__ab-create-form">' +
      '<div class="yb-admin__field">' +
      '<label>' + t('social_ab_test_name') + '</label>' +
      '<input type="text" id="yb-social-ab-name" placeholder="' + t('social_ab_name_placeholder') + '">' +
      '</div>' +
      '<div class="yb-admin__field">' +
      '<label>' + t('social_col_platform') + '</label>' +
      '<select id="yb-social-ab-platform"><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option></select>' +
      '</div>' +
      '<div class="yb-admin__field">' +
      '<label>' + t('social_ab_notes') + '</label>' +
      '<input type="text" id="yb-social-ab-notes" placeholder="' + t('social_ab_notes_placeholder') + '">' +
      '</div>' +
      '<h4 style="margin:16px 0 8px">' + t('social_ab_variants') + '</h4>' +
      '<div id="yb-social-ab-variants">' +
      buildVariantField(0) +
      buildVariantField(1) +
      '</div>' +
      '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-ab-add-variant" style="margin:8px 0 16px">+ ' + t('social_ab_add_variant') + '</button>' +
      '<div class="yb-social__ab-form-actions">' +
      '<button type="button" class="yb-btn yb-btn--outline" data-action="social-ab-close">' + t('social_cancel') + '</button>' +
      '<button type="button" class="yb-btn yb-btn--primary" data-action="social-ab-save">' + t('social_ab_create_test') + '</button>' +
      '</div>' +
      '</div>';

    modal.hidden = false;
  }

  function buildVariantField(idx) {
    var letter = String.fromCharCode(65 + idx);
    return '<div class="yb-social__ab-variant-field" data-variant-idx="' + idx + '">' +
      '<div class="yb-social__ab-variant-label">Variant ' + letter + '</div>' +
      '<textarea rows="3" class="yb-social__ab-variant-caption" placeholder="' + t('social_ab_caption_placeholder') + '"></textarea>' +
      '</div>';
  }

  var abVariantCount = 2;

  function addAbVariant() {
    if (abVariantCount >= 5) { toast('Maximum 5 variants', true); return; }
    var container = $('yb-social-ab-variants');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', buildVariantField(abVariantCount));
    abVariantCount++;
  }

  async function saveAbTest() {
    var name = ($('yb-social-ab-name') || {}).value || '';
    var platform = ($('yb-social-ab-platform') || {}).value || 'instagram';
    var notes = ($('yb-social-ab-notes') || {}).value || '';

    if (!name.trim()) { toast('Enter a test name', true); return; }

    var fields = qsa('.yb-social__ab-variant-caption');
    var variants = [];
    fields.forEach(function (f, i) {
      var caption = f.value.trim();
      if (caption) variants.push({ label: 'Variant ' + String.fromCharCode(65 + i), caption: caption });
    });

    if (variants.length < 2) { toast('Need at least 2 variants with captions', true); return; }

    toast('Creating...');
    var data = await api('social-ab-tests', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: name.trim(), platform: platform, notes: notes, variants: variants })
    });

    if (data) {
      toast(t('social_saved'));
      closeAbModal();
      abVariantCount = 2;
      loadAbTests();
    }
  }

  async function showAbDetail(id) {
    var modal = $('yb-social-ab-modal');
    if (!modal) return;

    var data = await api('social-ab-tests?action=detail&id=' + id);
    if (!data || !data.test) return;

    var test = data.test;
    var title = $('yb-social-ab-modal-title');
    if (title) title.textContent = escapeHtml(test.name);

    var body = $('yb-social-ab-modal-body');
    var platformColors = { instagram: '#E1306C', facebook: '#1877F2', tiktok: '#000000', linkedin: '#0A66C2' };
    var color = platformColors[test.platform] || '#888';

    var html = '<div class="yb-social__ab-detail">';
    html += '<div class="yb-social__ab-detail-meta">' +
      '<span class="yb-social__ab-platform" style="color:' + color + '">' + test.platform + '</span>' +
      '<span class="yb-social__ab-status yb-social__ab-status--' + test.status + '">' + test.status + '</span>' +
      (test.notes ? '<span class="yb-admin__muted">' + escapeHtml(test.notes) + '</span>' : '') +
      '</div>';

    // Variant comparison
    html += '<div class="yb-social__ab-variants">';
    var maxEng = 1;
    test.variants.forEach(function (v) {
      var eng = (v.metrics.likes || 0) + (v.metrics.comments || 0) + (v.metrics.shares || 0);
      if (eng > maxEng) maxEng = eng;
    });

    test.variants.forEach(function (v) {
      var m = v.metrics;
      var eng = (m.likes || 0) + (m.comments || 0) + (m.shares || 0);
      var pct = Math.round((eng / maxEng) * 100);
      html += '<div class="yb-social__ab-variant-card' + (v.isWinner ? ' is-winner' : '') + '">' +
        '<div class="yb-social__ab-variant-card-header">' +
        '<strong>' + v.label + '</strong>' +
        (v.isWinner ? '<span class="yb-social__ab-winner-badge">&#9733; ' + t('social_ab_winner') + '</span>' : '') +
        '</div>' +
        '<p class="yb-social__ab-variant-caption-text">' + escapeHtml(v.caption).substring(0, 120) + (v.caption.length > 120 ? '...' : '') + '</p>' +
        '<div class="yb-social__ab-variant-metrics">' +
        '<span title="Likes">&#9829; ' + fmtNum(m.likes) + '</span>' +
        '<span title="Comments">&#128172; ' + fmtNum(m.comments) + '</span>' +
        '<span title="Shares">&#8634; ' + fmtNum(m.shares) + '</span>' +
        '<span title="Reach">&#128065; ' + fmtNum(m.reach) + '</span>' +
        '</div>' +
        '<div class="yb-social__ab-variant-bar"><div class="yb-social__ab-variant-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="yb-social__ab-variant-actions">' +
        '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-ab-update-metrics" data-test-id="' + id + '" data-variant="' + v.index + '">&#9998; ' + t('social_ab_update_metrics') + '</button>' +
        (test.status === 'active' ? '<button type="button" class="yb-btn yb-btn--primary yb-btn--sm" data-action="social-ab-declare-winner" data-test-id="' + id + '" data-variant="' + v.index + '">&#9733; ' + t('social_ab_declare_winner') + '</button>' : '') +
        '</div>' +
        '</div>';
    });
    html += '</div>';

    // Delete
    html += '<div style="margin-top:16px;text-align:right">' +
      '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" style="color:#c00" data-action="social-ab-delete" data-id="' + id + '">' + t('social_delete') + '</button>' +
      '</div>';

    html += '</div>';
    body.innerHTML = html;
    modal.hidden = false;
  }

  function showMetricsPrompt(testId, variantIndex) {
    var likes = prompt('Likes:', '0');
    if (likes === null) return;
    var comments = prompt('Comments:', '0');
    if (comments === null) return;
    var shares = prompt('Shares:', '0');
    if (shares === null) return;
    var reach = prompt('Reach:', '0');
    if (reach === null) return;

    api('social-ab-tests', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update-metrics',
        id: testId,
        variantIndex: parseInt(variantIndex),
        metrics: { likes: parseInt(likes) || 0, comments: parseInt(comments) || 0, shares: parseInt(shares) || 0, reach: parseInt(reach) || 0 }
      })
    }).then(function (data) {
      if (data) { toast(t('social_saved')); showAbDetail(testId); }
    });
  }

  async function declareWinner(testId, variantIndex) {
    if (!confirm(t('social_ab_confirm_winner'))) return;
    var data = await api('social-ab-tests', {
      method: 'POST',
      body: JSON.stringify({ action: 'declare-winner', id: testId, winnerIndex: parseInt(variantIndex) })
    });
    if (data) { toast('Winner declared!'); showAbDetail(testId); loadAbTests(); }
  }

  async function deleteAbTest(id) {
    if (!confirm(t('social_confirm_delete_post'))) return;
    var data = await api('social-ab-tests', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id: id })
    });
    if (data) { toast('Deleted'); closeAbModal(); loadAbTests(); }
  }

  function closeAbModal() {
    var modal = $('yb-social-ab-modal');
    if (modal) modal.hidden = true;
  }

  /* ═══ SAVED REPLIES ═══ */
  var savedRepliesState = { replies: [], loaded: false };

  async function loadSavedReplies() {
    var data = await api('social-saved-replies?action=list');
    if (data) {
      savedRepliesState.replies = data.replies || [];
      savedRepliesState.loaded = true;
    }
  }

  function renderSavedRepliesDropdown(ddEl) {
    var container = ddEl || $('yb-social-saved-replies-dropdown');
    if (!container) return;

    if (!savedRepliesState.loaded) {
      loadSavedReplies().then(renderSavedRepliesDropdown);
      return;
    }

    if (savedRepliesState.replies.length === 0) {
      container.innerHTML = '<p class="yb-admin__muted">No saved replies yet</p>';
      return;
    }

    container.innerHTML = savedRepliesState.replies.map(function (r) {
      return '<button type="button" class="yb-social__saved-reply-item" data-action="social-use-saved-reply" data-id="' + r.id + '">' +
        '<span class="yb-social__saved-reply-name">' + escapeHtml(r.name) + '</span>' +
        '<span class="yb-social__saved-reply-preview">' + escapeHtml(truncate(r.text, 60)) + '</span>' +
        (r.shortcut ? '<span class="yb-social__saved-reply-shortcut">/' + r.shortcut + '</span>' : '') +
      '</button>';
    }).join('');
  }

  function useSavedReply(id, panelId) {
    var reply = savedRepliesState.replies.find(function (r) { return r.id === id; });
    if (!reply) return;

    var pid = panelId || (inboxState.activeThread ? inboxState.activeThread.panelId : null);
    var replyEl = pid ? getReplyElForPanel(pid) : null;
    if (replyEl) {
      replyEl.value = reply.text;
      replyEl.focus();
    }

    api('social-saved-replies', {
      method: 'POST',
      body: JSON.stringify({ action: 'update', id: id, incrementUsage: true })
    });

    // Hide dropdown in the panel
    if (pid) {
      var panel = document.getElementById(pid);
      var dd = panel ? panel.querySelector('.yb-social__saved-replies-dropdown') : null;
      if (dd) dd.hidden = true;
    }
  }

  function toggleSavedRepliesDropdown(panelId) {
    var pid = panelId || (inboxState.activeThread ? inboxState.activeThread.panelId : null);
    if (!pid) return;
    var panel = document.getElementById(pid);
    var dd = panel ? panel.querySelector('.yb-social__saved-replies-dropdown') : null;
    if (!dd) return;
    dd.hidden = !dd.hidden;
    if (!dd.hidden) renderSavedRepliesDropdown(dd);
  }

  async function saveCurrentReplyAsTemplate(panelId) {
    var pid = panelId || (inboxState.activeThread ? inboxState.activeThread.panelId : null);
    var replyEl = pid ? getReplyElForPanel(pid) : null;
    if (!replyEl || !replyEl.value.trim()) { toast('Write a reply first', true); return; }

    var name = prompt('Name for this saved reply:');
    if (!name) return;

    var data = await api('social-saved-replies', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name: name, text: replyEl.value.trim() })
    });

    if (data) {
      toast('Reply saved as template');
      savedRepliesState.loaded = false; // Force reload
    }
  }

  /* ═══ CONTENT LIBRARY ═══ */
  var libraryState = { assets: [], collections: [], tags: [], search: '', activeTag: '', activeCollection: '' };

  async function loadContentLibrary() {
    var params = 'action=list';
    if (libraryState.activeTag) params += '&tag=' + encodeURIComponent(libraryState.activeTag);
    if (libraryState.activeCollection) params += '&collection=' + encodeURIComponent(libraryState.activeCollection);
    if (libraryState.search) params += '&search=' + encodeURIComponent(libraryState.search);

    var results = await Promise.all([
      api('social-content-library?' + params),
      api('social-content-library?action=collections')
    ]);

    if (results[0]) {
      libraryState.assets = results[0].assets || [];
      libraryState.tags = results[0].tags || [];
    }
    if (results[1]) {
      libraryState.collections = results[1].collections || [];
    }

    renderContentLibrary();
  }

  function renderContentLibrary() {
    // Tag cloud
    var tagCloud = $('yb-social-library-tags');
    if (tagCloud) {
      tagCloud.innerHTML = libraryState.tags.slice(0, 30).map(function (t) {
        var active = libraryState.activeTag === t.tag ? ' is-active' : '';
        return '<button class="yb-social__library-tag' + active + '" data-action="social-library-filter-tag" data-tag="' + t.tag + '">' +
          t.tag + ' <span>(' + t.count + ')</span></button>';
      }).join('');
    }

    // Collections
    var collEl = $('yb-social-library-collections');
    if (collEl) {
      collEl.innerHTML = libraryState.collections.map(function (c) {
        var active = libraryState.activeCollection === c.id ? ' is-active' : '';
        return '<button class="yb-social__library-collection' + active + '" data-action="social-library-filter-collection" data-id="' + c.id + '">' +
          escapeHtml(c.name) + ' <span>(' + (c.assetCount || 0) + ')</span></button>';
      }).join('') +
      '<button class="yb-social__library-collection yb-social__library-collection--add" data-action="social-library-new-collection">+ New</button>';
    }

    // Asset grid
    var grid = $('yb-social-library-grid');
    if (!grid) return;

    if (libraryState.assets.length === 0) {
      grid.innerHTML = '<div class="yb-social__inbox-empty"><p>No tagged assets yet. Browse media in the composer and tag assets to see them here.</p></div>';
      return;
    }

    grid.innerHTML = libraryState.assets.map(function (a) {
      var isVideo = a.type === 'video';
      return '<div class="yb-social__library-item" data-action="social-library-edit-asset" data-url="' + a.url + '">' +
        (isVideo
          ? '<video src="' + a.url + '?width=300" class="yb-social__library-thumb"></video>'
          : '<img src="' + a.url + '?width=300" alt="' + escapeHtml(a.alt || '') + '" class="yb-social__library-thumb" loading="lazy">') +
        '<div class="yb-social__library-item-meta">' +
          (a.tags && a.tags.length > 0 ? '<div class="yb-social__library-item-tags">' + a.tags.slice(0, 4).map(function (t) {
            return '<span>' + t + '</span>';
          }).join('') + '</div>' : '') +
          (a.alt ? '<p class="yb-admin__muted">' + escapeHtml(truncate(a.alt, 40)) + '</p>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function showAssetEditor(url) {
    var asset = libraryState.assets.find(function (a) { return a.url === url; });
    var existing = document.getElementById('yb-social-asset-editor');
    if (existing) existing.remove();

    var tags = asset ? (asset.tags || []).join(', ') : '';
    var alt = asset ? (asset.alt || '') : '';
    var notes = asset ? (asset.notes || '') : '';

    var html = '<div class="yb-social__modal-overlay" id="yb-social-asset-editor">' +
      '<div class="yb-social__modal-box" style="max-width:500px">' +
      '<h3>Edit Asset</h3>' +
      '<div style="margin:10px 0"><img src="' + url + '?width=400" style="width:100%;border-radius:8px" alt=""></div>' +
      '<div class="yb-admin__field"><label>Tags (comma separated)</label>' +
      '<input type="text" id="yb-social-asset-tags" value="' + escapeHtml(tags) + '" placeholder="yoga, lifestyle, studio"></div>' +
      '<div class="yb-admin__field"><label>Alt Text</label>' +
      '<input type="text" id="yb-social-asset-alt" value="' + escapeHtml(alt) + '" placeholder="Descriptive alt text"></div>' +
      '<div class="yb-admin__field"><label>Notes</label>' +
      '<textarea id="yb-social-asset-notes" rows="2" placeholder="Internal notes...">' + escapeHtml(notes) + '</textarea></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="social-library-save-asset" data-url="' + url + '">Save</button>' +
      '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-library-close-editor">Cancel</button></div>' +
      '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function saveAssetMeta(url) {
    var tags = ($('yb-social-asset-tags') || {}).value || '';
    var alt = ($('yb-social-asset-alt') || {}).value || '';
    var notes = ($('yb-social-asset-notes') || {}).value || '';

    var tagArr = tags.split(/[,\n]+/).map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);

    var data = await api('social-content-library', {
      method: 'POST',
      body: JSON.stringify({ action: 'tag', url: url, tags: tagArr, alt: alt, notes: notes })
    });

    if (data) {
      toast('Asset saved');
      var editor = document.getElementById('yb-social-asset-editor');
      if (editor) editor.remove();
      loadContentLibrary();
    }
  }

  async function createLibraryCollection() {
    var name = prompt('Collection name:');
    if (!name) return;

    var data = await api('social-content-library', {
      method: 'POST',
      body: JSON.stringify({ action: 'create-collection', name: name })
    });

    if (data) { toast('Collection created'); loadContentLibrary(); }
  }

  /* ═══ VIDEO UPLOAD & EDITOR ═══ */
  var videoState = { videos: [], uploading: false, editorVideoId: null, editorTrim: { start: 0, end: 0 }, editorAspect: 'original', editorThumbTime: 0 };

  // ── Upload via TUS (chunked, resumable) ──
  async function startVideoUpload(file) {
    if (!file || videoState.uploading) return;
    videoState.uploading = true;

    var progressEl = $('yb-social-video-progress');
    var nameEl = $('yb-social-video-progress-name');
    var pctEl = $('yb-social-video-progress-pct');
    var fillEl = $('yb-social-video-progress-fill');
    var statusEl = $('yb-social-video-progress-status');
    if (progressEl) progressEl.hidden = false;
    if (nameEl) nameEl.textContent = file.name;
    if (statusEl) statusEl.textContent = 'Creating video entry...';

    // 1. Create video entry in Bunny Stream (get TUS credentials)
    var title = file.name.replace(/\.[^.]+$/, '');
    var data = await api('social-media-upload', {
      method: 'POST',
      body: JSON.stringify({ action: 'create-video', title: title })
    });

    if (!data || !data.videoId) {
      toast('Failed to create video', true);
      videoState.uploading = false;
      if (progressEl) progressEl.hidden = true;
      return;
    }

    if (statusEl) statusEl.textContent = 'Uploading... 0%';
    toast('Uploading ' + file.name + '...');

    // 2. Upload via TUS protocol directly to Bunny Stream
    try {
      await tusUpload(file, data, function (pct) {
        if (fillEl) fillEl.style.width = pct + '%';
        if (pctEl) pctEl.textContent = Math.round(pct) + '%';
        if (statusEl) statusEl.textContent = 'Uploading... ' + Math.round(pct) + '%';
      });

      if (statusEl) statusEl.textContent = 'Upload complete — encoding in progress';
      toast(file.name + ' uploaded — encoding will take 1-2 min');
      loadVideoLibrary();
    } catch (err) {
      toast('Upload failed: ' + err.message, true);
      if (statusEl) statusEl.textContent = 'Upload failed: ' + err.message;
    }

    videoState.uploading = false;

    // Auto-hide progress after 5s
    setTimeout(function () {
      if (progressEl) progressEl.hidden = true;
    }, 5000);
  }

  // TUS upload implementation (chunked, resumable)
  function tusUpload(file, creds, onProgress) {
    return new Promise(function (resolve, reject) {
      var chunkSize = 5 * 1024 * 1024; // 5MB chunks
      var offset = 0;
      var uploadUrl = '';

      // Step 1: Create TUS upload
      var createXhr = new XMLHttpRequest();
      createXhr.open('POST', creds.tusUploadUrl, true);
      createXhr.setRequestHeader('Tus-Resumable', '1.0.0');
      createXhr.setRequestHeader('Upload-Length', file.size.toString());
      createXhr.setRequestHeader('Upload-Metadata',
        'filetype ' + btoa(file.type) +
        ',title ' + btoa(file.name.replace(/\.[^.]+$/, ''))
      );
      createXhr.setRequestHeader('AuthorizationSignature', creds.authSignature);
      createXhr.setRequestHeader('AuthorizationExpire', creds.authExpiration.toString());
      createXhr.setRequestHeader('VideoId', creds.videoId);
      createXhr.setRequestHeader('LibraryId', creds.libraryId);

      createXhr.onload = function () {
        if (createXhr.status !== 201 && createXhr.status !== 200) {
          reject(new Error('TUS create failed: ' + createXhr.status));
          return;
        }
        uploadUrl = createXhr.getResponseHeader('Location');
        if (!uploadUrl) {
          reject(new Error('No upload URL returned'));
          return;
        }
        uploadNextChunk();
      };
      createXhr.onerror = function () { reject(new Error('Network error during TUS create')); };
      createXhr.send(null);

      // Step 2: Upload chunks
      function uploadNextChunk() {
        if (offset >= file.size) {
          onProgress(100);
          resolve();
          return;
        }

        var end = Math.min(offset + chunkSize, file.size);
        var chunk = file.slice(offset, end);

        var patchXhr = new XMLHttpRequest();
        patchXhr.open('PATCH', uploadUrl, true);
        patchXhr.setRequestHeader('Tus-Resumable', '1.0.0');
        patchXhr.setRequestHeader('Upload-Offset', offset.toString());
        patchXhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');

        patchXhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            var totalProgress = ((offset + e.loaded) / file.size) * 100;
            onProgress(totalProgress);
          }
        };

        patchXhr.onload = function () {
          if (patchXhr.status === 204 || patchXhr.status === 200) {
            var newOffset = parseInt(patchXhr.getResponseHeader('Upload-Offset') || end.toString());
            offset = newOffset;
            uploadNextChunk();
          } else {
            reject(new Error('Chunk upload failed: ' + patchXhr.status));
          }
        };
        patchXhr.onerror = function () { reject(new Error('Network error during chunk upload')); };
        patchXhr.send(chunk);
      }
    });
  }

  // ── Video Library ──
  async function loadVideoLibrary() {
    var grid = $('yb-social-video-library-grid');
    var countEl = $('yb-social-video-count');
    if (grid) grid.innerHTML = '<p class="yb-admin__muted">Loading videos...</p>';

    var data = await api('social-media-upload?action=list');
    if (!data) return;
    videoState.videos = data.videos || [];

    if (countEl) countEl.textContent = '(' + videoState.videos.length + ')';
    if (!grid) return;

    if (videoState.videos.length === 0) {
      grid.innerHTML = '<p class="yb-admin__muted">No videos uploaded yet. Drag a video above to get started.</p>';
      return;
    }

    grid.innerHTML = videoState.videos.map(function (v) {
      var thumb = v.thumbnailUrl
        ? '<img src="' + v.thumbnailUrl + '" alt="" loading="lazy">'
        : '<span style="color:#6F6A66;font-size:28px">🎬</span>';

      var statusClass = v.status === 'ready' ? '--ready' : v.status === 'failed' ? '--failed' : v.status === 'encoding' || v.status === 'processing' ? '--encoding' : '--uploading';
      var duration = v.duration ? formatDuration(v.duration) : '';
      var fileSize = v.fileSize ? formatFileSize(v.fileSize) : '';
      var date = v.createdAt ? fmtDate(v.createdAt) : '';

      return '<div class="yb-social__video-card">' +
        '<div class="yb-social__video-card-thumb">' + thumb +
        (duration ? '<span class="yb-social__video-card-duration">' + duration + '</span>' : '') +
        '<span class="yb-social__video-card-status yb-social__video-card-status' + statusClass + '">' + (v.status || 'unknown') + '</span>' +
        '</div>' +
        '<div class="yb-social__video-card-body">' +
        '<p class="yb-social__video-card-title">' + escapeHtml(v.title || 'Untitled') + '</p>' +
        '<p class="yb-social__video-card-meta">' + [fileSize, date].filter(Boolean).join(' · ') + '</p>' +
        '</div>' +
        '<div class="yb-social__video-card-actions">' +
        (v.status === 'ready' ? '<button data-action="social-video-edit" data-id="' + v.videoId + '">Edit</button>' : '') +
        (v.status === 'ready' ? '<button data-action="social-video-use" data-id="' + v.videoId + '">Use in Post</button>' : '') +
        '<button data-action="social-video-delete" data-id="' + v.videoId + '">Delete</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function formatDuration(seconds) {
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  // ── Video Editor ──
  function openVideoEditor(videoId) {
    var video = videoState.videos.find(function (v) { return v.videoId === videoId; });
    if (!video || video.status !== 'ready') { toast('Video not ready', true); return; }

    videoState.editorVideoId = videoId;
    videoState.editorTrim = { start: 0, end: video.duration || 0 };
    videoState.editorAspect = 'original';
    videoState.editorThumbTime = 0;

    var modal = $('yb-social-video-editor');
    if (modal) modal.hidden = false;

    // Set video source
    var player = $('yb-social-video-player');
    if (player) {
      player.src = video.mp4Url || '';
      player.load();

      player.onloadedmetadata = function () {
        videoState.editorTrim.end = player.duration;
        updateTrimDisplay();
        generateThumbnails(player);
      };

      // Update playhead position
      player.ontimeupdate = function () {
        var playhead = $('yb-social-trim-playhead');
        if (playhead && player.duration) {
          var pct = (player.currentTime / player.duration) * 100;
          playhead.style.left = pct + '%';
        }
      };
    }

    // Reset aspect buttons
    qsa('.yb-social__video-aspect-btns .yb-social__btn-sm').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-ratio') === 'original');
    });
  }

  function closeVideoEditor() {
    var modal = $('yb-social-video-editor');
    if (modal) modal.hidden = true;
    var player = $('yb-social-video-player');
    if (player) { player.pause(); player.src = ''; }
    videoState.editorVideoId = null;
  }

  function updateTrimDisplay() {
    var startEl = $('yb-social-trim-start-time');
    var endEl = $('yb-social-trim-end-time');
    var durEl = $('yb-social-trim-duration');
    if (startEl) startEl.value = formatTimecode(videoState.editorTrim.start);
    if (endEl) endEl.value = formatTimecode(videoState.editorTrim.end);
    if (durEl) durEl.textContent = 'Duration: ' + formatTimecode(videoState.editorTrim.end - videoState.editorTrim.start);

    // Update trim selection visual
    var player = $('yb-social-video-player');
    if (player && player.duration) {
      var startPct = (videoState.editorTrim.start / player.duration) * 100;
      var endPct = (videoState.editorTrim.end / player.duration) * 100;
      var startHandle = $('yb-social-trim-start');
      var endHandle = $('yb-social-trim-end');
      var selection = $('yb-social-trim-selection');
      if (startHandle) startHandle.style.left = startPct + '%';
      if (endHandle) endHandle.style.left = endPct + '%';
      if (selection) { selection.style.left = startPct + '%'; selection.style.right = (100 - endPct) + '%'; }
    }
  }

  function formatTimecode(seconds) {
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function parseTimecode(tc) {
    var parts = tc.split(':');
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    return parseFloat(tc) || 0;
  }

  function generateThumbnails(videoEl) {
    var container = $('yb-social-video-thumbnails');
    if (!container || !videoEl.duration) return;
    container.innerHTML = '';

    var count = Math.min(6, Math.max(3, Math.floor(videoEl.duration / 5)));
    var interval = videoEl.duration / count;
    var generated = 0;

    function captureFrame(time, index) {
      var canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      var ctx = canvas.getContext('2d');

      var tempVid = document.createElement('video');
      tempVid.crossOrigin = 'anonymous';
      tempVid.src = videoEl.src;
      tempVid.currentTime = time;
      tempVid.muted = true;

      tempVid.onseeked = function () {
        ctx.drawImage(tempVid, 0, 0, 160, 120);
        var img = document.createElement('img');
        img.src = canvas.toDataURL('image/jpeg', 0.7);
        var item = document.createElement('div');
        item.className = 'yb-social__video-thumbnail-item' + (index === 0 ? ' is-selected' : '');
        item.setAttribute('data-action', 'social-video-select-thumb');
        item.setAttribute('data-time', time.toFixed(2));
        item.appendChild(img);
        container.appendChild(item);
        generated++;
        tempVid.remove();
      };
      tempVid.onerror = function () { generated++; tempVid.remove(); };
    }

    for (var i = 0; i < count; i++) {
      captureFrame(i * interval + 0.5, i);
    }
  }

  function captureCurrentFrame() {
    var player = $('yb-social-video-player');
    var container = $('yb-social-video-thumbnails');
    if (!player || !container) return;

    var canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(player, 0, 0, 160, 120);

    var img = document.createElement('img');
    img.src = canvas.toDataURL('image/jpeg', 0.7);
    var item = document.createElement('div');
    item.className = 'yb-social__video-thumbnail-item is-selected';
    item.setAttribute('data-action', 'social-video-select-thumb');
    item.setAttribute('data-time', player.currentTime.toFixed(2));
    item.appendChild(img);

    // Deselect others
    qsa('.yb-social__video-thumbnail-item').forEach(function (el) { el.classList.remove('is-selected'); });
    container.insertBefore(item, container.firstChild);
    videoState.editorThumbTime = player.currentTime;
  }

  function selectThumbnail(time) {
    videoState.editorThumbTime = parseFloat(time);
    qsa('.yb-social__video-thumbnail-item').forEach(function (el) {
      el.classList.toggle('is-selected', el.getAttribute('data-time') === time);
    });
    var player = $('yb-social-video-player');
    if (player) player.currentTime = videoState.editorThumbTime;
  }

  function setVideoAspect(ratio) {
    videoState.editorAspect = ratio;
    qsa('.yb-social__video-aspect-btns .yb-social__btn-sm').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-ratio') === ratio);
    });
  }

  function useVideoInPost(videoId) {
    var video = videoState.videos.find(function (v) { return v.videoId === (videoId || videoState.editorVideoId); });
    if (!video) return;

    var url = video.mp4Url || video.hlsUrl || '';

    // If editor is open, include trim data
    var editData = null;
    if (videoState.editorVideoId) {
      editData = {
        videoId: video.videoId,
        trim: videoState.editorTrim,
        aspect: videoState.editorAspect,
        thumbTime: videoState.editorThumbTime,
        keepAudio: $('yb-social-video-mute') ? $('yb-social-video-mute').checked : true
      };
      closeVideoEditor();
    }

    // Open composer with the video
    if (window.openSocialComposer) {
      window.openSocialComposer(null);
      setTimeout(function () {
        // Inject video into composer media
        if (window._ybSocial && window._ybSocial.state) {
          // Access composer through the bridge
          var captionEl = $('yb-social-caption');
          if (captionEl && !captionEl.value) captionEl.value = video.title || '';
        }
      }, 200);
    }

    toast('Video added to composer');
  }

  async function deleteVideo(videoId) {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    var data = await api('social-media-upload', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', videoId: videoId })
    });
    if (data) { toast('Video deleted'); loadVideoLibrary(); }
  }

  // ── Drag & Drop + File Input Setup ──
  function initVideoUploadZone() {
    var droparea = $('yb-social-video-droparea');
    var fileInput = $('yb-social-video-file');
    if (!droparea || !fileInput) return;

    droparea.addEventListener('dragover', function (e) {
      e.preventDefault();
      droparea.classList.add('is-dragover');
    });
    droparea.addEventListener('dragleave', function () {
      droparea.classList.remove('is-dragover');
    });
    droparea.addEventListener('drop', function (e) {
      e.preventDefault();
      droparea.classList.remove('is-dragover');
      var files = e.dataTransfer.files;
      for (var i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('video/')) startVideoUpload(files[i]);
      }
    });
    droparea.addEventListener('click', function (e) {
      if (e.target.tagName !== 'BUTTON') fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      for (var i = 0; i < fileInput.files.length; i++) {
        startVideoUpload(fileInput.files[i]);
      }
      fileInput.value = '';
    });
  }

  // ── Trim Handle Dragging ──
  function initTrimHandles() {
    var timeline = $('yb-social-video-timeline');
    if (!timeline) return;

    var dragging = null;

    timeline.addEventListener('mousedown', function (e) {
      var startHandle = $('yb-social-trim-start');
      var endHandle = $('yb-social-trim-end');
      if (e.target === startHandle || e.target.closest('#yb-social-trim-start')) dragging = 'start';
      else if (e.target === endHandle || e.target.closest('#yb-social-trim-end')) dragging = 'end';
      else {
        // Click on timeline = seek
        var player = $('yb-social-video-player');
        if (player && player.duration) {
          var rect = timeline.getBoundingClientRect();
          var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          player.currentTime = pct * player.duration;
        }
        return;
      }
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var rect = timeline.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      var player = $('yb-social-video-player');
      if (!player || !player.duration) return;
      var time = pct * player.duration;

      if (dragging === 'start') {
        videoState.editorTrim.start = Math.min(time, videoState.editorTrim.end - 0.5);
      } else {
        videoState.editorTrim.end = Math.max(time, videoState.editorTrim.start + 0.5);
      }
      updateTrimDisplay();
      player.currentTime = dragging === 'start' ? videoState.editorTrim.start : videoState.editorTrim.end;
    });

    document.addEventListener('mouseup', function () { dragging = null; });
  }

  /* ═══ CANVA DESIGN STUDIO ═══ */

  var canvaState = {
    designs: [],
    brandKits: {},
    platformTypes: {},
    exportFormats: {},
    currentDesignId: null,
    pendingPostId: null
  };

  // Load Canva config (brand kits, platform mappings)
  async function loadCanvaConfig() {
    if (Object.keys(canvaState.brandKits).length) return; // Already loaded
    var data = await api('social-canva?action=brand-kits');
    if (data) {
      canvaState.brandKits = data.brandKits || {};
      canvaState.platformTypes = data.platformTypes || {};
      canvaState.exportFormats = data.exportFormats || {};
    }
  }

  // Open Canva Design Studio modal
  async function openCanvaStudio(postId) {
    await loadCanvaConfig();
    canvaState.pendingPostId = postId || null;

    // Get caption from composer if open
    var captionEl = document.getElementById('yb-social-caption');
    var caption = captionEl ? captionEl.value : '';

    // Get selected platforms from composer
    var selectedPlatforms = [];
    document.querySelectorAll('#yb-social-composer-platforms input:checked').forEach(function (cb) {
      selectedPlatforms.push(cb.value);
    });

    var brandOptions = Object.entries(canvaState.brandKits).map(function (entry) {
      return '<option value="' + entry[0] + '">' + entry[1].name + '</option>';
    }).join('');

    var platformOptions = Object.entries(canvaState.platformTypes).map(function (entry) {
      return '<option value="' + entry[0] + '">' + entry[0].replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) + '</option>';
    }).join('');

    var html = '<div class="yb-social__modal-overlay" id="yb-social-canva-modal">' +
      '<div class="yb-social__modal-box yb-social__modal-box--canva">' +
        '<div class="yb-social__modal-header">' +
          '<h3>🎨 Canva Design Studio</h3>' +
          '<button class="yb-social__btn-sm" data-action="social-canva-close">&times;</button>' +
        '</div>' +
        '<div class="yb-social__modal-body">' +
          // Step 1: Design brief
          '<div id="yb-canva-step-brief" class="yb-social__canva-step">' +
            '<p class="yb-social__canva-step-label">Step 1: Design Brief</p>' +
            // Brand
            '<label class="yb-social__canva-label">Brand</label>' +
            '<select id="yb-canva-brand" class="yb-social__input">' + brandOptions + '</select>' +
            // Platform target
            '<label class="yb-social__canva-label" style="margin-top:10px">Design For</label>' +
            '<select id="yb-canva-platform" class="yb-social__input">' + platformOptions + '</select>' +
            // Design prompt
            '<label class="yb-social__canva-label" style="margin-top:10px">Design Description</label>' +
            '<textarea id="yb-canva-prompt" class="yb-social__input" rows="3" placeholder="Describe the design you want... (e.g. \'Enrollment open for April 4-week YTT, warm orange tones, yoga pose silhouette\')">' +
              (caption ? 'Social post design for: ' + caption.substring(0, 200) : '') +
            '</textarea>' +
            // Quick design presets
            '<label class="yb-social__canva-label" style="margin-top:10px">Quick Presets</label>' +
            '<div class="yb-social__canva-presets">' +
              '<button class="yb-social__canva-preset" data-action="social-canva-preset" data-preset="enrollment">YTT Enrollment</button>' +
              '<button class="yb-social__canva-preset" data-action="social-canva-preset" data-preset="blog">Blog Post</button>' +
              '<button class="yb-social__canva-preset" data-action="social-canva-preset" data-preset="class">Class Schedule</button>' +
              '<button class="yb-social__canva-preset" data-action="social-canva-preset" data-preset="testimonial">Student Story</button>' +
              '<button class="yb-social__canva-preset" data-action="social-canva-preset" data-preset="event">Event / Workshop</button>' +
              '<button class="yb-social__canva-preset" data-action="social-canva-preset" data-preset="quote">Yoga Quote</button>' +
            '</div>' +
          '</div>' +
          // Step 2: Results / Pick
          '<div id="yb-canva-step-results" class="yb-social__canva-step" style="display:none">' +
            '<p class="yb-social__canva-step-label">Step 2: Pick a Design</p>' +
            '<div id="yb-canva-results" class="yb-social__canva-results"></div>' +
          '</div>' +
          // Step 3: Edit & Export
          '<div id="yb-canva-step-export" class="yb-social__canva-step" style="display:none">' +
            '<p class="yb-social__canva-step-label">Step 3: Export & Attach</p>' +
            '<div id="yb-canva-export-info" class="yb-social__canva-export-info"></div>' +
          '</div>' +
        '</div>' +
        '<div class="yb-social__modal-footer">' +
          '<button class="yb-social__btn-sm" data-action="social-canva-close">Cancel</button>' +
          '<button class="yb-social__btn-sm yb-social__btn-sm--primary" data-action="social-canva-generate" id="yb-canva-generate-btn">Generate Designs</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  // Preset descriptions for common design types
  var CANVA_PRESETS = {
    enrollment: 'Yoga teacher training enrollment announcement. Warm orange and black color scheme. Professional yet inviting. Include space for program dates, price, and CTA text. Yoga poses, studio vibes.',
    blog: 'Blog post promotion card. Clean design with space for article title overlay. Yoga/wellness imagery. Warm tones. Include reading time badge area.',
    class: 'Weekly class schedule announcement. Clean grid or list layout. Include time slots and class types. Studio branding. Warm inviting palette.',
    testimonial: 'Student testimonial or success story. Quote-style layout with space for photo and name. Warm tones, inspirational feel. Include quotation marks design element.',
    event: 'Event or workshop promotion. Eye-catching design with date, time, and location space. Energetic but professional. Yoga-themed graphics.',
    quote: 'Inspirational yoga quote card. Minimalist design, beautiful typography. Warm tones or dark cinematic style. Include small logo placement.'
  };

  function applyCanvaPreset(preset) {
    var promptEl = document.getElementById('yb-canva-prompt');
    if (promptEl && CANVA_PRESETS[preset]) {
      promptEl.value = CANVA_PRESETS[preset];
    }
  }

  // Generate designs via Canva — this stores the request info so Claude can process it
  async function generateCanvaDesign() {
    var brandKey = (document.getElementById('yb-canva-brand') || {}).value || 'yoga-bible';
    var platform = (document.getElementById('yb-canva-platform') || {}).value || 'instagram_post';
    var prompt = (document.getElementById('yb-canva-prompt') || {}).value || '';

    if (!prompt.trim()) { toast('Please describe the design you want', true); return; }

    var brand = canvaState.brandKits[brandKey] || {};
    var designType = canvaState.platformTypes[platform] || 'instagram_post';

    // Show loading state
    var resultsEl = document.getElementById('yb-canva-results');
    var briefEl = document.getElementById('yb-canva-step-brief');
    var resultsStep = document.getElementById('yb-canva-step-results');

    if (briefEl) briefEl.style.display = 'none';
    if (resultsStep) resultsStep.style.display = '';
    if (resultsEl) resultsEl.innerHTML = '<div class="yb-social__canva-loading"><p>Generating designs with Canva AI...</p><p class="yb-admin__muted">Using brand kit: ' + (brand.name || brandKey) + ' · Format: ' + platform.replace(/_/g, ' ') + '</p><div class="yb-social__canva-spinner"></div></div>';

    var genBtn = document.getElementById('yb-canva-generate-btn');
    if (genBtn) { genBtn.textContent = 'Generating...'; genBtn.disabled = true; }

    // Build the full prompt with brand context
    var fullPrompt = prompt + '. Brand: Yoga Bible Copenhagen. Style: warm, professional, orange (#f75c03) and dark (#0F0F0F) color scheme. Font: modern sans-serif.';

    // Store the generation request in Firestore for reference
    var data = await api('social-canva', {
      method: 'POST',
      body: JSON.stringify({
        action: 'save-design',
        canvaDesignId: 'pending_' + Date.now(),
        title: prompt.substring(0, 50),
        designType: designType,
        brand: brandKey,
        platformTarget: platform,
        caption: prompt,
        postId: canvaState.pendingPostId
      })
    });

    if (data && data.id) {
      canvaState.currentDesignId = data.id;
    }

    // Show instructions for Claude-assisted generation
    // In a Claude Code session, the MCP tools handle the actual Canva API calls
    // In standalone mode, show a prompt to use with Claude
    if (resultsEl) {
      resultsEl.innerHTML =
        '<div class="yb-social__canva-request-card">' +
          '<h4>Design Request Ready</h4>' +
          '<div class="yb-social__canva-request-detail">' +
            '<div><strong>Brand Kit:</strong> ' + (brand.name || brandKey) + ' (' + (brand.id || '') + ')</div>' +
            '<div><strong>Design Type:</strong> ' + designType + '</div>' +
            '<div><strong>Platform:</strong> ' + platform.replace(/_/g, ' ') + '</div>' +
            '<div><strong>Prompt:</strong> ' + fullPrompt + '</div>' +
          '</div>' +
          '<div class="yb-social__canva-request-actions">' +
            '<p class="yb-admin__muted" style="margin-bottom:10px">In a Claude Code session, ask Claude to generate this design using the Canva MCP tools. Claude will create options for you to pick from.</p>' +
            '<button class="yb-social__btn-sm yb-social__btn-sm--primary" data-action="social-canva-copy-request">Copy Design Request</button>' +
            '<button class="yb-social__btn-sm" data-action="social-canva-back-to-brief">Edit Brief</button>' +
          '</div>' +
        '</div>';
    }

    if (genBtn) { genBtn.textContent = 'Generate Designs'; genBtn.disabled = false; }
  }

  // When a Canva design is exported and URL is available, attach to post
  async function attachCanvaDesignToPost(mediaUrl) {
    if (!canvaState.pendingPostId || !mediaUrl) return;

    var data = await api('social-canva', {
      method: 'POST',
      body: JSON.stringify({
        action: 'attach-to-post',
        postId: canvaState.pendingPostId,
        mediaUrl: mediaUrl
      })
    });

    if (data) {
      toast('Design attached to post!');
      // Also add to composer media if composer is open
      if (window._ybSocial && window._ybSocial.addMediaToComposer) {
        window._ybSocial.addMediaToComposer(mediaUrl);
      }
    }
  }

  // Close Canva modal
  function closeCanvaModal() {
    var modal = document.getElementById('yb-social-canva-modal');
    if (modal) modal.remove();
  }

  // Expose for composer bridge
  window._ybSocialCanva = {
    openStudio: openCanvaStudio,
    attachDesign: attachCanvaDesignToPost,
    getState: function () { return canvaState; }
  };

  /* ═══ STORIES ═══ */
  var storiesState = {
    stories: [],
    templates: [],
    highlights: [],
    filter: 'all',
    editingStory: null
  };

  async function loadStories() {
    var data = await api('social-stories?action=list');
    if (data) storiesState.stories = data.stories || [];

    var tplData = await api('social-stories?action=templates');
    if (tplData) storiesState.templates = tplData.templates || [];

    var hlData = await api('social-stories?action=highlights');
    if (hlData) storiesState.highlights = hlData.highlights || [];

    renderStories();
  }

  function renderStories() {
    var container = $('yb-social-stories-list');
    if (!container) return;

    var stories = storiesState.stories;
    if (storiesState.filter !== 'all') {
      stories = stories.filter(function (s) { return s.status === storiesState.filter; });
    }

    // Stories filter bar
    var filterBar = $('yb-social-stories-filters');
    if (filterBar) {
      var counts = { all: storiesState.stories.length, draft: 0, scheduled: 0, published: 0, expired: 0 };
      storiesState.stories.forEach(function (s) { if (counts[s.status] !== undefined) counts[s.status]++; });
      filterBar.innerHTML = ['all', 'draft', 'scheduled', 'published', 'expired'].map(function (f) {
        return '<button class="yb-social__filter-btn' + (storiesState.filter === f ? ' is-active' : '') + '" data-action="social-stories-filter" data-filter="' + f + '">' +
          f.charAt(0).toUpperCase() + f.slice(1) + ' (' + counts[f] + ')</button>';
      }).join('');
    }

    if (!stories.length) {
      container.innerHTML = '<p class="yb-admin__muted">No stories yet. Create your first story!</p>';
      return;
    }

    container.innerHTML = stories.map(function (s) {
      var isVideo = s.mediaType === 'VIDEO';
      var statusClass = s.status === 'published' ? 'success' : s.status === 'scheduled' ? 'info' : s.status === 'expired' ? 'muted' : '';
      var thumb = isVideo
        ? '<div class="yb-social__story-thumb yb-social__story-thumb--video"><span>▶</span></div>'
        : '<img class="yb-social__story-thumb" src="' + (s.media || '') + '" alt="">';

      var stickers = (s.stickers || []).map(function (st) {
        var icons = { link: '🔗', poll: '📊', countdown: '⏳', mention: '@', hashtag: '#', location: '📍', question: '❓' };
        return '<span class="yb-social__story-sticker">' + (icons[st.type] || '📌') + '</span>';
      }).join('');

      var platforms = (s.platforms || []).map(function (p) {
        return '<span class="yb-social__platform-dot yb-social__platform-dot--' + p + '"></span>';
      }).join('');

      return '<div class="yb-social__story-card">' +
        '<div class="yb-social__story-preview">' + thumb +
          (s.linkUrl ? '<span class="yb-social__story-link-badge">🔗 Link</span>' : '') +
        '</div>' +
        '<div class="yb-social__story-info">' +
          '<div class="yb-social__story-meta">' +
            '<span class="yb-social__badge yb-social__badge--' + statusClass + '">' + s.status + '</span>' +
            platforms + stickers +
          '</div>' +
          '<p class="yb-social__story-caption">' + (s.caption || '<em>No caption</em>') + '</p>' +
          (s.scheduledAt ? '<small class="yb-admin__muted">Scheduled: ' + fmtDate(s.scheduledAt) + '</small>' : '') +
          (s.publishedAt ? '<small class="yb-admin__muted">Published: ' + fmtDate(s.publishedAt) + '</small>' : '') +
        '</div>' +
        '<div class="yb-social__story-actions">' +
          (s.status === 'draft' || s.status === 'scheduled' ? '<button class="yb-social__btn-sm" data-action="social-story-edit" data-id="' + s.id + '">Edit</button>' : '') +
          (s.status === 'draft' || s.status === 'scheduled' ? '<button class="yb-social__btn-sm yb-social__btn-sm--primary" data-action="social-story-publish" data-id="' + s.id + '">Publish</button>' : '') +
          '<button class="yb-social__btn-sm yb-social__btn-sm--danger" data-action="social-story-delete" data-id="' + s.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');

    // Render templates section
    renderStoryTemplates();
    // Render highlights section
    renderStoryHighlights();
  }

  function renderStoryTemplates() {
    var container = $('yb-social-story-templates-list');
    if (!container) return;

    if (!storiesState.templates.length) {
      container.innerHTML = '<p class="yb-admin__muted">No story templates yet. Save a template to quickly create stories.</p>';
      return;
    }

    container.innerHTML = storiesState.templates.map(function (tpl) {
      var categoryBadge = '<span class="yb-social__badge">' + (tpl.category || 'general') + '</span>';
      return '<div class="yb-social__story-template">' +
        '<div class="yb-social__story-template-info">' +
          '<strong>' + (tpl.name || 'Untitled') + '</strong> ' + categoryBadge +
          '<span class="yb-admin__muted"> — used ' + (tpl.usageCount || 0) + ' times</span>' +
          (tpl.caption ? '<p class="yb-social__story-caption">' + tpl.caption + '</p>' : '') +
          (tpl.linkUrl ? '<small class="yb-admin__muted">🔗 ' + tpl.linkUrl + '</small>' : '') +
        '</div>' +
        '<div class="yb-social__story-actions">' +
          '<button class="yb-social__btn-sm yb-social__btn-sm--primary" data-action="social-story-use-template" data-id="' + tpl.id + '">Use</button>' +
          '<button class="yb-social__btn-sm" data-action="social-story-edit-template" data-id="' + tpl.id + '">Edit</button>' +
          '<button class="yb-social__btn-sm yb-social__btn-sm--danger" data-action="social-story-delete-template" data-id="' + tpl.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderStoryHighlights() {
    var container = $('yb-social-story-highlights-list');
    if (!container) return;

    if (!storiesState.highlights.length) {
      container.innerHTML = '<p class="yb-admin__muted">No highlights yet. Organize published stories into highlight groups.</p>';
      return;
    }

    container.innerHTML = storiesState.highlights.map(function (hl) {
      return '<div class="yb-social__story-highlight">' +
        (hl.coverImage ? '<img class="yb-social__story-highlight-cover" src="' + hl.coverImage + '" alt="">' : '<div class="yb-social__story-highlight-cover yb-social__story-highlight-cover--empty">📌</div>') +
        '<div class="yb-social__story-highlight-info">' +
          '<strong>' + hl.name + '</strong>' +
          '<small class="yb-admin__muted">' + (hl.storyIds || []).length + ' stories</small>' +
        '</div>' +
        '<div class="yb-social__story-actions">' +
          '<button class="yb-social__btn-sm" data-action="social-story-edit-highlight" data-id="' + hl.id + '">Edit</button>' +
          '<button class="yb-social__btn-sm yb-social__btn-sm--danger" data-action="social-story-delete-highlight" data-id="' + hl.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Open story composer modal
  function openStoryComposer(storyId) {
    var story = storyId ? storiesState.stories.find(function (s) { return s.id === storyId; }) : null;

    var html = '<div class="yb-social__modal-overlay" id="yb-social-story-modal">' +
      '<div class="yb-social__modal-box yb-social__modal-box--story">' +
        '<div class="yb-social__modal-header">' +
          '<h3>' + (story ? 'Edit Story' : 'Create Story') + '</h3>' +
          '<button class="yb-social__btn-sm" data-action="social-story-close">&times;</button>' +
        '</div>' +
        '<div class="yb-social__modal-body">' +
          // Media
          '<div class="yb-social__story-composer-section">' +
            '<label>Media (single image or video)</label>' +
            '<div class="yb-social__story-media-drop" id="yb-story-media-area">' +
              (story && story.media
                ? (/\.(mp4|mov|webm)$/i.test(story.media) ? '<video src="' + story.media + '" class="yb-social__story-media-preview" muted></video>' : '<img src="' + story.media + '" class="yb-social__story-media-preview" alt="">')
                : '<p>Click to browse media or drag & drop</p>') +
              '<input type="hidden" id="yb-story-media-url" value="' + (story ? story.media || '' : '') + '">' +
              '<button class="yb-social__btn-sm" data-action="social-story-browse-media">Browse CDN</button>' +
            '</div>' +
          '</div>' +
          // Caption
          '<div class="yb-social__story-composer-section">' +
            '<label>Caption / Text Overlay</label>' +
            '<textarea id="yb-story-caption" rows="2" class="yb-social__input">' + (story ? story.caption || '' : '') + '</textarea>' +
          '</div>' +
          // Link sticker
          '<div class="yb-social__story-composer-section">' +
            '<label>🔗 Link Sticker</label>' +
            '<input type="url" id="yb-story-link-url" class="yb-social__input" placeholder="https://yogabible.dk/..." value="' + (story ? story.linkUrl || '' : '') + '">' +
            '<input type="text" id="yb-story-link-text" class="yb-social__input" placeholder="Link label (e.g. Book Now)" value="' + (story ? story.linkText || '' : '') + '" style="margin-top:6px;">' +
          '</div>' +
          // Stickers
          '<div class="yb-social__story-composer-section">' +
            '<label>Stickers</label>' +
            '<div class="yb-social__story-stickers" id="yb-story-stickers">' +
              buildStickerButtons(story ? story.stickers : []) +
            '</div>' +
          '</div>' +
          // Platforms
          '<div class="yb-social__story-composer-section">' +
            '<label>Platforms</label>' +
            '<div class="yb-social__story-platforms">' +
              ['instagram', 'facebook'].map(function (p) {
                var checked = story ? (story.platforms || []).includes(p) : true;
                return '<label class="yb-social__checkbox-label"><input type="checkbox" class="yb-story-platform" value="' + p + '"' + (checked ? ' checked' : '') + '> ' + p.charAt(0).toUpperCase() + p.slice(1) + '</label>';
              }).join(' ') +
            '</div>' +
          '</div>' +
          // Schedule
          '<div class="yb-social__story-composer-section">' +
            '<label>Schedule (optional)</label>' +
            '<input type="datetime-local" id="yb-story-schedule" class="yb-social__input" value="' + (story && story.scheduledAt ? formatDatetimeLocal(story.scheduledAt) : '') + '">' +
          '</div>' +
        '</div>' +
        '<div class="yb-social__modal-footer">' +
          '<button class="yb-social__btn-sm" data-action="social-story-save-draft"' + (story ? ' data-id="' + story.id + '"' : '') + '>Save Draft</button>' +
          '<button class="yb-social__btn-sm" data-action="social-story-save-template-from"' + (story ? ' data-id="' + story.id + '"' : '') + '>Save as Template</button>' +
          '<button class="yb-social__btn-sm yb-social__btn-sm--primary" data-action="social-story-save-publish"' + (story ? ' data-id="' + story.id + '"' : '') + '>Publish Now</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
  }

  function buildStickerButtons(activeStickers) {
    var stickers = [
      { type: 'poll', icon: '📊', label: 'Poll' },
      { type: 'countdown', icon: '⏳', label: 'Countdown' },
      { type: 'mention', icon: '@', label: 'Mention' },
      { type: 'hashtag', icon: '#', label: 'Hashtag' },
      { type: 'location', icon: '📍', label: 'Location' },
      { type: 'question', icon: '❓', label: 'Q&A' }
    ];
    var active = (activeStickers || []).map(function (s) { return s.type; });
    return stickers.map(function (s) {
      var isActive = active.includes(s.type);
      return '<button class="yb-social__sticker-btn' + (isActive ? ' is-active' : '') + '" data-action="social-story-toggle-sticker" data-type="' + s.type + '">' +
        s.icon + ' ' + s.label + '</button>';
    }).join('');
  }

  function formatDatetimeLocal(d) {
    if (!d) return '';
    var date = d._seconds ? new Date(d._seconds * 1000) : new Date(d);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function getStoryFormData(existingId) {
    var platforms = [];
    document.querySelectorAll('.yb-story-platform:checked').forEach(function (cb) {
      platforms.push(cb.value);
    });

    var stickers = [];
    document.querySelectorAll('.yb-social__sticker-btn.is-active').forEach(function (btn) {
      stickers.push({ type: btn.getAttribute('data-type') });
    });

    return {
      id: existingId || undefined,
      media: ($('yb-story-media-url') || {}).value || '',
      caption: ($('yb-story-caption') || {}).value || '',
      linkUrl: ($('yb-story-link-url') || {}).value || '',
      linkText: ($('yb-story-link-text') || {}).value || '',
      platforms: platforms,
      stickers: stickers,
      scheduledAt: ($('yb-story-schedule') || {}).value || null
    };
  }

  async function saveStory(publish) {
    var idEl = document.querySelector('[data-action="social-story-save-draft"]');
    var existingId = idEl ? idEl.getAttribute('data-id') : null;
    var formData = getStoryFormData(existingId);

    if (!formData.media) { toast('Please select a media file', true); return; }
    if (!formData.platforms.length) { toast('Select at least one platform', true); return; }

    if (existingId) {
      formData.action = 'update';
      if (formData.scheduledAt) formData.status = 'scheduled';
      await api('social-stories', { method: 'POST', body: JSON.stringify(formData) });
    } else {
      formData.action = 'create';
      var data = await api('social-stories', { method: 'POST', body: JSON.stringify(formData) });
      if (data) existingId = data.id;
    }

    if (publish && existingId) {
      await api('social-stories', {
        method: 'POST',
        body: JSON.stringify({ action: 'publish', id: existingId })
      });
      toast('Story published!');
    } else {
      toast('Story saved');
    }

    closeStoryModal();
    loadStories();
  }

  async function saveStoryAsTemplate(storyId) {
    var formData = getStoryFormData(storyId);
    var name = prompt('Template name:');
    if (!name) return;
    var category = prompt('Category (e.g. enrollment, blog, class, general):', 'general') || 'general';

    await api('social-stories', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create-template',
        name: name,
        category: category,
        media: formData.media,
        caption: formData.caption,
        stickers: formData.stickers,
        linkUrl: formData.linkUrl,
        linkText: formData.linkText,
        platforms: formData.platforms
      })
    });

    toast('Template saved!');
    loadStories();
  }

  async function useStoryTemplate(templateId) {
    var data = await api('social-stories', {
      method: 'POST',
      body: JSON.stringify({ action: 'create-from-template', templateId: templateId })
    });
    if (data && data.id) {
      toast('Story created from template');
      await loadStories();
      openStoryComposer(data.id);
    }
  }

  async function deleteStory(id) {
    if (!confirm('Delete this story?')) return;
    await api('social-stories', { method: 'POST', body: JSON.stringify({ action: 'delete', id: id }) });
    toast('Story deleted');
    loadStories();
  }

  async function publishStoryNow(id) {
    await api('social-stories', { method: 'POST', body: JSON.stringify({ action: 'publish', id: id }) });
    toast('Story published!');
    loadStories();
  }

  async function deleteStoryTemplate(id) {
    if (!confirm('Delete this template?')) return;
    await api('social-stories', { method: 'POST', body: JSON.stringify({ action: 'delete-template', id: id }) });
    toast('Template deleted');
    loadStories();
  }

  async function deleteStoryHighlight(id) {
    if (!confirm('Delete this highlight?')) return;
    await api('social-stories', { method: 'POST', body: JSON.stringify({ action: 'delete-highlight', id: id }) });
    toast('Highlight deleted');
    loadStories();
  }

  function closeStoryModal() {
    var modal = document.getElementById('yb-social-story-modal');
    if (modal) modal.remove();
  }

  function storyBrowseMedia() {
    // Use existing Bunny browser from composer if available
    if (window._ybSocial && window._ybSocial.openMediaBrowser) {
      window._ybSocialStoryMediaCallback = function (url) {
        var input = $('yb-story-media-url');
        if (input) input.value = url;
        var area = $('yb-story-media-area');
        if (area) {
          var isVideo = /\.(mp4|mov|webm)$/i.test(url);
          var preview = isVideo
            ? '<video src="' + url + '" class="yb-social__story-media-preview" muted autoplay loop></video>'
            : '<img src="' + url + '" class="yb-social__story-media-preview" alt="">';
          area.innerHTML = preview +
            '<input type="hidden" id="yb-story-media-url" value="' + url + '">' +
            '<button class="yb-social__btn-sm" data-action="social-story-browse-media">Change</button>';
        }
      };
      window._ybSocial.openMediaBrowser();
    } else {
      var url = prompt('Enter media URL (Bunny CDN):');
      if (url) {
        var input = $('yb-story-media-url');
        if (input) input.value = url;
      }
    }
  }

  /* ═══ CONTENT CALENDAR AI ═══ */
  async function aiGenerateCalendar() {
    var daysEl = $('yb-social-cal-ai-days');
    var notesEl = $('yb-social-cal-ai-notes');
    var resultsEl = $('yb-social-cal-ai-results');
    var calAiBtn = document.querySelector('[data-action="social-cal-ai-generate"]');
    if (!resultsEl) return;

    var days = daysEl ? parseInt(daysEl.value) || 7 : 7;
    var notes = notesEl ? notesEl.value : '';

    setLoading(calAiBtn, true, 'Generating...');
    resultsEl.innerHTML = '<p class="yb-admin__muted">Generating ' + days + '-day plan...</p>';

    // Get recent posts to avoid repetition
    var existingPosts = state.posts.slice(0, 10).map(function (p) {
      return { caption: p.caption || '' };
    });

    var data = await api('social-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'calendar-plan',
        days: days,
        notes: notes,
        existingPosts: existingPosts,
        platforms: Object.keys(state.accounts).filter(function (k) { return state.accounts[k]; })
      })
    });

    setLoading(calAiBtn, false);

    if (!data || !data.plan) {
      resultsEl.innerHTML = '<p class="yb-admin__muted">Could not generate plan.</p>';
      return;
    }

    resultsEl.innerHTML = data.plan.map(function (p, i) {
      return '<div class="yb-social__cal-ai-item">' +
        '<div class="yb-social__cal-ai-item-head">' +
          '<span class="yb-social__cal-ai-day">Day ' + p.day + ' · ' + (p.date_label || '') + '</span>' +
          '<span class="yb-social__cal-ai-pillar">' + (p.pillar || '') + '</span>' +
          '<span class="yb-social__cal-ai-time">' + (p.best_time || '') + '</span>' +
        '</div>' +
        '<h4>' + escapeHtml(p.topic || '') + '</h4>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div><span class="yb-admin__muted">🇩🇰</span><p style="font-size:12px">' + escapeHtml(p.caption_da || '') + '</p></div>' +
          '<div><span class="yb-admin__muted">🇬🇧</span><p style="font-size:12px">' + escapeHtml(p.caption_en || '') + '</p></div>' +
        '</div>' +
        '<div class="yb-social__cal-ai-item-foot">' +
          '<span>' + (p.media_type || '') + '</span>' +
          '<span class="yb-admin__muted">' + escapeHtml(p.visual_idea || '') + '</span>' +
          '<button class="yb-btn yb-btn--sm yb-btn--outline" data-action="social-cal-ai-create-post" data-index="' + i + '">Create Post</button>' +
        '</div>' +
      '</div>';
    }).join('');

    resultsEl._plan = data.plan;
  }

  function calAiCreatePost(index) {
    var resultsEl = $('yb-social-cal-ai-results');
    if (!resultsEl || !resultsEl._plan) return;
    var p = resultsEl._plan[index];
    if (!p) return;

    // Open composer with pre-filled data
    if (window.openSocialComposer) {
      window.openSocialComposer(null);
      setTimeout(function () {
        var captionEl = $('yb-social-caption');
        if (captionEl) captionEl.value = p.caption_en || p.caption_da || '';
        var hashEl = $('yb-social-hashtags');
        if (hashEl) hashEl.value = (p.hashtags || []).join(', ');
      }, 100);
    }
  }

  /* ═══ AUTO-REPLY SUGGESTIONS ═══ */
  async function aiAutoReplySuggest(panelId) {
    var thread = panelId ? getActiveThreadForPanel(panelId) : inboxState.activeThread;
    if (!thread) { toast('Open a thread first', true); return; }
    var pid = thread.panelId || panelId;

    var suggestEl = getSuggestionsElForPanel(pid);
    if (!suggestEl) return;
    suggestEl.hidden = false;
    suggestEl.innerHTML = '<p class="yb-admin__muted">Generating quick replies...</p>';

    var commentText = '';
    var sentiment = '';

    if (thread.type === 'comment') {
      var comment = inboxState.comments.find(function (c) { return c.commentId === thread.id; });
      if (comment) {
        commentText = comment.text || '';
        sentiment = comment._sentiment ? comment._sentiment.sentiment : '';
      }
    } else {
      var conv = inboxState.conversations.find(function (c) { return c.conversationId === thread.id; });
      if (conv) commentText = conv.lastMessage || '';
    }

    if (!savedRepliesState.loaded) await loadSavedReplies();

    var data = await api('social-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'auto-reply-suggest',
        comment: commentText,
        platform: thread.platform,
        sentiment: sentiment,
        savedReplies: savedRepliesState.replies.slice(0, 5)
      })
    });

    if (!data || !data.replies) {
      suggestEl.innerHTML = '<p class="yb-admin__muted">Could not generate suggestions.</p>';
      return;
    }

    suggestEl.innerHTML = data.replies.map(function (r, i) {
      return '<button type="button" class="yb-social__auto-reply-option" data-action="social-use-auto-reply" data-index="' + i + '" data-panel-id="' + pid + '">' +
        '<span class="yb-social__auto-reply-text">' + escapeHtml(r.text) + '</span>' +
        '<span class="yb-social__auto-reply-style">' + (r.style || '') + '</span>' +
      '</button>';
    }).join('') +
    '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-auto-reply-close" data-panel-id="' + pid + '" style="margin-top:6px">Close</button>';

    suggestEl._replies = data.replies;
  }

  function useAutoReply(index, panelId) {
    var pid = panelId || (inboxState.activeThread ? inboxState.activeThread.panelId : null);
    var suggestEl = pid ? getSuggestionsElForPanel(pid) : null;
    if (!suggestEl || !suggestEl._replies) return;
    var r = suggestEl._replies[index];
    if (!r) return;

    var replyEl = pid ? getReplyElForPanel(pid) : null;
    if (replyEl) {
      replyEl.value = r.text;
      replyEl.focus();
    }
    suggestEl.hidden = true;
  }

  /* ═══ LOADING STATE HELPER ═══ */
  function setLoading(btn, loading, originalText) {
    if (!btn) return;
    if (loading) {
      btn._origText = btn._origText || btn.textContent;
      btn.classList.add('yb-social__btn-loading');
      btn.disabled = true;
      if (originalText !== false) btn.textContent = originalText || 'Loading...';
    } else {
      btn.classList.remove('yb-social__btn-loading');
      btn.disabled = false;
      if (btn._origText) { btn.textContent = btn._origText; btn._origText = null; }
    }
  }

  /* ═══ IMPORT EXISTING POSTS FROM PLATFORMS ═══ */
  async function importExistingPosts(platform) {
    var btn = document.querySelector('[data-action="social-import-posts"][data-platform="' + platform + '"]');
    setLoading(btn, true, 'Importing...');
    toast('Fetching ' + platform + ' posts...');

    var data = await api('social-posts?action=import-from-platform', {
      method: 'POST',
      body: JSON.stringify({ platform: platform })
    });

    setLoading(btn, false);

    if (data && data.imported) {
      toast('Imported ' + data.imported + ' posts from ' + platform);
      loadPosts();
    } else if (data && data.imported === 0) {
      toast('No new posts to import');
    }
  }

  /* ═══ EXPORT FOR COMPOSER ═══ */
  window._ybSocial = {
    state: state,
    api: api,
    toast: toast,
    t: t,
    loadPosts: loadPosts,
    loadHashtags: loadHashtags,
    getToken: getToken,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    platformIcon: platformIcon,
    truncate: truncate
  };

  /* ═══ EVENT DELEGATION ═══ */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');

    // Sub-nav
    if (action === 'social-nav-accounts') showView('accounts');
    else if (action === 'social-nav-calendar') showView('calendar');
    else if (action === 'social-nav-posts') showView('posts');
    else if (action === 'social-nav-analytics') showView('analytics');
    else if (action === 'social-nav-inbox') showView('inbox');
    else if (action === 'social-nav-hashtags') showView('hashtags');
    else if (action === 'social-nav-templates') showView('templates');
    else if (action === 'social-nav-competitors') showView('competitors');
    else if (action === 'social-nav-abtesting') showView('abtesting');
    else if (action === 'social-nav-library') showView('library');
    else if (action === 'social-nav-stories') showView('stories');

    // Accounts
    else if (action === 'social-connect') connectAccount(btn.getAttribute('data-platform'));
    else if (action === 'social-oauth-start') startOAuth(btn.getAttribute('data-platform'));
    else if (action === 'social-connect-save') saveConnection(btn.getAttribute('data-platform'));
    else if (action === 'social-connect-cancel') closeConnectModal();
    else if (action === 'social-disconnect') disconnectAccount(btn.getAttribute('data-platform'));
    else if (action === 'social-refresh-accounts') refreshAccounts();
    else if (action === 'social-init-cdn-folders') initCdnFolders();

    // Calendar
    else if (action === 'social-cal-prev') {
      state.calMonth--;
      if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      renderCalendar();
    }
    else if (action === 'social-cal-next') {
      state.calMonth++;
      if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      renderCalendar();
    }
    else if (action === 'social-cal-day') {
      openCalendarSidebar(btn.getAttribute('data-date'));
    }
    else if (action === 'social-cal-sidebar-close') {
      var sb = $('yb-social-cal-sidebar');
      if (sb) { sb.classList.remove('is-open'); setTimeout(function () { sb.hidden = true; }, 200); }
    }

    // Posts
    else if (action === 'social-filter-status') {
      state.postsFilter = btn.getAttribute('data-status');
      qsa('#yb-social-v-posts .yb-social__filter-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-status') === state.postsFilter);
      });
      loadPosts();
    }
    else if (action === 'social-filter-platform') {
      state.postsPlatform = btn.getAttribute('data-platform') || 'all';
      loadPosts();
    }
    else if (action === 'social-import-posts') {
      importExistingPosts(btn.getAttribute('data-platform'));
    }
    else if (action === 'social-delete-post') deletePost(btn.getAttribute('data-id'));
    else if (action === 'social-duplicate-post') duplicatePost(btn.getAttribute('data-id'));
    else if (action === 'social-publish-now') publishNow(btn.getAttribute('data-id'));
    else if (action === 'social-submit-review') submitForReview(btn.getAttribute('data-id'));
    else if (action === 'social-approve-post') approvePost(btn.getAttribute('data-id'));
    else if (action === 'social-recycle-post') recyclePost(btn.getAttribute('data-id'));
    else if (action === 'social-preview-link') generatePreviewLink(btn.getAttribute('data-id'));
    else if (action === 'social-recurring-schedule') openRecurringScheduler(btn.getAttribute('data-id'));
    else if (action === 'social-save-recurring') saveRecurringSchedule(btn.getAttribute('data-id'));
    else if (action === 'social-close-recurring-modal') { var rm = document.getElementById('yb-social-recurring-modal'); if (rm) rm.remove(); }
    else if (action === 'social-close-preview-modal') { var pm = document.getElementById('yb-social-preview-modal'); if (pm) pm.remove(); }
    else if (action === 'social-copy-preview-link') {
      var urlEl = document.getElementById('yb-social-preview-url');
      if (urlEl) { urlEl.select(); document.execCommand('copy'); toast('Link copied!'); }
    }
    else if (action === 'social-recurring-toggle-day') btn.classList.toggle('is-active');

    // Bulk actions (social-toggle-select handled in change listener only to avoid double-toggle)
    else if (action === 'social-bulk-schedule') bulkSchedule();
    else if (action === 'social-bulk-approve') bulkApprove();
    else if (action === 'social-bulk-duplicate') bulkDuplicate();
    else if (action === 'social-bulk-delete') bulkDelete();
    else if (action === 'social-bulk-smart-schedule') smartScheduleSelected();
    else if (action === 'social-bulk-clear') clearSelection();

    // Hashtags
    else if (action === 'social-new-hashtag-set') showHashtagForm(null);
    else if (action === 'social-edit-hashtag-set') showHashtagForm(btn.getAttribute('data-id'));
    else if (action === 'social-save-hashtag-set') saveHashtagSet();
    else if (action === 'social-cancel-hashtag-set') {
      $('yb-social-hashtag-form').hidden = true;
      state.editingHashtagId = null;
    }
    else if (action === 'social-delete-hashtag-set') deleteHashtagSet(btn.getAttribute('data-id'));
    else if (action === 'social-sync-metrics') syncMetrics();

    // Inbox
    else if (action === 'social-inbox-tab') switchInboxTab(btn.getAttribute('data-tab'));
    else if (action === 'social-inbox-refresh') loadInbox();
    else if (action === 'social-inbox-mark-all-read') markAllRead();
    else if (action === 'social-inbox-open-comment') openCommentThread(btn.getAttribute('data-id'), btn.getAttribute('data-platform'), btn.getAttribute('data-inbox-id'));
    else if (action === 'social-inbox-open-conversation') openConversationThread(btn.getAttribute('data-id'), btn.getAttribute('data-platform'), btn.getAttribute('data-inbox-id'));
    else if (action === 'social-inbox-close-thread') closeThread(btn.getAttribute('data-panel-id'));
    else if (action === 'social-inbox-send-reply') sendReply(btn.getAttribute('data-panel-id'));
    else if (action === 'social-ai-draft-reply') aiDraftReply(btn.getAttribute('data-panel-id'));
    else if (action === 'social-ai-use-reply') useAiReply(btn.getAttribute('data-index'), btn.getAttribute('data-panel-id'));
    else if (action === 'social-inbox-sentiment-filter') filterInboxBySentiment(btn.getAttribute('data-filter'));
    else if (action === 'social-inbox-analyze-sentiment') analyzeInboxSentiment();
    else if (action === 'social-inbox-create-lead') { var cpid = btn.getAttribute('data-panel-id'); if (cpid) setActiveThread(cpid); createLeadFromInbox(); }
    else if (action === 'social-lead-modal-save') saveLeadFromModal();
    else if (action === 'social-lead-modal-close') { var lm = document.getElementById('yb-social-lead-modal'); if (lm) lm.remove(); }

    // Mentions
    else if (action === 'social-mention-open') openMention(btn.getAttribute('data-id'));
    else if (action === 'social-mentions-refresh') refreshMentions();
    else if (action === 'social-mentions-keywords') showMentionsKeywords();
    else if (action === 'social-mentions-save-keywords') saveMentionsKeywords();
    else if (action === 'social-mentions-cancel-keywords') { var mf = $('yb-social-mentions-keywords-form'); if (mf) mf.hidden = true; }

    // AI Content Planner
    else if (action === 'social-ai-plan') { var m = $('yb-social-ai-plan-modal'); if (m) m.hidden = false; }
    else if (action === 'social-ai-plan-close') { var m = $('yb-social-ai-plan-modal'); if (m) m.hidden = true; }
    else if (action === 'social-ai-plan-generate') aiGeneratePlan();
    else if (action === 'social-ai-plan-create-post') aiPlanCreatePost(btn.getAttribute('data-index'));

    // Promote to Ad
    else if (action === 'social-find-promotable') findPromotablePosts();
    else if (action === 'social-promote-post') promotePost(btn.getAttribute('data-id'));

    // AI Analytics Insights
    else if (action === 'social-ai-insights') aiGetInsights();
    else if (action === 'social-ai-insights-close') { var p = $('yb-social-ai-insights-panel'); if (p) p.hidden = true; }

    // Templates
    else if (action === 'social-use-preset') usePreset(btn.getAttribute('data-preset'));
    else if (action === 'social-template-create') createTemplate();
    else if (action === 'social-template-use') useTemplate(btn.getAttribute('data-id'));
    else if (action === 'social-template-delete') deleteTemplate(btn.getAttribute('data-id'));
    else if (action === 'social-save-as-template') saveAsTemplate();

    // Competitors
    else if (action === 'social-competitors-add') { var f = $('yb-social-competitor-form'); if (f) f.hidden = !f.hidden; }
    else if (action === 'social-competitors-cancel') { var f = $('yb-social-competitor-form'); if (f) f.hidden = true; }
    else if (action === 'social-competitors-save') addCompetitor();
    else if (action === 'social-competitors-remove') removeCompetitor(btn.getAttribute('data-id'));
    else if (action === 'social-competitors-refresh') refreshCompetitors();
    else if (action === 'social-ai-suggest-competitors') aiSuggestCompetitors();
    else if (action === 'social-ai-competitor-close') { var m = document.getElementById('yb-social-ai-competitor-modal'); if (m) m.remove(); }
    else if (action === 'social-ai-competitor-search') aiCompetitorSearch();
    else if (action === 'social-ai-comp-cat') btn.classList.toggle('is-active');
    else if (action === 'social-ai-comp-scope') {
      qsa('#yb-ai-comp-scope .yb-social__ai-comp-chip').forEach(function (c) { c.classList.remove('is-active'); });
      btn.classList.add('is-active');
    }
    else if (action === 'social-ai-competitor-add') {
      addCompetitorDirect(btn.getAttribute('data-handle'), btn.getAttribute('data-platform'), btn.getAttribute('data-name'));
      btn.disabled = true; btn.textContent = '✓';
    }
    else if (action === 'social-ai-content-strategy') aiCompetitorContentStrategy();
    else if (action === 'social-ai-strategy-close') { var m = document.getElementById('yb-social-ai-strategy-modal'); if (m) m.remove(); }

    // A/B Testing
    else if (action === 'social-ab-create') showAbCreateModal();
    else if (action === 'social-ab-close') closeAbModal();
    else if (action === 'social-ab-add-variant') addAbVariant();
    else if (action === 'social-ab-save') saveAbTest();
    else if (action === 'social-ab-detail') showAbDetail(btn.getAttribute('data-id'));
    else if (action === 'social-ab-filter') {
      state.abTestFilter = btn.getAttribute('data-status');
      qsa('#yb-social-ab-filters .yb-social__filter-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-status') === state.abTestFilter);
      });
      loadAbTests();
    }
    else if (action === 'social-ab-update-metrics') showMetricsPrompt(btn.getAttribute('data-test-id'), btn.getAttribute('data-variant'));
    else if (action === 'social-ab-declare-winner') declareWinner(btn.getAttribute('data-test-id'), btn.getAttribute('data-variant'));
    else if (action === 'social-ab-delete') deleteAbTest(btn.getAttribute('data-id'));

    // Saved Replies
    else if (action === 'social-saved-replies-toggle') toggleSavedRepliesDropdown(btn.getAttribute('data-panel-id'));
    else if (action === 'social-use-saved-reply') useSavedReply(btn.getAttribute('data-id'), btn.getAttribute('data-panel-id'));
    else if (action === 'social-save-reply-template') saveCurrentReplyAsTemplate(btn.getAttribute('data-panel-id'));
    else if (action === 'social-auto-reply-suggest') aiAutoReplySuggest(btn.getAttribute('data-panel-id'));
    else if (action === 'social-use-auto-reply') useAutoReply(parseInt(btn.getAttribute('data-index')), btn.getAttribute('data-panel-id'));
    else if (action === 'social-auto-reply-close') { var pid = btn.getAttribute('data-panel-id'); var s = pid ? getSuggestionsElForPanel(pid) : null; if (s) s.hidden = true; }

    // Content Library
    else if (action === 'social-library-filter-tag') {
      libraryState.activeTag = libraryState.activeTag === btn.getAttribute('data-tag') ? '' : btn.getAttribute('data-tag');
      loadContentLibrary();
    }
    else if (action === 'social-library-filter-collection') {
      libraryState.activeCollection = libraryState.activeCollection === btn.getAttribute('data-id') ? '' : btn.getAttribute('data-id');
      loadContentLibrary();
    }
    else if (action === 'social-library-new-collection') createLibraryCollection();
    else if (action === 'social-library-edit-asset') showAssetEditor(btn.getAttribute('data-url'));
    else if (action === 'social-library-save-asset') { saveAssetMeta(btn.getAttribute('data-url')); }
    else if (action === 'social-library-close-editor') { var ed = document.getElementById('yb-social-asset-editor'); if (ed) ed.remove(); }
    else if (action === 'social-library-search') {
      libraryState.search = ($('yb-social-library-search') || {}).value || '';
      loadContentLibrary();
    }
    else if (action === 'social-library-clear-filters') {
      libraryState.activeTag = ''; libraryState.activeCollection = ''; libraryState.search = '';
      var searchEl = $('yb-social-library-search'); if (searchEl) searchEl.value = '';
      loadContentLibrary();
    }

    // Video Upload & Editor
    else if (action === 'social-video-browse') { var fi = $('yb-social-video-file'); if (fi) fi.click(); }
    else if (action === 'social-video-edit') openVideoEditor(btn.getAttribute('data-id'));
    else if (action === 'social-video-use') useVideoInPost(btn.getAttribute('data-id'));
    else if (action === 'social-video-delete') deleteVideo(btn.getAttribute('data-id'));
    else if (action === 'social-video-editor-close') closeVideoEditor();
    else if (action === 'social-video-use-in-post') useVideoInPost();
    else if (action === 'social-video-capture-thumb') captureCurrentFrame();
    else if (action === 'social-video-select-thumb') selectThumbnail(btn.getAttribute('data-time'));
    else if (action === 'social-video-aspect') setVideoAspect(btn.getAttribute('data-ratio'));

    // Canva Design Studio
    else if (action === 'social-canva-open') openCanvaStudio(btn.getAttribute('data-post-id') || null);
    else if (action === 'social-canva-close') closeCanvaModal();
    else if (action === 'social-canva-generate') generateCanvaDesign();
    else if (action === 'social-canva-preset') applyCanvaPreset(btn.getAttribute('data-preset'));
    else if (action === 'social-canva-back-to-brief') {
      var brief = document.getElementById('yb-canva-step-brief');
      var results = document.getElementById('yb-canva-step-results');
      if (brief) brief.style.display = '';
      if (results) results.style.display = 'none';
    }
    else if (action === 'social-canva-copy-request') {
      var detail = document.querySelector('.yb-social__canva-request-detail');
      if (detail) {
        var text = detail.innerText;
        navigator.clipboard.writeText(text).then(function () { toast('Copied!'); });
      }
    }

    // Stories
    else if (action === 'social-stories-filter') {
      storiesState.filter = btn.getAttribute('data-filter') || 'all';
      renderStories();
    }
    else if (action === 'social-new-story') openStoryComposer(null);
    else if (action === 'social-story-edit') openStoryComposer(btn.getAttribute('data-id'));
    else if (action === 'social-story-publish') publishStoryNow(btn.getAttribute('data-id'));
    else if (action === 'social-story-delete') deleteStory(btn.getAttribute('data-id'));
    else if (action === 'social-story-close') closeStoryModal();
    else if (action === 'social-story-save-draft') saveStory(false);
    else if (action === 'social-story-save-publish') saveStory(true);
    else if (action === 'social-story-save-template-from') saveStoryAsTemplate(btn.getAttribute('data-id'));
    else if (action === 'social-story-browse-media') storyBrowseMedia();
    else if (action === 'social-story-toggle-sticker') btn.classList.toggle('is-active');
    else if (action === 'social-story-use-template') useStoryTemplate(btn.getAttribute('data-id'));
    else if (action === 'social-story-edit-template') {
      var tpl = storiesState.templates.find(function (t) { return t.id === btn.getAttribute('data-id'); });
      if (tpl) {
        var name = prompt('Template name:', tpl.name);
        if (name) {
          api('social-stories', { method: 'POST', body: JSON.stringify({ action: 'update-template', id: tpl.id, name: name }) }).then(function () { loadStories(); });
        }
      }
    }
    else if (action === 'social-story-delete-template') deleteStoryTemplate(btn.getAttribute('data-id'));
    else if (action === 'social-story-delete-highlight') deleteStoryHighlight(btn.getAttribute('data-id'));

    // Content Calendar AI
    else if (action === 'social-cal-ai-generate') aiGenerateCalendar();
    else if (action === 'social-cal-ai-create-post') calAiCreatePost(parseInt(btn.getAttribute('data-index')));
    else if (action === 'social-cal-ai-toggle') {
      var panel = $('yb-social-cal-ai-panel');
      if (panel) panel.hidden = !panel.hidden;
    }

    // New post / Edit post — handled by composer
    else if (action === 'social-new-post' && window.openSocialComposer) {
      window.openSocialComposer(null);
    }
    else if (action === 'social-edit-post' && window.openSocialComposer) {
      window.openSocialComposer(btn.getAttribute('data-id'));
    }
  });

  // Analytics range change + bulk select checkboxes
  document.addEventListener('change', function (e) {
    if (e.target.id === 'yb-social-analytics-range') {
      state.analyticsRange = parseInt(e.target.value) || 30;
      loadAnalytics();
    }
    if (e.target.id === 'yb-social-select-all') {
      toggleSelectAll();
    }
    // Individual post checkbox
    if (e.target.getAttribute && e.target.getAttribute('data-action') === 'social-toggle-select') {
      togglePostSelect(e.target.getAttribute('data-id'));
      e.stopPropagation();
    }
    // Trim time inputs
    if (e.target.id === 'yb-social-trim-start-time') {
      videoState.editorTrim.start = parseTimecode(e.target.value);
      updateTrimDisplay();
    }
    if (e.target.id === 'yb-social-trim-end-time') {
      videoState.editorTrim.end = parseTimecode(e.target.value);
      updateTrimDisplay();
    }
  });

  /* ═══ INIT ═══ */
  function init() {
    T = window._ybAdminT || {};

    // Load posts on first init (needed for calendar)
    firebase.auth().onAuthStateChanged(function (user) {
      if (!user) return;
      // Pre-load posts for calendar dots
      api('social-posts?action=list').then(function (data) {
        if (data) state.posts = data.posts || [];
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
