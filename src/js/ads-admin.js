/**
 * Ads Admin — Meta Ads Manager for Yoga Bible + Hot Yoga CPH
 * Rich admin panel with inline insights, creative preview, status filters, sorting.
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
  var currentView = 'overview';
  var drillCampaign = null;
  var drillAdset = null;
  var statusFilter = 'ALL';
  var sortCol = '';
  var sortAsc = true;
  var expandedCreatives = {};

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
  var loc = lang === 'en' ? 'en-US' : 'da-DK';
  function fmtNum(n) {
    if (n === undefined || n === null || n === '') return '—';
    return Number(n).toLocaleString(loc);
  }
  function fmtCur(n) {
    if (n === undefined || n === null || n === '') return '—';
    var v = Number(n);
    if (isNaN(v)) return '—';
    return v.toLocaleString(loc, { style: 'currency', currency: 'DKK', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    if (n === undefined || n === null || n === '') return '—';
    return Number(n).toFixed(2) + '%';
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString(loc, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtCompact(n) {
    if (n === undefined || n === null) return '—';
    var v = Number(n);
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return v.toLocaleString(loc);
  }

  /* ── Status Helpers ── */
  function statusBadge(status) {
    var s = (status || '').toUpperCase();
    var dotCls = 'yb-ads__status-dot';
    var label = s;
    switch (s) {
      case 'ACTIVE': dotCls += ' yb-ads__status-dot--active'; label = t('Aktiv', 'Active'); break;
      case 'PAUSED': dotCls += ' yb-ads__status-dot--paused'; label = t('Pauset', 'Paused'); break;
      case 'ARCHIVED': dotCls += ' yb-ads__status-dot--archived'; label = t('Arkiveret', 'Archived'); break;
      default: dotCls += ' yb-ads__status-dot--paused'; break;
    }
    return '<span class="yb-ads__status-badge"><span class="' + dotCls + '"></span>' + label + '</span>';
  }

  function objectiveBadge(obj) {
    if (!obj) return '—';
    var map = {
      'OUTCOME_LEADS': { label: 'Leads', cls: 'yb-ads__obj--leads' },
      'OUTCOME_TRAFFIC': { label: 'Traffic', cls: 'yb-ads__obj--traffic' },
      'OUTCOME_AWARENESS': { label: 'Awareness', cls: 'yb-ads__obj--awareness' },
      'OUTCOME_SALES': { label: 'Sales', cls: 'yb-ads__obj--sales' },
      'OUTCOME_ENGAGEMENT': { label: 'Engagement', cls: 'yb-ads__obj--engagement' },
      'LINK_CLICKS': { label: 'Link Clicks', cls: 'yb-ads__obj--traffic' }
    };
    var m = map[obj] || { label: obj.replace('OUTCOME_', ''), cls: 'yb-ads__obj--default' };
    return '<span class="yb-ads__obj-badge ' + m.cls + '">' + m.label + '</span>';
  }

  function extractAction(actions, type) {
    if (!actions || !Array.isArray(actions)) return 0;
    for (var i = 0; i < actions.length; i++) {
      if (actions[i].action_type === type) return Number(actions[i].value);
    }
    return 0;
  }

  /* ── SVG Icons ── */
  var ICONS = {
    spend: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M9 9h4.5a2.5 2.5 0 010 5H9"/></svg>',
    impressions: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    reach: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
    clicks: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 15l-2 5L9 9l11 4-5 2z"/><path d="M22 22l-5-5"/></svg>',
    ctr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    cpc: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>',
    leads: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
    costPerLead: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
    frequency: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
  };

  /* ── Skeleton Loader ── */
  function skeleton() {
    return '<div class="yb-ads__skeleton"><div class="yb-ads__skeleton-stats">' +
      '<div class="yb-ads__skeleton-card"></div>'.repeat(4) +
      '</div><div class="yb-ads__skeleton-table"><div class="yb-ads__skeleton-row"></div>'.repeat(5) +
      '</div></div>';
  }

  /* ═══════════════════════════════════════════════════════════════
     LOAD DATA
     ═══════════════════════════════════════════════════════════════ */

  function loadAccounts() {
    var wrap = $('yb-ads-content');
    if (!wrap) return;
    wrap.innerHTML = skeleton();

    api('GET', { action: 'accounts' }).then(function (data) {
      if (!data.ok) { toast(data.error || 'Error', true); return; }
      accounts = data.accounts || [];
      loaded = true;

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
    wrap.innerHTML = skeleton();

    // Show filter tabs
    showStatusFilter(true);

    Promise.all([
      api('GET', { action: 'campaigns-with-insights', account: currentAccount, range: dateRange }),
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
    showStatusFilter(true);

    var wrap = $('yb-ads-content');
    wrap.innerHTML = skeleton();

    api('GET', { action: 'adsets-with-insights', campaign_id: campaignId, range: dateRange }).then(function (data) {
      if (!data.ok) { toast(data.error, true); return; }
      adsets = data.adsets || [];
      renderAdSets();
    }).catch(function () { toast(t('Fejl', 'Error'), true); });
  }

  function loadAds(adsetId, adsetName) {
    drillAdset = { id: adsetId, name: adsetName };
    currentView = 'ads';
    updateBreadcrumb();
    showStatusFilter(false);

    var wrap = $('yb-ads-content');
    wrap.innerHTML = skeleton();

    api('GET', { action: 'ads-with-insights', adset_id: adsetId, range: dateRange }).then(function (data) {
      if (!data.ok) { toast(data.error, true); return; }
      ads = data.ads || [];
      renderAds();
    }).catch(function () { toast(t('Fejl', 'Error'), true); });
  }

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */

  function renderOverview() {
    var wrap = $('yb-ads-content');
    if (!wrap) return;

    // Account-level stats
    var html = '<div class="yb-ads__stats-grid">';
    if (insights) {
      var leads = extractAction(insights.actions, 'lead');
      var costPerLead = leads > 0 ? (Number(insights.spend) / leads) : 0;
      html += statsCard(t('Forbrug', 'Spend'), fmtCur(insights.spend), 'spend', ICONS.spend);
      html += statsCard(t('Visninger', 'Impressions'), fmtCompact(insights.impressions), 'impressions', ICONS.impressions);
      html += statsCard(t('Rækkevidde', 'Reach'), fmtCompact(insights.reach), 'reach', ICONS.reach);
      html += statsCard(t('Klik', 'Clicks'), fmtNum(insights.clicks), 'clicks', ICONS.clicks);
      html += statsCard('CTR', fmtPct(insights.ctr), 'ctr', ICONS.ctr);
      html += statsCard('CPC', fmtCur(insights.cpc), 'cpc', ICONS.cpc);
      html += statsCard('Leads', fmtNum(leads), 'leads', ICONS.leads);
      html += statsCard(t('Pris/Lead', 'Cost/Lead'), costPerLead > 0 ? fmtCur(costPerLead) : '—', 'cost-per-lead', ICONS.costPerLead);
      if (insights.frequency) {
        html += statsCard(t('Frekvens', 'Frequency'), Number(insights.frequency).toFixed(2), 'frequency', ICONS.frequency);
      }
    } else {
      html += '<div class="yb-ads__empty-stats">' +
        '<div class="yb-ads__empty-icon">' + ICONS.spend + '</div>' +
        '<p>' + t('Ingen data for den valgte periode', 'No data for selected period') + '</p></div>';
    }
    html += '</div>';

    // Status summary
    var activeCt = 0, pausedCt = 0, archivedCt = 0;
    campaigns.forEach(function (c) {
      var s = (c.effective_status || '').toUpperCase();
      if (s === 'ACTIVE') activeCt++;
      else if (s === 'PAUSED') pausedCt++;
      else archivedCt++;
    });

    // Campaign table
    var filtered = filterByStatus(campaigns);
    html += '<div class="yb-ads__section-head">';
    html += '<h3>' + t('Kampagner', 'Campaigns') + ' <span class="yb-ads__count">' + filtered.length + '</span></h3>';
    html += '<div class="yb-ads__status-summary">';
    html += '<span class="yb-ads__summary-chip yb-ads__summary-chip--active">' + activeCt + ' ' + t('aktive', 'active') + '</span>';
    html += '<span class="yb-ads__summary-chip yb-ads__summary-chip--paused">' + pausedCt + ' ' + t('pausede', 'paused') + '</span>';
    if (archivedCt) html += '<span class="yb-ads__summary-chip yb-ads__summary-chip--archived">' + archivedCt + ' ' + t('arkiverede', 'archived') + '</span>';
    html += '</div></div>';

    if (filtered.length === 0) {
      html += '<div class="yb-ads__empty"><p>' + t('Ingen kampagner matcher filteret', 'No campaigns match filter') + '</p></div>';
    } else {
      // Sort
      if (sortCol) filtered = sortItems(filtered, sortCol);

      html += '<div class="yb-admin__table-wrap"><table class="yb-admin__table yb-ads__table yb-ads__table--rich">';
      html += '<thead><tr>';
      html += sortTh('name', t('Kampagne', 'Campaign'));
      html += sortTh('effective_status', t('Status', 'Status'));
      html += sortTh('objective', t('Mål', 'Objective'));
      html += sortTh('budget', t('Budget', 'Budget'));
      html += sortTh('spend', t('Forbrug', 'Spend'));
      html += sortTh('impressions', t('Visninger', 'Impr.'));
      html += sortTh('clicks', t('Klik', 'Clicks'));
      html += sortTh('leads', 'Leads');
      html += sortTh('cpl', 'CPL');
      html += '<th class="yb-ads__th-actions">' + t('Handlinger', 'Actions') + '</th>';
      html += '</tr></thead><tbody>';

      filtered.forEach(function (c) {
        var ins = c.insights;
        var budget = c.daily_budget
          ? fmtCur(c.daily_budget / 100) + '<small>/' + t('dag', 'day') + '</small>'
          : c.lifetime_budget
            ? fmtCur(c.lifetime_budget / 100) + '<small> total</small>'
            : '<span class="yb-ads__muted">—</span>';
        var spend = ins ? fmtCur(ins.spend) : '<span class="yb-ads__muted">—</span>';
        var impr = ins ? fmtCompact(ins.impressions) : '<span class="yb-ads__muted">—</span>';
        var clicks = ins ? fmtNum(ins.clicks) : '<span class="yb-ads__muted">—</span>';
        var leads = ins ? extractAction(ins.actions, 'lead') : 0;
        var leadsStr = leads > 0 ? '<span class="yb-ads__leads-val">' + leads + '</span>' : '<span class="yb-ads__muted">—</span>';
        var cpl = (ins && leads > 0) ? fmtCur(Number(ins.spend) / leads) : '<span class="yb-ads__muted">—</span>';

        html += '<tr class="yb-ads__campaign-row">';
        html += '<td class="yb-ads__name-cell"><a href="#" class="yb-ads__drill-link" data-drill="adsets" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">' + esc(c.name) + '</a></td>';
        html += '<td>' + statusBadge(c.effective_status) + '</td>';
        html += '<td>' + objectiveBadge(c.objective) + '</td>';
        html += '<td class="yb-ads__num-cell">' + budget + '</td>';
        html += '<td class="yb-ads__num-cell">' + spend + '</td>';
        html += '<td class="yb-ads__num-cell">' + impr + '</td>';
        html += '<td class="yb-ads__num-cell">' + clicks + '</td>';
        html += '<td class="yb-ads__num-cell">' + leadsStr + '</td>';
        html += '<td class="yb-ads__num-cell">' + cpl + '</td>';
        html += '<td class="yb-ads__actions-cell">' + actionButtons(c) + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    }

    wrap.innerHTML = html;
  }

  function renderAdSets() {
    var wrap = $('yb-ads-content');
    var filtered = filterByStatus(adsets);

    var html = '<div class="yb-ads__section-head"><h3>' + t('Annoncegrupper', 'Ad Sets') +
      ' <span class="yb-ads__count">' + filtered.length + '</span></h3></div>';

    if (filtered.length === 0) {
      html += '<div class="yb-ads__empty"><p>' + t('Ingen annoncegrupper', 'No ad sets') + '</p></div>';
    } else {
      if (sortCol) filtered = sortItems(filtered, sortCol);

      html += '<div class="yb-admin__table-wrap"><table class="yb-admin__table yb-ads__table yb-ads__table--rich">';
      html += '<thead><tr>';
      html += sortTh('name', t('Annoncegruppe', 'Ad Set'));
      html += sortTh('effective_status', t('Status', 'Status'));
      html += sortTh('budget', t('Budget', 'Budget'));
      html += sortTh('optimization_goal', t('Optimering', 'Optimization'));
      html += sortTh('spend', t('Forbrug', 'Spend'));
      html += sortTh('impressions', t('Visninger', 'Impr.'));
      html += sortTh('clicks', t('Klik', 'Clicks'));
      html += sortTh('leads', 'Leads');
      html += '<th class="yb-ads__th-actions">' + t('Handlinger', 'Actions') + '</th>';
      html += '</tr></thead><tbody>';

      filtered.forEach(function (a) {
        var ins = a.insights;
        var budget = a.daily_budget
          ? fmtCur(a.daily_budget / 100) + '<small>/' + t('dag', 'day') + '</small>'
          : a.lifetime_budget
            ? fmtCur(a.lifetime_budget / 100) + '<small> total</small>'
            : '<span class="yb-ads__muted">—</span>';
        var spend = ins ? fmtCur(ins.spend) : '<span class="yb-ads__muted">—</span>';
        var impr = ins ? fmtCompact(ins.impressions) : '<span class="yb-ads__muted">—</span>';
        var clicks = ins ? fmtNum(ins.clicks) : '<span class="yb-ads__muted">—</span>';
        var leads = ins ? extractAction(ins.actions, 'lead') : 0;
        var leadsStr = leads > 0 ? '<span class="yb-ads__leads-val">' + leads + '</span>' : '<span class="yb-ads__muted">—</span>';

        // Targeting summary
        var targeting = '';
        if (a.targeting) {
          var parts = [];
          if (a.targeting.geo_locations && a.targeting.geo_locations.countries) {
            parts.push(a.targeting.geo_locations.countries.join(', '));
          }
          if (a.targeting.age_min || a.targeting.age_max) {
            parts.push((a.targeting.age_min || '?') + '-' + (a.targeting.age_max || '?'));
          }
          targeting = parts.length ? '<div class="yb-ads__targeting-hint">' + esc(parts.join(' · ')) + '</div>' : '';
        }

        html += '<tr>';
        html += '<td class="yb-ads__name-cell"><a href="#" class="yb-ads__drill-link" data-drill="ads" data-id="' + esc(a.id) + '" data-name="' + esc(a.name) + '">' + esc(a.name) + '</a>' + targeting + '</td>';
        html += '<td>' + statusBadge(a.effective_status) + '</td>';
        html += '<td class="yb-ads__num-cell">' + budget + '</td>';
        html += '<td>' + esc(formatOptGoal(a.optimization_goal)) + '</td>';
        html += '<td class="yb-ads__num-cell">' + spend + '</td>';
        html += '<td class="yb-ads__num-cell">' + impr + '</td>';
        html += '<td class="yb-ads__num-cell">' + clicks + '</td>';
        html += '<td class="yb-ads__num-cell">' + leadsStr + '</td>';
        html += '<td class="yb-ads__actions-cell">' + actionButtons(a) + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
    }

    wrap.innerHTML = html;
  }

  function renderAds() {
    var wrap = $('yb-ads-content');
    var html = '<div class="yb-ads__section-head"><h3>' + t('Annoncer', 'Ads') +
      ' <span class="yb-ads__count">' + ads.length + '</span></h3></div>';

    if (ads.length === 0) {
      html += '<div class="yb-ads__empty"><p>' + t('Ingen annoncer', 'No ads') + '</p></div>';
    } else {
      html += '<div class="yb-ads__ads-grid">';
      ads.forEach(function (a) {
        html += renderAdCard(a);
      });
      html += '</div>';
    }

    wrap.innerHTML = html;
  }

  function renderAdCard(a) {
    var ins = a.insights;
    var creative = a.creative || {};
    var imgUrl = creative.image_url || creative.thumbnail_url || '';
    var body = creative.body || '';
    var title = creative.title || '';

    // Extract from object_story_spec if direct fields empty
    if (!body && creative.object_story_spec) {
      var spec = creative.object_story_spec;
      if (spec.link_data) {
        body = spec.link_data.message || '';
        title = title || spec.link_data.name || spec.link_data.link || '';
        imgUrl = imgUrl || spec.link_data.image_url || spec.link_data.picture || '';
      }
    }

    var html = '<div class="yb-ads__ad-card">';

    // Header
    html += '<div class="yb-ads__ad-card-header">';
    html += '<div class="yb-ads__ad-card-name">' + esc(a.name) + '</div>';
    html += '<div class="yb-ads__ad-card-status">' + statusBadge(a.effective_status) + '</div>';
    html += '</div>';

    // Creative preview
    if (imgUrl || body || title) {
      html += '<div class="yb-ads__creative-preview">';
      if (imgUrl) {
        html += '<div class="yb-ads__creative-img"><img src="' + esc(imgUrl) + '" alt="Ad creative" loading="lazy"></div>';
      }
      if (title) {
        html += '<div class="yb-ads__creative-title">' + esc(title) + '</div>';
      }
      if (body) {
        var shortBody = body.length > 120 ? body.substring(0, 120) + '…' : body;
        html += '<div class="yb-ads__creative-body">' + esc(shortBody) + '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="yb-ads__creative-preview yb-ads__creative-preview--empty">';
      html += '<span class="yb-ads__muted">' + t('Ingen forhåndsvisning', 'No preview available') + '</span>';
      html += '</div>';
    }

    // Metrics
    if (ins) {
      var leads = extractAction(ins.actions, 'lead');
      html += '<div class="yb-ads__ad-metrics">';
      html += metricPill(t('Forbrug', 'Spend'), fmtCur(ins.spend));
      html += metricPill(t('Visninger', 'Impr.'), fmtCompact(ins.impressions));
      html += metricPill(t('Klik', 'Clicks'), fmtNum(ins.clicks));
      html += metricPill('CTR', fmtPct(ins.ctr));
      if (leads > 0) {
        html += metricPill('Leads', leads);
        html += metricPill('CPL', fmtCur(Number(ins.spend) / leads));
      }
      html += '</div>';
    } else {
      html += '<div class="yb-ads__ad-metrics yb-ads__ad-metrics--empty">';
      html += '<span class="yb-ads__muted">' + t('Ingen data', 'No data') + '</span>';
      html += '</div>';
    }

    // Actions
    html += '<div class="yb-ads__ad-card-actions">';
    if (a.effective_status === 'ACTIVE') {
      html += '<button class="yb-ads__action-btn yb-ads__action-btn--pause" data-status-action="PAUSED" data-entity-id="' + esc(a.id) + '" title="' + t('Pause', 'Pause') + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> ' +
        t('Pause', 'Pause') + '</button>';
    } else if (a.effective_status === 'PAUSED') {
      html += '<button class="yb-ads__action-btn yb-ads__action-btn--play" data-status-action="ACTIVE" data-entity-id="' + esc(a.id) + '" title="' + t('Aktiver', 'Activate') + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> ' +
        t('Aktiver', 'Activate') + '</button>';
    }
    html += '<button class="yb-ads__action-btn yb-ads__action-btn--preview" data-preview-action data-ad-id="' + esc(a.id) + '" title="' + t('Fuld forhåndsvisning', 'Full preview') + '">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg> ' +
      t('Detaljer', 'Details') + '</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function metricPill(label, value) {
    return '<div class="yb-ads__metric-pill"><span class="yb-ads__metric-label">' + label + '</span><span class="yb-ads__metric-value">' + value + '</span></div>';
  }

  function statsCard(label, value, key, icon) {
    return '<div class="yb-ads__stat-card" data-stat="' + key + '">' +
      '<div class="yb-ads__stat-icon">' + (icon || '') + '</div>' +
      '<div class="yb-ads__stat-value">' + value + '</div>' +
      '<div class="yb-ads__stat-label">' + label + '</div>' +
      '</div>';
  }

  function actionButtons(entity) {
    var html = '';
    if (entity.effective_status === 'ACTIVE') {
      html += '<button class="yb-ads__action-btn yb-ads__action-btn--pause" data-status-action="PAUSED" data-entity-id="' + esc(entity.id) + '" title="' + t('Pause', 'Pause') + '">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>';
    } else if (entity.effective_status === 'PAUSED') {
      html += '<button class="yb-ads__action-btn yb-ads__action-btn--play" data-status-action="ACTIVE" data-entity-id="' + esc(entity.id) + '" title="' + t('Aktiver', 'Activate') + '">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>';
    }
    html += '<button class="yb-ads__action-btn yb-ads__action-btn--budget" data-budget-action data-entity-id="' + esc(entity.id) + '" data-entity-level="' + (entity.campaign_id ? 'adset' : 'campaign') + '" data-current-daily="' + (entity.daily_budget ? entity.daily_budget / 100 : '') + '" data-current-lifetime="' + (entity.lifetime_budget ? entity.lifetime_budget / 100 : '') + '" title="' + t('Budget', 'Budget') + '">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M9 9h4.5a2.5 2.5 0 010 5H9"/></svg></button>';
    html += '<button class="yb-ads__action-btn yb-ads__action-btn--duplicate" data-duplicate-action data-entity-id="' + esc(entity.id) + '" data-entity-level="' + (entity.campaign_id ? 'adset' : 'campaign') + '" title="' + t('Dupliker', 'Duplicate') + '">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>';
    return html;
  }

  /* ── Sorting ── */
  function sortTh(col, label) {
    var arrow = '';
    if (sortCol === col) arrow = sortAsc ? ' ↑' : ' ↓';
    return '<th class="yb-ads__sortable-th" data-sort-col="' + col + '">' + label + arrow + '</th>';
  }

  function sortItems(items, col) {
    var copy = items.slice();
    copy.sort(function (a, b) {
      var va = getSortVal(a, col);
      var vb = getSortVal(b, col);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return copy;
  }

  function getSortVal(item, col) {
    var ins = item.insights;
    switch (col) {
      case 'name': return (item.name || '').toLowerCase();
      case 'effective_status': return item.effective_status || '';
      case 'objective': return item.objective || '';
      case 'optimization_goal': return item.optimization_goal || '';
      case 'budget':
        return (item.daily_budget || item.lifetime_budget || 0) / 100;
      case 'spend': return ins ? Number(ins.spend || 0) : -1;
      case 'impressions': return ins ? Number(ins.impressions || 0) : -1;
      case 'clicks': return ins ? Number(ins.clicks || 0) : -1;
      case 'leads': return ins ? extractAction(ins.actions, 'lead') : -1;
      case 'cpl':
        if (!ins) return 999999;
        var l = extractAction(ins.actions, 'lead');
        return l > 0 ? Number(ins.spend) / l : 999999;
      default: return '';
    }
  }

  /* ── Filtering ── */
  function filterByStatus(items) {
    if (statusFilter === 'ALL') return items;
    return items.filter(function (item) {
      return (item.effective_status || '').toUpperCase() === statusFilter;
    });
  }

  function showStatusFilter(show) {
    var filterWrap = $('yb-ads-status-filter');
    if (filterWrap) filterWrap.style.display = show ? 'flex' : 'none';
  }

  function formatOptGoal(goal) {
    if (!goal) return '—';
    return goal.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).replace(/Lead Generation/i, 'Lead Gen');
  }

  /* ── Breadcrumb ── */
  function updateBreadcrumb() {
    var bc = $('yb-ads-breadcrumb');
    if (!bc) return;

    var parts = ['<a href="#" data-ads-nav="overview" class="yb-ads__bc-home">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> ' +
      t('Oversigt', 'Overview') + '</a>'];

    if (drillCampaign && (currentView === 'adsets' || currentView === 'ads')) {
      parts.push('<a href="#" data-ads-nav="adsets" data-id="' + esc(drillCampaign.id) + '" data-name="' + esc(drillCampaign.name) + '">' + esc(drillCampaign.name) + '</a>');
    }
    if (drillAdset && currentView === 'ads') {
      parts.push('<span class="yb-ads__bc-current">' + esc(drillAdset.name) + '</span>');
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

    var btn = document.querySelector('[data-status-action][data-entity-id="' + entityId + '"]');
    if (btn) { btn.disabled = true; btn.classList.add('yb-btn--muted'); }

    api('POST', { action: 'update-status' }, { id: entityId, status: newStatus }).then(function (data) {
      if (data.ok) {
        toast(t('Status opdateret', 'Status updated'));
        refreshCurrentView();
      } else {
        toast(data.error || t('Fejl', 'Error'), true);
        if (btn) { btn.disabled = false; btn.classList.remove('yb-btn--muted'); }
      }
    }).catch(function () {
      toast(t('Netværksfejl', 'Network error'), true);
      if (btn) { btn.disabled = false; btn.classList.remove('yb-btn--muted'); }
    });
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

    var budgetBtn = document.querySelector('[data-budget-action][data-entity-id="' + entityId + '"]');
    if (budgetBtn) { budgetBtn.disabled = true; budgetBtn.classList.add('yb-btn--muted'); }

    api('POST', { action: 'update-budget' }, body).then(function (data) {
      if (data.ok) {
        toast(t('Budget opdateret', 'Budget updated'));
        refreshCurrentView();
      } else {
        toast(data.error || t('Fejl', 'Error'), true);
        if (budgetBtn) { budgetBtn.disabled = false; budgetBtn.classList.remove('yb-btn--muted'); }
      }
    }).catch(function () {
      toast(t('Netværksfejl', 'Network error'), true);
      if (budgetBtn) { budgetBtn.disabled = false; budgetBtn.classList.remove('yb-btn--muted'); }
    });
  }

  function handleDuplicate(entityId, level) {
    if (!confirm(t('Dupliker denne ' + (level === 'campaign' ? 'kampagne' : 'annoncegruppe') + '?',
      'Duplicate this ' + level + '?'))) return;

    var dupBtn = document.querySelector('[data-duplicate-action][data-entity-id="' + entityId + '"]');
    if (dupBtn) { dupBtn.disabled = true; dupBtn.classList.add('yb-btn--muted'); }

    api('POST', { action: 'duplicate' }, { id: entityId, level: level }).then(function (data) {
      if (data.ok) {
        toast(t('Duplikeret (pauset)', 'Duplicated (paused)'));
        refreshCurrentView();
      } else {
        toast(data.error || t('Fejl', 'Error'), true);
        if (dupBtn) { dupBtn.disabled = false; dupBtn.classList.remove('yb-btn--muted'); }
      }
    }).catch(function () {
      toast(t('Netværksfejl', 'Network error'), true);
      if (dupBtn) { dupBtn.disabled = false; dupBtn.classList.remove('yb-btn--muted'); }
    });
  }

  function handleAdPreview(adId) {
    // Load full creative details in a modal-like overlay
    api('GET', { action: 'ad-preview', id: adId }).then(function (data) {
      if (!data.ok) { toast(data.error, true); return; }
      showAdPreviewModal(data.ad);
    }).catch(function () { toast(t('Fejl', 'Error'), true); });
  }

  function showAdPreviewModal(ad) {
    // Remove any existing modal
    var existing = document.querySelector('.yb-ads__preview-overlay');
    if (existing) existing.remove();

    var creative = ad.creative || {};
    var imgUrl = creative.image_url || creative.thumbnail_url || '';
    var body = creative.body || '';
    var title = creative.title || '';

    if (!body && creative.object_story_spec) {
      var spec = creative.object_story_spec;
      if (spec.link_data) {
        body = spec.link_data.message || '';
        title = title || spec.link_data.name || '';
        imgUrl = imgUrl || spec.link_data.image_url || spec.link_data.picture || '';
      }
    }

    var overlay = document.createElement('div');
    overlay.className = 'yb-ads__preview-overlay';
    overlay.innerHTML = '<div class="yb-ads__preview-modal">' +
      '<button class="yb-ads__preview-close" aria-label="Close">&times;</button>' +
      '<h3>' + esc(ad.name || 'Ad Preview') + '</h3>' +
      (imgUrl ? '<div class="yb-ads__preview-img"><img src="' + esc(imgUrl) + '" alt="Creative"></div>' : '') +
      (title ? '<div class="yb-ads__preview-title">' + esc(title) + '</div>' : '') +
      (body ? '<div class="yb-ads__preview-body">' + esc(body) + '</div>' : '') +
      '<div class="yb-ads__preview-meta">' +
      '<span>ID: ' + esc(ad.id || '') + '</span>' +
      '<span>' + t('Status', 'Status') + ': ' + esc(ad.status || '') + '</span>' +
      '</div></div>';

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.yb-ads__preview-close')) {
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
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
        sortCol = ''; sortAsc = true;
        loadOverview();
      });
    }

    // Date range selector
    var rangeSel = $('yb-ads-range');
    if (rangeSel) {
      rangeSel.addEventListener('change', function () {
        dateRange = parseInt(rangeSel.value) || 7;
        refreshCurrentView();
      });
    }

    // Refresh button
    var refreshBtn = $('yb-ads-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshBtn.classList.add('yb-ads__spin');
        setTimeout(function () { refreshBtn.classList.remove('yb-ads__spin'); }, 600);
        refreshCurrentView();
      });
    }

    // Status filter tabs
    var filterWrap = $('yb-ads-status-filter');
    if (filterWrap) {
      filterWrap.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-filter]');
        if (!btn) return;
        statusFilter = btn.getAttribute('data-filter');
        // Update active state
        filterWrap.querySelectorAll('[data-filter]').forEach(function (b) { b.classList.remove('yb-ads__filter--active'); });
        btn.classList.add('yb-ads__filter--active');
        // Re-render
        if (currentView === 'overview') renderOverview();
        else if (currentView === 'adsets') renderAdSets();
      });
    }

    // Delegated events on content area
    var content = $('yb-ads-content');
    if (content) {
      content.addEventListener('click', function (e) {
        // Drill-down links
        var drillLink = e.target.closest('[data-drill]');
        if (drillLink) {
          e.preventDefault();
          sortCol = ''; sortAsc = true;
          var drill = drillLink.getAttribute('data-drill');
          var id = drillLink.getAttribute('data-id');
          var name = drillLink.getAttribute('data-name');
          if (drill === 'adsets') loadAdSets(id, name);
          else if (drill === 'ads') loadAds(id, name);
          return;
        }

        // Sort headers
        var sortTh = e.target.closest('[data-sort-col]');
        if (sortTh) {
          var col = sortTh.getAttribute('data-sort-col');
          if (sortCol === col) sortAsc = !sortAsc;
          else { sortCol = col; sortAsc = true; }
          if (currentView === 'overview') renderOverview();
          else if (currentView === 'adsets') renderAdSets();
          return;
        }

        // Status toggle
        var statusBtn = e.target.closest('[data-status-action]');
        if (statusBtn) {
          handleStatusChange(statusBtn.getAttribute('data-entity-id'), statusBtn.getAttribute('data-status-action'));
          return;
        }

        // Budget edit
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

        // Duplicate
        var dupBtn = e.target.closest('[data-duplicate-action]');
        if (dupBtn) {
          handleDuplicate(dupBtn.getAttribute('data-entity-id'), dupBtn.getAttribute('data-entity-level'));
          return;
        }

        // Ad preview
        var previewBtn = e.target.closest('[data-preview-action]');
        if (previewBtn) {
          handleAdPreview(previewBtn.getAttribute('data-ad-id'));
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
        sortCol = ''; sortAsc = true;
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

    loadAccounts();
  }

  /* ── Wait for tab activation ── */
  document.addEventListener('click', function (e) {
    var tabBtn = e.target.closest('[data-yb-admin-tab="ads"]');
    if (tabBtn && !loaded) {
      setTimeout(initAdsAdmin, 100);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    var panel = document.querySelector('[data-yb-admin-panel="ads"]');
    if (panel && panel.classList.contains('is-active')) {
      initAdsAdmin();
    }
  });
})();
