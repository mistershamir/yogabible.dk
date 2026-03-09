// =====================================================================
// YOGA BIBLE — Schedule Embed (self-contained)
// Renders a live weekly class schedule with booking, auth, pass info.
// Uses the existing Firebase auth + YB auth modal on the page.
// Brand: #f75c03 (YB orange)
// API:   /.netlify/functions (same-domain, relative)
// =====================================================================
(function () {
  'use strict';

  if (window.__yb_schedule_embed_loaded) return;
  window.__yb_schedule_embed_loaded = true;

  // ── Brand & Config ──────────────────────────────────────────────────
  var BRAND      = '#f75c03';
  var BRAND_DARK = '#d94f02';
  var BRAND_LIGHT = '#fff4ed';
  var BRAND_RGB  = '247,92,3';
  var API_BASE   = '/.netlify/functions';
  var PROFILE_URL = '/profile';

  // ── Language ────────────────────────────────────────────────────────
  var isDa = window.location.pathname.indexOf('/en/') !== 0;
  function t(da, en) { return isDa ? da : en; }

  // ── Filter aliases (URL ?filter=key → sessionTypeName match) ──────
  var FILTER_ALIASES = {
    'ytt': '200hrs Teacher Training Workshops'
  };

  // ── State ───────────────────────────────────────────────────────────
  var scheduleUser = null;
  var scheduleMbClientId = null;
  var schedulePassData = null;
  var scheduleWaiverSigned = false;
  var scheduleWeekOffset = 0;
  var scheduleInitialFilter = (function () {
    try {
      var p = new URLSearchParams(window.location.search);
      var f = p.get('filter');
      if (f && FILTER_ALIASES[f]) return FILTER_ALIASES[f];
      if (f) return f;
    } catch (e) {}
    return 'all';
  })();
  var scheduleClassFilter = scheduleInitialFilter;
  var scheduleShowAllDays = false;
  var scheduleAllClasses = [];
  var scheduleWeekStart = null;
  var staffCache = {};
  var actionLock = false;
  var passRefreshTimer = null;
  var firebaseReady = false;
  var container = null;
  var INITIAL_DAYS = 3;

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
    if (document.getElementById('ybs-schedule-css')) return;
    var style = document.createElement('style');
    style.id = 'ybs-schedule-css';
    style.textContent = [

      // ── Reset & Container ──────────────────────────────────────────
      '.ybs{font-family:Abacaxi,"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;color:#0F0F0F;max-width:720px;margin:0 auto;padding:0 16px;-webkit-font-smoothing:antialiased;overflow-x:hidden;width:100%}',
      '.ybs *,.ybs *::before,.ybs *::after{box-sizing:border-box}',

      // ── Toolbar (nav + filter + auth in one row) ──────────────────
      '.ybs__toolbar{display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap}',
      '.ybs__nav{display:flex;align-items:center;gap:0.25rem;flex:1;min-width:0}',
      '.ybs__nav-btn{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;background:none;border:1.5px solid #E8E4E0;border-radius:8px;cursor:pointer;transition:all .2s;color:#6F6A66;flex-shrink:0}',
      '.ybs__nav-btn:hover{border-color:' + BRAND + ';color:' + BRAND + ';background:' + BRAND_LIGHT + '}',
      '.ybs__nav-btn svg{width:16px;height:16px}',
      '.ybs__week-label{font-weight:700;color:#0F0F0F;text-align:center;font-size:0.9rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

      // ── Auth buttons (login/logout/profile) ────────────────────────
      '.ybs__auth{display:flex;gap:0.35rem;flex-shrink:0}',
      '.ybs__auth-btn{display:flex;align-items:center;gap:0.3rem;height:32px;padding:0 10px;font-size:0.75rem;font-weight:700;font-family:inherit;border:1.5px solid #E8E4E0;border-radius:8px;background:#fff;color:#0F0F0F;cursor:pointer;transition:all .15s;white-space:nowrap;text-decoration:none}',
      '.ybs__auth-btn:hover{border-color:' + BRAND + ';color:' + BRAND + '}',
      '.ybs__auth-btn--profile{color:' + BRAND + ';border-color:' + BRAND + '}',
      '.ybs__auth-btn--profile:hover{background:' + BRAND_LIGHT + '}',
      '.ybs__auth-btn--logout{color:#6F6A66;font-weight:600}',
      '.ybs__auth-btn--logout:hover{color:#c0392b;border-color:#c0392b}',
      '.ybs__auth-btn svg{width:14px;height:14px}',

      // ── Filter dropdown ────────────────────────────────────────────
      '.ybs__filter-wrap{position:relative;flex-shrink:0}',
      '.ybs__filter-toggle{display:flex;align-items:center;gap:0.35rem;height:32px;padding:0 12px;font-size:0.8rem;font-weight:600;font-family:inherit;border:1.5px solid #E8E4E0;border-radius:8px;background:#fff;color:#0F0F0F;cursor:pointer;transition:all .2s;white-space:nowrap}',
      '.ybs__filter-toggle:hover,.ybs__filter-toggle.is-open{border-color:' + BRAND + ';color:' + BRAND + '}',
      '.ybs__filter-toggle svg{width:14px;height:14px;color:#6F6A66;transition:transform .2s,color .2s}',
      '.ybs__filter-toggle.is-open svg{transform:rotate(180deg);color:' + BRAND + '}',
      '.ybs__filter-toggle .ybs__filter-dot{width:6px;height:6px;border-radius:50%;background:' + BRAND + ';display:none}',
      '.ybs__filter-toggle.has-filter .ybs__filter-dot{display:block}',
      '.ybs__filter-dd{position:absolute;top:calc(100% + 4px);right:0;background:#fff;border:1.5px solid #E8E4E0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.1);min-width:180px;z-index:100;padding:4px;display:none}',
      '.ybs__filter-dd.is-open{display:block}',
      '.ybs__filter-opt{display:block;width:100%;text-align:left;padding:0.5rem 0.75rem;font-size:0.82rem;font-weight:500;font-family:inherit;border:none;background:none;border-radius:6px;color:#0F0F0F;cursor:pointer;transition:background .15s}',
      '.ybs__filter-opt:hover{background:#F5F3F0}',
      '.ybs__filter-opt.is-active{background:' + BRAND_LIGHT + ';color:' + BRAND + ';font-weight:700}',

      // ── No-pass banner ─────────────────────────────────────────────
      '.ybs__no-pass{background:' + BRAND_LIGHT + ';border:1.5px solid ' + BRAND + ';border-radius:10px;padding:1rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem}',
      '.ybs__no-pass p{margin:0;font-weight:700;color:#0F0F0F;font-size:0.85rem}',

      // ── Pass info dropdown ─────────────────────────────────────────
      '.ybs__pass-info{margin-bottom:1rem}',
      '.ybs__pass-dd{border:1.5px solid #E8E4E0;border-radius:10px;background:#FFFCF9;overflow:hidden}',
      '.ybs__pass-dd-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;background:none;border:none;cursor:pointer;font-family:inherit;transition:background .2s}',
      '.ybs__pass-dd-toggle:hover{background:#F5F3F0}',
      '.ybs__pass-dd-summary{display:flex;flex-direction:column;align-items:flex-start;gap:1px}',
      '.ybs__pass-dd-label{font-size:0.72rem;font-weight:700;color:#0F0F0F;text-transform:uppercase;letter-spacing:.04em}',
      '.ybs__pass-dd-count{font-size:0.78rem;color:#6F6A66}',
      '.ybs__pass-dd-chevron{color:#6F6A66;transition:transform .25s;flex-shrink:0}',
      '.ybs__pass-dd-toggle.is-open .ybs__pass-dd-chevron{transform:rotate(180deg)}',
      '.ybs__pass-dd-body{padding:0 1rem 0.75rem;display:flex;flex-direction:column;gap:0.5rem}',
      '.ybs__pass-dd-body[hidden]{display:none}',
      '.ybs__pass-card{background:linear-gradient(135deg,' + BRAND_LIGHT + ',#FFFCF9);border:1.5px solid ' + BRAND + ';border-radius:10px;padding:0.75rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap}',
      '.ybs__pass-label{font-size:0.68rem;text-transform:uppercase;letter-spacing:.05em;color:#6F6A66;display:block}',
      '.ybs__pass-name{font-weight:700;color:#0F0F0F;font-size:0.9rem;display:block}',
      '.ybs__pass-stats{display:flex;gap:1rem;align-items:center}',
      '.ybs__pass-stat{font-size:0.8rem;color:#6F6A66}',
      '.ybs__pass-stat strong{color:' + BRAND + ';font-size:1rem}',
      '.ybs__pass-stat--low{color:#c0392b}',

      // ── Day groups ─────────────────────────────────────────────────
      '.ybs__day{margin-bottom:0}',
      '.ybs__day+.ybs__day{border-top:2px solid ' + BRAND + ';margin-top:0.25rem;padding-top:0.25rem}',
      '.ybs__day-label{font-size:0.82rem;font-weight:700;color:#0F0F0F;padding:0.4rem 0 0.3rem;margin:0;display:flex;align-items:baseline;gap:0.4rem}',
      '.ybs__day-label span{font-weight:400;color:#6F6A66;font-size:0.8rem}',
      '.ybs__day--hidden{display:none}',

      // ── Class rows ─────────────────────────────────────────────────
      '.ybs__class{display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0.5rem;border-bottom:1px solid #F0EDEA;transition:background .15s}',
      '.ybs__class:last-child{border-bottom:none}',
      '.ybs__class:hover{background:#FAFAF8}',
      '.ybs__class.is-cancelled{opacity:0.45}',
      '.ybs__class.is-past{opacity:0.4}',
      '.ybs__class-time{font-weight:700;color:#0F0F0F;font-size:0.82rem;min-width:95px;white-space:nowrap}',
      '.ybs__class-info{flex:1;display:flex;flex-direction:column;gap:0.05rem;min-width:0}',
      '.ybs__class-name{font-weight:700;color:#0F0F0F;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ybs__class-instructor{font-size:0.78rem;color:#6F6A66}',
      '.ybs__class-instructor--link{cursor:pointer;color:' + BRAND + ';text-decoration:underline;text-underline-offset:2px}',
      '.ybs__class-instructor--link:hover{color:' + BRAND_DARK + '}',
      '.ybs__class-spots{font-size:0.72rem;color:' + BRAND + ';font-weight:600}',
      '.ybs__class-action{flex-shrink:0}',

      // ── Description toggle ─────────────────────────────────────────
      '.ybs__desc-toggle{background:none;border:none;color:' + BRAND + ';font-size:0.75rem;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline;text-underline-offset:2px}',
      '.ybs__desc-toggle:hover{color:' + BRAND_DARK + '}',
      '.ybs__desc{background:#FFFCF9;border:1px solid #E8E4E0;border-radius:8px;margin:0.25rem 0;padding:0.75rem 1rem;font-size:0.82rem;color:#6F6A66;line-height:1.5}',
      '.ybs__desc[hidden]{display:none!important}',
      '.ybs__desc p{margin:0 0 0.4rem}',
      '.ybs__desc p:last-child{margin-bottom:0}',

      // ── Teacher bio ────────────────────────────────────────────────
      '.ybs__teacher-bio{background:#FFFCF9;border:1px solid #E8E4E0;border-radius:10px;margin:0.25rem 0;padding:1rem;display:flex;gap:0.75rem;align-items:flex-start}',
      '.ybs__teacher-bio[hidden]{display:none!important;margin:0;padding:0;height:0;overflow:hidden}',
      '.ybs__teacher-photo{width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid #E8E4E0}',
      '.ybs__teacher-name{font-weight:700;color:#0F0F0F;margin:0 0 0.2rem;font-size:0.88rem}',
      '.ybs__teacher-bio-text{font-size:0.8rem;color:#6F6A66;line-height:1.5;margin:0}',

      // ── Buttons ────────────────────────────────────────────────────
      '.ybs-btn{display:inline-flex;align-items:center;justify-content:center;padding:0.35rem 0.9rem;border-radius:999px;font-family:inherit;font-size:0.8rem;font-weight:700;text-decoration:none;border:1.5px solid transparent;cursor:pointer;transition:all .2s;white-space:nowrap}',
      '.ybs-btn--primary{background:' + BRAND + ';color:#fff;border-color:' + BRAND + '}',
      '.ybs-btn--primary:hover{background:' + BRAND_DARK + ';border-color:' + BRAND_DARK + ';transform:translateY(-1px);box-shadow:0 3px 10px rgba(' + BRAND_RGB + ',.25)}',
      '.ybs-btn--outline{background:transparent;color:#0F0F0F;border-color:#E8E4E0}',
      '.ybs-btn--outline:hover{border-color:' + BRAND + ';color:' + BRAND + '}',
      '.ybs-btn--booked{background:' + BRAND_LIGHT + ';color:' + BRAND + ';border-color:' + BRAND + ';position:relative}',
      '.ybs-btn--booked:hover{background:#ffe8d6}',
      '.ybs-btn--cancel{background:#fff;color:#c0392b;border-color:#c0392b;font-size:0.75rem}',
      '.ybs-btn--cancel:hover{background:#fdf0ed}',
      '.ybs-btn--ghost{background:none;border:none;color:' + BRAND + ';padding:0.3rem 0.4rem;font-size:0.78rem;text-decoration:underline;text-underline-offset:2px}',
      '.ybs-btn--ghost:hover{color:' + BRAND_DARK + '}',
      '.ybs-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none;box-shadow:none}',

      // ── Cancel popover ─────────────────────────────────────────────
      '.ybs__cancel-pop{position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1.5px solid #E8E4E0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:0.85rem 1rem;z-index:100;width:220px;text-align:center}',
      '.ybs__cancel-pop-text{font-size:0.8rem;color:#0F0F0F;margin:0 0 0.6rem;line-height:1.4}',
      '.ybs__cancel-pop-btns{display:flex;gap:0.5rem;justify-content:center}',

      // ── Badge ──────────────────────────────────────────────────────
      '.ybs__badge{display:inline-block;padding:0.2rem 0.6rem;border-radius:20px;font-size:0.7rem;font-weight:700}',
      '.ybs__badge--cancelled{background:#F5F3F0;color:#6F6A66}',

      // ── Show more ──────────────────────────────────────────────────
      '.ybs__show-more-wrap{text-align:center;padding:0.75rem 0}',
      '.ybs__show-more-btn{background:' + BRAND + ';color:#fff;border-color:' + BRAND + ';min-width:180px;font-size:0.82rem;padding:0.45rem 1.25rem}',
      '.ybs__show-more-btn:hover{background:' + BRAND_DARK + ';border-color:' + BRAND_DARK + ';transform:translateY(-1px);box-shadow:0 3px 10px rgba(' + BRAND_RGB + ',.25)}',

      // ── Toast ──────────────────────────────────────────────────────
      '.ybs__toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);padding:0.65rem 1.25rem;border-radius:8px;font-weight:700;font-size:0.85rem;z-index:10001;box-shadow:0 4px 20px rgba(0,0,0,.15);font-family:inherit;max-width:90vw;text-align:center;opacity:0;transition:opacity .3s;pointer-events:none}',
      '.ybs__toast.is-visible{opacity:1;pointer-events:auto}',
      '.ybs__toast--success{background:#0F0F0F;color:#fff}',
      '.ybs__toast--error{background:#c0392b;color:#fff}',
      '.ybs__toast--warning{background:#e67e22;color:#fff}',
      '.ybs__toast-note{font-weight:400;font-size:0.78rem;margin-top:0.4rem;opacity:0.85;line-height:1.4}',

      // ── Loading / Empty / Error ────────────────────────────────────
      '.ybs__loading{display:flex;align-items:center;justify-content:center;gap:0.6rem;padding:2.5rem 0;color:#6F6A66;font-size:0.85rem}',
      '.ybs__spinner{width:18px;height:18px;border:2.5px solid #E8E4E0;border-top-color:' + BRAND + ';border-radius:50%;animation:ybs-spin .8s linear infinite}',
      '@keyframes ybs-spin{to{transform:rotate(360deg)}}',
      '.ybs__empty{text-align:center;color:#6F6A66;padding:2.5rem 0;font-size:0.88rem}',
      '.ybs__error{text-align:center;color:#c0392b;padding:2.5rem 0;font-size:0.88rem}',

      // ── Tablet ───────────────────────────────────────────────────
      '@media (max-width:768px){',
        '.ybs__toolbar{gap:0.4rem}',
      '}',

      // ── Mobile ─────────────────────────────────────────────────────
      '@media (max-width:640px){',
        '.ybs__toolbar{gap:0.35rem}',
        '.ybs__nav{flex:1 1 100%;order:1;justify-content:center}',
        '.ybs__week-label{font-size:0.82rem;min-width:0}',
        '.ybs__filter-wrap{order:2}',
        '.ybs__auth{order:3}',
        '.ybs__class{flex-wrap:wrap;padding:0.55rem 0.5rem;gap:0.35rem}',
        '.ybs__class-time{min-width:auto;font-size:0.78rem;flex:0 0 auto}',
        '.ybs__class-info{flex:1 1 0%;min-width:0}',
        '.ybs__class-name{font-size:0.82rem;white-space:normal;overflow:visible}',
        '.ybs__class-action{width:100%;text-align:right;margin-top:0.15rem}',
        '.ybs__no-pass{flex-direction:column;text-align:center;padding:0.85rem 1rem}',
        '.ybs__pass-card{flex-direction:column;align-items:flex-start}',
        '.ybs__pass-stats{flex-wrap:wrap;gap:0.5rem}',
        '.ybs__teacher-bio{flex-direction:column;align-items:center;text-align:center}',
        '.ybs__cancel-pop{right:auto;left:50%;transform:translateX(-50%);width:200px}',
        '.ybs__filter-dd{right:0;left:auto;min-width:160px}',
        '.ybs__auth-btn{font-size:0.7rem;padding:0 8px;height:28px}',
        '.ybs__auth-btn svg{width:12px;height:12px}',
        '.ybs__day-label{font-size:0.78rem}',
        '.ybs__day-label span{font-size:0.75rem}',
      '}',

      // ── Small phones ──────────────────────────────────────────────
      '@media (max-width:400px){',
        '.ybs{padding:0 10px}',
        '.ybs__nav-btn{width:28px;height:28px}',
        '.ybs__nav-btn svg{width:14px;height:14px}',
        '.ybs__week-label{font-size:0.75rem}',
        '.ybs__filter-toggle{height:28px;padding:0 8px;font-size:0.75rem}',
        '.ybs__class{padding:0.4rem 0.35rem}',
        '.ybs__class-time{font-size:0.72rem}',
        '.ybs__class-name{font-size:0.78rem}',
        '.ybs__class-instructor{font-size:0.72rem}',
        '.ybs__class-spots{font-size:0.68rem}',
        '.ybs-btn{padding:0.3rem 0.7rem;font-size:0.75rem}',
        '.ybs__show-more-btn{min-width:140px;font-size:0.78rem;padding:0.4rem 1rem}',
        '.ybs__pass-dd-toggle{padding:0.6rem 0.75rem}',
        '.ybs__pass-dd-label{font-size:0.68rem}',
        '.ybs__pass-dd-count{font-size:0.72rem}',
        '.ybs__cancel-pop{width:180px;padding:0.65rem 0.75rem}',
        '.ybs__cancel-pop-text{font-size:0.75rem}',
      '}'

    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Render container HTML ───────────────────────────────────────────
  function injectHTML() {
    container = document.getElementById('yb-schedule-embed');
    if (!container) return false;

    container.innerHTML =
      '<div class="ybs">' +
        '<div class="ybs__toolbar">' +
          // Week nav
          '<div class="ybs__nav">' +
            '<button class="ybs__nav-btn" type="button" id="ybs-prev" title="' + t('Forrige uge', 'Previous week') + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
            '</button>' +
            '<span class="ybs__week-label" id="ybs-week-label"></span>' +
            '<button class="ybs__nav-btn" type="button" id="ybs-next" title="' + t('Næste uge', 'Next week') + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
            '</button>' +
          '</div>' +
          // Filter dropdown
          '<div class="ybs__filter-wrap" id="ybs-filter-wrap">' +
            '<button class="ybs__filter-toggle" type="button" id="ybs-filter-toggle">' +
              '<span class="ybs__filter-dot"></span>' +
              '<span id="ybs-filter-label">' + t('Filter', 'Filter') + '</span>' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
            '</button>' +
            '<div class="ybs__filter-dd" id="ybs-filter-dd"></div>' +
          '</div>' +
          // Auth buttons
          '<div class="ybs__auth" id="ybs-auth">' +
            '<button class="ybs__auth-btn" type="button" id="ybs-login-btn">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
              '<span>' + t('Log ind', 'Login') + '</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        // Pass info / no-pass
        '<div id="ybs-pass-info" class="ybs__pass-info" hidden></div>' +
        '<div id="ybs-no-pass" hidden>' +
          '<div class="ybs__no-pass">' +
            '<p>' + t('Du har brug for et pas for at booke klasser.', 'You need a pass to book classes.') + '</p>' +
            '<a class="ybs-btn ybs-btn--primary" href="' + PROFILE_URL + '#store">' + t('Køb pas', 'Buy a pass') + '</a>' +
          '</div>' +
        '</div>' +
        // Schedule list
        '<div id="ybs-list">' +
          '<div class="ybs__loading"><div class="ybs__spinner"></div><span>' + t('Henter hold...', 'Loading classes...') + '</span></div>' +
        '</div>' +
        '<div id="ybs-toast" class="ybs__toast"></div>' +
      '</div>';

    // Wire nav buttons
    var prevBtn = document.getElementById('ybs-prev');
    var nextBtn = document.getElementById('ybs-next');
    if (prevBtn) prevBtn.addEventListener('click', function () { scheduleWeekOffset--; scheduleShowAllDays = false; loadSchedule(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { scheduleWeekOffset++; scheduleShowAllDays = false; loadSchedule(); });

    // Wire login button
    var loginBtn = document.getElementById('ybs-login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', function () {
        if (typeof window.openYBAuthModal === 'function') {
          window.openYBAuthModal('login');
        } else {
          window.location.href = PROFILE_URL;
        }
      });
    }

    // Wire filter dropdown toggle
    var filterToggle = document.getElementById('ybs-filter-toggle');
    var filterDd = document.getElementById('ybs-filter-dd');
    if (filterToggle && filterDd) {
      filterToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = filterDd.classList.contains('is-open');
        filterDd.classList.toggle('is-open', !isOpen);
        filterToggle.classList.toggle('is-open', !isOpen);
      });
      document.addEventListener('click', function (e) {
        if (!e.target.closest('#ybs-filter-wrap')) {
          filterDd.classList.remove('is-open');
          filterToggle.classList.remove('is-open');
        }
      });
    }

    return true;
  }

  // ── Auth buttons update ───────────────────────────────────────────
  function updateAuthButtons() {
    var authEl = document.getElementById('ybs-auth');
    if (!authEl) return;

    var lp = isDa ? '' : '/en';

    if (scheduleUser) {
      authEl.innerHTML =
        '<a class="ybs__auth-btn ybs__auth-btn--profile" href="' + lp + PROFILE_URL + '#passes">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
          '<span>' + t('Min profil', 'My Profile') + '</span>' +
        '</a>' +
        '<button class="ybs__auth-btn ybs__auth-btn--logout" type="button" id="ybs-logout-btn">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
          '<span>' + t('Log ud', 'Logout') + '</span>' +
        '</button>';
      var logoutBtn = document.getElementById('ybs-logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
          if (typeof firebase !== 'undefined' && firebase.auth) {
            firebase.auth().signOut().then(function () {
              showToast(t('Du er logget ud.', 'You are logged out.'), 'success');
            });
          }
        });
      }
    } else {
      authEl.innerHTML =
        '<button class="ybs__auth-btn" type="button" id="ybs-login-btn">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
          '<span>' + t('Log ind', 'Login') + '</span>' +
        '</button>';
      var loginBtn = document.getElementById('ybs-login-btn');
      if (loginBtn) {
        loginBtn.addEventListener('click', function () {
          if (typeof window.openYBAuthModal === 'function') {
            window.openYBAuthModal('login');
          } else {
            window.location.href = PROFILE_URL;
          }
        });
      }
    }
  }

  // ── Toast ───────────────────────────────────────────────────────────
  var toastTimer = null;
  function showToast(msg, type, extraHtml) {
    var el = document.getElementById('ybs-toast');
    if (!el) return;
    el.className = 'ybs__toast ybs__toast--' + type;
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
    var filters = [{ id: 'all', label: t('Alle hold', 'All classes') }];
    classes.forEach(function (cls) {
      var st = cls.sessionTypeName;
      if (st && !seen[st]) {
        seen[st] = true;
        filters.push({ id: st, label: st });
      }
    });
    // Ensure pre-selected filter from URL is always visible
    if (scheduleClassFilter !== 'all' && !seen[scheduleClassFilter]) {
      filters.push({ id: scheduleClassFilter, label: scheduleClassFilter });
    }
    filters.sort(function (a, b) {
      if (a.id === 'all') return -1;
      if (b.id === 'all') return 1;
      return a.label.localeCompare(b.label);
    });
    return filters;
  }

  function renderFilterDropdown(classes) {
    var ddEl = document.getElementById('ybs-filter-dd');
    var toggleEl = document.getElementById('ybs-filter-toggle');
    var labelEl = document.getElementById('ybs-filter-label');
    if (!ddEl) return;

    var filters = buildFilters(classes);
    var html = '';
    filters.forEach(function (f) {
      var active = scheduleClassFilter === f.id;
      html += '<button class="ybs__filter-opt' + (active ? ' is-active' : '') + '" type="button" data-ybs-filter="' + esc(f.id) + '">' + esc(f.label) + '</button>';
    });
    ddEl.innerHTML = html;

    if (labelEl) {
      labelEl.textContent = scheduleClassFilter === 'all' ? t('Filter', 'Filter') : scheduleClassFilter;
    }
    if (toggleEl) {
      toggleEl.classList.toggle('has-filter', scheduleClassFilter !== 'all');
    }

    ddEl.querySelectorAll('[data-ybs-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        scheduleClassFilter = btn.getAttribute('data-ybs-filter');
        scheduleShowAllDays = false;
        ddEl.classList.remove('is-open');
        if (toggleEl) toggleEl.classList.remove('is-open');
        renderFilterDropdown(scheduleAllClasses);
        var listEl = document.getElementById('ybs-list');
        if (listEl) renderSchedule(listEl, scheduleAllClasses, scheduleWeekStart);
      });
    });
  }

  // ── Load schedule ───────────────────────────────────────────────────
  function loadSchedule() {
    var listEl = document.getElementById('ybs-list');
    if (!listEl) return;

    var noPassEl = document.getElementById('ybs-no-pass');
    if (noPassEl) noPassEl.hidden = true;

    listEl.innerHTML = '<div class="ybs__loading"><div class="ybs__spinner"></div><span>' + t('Henter hold...', 'Loading classes...') + '</span></div>';

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
    var labelEl = document.getElementById('ybs-week-label');
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
          listEl.innerHTML = '<p class="ybs__empty">' + t('Ingen hold denne uge.', 'No classes this week.') + '</p>';
          return;
        }

        var bookedIds = {};
        visits.forEach(function (v) {
          if (v.classId && v.isFuture && !v.lateCancelled) bookedIds[v.classId] = true;
        });
        classes.forEach(function (cls) {
          if (bookedIds[cls.id]) cls.isBooked = true;
        });

        renderFilterDropdown(classes);
        renderSchedule(listEl, classes, start);
      })
      .catch(function () {
        listEl.innerHTML = '<p class="ybs__error">' + t('Kunne ikke hente skema.', 'Could not load schedule.') + '</p>';
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

    var html = '';
    var sortedKeys = Object.keys(days).sort();
    var hasMore = sortedKeys.length > INITIAL_DAYS && !scheduleShowAllDays;
    var dayIndex = 0;

    sortedKeys.forEach(function (key) {
      var day = days[key];
      day.classes.sort(function (a, b) { return new Date(a.startDateTime) - new Date(b.startDateTime); });
      var dateObj = day.date;
      var dayName = dayNames[dateObj.getDay()];
      var dateLabel = dateObj.toLocaleDateString(isDa ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'long' });
      var isHidden = hasMore && dayIndex >= INITIAL_DAYS;

      html += '<div class="ybs__day' + (isHidden ? ' ybs__day--hidden' : '') + '">';
      html += '<h3 class="ybs__day-label">' + dayName + ' <span>' + dateLabel + '</span></h3>';

      day.classes.forEach(function (cls) {
        var startTime = formatTime(cls.startDateTime);
        var endTime = formatTime(cls.endDateTime);
        var isPast = new Date(cls.startDateTime) < new Date();
        var descId = 'ybs-desc-' + cls.id;
        var bioId = 'ybs-bio-' + cls.id;

        html += '<div class="ybs__class' + (cls.isCanceled ? ' is-cancelled' : '') + (isPast ? ' is-past' : '') + '">';
        html += '<div class="ybs__class-time">' + startTime + ' – ' + endTime + '</div>';
        html += '<div class="ybs__class-info">';
        html += '<span class="ybs__class-name">' + esc(cls.name) + '</span>';

        if (cls.instructorId && cls.instructor !== 'TBA') {
          html += '<span class="ybs__class-instructor ybs__class-instructor--link" data-ybs-bio="' + bioId + '" data-ybs-staff="' + cls.instructorId + '">' + esc(cls.instructor) + '</span>';
        } else {
          html += '<span class="ybs__class-instructor">' + esc(cls.instructor) + '</span>';
        }

        if (cls.spotsLeft !== null && cls.spotsLeft > 0 && cls.spotsLeft <= 7 && !cls.isCanceled && !isPast) {
          html += '<span class="ybs__class-spots">' + cls.spotsLeft + ' ' + t('pladser tilbage', 'spots left') + '</span>';
        }

        if (cls.description) {
          html += '<button class="ybs__desc-toggle" type="button" data-ybs-desc="' + descId + '">' + t('Vis beskrivelse', 'Show description') + '</button>';
        }

        html += '</div>';
        html += '<div class="ybs__class-action">';

        if (cls.isCanceled) {
          html += '<span class="ybs__badge ybs__badge--cancelled">' + t('Aflyst', 'Cancelled') + '</span>';
        } else if (isPast) {
          // no action
        } else if (cls.isBooked) {
          html += '<div style="position:relative;display:inline-block">';
          html += '<button class="ybs-btn ybs-btn--booked" type="button" data-ybs-booked="' + cls.id + '">' + t('Booket ✓', 'Booked ✓') + '</button>';
          html += '</div>';
        } else if (cls.spotsLeft === 0) {
          html += '<button class="ybs-btn ybs-btn--outline" type="button" data-ybs-waitlist="' + cls.id + '">' + t('Venteliste', 'Waitlist') + '</button>';
        } else {
          html += '<button class="ybs-btn ybs-btn--primary" type="button" data-ybs-book="' + cls.id + '">' + t('Book', 'Book') + '</button>';
        }

        html += '</div>';
        html += '</div>';

        if (cls.instructorId && cls.instructor !== 'TBA') {
          html += '<div class="ybs__teacher-bio" id="' + bioId + '" hidden></div>';
        }
        if (cls.description) {
          html += '<div class="ybs__desc" id="' + descId + '" hidden>' + cls.description + '</div>';
        }
      });

      html += '</div>';
      dayIndex++;
    });

    if (sortedKeys.length === 0 && scheduleClassFilter !== 'all') {
      html += '<p style="text-align:center;color:#6F6A66;padding:2rem 0;font-size:0.88rem">' + t('Ingen klasser af denne type.', 'No classes of this type.') + '</p>';
    }

    if (hasMore) {
      var hiddenCount = sortedKeys.length - INITIAL_DAYS;
      html += '<div class="ybs__show-more-wrap"><button class="ybs-btn ybs__show-more-btn" type="button" id="ybs-show-more">' + t('Vis ' + hiddenCount + ' dage mere', 'Show ' + hiddenCount + ' more days') + '</button></div>';
    }

    listEl.innerHTML = html;

    // ── Wire event handlers ─────────────────────────────────────────

    var showMoreBtn = document.getElementById('ybs-show-more');
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', function () {
        scheduleShowAllDays = true;
        listEl.querySelectorAll('.ybs__day--hidden').forEach(function (el) { el.classList.remove('ybs__day--hidden'); });
        showMoreBtn.parentElement.remove();
      });
    }

    // Book buttons
    listEl.querySelectorAll('[data-ybs-book]').forEach(function (btn) {
      btn.onclick = function () { bookClass(btn); };
    });

    // Booked buttons → cancel popover
    listEl.querySelectorAll('[data-ybs-booked]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var wrapper = btn.parentElement;
        var existing = wrapper.querySelector('.ybs__cancel-pop');
        if (existing) { existing.remove(); return; }
        listEl.querySelectorAll('.ybs__cancel-pop').forEach(function (p) { p.remove(); });
        var classId = btn.getAttribute('data-ybs-booked');
        var pop = document.createElement('div');
        pop.className = 'ybs__cancel-pop';
        pop.innerHTML =
          '<p class="ybs__cancel-pop-text">' + t('Vil du annullere denne booking?', 'Cancel this booking?') + '</p>' +
          '<div class="ybs__cancel-pop-btns">' +
            '<button class="ybs-btn ybs-btn--cancel" type="button" data-ybs-confirm-cancel="' + classId + '">' + t('Annuller', 'Cancel') + '</button>' +
            '<button class="ybs-btn ybs-btn--outline" type="button" data-ybs-dismiss-cancel>' + t('Behold', 'Keep') + '</button>' +
          '</div>';
        wrapper.appendChild(pop);
        pop.querySelector('[data-ybs-confirm-cancel]').addEventListener('click', function (ev) {
          ev.stopPropagation();
          cancelBooking(btn, classId, pop);
        });
        pop.querySelector('[data-ybs-dismiss-cancel]').addEventListener('click', function (ev) {
          ev.stopPropagation();
          pop.remove();
        });
      });
    });

    document.addEventListener('click', function () {
      var pops = document.querySelectorAll('.ybs__cancel-pop');
      pops.forEach(function (p) { p.remove(); });
    });

    // Waitlist buttons
    listEl.querySelectorAll('[data-ybs-waitlist]').forEach(function (btn) {
      btn.addEventListener('click', function () { joinWaitlist(btn); });
    });

    // Description toggles
    listEl.querySelectorAll('[data-ybs-desc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var descEl = document.getElementById(btn.getAttribute('data-ybs-desc'));
        if (descEl) {
          var isHidden = descEl.hidden;
          descEl.hidden = !isHidden;
          btn.textContent = isHidden ? t('Skjul beskrivelse', 'Hide description') : t('Vis beskrivelse', 'Show description');
        }
      });
    });

    // Teacher bio toggles
    listEl.querySelectorAll('[data-ybs-bio]').forEach(function (el) {
      el.addEventListener('click', function () {
        var bioEl = document.getElementById(el.getAttribute('data-ybs-bio'));
        if (!bioEl) return;
        if (!bioEl.hidden) { bioEl.hidden = true; return; }
        var staffId = el.getAttribute('data-ybs-staff');
        if (staffCache[staffId]) {
          renderTeacherBio(bioEl, staffCache[staffId]);
          bioEl.hidden = false;
          return;
        }
        bioEl.innerHTML = '<p class="ybs__teacher-bio-text">' + t('Henter...', 'Loading...') + '</p>';
        bioEl.hidden = false;
        fetch(API_BASE + '/mb-staff?staffId=' + staffId)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var staff = (data.staff || [])[0];
            if (staff) {
              staffCache[staffId] = staff;
              renderTeacherBio(bioEl, staff);
            } else {
              bioEl.innerHTML = '<p class="ybs__teacher-bio-text">' + t('Ingen info tilgængelig.', 'No info available.') + '</p>';
            }
          })
          .catch(function () {
            bioEl.innerHTML = '<p class="ybs__teacher-bio-text">' + t('Kunne ikke hente info.', 'Could not load info.') + '</p>';
          });
      });
    });
  }

  function renderTeacherBio(el, staff) {
    var html = '';
    if (staff.imageUrl) {
      html += '<img class="ybs__teacher-photo" src="' + esc(staff.imageUrl) + '" alt="' + esc(staff.name) + '">';
    }
    html += '<div>';
    html += '<p class="ybs__teacher-name">' + esc(staff.name) + '</p>';
    html += '<p class="ybs__teacher-bio-text">' + (staff.bio || t('Ingen biografi tilgængelig.', 'No biography available.')) + '</p>';
    html += '</div>';
    el.innerHTML = html;
  }

  // ── Pass info ─────────────────────────────────────────────────────
  function loadPassInfo() {
    if (!scheduleMbClientId) return;
    var passInfoEl = document.getElementById('ybs-pass-info');
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
    var noPassEl = document.getElementById('ybs-no-pass');

    if (hasActive) {
      if (noPassEl) noPassEl.hidden = true;

      var summaryParts = [];
      if (activeContracts.length > 0) {
        summaryParts.push(activeContracts.length + ' ' + t(activeContracts.length === 1 ? 'medlemskab' : 'medlemskaber', activeContracts.length === 1 ? 'membership' : 'memberships'));
      }
      if (activeServices.length > 0) {
        summaryParts.push(activeServices.length + ' ' + t('klippekort', activeServices.length === 1 ? 'pass' : 'passes'));
      }

      var html = '<div class="ybs__pass-dd">';
      html += '<button class="ybs__pass-dd-toggle" type="button">';
      html += '<div class="ybs__pass-dd-summary">';
      html += '<span class="ybs__pass-dd-label">' + t('Dine aktive pas', 'Your active passes') + '</span>';
      html += '<span class="ybs__pass-dd-count">' + summaryParts.join(' + ') + '</span>';
      html += '</div>';
      html += '<svg class="ybs__pass-dd-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      html += '</button>';
      html += '<div class="ybs__pass-dd-body" hidden>';

      activeServices.forEach(function (s) {
        html += '<div class="ybs__pass-card">';
        html += '<div><span class="ybs__pass-label">' + t('Dit aktive klippekort', 'Your active pass') + '</span>';
        html += '<span class="ybs__pass-name">' + esc(s.name) + '</span></div>';
        html += '<div class="ybs__pass-stats">';
        if (s.remaining != null) {
          html += '<span class="ybs__pass-stat"><strong>' + s.remaining + '</strong> ' + t('klip tilbage', 'sessions left') + '</span>';
          if (s.remaining > 0 && s.remaining < 3) {
            html += '<span class="ybs__pass-stat ybs__pass-stat--low">' + t('Snart opbrugt', 'Running low') + '</span>';
          }
        }
        if (s.expirationDate) {
          var expDate = new Date(s.expirationDate);
          html += '<span class="ybs__pass-stat">' + t('Udløber', 'Expires') + ' ' + expDate.toLocaleDateString(isDa ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }) + '</span>';
        }
        html += '</div></div>';
      });

      activeContracts.forEach(function (c) {
        html += '<div class="ybs__pass-card">';
        html += '<div><span class="ybs__pass-label">' + t('Medlemskab', 'Membership') + '</span>';
        html += '<span class="ybs__pass-name">' + esc(c.name) + '</span></div>';
        if (c.endDate) {
          html += '<div class="ybs__pass-stats"><span class="ybs__pass-stat">' + t('Fornyes', 'Renews') + ' ' + new Date(c.endDate).toLocaleDateString(isDa ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }) + '</span></div>';
        }
        html += '</div>';
      });

      html += '</div></div>';
      passInfoEl.innerHTML = html;
      passInfoEl.hidden = false;

      var toggle = passInfoEl.querySelector('.ybs__pass-dd-toggle');
      var body = passInfoEl.querySelector('.ybs__pass-dd-body');
      if (toggle && body) {
        toggle.onclick = function () {
          var isOpen = !body.hidden;
          body.hidden = isOpen;
          toggle.classList.toggle('is-open', !isOpen);
        };
      }
    } else {
      passInfoEl.hidden = true;
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
    var classId = btn.getAttribute('data-ybs-book');
    if (!classId) return;

    if (!scheduleUser) {
      if (typeof window.openYBAuthModal === 'function') {
        window.openYBAuthModal('login');
      } else {
        window.location.href = PROFILE_URL + '#schedule';
      }
      return;
    }

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
            bookClass(btn);
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
          btn.textContent = t('Booket ✓', 'Booked ✓');
          btn.className = 'ybs-btn ybs-btn--booked';
          btn.removeAttribute('data-ybs-book');
          btn.setAttribute('data-ybs-booked', classId);
          btn.disabled = false;
          scheduleShowAllDays = true;
          loadSchedule();
          delayedPassRefresh();
        } else if (data.error === 'no_pass') {
          var progName = data.programName || '';
          showToast(
            t('Dit pas dækker ikke denne klasse', "Your pass doesn't cover this class") + (progName ? ' (' + progName + ')' : '') + '.',
            'error'
          );
          var noPassEl = document.getElementById('ybs-no-pass');
          if (noPassEl) noPassEl.hidden = false;
          btn.disabled = false;
          btn.textContent = t('Book', 'Book');
        } else if (data.error === 'waiver_required' || (data.error && data.error.indexOf('waiver') !== -1)) {
          var lp = isDa ? '' : '/en';
          showToast(
            t('Du skal acceptere ansvarsfrihedserklæringen først.', 'You must accept the liability waiver first.'),
            'error',
            '<div style="margin-top:8px"><a href="' + lp + PROFILE_URL + '#passes" style="color:#fff;text-decoration:underline;font-weight:400;font-size:0.85rem">' + t('Gå til profil →', 'Go to profile →') + '</a></div>'
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

  // ── Cancel booking ──────────────────────────────────────────────────
  function cancelBooking(btn, classId, popEl) {
    if (actionLock) return;
    if (!scheduleMbClientId || !classId) return;

    actionLock = true;
    btn.disabled = true;
    var confirmBtn = popEl.querySelector('[data-ybs-confirm-cancel]');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = t('Annullerer...', 'Cancelling...');
    }

    fetch(API_BASE + '/mb-book', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: scheduleMbClientId, classId: Number(classId) })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          showToast(
            data.lateCancel
              ? t('Sen annullering — der kan forekomme gebyr.', 'Late cancellation — fees may apply.')
              : t('Booking annulleret.', 'Booking cancelled.'),
            data.lateCancel ? 'warning' : 'success'
          );
          scheduleShowAllDays = true;
          loadSchedule();
          delayedPassRefresh();
        } else {
          showToast(data.error || t('Kunne ikke annullere.', 'Could not cancel.'), 'error');
          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = t('Annuller', 'Cancel');
          }
        }
      })
      .catch(function (err) {
        showToast(err.message || t('Fejl ved annullering.', 'Cancellation error.'), 'error');
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = t('Annuller', 'Cancel');
        }
      })
      .finally(function () {
        actionLock = false;
      });
  }

  // ── Waitlist ────────────────────────────────────────────────────────
  function joinWaitlist(btn) {
    if (actionLock) return;
    var classId = btn.getAttribute('data-ybs-waitlist');
    if (!classId) return;

    if (!scheduleUser) {
      if (typeof window.openYBAuthModal === 'function') {
        window.openYBAuthModal('login');
        showToast(t('Log ind for at skrive op.', 'Log in to join waitlist.'), 'success');
      } else {
        window.location.href = PROFILE_URL + '#schedule';
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
      updateAuthButtons();
      if (user) {
        db.collection('users').doc(user.uid).get()
          .then(function (doc) {
            if (doc.exists) {
              scheduleMbClientId = doc.data().mindbodyClientId || null;
            }
            if (scheduleMbClientId) {
              checkWaiver();
            }
            loadSchedule();
          })
          .catch(function () {
            loadSchedule();
          });
      } else {
        scheduleMbClientId = null;
        schedulePassData = null;
        scheduleWaiverSigned = false;
        var passInfoEl = document.getElementById('ybs-pass-info');
        var noPassEl = document.getElementById('ybs-no-pass');
        if (passInfoEl) { passInfoEl.hidden = true; passInfoEl.innerHTML = ''; }
        if (noPassEl) noPassEl.hidden = true;
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
        scheduleWaiverSigned = false;
      });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────
  function boot() {
    injectCSS();
    if (!injectHTML()) {
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
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      initAuth();
    } else {
      var firebaseWait = setInterval(function () {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
          clearInterval(firebaseWait);
          initAuth();
        }
      }, 200);
      setTimeout(function () {
        if (!firebaseReady) {
          clearInterval(firebaseWait);
          loadSchedule();
        }
      }, 5000);
    }
    // Show schedule immediately even without auth
    loadSchedule();
  }

  // ── Public API ────────────────────────────────────────────────────
  window.YBSchedule = {
    reload: loadSchedule,
    nextWeek: function () { scheduleWeekOffset++; scheduleShowAllDays = false; loadSchedule(); },
    prevWeek: function () { scheduleWeekOffset--; scheduleShowAllDays = false; loadSchedule(); },
    setFilter: function (f) {
      scheduleClassFilter = (FILTER_ALIASES[f] || f || 'all');
      scheduleShowAllDays = false;
      renderFilterDropdown(scheduleAllClasses);
      var listEl = document.getElementById('ybs-list');
      if (listEl) renderSchedule(listEl, scheduleAllClasses, scheduleWeekStart);
    }
  };

  // ── Go ────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
