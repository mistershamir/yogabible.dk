// =====================================================================
// HOT YOGA COPENHAGEN — Schedule Embed (self-contained)
// Single <script> for embedding on hotyogacph.dk (Framer site).
// Shows weekly class schedule with booking, auth, pass validation.
// Requires checkout-embed.js on the same page for auth modal.
// Brand: #3f99a5 (HYC teal)
// API:   https://profile.hotyogacph.dk/.netlify/functions
// =====================================================================
(function () {
  'use strict';

  // Prevent double-init
  if (window.__hyc_schedule_embed_loaded) return;
  window.__hyc_schedule_embed_loaded = true;

  // ── Brand & Config ──────────────────────────────────────────────────
  var BRAND      = '#3f99a5';
  var BRAND_DARK = '#357f89';
  var API_BASE   = 'https://profile.hotyogacph.dk/.netlify/functions';
  var PROFILE_URL = 'https://profile.hotyogacph.dk';

  // ── Language ────────────────────────────────────────────────────────
  var isDa = window.location.pathname.indexOf('/en/') !== 0;
  function t(da, en) { return isDa ? da : en; }

  // ── State ───────────────────────────────────────────────────────────
  var scheduleUser = null;
  var scheduleMbClientId = null;
  var schedulePassData = null;
  var scheduleWaiverSigned = false;
  var scheduleWeekOffset = 0;
  var scheduleClassFilter = 'all';
  var scheduleShowAllDays = false;
  var scheduleAllClasses = [];
  var scheduleWeekStart = null;
  var staffCache = {};
  var actionLock = false;
  var passRefreshTimer = null;
  var firebaseReady = false;
  var container = null;

  // ── Helpers ─────────────────────────────────────────────────────────
  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function toDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function formatTime(isoStr) {
    var d = new Date(isoStr);
    return d.toLocaleTimeString(isDa ? 'da-DK' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  // ── CSS Injection ───────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('hyc-schedule-css')) return;
    var style = document.createElement('style');
    style.id = 'hyc-schedule-css';
    style.textContent = [

      // ── Container ───────────────────────────────────────────────
      '.hycs{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0F0F0F;max-width:800px;margin:0 auto;padding:0 16px}',

      // ── Header ──────────────────────────────────────────────────
      '.hycs__header{text-align:center;margin-bottom:0.75rem}',
      '.hycs__title{font-size:1.5rem;font-weight:700;color:#0F0F0F;margin:0 0 0.25rem}',
      '.hycs__subtitle{color:#6F6A66;font-size:0.95rem;margin:0}',

      // ── Navigation ──────────────────────────────────────────────
      '.hycs__nav{display:flex;align-items:center;justify-content:center;gap:0.75rem;margin-bottom:1.25rem}',
      '.hycs__nav-btn{display:flex;align-items:center;gap:0.35rem;padding:0.5rem 0.75rem;font-size:0.85rem;font-weight:600;color:#0F0F0F;background:none;border:none;border-radius:8px;cursor:pointer;transition:background .2s,color .2s;font-family:inherit}',
      '.hycs__nav-btn:hover{background:#F5F3F0;color:' + BRAND + '}',
      '.hycs__nav-btn svg{color:#6F6A66;transition:color .2s}',
      '.hycs__nav-btn:hover svg{color:' + BRAND + '}',
      '.hycs__nav-label{display:inline}',
      '.hycs__week-label{font-weight:700;color:#0F0F0F;min-width:130px;text-align:center;font-size:0.95rem}',

      // ── Filters ─────────────────────────────────────────────────
      '.hycs__filters{display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:1.25rem}',
      '.hycs__filter-btn{background:#F5F3F0;border:1.5px solid #E8E4E0;border-radius:20px;padding:0.35rem 0.9rem;font-size:0.78rem;font-family:inherit;font-weight:600;color:#6F6A66;cursor:pointer;transition:all .2s}',
      '.hycs__filter-btn:hover{border-color:' + BRAND + ';color:' + BRAND + '}',
      '.hycs__filter-btn.is-active{background:' + BRAND + ';border-color:' + BRAND + ';color:#fff}',
      '.hycs__filter-empty{text-align:center;color:#6F6A66;padding:2rem 0;font-size:0.9rem}',

      // ── No-pass banner ──────────────────────────────────────────
      '.hycs__no-pass{background:#e8f4f6;border:1.5px solid ' + BRAND + ';border-radius:12px;padding:1.25rem 1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1.5rem}',
      '.hycs__no-pass p{margin:0;font-weight:700;color:#0F0F0F;font-size:0.9rem}',

      // ── Pass info dropdown ──────────────────────────────────────
      '.hycs__pass-info{margin-bottom:1.25rem}',
      '.hycs__pass-dd{border:1.5px solid #E8E4E0;border-radius:12px;background:#FFFCF9;overflow:hidden}',
      '.hycs__pass-dd-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;padding:0.85rem 1.25rem;background:none;border:none;cursor:pointer;font-family:inherit;transition:background .2s}',
      '.hycs__pass-dd-toggle:hover{background:#F5F3F0}',
      '.hycs__pass-dd-summary{display:flex;flex-direction:column;align-items:flex-start;gap:2px}',
      '.hycs__pass-dd-label{font-size:0.8rem;font-weight:700;color:#0F0F0F;text-transform:uppercase;letter-spacing:.03em}',
      '.hycs__pass-dd-count{font-size:0.8rem;color:#6F6A66}',
      '.hycs__pass-dd-chevron{color:#6F6A66;transition:transform .25s;flex-shrink:0}',
      '.hycs__pass-dd-toggle.is-open .hycs__pass-dd-chevron{transform:rotate(180deg)}',
      '.hycs__pass-dd-body{padding:0 1.25rem 1rem;display:flex;flex-direction:column;gap:0.75rem}',
      '.hycs__pass-card{background:linear-gradient(135deg,#e8f4f6,#FFFCF9);border:1.5px solid ' + BRAND + ';border-radius:12px;padding:1rem 1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}',
      '.hycs__pass-label{font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em;color:#6F6A66;display:block}',
      '.hycs__pass-name{font-weight:700;color:#0F0F0F;font-size:1rem;display:block}',
      '.hycs__pass-stats{display:flex;gap:1.5rem;align-items:center}',
      '.hycs__pass-stat{font-size:0.85rem;color:#6F6A66}',
      '.hycs__pass-stat strong{color:' + BRAND + ';font-size:1.1rem}',
      '.hycs__pass-stat--low{color:#c0392b}',

      // ── Day groups ──────────────────────────────────────────────
      '.hycs__day{margin-bottom:1.5rem}',
      '.hycs__day-label{font-size:1rem;font-weight:700;color:#0F0F0F;padding-bottom:0.5rem;border-bottom:1.5px solid #E8E4E0;margin:0 0 0.5rem}',
      '.hycs__day-label span{font-weight:400;color:#6F6A66}',
      '.hycs__day--hidden{display:none}',

      // ── Class rows ──────────────────────────────────────────────
      '.hycs__class{display:flex;align-items:center;gap:1rem;padding:0.75rem 0;border-bottom:1px solid #F5F3F0}',
      '.hycs__class.is-cancelled{opacity:0.5;text-decoration:line-through}',
      '.hycs__class.is-past{opacity:0.5}',
      '.hycs__class-time{min-width:110px;font-weight:700;color:#0F0F0F;font-size:0.9rem}',
      '.hycs__class-info{flex:1;display:flex;flex-direction:column;gap:0.1rem}',
      '.hycs__class-name{font-weight:700;color:#0F0F0F}',
      '.hycs__class-instructor{font-size:0.85rem;color:#6F6A66}',
      '.hycs__class-instructor--link{cursor:pointer;color:' + BRAND + ';text-decoration:underline;text-underline-offset:2px}',
      '.hycs__class-instructor--link:hover{color:' + BRAND_DARK + '}',
      '.hycs__class-spots{font-size:0.8rem;color:' + BRAND + '}',
      '.hycs__class-action{min-width:100px;text-align:right}',

      // ── Description toggle ──────────────────────────────────────
      '.hycs__desc-toggle{background:none;border:none;color:' + BRAND + ';font-size:0.8rem;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline;text-underline-offset:2px}',
      '.hycs__desc-toggle:hover{color:' + BRAND_DARK + '}',
      '.hycs__desc{background:#FFFCF9;border:1px solid #E8E4E0;border-radius:8px;margin:0.5rem 0;padding:1rem 1.25rem;font-size:0.9rem;color:#6F6A66;line-height:1.5}',
      '.hycs__desc p{margin:0 0 0.5rem}',
      '.hycs__desc p:last-child{margin-bottom:0}',

      // ── Teacher bio ─────────────────────────────────────────────
      '.hycs__teacher-bio{background:#FFFCF9;border:1px solid #E8E4E0;border-radius:12px;margin:0.5rem 0;padding:1.25rem;display:flex;gap:1rem;align-items:flex-start}',
      '.hycs__teacher-photo{width:64px;height:64px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid #E8E4E0}',
      '.hycs__teacher-name{font-weight:700;color:#0F0F0F;margin:0 0 0.25rem;font-size:0.95rem}',
      '.hycs__teacher-bio-text{font-size:0.85rem;color:#6F6A66;line-height:1.5;margin:0}',

      // ── Buttons ─────────────────────────────────────────────────
      '.hycs-btn{display:inline-flex;align-items:center;justify-content:center;padding:0.4rem 1rem;border-radius:999px;font-family:inherit;font-size:0.85rem;font-weight:700;text-decoration:none;border:2px solid transparent;cursor:pointer;transition:all .2s;box-sizing:border-box}',
      '.hycs-btn--primary{background:' + BRAND + ';color:#fff;border-color:' + BRAND + '}',
      '.hycs-btn--primary:hover{background:' + BRAND_DARK + ';border-color:' + BRAND_DARK + ';transform:translateY(-1px);box-shadow:0 4px 12px rgba(63,153,165,.3)}',
      '.hycs-btn--outline{background:transparent;color:#0F0F0F;border-color:#E8E4E0}',
      '.hycs-btn--outline:hover{border-color:' + BRAND + ';color:' + BRAND + '}',
      '.hycs-btn--booked{background:#e8f4f6;color:' + BRAND + ';border-color:' + BRAND + ';cursor:default}',
      '.hycs-btn--ghost{background:none;border:none;color:' + BRAND + ';padding:0.4rem 0.5rem;font-size:0.82rem;text-decoration:underline;text-underline-offset:2px}',
      '.hycs-btn--ghost:hover{color:' + BRAND_DARK + '}',
      '.hycs-btn:disabled{opacity:0.6;cursor:not-allowed;transform:none;box-shadow:none}',

      // ── Badge ───────────────────────────────────────────────────
      '.hycs__badge{display:inline-block;padding:0.25rem 0.75rem;border-radius:20px;font-size:0.75rem;font-weight:700}',
      '.hycs__badge--cancelled{background:#F5F3F0;color:#6F6A66}',

      // ── Show more / next week ───────────────────────────────────
      '.hycs__show-more-wrap{text-align:center;padding:1.25rem 0 0.5rem}',
      '.hycs__show-more-btn{min-width:200px}',

      // ── Toast ───────────────────────────────────────────────────
      '.hycs__toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);padding:0.75rem 1.5rem;border-radius:8px;font-weight:700;font-size:0.9rem;z-index:10001;box-shadow:0 4px 20px rgba(0,0,0,.15);font-family:inherit;max-width:90vw;text-align:center;opacity:0;transition:opacity .3s;pointer-events:none}',
      '.hycs__toast.is-visible{opacity:1;pointer-events:auto}',
      '.hycs__toast--success{background:#0F0F0F;color:#fff}',
      '.hycs__toast--error{background:#c0392b;color:#fff}',
      '.hycs__toast--warning{background:#e67e22;color:#fff}',
      '.hycs__toast-note{font-weight:400;font-size:0.8rem;margin-top:0.5rem;opacity:0.85;line-height:1.4}',

      // ── Loading / Empty / Error ─────────────────────────────────
      '.hycs__loading{display:flex;align-items:center;justify-content:center;gap:0.75rem;padding:3rem 0;color:#6F6A66}',
      '.hycs__spinner{width:20px;height:20px;border:2.5px solid #E8E4E0;border-top-color:' + BRAND + ';border-radius:50%;animation:hycs-spin .8s linear infinite}',
      '@keyframes hycs-spin{to{transform:rotate(360deg)}}',
      '.hycs__empty{text-align:center;color:#6F6A66;padding:3rem 0}',
      '.hycs__error{text-align:center;color:#c0392b;padding:3rem 0}',

      // ── Mobile ──────────────────────────────────────────────────
      '@media (max-width:640px){',
        '.hycs__nav-label{display:none}',
        '.hycs__class{flex-wrap:wrap}',
        '.hycs__class-time{min-width:auto;width:100%}',
        '.hycs__class-action{width:100%;text-align:left;margin-top:0.25rem}',
        '.hycs__no-pass{flex-direction:column;text-align:center}',
        '.hycs__pass-card{flex-direction:column;align-items:flex-start}',
        '.hycs__teacher-bio{flex-direction:column;align-items:center;text-align:center}',
      '}'

    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Render container HTML ───────────────────────────────────────────
  function injectHTML() {
    container = document.getElementById('hyc-schedule');
    if (!container) return false;

    container.innerHTML =
      '<div class="hycs">' +
        '<div class="hycs__nav">' +
          '<button class="hycs__nav-btn" type="button" id="hycs-prev">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>' +
            '<span class="hycs__nav-label">' + t('Forrige uge', 'Previous week') + '</span>' +
          '</button>' +
          '<span class="hycs__week-label" id="hycs-week-label"></span>' +
          '<button class="hycs__nav-btn" type="button" id="hycs-next">' +
            '<span class="hycs__nav-label">' + t('Næste uge', 'Next week') + '</span>' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
          '</button>' +
        '</div>' +
        '<div id="hycs-pass-info" class="hycs__pass-info" hidden></div>' +
        '<div id="hycs-no-pass" hidden>' +
          '<div class="hycs__no-pass">' +
            '<p>' + t('Du har brug for et pas for at booke klasser.', 'You need a pass to book classes.') + '</p>' +
            '<a class="hycs-btn hycs-btn--primary" href="' + PROFILE_URL + '/#store">' + t('Køb pas', 'Buy a pass') + '</a>' +
          '</div>' +
        '</div>' +
        '<div id="hycs-list">' +
          '<div class="hycs__loading"><div class="hycs__spinner"></div><span>' + t('Henter hold...', 'Loading classes...') + '</span></div>' +
        '</div>' +
        '<div id="hycs-toast" class="hycs__toast"></div>' +
      '</div>';

    // Wire nav buttons
    var prevBtn = document.getElementById('hycs-prev');
    var nextBtn = document.getElementById('hycs-next');
    if (prevBtn) prevBtn.addEventListener('click', function () { scheduleWeekOffset--; scheduleShowAllDays = false; loadSchedule(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { scheduleWeekOffset++; scheduleShowAllDays = false; loadSchedule(); });

    return true;
  }

  // ── Toast ───────────────────────────────────────────────────────────
  var toastTimer = null;
  function showToast(msg, type, extraHtml) {
    var el = document.getElementById('hycs-toast');
    if (!el) return;
    el.className = 'hycs__toast hycs__toast--' + type;
    if (extraHtml) {
      el.innerHTML = '<div>' + esc(msg) + '</div>' + extraHtml;
    } else {
      el.textContent = msg;
    }
    el.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, type === 'warning' ? 6000 : 4000);
  }

  // ── Filters ─────────────────────────────────────────────────────────
  function matchesFilter(cls) {
    if (scheduleClassFilter === 'all') return true;
    return (cls.sessionTypeName || '') === scheduleClassFilter;
  }

  function buildFilters(classes) {
    var seen = {};
    var filters = [{ id: 'all', label: t('Alle', 'All') }];
    classes.forEach(function (cls) {
      var st = cls.sessionTypeName;
      if (st && !seen[st]) {
        seen[st] = true;
        filters.push({ id: st, label: st });
      }
    });
    filters.sort(function (a, b) {
      if (a.id === 'all') return -1;
      if (b.id === 'all') return 1;
      return a.label.localeCompare(b.label);
    });
    return filters;
  }

  // ── Load schedule ───────────────────────────────────────────────────
  function loadSchedule() {
    var listEl = document.getElementById('hycs-list');
    if (!listEl) return;

    var noPassEl = document.getElementById('hycs-no-pass');
    if (noPassEl) noPassEl.hidden = true;

    listEl.innerHTML = '<div class="hycs__loading"><div class="hycs__spinner"></div><span>' + t('Henter hold...', 'Loading classes...') + '</span></div>';

    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    var start, end;
    if (scheduleWeekOffset === 0) {
      start = new Date(today);
      end = new Date(today);
      var daysUntilSunday = (7 - today.getDay()) % 7;
      end.setDate(end.getDate() + (daysUntilSunday || 0));
    } else {
      var refDate = new Date(today);
      refDate.setDate(refDate.getDate() + (scheduleWeekOffset * 7));
      var dow = refDate.getDay();
      var mondayDiff = dow === 0 ? -6 : 1 - dow;
      start = new Date(refDate);
      start.setDate(start.getDate() + mondayDiff);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
    }

    // Update week label
    var labelEl = document.getElementById('hycs-week-label');
    if (labelEl) {
      var opts = { day: 'numeric', month: 'short' };
      var locale = isDa ? 'da-DK' : 'en-GB';
      if (scheduleWeekOffset === 0) {
        labelEl.textContent = t('I dag', 'Today') + ' – ' + end.toLocaleDateString(locale, opts);
      } else {
        labelEl.textContent = start.toLocaleDateString(locale, opts) + ' – ' + end.toLocaleDateString(locale, opts);
      }
    }

    var startStr = toDateStr(start);
    var endStr = toDateStr(end);
    var url = API_BASE + '/mb-classes?startDate=' + startStr + '&endDate=' + endStr;
    if (scheduleMbClientId) url += '&clientId=' + scheduleMbClientId;

    // Load pass info if logged in
    if (scheduleMbClientId) loadPassInfo();

    // Fetch classes + visits in parallel
    var classesP = fetch(url).then(function (r) { return r.json(); });
    var visitsP = scheduleMbClientId
      ? fetch(API_BASE + '/mb-visits?clientId=' + scheduleMbClientId + '&startDate=' + startStr + '&endDate=' + endStr)
          .then(function (r) { return r.json(); })
          .catch(function () { return { visits: [] }; })
      : Promise.resolve({ visits: [] });

    Promise.all([classesP, visitsP])
      .then(function (results) {
        var classes = results[0].classes || [];
        var visits = results[1].visits || [];

        if (!classes.length) {
          listEl.innerHTML = '<p class="hycs__empty">' + t('Ingen hold denne uge.', 'No classes this week.') + '</p>';
          return;
        }

        // Mark booked classes
        var bookedIds = {};
        visits.forEach(function (v) {
          if (v.classId && v.isFuture && !v.lateCancelled) bookedIds[v.classId] = true;
        });
        classes.forEach(function (cls) {
          if (bookedIds[cls.id]) cls.isBooked = true;
        });

        renderSchedule(listEl, classes, start);
      })
      .catch(function () {
        listEl.innerHTML = '<p class="hycs__error">' + t('Kunne ikke hente skema.', 'Could not load schedule.') + '</p>';
      });
  }

  // ── Render schedule ─────────────────────────────────────────────────
  function renderSchedule(listEl, classes, weekStart) {
    scheduleAllClasses = classes;
    scheduleWeekStart = weekStart;

    var filtered = classes.filter(matchesFilter);

    var days = {};
    var dayNames = isDa
      ? ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag']
      : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    filtered.forEach(function (cls) {
      var d = new Date(cls.startDateTime);
      var key = toDateStr(d);
      if (!days[key]) days[key] = { date: d, classes: [] };
      days[key].classes.push(cls);
    });

    // Filter pills
    var dynamicFilters = buildFilters(classes);
    var html = '<div class="hycs__filters">';
    dynamicFilters.forEach(function (f) {
      var active = scheduleClassFilter === f.id;
      html += '<button class="hycs__filter-btn' + (active ? ' is-active' : '') + '" type="button" data-hycs-filter="' + esc(f.id) + '">' + esc(f.label) + '</button>';
    });
    html += '</div>';

    var sortedKeys = Object.keys(days).sort();
    var initialDays = 3;
    var hasMore = sortedKeys.length > initialDays && !scheduleShowAllDays;
    var dayIndex = 0;

    sortedKeys.forEach(function (key) {
      var day = days[key];
      day.classes.sort(function (a, b) { return new Date(a.startDateTime) - new Date(b.startDateTime); });
      var dateObj = day.date;
      var dayName = dayNames[dateObj.getDay()];
      var dateLabel = dateObj.toLocaleDateString(isDa ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'long' });
      var isHidden = hasMore && dayIndex >= initialDays;

      html += '<div class="hycs__day' + (isHidden ? ' hycs__day--hidden' : '') + '">';
      html += '<h3 class="hycs__day-label">' + dayName + ' <span>' + dateLabel + '</span></h3>';

      day.classes.forEach(function (cls) {
        var startTime = formatTime(cls.startDateTime);
        var endTime = formatTime(cls.endDateTime);
        var isPast = new Date(cls.startDateTime) < new Date();
        var descId = 'hycs-desc-' + cls.id;
        var bioId = 'hycs-bio-' + cls.id;

        html += '<div class="hycs__class' + (cls.isCanceled ? ' is-cancelled' : '') + (isPast ? ' is-past' : '') + '"' + (cls.programId ? ' data-program-id="' + cls.programId + '"' : '') + '>';
        html += '<div class="hycs__class-time">' + startTime + ' – ' + endTime + '</div>';
        html += '<div class="hycs__class-info">';
        html += '<span class="hycs__class-name">' + esc(cls.name) + '</span>';

        if (cls.instructorId && cls.instructor !== 'TBA') {
          html += '<span class="hycs__class-instructor hycs__class-instructor--link" data-hycs-bio="' + bioId + '" data-hycs-staff="' + cls.instructorId + '">' + esc(cls.instructor) + '</span>';
        } else {
          html += '<span class="hycs__class-instructor">' + esc(cls.instructor) + '</span>';
        }

        if (cls.spotsLeft !== null && cls.spotsLeft > 0 && cls.spotsLeft <= 7 && !cls.isCanceled && !isPast) {
          html += '<span class="hycs__class-spots">' + cls.spotsLeft + ' ' + t('pladser tilbage', 'spots left') + '</span>';
        }

        if (cls.description) {
          html += '<button class="hycs__desc-toggle" type="button" data-hycs-desc="' + descId + '">' + t('Vis beskrivelse', 'Show description') + '</button>';
        }

        html += '</div>';
        html += '<div class="hycs__class-action">';

        if (cls.isCanceled) {
          html += '<span class="hycs__badge hycs__badge--cancelled">' + t('Aflyst', 'Cancelled') + '</span>';
        } else if (isPast) {
          // No action
        } else if (cls.isBooked) {
          html += '<button class="hycs-btn hycs-btn--booked" type="button" data-hycs-booked="' + cls.id + '">' + t('Booket ✓', 'Booked ✓') + '</button>';
        } else if (cls.spotsLeft === 0) {
          html += '<button class="hycs-btn hycs-btn--outline" type="button" data-hycs-waitlist="' + cls.id + '">' + t('Venteliste', 'Waitlist') + '</button>';
        } else {
          html += '<button class="hycs-btn hycs-btn--primary" type="button" data-hycs-book="' + cls.id + '">' + t('Book', 'Book') + '</button>';
        }

        html += '</div>';
        html += '</div>';

        // Teacher bio (on demand)
        if (cls.instructorId && cls.instructor !== 'TBA') {
          html += '<div class="hycs__teacher-bio" id="' + bioId + '" hidden></div>';
        }

        // Description
        if (cls.description) {
          html += '<div class="hycs__desc" id="' + descId + '" hidden>' + cls.description + '</div>';
        }
      });

      html += '</div>';
      dayIndex++;
    });

    // No results for filter
    if (sortedKeys.length === 0 && scheduleClassFilter !== 'all') {
      html += '<p class="hycs__filter-empty">' + t('Ingen klasser af denne type denne uge.', 'No classes of this type this week.') + '</p>';
    }

    // Show more / next week button
    var showNextWeek = scheduleShowAllDays || sortedKeys.length <= initialDays;
    if (hasMore) {
      html += '<div class="hycs__show-more-wrap"><button class="hycs-btn hycs-btn--outline hycs__show-more-btn" type="button" id="hycs-show-more">' + t('Vis mere', 'Show more') + '</button></div>';
    } else if (showNextWeek && sortedKeys.length > 0) {
      html += '<div class="hycs__show-more-wrap"><button class="hycs-btn hycs-btn--outline hycs__show-more-btn" type="button" id="hycs-next-week">' + t('Vis næste uge', 'Show next week') + '</button></div>';
    }

    listEl.innerHTML = html;

    // ── Wire event handlers ───────────────────────────────────────

    // Show more → reveal hidden days, then swap to next week
    var showMoreBtn = document.getElementById('hycs-show-more');
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', function () {
        scheduleShowAllDays = true;
        listEl.querySelectorAll('.hycs__day--hidden').forEach(function (el) { el.classList.remove('hycs__day--hidden'); });
        var wrap = showMoreBtn.parentElement;
        wrap.innerHTML = '<button class="hycs-btn hycs-btn--outline hycs__show-more-btn" type="button" id="hycs-next-week">' + t('Vis næste uge', 'Show next week') + '</button>';
        document.getElementById('hycs-next-week').addEventListener('click', function () {
          scheduleWeekOffset++;
          scheduleShowAllDays = false;
          loadSchedule();
        });
      });
    }

    var nextWeekBtn = document.getElementById('hycs-next-week');
    if (nextWeekBtn && !showMoreBtn) {
      nextWeekBtn.addEventListener('click', function () {
        scheduleWeekOffset++;
        scheduleShowAllDays = false;
        loadSchedule();
      });
    }

    // Filters
    listEl.querySelectorAll('[data-hycs-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        scheduleClassFilter = btn.getAttribute('data-hycs-filter');
        scheduleShowAllDays = false;
        renderSchedule(listEl, scheduleAllClasses, scheduleWeekStart);
      });
    });

    // Book buttons
    listEl.querySelectorAll('[data-hycs-book]').forEach(function (btn) {
      btn.onclick = function () { bookClass(btn); };
    });

    // Booked buttons
    listEl.querySelectorAll('[data-hycs-booked]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showToast(
          t('Administrer dine bookinger via din profil.', 'Manage your bookings via your profile.'),
          'success',
          '<div style="margin-top:8px"><a href="' + PROFILE_URL + '/#schedule" target="_blank" style="color:#fff;text-decoration:underline;font-weight:400;font-size:0.85rem">' + t('Gå til profil →', 'Go to profile →') + '</a></div>'
        );
      });
    });

    // Waitlist buttons
    listEl.querySelectorAll('[data-hycs-waitlist]').forEach(function (btn) {
      btn.addEventListener('click', function () { joinWaitlist(btn); });
    });

    // Description toggles
    listEl.querySelectorAll('[data-hycs-desc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var descEl = document.getElementById(btn.getAttribute('data-hycs-desc'));
        if (descEl) {
          var isHidden = descEl.hidden;
          descEl.hidden = !isHidden;
          btn.textContent = isHidden ? t('Skjul beskrivelse', 'Hide description') : t('Vis beskrivelse', 'Show description');
        }
      });
    });

    // Teacher bio toggles
    listEl.querySelectorAll('[data-hycs-bio]').forEach(function (el) {
      el.addEventListener('click', function () {
        var bioEl = document.getElementById(el.getAttribute('data-hycs-bio'));
        if (!bioEl) return;
        if (!bioEl.hidden) { bioEl.hidden = true; return; }

        var staffId = el.getAttribute('data-hycs-staff');
        if (staffCache[staffId]) {
          renderTeacherBio(bioEl, staffCache[staffId]);
          bioEl.hidden = false;
          return;
        }

        bioEl.innerHTML = '<p class="hycs__teacher-bio-text">' + t('Henter...', 'Loading...') + '</p>';
        bioEl.hidden = false;

        fetch(API_BASE + '/mb-staff?staffId=' + staffId)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var staff = (data.staff || [])[0];
            if (staff) {
              staffCache[staffId] = staff;
              renderTeacherBio(bioEl, staff);
            } else {
              bioEl.innerHTML = '<p class="hycs__teacher-bio-text">' + t('Ingen info tilgængelig.', 'No info available.') + '</p>';
            }
          })
          .catch(function () {
            bioEl.innerHTML = '<p class="hycs__teacher-bio-text">' + t('Kunne ikke hente info.', 'Could not load info.') + '</p>';
          });
      });
    });
  }

  function renderTeacherBio(el, staff) {
    var html = '';
    if (staff.imageUrl) {
      html += '<img class="hycs__teacher-photo" src="' + esc(staff.imageUrl) + '" alt="' + esc(staff.name) + '">';
    }
    html += '<div>';
    html += '<p class="hycs__teacher-name">' + esc(staff.name) + '</p>';
    html += '<p class="hycs__teacher-bio-text">' + (staff.bio || t('Ingen biografi tilgængelig.', 'No biography available.')) + '</p>';
    html += '</div>';
    el.innerHTML = html;
  }

  // ── Pass info ───────────────────────────────────────────────────────
  function loadPassInfo() {
    if (!scheduleMbClientId) return;
    var passInfoEl = document.getElementById('hycs-pass-info');
    if (!passInfoEl) return;

    if (schedulePassData) {
      renderPassInfo(passInfoEl, schedulePassData);
      return;
    }

    fetch(API_BASE + '/mb-client-services?clientId=' + scheduleMbClientId)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        schedulePassData = data;
        renderPassInfo(passInfoEl, data);
      })
      .catch(function () {});
  }

  function renderPassInfo(passInfoEl, data) {
    var activeServices = data.activeServices || [];
    var activeContracts = data.activeContracts || [];
    var hasActive = activeServices.length > 0 || activeContracts.length > 0;
    var noPassEl = document.getElementById('hycs-no-pass');

    if (hasActive) {
      if (noPassEl) noPassEl.hidden = true;

      var summaryParts = [];
      if (activeContracts.length > 0) {
        summaryParts.push(activeContracts.length + ' ' + t(activeContracts.length === 1 ? 'medlemskab' : 'medlemskaber', activeContracts.length === 1 ? 'membership' : 'memberships'));
      }
      if (activeServices.length > 0) {
        summaryParts.push(activeServices.length + ' ' + t('klippekort', activeServices.length === 1 ? 'pass' : 'passes'));
      }

      var html = '<div class="hycs__pass-dd">';
      html += '<button class="hycs__pass-dd-toggle" type="button">';
      html += '<div class="hycs__pass-dd-summary">';
      html += '<span class="hycs__pass-dd-label">' + t('Dine aktive pas', 'Your active passes') + '</span>';
      html += '<span class="hycs__pass-dd-count">' + summaryParts.join(' + ') + '</span>';
      html += '</div>';
      html += '<svg class="hycs__pass-dd-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      html += '</button>';
      html += '<div class="hycs__pass-dd-body" hidden>';

      activeServices.forEach(function (s) {
        html += '<div class="hycs__pass-card">';
        html += '<div><span class="hycs__pass-label">' + t('Dit aktive klippekort', 'Your active pass') + '</span>';
        html += '<span class="hycs__pass-name">' + esc(s.name) + '</span></div>';
        html += '<div class="hycs__pass-stats">';
        if (s.remaining != null) {
          html += '<span class="hycs__pass-stat"><strong>' + s.remaining + '</strong> ' + t('klip tilbage', 'sessions left') + '</span>';
          if (s.remaining > 0 && s.remaining < 3) {
            html += '<span class="hycs__pass-stat hycs__pass-stat--low">' + t('Snart opbrugt', 'Running low') + '</span>';
          }
        }
        if (s.expirationDate) {
          var expDate = new Date(s.expirationDate);
          html += '<span class="hycs__pass-stat">' + t('Udløber', 'Expires') + ' ' + expDate.toLocaleDateString(isDa ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }) + '</span>';
        }
        html += '</div></div>';
      });

      activeContracts.forEach(function (c) {
        html += '<div class="hycs__pass-card">';
        html += '<div><span class="hycs__pass-label">' + t('Medlemskab', 'Membership') + '</span>';
        html += '<span class="hycs__pass-name">' + esc(c.name) + '</span></div>';
        if (c.endDate) {
          html += '<div class="hycs__pass-stats"><span class="hycs__pass-stat">' + t('Fornyes', 'Renews') + ' ' + new Date(c.endDate).toLocaleDateString(isDa ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }) + '</span></div>';
        }
        html += '</div>';
      });

      html += '</div></div>';
      passInfoEl.innerHTML = html;
      passInfoEl.hidden = false;

      // Toggle dropdown
      var toggle = passInfoEl.querySelector('.hycs__pass-dd-toggle');
      var body = passInfoEl.querySelector('.hycs__pass-dd-body');
      if (toggle && body) {
        toggle.addEventListener('click', function () {
          var isOpen = !body.hidden;
          body.hidden = isOpen;
          toggle.classList.toggle('is-open', !isOpen);
        });
      }
    } else {
      passInfoEl.hidden = true;
      // Only show no-pass banner if user is logged in
      if (noPassEl && scheduleUser) noPassEl.hidden = false;
    }
  }

  function delayedPassRefresh() {
    if (passRefreshTimer) clearTimeout(passRefreshTimer);
    passRefreshTimer = setTimeout(function () {
      schedulePassData = null;
      loadPassInfo();
      passRefreshTimer = setTimeout(function () {
        schedulePassData = null;
        loadPassInfo();
      }, 4000);
    }, 1000);
  }

  // ── Booking ─────────────────────────────────────────────────────────
  function bookClass(btn) {
    if (actionLock) return;
    var classId = btn.getAttribute('data-hycs-book');
    if (!classId) return;

    // Not logged in → open login modal (with callback to retry booking)
    if (!scheduleUser) {
      if (typeof window.openLoginModal === 'function') {
        window.openLoginModal(function () {
          // After login, schedule will auto-reload via onAuthStateChanged
          showToast(t('Du er logget ind! Prøv at booke igen.', 'You are logged in! Try booking again.'), 'success');
        });
      } else {
        window.location.href = PROFILE_URL + '/#schedule';
      }
      return;
    }

    // No MB client ID yet — try to resolve from Firestore
    if (!scheduleMbClientId) {
      btn.disabled = true;
      btn.textContent = t('Henter profil...', 'Loading profile...');
      var db = firebase.firestore();
      db.collection('users').doc(scheduleUser.uid).get()
        .then(function (doc) {
          if (doc.exists && doc.data().mindbodyClientId) {
            scheduleMbClientId = doc.data().mindbodyClientId;
            btn.disabled = false;
            btn.textContent = t('Book', 'Book');
            bookClass(btn); // retry
          } else {
            showToast(t('Kunne ikke finde din profil. Kontakt os venligst.', 'Could not find your profile. Please contact us.'), 'error');
            btn.disabled = false;
            btn.textContent = t('Book', 'Book');
          }
        })
        .catch(function () {
          showToast(t('Kunne ikke hente din profil.', 'Could not load your profile.'), 'error');
          btn.disabled = false;
          btn.textContent = t('Book', 'Book');
        });
      return;
    }

    // Proceed directly to booking — let the server handle pass/waiver validation.
    // Client-side pre-checks were causing race conditions where async waiver/pass
    // data hadn't loaded yet, silently blocking the user.
    actionLock = true;
    btn.disabled = true;
    btn.textContent = t('Booker...', 'Booking...');

    fetch(API_BASE + '/mb-book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: scheduleMbClientId, classId: Number(classId) })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success || data.alreadyBooked) {
          showToast(
            data.alreadyBooked
              ? t('Du er allerede booket!', "You're already booked!")
              : t('Du er booket!', "You're booked!"),
            'success'
          );
          // Switch to booked state
          btn.textContent = t('Booket ✓', 'Booked ✓');
          btn.className = 'hycs-btn hycs-btn--booked';
          btn.removeAttribute('data-hycs-book');
          btn.setAttribute('data-hycs-booked', classId);
          btn.disabled = false;
          btn.onclick = function () {
            showToast(
              t('Administrer dine bookinger via din profil.', 'Manage your bookings via your profile.'),
              'success',
              '<div style="margin-top:8px"><a href="' + PROFILE_URL + '/#schedule" target="_blank" style="color:#fff;text-decoration:underline;font-weight:400;font-size:0.85rem">' + t('Gå til profil →', 'Go to profile →') + '</a></div>'
            );
          };
          delayedPassRefresh();
        } else if (data.error === 'no_pass') {
          var progName = data.programName || '';
          showToast(
            t('Dit pas dækker ikke denne klasse', "Your pass doesn't cover this class") + (progName ? ' (' + progName + ')' : '') + '.',
            'error'
          );
          var noPassEl = document.getElementById('hycs-no-pass');
          if (noPassEl) noPassEl.hidden = false;
          btn.disabled = false;
          btn.textContent = t('Book', 'Book');
        } else if (data.error === 'waiver_required' || (data.error && data.error.indexOf('waiver') !== -1)) {
          showToast(
            t('Du skal acceptere ansvarsfrihedserklæringen først.', 'You must accept the liability waiver first.'),
            'error',
            '<div style="margin-top:8px"><a href="' + PROFILE_URL + '/#passes" target="_blank" style="color:#fff;text-decoration:underline;font-weight:400;font-size:0.85rem">' + t('Gå til profil →', 'Go to profile →') + '</a></div>'
          );
          btn.disabled = false;
          btn.textContent = t('Book', 'Book');
        } else {
          showToast(data.error || t('Booking fejlede.', 'Booking failed.'), 'error');
          btn.disabled = false;
          btn.textContent = t('Book', 'Book');
        }
      })
      .catch(function (err) {
        showToast(err.message || t('Booking fejlede.', 'Booking failed.'), 'error');
        btn.disabled = false;
        btn.textContent = t('Book', 'Book');
      })
      .finally(function () {
        actionLock = false;
      });
  }

  // ── Waitlist ────────────────────────────────────────────────────────
  function joinWaitlist(btn) {
    if (actionLock) return;
    var classId = btn.getAttribute('data-hycs-waitlist');
    if (!classId) return;

    if (!scheduleUser) {
      if (typeof window.openLoginModal === 'function') {
        window.openLoginModal();
        showToast(t('Log ind for at skrive op.', 'Log in to join waitlist.'), 'success');
      } else {
        window.location.href = PROFILE_URL + '/#schedule';
      }
      return;
    }

    if (!scheduleMbClientId) {
      showToast(t('Vent venligst...', 'Please wait...'), 'success');
      return;
    }

    actionLock = true;
    btn.disabled = true;
    btn.textContent = t('Tilmelder...', 'Joining...');

    fetch(API_BASE + '/mb-waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: scheduleMbClientId, classId: Number(classId) })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success || data.WaitlistEntry) {
          showToast(t('Du er på ventelisten!', "You're on the waiting list!"), 'success');
          btn.textContent = t('På venteliste', 'On waitlist');
          btn.disabled = true;
        } else {
          showToast(data.error || t('Kunne ikke tilmelde venteliste.', 'Could not join waitlist.'), 'error');
          btn.textContent = t('Venteliste', 'Waitlist');
          btn.disabled = false;
        }
      })
      .catch(function () {
        showToast(t('Fejl. Prøv igen.', 'Error. Try again.'), 'error');
        btn.textContent = t('Venteliste', 'Waitlist');
        btn.disabled = false;
      })
      .finally(function () {
        actionLock = false;
      });
  }

  // ── Auth integration ────────────────────────────────────────────────
  function initAuth() {
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;

    firebaseReady = true;
    var auth = firebase.auth();
    var db = firebase.firestore();

    auth.onAuthStateChanged(function (user) {
      scheduleUser = user;
      if (user) {
        // Resolve MB client ID from Firestore
        db.collection('users').doc(user.uid).get()
          .then(function (doc) {
            if (doc.exists) {
              var data = doc.data();
              scheduleMbClientId = data.mindbodyClientId || null;
            }
            // Check waiver
            if (scheduleMbClientId) {
              checkWaiver();
            }
            // Reload schedule with booking status
            loadSchedule();
          })
          .catch(function () {
            loadSchedule();
          });
      } else {
        scheduleMbClientId = null;
        schedulePassData = null;
        scheduleWaiverSigned = false;
        loadSchedule();
      }
    });
  }

  function checkWaiver() {
    if (!scheduleMbClientId) return;
    fetch(API_BASE + '/mb-waiver?clientId=' + scheduleMbClientId)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        scheduleWaiverSigned = !!data.clientSigned;
      })
      .catch(function () {
        // Assume not signed if check fails
        scheduleWaiverSigned = false;
      });
  }

  // ── Bootstrap ───────────────────────────────────────────────────────
  function boot() {
    injectCSS();
    if (!injectHTML()) {
      // Container not found — retry after DOM ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          if (injectHTML()) startSchedule();
        });
      }
      return;
    }
    startSchedule();
  }

  function startSchedule() {
    // Try to hook into Firebase (loaded by checkout-embed.js)
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      initAuth();
    } else {
      // Wait for checkout-embed to finish loading Firebase
      var firebaseWait = setInterval(function () {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
          clearInterval(firebaseWait);
          initAuth();
        }
      }, 200);
      // Timeout: load schedule without auth after 5s
      setTimeout(function () {
        if (!firebaseReady) {
          clearInterval(firebaseWait);
          loadSchedule();
        }
      }, 5000);
    }

    // If Firebase never loads, still show the schedule
    loadSchedule();
  }

  // ── Public API ──────────────────────────────────────────────────────
  window.HYCSchedule = {
    reload: loadSchedule,
    nextWeek: function () { scheduleWeekOffset++; scheduleShowAllDays = false; loadSchedule(); },
    prevWeek: function () { scheduleWeekOffset--; scheduleShowAllDays = false; loadSchedule(); }
  };

  // ── Go ──────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
