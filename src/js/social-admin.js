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
    calMonth: new Date().getMonth(),
    calYear: new Date().getFullYear(),
    hashtagSets: [],
    editingHashtagId: null,
    analyticsRange: 30
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
    ['accounts', 'calendar', 'posts', 'analytics', 'hashtags'].forEach(function (v) {
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
    if (name === 'hashtags') loadHashtags();
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
      var handleEl = $('yb-social-' + p.substring(0, 2) + '-handle');
      var followEl = $('yb-social-' + p.substring(0, 2) + '-followers');
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
    instagram: { pageId: '17841474697451627' }
  };

  function connectAccount(platform) {
    // Build and show branded connect modal
    var defaults = PLATFORM_DEFAULTS[platform] || {};
    var needsPageId = platform === 'facebook' || platform === 'instagram';
    var pageIdLabel = platform === 'facebook' ? 'Facebook Page ID' : platform === 'instagram' ? 'Instagram Business Account ID' : '';

    var html = '<div class="yb-social__connect-modal" id="yb-social-connect-modal">' +
      '<div class="yb-social__connect-overlay" data-action="social-connect-cancel"></div>' +
      '<div class="yb-social__connect-box">' +
      '<div class="yb-social__connect-platform-badge">' + platformLabel(platform) + '</div>' +
      '<h3>Connect ' + platform.charAt(0).toUpperCase() + platform.slice(1) + '</h3>' +
      '<p>Paste your access token to connect this account.</p>' +
      '<div class="yb-admin__field">' +
      '<label for="yb-social-connect-token">Access Token</label>' +
      '<input type="text" id="yb-social-connect-token" placeholder="Paste token here...">' +
      '</div>' +
      (needsPageId ? '<div class="yb-admin__field">' +
        '<label for="yb-social-connect-pageid">' + pageIdLabel + '</label>' +
        '<input type="text" id="yb-social-connect-pageid" value="' + (defaults.pageId || '') + '">' +
        '</div>' : '') +
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

  function platformLabel(p) {
    var icons = {
      instagram: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/></svg> Instagram',
      facebook: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> Facebook',
      tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube', pinterest: 'Pinterest'
    };
    return icons[p] || p;
  }

  async function saveConnection(platform) {
    var token = ($('yb-social-connect-token') || {}).value || '';
    if (!token.trim()) { toast('Enter a token', true); return; }

    var body = { platform: platform, accessToken: token.trim() };
    var pageIdEl = $('yb-social-connect-pageid');
    if (pageIdEl && pageIdEl.value.trim()) body.pageId = pageIdEl.value.trim();

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
          html += '<div class="yb-social__cal-post-card" data-action="social-edit-post" data-id="' + p.id + '">' +
            truncate(p.caption, 25) + '</div>';
        });
        if (dayPosts.length > 2) {
          html += '<div class="yb-social__cal-post-card">+' + (dayPosts.length - 2) + ' more</div>';
        }
      }
      html += '</div>';
    }
    grid.innerHTML = html;
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
    var data = await api(url);
    if (!data) return;
    state.posts = data.posts || [];
    renderPosts();
    // Also refresh calendar if loaded
    if ($('yb-social-cal-grid')) renderCalendar();
  }

  function renderPosts() {
    var grid = $('yb-social-posts-grid');
    var countEl = $('yb-social-posts-count');
    if (!grid) return;

    if (countEl) countEl.textContent = state.posts.length + ' ' + t('social_posts_title').toLowerCase();

    if (state.posts.length === 0) {
      grid.innerHTML = '<p class="yb-admin__muted">' + t('social_no_posts') + '</p>';
      return;
    }

    grid.innerHTML = state.posts.map(function (p) {
      var thumb = p.media && p.media[0]
        ? '<div class="yb-social__post-thumb"><img src="' + p.media[0] + '" alt="" loading="lazy"></div>'
        : '<div class="yb-social__post-thumb"><span class="yb-admin__muted" style="font-size:24px">📝</span></div>';

      var schedTime = '';
      if (p.status === 'scheduled' && p.scheduledAt) schedTime = fmtDateTime(p.scheduledAt);
      else if (p.publishedAt) schedTime = fmtDateTime(p.publishedAt);
      else schedTime = fmtDate(p.createdAt);

      return '<div class="yb-social__post-card">' +
        thumb +
        '<div class="yb-social__post-body">' +
        '<p class="yb-social__post-caption">' + truncate(p.caption, 80) + '</p>' +
        '<div class="yb-social__post-meta">' +
        '<div class="yb-social__post-platforms">' + (p.platforms || []).map(platformIcon).join('') + '</div>' +
        statusBadge(p.status) +
        '<span>' + schedTime + '</span>' +
        '</div>' +
        '<div class="yb-social__post-actions">' +
        '<button data-action="social-edit-post" data-id="' + p.id + '">' + t('social_edit') + '</button>' +
        '<button data-action="social-duplicate-post" data-id="' + p.id + '">' + t('social_duplicate') + '</button>' +
        (p.status === 'draft' || p.status === 'scheduled' ? '<button data-action="social-publish-now" data-id="' + p.id + '">' + t('social_publish_now') + '</button>' : '') +
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

  /* ═══ ANALYTICS ═══ */
  async function loadAnalytics() {
    var data = await api('social-analytics?action=overview&days=' + state.analyticsRange);
    if (!data) return;

    var s = data.stats || {};
    var el;
    el = $('yb-social-stat-followers'); if (el) el.textContent = (s.totalFollowers || 0).toLocaleString();
    el = $('yb-social-stat-posts'); if (el) el.textContent = (s.totalPosts || 0).toLocaleString();
    el = $('yb-social-stat-engagement'); if (el) el.textContent = (s.avgEngagement || 0).toFixed(1) + '%';
    el = $('yb-social-stat-reach'); if (el) el.textContent = (s.totalReach || 0).toLocaleString();

    // Load recent post metrics
    var recent = await api('social-analytics?action=recent&days=' + state.analyticsRange);
    var tbody = $('yb-social-analytics-body');
    if (!tbody || !recent) return;

    var metrics = recent.metrics || [];
    if (metrics.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="yb-admin__muted">No data yet</td></tr>';
      return;
    }

    tbody.innerHTML = metrics.map(function (m) {
      return '<tr>' +
        '<td>' + truncate(m.caption, 40) + '</td>' +
        '<td>' + platformIcon(m.platform) + '</td>' +
        '<td>' + (m.likes || 0) + '</td>' +
        '<td>' + (m.comments || 0) + '</td>' +
        '<td>' + (m.shares || 0) + '</td>' +
        '<td>' + (m.reach || 0).toLocaleString() + '</td>' +
        '<td>' + fmtDate(m.publishedAt) + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ═══ HASHTAG MANAGER ═══ */
  async function loadHashtags() {
    var db = firebase.firestore();
    var snap = await db.collection('social_hashtag_sets').orderBy('createdAt', 'desc').get();
    state.hashtagSets = [];
    snap.forEach(function (doc) { state.hashtagSets.push(Object.assign({ id: doc.id }, doc.data())); });
    renderHashtags();
  }

  function renderHashtags() {
    var grid = $('yb-social-hashtag-list');
    if (!grid) return;

    if (state.hashtagSets.length === 0) {
      grid.innerHTML = '<p class="yb-admin__muted">No hashtag sets yet. Create your first one.</p>';
      return;
    }

    grid.innerHTML = state.hashtagSets.map(function (s) {
      return '<div class="yb-social__hashtag-card">' +
        '<h4>' + (s.name || 'Untitled') + '</h4>' +
        '<div class="yb-social__hashtag-tags">' +
        (s.hashtags || []).slice(0, 15).map(function (h) {
          return '<span class="yb-social__hashtag-tag">' + h + '</span>';
        }).join('') +
        (s.hashtags && s.hashtags.length > 15 ? '<span class="yb-social__hashtag-tag">+' + (s.hashtags.length - 15) + '</span>' : '') +
        '</div>' +
        '<div class="yb-social__hashtag-card-meta">Used ' + (s.timesUsed || 0) + ' times</div>' +
        '<div class="yb-social__hashtag-card-actions">' +
        '<button data-action="social-edit-hashtag-set" data-id="' + s.id + '">' + t('social_edit') + '</button>' +
        '<button data-action="social-delete-hashtag-set" data-id="' + s.id + '">' + t('social_delete') + '</button>' +
        '</div></div>';
    }).join('');
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
    else if (action === 'social-nav-hashtags') showView('hashtags');

    // Accounts
    else if (action === 'social-connect') connectAccount(btn.getAttribute('data-platform'));
    else if (action === 'social-connect-save') saveConnection(btn.getAttribute('data-platform'));
    else if (action === 'social-connect-cancel') closeConnectModal();
    else if (action === 'social-disconnect') disconnectAccount(btn.getAttribute('data-platform'));
    else if (action === 'social-refresh-accounts') refreshAccounts();

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
      qsa('.yb-social__filter-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-status') === state.postsFilter);
      });
      loadPosts();
    }
    else if (action === 'social-delete-post') deletePost(btn.getAttribute('data-id'));
    else if (action === 'social-duplicate-post') duplicatePost(btn.getAttribute('data-id'));
    else if (action === 'social-publish-now') publishNow(btn.getAttribute('data-id'));

    // Hashtags
    else if (action === 'social-new-hashtag-set') showHashtagForm(null);
    else if (action === 'social-edit-hashtag-set') showHashtagForm(btn.getAttribute('data-id'));
    else if (action === 'social-save-hashtag-set') saveHashtagSet();
    else if (action === 'social-cancel-hashtag-set') {
      $('yb-social-hashtag-form').hidden = true;
      state.editingHashtagId = null;
    }
    else if (action === 'social-delete-hashtag-set') deleteHashtagSet(btn.getAttribute('data-id'));

    // New post / Edit post — handled by composer
    else if (action === 'social-new-post' && window.openSocialComposer) {
      window.openSocialComposer(null);
    }
    else if (action === 'social-edit-post' && window.openSocialComposer) {
      window.openSocialComposer(btn.getAttribute('data-id'));
    }
  });

  // Analytics range change
  document.addEventListener('change', function (e) {
    if (e.target.id === 'yb-social-analytics-range') {
      state.analyticsRange = parseInt(e.target.value) || 30;
      loadAnalytics();
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
