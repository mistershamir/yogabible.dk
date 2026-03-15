/**
 * Ads Admin — Meta Ads Manager for Yoga Bible + Hot Yoga CPH
 * Client-side admin panel for managing Meta ad campaigns.
 */
(function () {
  'use strict';

  /* ── State ── */
  var currentAccount = '';
  var accounts = [];
  var campaigns = [];
  var adsets = [];
  var ads = [];
  var insights = null;
  var dateRange = 7;
  var loaded = false;
  var currentView = 'overview'; // overview | campaigns | adsets | ads
  var drillCampaign = null;
  var drillAdset = null;

  var lang = window._ybAdminLang || 'da';
  var T = window._ybAdminT || {};
  function t(da, en) { return lang === 'en' ? en : da; }

  /* ── Helpers ── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function toast(msg, isError) {
    var el = $('yb-admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'yb-admin__toast' + (isError ? ' yb-admin__toast--error' : '');
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 3500);
  }

  function getAuthToken() {
    return firebase.auth().currentUser.getIdToken();
  }

  function api(method, params, body) {
    var qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return getAuthToken().then(function (token) {
      var opts = {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
      };
      if (body) opts.body = JSON.stringify(body);
      return fetch('/.netlify/functions/meta-ads-admin' + qs, opts);
    }).then(function (res) { return res.json(); });
  }

  /* ── Number Formatting ── */
  function fmtNum(n) {
    if (n === undefined || n === null) return '—';
    return Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'da-DK');
  }
  function fmtCur(n, currency) {
    if (n === undefined || n === null) return '—';
    var v = Number(n);
    var c = currency || 'DKK';
    return v.toLocaleString(lang === 'en' ? 'en-US' : 'da-DK', { style: 'currency', currency: c, minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    if (n === undefined || n === null) return '—';
    return Number(n).toFixed(2) + '%';
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString(lang === 'en' ? 'en-US' : 'da-DK', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* ── Status Helpers ── */
  function statusBadge(status) {
    var cls = 'yb-admin__badge';
    switch ((status || '').toUpperCase()) {
      case 'ACTIVE': cls += ' yb-admin__badge--ok'; break;
      case 'PAUSED': cls += ' yb-admin__badge--muted'; break;
      case 'ARCHIVED': cls += ' yb-admin__badge--muted'; break;
      default: cls += ' yb-admin__badge--muted'; break;
    }
    return '<span class="' + cls + '">' + esc(status) + '</span>';
  }

  function extractAction(actions, type) {
    if (!actions || !Array.isArray(actions)) return 0;
    for (var i = 0; i < actions.length; i++) {
      if (actions[i].action_type === type) return Number(actions[i].value);
    }
    return 0;
  }

  /* ═══════════════════════════════════════════════════════════════
     LOAD DATA
     ═══════════════════════════════════════════════════════════════ */

  function loadAccounts() {
    var wrap = $('yb-ads-content');
    if (!wrap) return;
    wrap.innerHTML = '<p class="yb-admin__loading">' + t('Indlæser annonce-konti…', 'Loading ad accounts…') + '</p>';

    api('GET', { action: 'accounts' }).then(function (data) {
      if (!data.ok) { toast(data.error || 'Error', true); return; }
      accounts = data.accounts || [];
      loaded = true;

      // Populate account picker
      var sel = $('yb-ads-account');
      if (sel) {
        sel.innerHTML = '';
        accounts.forEach(function (a) {
          var opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = a.name + ' (' + a.id.replace('act_', '') + ')';
          sel.appendChild(opt);
        });
        if (accounts.length > 0) {
          currentAccount = accounts[0].id;
          sel.value = currentAccount;
          loadOverview();
        }
      }
    }).catch(function (err) {
      console.error('[ads-admin] Load accounts error:', err);
      toast(t('Kunne ikke indlæse konti', 'Failed to load accounts'), true);
    });
  }

  function loadOverview() {
    currentView = 'overview';
    updateBreadcrumb();

    var wrap = $('yb-ads-content');
    if (!wrap) return;
    wrap.innerHTML = '<p class="yb-admin__loading">' + t('Indlæser…', 'Loading…') + '</p>';

    // Load campaigns + insights in parallel
    Promise.all([
      api('GET', { action: 'campaigns', account: currentAccount }),
      api('GET', { action: 'insights', account: currentAccount, range: dateRange })
    ]).then(function (results) {
      var campData = results[0];
      var insightData = results[1];

      if (!campData.ok) { toast(campData.error, true); return; }
      campaigns = campData.campaigns || [];
      insights = (insightData.ok && insightData.insights && insightData.insights[0]) || null;

      renderOverview();
    }).catch(function (err) {
      console.error('[ads-admin] Load overview error:', err);
      toast(t('Indlæsningsfejl', 'Load error'), true);
    });
  }

  function loadAdSets(campaignId, campaignName) {
    drillCampaign = { id: campaignId, name: campaignName };
    drillAdset = null;
    currentView = 'adsets';
    updateBreadcrumb();

    var wrap = $('yb-ads-content');
    wrap.innerHTML = '<p class="yb-admin__loading">' + t('Indlæser annoncegrupper…', 'Loading ad sets…') + '</p>';

    api('GET', { action: 'adsets', campaign_id: campaignId }).then(function (data) {
      if (!data.ok) { toast(data.error, true); return; }
      adsets = data.adsets || [];
      renderAdSets();
    }).catch(function (err) {
      toast(t('Fejl', 'Error'), true);
    });
  }

  function loadAds(adsetId, adsetName) {
    drillAdset = { id: adsetId, name: adsetName };
    currentView = 'ads';
    updateBreadcrumb();

    var wrap = $('yb-ads-content');
    wrap.innerHTML = '<p class="yb-admin__loading">' + t('Indlæser annoncer…', 'Loading ads…') + '</p>';

    api('GET', { action: 'ads', adset_id: adsetId }).then(function (data) {
      if (!data.ok) { toast(data.error, true); return; }
      ads = data.ads || [];
      renderAds();
    }).catch(function (err) {
      toast(t('Fejl', 'Error'), true);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */

  function renderOverview() {
    var wrap = $('yb-ads-content');
    if (!wrap) return;

    // Account-level stats cards
    var html = '<div class="yb-ads__stats-grid">';
    if (insights) {
      html += statsCard(t('Forbrug', 'Spend'), fmtCur(insights.spend), 'spend');
      html += statsCard(t('Visninger', 'Impressions'), fmtNum(insights.impressions), 'impressions');
      html += statsCard(t('Rækkevidde', 'Reach'), fmtNum(insights.reach), 'reach');
      html += statsCard(t('Klik', 'Clicks'), fmtNum(insights.clicks), 'clicks');
      html += statsCard('CTR', fmtPct(insights.ctr), 'ctr');
      html += statsCard('CPC', fmtCur(insights.cpc), 'cpc');
      var leads = extractAction(insights.actions, 'lead');
      html += statsCard('Leads', fmtNum(leads), 'leads');
      var costPerLead = leads > 0 ? (Number(insights.spend) / leads) : 0;
      html += statsCard(t('Pris/Lead', 'Cost/Lead'), costPerLead > 0 ? fmtCur(costPerLead) : '—', 'cost-per-lead');
    } else {
      html += '<p class="yb-admin__muted">' + t('Ingen data for den valgte periode', 'No data for selected period') + '</p>';
    }
    html += '</div>';

    // Campaign table
    html += '<div class="yb-ads__section-head"><h3>' + t('Kampagner', 'Campaigns') + ' (' + campaigns.length + ')</h3></div>';

    if (campaigns.length === 0) {
      html += '<p class="yb-admin__muted">' + t('Ingen kampagner fundet', 'No campaigns found') + '</p>';
    } else {
      html += '<div class="yb-admin__table-wrap"><table class="yb-admin__table yb-ads__table">';
      html += '<thead><tr>';
      html += '<th>' + t('Navn', 'Name') + '</th>';
      html += '<th>' + t('Status', 'Status') + '</th>';
      html += '<th>' + t('Mål', 'Objective') + '</th>';
      html += '<th>' + t('Budget', 'Budget') + '</th>';
      html += '<th>' + t('Handlinger', 'Actions') + '</th>';
      html += '</tr></thead><tbody>';

      campaigns.forEach(function (c) {
        var budget = c.daily_budget
          ? fmtCur(c.daily_budget / 100) + '/dag'
          : c.lifetime_budget
            ? fmtCur(c.lifetime_budget / 100) + ' total'
            : '—';

        html += '<tr>';
        html += '<td><a href="#" class="yb-ads__drill-link" data-drill="adsets" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">' + esc(c.name) + '</a></td>';
        html += '<td>' + statusBadge(c.effective_status) + '</td>';
        html += '<td>' + esc(c.objective || '—') + '</td>';
        html += '<td>' + budget + '</td>';
        html += '<td class="yb-ads__actions-cell">';
        if (c.effective_status === 'ACTIVE') {
          html += '<button class="yb-admin__small-btn" data-status-action="PAUSED" data-entity-id="' + esc(c.id) + '" title="' + t('Pause', 'Pause') + '">⏸</button>';
        } else if (c.effective_status === 'PAUSED') {
          html += '<button class="yb-admin__small-btn" data-status-action="ACTIVE" data-entity-id="' + esc(c.id) + '" title="' + t('Aktiver', 'Activate') + '">▶</button>';
        }
        html += '<button class="yb-admin__small-btn" data-budget-action data-entity-id="' + esc(c.id) + '" data-entity-level="campaign" data-current-daily="' + (c.daily_budget ? c.daily_budget / 100 : '') + '" data-current-lifetime="' + (c.lifetime_budget ? c.lifetime_budget / 100 : '') + '" title="' + t('Rediger budget', 'Edit budget') + '">💰</button>';
        html += '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    }

    wrap.innerHTML = html;
  }

  function renderAdSets() {
    var wrap = $('yb-ads-content');
    var html = '<div class="yb-ads__section-head"><h3>' + t('Annoncegrupper', 'Ad Sets') + ' (' + adsets.length + ')</h3></div>';

    if (adsets.length === 0) {
      html += '<p class="yb-admin__muted">' + t('Ingen annoncegrupper', 'No ad sets') + '</p>';
    } else {
      html += '<div class="yb-admin__table-wrap"><table class="yb-admin__table yb-ads__table">';
      html += '<thead><tr>';
      html += '<th>' + t('Navn', 'Name') + '</th>';
      html += '<th>' + t('Status', 'Status') + '</th>';
      html += '<th>' + t('Budget', 'Budget') + '</th>';
      html += '<th>' + t('Optimering', 'Optimization') + '</th>';
      html += '<th>' + t('Handlinger', 'Actions') + '</th>';
      html += '</tr></thead><tbody>';

      adsets.forEach(function (a) {
        var budget = a.daily_budget
          ? fmtCur(a.daily_budget / 100) + '/dag'
          : a.lifetime_budget
            ? fmtCur(a.lifetime_budget / 100) + ' total'
            : '—';

        html += '<tr>';
        html += '<td><a href="#" class="yb-ads__drill-link" data-drill="ads" data-id="' + esc(a.id) + '" data-name="' + esc(a.name) + '">' + esc(a.name) + '</a></td>';
        html += '<td>' + statusBadge(a.effective_status) + '</td>';
        html += '<td>' + budget + '</td>';
        html += '<td>' + esc(a.optimization_goal || '—') + '</td>';
        html += '<td class="yb-ads__actions-cell">';
        if (a.effective_status === 'ACTIVE') {
          html += '<button class="yb-admin__small-btn" data-status-action="PAUSED" data-entity-id="' + esc(a.id) + '">⏸</button>';
        } else if (a.effective_status === 'PAUSED') {
          html += '<button class="yb-admin__small-btn" data-status-action="ACTIVE" data-entity-id="' + esc(a.id) + '">▶</button>';
        }
        html += '<button class="yb-admin__small-btn" data-budget-action data-entity-id="' + esc(a.id) + '" data-entity-level="adset" data-current-daily="' + (a.daily_budget ? a.daily_budget / 100 : '') + '" data-current-lifetime="' + (a.lifetime_budget ? a.lifetime_budget / 100 : '') + '">💰</button>';
        html += '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    }

    wrap.innerHTML = html;
  }

  function renderAds() {
    var wrap = $('yb-ads-content');
    var html = '<div class="yb-ads__section-head"><h3>' + t('Annoncer', 'Ads') + ' (' + ads.length + ')</h3></div>';

    if (ads.length === 0) {
      html += '<p class="yb-admin__muted">' + t('Ingen annoncer', 'No ads') + '</p>';
    } else {
      html += '<div class="yb-admin__table-wrap"><table class="yb-admin__table yb-ads__table">';
      html += '<thead><tr>';
      html += '<th>' + t('Navn', 'Name') + '</th>';
      html += '<th>' + t('Status', 'Status') + '</th>';
      html += '<th>' + t('Oprettet', 'Created') + '</th>';
      html += '<th>' + t('Handlinger', 'Actions') + '</th>';
      html += '</tr></thead><tbody>';

      ads.forEach(function (a) {
        html += '<tr>';
        html += '<td>' + esc(a.name) + '</td>';
        html += '<td>' + statusBadge(a.effective_status) + '</td>';
        html += '<td>' + fmtDate(a.created_time) + '</td>';
        html += '<td class="yb-ads__actions-cell">';
        if (a.effective_status === 'ACTIVE') {
          html += '<button class="yb-admin__small-btn" data-status-action="PAUSED" data-entity-id="' + esc(a.id) + '">⏸</button>';
        } else if (a.effective_status === 'PAUSED') {
          html += '<button class="yb-admin__small-btn" data-status-action="ACTIVE" data-entity-id="' + esc(a.id) + '">▶</button>';
        }
        html += '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    }

    wrap.innerHTML = html;
  }

  function statsCard(label, value, key) {
    return '<div class="yb-ads__stat-card" data-stat="' + key + '">' +
      '<div class="yb-ads__stat-value">' + value + '</div>' +
      '<div class="yb-ads__stat-label">' + label + '</div>' +
      '</div>';
  }

  /* ── Breadcrumb ── */
  function updateBreadcrumb() {
    var bc = $('yb-ads-breadcrumb');
    if (!bc) return;

    var parts = ['<a href="#" data-ads-nav="overview">' + t('Oversigt', 'Overview') + '</a>'];
    if (drillCampaign && (currentView === 'adsets' || currentView === 'ads')) {
      parts.push('<a href="#" data-ads-nav="adsets" data-id="' + esc(drillCampaign.id) + '" data-name="' + esc(drillCampaign.name) + '">' + esc(drillCampaign.name) + '</a>');
    }
    if (drillAdset && currentView === 'ads') {
      parts.push('<span>' + esc(drillAdset.name) + '</span>');
    }

    bc.innerHTML = parts.join(' <span class="yb-ads__bc-sep">›</span> ');
  }

  /* ═══════════════════════════════════════════════════════════════
     ACTIONS
     ═══════════════════════════════════════════════════════════════ */

  function handleStatusChange(entityId, newStatus) {
    if (!confirm(t(
      'Er du sikker på at du vil ændre status til ' + newStatus + '?',
      'Are you sure you want to change status to ' + newStatus + '?'
    ))) return;

    api('POST', { action: 'update-status' }, { id: entityId, status: newStatus }).then(function (data) {
      if (data.ok) {
        toast(t('Status opdateret', 'Status updated'));
        refreshCurrentView();
      } else {
        toast(data.error || t('Fejl', 'Error'), true);
      }
    }).catch(function () { toast(t('Netværksfejl', 'Network error'), true); });
  }

  function handleBudgetEdit(entityId, level, currentDaily, currentLifetime) {
    var isDaily = !!currentDaily;
    var label = isDaily
      ? t('Nyt dagligt budget (DKK):', 'New daily budget (DKK):')
      : t('Nyt samlet budget (DKK):', 'New lifetime budget (DKK):');
    var current = isDaily ? currentDaily : currentLifetime;

    var newVal = prompt(label, current || '');
    if (newVal === null || newVal === '') return;

    var num = parseFloat(newVal);
    if (isNaN(num) || num <= 0) {
      toast(t('Ugyldigt beløb', 'Invalid amount'), true);
      return;
    }

    var body = { id: entityId, level: level };
    if (isDaily) body.daily_budget = num;
    else body.lifetime_budget = num;

    api('POST', { action: 'update-budget' }, body).then(function (data) {
      if (data.ok) {
        toast(t('Budget opdateret', 'Budget updated'));
        refreshCurrentView();
      } else {
        toast(data.error || t('Fejl', 'Error'), true);
      }
    }).catch(function () { toast(t('Netværksfejl', 'Network error'), true); });
  }

  function refreshCurrentView() {
    switch (currentView) {
      case 'overview': loadOverview(); break;
      case 'adsets': if (drillCampaign) loadAdSets(drillCampaign.id, drillCampaign.name); break;
      case 'ads': if (drillAdset) loadAds(drillAdset.id, drillAdset.name); break;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     EVENT HANDLERS
     ═══════════════════════════════════════════════════════════════ */

  function initAdsAdmin() {
    var panel = document.querySelector('[data-yb-admin-panel="ads"]');
    if (!panel) return;

    // Account selector
    var sel = $('yb-ads-account');
    if (sel) {
      sel.addEventListener('change', function () {
        currentAccount = sel.value;
        loadOverview();
      });
    }

    // Date range selector
    var rangeSel = $('yb-ads-range');
    if (rangeSel) {
      rangeSel.addEventListener('change', function () {
        dateRange = parseInt(rangeSel.value) || 7;
        loadOverview();
      });
    }

    // Refresh button
    var refreshBtn = $('yb-ads-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshCurrentView();
      });
    }

    // Delegated event handlers on content area
    var content = $('yb-ads-content');
    if (content) {
      content.addEventListener('click', function (e) {
        // Drill-down links
        var drillLink = e.target.closest('[data-drill]');
        if (drillLink) {
          e.preventDefault();
          var drill = drillLink.getAttribute('data-drill');
          var id = drillLink.getAttribute('data-id');
          var name = drillLink.getAttribute('data-name');
          if (drill === 'adsets') loadAdSets(id, name);
          else if (drill === 'ads') loadAds(id, name);
          return;
        }

        // Status toggle buttons
        var statusBtn = e.target.closest('[data-status-action]');
        if (statusBtn) {
          handleStatusChange(
            statusBtn.getAttribute('data-entity-id'),
            statusBtn.getAttribute('data-status-action')
          );
          return;
        }

        // Budget edit buttons
        var budgetBtn = e.target.closest('[data-budget-action]');
        if (budgetBtn) {
          handleBudgetEdit(
            budgetBtn.getAttribute('data-entity-id'),
            budgetBtn.getAttribute('data-entity-level'),
            budgetBtn.getAttribute('data-current-daily'),
            budgetBtn.getAttribute('data-current-lifetime')
          );
          return;
        }
      });
    }

    // Breadcrumb navigation
    var bc = $('yb-ads-breadcrumb');
    if (bc) {
      bc.addEventListener('click', function (e) {
        var nav = e.target.closest('[data-ads-nav]');
        if (!nav) return;
        e.preventDefault();
        var target = nav.getAttribute('data-ads-nav');
        if (target === 'overview') {
          drillCampaign = null;
          drillAdset = null;
          loadOverview();
        } else if (target === 'adsets') {
          drillAdset = null;
          loadAdSets(nav.getAttribute('data-id'), nav.getAttribute('data-name'));
        }
      });
    }

    // Load accounts when tab becomes visible
    loadAccounts();
  }

  /* ── Wait for tab activation ── */
  document.addEventListener('click', function (e) {
    var tabBtn = e.target.closest('[data-yb-admin-tab="ads"]');
    if (tabBtn && !loaded) {
      // Small delay to let the panel become visible
      setTimeout(initAdsAdmin, 100);
    }
  });

  // Also init if tab is already active (deep link)
  document.addEventListener('DOMContentLoaded', function () {
    var panel = document.querySelector('[data-yb-admin-panel="ads"]');
    if (panel && panel.classList.contains('is-active')) {
      initAdsAdmin();
    }
  });
})();
