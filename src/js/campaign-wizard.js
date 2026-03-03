/**
 * YOGA BIBLE — CAMPAIGN WIZARD
 * Full SMS & Email campaign system with multi-tab wizards,
 * rich filter engine, compose, preview, send with progress.
 *
 * Communicates with lead-admin.js via window._ybLeadData bridge.
 * Calls Netlify Functions for sending SMS/Email.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var bridge = null; // set on init
  var T = {};

  var campaignState = {
    type: null,       // 'sms' or 'email'
    tab: 'recipients',
    maxVisitedTab: 0, // highest tab index visited — allows free back-navigation
    filters: {
      source: 'all',
      statuses: [],
      programs: [],
      subtypes: [],
      routes: [],
      countries: [],
      periods: [],
      tracks: [],
      cohorts: [],
      paymentStatuses: [],
      recency: null,
      housing: false,
      meta: false,
      excludeConverted: false,
      excludeRecent: false,
      excludeNotInterested: true,
      excludeBadLeads: true,
      excludeUnsubscribed: true
    },
    allRecipients: [],
    selectedIds: new Set(),
    excludedIds: new Set(),
    searchTerm: '',

    // All leads/apps loaded for this campaign session (not limited to the current page)
    campaignLeads: [],
    campaignApps: [],
    recipientsLoading: false,

    // When opened from bulk bar: these IDs are pinned and survive filter changes
    pinnedIds: new Set(),

    // Compose state
    smsTemplateId: '',
    smsMessage: '',
    emailMode: 'template',   // 'template' | 'custom'
    emailTemplateId: '',
    emailTemplates: [],
    emailSubject: '',
    emailPreheader: '',
    emailBodyHtml: '',
    emailEditorMode: 'visual', // 'visual' | 'html'
    attachment: null,          // { name, type, data (base64) }

    // Send state
    provider: 'resend',  // 'gmail' | 'resend' — auto-set when wizard opens
    schedule: 'now',
    customSchedule: '',
    sending: false,
    results: null
  };

  /* ══════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════ */
  function t(k) { return T[k] || k; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* ══════════════════════════════════════════
     PERIOD HELPERS
     ══════════════════════════════════════════ */
  var MONTH_IDS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  var MONTH_LABELS = ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

  function getNextMonths(count) {
    var result = [];
    var now = new Date();
    for (var i = 0; i < count; i++) {
      var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      var mo = d.getMonth();
      var yr = d.getFullYear();
      result.push({ id: MONTH_IDS[mo], label: MONTH_LABELS[mo] + ' ' + yr });
    }
    return result;
  }

  /* ══════════════════════════════════════════
     COUNTRY DETECTION (ported from old system)
     ══════════════════════════════════════════ */
  var COUNTRY_FLAGS = {
    'DK': '\ud83c\udde9\ud83c\uddf0', 'SE': '\ud83c\uddf8\ud83c\uddea',
    'NO': '\ud83c\uddf3\ud83c\uddf4', 'DE': '\ud83c\udde9\ud83c\uddea',
    'NL': '\ud83c\uddf3\ud83c\uddf1', 'FI': '\ud83c\uddeb\ud83c\uddee',
    'GB': '\ud83c\uddec\ud83c\udde7', 'OTHER': '\ud83c\udf0d'
  };

  function detectCountry(lead) {
    var source = String(lead.source || '').toUpperCase();
    var phone = String(lead.phone || '').replace(/\s/g, '');

    // Check source for country codes
    if (/- DA[ -:]|- DA$/.test(source)) return 'DK';
    if (/- SE[ -:]|- SE$/.test(source)) return 'SE';
    if (/- NO[ -:]|- NO$/.test(source)) return 'NO';
    if (/- DE[ -:]|- DE$/.test(source)) return 'DE';
    if (/- NL[ -:]|- NL$/.test(source)) return 'NL';
    if (/- FI[ -:]|- FI$/.test(source)) return 'FI';
    if (/- EN[ -:]|- EN$/.test(source)) return 'GB';

    // Check phone prefix
    if (phone.startsWith('+45') || phone.startsWith('0045')) return 'DK';
    if (phone.startsWith('+46') || phone.startsWith('0046')) return 'SE';
    if (phone.startsWith('+47') || phone.startsWith('0047')) return 'NO';
    if (phone.startsWith('+49') || phone.startsWith('0049')) return 'DE';
    if (phone.startsWith('+31') || phone.startsWith('0031')) return 'NL';
    if (phone.startsWith('+358') || phone.startsWith('00358')) return 'FI';
    if (phone.startsWith('+44') || phone.startsWith('+1') || phone.startsWith('+353')) return 'GB';

    // Danish 8-digit without prefix
    if (phone.length === 8 && /^\d+$/.test(phone)) return 'DK';

    return 'OTHER';
  }

  function getFlag(countryCode) {
    return COUNTRY_FLAGS[countryCode] || COUNTRY_FLAGS.OTHER;
  }

  /* ══════════════════════════════════════════
     PROGRAM MATCHING (ported from old system)
     ══════════════════════════════════════════ */
  function matchesProgramType(lead, programId) {
    var prog = String(lead.program || '').toLowerCase();
    var type = String(lead.type || 'ytt').toLowerCase();
    var yttSub = String(lead.ytt_program_type || '').toLowerCase();
    var svc = String(lead.service || '').toLowerCase();
    var course = String(lead.course_name || '').toLowerCase();

    if (programId === '200h') {
      var isYtt = type === 'ytt';
      var hasWeekFormat = /\b(4|8|18).?(uge|week)/i.test(prog);
      var hasYttSubtype = /^(4|8|18)/i.test(yttSub);
      var has200 = /200/i.test(prog);
      return isYtt && (hasWeekFormat || hasYttSubtype || has200);
    }
    if (programId === '30h') return /\b30.?(h|hour|timer)/i.test(prog) || yttSub === '30h';
    if (programId === '50h') return /\b50.?(h|hour|timer)/i.test(prog) || yttSub === '50h';
    if (programId === '100h') return /\b100.?(h|hour|timer)/i.test(prog) || yttSub === '100h';
    if (programId === '300h') return /\b300.?(h|hour|timer)/i.test(prog) || yttSub === '300h';
    if (programId === 'course') return type === 'course' || type === 'bundle' || /inversions|backbends|splits|bundle/i.test(prog) || /inversions|backbends|splits|bundle/i.test(course);
    if (programId === 'mentorship') return type === 'mentorship' || /mentorship|personlig/i.test(prog) || /personlig|undervisning|business|mentor/i.test(svc);
    return false;
  }

  function matchesSubtype(lead, subtypeId) {
    var prog = String(lead.program || '').toLowerCase();
    var yttSub = String(lead.ytt_program_type || '').toLowerCase();
    var svc = String(lead.service || '').toLowerCase();
    var sub = String(lead.subcategories || '').toLowerCase();

    // 200H subtypes
    if (subtypeId === '4w') return /\b4.?(uge|week)/i.test(prog) || yttSub === '4-week' || yttSub === '4w';
    if (subtypeId === '8w') return /\b8.?(uge|week)/i.test(prog) || yttSub === '8-week' || yttSub === '8w';
    if (subtypeId === '18w') return /\b18.?(uge|week)/i.test(prog) || yttSub === '18-week' || yttSub === '18w';
    if (subtypeId === 'weekday') return /hverdag|weekday/i.test(prog);
    if (subtypeId === 'weekend') return /weekend/i.test(prog);

    // Course subtypes
    if (subtypeId === 'inversions') return /inversion/i.test(prog) || /inversion/i.test(sub) || /inversion/i.test(svc);
    if (subtypeId === 'backbends') return /backbend/i.test(prog) || /backbend/i.test(sub) || /backbend/i.test(svc);
    if (subtypeId === 'splits') return /split/i.test(prog) || /split/i.test(sub) || /split/i.test(svc);
    if (subtypeId === 'bundles') return /bundle/i.test(prog) || /bundle/i.test(sub) || /bundle/i.test(svc);

    // Mentorship subtypes
    if (subtypeId === 'personlig') return /personlig/i.test(svc) || /personlig/i.test(prog);
    if (subtypeId === 'undervisning') return /undervisning/i.test(svc) || /undervisning/i.test(prog);
    if (subtypeId === 'business') return /business/i.test(svc) || /business/i.test(prog);

    return false;
  }

  function matchesStatus(lead, statusId) {
    var status = String(lead.status || '').toLowerCase();
    if (statusId === 'new') return status === '' || status === 'new' || status.includes('ny');
    if (statusId === 'hot') return status.includes('hot') || status.includes('strongly');
    if (statusId === 'no-answer') return status.includes('no answer') || status.includes('ikke svar');
    if (statusId === 'contacted') return status.includes('contact');
    if (statusId === 'follow-up') return status.includes('follow');
    if (statusId === 'pending') return status.includes('pending') || status.includes('afventer');
    if (statusId === 'deposit') return status.includes('deposit') || status.includes('depositum');
    return false;
  }

  /* ══════════════════════════════════════════
     FILTER ENGINE
     ══════════════════════════════════════════ */
  function getAllLeads() {
    var result = [];
    var src = campaignState.filters.source;

    if (src === 'all' || src === 'leads') {
      // Prefer campaign-local full load; fall back to bridge's paginated array
      var lds = campaignState.campaignLeads.length > 0
        ? campaignState.campaignLeads
        : (bridge ? bridge.getLeads() || [] : []);
      lds.forEach(function (l) { l._source = 'lead'; result.push(l); });
    }
    if (src === 'all' || src === 'apps') {
      var apps = campaignState.campaignApps.length > 0
        ? campaignState.campaignApps
        : (bridge ? bridge.getApplications() || [] : []);
      apps.forEach(function (a) { a._source = 'app'; result.push(a); });
    }
    return result;
  }

  function applyFilters() {
    var all = getAllLeads();
    var f = campaignState.filters;
    var contactField = campaignState.type === 'sms' ? 'phone' : 'email';

    var filtered = all.filter(function (lead) {
      // Must have contact info
      if (!lead[contactField]) return false;

      // Status filter
      if (f.statuses.length > 0) {
        var matches = false;
        for (var i = 0; i < f.statuses.length; i++) {
          if (matchesStatus(lead, f.statuses[i])) { matches = true; break; }
        }
        if (!matches) return false;
      }

      // Program filter
      if (f.programs.length > 0) {
        var progMatch = false;
        for (var i = 0; i < f.programs.length; i++) {
          if (matchesProgramType(lead, f.programs[i])) { progMatch = true; break; }
        }
        if (!progMatch) return false;
      }

      // Subtype filter
      if (f.subtypes.length > 0) {
        var subMatch = false;
        for (var i = 0; i < f.subtypes.length; i++) {
          if (matchesSubtype(lead, f.subtypes[i])) { subMatch = true; break; }
        }
        if (!subMatch) return false;
      }

      // Route filter (weekday/weekend)
      if (f.routes.length > 0) {
        var routeMatch = false;
        for (var i = 0; i < f.routes.length; i++) {
          if (matchesSubtype(lead, f.routes[i])) { routeMatch = true; break; }
        }
        if (!routeMatch) return false;
      }

      // Track filter (applications)
      // Stored values may be "Hverdagsprogram"/"Weekendprogram" (DA) or "Weekday program"/"Weekend program" (EN)
      if (f.tracks.length > 0) {
        var track = String(lead.track || '').toLowerCase();
        var trackMatch = false;
        for (var i = 0; i < f.tracks.length; i++) {
          var fVal = f.tracks[i]; // 'weekday' or 'weekend'
          if (fVal === 'weekday' && (track === 'weekday' || track.indexOf('hverdag') !== -1 || track.indexOf('weekday') !== -1)) { trackMatch = true; break; }
          if (fVal === 'weekend' && (track === 'weekend' || track.indexOf('weekend') !== -1)) { trackMatch = true; break; }
        }
        if (!trackMatch) return false;
      }

      // Cohort filter (applications)
      if (f.cohorts.length > 0) {
        var cohort = lead.cohort_label || '';
        if (f.cohorts.indexOf(cohort) === -1) return false;
      }

      // Payment status filter (applications)
      if (f.paymentStatuses.length > 0) {
        var payChoice = lead.payment_choice || '';
        if (f.paymentStatuses.indexOf(payChoice) === -1) return false;
      }

      // Country filter
      if (f.countries.length > 0) {
        var country = detectCountry(lead);
        if (f.countries.indexOf(country) === -1) return false;
      }

      // Period filter
      if (f.periods.length > 0) {
        var preferred = String(lead.preferred_month || lead.cohort || '').toLowerCase();
        var periodMatch = false;
        for (var i = 0; i < f.periods.length; i++) {
          if (preferred.indexOf(f.periods[i]) !== -1) { periodMatch = true; break; }
        }
        if (!periodMatch) return false;
      }

      // Recency filter
      if (f.recency) {
        var created = lead.created_at;
        if (created && created.toDate) created = created.toDate();
        else if (created) created = new Date(created);
        if (created) {
          var now = new Date();
          var diffDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
          if (f.recency === '7d' && diffDays > 7) return false;
          if (f.recency === '30d' && diffDays > 30) return false;
          if (f.recency === 'older' && diffDays <= 30) return false;
        }
      }

      // Housing filter
      if (f.housing) {
        var accom = String(lead.accommodation || lead.housing || '').toLowerCase();
        if (!accom || accom === 'no' || accom === 'nej') return false;
      }

      // Meta ads filter
      if (f.meta) {
        var src = String(lead.source || '').toLowerCase();
        if (src.indexOf('meta') === -1 && src.indexOf('facebook') === -1 && src.indexOf('instagram') === -1) return false;
      }

      // Exclude filters
      if (f.excludeConverted) {
        var st = String(lead.status || '').toLowerCase();
        if (st === 'converted' || st.includes('konverteret')) return false;
      }
      if (f.excludeNotInterested) {
        var st2 = String(lead.status || '').toLowerCase();
        if (st2.includes('not interested') || st2.includes('ikke interesse')) return false;
      }
      if (f.excludeBadLeads) {
        var st3 = String(lead.status || '').toLowerCase();
        if (st3 === 'lost' || st3 === 'closed' || st3.includes('bad')) return false;
      }
      if (f.excludeUnsubscribed) {
        var st4 = String(lead.status || '').toLowerCase();
        if (st4 === 'unsubscribed' || st4.includes('afmeld')) return false;
      }
      if (f.excludeRecent) {
        // Check all possible field names for last contact timestamp
        var lastContact = lead.last_contact || lead.last_contact_at || lead.last_sms_at;
        if (lastContact) {
          if (lastContact.toDate) lastContact = lastContact.toDate();
          else lastContact = new Date(lastContact);
          var hoursSince = (new Date() - lastContact) / (1000 * 60 * 60);
          if (hoursSince < 48) return false; // Skip if contacted < 48h ago
        }
      }

      // Search term
      if (campaignState.searchTerm) {
        var term = campaignState.searchTerm.toLowerCase();
        var name = String(lead.first_name || '').toLowerCase() + ' ' + String(lead.last_name || '').toLowerCase();
        var email = String(lead.email || '').toLowerCase();
        var phone = String(lead.phone || '').toLowerCase();
        if (name.indexOf(term) === -1 && email.indexOf(term) === -1 && phone.indexOf(term) === -1) return false;
      }

      // Excluded IDs
      if (campaignState.excludedIds.has(lead.id)) return false;

      return true;
    });

    campaignState.allRecipients = filtered;

    var filteredIdSet = new Set(filtered.map(function (l) { return l.id; }));

    if (campaignState.pinnedIds.size > 0) {
      // Pinned mode: leads were pre-selected from the table — keep them even if filters change
      var allIds = new Set(filtered.map(function (l) { return l.id; }));
      campaignState.pinnedIds.forEach(function (id) {
        if (!allIds.has(id)) {
          var allPool = getAllLeads();
          var pinned = allPool.find(function (l) { return l.id === id; });
          if (pinned) { filtered.push(pinned); filteredIdSet.add(id); }
        }
        campaignState.selectedIds.add(id);
      });
      campaignState.selectedIds.forEach(function (id) {
        if (!filteredIdSet.has(id) && !campaignState.pinnedIds.has(id)) {
          campaignState.selectedIds.delete(id);
        }
      });
    } else {
      // No pinned leads — remove de-filtered IDs but never auto-select anything
      campaignState.selectedIds.forEach(function (id) {
        if (!filteredIdSet.has(id)) campaignState.selectedIds.delete(id);
      });
    }

    return filtered;
  }

  /* ══════════════════════════════════════════
     FILTER UI RENDERING
     ══════════════════════════════════════════ */
  function renderFilterPanel(container) {
    var f = campaignState.filters;
    var html = '';

    // Search
    html += '<div class="yb-lead__campaign-filter-section">' +
      '<input type="text" class="yb-lead__campaign-email-search" placeholder="' + esc(t('campaign_filter_search')) + '" id="yb-campaign-' + campaignState.type + '-filter-search" value="' + esc(campaignState.searchTerm) + '">' +
      '</div>';

    // Data source
    html += buildChipSection('campaign_filter_source', [
      { id: 'all', label: t('campaign_filter_source_all') },
      { id: 'leads', label: t('campaign_filter_source_leads') },
      { id: 'apps', label: t('campaign_filter_source_apps') }
    ], [f.source], 'source', true);

    // Status
    html += buildChipSection('campaign_filter_status', [
      { id: 'new', label: t('campaign_filter_status_new') },
      { id: 'hot', label: t('campaign_filter_status_hot') },
      { id: 'no-answer', label: t('campaign_filter_status_noanswer') },
      { id: 'contacted', label: t('campaign_filter_status_contacted') },
      { id: 'follow-up', label: t('campaign_filter_status_followup') },
      { id: 'pending', label: t('campaign_filter_status_pending') },
      { id: 'deposit', label: t('campaign_filter_status_deposit') }
    ], f.statuses, 'statuses');

    // Program
    html += buildChipSection('campaign_filter_program', [
      { id: '200h', label: t('campaign_filter_program_200h'), expandable: true },
      { id: '30h', label: t('campaign_filter_program_30h') },
      { id: '50h', label: t('campaign_filter_program_50h') },
      { id: '100h', label: t('campaign_filter_program_100h') },
      { id: '300h', label: t('campaign_filter_program_300h') }
    ], f.programs, 'programs');

    // 200H sub-options
    html += '<div class="yb-lead__campaign-suboptions' + (f.programs.indexOf('200h') !== -1 ? ' is-open' : '') + '" data-suboptions="200h">';
    html += buildChipGroup([
      { id: '4w', label: t('campaign_filter_program_4w') },
      { id: '8w', label: t('campaign_filter_program_8w') },
      { id: '18w', label: t('campaign_filter_program_18w') }
    ], f.subtypes, 'subtypes');
    // Route sub-options (under 18w)
    html += '<div class="yb-lead__campaign-suboptions' + (f.subtypes.indexOf('18w') !== -1 ? ' is-open' : '') + '" data-suboptions="18w">';
    html += buildChipGroup([
      { id: 'weekday', label: t('campaign_filter_program_weekday') },
      { id: 'weekend', label: t('campaign_filter_program_weekend') }
    ], f.routes, 'routes');
    html += '</div>';
    html += '</div>';

    // Courses
    html += buildChipSection('campaign_filter_courses', [
      { id: 'course', label: t('campaign_filter_courses_all'), expandable: true }
    ], f.programs, 'programs');

    // Course sub-options
    html += '<div class="yb-lead__campaign-suboptions' + (f.programs.indexOf('course') !== -1 ? ' is-open' : '') + '" data-suboptions="course">';
    html += buildChipGroup([
      { id: 'inversions', label: t('campaign_filter_courses_inversions') },
      { id: 'backbends', label: t('campaign_filter_courses_backbends') },
      { id: 'splits', label: t('campaign_filter_courses_splits') },
      { id: 'bundles', label: t('campaign_filter_courses_bundle') }
    ], f.subtypes, 'subtypes');
    html += '</div>';

    // Mentorship
    html += buildChipSection('campaign_filter_mentorship', [
      { id: 'mentorship', label: t('campaign_filter_mentorship'), expandable: true }
    ], f.programs, 'programs');

    html += '<div class="yb-lead__campaign-suboptions' + (f.programs.indexOf('mentorship') !== -1 ? ' is-open' : '') + '" data-suboptions="mentorship">';
    html += buildChipGroup([
      { id: 'personlig', label: t('campaign_filter_mentorship_personal') },
      { id: 'undervisning', label: t('campaign_filter_mentorship_teaching') },
      { id: 'business', label: t('campaign_filter_mentorship_business') }
    ], f.subtypes, 'subtypes');
    html += '</div>';

    // Country
    html += '<div class="yb-lead__campaign-filter-section">' +
      '<span class="yb-lead__campaign-filter-label">' + esc(t('campaign_filter_country')) + '</span>' +
      '<div class="yb-lead__campaign-chips">';
    ['DK', 'SE', 'NO', 'DE', 'NL', 'FI', 'GB', 'OTHER'].forEach(function (code) {
      var active = f.countries.indexOf(code) !== -1;
      html += '<button type="button" class="yb-lead__campaign-chip yb-lead__campaign-chip--country' + (active ? ' is-active' : '') + '" data-filter="countries" data-value="' + code + '">' +
        getFlag(code) + '</button>';
    });
    html += '</div></div>';

    // Period — dynamically generated: current month + next 11 months
    html += buildChipSection('campaign_filter_period', getNextMonths(12), f.periods, 'periods');

    // Track (Weekday / Weekend) — for applications
    html += buildChipSection('campaign_filter_track', [
      { id: 'weekday', label: t('campaign_filter_track_weekday') },
      { id: 'weekend', label: t('campaign_filter_track_weekend') }
    ], f.tracks, 'tracks');

    // Cohort — dynamically populated from loaded applications
    var cohortChips = [];
    try {
      var allApps = (bridge && bridge.getApplications) ? (bridge.getApplications() || []) : [];
      var seenCohorts = {};
      allApps.forEach(function (a) {
        var cl = a.cohort_label || '';
        if (cl && !seenCohorts[cl]) { seenCohorts[cl] = true; cohortChips.push({ id: cl, label: cl }); }
      });
      cohortChips.sort(function (a, b) { return a.label.localeCompare(b.label); });
    } catch (e) { /* ignore */ }
    if (cohortChips.length > 0) {
      html += buildChipSection('campaign_filter_cohort', cohortChips, f.cohorts, 'cohorts');
    }

    // Payment Status — for applications
    html += buildChipSection('campaign_filter_payment', [
      { id: 'paid_deposit', label: t('campaign_filter_payment_deposit') },
      { id: 'paid_full', label: t('campaign_filter_payment_full') },
      { id: 'pay_now', label: t('campaign_filter_payment_paynow') },
      { id: 'paid', label: t('campaign_filter_payment_legacy') }
    ], f.paymentStatuses, 'paymentStatuses');

    // Recency
    html += buildChipSection('campaign_filter_recency', [
      { id: '7d', label: t('campaign_filter_recency_7d') },
      { id: '30d', label: t('campaign_filter_recency_30d') },
      { id: 'older', label: t('campaign_filter_recency_older') }
    ], f.recency ? [f.recency] : [], 'recency', true);

    // Toggle filters
    html += '<div class="yb-lead__campaign-filter-section">';
    html += '<div class="yb-lead__campaign-chips">';
    html += '<button type="button" class="yb-lead__campaign-chip' + (f.housing ? ' is-active' : '') + '" data-filter="housing" data-value="toggle">' + t('campaign_filter_housing') + '</button>';
    html += '<button type="button" class="yb-lead__campaign-chip' + (f.meta ? ' is-active' : '') + '" data-filter="meta" data-value="toggle">' + t('campaign_filter_meta') + '</button>';
    html += '</div></div>';

    // Exclude section
    html += '<div class="yb-lead__campaign-filter-section">' +
      '<span class="yb-lead__campaign-filter-label">' + esc(t('campaign_filter_exclude')) + '</span>' +
      '<div class="yb-lead__campaign-exclude-list">';
    var excludes = [
      { key: 'excludeConverted', label: t('campaign_filter_exclude_converted') },
      { key: 'excludeRecent', label: t('campaign_filter_exclude_recent') },
      { key: 'excludeNotInterested', label: t('campaign_filter_exclude_notinterested') },
      { key: 'excludeBadLeads', label: t('campaign_filter_exclude_bad') },
      { key: 'excludeUnsubscribed', label: t('campaign_filter_exclude_unsub') }
    ];
    excludes.forEach(function (ex) {
      html += '<label class="yb-lead__campaign-exclude-item">' +
        '<input type="checkbox" data-exclude="' + ex.key + '"' + (f[ex.key] ? ' checked' : '') + '> ' + esc(ex.label) + '</label>';
    });
    html += '</div></div>';

    // Clear all
    html += '<button type="button" class="yb-lead__campaign-archive-btn" data-action="campaign-clear-filters">' + esc(t('campaign_filter_clear')) + '</button>';

    container.innerHTML = html;
  }

  function buildChipSection(labelKey, chips, activeList, filterKey, singleSelect) {
    var html = '<div class="yb-lead__campaign-filter-section">' +
      '<span class="yb-lead__campaign-filter-label">' + esc(t(labelKey)) + '</span>' +
      '<div class="yb-lead__campaign-chips">';
    chips.forEach(function (chip) {
      var active = activeList.indexOf(chip.id) !== -1;
      html += '<button type="button" class="yb-lead__campaign-chip' + (active ? ' is-active' : '') + '"' +
        ' data-filter="' + filterKey + '" data-value="' + chip.id + '"' +
        (singleSelect ? ' data-single="1"' : '') +
        (chip.expandable ? ' data-expandable="' + chip.id + '"' : '') +
        '>' + esc(chip.label) + (chip.expandable ? ' \u25be' : '') + '</button>';
    });
    html += '</div></div>';
    return html;
  }

  function buildChipGroup(chips, activeList, filterKey) {
    var html = '<div class="yb-lead__campaign-chips" style="margin-bottom:0.3rem">';
    chips.forEach(function (chip) {
      var active = activeList.indexOf(chip.id) !== -1;
      html += '<button type="button" class="yb-lead__campaign-chip' + (active ? ' is-active' : '') + '"' +
        ' data-filter="' + filterKey + '" data-value="' + chip.id + '"' +
        (chip.expandable ? ' data-expandable="' + chip.id + '"' : '') +
        '>' + esc(chip.label) + '</button>';
    });
    html += '</div>';
    return html;
  }

  /* ══════════════════════════════════════════
     STATUS BADGE COLORS
     ══════════════════════════════════════════ */
  var STATUS_BADGE = {
    'New':                { bg: '#F0EDE8', color: '#6F6A66' },
    'Contacted':          { bg: '#e3f2fd', color: '#1565c0' },
    'No Answer':          { bg: '#fff3e0', color: '#e65100' },
    'Follow-up':          { bg: '#fff8e1', color: '#f57f17' },
    'Engaged':            { bg: '#f3e5f5', color: '#6a1b9a' },
    'Qualified':          { bg: '#e8f5e9', color: '#2e7d32' },
    'Negotiating':        { bg: '#fce4ec', color: '#880e4f' },
    'Converted':          { bg: '#d4edda', color: '#155724' },
    'Existing Applicant': { bg: '#cce5ff', color: '#004085' },
    'On Hold':            { bg: '#eeeeee', color: '#616161' },
    'Not too keen':       { bg: '#ffeeba', color: '#856404' },
    'Unsubscribed':       { bg: '#ffeeba', color: '#856404' },
    'Lost':               { bg: '#f8d7da', color: '#721c24' },
    'Closed':             { bg: '#e2e3e5', color: '#383d41' },
    'Hot':                { bg: '#ff5252', color: '#fff' }
  };

  function getStatusBadge(status) {
    return STATUS_BADGE[status] || { bg: '#F0EDE8', color: '#6F6A66' };
  }

  /* ══════════════════════════════════════════
     RECIPIENT LIST RENDERING
     ══════════════════════════════════════════ */
  function renderRecipientList(container) {
    var recipients = campaignState.allRecipients;
    var selectedCount = campaignState.selectedIds.size;
    var contactField = campaignState.type === 'sms' ? 'phone' : 'email';
    var totalInPool = campaignState.campaignLeads.length + campaignState.campaignApps.length;

    // Header: count + match label on one line
    var totalNote = totalInPool > 0 && totalInPool > recipients.length
      ? ' <span class="yb-lead__campaign-rl-pool-note">(' + totalInPool + ' i alt)</span>'
      : '';
    var pinnedNote = campaignState.pinnedIds.size > 0
      ? ' <span class="yb-lead__campaign-rl-pinned-note">· ' + campaignState.pinnedIds.size + ' fastlåst fra bulk-valg</span>'
      : '';

    var html = '<div class="yb-lead__campaign-recipient-header">' +
      '<span class="yb-lead__campaign-recipient-count">' + recipients.length + '</span>' +
      '<span class="yb-lead__campaign-recipient-label">' + esc(t('campaign_recipients_count')) + '</span>' +
      totalNote + pinnedNote +
      '</div>';

    // Toolbar
    html += '<div class="yb-lead__campaign-recipient-toolbar">' +
      '<button type="button" data-action="campaign-select-all" class="yb-lead__campaign-rl-tbtn">' + esc(t('campaign_recipients_select_all')) + '</button>' +
      '<span class="yb-lead__campaign-rl-selected">' + selectedCount + ' ' + esc(t('campaign_recipients_selected')) + '</span>' +
      '<button type="button" data-action="campaign-deselect-all" class="yb-lead__campaign-rl-tbtn">' + esc(t('campaign_recipients_deselect_all')) + '</button>' +
      '</div>';

    if (recipients.length === 0) {
      html += '<div class="yb-lead__campaign-no-match">' + esc(t('campaign_recipients_no_match')) + '</div>';
    } else {
      html += '<div class="yb-lead__campaign-recipient-list">';

      recipients.forEach(function (lead) {
        var isSelected = campaignState.selectedIds.has(lead.id);
        var checked = isSelected ? ' checked' : '';
        var country = detectCountry(lead);
        var fullName = ((lead.first_name || '') + ' ' + (lead.last_name || '')).trim();
        var name = esc(fullName) || esc(lead.email || lead.phone || 'Unknown');
        var initial = (lead.first_name || lead.email || '?').charAt(0).toUpperCase();
        var contact = esc(lead[contactField] || '—');
        var prog = esc(lead.program || lead.type || lead.program_type || '');
        var status = lead.status || lead._source === 'app' ? (lead.status || 'Applicant') : 'Lead';
        var badge = getStatusBadge(status);
        var source = lead._source === 'app' ? 'app' : 'lead';

        html += '<label class="yb-lead__campaign-recipient-row' + (isSelected ? ' is-selected' : '') + '" data-lead-id="' + lead.id + '">' +
          '<input type="checkbox" class="yb-lead__campaign-recipient-check" data-action="campaign-toggle-recipient"' + checked + '>' +
          '<div class="yb-lead__campaign-ri-avatar">' + esc(initial) + '</div>' +
          '<div class="yb-lead__campaign-ri-body">' +
            '<div class="yb-lead__campaign-ri-top">' +
              '<span class="yb-lead__campaign-ri-name">' + name + '</span>' +
              '<span class="yb-lead__campaign-ri-status" style="background:' + badge.bg + ';color:' + badge.color + '">' + esc(status) + '</span>' +
            '</div>' +
            '<div class="yb-lead__campaign-ri-sub">' +
              '<span class="yb-lead__campaign-ri-flag">' + getFlag(country) + '</span>' +
              '<span class="yb-lead__campaign-ri-contact">' + contact + '</span>' +
              (prog ? '<span class="yb-lead__campaign-ri-dot">·</span><span class="yb-lead__campaign-ri-prog">' + prog + '</span>' : '') +
              (source === 'app' ? '<span class="yb-lead__campaign-ri-src">APP</span>' : '') +
            '</div>' +
          '</div>' +
        '</label>';
      });

      html += '</div>';
    }

    container.innerHTML = html;
  }

  /* ══════════════════════════════════════════
     RECIPIENTS TAB
     ══════════════════════════════════════════ */
  function renderRecipientsTab(panelEl) {
    applyFilters();

    var prefix = campaignState.type; // 'sms' or 'email'
    var loadingBanner = campaignState.recipientsLoading
      ? '<div class="yb-lead__campaign-loading-banner">Indlæser alle leads fra databasen…</div>'
      : '';

    panelEl.innerHTML = '<div class="yb-lead__campaign-recipients">' +
      loadingBanner +
      '<div class="yb-lead__campaign-filters" id="yb-campaign-' + prefix + '-filters-area"></div>' +
      '<div class="yb-lead__campaign-recipient-list-wrap" id="yb-campaign-' + prefix + '-recipients-list"></div>' +
      '</div>';

    renderFilterPanel($('yb-campaign-' + prefix + '-filters-area'));
    renderRecipientList($('yb-campaign-' + prefix + '-recipients-list'));
    updateRecipientBadge();
  }

  function updateRecipientBadge() {
    var count = campaignState.selectedIds.size;
    var prefix = campaignState.type === 'sms' ? 'sms' : 'email';
    var badge = $('yb-campaign-' + prefix + '-recipient-badge');
    if (badge) badge.textContent = count > 0 ? count : '';
  }

  /* ══════════════════════════════════════════
     SMS COMPOSE TAB
     ══════════════════════════════════════════ */
  function renderSMSComposeTab(panelEl) {
    var smsTemplates = [
      { id: 'ytt', label: t('leads_sms_template_ytt') },
      { id: 'course', label: t('leads_sms_template_course') },
      { id: 'mentorship', label: t('leads_sms_template_mentorship') },
      { id: 'default', label: t('leads_sms_template_default') },
      { id: '', label: t('leads_sms_template_custom') }
    ];

    var html = '<div class="yb-lead__campaign-sms-compose">';

    // Template chips
    html += '<div class="yb-lead__campaign-template-chips">';
    smsTemplates.forEach(function (tpl) {
      var active = campaignState.smsTemplateId === tpl.id;
      html += '<button type="button" class="yb-lead__campaign-chip' + (active ? ' is-active' : '') + '" data-action="sms-template" data-template="' + tpl.id + '">' + esc(tpl.label) + '</button>';
    });
    html += '</div>';

    // Variable insert
    html += '<div class="yb-lead__campaign-var-bar">' +
      '<span class="yb-lead__campaign-var-bar-label">' + esc(t('campaign_compose_insert_var')) + ':</span>' +
      '<button type="button" class="yb-lead__campaign-var-btn" data-action="insert-var" data-var="{{first_name}}" data-target="yb-campaign-sms-textarea">{{first_name}}</button>' +
      '<button type="button" class="yb-lead__campaign-var-btn" data-action="insert-var" data-var="{{program}}" data-target="yb-campaign-sms-textarea">{{program}}</button>' +
      '<button type="button" class="yb-lead__campaign-var-btn" data-action="insert-var" data-var="{{name}}" data-target="yb-campaign-sms-textarea">{{name}}</button>' +
      '</div>';

    // Textarea
    html += '<textarea id="yb-campaign-sms-textarea" class="yb-lead__campaign-sms-textarea" rows="5" placeholder="' + esc(t('leads_sms_placeholder')) + '">' + esc(campaignState.smsMessage) + '</textarea>';

    // Char/segment count
    var charCount = campaignState.smsMessage.length;
    var segments = Math.ceil(charCount / 160) || 1;
    html += '<div class="yb-lead__campaign-sms-meta">' +
      '<span>' + charCount + ' ' + esc(t('campaign_compose_sms_chars')) + '</span>' +
      '<span class="yb-lead__campaign-sms-segments">' + segments + ' ' + esc(t('campaign_compose_sms_segments')) + '</span>' +
      '</div>';

    // Tip
    html += '<div class="yb-lead__campaign-sms-tip">\ud83d\udca1 ' + esc(t('campaign_compose_sms_tip')) + '</div>';

    // Preview bubble
    html += '<div class="yb-lead__campaign-sms-preview">' +
      '<div class="yb-lead__campaign-sms-preview-label">' + esc(t('campaign_compose_sms_preview')) + '</div>' +
      '<div class="yb-lead__campaign-sms-bubble" id="yb-campaign-sms-bubble">' + esc(personalizeMessage(campaignState.smsMessage, getFirstRecipient())) + '</div>' +
      '</div>';

    html += '</div>';
    panelEl.innerHTML = html;

    // Bind textarea events
    var ta = $('yb-campaign-sms-textarea');
    if (ta) {
      ta.addEventListener('input', function () {
        campaignState.smsMessage = ta.value;
        updateSMSCounts();
        updateSMSBubble();
      });
    }
  }

  function updateSMSCounts() {
    var charCount = campaignState.smsMessage.length;
    var segments = Math.ceil(charCount / 160) || 1;
    var metaEl = document.querySelector('.yb-lead__campaign-sms-meta');
    if (metaEl) {
      metaEl.innerHTML = '<span>' + charCount + ' ' + esc(t('campaign_compose_sms_chars')) + '</span>' +
        '<span class="yb-lead__campaign-sms-segments">' + segments + ' ' + esc(t('campaign_compose_sms_segments')) + '</span>';
    }
  }

  function updateSMSBubble() {
    var bubble = $('yb-campaign-sms-bubble');
    if (bubble) {
      bubble.textContent = personalizeMessage(campaignState.smsMessage, getFirstRecipient());
    }
  }

  /* ══════════════════════════════════════════
     EMAIL COMPOSE TAB
     ══════════════════════════════════════════ */
  function renderEmailComposeTab(panelEl) {
    var html = '<div class="yb-lead__campaign-email-compose">';

    // Sidebar — templates
    html += '<div class="yb-lead__campaign-email-sidebar">';
    html += '<div class="yb-lead__campaign-email-mode-toggle">' +
      '<button type="button" class="yb-lead__campaign-email-mode-btn' + (campaignState.emailMode === 'template' ? ' is-active' : '') + '" data-action="email-mode" data-mode="template">' + esc(t('campaign_compose_template')) + '</button>' +
      '<button type="button" class="yb-lead__campaign-email-mode-btn' + (campaignState.emailMode === 'custom' ? ' is-active' : '') + '" data-action="email-mode" data-mode="custom">' + esc(t('campaign_compose_custom')) + '</button>' +
      '</div>';

    if (campaignState.emailMode === 'template') {
      html += '<input type="text" class="yb-lead__campaign-email-search" placeholder="' + esc(t('campaign_compose_search_templates')) + '" id="yb-campaign-email-template-search">';
      html += '<div class="yb-lead__campaign-email-template-list" id="yb-campaign-email-templates">';
      html += renderEmailTemplateList();
      html += '</div>';
    }
    html += '</div>';

    // Main area
    html += '<div class="yb-lead__campaign-email-main">';

    // Subject
    html += '<div class="yb-lead__campaign-email-field">' +
      '<label>' + esc(t('campaign_compose_email_subject')) + '</label>' +
      '<input type="text" class="yb-lead__campaign-email-input" id="yb-campaign-email-subject" value="' + esc(campaignState.emailSubject) + '" placeholder="' + esc(t('campaign_compose_email_subject')) + '">' +
      '<div class="yb-lead__campaign-email-input-hint">' + esc(t('campaign_compose_email_subject_tip')) + '</div>' +
      '</div>';

    // Preview text
    html += '<div class="yb-lead__campaign-email-field">' +
      '<label>' + esc(t('campaign_compose_email_preheader')) + '</label>' +
      '<input type="text" class="yb-lead__campaign-email-input" id="yb-campaign-email-preheader" value="' + esc(campaignState.emailPreheader) + '" placeholder="' + esc(t('campaign_compose_email_preheader')) + '">' +
      '</div>';

    // Variable insert bar
    html += '<div class="yb-lead__campaign-var-bar">' +
      '<span class="yb-lead__campaign-var-bar-label">' + esc(t('campaign_compose_insert_var')) + ':</span>' +
      '<button type="button" class="yb-lead__campaign-var-btn" data-action="insert-var" data-var="{{first_name}}" data-target="yb-campaign-email-editor">{{first_name}}</button>' +
      '<button type="button" class="yb-lead__campaign-var-btn" data-action="insert-var" data-var="{{program}}" data-target="yb-campaign-email-editor">{{program}}</button>' +
      '<button type="button" class="yb-lead__campaign-var-btn" data-action="insert-var" data-var="{{cohort}}" data-target="yb-campaign-email-editor">{{cohort}}</button>' +
      '</div>';

    // Editor toolbar + editor
    html += '<div class="yb-lead__campaign-email-editor-wrap">';
    html += '<div class="yb-lead__campaign-email-editor-toolbar">' +
      '<label>' + esc(t('campaign_compose_email_body')) + '</label>' +
      '<div class="yb-lead__campaign-email-html-toggle">' +
      '<button type="button" class="' + (campaignState.emailEditorMode === 'visual' ? 'is-active' : '') + '" data-action="email-editor-mode" data-mode="visual">' + esc(t('campaign_compose_email_visual_mode')) + '</button>' +
      '<button type="button" class="' + (campaignState.emailEditorMode === 'html' ? 'is-active' : '') + '" data-action="email-editor-mode" data-mode="html">' + esc(t('campaign_compose_email_html_mode')) + '</button>' +
      '</div></div>';

    if (campaignState.emailEditorMode === 'visual') {
      html += '<div contenteditable="true" class="yb-lead__campaign-email-editor" id="yb-campaign-email-editor">' + (campaignState.emailBodyHtml || '') + '</div>';
    } else {
      html += '<textarea class="yb-lead__campaign-email-html-textarea" id="yb-campaign-email-editor-html" rows="10">' + esc(campaignState.emailBodyHtml) + '</textarea>';
    }
    html += '</div>';

    // Attachment
    html += '<div class="yb-lead__campaign-attachment">';
    if (campaignState.attachment) {
      html += '<div class="yb-lead__campaign-attachment-file">' +
        '\ud83d\udcce ' + esc(campaignState.attachment.name) +
        '<button type="button" data-action="campaign-remove-attachment">&times;</button>' +
        '</div>';
    } else {
      html += '<div class="yb-lead__campaign-attachment-drop" id="yb-campaign-attachment-drop">' +
        esc(t('campaign_compose_email_attachment_drop')) + '</div>' +
        '<div class="yb-lead__campaign-attachment-max">' + esc(t('campaign_compose_email_attachment_max')) + '</div>' +
        '<input type="file" id="yb-campaign-attachment-input" hidden accept=".pdf,.jpg,.jpeg,.png,.gif,.doc,.docx,.xls,.xlsx">';
    }
    html += '</div>';

    // Archive bar
    html += '<div class="yb-lead__campaign-archive-bar">' +
      '<button type="button" class="yb-lead__campaign-archive-btn" data-action="campaign-archive-save">\ud83d\udcbe ' + esc(t('campaign_compose_email_archive_save')) + '</button>' +
      '<button type="button" class="yb-lead__campaign-archive-btn" data-action="campaign-archive-load">\ud83d\udcc2 ' + esc(t('campaign_compose_email_archive_load')) + '</button>' +
      '</div>';

    html += '</div>'; // email-main
    html += '</div>'; // email-compose

    panelEl.innerHTML = html;
    bindEmailComposeEvents();
  }

  function renderEmailTemplateList() {
    var templates = campaignState.emailTemplates || [];
    if (templates.length === 0) return '<div class="yb-lead__campaign-no-match" style="padding:1rem;font-size:0.8rem;">Loading templates...</div>';

    var html = '';
    templates.forEach(function (tpl) {
      var selected = campaignState.emailTemplateId === tpl.id;
      html += '<div class="yb-lead__campaign-email-template-item' + (selected ? ' is-selected' : '') + '" data-action="select-email-template" data-template-id="' + esc(tpl.id) + '">' +
        '<div class="yb-lead__campaign-email-template-name">' + esc(tpl.name || tpl.id) + '</div>' +
        '<div class="yb-lead__campaign-email-template-subj">' + esc(tpl.subject || '') + '</div>' +
        '</div>';
    });
    return html;
  }

  function bindEmailComposeEvents() {
    // Subject input
    var subjectEl = $('yb-campaign-email-subject');
    if (subjectEl) {
      subjectEl.addEventListener('input', function () {
        campaignState.emailSubject = subjectEl.value;
      });
    }

    // Preheader
    var preheaderEl = $('yb-campaign-email-preheader');
    if (preheaderEl) {
      preheaderEl.addEventListener('input', function () {
        campaignState.emailPreheader = preheaderEl.value;
      });
    }

    // Visual editor
    var editorEl = $('yb-campaign-email-editor');
    if (editorEl) {
      editorEl.addEventListener('input', function () {
        campaignState.emailBodyHtml = editorEl.innerHTML;
      });
    }

    // HTML editor
    var htmlEditorEl = $('yb-campaign-email-editor-html');
    if (htmlEditorEl) {
      htmlEditorEl.addEventListener('input', function () {
        campaignState.emailBodyHtml = htmlEditorEl.value;
      });
    }

    // Attachment drop zone
    var dropEl = $('yb-campaign-attachment-drop');
    var fileInput = $('yb-campaign-attachment-input');
    if (dropEl && fileInput) {
      dropEl.addEventListener('click', function () { fileInput.click(); });
      dropEl.addEventListener('dragover', function (e) { e.preventDefault(); dropEl.classList.add('is-dragover'); });
      dropEl.addEventListener('dragleave', function () { dropEl.classList.remove('is-dragover'); });
      dropEl.addEventListener('drop', function (e) {
        e.preventDefault();
        dropEl.classList.remove('is-dragover');
        if (e.dataTransfer.files.length) handleAttachment(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', function () {
        if (fileInput.files.length) handleAttachment(fileInput.files[0]);
      });
    }

    // Template search
    var searchEl = $('yb-campaign-email-template-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        var term = searchEl.value.toLowerCase();
        var items = document.querySelectorAll('.yb-lead__campaign-email-template-item');
        items.forEach(function (item) {
          var name = (item.querySelector('.yb-lead__campaign-email-template-name') || {}).textContent || '';
          item.style.display = name.toLowerCase().indexOf(term) !== -1 ? '' : 'none';
        });
      });
    }
  }

  function handleAttachment(file) {
    if (file.size > 5 * 1024 * 1024) {
      if (bridge) bridge.toast(t('campaign_compose_email_attachment_max'), true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var base64 = reader.result.split(',')[1];
      campaignState.attachment = { name: file.name, type: file.type, data: base64 };
      // Re-render attachment area
      var composePanel = $('yb-campaign-email-compose');
      if (composePanel) renderEmailComposeTab(composePanel);
    };
    reader.readAsDataURL(file);
  }

  /* ══════════════════════════════════════════
     EMAIL PREVIEW TAB
     ══════════════════════════════════════════ */
  function renderEmailPreviewTab(panelEl) {
    var device = 'desktop';
    var recipient = getFirstRecipient();

    var html = '<div class="yb-lead__campaign-email-preview-wrap">';

    // Device toggle
    html += '<div class="yb-lead__campaign-preview-device-toggle">' +
      '<button type="button" class="yb-lead__campaign-preview-device-btn is-active" data-action="preview-device" data-device="desktop">\ud83d\udcbb ' + esc(t('campaign_preview_desktop')) + '</button>' +
      '<button type="button" class="yb-lead__campaign-preview-device-btn" data-action="preview-device" data-device="mobile">\ud83d\udcf1 ' + esc(t('campaign_preview_mobile')) + '</button>' +
      '</div>';

    // Preview frame
    var personalizedSubject = personalizeMessage(campaignState.emailSubject, recipient);
    var personalizedBody = personalizeMessage(campaignState.emailBodyHtml, recipient);

    html += '<div class="yb-lead__campaign-preview-frame yb-lead__campaign-preview-frame--desktop" id="yb-campaign-preview-frame">' +
      '<div class="yb-lead__campaign-preview-inbox-bar">' +
      '<span>Yoga Bible &lt;hello@yogabible.dk&gt;</span>' +
      '<span>' + esc(recipient.email || '') + '</span>' +
      '</div>' +
      '<div class="yb-lead__campaign-preview-subject">' + esc(personalizedSubject) + '</div>' +
      '<div class="yb-lead__campaign-preview-body" id="yb-campaign-preview-body">' + personalizedBody + '</div>' +
      '</div>';

    // Sample lead selector
    html += '<div class="yb-lead__campaign-preview-sample">' +
      '<span>' + esc(t('campaign_preview_sample_lead')) + ':</span>' +
      '<select id="yb-campaign-preview-lead-select">';
    campaignState.allRecipients.slice(0, 10).forEach(function (l, i) {
      html += '<option value="' + i + '">' + esc((l.first_name || '') + ' ' + (l.last_name || '')) + '</option>';
    });
    html += '</select></div>';

    // Test send
    html += '<div class="yb-lead__campaign-test-send">' +
      '<input type="text" class="yb-lead__campaign-test-input" id="yb-campaign-test-email-input" placeholder="' + esc(t('campaign_preview_test_placeholder')) + '">' +
      '<button type="button" class="yb-lead__campaign-test-btn" data-action="campaign-test-email">' + esc(t('campaign_preview_test_send')) + '</button>' +
      '</div>';

    html += '</div>';
    panelEl.innerHTML = html;

    // Bind sample lead change
    var leadSelect = $('yb-campaign-preview-lead-select');
    if (leadSelect) {
      leadSelect.addEventListener('change', function () {
        var idx = parseInt(leadSelect.value);
        var lead = campaignState.allRecipients[idx] || getFirstRecipient();
        var prevBody = $('yb-campaign-preview-body');
        if (prevBody) prevBody.innerHTML = personalizeMessage(campaignState.emailBodyHtml, lead);
        var subj = document.querySelector('.yb-lead__campaign-preview-subject');
        if (subj) subj.textContent = personalizeMessage(campaignState.emailSubject, lead);
      });
    }
  }

  /* ══════════════════════════════════════════
     SEND TAB
     ══════════════════════════════════════════ */
  function renderSendTab(panelEl) {
    var selectedCount = campaignState.selectedIds.size;
    var isSMS = campaignState.type === 'sms';

    var html = '<div class="yb-lead__campaign-send-wrap">';

    // Summary cards
    html += '<div class="yb-lead__campaign-summary-cards">' +
      '<div class="yb-lead__campaign-summary-card">' +
      '<div class="yb-lead__campaign-summary-value">' + selectedCount + '</div>' +
      '<div class="yb-lead__campaign-summary-label">' + esc(t('campaign_send_recipients_count')) + '</div>' +
      '</div>' +
      '<div class="yb-lead__campaign-summary-card">' +
      '<div class="yb-lead__campaign-summary-value" style="font-size:1rem;color:#0F0F0F">' +
      esc(isSMS ? (campaignState.smsTemplateId || 'Custom') : (campaignState.emailSubject || 'Custom')) +
      '</div>' +
      '<div class="yb-lead__campaign-summary-label">' + esc(t('campaign_send_campaign_name')) + '</div>' +
      '</div>' +
      '</div>';

    // SMS cost estimate
    if (isSMS) {
      var cost = (selectedCount * 0.30).toFixed(0);
      html += '<div class="yb-lead__campaign-sms-cost">' +
        esc(t('campaign_send_sms_cost')) + ': <strong>~' + cost + ' DKK</strong> ' +
        '(' + selectedCount + ' \u00d7 0.30 DKK ' + esc(t('campaign_send_sms_cost_per')) + ')' +
        '</div>';
    }

    // ── Delivery provider selector (email only) ──────────────────────────────
    if (!isSMS) {
      var isResend = campaignState.provider === 'resend';
      var autoNote = selectedCount > 10
        ? '<span class="yb-lead__campaign-provider-auto-note">Auto-valgt for ' + selectedCount + '+ modtagere</span>'
        : '';
      html += '<div class="yb-lead__campaign-provider-section">' +
        '<div class="yb-lead__campaign-filter-label">Afsendelsesmetode</div>' +
        '<div class="yb-lead__campaign-provider-cards">' +

        // Gmail card
        '<label class="yb-lead__campaign-provider-card' + (!isResend ? ' is-selected' : '') + '">' +
          '<input type="radio" name="campaign-provider" value="gmail" data-action="campaign-set-provider"' + (!isResend ? ' checked' : '') + '>' +
          '<div class="yb-lead__campaign-provider-icon">✉️</div>' +
          '<div class="yb-lead__campaign-provider-body">' +
            '<div class="yb-lead__campaign-provider-name">Gmail SMTP</div>' +
            '<div class="yb-lead__campaign-provider-desc">Personlig 1:1-afsendelse · Vises i Sendt-mappe · Bedst til &lt;25 modtagere</div>' +
          '</div>' +
        '</label>' +

        // Resend card
        '<label class="yb-lead__campaign-provider-card' + (isResend ? ' is-selected' : '') + '">' +
          '<input type="radio" name="campaign-provider" value="resend" data-action="campaign-set-provider"' + (isResend ? ' checked' : '') + '>' +
          '<div class="yb-lead__campaign-provider-icon">🚀</div>' +
          '<div class="yb-lead__campaign-provider-body">' +
            '<div class="yb-lead__campaign-provider-name">Resend <span class="yb-lead__campaign-provider-badge">Anbefalet</span>' + autoNote + '</div>' +
            '<div class="yb-lead__campaign-provider-desc">Inbox-optimeret bulk · Ingen Gmail-rod · List-Unsubscribe header · 3.000 gratis/md</div>' +
          '</div>' +
        '</label>' +

        '</div>' + // .provider-cards
        '</div>'; // .provider-section
    }

    // Schedule options
    html += '<div class="yb-lead__campaign-filter-section">' +
      '<span class="yb-lead__campaign-filter-label">' + esc(t('campaign_send_schedule')) + '</span></div>';
    html += '<div class="yb-lead__campaign-schedule-grid">';
    var scheduleOptions = [
      { id: 'now', label: t('campaign_send_schedule_now') },
      { id: '30min', label: t('campaign_send_schedule_30min') },
      { id: '2h', label: t('campaign_send_schedule_2h') },
      { id: 'tomorrow', label: t('campaign_send_schedule_tomorrow') },
      { id: 'custom', label: t('campaign_send_schedule_custom') }
    ];
    scheduleOptions.forEach(function (opt) {
      html += '<button type="button" class="yb-lead__campaign-schedule-option' +
        (campaignState.schedule === opt.id ? ' is-selected' : '') + '" data-action="campaign-schedule" data-schedule="' + opt.id + '">' + esc(opt.label) + '</button>';
    });
    html += '</div>';

    // Custom datetime
    html += '<div class="yb-lead__campaign-schedule-custom" id="yb-campaign-schedule-custom"' + (campaignState.schedule !== 'custom' ? ' hidden' : '') + '>' +
      '<input type="datetime-local" id="yb-campaign-custom-datetime" value="' + esc(campaignState.customSchedule) + '">' +
      '</div>';

    // Warning
    html += '<div class="yb-lead__campaign-warning">\u26a0\ufe0f ' + esc(t('campaign_send_warning').replace('{count}', selectedCount)) + '</div>';

    // Test send
    html += '<div class="yb-lead__campaign-test-send">';
    if (isSMS) {
      html += '<input type="text" class="yb-lead__campaign-test-input" id="yb-campaign-test-phone" placeholder="' + esc(t('campaign_send_test_phone')) + '">' +
        '<button type="button" class="yb-lead__campaign-test-btn" data-action="campaign-test-sms">' + esc(t('campaign_send_test')) + '</button>';
    } else {
      html += '<input type="text" class="yb-lead__campaign-test-input" id="yb-campaign-test-email" placeholder="' + esc(t('campaign_send_test_email')) + '">' +
        '<button type="button" class="yb-lead__campaign-test-btn" data-action="campaign-test-email">' + esc(t('campaign_send_test')) + '</button>';
    }
    html += '</div>';

    // Send button
    html += '<button type="button" class="yb-lead__campaign-send-all yb-lead__campaign-send-all--go" id="yb-campaign-send-all-btn" data-action="campaign-send-all">' +
      (campaignState.schedule === 'now' ? esc(t('campaign_send_btn')) : esc(t('campaign_send_btn_schedule'))) +
      '</button>';

    // Progress
    html += '<div class="yb-lead__campaign-progress" id="yb-campaign-progress">' +
      '<div class="yb-lead__campaign-progress-bar"><div class="yb-lead__campaign-progress-fill" id="yb-campaign-progress-fill"></div></div>' +
      '<div class="yb-lead__campaign-progress-text" id="yb-campaign-progress-text"></div>' +
      '</div>';

    // Results
    html += '<div class="yb-lead__campaign-results" id="yb-campaign-results">' +
      '<div class="yb-lead__campaign-results-grid">' +
      '<div class="yb-lead__campaign-result-card"><div class="yb-lead__campaign-result-value yb-lead__campaign-result-value--sent" id="yb-campaign-result-sent">0</div><div class="yb-lead__campaign-result-label">' + esc(t('campaign_send_result_sent')) + '</div></div>' +
      '<div class="yb-lead__campaign-result-card"><div class="yb-lead__campaign-result-value yb-lead__campaign-result-value--failed" id="yb-campaign-result-failed">0</div><div class="yb-lead__campaign-result-label">' + esc(t('campaign_send_result_failed')) + '</div></div>' +
      '<div class="yb-lead__campaign-result-card"><div class="yb-lead__campaign-result-value yb-lead__campaign-result-value--skipped" id="yb-campaign-result-skipped">0</div><div class="yb-lead__campaign-result-label">' + esc(t('campaign_send_result_skipped')) + '</div></div>' +
      '<div class="yb-lead__campaign-result-card"><div class="yb-lead__campaign-result-value yb-lead__campaign-result-value--scheduled" id="yb-campaign-result-scheduled">0</div><div class="yb-lead__campaign-result-label">' + esc(t('campaign_send_result_scheduled')) + '</div></div>' +
      '</div>' +
      '<button type="button" class="yb-lead__campaign-errors-toggle" data-action="campaign-toggle-errors">' + esc(t('campaign_send_errors')) + '</button>' +
      '<div class="yb-lead__campaign-errors-list" id="yb-campaign-errors-list"></div>' +
      '</div>';

    html += '</div>';
    panelEl.innerHTML = html;

    // Bind custom datetime
    var dtInput = $('yb-campaign-custom-datetime');
    if (dtInput) {
      dtInput.addEventListener('change', function () {
        campaignState.customSchedule = dtInput.value;
      });
    }
  }

  /* ══════════════════════════════════════════
     PERSONALIZATION
     ══════════════════════════════════════════ */
  function personalizeMessage(message, lead) {
    if (!message || !lead) return message || '';
    return message
      .replace(/\{\{first_name\}\}/gi, lead.first_name || 'there')
      .replace(/\{\{last_name\}\}/gi, lead.last_name || '')
      .replace(/\{\{name\}\}/gi, (lead.first_name || 'there') + ' ' + (lead.last_name || ''))
      .replace(/\{\{program\}\}/gi, lead.program || lead.type || 'yoga teacher training')
      .replace(/\{\{cohort\}\}/gi, lead.preferred_month || lead.cohort || '')
      .replace(/\{\{email\}\}/gi, lead.email || '');
  }

  function getFirstRecipient() {
    var all = campaignState.allRecipients;
    if (all.length > 0) return all[0];
    return { first_name: 'Test', last_name: 'User', email: 'test@example.com', phone: '+45 12345678', program: '200H YTT' };
  }

  /* ══════════════════════════════════════════
     TAB NAVIGATION
     ══════════════════════════════════════════ */
  var TAB_ORDER_SMS = ['recipients', 'compose', 'send'];
  var TAB_ORDER_EMAIL = ['recipients', 'compose', 'preview', 'send'];

  function getTabOrder() {
    return campaignState.type === 'sms' ? TAB_ORDER_SMS : TAB_ORDER_EMAIL;
  }

  function switchTab(tabName) {
    var prefix = campaignState.type;
    var tabs = getTabOrder();
    var idx = tabs.indexOf(tabName);
    if (idx === -1) return;

    campaignState.tab = tabName;
    campaignState.maxVisitedTab = Math.max(campaignState.maxVisitedTab, idx);

    // Update tab buttons — all tabs always clickable
    var tabBtns = document.querySelectorAll('#yb-campaign-' + prefix + '-tabs .yb-lead__campaign-tab');
    tabBtns.forEach(function (btn) {
      var tName = btn.getAttribute('data-tab');
      var tIdx = tabs.indexOf(tName);
      btn.classList.toggle('is-active', tName === tabName);
      btn.disabled = false;
      btn.classList.toggle('is-visited', tIdx <= campaignState.maxVisitedTab && tName !== tabName);
    });

    // Update panels
    var panels = document.querySelectorAll('#yb-campaign-' + prefix + '-modal .yb-lead__campaign-panel');
    panels.forEach(function (panel) {
      panel.classList.toggle('is-active', panel.getAttribute('data-panel') === tabName);
    });

    // Render tab content
    var panelEl = document.querySelector('#yb-campaign-' + prefix + '-modal .yb-lead__campaign-panel[data-panel="' + tabName + '"]');
    if (panelEl) {
      if (tabName === 'recipients') renderRecipientsTab(panelEl);
      else if (tabName === 'compose') {
        if (prefix === 'sms') renderSMSComposeTab(panelEl);
        else renderEmailComposeTab(panelEl);
      }
      else if (tabName === 'preview') renderEmailPreviewTab(panelEl);
      else if (tabName === 'send') renderSendTab(panelEl);
    }

    // Update footer
    updateFooter();
  }

  function updateFooter() {
    var prefix = campaignState.type;
    var tabs = getTabOrder();
    var idx = tabs.indexOf(campaignState.tab);
    var footerEl = $('yb-campaign-' + prefix + '-footer');
    if (!footerEl) return;

    var backBtn = footerEl.querySelector('[data-action="campaign-' + prefix + '-back"]');
    var nextBtn = $('yb-campaign-' + prefix + '-next-btn');
    var stepInfo = $('yb-campaign-' + prefix + '-step-info');

    // Back button: always visible but disabled on first step
    if (backBtn) {
      backBtn.disabled = idx === 0;
    }

    // Step info text (e.g. "Step 1 of 3 · Recipients")
    if (stepInfo) {
      var tabLabels = { recipients: t('campaign_tab_recipients'), compose: t('campaign_tab_compose'), preview: t('campaign_tab_preview'), send: t('campaign_tab_send') };
      stepInfo.textContent = (idx + 1) + ' / ' + tabs.length + ' · ' + (tabLabels[campaignState.tab] || '');
    }

    if (nextBtn) {
      if (idx === tabs.length - 1) {
        // On send tab, hide next (send button is inside the panel)
        nextBtn.hidden = true;
      } else {
        nextBtn.hidden = false;
        var nextTab = tabs[idx + 1];
        if (nextTab === 'compose') nextBtn.textContent = t('campaign_recipients_continue') + ' \u2192';
        else if (nextTab === 'preview') nextBtn.textContent = t('campaign_compose_continue_preview') + ' \u2192';
        else if (nextTab === 'send') nextBtn.textContent = t('campaign_compose_continue_send') + ' \u2192';
      }
    }
  }

  /* ══════════════════════════════════════════
     SEND LOGIC
     ══════════════════════════════════════════ */
  function sendAll() {
    if (campaignState.sending) return;
    campaignState.sending = true;

    var isSMS = campaignState.type === 'sms';
    var recipients = campaignState.allRecipients.filter(function (l) { return campaignState.selectedIds.has(l.id); });
    var total = recipients.length;

    // Show progress bar + disable send button
    var progressEl = $('yb-campaign-progress');
    if (progressEl) progressEl.classList.add('is-active');
    var sendBtn = $('yb-campaign-send-all-btn');
    if (sendBtn) sendBtn.disabled = true;

    // ── Resend path (email only): one batch request to backend ────────────
    if (!isSMS && campaignState.provider === 'resend') {
      sendAllViaResend(recipients, total);
      return;
    }

    // ── Gmail / SMS path: sequential per-lead loop ─────────────────────────
    var batchSize = 10;
    var results = { sent: 0, failed: 0, skipped: 0, scheduled: 0, errors: [] };
    var batches = [];
    for (var i = 0; i < recipients.length; i += batchSize) {
      batches.push(recipients.slice(i, i + batchSize));
    }
    var batchIdx = 0;

    function processBatch() {
      if (batchIdx >= batches.length) {
        campaignState.sending = false;
        campaignState.results = results;
        showResults(results);
        logCampaign(results, total);
        return;
      }

      var batch = batches[batchIdx];
      var promises = batch.map(function (lead) {
        return sendToLead(lead, isSMS).then(function (res) {
          if (res.ok) {
            if (campaignState.schedule === 'now') results.sent++;
            else results.scheduled++;
          } else {
            results.failed++;
            results.errors.push({ lead: lead.email || lead.phone, error: res.error || 'Unknown error' });
          }
        }).catch(function (err) {
          results.failed++;
          results.errors.push({ lead: lead.email || lead.phone, error: err.message });
        });
      });

      Promise.all(promises).then(function () {
        batchIdx++;
        var done = Math.min(batchIdx * batchSize, total);
        updateProgress(done, total, batchIdx, batches.length);
        setTimeout(processBatch, 200);
      });
    }

    processBatch();
  }

  // One-shot Resend bulk call — backend fetches leads, personalises, and
  // sends in Resend batch API calls (100/request). Much faster than looping.
  function sendAllViaResend(recipients, total) {
    var leadIds = recipients.filter(function (l) { return l._source !== 'app'; }).map(function (l) { return l.id; });
    var appIds = recipients.filter(function (l) { return l._source === 'app'; }).map(function (l) { return l.id; });

    updateProgress(0, total, 0, 1);

    bridge.getAuthToken().then(function (token) {
      var body = {
        subject: campaignState.emailSubject,
        bodyHtml: campaignState.emailBodyHtml,
        bodyPlain: '',
        provider: 'resend'
      };
      if (leadIds.length > 0) body.leadIds = leadIds;
      if (appIds.length > 0) body.applicationIds = appIds;

      // If there are both leads and apps, send two requests
      var requests = [];
      if (leadIds.length > 0) {
        requests.push(fetch('/.netlify/functions/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ leadIds: leadIds, subject: body.subject, bodyHtml: body.bodyHtml, bodyPlain: body.bodyPlain, provider: 'resend' })
        }).then(function (r) { return r.json(); }));
      }
      if (appIds.length > 0) {
        requests.push(fetch('/.netlify/functions/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ applicationIds: appIds, subject: body.subject, bodyHtml: body.bodyHtml, bodyPlain: body.bodyPlain, provider: 'resend' })
        }).then(function (r) { return r.json(); }));
      }

      return Promise.all(requests);
    }).then(function (responses) {
      // Merge results from leads + apps responses
      var merged = { sent: 0, failed: 0, skipped: 0, errors: [] };
      responses.forEach(function (data) {
        if (data.results) {
          merged.sent += data.results.sent || 0;
          merged.failed += data.results.failed || 0;
          merged.skipped += data.results.skipped || 0;
          if (data.results.errors) merged.errors = merged.errors.concat(data.results.errors);
        } else if (!data.ok) {
          merged.failed += total;
          merged.errors.push({ id: 'batch', error: data.error || 'Unknown error' });
        }
      });

      campaignState.sending = false;
      campaignState.results = merged;
      updateProgress(total, total, 1, 1);
      showResults(merged);
      logCampaign(merged, total);
    }).catch(function (err) {
      campaignState.sending = false;
      var btn = $('yb-campaign-send-all-btn');
      if (btn) btn.disabled = false;
      if (bridge) bridge.toast('Afsendelse fejlede: ' + err.message, true);
    });
  }

  function sendToLead(lead, isSMS) {
    if (!bridge) return Promise.reject(new Error('No bridge'));

    var isApp = lead._source === 'app';

    return bridge.getAuthToken().then(function (token) {
      var url, body;
      var idKey = isApp ? 'applicationId' : 'leadId';

      if (isSMS) {
        var message = personalizeMessage(campaignState.smsMessage, lead);
        body = { message: message };
        body[idKey] = lead.id;
        if (campaignState.schedule !== 'now') {
          body.scheduledFor = getScheduledTime();
        }
        url = '/.netlify/functions/send-sms';
      } else {
        var subject = personalizeMessage(campaignState.emailSubject, lead);
        var htmlBody = personalizeMessage(campaignState.emailBodyHtml, lead);
        body = {
          subject: subject,
          bodyHtml: htmlBody,
          preheader: campaignState.emailPreheader
        };
        body[idKey] = lead.id;
        if (campaignState.emailTemplateId) {
          body.templateId = campaignState.emailTemplateId;
        }
        if (campaignState.attachment) {
          body.attachment = campaignState.attachment;
        }
        if (campaignState.schedule !== 'now') {
          body.scheduledFor = getScheduledTime();
        }
        url = '/.netlify/functions/send-email';
      }

      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      }).then(function (res) { return res.json(); });
    });
  }

  function flashTestBtn(btn, ok, okText, failText) {
    if (!btn) return;
    var origText = btn.textContent;
    btn.disabled = false;
    if (ok) {
      btn.textContent = '✓ ' + okText;
      btn.style.cssText = 'background:#4CAF50;color:#fff;border-color:#4CAF50;transition:background 0.2s,color 0.2s';
    } else {
      btn.textContent = '✗ ' + failText;
      btn.style.cssText = 'background:#ef5350;color:#fff;border-color:#ef5350;transition:background 0.2s,color 0.2s';
    }
    setTimeout(function () {
      btn.textContent = origText;
      btn.style.cssText = '';
    }, 3000);
  }

  function sendTestSMS() {
    var phoneEl = $('yb-campaign-test-phone');
    var phone = (phoneEl || {}).value;
    if (!phone) return;

    var btn = phoneEl ? phoneEl.closest('.yb-lead__campaign-test-send').querySelector('[data-action="campaign-test-sms"]') : null;
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    if (!bridge) return;
    bridge.getAuthToken().then(function (token) {
      var message = personalizeMessage(campaignState.smsMessage, getFirstRecipient());
      return fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ test: true, testPhone: phone, message: message })
      });
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        flashTestBtn(btn, data.ok, t('campaign_send_test_sent'), t('campaign_send_test_failed'));
      }).catch(function () {
        flashTestBtn(btn, false, '', t('campaign_send_test_failed'));
      });
  }

  function sendTestEmail() {
    var inputEl = campaignState.tab === 'send'
      ? $('yb-campaign-test-email')
      : $('yb-campaign-test-email-input');
    var email = (inputEl || {}).value;
    if (!email) return;

    var isSendTab = campaignState.tab === 'send';
    var btn = inputEl ? inputEl.closest('.yb-lead__campaign-test-send').querySelector('[data-action="campaign-test-email"]') : null;
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    if (!bridge) return;
    bridge.getAuthToken().then(function (token) {
      var lead = getFirstRecipient();
      var subject = '[TEST] ' + personalizeMessage(campaignState.emailSubject, lead);
      var body = personalizeMessage(campaignState.emailBodyHtml, lead);
      return fetch('/.netlify/functions/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          test: true,
          testEmail: email,
          subject: subject,
          bodyHtml: body,
          attachment: campaignState.attachment || null
        })
      });
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        var okKey = isSendTab ? 'campaign_send_test_sent' : 'campaign_preview_test_sent';
        var failKey = isSendTab ? 'campaign_send_test_failed' : 'campaign_preview_test_failed';
        flashTestBtn(btn, data.ok, t(okKey), t(failKey));
      }).catch(function () {
        var failKey = isSendTab ? 'campaign_send_test_failed' : 'campaign_preview_test_failed';
        flashTestBtn(btn, false, '', t(failKey));
      });
  }

  function getScheduledTime() {
    var schedule = campaignState.schedule;
    var now = new Date();
    if (schedule === '30min') return new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    if (schedule === '2h') return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    if (schedule === 'tomorrow') {
      var tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow.toISOString();
    }
    if (schedule === 'custom' && campaignState.customSchedule) {
      return new Date(campaignState.customSchedule).toISOString();
    }
    return null;
  }

  function updateProgress(done, total, batch, totalBatches) {
    var pct = Math.round((done / total) * 100);
    var fill = $('yb-campaign-progress-fill');
    var text = $('yb-campaign-progress-text');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = t('campaign_send_progress').replace('{sent}', done).replace('{total}', total) +
      ' \u2014 ' + t('campaign_send_batch').replace('{batch}', batch).replace('{total}', totalBatches);
  }

  function showResults(results) {
    var resultsEl = $('yb-campaign-results');
    if (resultsEl) resultsEl.classList.add('is-active');

    var el;
    el = $('yb-campaign-result-sent'); if (el) el.textContent = results.sent;
    el = $('yb-campaign-result-failed'); if (el) el.textContent = results.failed;
    el = $('yb-campaign-result-skipped'); if (el) el.textContent = results.skipped;
    el = $('yb-campaign-result-scheduled'); if (el) el.textContent = results.scheduled;

    if (results.errors.length > 0) {
      var errorsHtml = '';
      results.errors.forEach(function (err) {
        errorsHtml += '<div>' + esc(err.lead) + ': ' + esc(err.error) + '</div>';
      });
      var errList = $('yb-campaign-errors-list');
      if (errList) errList.innerHTML = errorsHtml;
    }

    if (bridge) bridge.toast(t('campaign_send_complete'));
    if (bridge && bridge.onCampaignSent) bridge.onCampaignSent(campaignState.type, results);
  }

  function logCampaign(results, total) {
    // Log campaign to Firestore or Netlify function
    if (!bridge) return;
    bridge.getAuthToken().then(function (token) {
      fetch('/.netlify/functions/campaign-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          type: campaignState.type,
          templateId: campaignState.type === 'sms' ? campaignState.smsTemplateId : campaignState.emailTemplateId,
          subject: campaignState.emailSubject || '',
          recipientCount: total,
          results: results,
          schedule: campaignState.schedule,
          sentAt: new Date().toISOString()
        })
      }).catch(function () { /* silent fail for logging */ });
    });
  }

  /* ══════════════════════════════════════════
     OPEN / CLOSE WIZARDS
     ══════════════════════════════════════════ */
  function openSMSCampaign(preSelectedLeads) {
    resetState('sms');
    loadEmailTemplatesIfNeeded();

    // Pin pre-selected leads so they survive filter changes
    if (preSelectedLeads && preSelectedLeads.length > 0) {
      preSelectedLeads.forEach(function (l) {
        if (l.phone) {
          campaignState.pinnedIds.add(l.id);
          campaignState.selectedIds.add(l.id);
        }
      });
      // Pre-seed campaign leads with what we already have
      campaignState.campaignLeads = bridge ? (bridge.getLeads() || []) : [];
    }

    var modal = $('yb-campaign-sms-modal');
    if (!modal) return;
    modal.hidden = false;
    switchTab('recipients');

    // Load all leads from DB in background — updates recipient list when done
    loadAllLeadsForCampaign(function () {
      if (!modal.hidden) {
        var panelEl = modal.querySelector('.yb-lead__campaign-panel[data-panel="recipients"]');
        if (panelEl && campaignState.tab === 'recipients') renderRecipientsTab(panelEl);
      }
    });
  }

  function openEmailCampaign(preSelectedLeads) {
    resetState('email');
    loadEmailTemplatesIfNeeded();

    // Pin pre-selected leads so they survive filter changes
    if (preSelectedLeads && preSelectedLeads.length > 0) {
      preSelectedLeads.forEach(function (l) {
        if (l.email) {
          campaignState.pinnedIds.add(l.id);
          campaignState.selectedIds.add(l.id);
        }
      });
      // Pre-seed campaign leads with what we already have
      campaignState.campaignLeads = bridge ? (bridge.getLeads() || []) : [];
    }

    var modal = $('yb-campaign-email-modal');
    if (!modal) return;
    modal.hidden = false;
    switchTab('recipients');

    // Load all leads from DB in background — updates recipient list when done
    loadAllLeadsForCampaign(function () {
      if (!modal.hidden) {
        var panelEl = modal.querySelector('.yb-lead__campaign-panel[data-panel="recipients"]');
        if (panelEl && campaignState.tab === 'recipients') renderRecipientsTab(panelEl);
      }
    });
  }

  function loadAllLeadsForCampaign(onComplete) {
    if (!bridge || !bridge.loadAllLeadsForCampaign) { if (onComplete) onComplete(); return; }
    campaignState.recipientsLoading = true;

    var leadsLoaded = false;
    var appsLoaded = false;

    function checkDone() {
      if (leadsLoaded && appsLoaded) {
        campaignState.recipientsLoading = false;
        if (onComplete) onComplete();
      }
    }

    bridge.loadAllLeadsForCampaign(function (err, allLeads) {
      if (!err && allLeads) campaignState.campaignLeads = allLeads;
      leadsLoaded = true;
      checkDone();
    });

    if (bridge.loadAllAppsForCampaign) {
      bridge.loadAllAppsForCampaign(function (err, allApps) {
        if (!err && allApps) campaignState.campaignApps = allApps;
        appsLoaded = true;
        checkDone();
      });
    } else {
      campaignState.campaignApps = bridge.getApplications() || [];
      appsLoaded = true;
      checkDone();
    }
  }

  function closeCampaign(type) {
    var modal = $('yb-campaign-' + type + '-modal');
    if (modal) modal.hidden = true;
    resetState(type);
  }

  function resetState(type) {
    campaignState.type = type;
    campaignState.tab = 'recipients';
    campaignState.maxVisitedTab = 3; // all tabs unlocked from the start
    campaignState.filters = {
      source: 'all', statuses: [], programs: [], subtypes: [], routes: [],
      countries: [], periods: [], tracks: [], cohorts: [], paymentStatuses: [],
      recency: null, housing: false, meta: false,
      excludeConverted: false, excludeRecent: false,
      excludeNotInterested: true, excludeBadLeads: true, excludeUnsubscribed: true
    };
    campaignState.allRecipients = [];
    campaignState.selectedIds = new Set();
    campaignState.excludedIds = new Set();
    campaignState.pinnedIds = new Set();
    campaignState.searchTerm = '';
    campaignState.campaignLeads = [];
    campaignState.campaignApps = [];
    campaignState.recipientsLoading = false;
    campaignState.smsTemplateId = '';
    campaignState.smsMessage = '';
    campaignState.emailMode = 'template';
    campaignState.emailTemplateId = '';
    campaignState.emailSubject = '';
    campaignState.emailPreheader = '';
    campaignState.emailBodyHtml = '';
    campaignState.emailEditorMode = 'visual';
    campaignState.attachment = null;
    campaignState.provider = 'resend'; // always default Resend for new campaigns
    campaignState.schedule = 'now';
    campaignState.customSchedule = '';
    campaignState.sending = false;
    campaignState.results = null;
  }

  /* ══════════════════════════════════════════
     EMAIL TEMPLATES LOADING
     ══════════════════════════════════════════ */
  var templatesLoaded = false;

  function loadEmailTemplatesIfNeeded() {
    if (templatesLoaded || !bridge || !bridge.getDb()) return;
    templatesLoaded = true;

    bridge.getDb().collection('email_templates').get().then(function (snap) {
      campaignState.emailTemplates = [];
      snap.forEach(function (doc) {
        var d = doc.data();
        campaignState.emailTemplates.push({
          id: doc.id,
          name: d.name || doc.id,
          subject: d.subject || '',
          body: d.body_plain || d.body || '',
          bodyHtml: d.body_html || d.body || ''
        });
      });
    }).catch(function () { /* collection may not exist */ });
  }

  /* ══════════════════════════════════════════
     SMS TEMPLATE CONTENT
     ══════════════════════════════════════════ */
  var SMS_TEMPLATES = {
    'ytt': "Hi {{first_name}}! Thank you for your interest in our Yoga Teacher Training. We have just sent detailed information to your email - please check your inbox and spam or promotions folder. Feel free to reply here or call anytime with questions. Warm regards, Yoga Bible",
    'course': "Hi {{first_name}}! Thank you for your interest in our {{program}} course. We have just sent you all the details by email - please check your inbox and spam or promotions folder. Reply here anytime with questions! Warm regards, Yoga Bible",
    'mentorship': "Hi {{first_name}}! Thank you for your interest in our Personlig Mentorship program. We have sent you more information by email - check your inbox and spam or promotions folder. Looking forward to connecting! Warm regards, Yoga Bible",
    'default': "Hi {{first_name}}! Thank you for reaching out to Yoga Bible. We have sent you information by email - please check your inbox and spam or promotions folder. Feel free to reply here or call us with any questions! Warm regards, Yoga Bible"
  };

  /* ══════════════════════════════════════════
     EVENT DELEGATION
     ══════════════════════════════════════════ */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) {
        // Tab button direct click — allows free navigation between visited tabs
        var tabBtn = e.target.closest('.yb-lead__campaign-tab');
        if (tabBtn && !tabBtn.disabled) {
          var tabName = tabBtn.getAttribute('data-tab');
          if (tabName) { switchTab(tabName); return; }
        }

        // Filter chip click
        var chip = e.target.closest('[data-filter]');
        if (chip) { handleFilterChipClick(chip); return; }

        // Exclude checkbox
        var excl = e.target.closest('[data-exclude]');
        if (excl && excl.type === 'checkbox') { handleExcludeToggle(excl); return; }

        // Email template item click
        var tplItem = e.target.closest('[data-action="select-email-template"]');
        if (tplItem) {
          var tplId = tplItem.getAttribute('data-template-id');
          selectEmailTemplate(tplId);
          return;
        }

        return;
      }

      var action = btn.getAttribute('data-action');

      // Campaign open/close
      if (action === 'campaign-sms-close') { closeCampaign('sms'); return; }
      if (action === 'campaign-email-close') { closeCampaign('email'); return; }

      // Navigation
      if (action === 'campaign-sms-next' || action === 'campaign-email-next') {
        var tabs = getTabOrder();
        var idx = tabs.indexOf(campaignState.tab);
        if (idx < tabs.length - 1) switchTab(tabs[idx + 1]);
        return;
      }
      if (action === 'campaign-sms-back' || action === 'campaign-email-back') {
        var tabs2 = getTabOrder();
        var idx2 = tabs2.indexOf(campaignState.tab);
        if (idx2 > 0) switchTab(tabs2[idx2 - 1]);
        return;
      }

      // Recipient selection
      if (action === 'campaign-select-all') {
        campaignState.allRecipients.forEach(function (l) { campaignState.selectedIds.add(l.id); });
        refreshRecipientList();
        return;
      }
      if (action === 'campaign-deselect-all') {
        campaignState.selectedIds.clear();
        refreshRecipientList();
        return;
      }
      if (action === 'campaign-toggle-recipient') {
        var row = btn.closest('.yb-lead__campaign-recipient-row');
        if (row) {
          var id = row.getAttribute('data-lead-id');
          if (btn.checked) campaignState.selectedIds.add(id);
          else campaignState.selectedIds.delete(id);
          updateRecipientBadge();
          refreshRecipientToolbar();
        }
        return;
      }

      // SMS template selection
      if (action === 'sms-template') {
        var tplId2 = btn.getAttribute('data-template');
        campaignState.smsTemplateId = tplId2;
        if (tplId2 && SMS_TEMPLATES[tplId2]) {
          campaignState.smsMessage = SMS_TEMPLATES[tplId2];
          var ta = $('yb-campaign-sms-textarea');
          if (ta) ta.value = campaignState.smsMessage;
          updateSMSCounts();
          updateSMSBubble();
        }
        // Update chip states
        btn.closest('.yb-lead__campaign-template-chips').querySelectorAll('.yb-lead__campaign-chip').forEach(function (c) {
          c.classList.toggle('is-active', c.getAttribute('data-template') === tplId2);
        });
        return;
      }

      // Variable insert
      if (action === 'insert-var') {
        var varText = btn.getAttribute('data-var');
        var targetId = btn.getAttribute('data-target');
        insertVariable(varText, targetId);
        return;
      }

      // Email mode toggle
      if (action === 'email-mode') {
        campaignState.emailMode = btn.getAttribute('data-mode');
        var composePanel = document.querySelector('#yb-campaign-email-compose');
        if (composePanel) renderEmailComposeTab(composePanel);
        return;
      }

      // Email editor mode
      if (action === 'email-editor-mode') {
        // Save current content before switching
        if (campaignState.emailEditorMode === 'visual') {
          var ed = $('yb-campaign-email-editor');
          if (ed) campaignState.emailBodyHtml = ed.innerHTML;
        } else {
          var ht = $('yb-campaign-email-editor-html');
          if (ht) campaignState.emailBodyHtml = ht.value;
        }
        campaignState.emailEditorMode = btn.getAttribute('data-mode');
        var composePanel2 = document.querySelector('#yb-campaign-email-compose');
        if (composePanel2) renderEmailComposeTab(composePanel2);
        return;
      }

      // Preview device toggle
      if (action === 'preview-device') {
        var device = btn.getAttribute('data-device');
        var frame = $('yb-campaign-preview-frame');
        if (frame) {
          frame.className = 'yb-lead__campaign-preview-frame yb-lead__campaign-preview-frame--' + device;
        }
        btn.parentElement.querySelectorAll('.yb-lead__campaign-preview-device-btn').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        return;
      }

      // Schedule selection
      if (action === 'campaign-schedule') {
        campaignState.schedule = btn.getAttribute('data-schedule');
        btn.parentElement.querySelectorAll('.yb-lead__campaign-schedule-option').forEach(function (b) {
          b.classList.toggle('is-selected', b === btn);
        });
        var customEl = $('yb-campaign-schedule-custom');
        if (customEl) customEl.hidden = campaignState.schedule !== 'custom';
        var sendAllBtn = $('yb-campaign-send-all-btn');
        if (sendAllBtn) {
          sendAllBtn.textContent = campaignState.schedule === 'now' ? t('campaign_send_btn') : t('campaign_send_btn_schedule');
        }
        return;
      }

      // Provider radio change (handled on 'change' event below, but keep as fallback)
      if (action === 'campaign-set-provider') {
        campaignState.provider = btn.value || 'resend';
        // Re-style cards
        document.querySelectorAll('.yb-lead__campaign-provider-card').forEach(function (card) {
          var radio = card.querySelector('input[type="radio"]');
          card.classList.toggle('is-selected', radio && radio.checked);
        });
        return;
      }

      // Test sends
      if (action === 'campaign-test-sms') { sendTestSMS(); return; }
      if (action === 'campaign-test-email') { sendTestEmail(); return; }

      // Send all
      if (action === 'campaign-send-all') { sendAll(); return; }

      // Clear filters
      if (action === 'campaign-clear-filters') {
        campaignState.filters = {
          source: 'all', statuses: [], programs: [], subtypes: [], routes: [],
          countries: [], periods: [], tracks: [], cohorts: [], paymentStatuses: [],
          recency: null, housing: false, meta: false,
          excludeConverted: false, excludeRecent: false,
          excludeNotInterested: true, excludeBadLeads: true, excludeUnsubscribed: true
        };
        campaignState.searchTerm = '';
        if (campaignState.pinnedIds.size === 0) campaignState.selectedIds.clear();
        switchTab('recipients');
        return;
      }

      // Toggle errors
      if (action === 'campaign-toggle-errors') {
        var errList = $('yb-campaign-errors-list');
        if (errList) errList.classList.toggle('is-open');
        return;
      }

      // Remove attachment
      if (action === 'campaign-remove-attachment') {
        campaignState.attachment = null;
        var composePanel3 = document.querySelector('#yb-campaign-email-compose');
        if (composePanel3) renderEmailComposeTab(composePanel3);
        return;
      }

      // Archive save/load
      if (action === 'campaign-archive-save') {
        saveToArchive();
        return;
      }
      if (action === 'campaign-archive-load') {
        loadFromArchive();
        return;
      }

      // Email template item
      if (action === 'select-email-template') {
        var tid = btn.getAttribute('data-template-id');
        selectEmailTemplate(tid);
        return;
      }
    });

    // Provider radio toggle
    document.addEventListener('change', function (e) {
      if (e.target && e.target.getAttribute('data-action') === 'campaign-set-provider') {
        campaignState.provider = e.target.value || 'resend';
        document.querySelectorAll('.yb-lead__campaign-provider-card').forEach(function (card) {
          var radio = card.querySelector('input[type="radio"]');
          card.classList.toggle('is-selected', radio && radio.checked);
        });
      }
    });

    // Search input in filters
    document.addEventListener('input', function (e) {
      if (e.target.id === 'yb-campaign-sms-filter-search' || e.target.id === 'yb-campaign-email-filter-search') {
        campaignState.searchTerm = e.target.value;
        applyFilters();
        var listEl = $('yb-campaign-' + campaignState.type + '-recipients-list');
        if (listEl) renderRecipientList(listEl);
        updateRecipientBadge();
      }
    });
  }

  /* ══════════════════════════════════════════
     FILTER CHIP HANDLING
     ══════════════════════════════════════════ */
  function handleFilterChipClick(chip) {
    var filterKey = chip.getAttribute('data-filter');
    var value = chip.getAttribute('data-value');
    var isSingle = chip.getAttribute('data-single');
    var expandable = chip.getAttribute('data-expandable');
    var f = campaignState.filters;

    if (value === 'toggle') {
      // Toggle boolean filters
      f[filterKey] = !f[filterKey];
      chip.classList.toggle('is-active');
    } else if (filterKey === 'source' || filterKey === 'recency') {
      // Single-select filter
      f[filterKey] = value === 'all' ? 'all' : value;
      chip.parentElement.querySelectorAll('.yb-lead__campaign-chip').forEach(function (c) {
        c.classList.toggle('is-active', c.getAttribute('data-value') === value);
      });
    } else {
      // Multi-select toggle
      var arr = f[filterKey];
      if (!Array.isArray(arr)) { f[filterKey] = []; arr = f[filterKey]; }
      var idx = arr.indexOf(value);
      if (idx !== -1) {
        arr.splice(idx, 1);
        chip.classList.remove('is-active');
      } else {
        arr.push(value);
        chip.classList.add('is-active');
      }
    }

    // Handle expandable sub-options
    if (expandable) {
      var subEl = document.querySelector('[data-suboptions="' + expandable + '"]');
      if (subEl) {
        var isActive = chip.classList.contains('is-active');
        subEl.classList.toggle('is-open', isActive);
        if (!isActive) {
          // Clear subtypes when parent is deactivated
          clearSuboptions(expandable);
        }
      }
    }

    // Handle 18w -> route options
    if (filterKey === 'subtypes' && value === '18w') {
      var routeEl = document.querySelector('[data-suboptions="18w"]');
      if (routeEl) {
        routeEl.classList.toggle('is-open', f.subtypes.indexOf('18w') !== -1);
      }
    }

    // Reset selections and re-filter
    campaignState.selectedIds.clear();
    applyFilters();
    var listEl = $('yb-campaign-' + campaignState.type + '-recipients-list');
    if (listEl) renderRecipientList(listEl);
    updateRecipientBadge();
  }

  function clearSuboptions(parentId) {
    var f = campaignState.filters;
    if (parentId === '200h') {
      f.subtypes = f.subtypes.filter(function (s) { return ['4w', '8w', '18w'].indexOf(s) === -1; });
      f.routes = [];
    } else if (parentId === 'course') {
      f.subtypes = f.subtypes.filter(function (s) { return ['inversions', 'backbends', 'splits', 'bundles'].indexOf(s) === -1; });
    } else if (parentId === 'mentorship') {
      f.subtypes = f.subtypes.filter(function (s) { return ['personlig', 'undervisning', 'business'].indexOf(s) === -1; });
    }
  }

  function handleExcludeToggle(checkbox) {
    var key = checkbox.getAttribute('data-exclude');
    campaignState.filters[key] = checkbox.checked;
    campaignState.selectedIds.clear();
    applyFilters();
    var listEl = $('yb-campaign-' + campaignState.type + '-recipients-list');
    if (listEl) renderRecipientList(listEl);
    updateRecipientBadge();
  }

  /* ══════════════════════════════════════════
     VARIABLE INSERTION
     ══════════════════════════════════════════ */
  function insertVariable(varText, targetId) {
    var target = $(targetId);
    if (!target) return;

    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
      var start = target.selectionStart;
      var end = target.selectionEnd;
      var val = target.value;
      target.value = val.substring(0, start) + varText + val.substring(end);
      target.selectionStart = target.selectionEnd = start + varText.length;
      target.focus();
      target.dispatchEvent(new Event('input'));
    } else if (target.contentEditable === 'true') {
      // contenteditable
      document.execCommand('insertText', false, varText);
      campaignState.emailBodyHtml = target.innerHTML;
    }
  }

  /* ══════════════════════════════════════════
     EMAIL TEMPLATE SELECTION
     ══════════════════════════════════════════ */
  function selectEmailTemplate(templateId) {
    campaignState.emailTemplateId = templateId;
    var template = campaignState.emailTemplates.find(function (t) { return t.id === templateId; });
    if (template) {
      campaignState.emailSubject = template.subject;
      campaignState.emailBodyHtml = template.bodyHtml || template.body;

      // Update UI
      var subjectEl = $('yb-campaign-email-subject');
      if (subjectEl) subjectEl.value = template.subject;

      var editorEl = $('yb-campaign-email-editor');
      if (editorEl) editorEl.innerHTML = campaignState.emailBodyHtml;

      var htmlEl = $('yb-campaign-email-editor-html');
      if (htmlEl) htmlEl.value = campaignState.emailBodyHtml;
    }

    // Update template list selection
    document.querySelectorAll('.yb-lead__campaign-email-template-item').forEach(function (item) {
      item.classList.toggle('is-selected', item.getAttribute('data-template-id') === templateId);
    });
  }

  /* ══════════════════════════════════════════
     EMAIL ARCHIVE
     ══════════════════════════════════════════ */
  function saveToArchive() {
    if (!bridge || !bridge.getDb()) return;
    if (!campaignState.emailSubject && !campaignState.emailBodyHtml) return;

    bridge.getDb().collection('email_archive').add({
      subject: campaignState.emailSubject,
      bodyHtml: campaignState.emailBodyHtml,
      createdAt: new Date().toISOString(),
      useCount: 0
    }).then(function () {
      if (bridge) bridge.toast(t('campaign_compose_email_archived'));
    }).catch(function (err) {
      console.error('Archive save error:', err);
    });
  }

  function loadFromArchive() {
    if (!bridge || !bridge.getDb()) return;

    bridge.getDb().collection('email_archive').orderBy('createdAt', 'desc').limit(20).get().then(function (snap) {
      if (snap.empty) {
        if (bridge) bridge.toast('No archived emails found.');
        return;
      }
      // Show a simple selection dialog
      var items = [];
      snap.forEach(function (doc) {
        var d = doc.data();
        items.push({ id: doc.id, subject: d.subject, bodyHtml: d.bodyHtml });
      });
      // For now, load the most recent one
      var latest = items[0];
      campaignState.emailSubject = latest.subject;
      campaignState.emailBodyHtml = latest.bodyHtml;
      campaignState.emailTemplateId = '';

      // Re-render compose
      var composePanel = document.querySelector('#yb-campaign-email-compose');
      if (composePanel) renderEmailComposeTab(composePanel);
    }).catch(function (err) {
      console.error('Archive load error:', err);
    });
  }

  /* ══════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════ */
  function refreshRecipientList() {
    var listEl = $('yb-campaign-' + campaignState.type + '-recipients-list');
    if (listEl) renderRecipientList(listEl);
    updateRecipientBadge();
  }

  function refreshRecipientToolbar() {
    var toolbar = document.querySelector('.yb-lead__campaign-recipient-toolbar');
    if (toolbar) {
      var span = toolbar.querySelector('.yb-lead__campaign-recipient-toolbar-count');
      if (!span) span = toolbar.querySelector('span');
      if (span) span.textContent = campaignState.selectedIds.size + ' ' + t('campaign_recipients_selected');
    }
    updateRecipientBadge();
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function initCampaignWizard() {
    bridge = window._ybLeadData;
    if (!bridge) {
      console.warn('[campaign-wizard] No _ybLeadData bridge found, retrying...');
      return false;
    }

    T = bridge.getTranslations() || {};
    bindEvents();
    console.log('[campaign-wizard] Initialized');
    return true;
  }

  // Expose global functions for lead-admin.js to call
  window.openSMSCampaign = openSMSCampaign;
  window.openEmailCampaign = openEmailCampaign;

  // Bootstrap — wait for bridge
  var retries = 0;
  var checkBridge = setInterval(function () {
    if (initCampaignWizard() || retries++ > 100) {
      clearInterval(checkBridge);
    }
  }, 200);

})();
