/**
 * YOGA BIBLE — HEADER (fresh rewrite)
 * Dark theme, mega menu, mobile drawer with accordions
 */
(function () {
  'use strict';

  var header = document.getElementById('yb-header');
  if (!header) return;

  /* ── Language detection ── */
  var path = window.location.pathname || '/';
  var isEN = path.indexOf('/en/') === 0 || path === '/en';
  var lang = isEN ? 'en' : 'da';

  var qs = window.location.search || '';
  var hash = window.location.hash || '';
  var base = isEN ? path.replace(/^\/en(\/|$)/, '/') : path;
  var daURL = base + qs + hash;
  var enURL = '/en' + base + qs + hash;

  /* ── Translations ── */
  var t = {
    da: {
      'nav.education': 'Uddannelser',
      'nav.courses': 'Kurser',
      'nav.mentorship': 'Mentorship',
      'nav.resources': 'Ressourcer',
      'nav.about': 'Om Yoga Bible',
      'nav.concepts': 'Koncepter',
      'nav.ourstory': 'Vores Historie',
      'nav.schedule': 'Ugentligt Klasseskema',
      'nav.careers': 'Karriere',
      'nav.teachers': 'Mød Underviserne',
      'nav.copenhagen': 'Om København',
      'nav.accommodation': 'Bolig til Kursister',
      'nav.contact': 'Kontakt',
      'nav.apply': 'Ansøg',
      'mega.200.title': '200 Timer — All Levels',
      'mega.300.title': '300 Timer — Advanced',
      'edu.200.about': 'Om 200-timers yogalæreruddannelser',
      'edu.200.18': '18 uger — fleksibel',
      'edu.200.8': '8 uger — semi-intensiv',
      'edu.200.4': '4 uger — intensiv',
      'edu.300.about': '300-timers avanceret uddannelse',
      'edu.compare': 'Sammenlign uddannelser',
      'more.journal': 'Yoga Journal',
      'more.photo': 'Yoga Fotografi',
      'more.music': 'Yoga Musik',
      'more.glossary': 'Yoga Ordbog',
      'courses.inversions': 'Inversions',
      'courses.splits': 'Splits',
      'courses.backbends': 'Backbends',
      'courses.bundles': 'Kursus Bundles',
      'util.email': 'info@yogabible.dk',
      'util.phone': '+45 53 88 12 09',
      'util.address': 'Torvegade 66, 1400, København K'
    },
    en: {
      'nav.education': 'Educations',
      'nav.courses': 'Courses',
      'nav.mentorship': 'Mentorship',
      'nav.resources': 'Resources',
      'nav.about': 'About Yoga Bible',
      'nav.concepts': 'Concepts',
      'nav.ourstory': 'Our Story',
      'nav.schedule': 'Weekly Class Schedule',
      'nav.careers': 'Careers',
      'nav.teachers': 'Meet the Teachers',
      'nav.copenhagen': 'About Copenhagen',
      'nav.accommodation': 'Student Accommodation',
      'nav.contact': 'Contact',
      'nav.apply': 'Apply',
      'mega.200.title': '200 Hours — All Levels',
      'mega.300.title': '300 Hours — Advanced',
      'edu.200.about': 'About 200-hour yoga teacher trainings',
      'edu.200.18': '18 weeks — flexible',
      'edu.200.8': '8 weeks — semi-intensive',
      'edu.200.4': '4 weeks — intensive',
      'edu.300.about': '300-hour advanced teacher training',
      'edu.compare': 'Compare programs',
      'more.journal': 'Yoga Journal',
      'more.photo': 'Yoga Photography',
      'more.music': 'Yoga Music',
      'more.glossary': 'Yoga Glossary',
      'courses.inversions': 'Inversions',
      'courses.splits': 'Splits',
      'courses.backbends': 'Backbends',
      'courses.bundles': 'Course Bundles',
      'util.email': 'info@yogabible.dk',
      'util.phone': '+45 53 88 12 09',
      'util.address': 'Torvegade 66, 1400, Copenhagen K'
    }
  };

  // Apply translations
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    if (t[lang] && t[lang][key]) el.textContent = t[lang][key];
  });

  /* ── Language flag links ── */
  document.querySelectorAll('[data-lang]').forEach(function (btn) {
    var code = btn.getAttribute('data-lang');
    if (code === 'da') btn.href = daURL;
    if (code === 'en') btn.href = enURL;
    if (code === lang) btn.classList.add('is-active');
  });

  /* ── Desktop helpers ── */
  var isDesktop = function () {
    return window.matchMedia('(min-width:980px)').matches;
  };

  /* ── Regular dropdowns ── */
  var dropdowns = header.querySelectorAll('[data-dd]');

  function openDD(dd) {
    dd.classList.add('is-open');
    var b = dd.querySelector('.yb-dd__btn');
    if (b) b.setAttribute('aria-expanded', 'true');
  }
  function closeDD(dd) {
    dd.classList.remove('is-open');
    var b = dd.querySelector('.yb-dd__btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  }

  dropdowns.forEach(function (dd) {
    if (dd.getAttribute('data-dd') === 'mega') return; // handled below
    var btn = dd.querySelector('.yb-dd__btn');
    var panel = dd.querySelector('.yb-dd__panel');
    if (!btn || !panel) return;

    var timer = null;
    function cancel() { if (timer) clearTimeout(timer); timer = null; }
    function schedule() { cancel(); timer = setTimeout(function () { closeDD(dd); }, 140); }

    btn.addEventListener('pointerenter', function () { if (!isDesktop()) return; cancel(); closeMega(); openDD(dd); });
    btn.addEventListener('pointerleave', function () { if (!isDesktop()) return; schedule(); });
    panel.addEventListener('pointerenter', function () { if (!isDesktop()) return; cancel(); });
    panel.addEventListener('pointerleave', function () { if (!isDesktop()) return; schedule(); });
    btn.addEventListener('click', function (e) {
      if (!isDesktop()) return;
      e.preventDefault();
      var open = dd.classList.contains('is-open');
      dropdowns.forEach(function (x) { if (x !== dd) closeDD(x); });
      closeMega();
      open ? closeDD(dd) : openDD(dd);
    });
  });

  /* ── Mega menu (Education) ── */
  var megaPanel = document.getElementById('yb-mega');
  var megaTrigger = header.querySelector('[data-dd="mega"]');
  var megaBtn = megaTrigger ? megaTrigger.querySelector('.yb-dd__btn') : null;
  var megaTimer = null;

  function openMega() {
    if (!megaPanel) return;
    megaPanel.hidden = false;
    megaPanel.setAttribute('aria-hidden', 'false');
    if (megaTrigger) megaTrigger.classList.add('is-open');
    if (megaBtn) megaBtn.setAttribute('aria-expanded', 'true');
    dropdowns.forEach(function (dd) { if (dd !== megaTrigger) closeDD(dd); });
  }
  function closeMega() {
    if (!megaPanel) return;
    megaPanel.hidden = true;
    megaPanel.setAttribute('aria-hidden', 'true');
    if (megaTrigger) megaTrigger.classList.remove('is-open');
    if (megaBtn) megaBtn.setAttribute('aria-expanded', 'false');
  }

  if (megaBtn) {
    megaBtn.addEventListener('pointerenter', function () {
      if (!isDesktop()) return;
      if (megaTimer) { clearTimeout(megaTimer); megaTimer = null; }
      openMega();
    });
    megaBtn.addEventListener('pointerleave', function () {
      if (!isDesktop()) return;
      megaTimer = setTimeout(closeMega, 200);
    });
    megaBtn.addEventListener('click', function (e) {
      if (!isDesktop()) return;
      e.preventDefault();
      megaPanel && !megaPanel.hidden ? closeMega() : openMega();
    });
  }
  if (megaPanel) {
    megaPanel.addEventListener('pointerenter', function () {
      if (megaTimer) { clearTimeout(megaTimer); megaTimer = null; }
    });
    megaPanel.addEventListener('pointerleave', function () {
      if (!isDesktop()) return;
      megaTimer = setTimeout(closeMega, 200);
    });
  }

  // Close all on outside click
  document.addEventListener('click', function (e) {
    if (!header.contains(e.target)) {
      dropdowns.forEach(closeDD);
      closeMega();
    }
  });

  /* ── Mobile drawer ── */
  var burger = header.querySelector('.yb-burger');
  var drawer = document.getElementById('yb-drawer');

  function openDrawer() {
    if (!drawer) return;
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    if (burger) burger.setAttribute('aria-expanded', 'true');
    document.documentElement.style.overflow = 'hidden';
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    if (burger) burger.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
  }

  if (burger) burger.addEventListener('click', function () {
    burger.getAttribute('aria-expanded') === 'true' ? closeDrawer() : openDrawer();
  });

  if (drawer) {
    drawer.querySelectorAll('[data-close-drawer]').forEach(function (el) {
      el.addEventListener('click', closeDrawer);
    });
  }

  /* ── Mobile accordions ── */
  if (drawer) {
    drawer.querySelectorAll('[data-acc]').forEach(function (acc) {
      var toggle = acc.querySelector('.yb-acc__toggle');
      var content = acc.querySelector('.yb-acc__content');
      if (!toggle || !content) return;
      toggle.addEventListener('click', function () {
        var open = acc.classList.contains('is-open');
        acc.classList.toggle('is-open', !open);
        content.style.display = open ? 'none' : 'block';
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    });
  }

  /* ── Keyboard ── */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      dropdowns.forEach(closeDD);
      closeMega();
      closeDrawer();
    }
  });

  /* ── Focus trap in drawer ── */
  if (drawer) {
    var sel = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    drawer.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || drawer.hidden) return;
      var els = Array.from(drawer.querySelectorAll(sel));
      var first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    });
  }
})();
