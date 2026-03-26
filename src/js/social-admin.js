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
    ['accounts', 'calendar', 'posts', 'analytics', 'inbox', 'hashtags'].forEach(function (v) {
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
    instagram: { pageId: '17841474697451627' },
    tiktok: {},
    linkedin: {}
  };

  function connectAccount(platform) {
    // Build and show branded connect modal
    var defaults = PLATFORM_DEFAULTS[platform] || {};
    var needsPageId = platform === 'facebook' || platform === 'instagram';
    var needsOrgId = platform === 'linkedin';
    var pageIdLabel = platform === 'facebook' ? 'Facebook Page ID' : platform === 'instagram' ? 'Instagram Business Account ID' : '';

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
    }

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

  function platformLabel(p) {
    var icons = {
      instagram: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/></svg> Instagram',
      facebook: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> Facebook',
      tiktok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78c.27 0 .54.04.8.1v-3.5a6.37 6.37 0 0 0-.8-.05A6.34 6.34 0 0 0 3.15 15.3 6.34 6.34 0 0 0 9.49 21.6a6.34 6.34 0 0 0 6.34-6.34V8.7a8.16 8.16 0 0 0 4.77 1.52V6.77a4.83 4.83 0 0 1-1.01-.08z"/></svg> TikTok',
      linkedin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg> LinkedIn',
      youtube: 'YouTube', pinterest: 'Pinterest'
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
    var days = state.analyticsRange;

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

    // Hour heatmap — show every 2 hours to save space
    html += '<div class="yb-social__heatmap">';
    html += '<div class="yb-social__heatmap-label">By Hour</div>';
    html += '<div class="yb-social__heatmap-row">';
    var maxHourEng = Math.max.apply(null, data.byHour.map(function (h) { return h.avgEngagement; })) || 1;
    data.byHour.forEach(function (h) {
      var intensity = maxHourEng > 0 ? Math.round((h.avgEngagement / maxHourEng) * 100) : 0;
      var opacity = Math.max(0.08, intensity / 100);
      html += '<div class="yb-social__heatmap-cell" title="' + h.label + '\nAvg engagement: ' + h.avgEngagement + '\nPosts: ' + h.posts + '" style="background:rgba(247,92,3,' + opacity + ')">' +
        '<span>' + h.hour + '</span></div>';
    });
    html += '</div>';

    // Day heatmap
    html += '<div class="yb-social__heatmap-label" style="margin-top:12px">By Day</div>';
    html += '<div class="yb-social__heatmap-row yb-social__heatmap-row--days">';
    var maxDayEng = Math.max.apply(null, data.byDay.map(function (d) { return d.avgEngagement; })) || 1;
    data.byDay.forEach(function (d) {
      var intensity = maxDayEng > 0 ? Math.round((d.avgEngagement / maxDayEng) * 100) : 0;
      var opacity = Math.max(0.08, intensity / 100);
      html += '<div class="yb-social__heatmap-cell yb-social__heatmap-cell--day" title="' + d.label + '\nAvg engagement: ' + d.avgEngagement + '\nPosts: ' + d.posts + '" style="background:rgba(247,92,3,' + opacity + ')">' +
        '<span>' + d.label.substring(0, 3) + '</span></div>';
    });
    html += '</div></div>';

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

  /* ═══ INBOX ═══ */
  var inboxState = {
    tab: 'comments',
    comments: [],
    conversations: [],
    activeThread: null,
    pollTimer: null
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

    container.innerHTML = inboxState.comments.map(function (c) {
      return '<div class="yb-social__inbox-item' + (c.read ? '' : ' yb-social__inbox-item--unread') + '" data-action="social-inbox-open-comment" data-id="' + c.commentId + '" data-platform="' + c.platform + '" data-inbox-id="' + c.id + '">' +
        '<div class="yb-social__inbox-item-head">' +
          platformIcon(c.platform) +
          '<span class="yb-social__inbox-item-author">' + (c.author || 'Unknown') + '</span>' +
          '<span class="yb-social__inbox-item-time">' + formatTimeAgo(c.timestamp) + '</span>' +
          (!c.read ? '<span class="yb-social__inbox-unread-dot"></span>' : '') +
        '</div>' +
        '<p class="yb-social__inbox-item-text">' + escapeHtml(c.text || '') + '</p>' +
        '<p class="yb-social__inbox-item-context">On: ' + escapeHtml(c.postCaption || '') + '</p>' +
        (c.replies && c.replies.length > 0 ? '<span class="yb-social__inbox-item-replies">' + c.replies.length + ' ' + (c.replies.length === 1 ? 'reply' : 'replies') + '</span>' : '') +
      '</div>';
    }).join('');
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

  async function openCommentThread(commentId, platform, inboxId) {
    var thread = $('yb-social-inbox-thread');
    var body = $('yb-social-inbox-thread-body');
    var title = $('yb-social-inbox-thread-title');
    if (!thread || !body) return;

    // Find the comment in state
    var comment = inboxState.comments.find(function (c) { return c.commentId === commentId; });

    thread.hidden = false;
    inboxState.activeThread = { type: 'comment', id: commentId, platform: platform, inboxId: inboxId };

    if (title) title.textContent = (comment ? comment.author : 'Comment') + ' — ' + platform;

    // Show the original comment + replies
    var html = '';
    if (comment) {
      html += '<div class="yb-social__inbox-msg yb-social__inbox-msg--them">' +
        '<div class="yb-social__inbox-msg-head"><strong>' + escapeHtml(comment.author) + '</strong> <span>' + formatTimeAgo(comment.timestamp) + '</span></div>' +
        '<p>' + escapeHtml(comment.text) + '</p>' +
      '</div>';

      // Show existing replies
      (comment.replies || []).forEach(function (r) {
        var isOwn = r.username === 'yogabible' || (r.from && r.from.name === 'Yoga Bible');
        html += '<div class="yb-social__inbox-msg' + (isOwn ? ' yb-social__inbox-msg--own' : ' yb-social__inbox-msg--them') + '">' +
          '<div class="yb-social__inbox-msg-head"><strong>' + escapeHtml(r.username || (r.from ? r.from.name : '')) + '</strong> <span>' + formatTimeAgo(r.timestamp || r.created_time) + '</span></div>' +
          '<p>' + escapeHtml(r.text || r.message || '') + '</p>' +
        '</div>';
      });
    }

    body.innerHTML = html || '<p class="yb-admin__muted">Loading thread...</p>';

    // Mark as read
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
      // Replace replies section (keep original comment)
      if (comment) {
        body.innerHTML = '<div class="yb-social__inbox-msg yb-social__inbox-msg--them">' +
          '<div class="yb-social__inbox-msg-head"><strong>' + escapeHtml(comment.author) + '</strong> <span>' + formatTimeAgo(comment.timestamp) + '</span></div>' +
          '<p>' + escapeHtml(comment.text) + '</p>' +
        '</div>' + extraHtml;
      }
    }
  }

  async function openConversationThread(conversationId, platform, inboxId) {
    var thread = $('yb-social-inbox-thread');
    var body = $('yb-social-inbox-thread-body');
    var title = $('yb-social-inbox-thread-title');
    if (!thread || !body) return;

    var conv = inboxState.conversations.find(function (c) { return c.conversationId === conversationId; });

    thread.hidden = false;
    inboxState.activeThread = { type: 'conversation', id: conversationId, platform: platform, inboxId: inboxId };

    if (title) title.textContent = (conv ? conv.participants.join(', ') : 'Conversation') + ' — ' + platform;
    body.innerHTML = '<p class="yb-admin__muted">Loading messages...</p>';

    markInboxRead([inboxId]);

    var data = await api('social-inbox?action=thread&id=' + conversationId + '&platform=' + platform + '&type=conversation');
    if (data && data.thread) {
      var msgs = data.thread.reverse(); // oldest first
      body.innerHTML = msgs.map(function (m) {
        var isOwn = (m.from && (m.from.name === 'Yoga Bible' || m.from.id === '878172732056415'));
        return '<div class="yb-social__inbox-msg' + (isOwn ? ' yb-social__inbox-msg--own' : ' yb-social__inbox-msg--them') + '">' +
          '<div class="yb-social__inbox-msg-head"><strong>' + escapeHtml(m.from ? m.from.name : '') + '</strong> <span>' + formatTimeAgo(m.created_time) + '</span></div>' +
          '<p>' + escapeHtml(m.message || '') + '</p>' +
        '</div>';
      }).join('') || '<p class="yb-admin__muted">No messages</p>';

      // Scroll to bottom
      body.scrollTop = body.scrollHeight;
    }
  }

  function closeThread() {
    var thread = $('yb-social-inbox-thread');
    if (thread) thread.hidden = true;
    inboxState.activeThread = null;
  }

  async function sendReply() {
    var replyEl = $('yb-social-inbox-reply');
    if (!replyEl || !replyEl.value.trim() || !inboxState.activeThread) return;

    var text = replyEl.value.trim();
    var thread = inboxState.activeThread;
    var body = {};

    if (thread.type === 'comment') {
      body = { action: 'reply-comment', commentId: thread.id, text: text, platform: thread.platform };
    } else {
      body = { action: 'reply-message', conversationId: thread.id, text: text, platform: thread.platform };
    }

    toast('Sending...');
    var data = await api('social-inbox', { method: 'POST', body: JSON.stringify(body) });

    if (data) {
      replyEl.value = '';
      toast('Reply sent');

      // Add reply to thread UI
      var threadBody = $('yb-social-inbox-thread-body');
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

  function switchInboxTab(tab) {
    inboxState.tab = tab;
    var commentsEl = $('yb-social-inbox-comments');
    var messagesEl = $('yb-social-inbox-messages');
    if (commentsEl) commentsEl.hidden = tab !== 'comments';
    if (messagesEl) messagesEl.hidden = tab !== 'messages';
    qsa('#yb-social-inbox-tabs .yb-social__filter-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === tab);
    });
    closeThread();
    renderInbox();
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
    else if (action === 'social-nav-inbox') showView('inbox');
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
    else if (action === 'social-sync-metrics') syncMetrics();

    // Inbox
    else if (action === 'social-inbox-tab') switchInboxTab(btn.getAttribute('data-tab'));
    else if (action === 'social-inbox-refresh') loadInbox();
    else if (action === 'social-inbox-mark-all-read') markAllRead();
    else if (action === 'social-inbox-open-comment') openCommentThread(btn.getAttribute('data-id'), btn.getAttribute('data-platform'), btn.getAttribute('data-inbox-id'));
    else if (action === 'social-inbox-open-conversation') openConversationThread(btn.getAttribute('data-id'), btn.getAttribute('data-platform'), btn.getAttribute('data-inbox-id'));
    else if (action === 'social-inbox-close-thread') closeThread();
    else if (action === 'social-inbox-send-reply') sendReply();

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
