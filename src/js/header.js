/**
 * YOGA BIBLE - HEADER FUNCTIONALITY (V2)
 * Handles navigation, dropdowns, mega menu, mobile drawer, and language switching
 */

(function() {
  'use strict';

  var header = document.getElementById('yb-header');
  var utilbar = document.getElementById('yb-utilbar');
  if (!header) return;

  // ============================================
  // LANGUAGE DETECTION & TRANSLATIONS
  // ============================================

  var path = window.location.pathname || "/";
  var isEN = path.indexOf("/en/") === 0 || path === "/en";
  var lang = isEN ? "en" : "da";

  var qs = window.location.search || "";
  var hash = window.location.hash || "";
  var basePath = isEN ? path.replace(/^\/en(\/|$)/, "/") : path;
  var daURL = basePath + qs + hash;
  var enURL = "/en" + basePath + qs + hash;

  // Translation dictionary
  var dict = {
    da: {
      "nav.education": "Uddannelser",
      "nav.courses": "Kurser",
      "nav.mentorship": "Mentorship",
      "nav.more": "Mere",
      "nav.yogabible": "Yoga Bible",
      "nav.ourstory": "Vores Historie",
      "nav.schedule": "Ugentligt Klasseskema",
      "nav.careers": "Karriere",
      "nav.terms": "Handelsbetingelser",
      "nav.privacy": "Privatlivspolitik",
      "nav.conduct": "Code of Conduct",
      "nav.contact": "Kontakt",
      "nav.apply": "Ansøg",
      "mega.200.title": "200 Timer — All Levels",
      "mega.300.title": "300 Timer — Advanced",
      "edu.200.about": "Om 200-timers yogalæreruddannelser",
      "edu.200.18": "18 uger — fleksibel",
      "edu.200.8": "8 uger — semi-intensiv",
      "edu.200.4": "4 uger — intensiv",
      "edu.300.about": "300-timers avanceret uddannelse",
      "edu.compare": "Sammenlign uddannelser",
      "more.journal": "Yoga Journal",
      "more.photo": "Yoga Fotografi",
      "more.music": "Yoga Musik",
      "more.glossary": "Yoga Ordbog",
      "courses.inversions": "Inversions",
      "courses.splits": "Splits",
      "courses.backbends": "Backbends",
      "courses.bundles": "Kursus Bundles",
      "util.email": "info@yogabible.dk",
      "util.phone": "+45 53 88 12 09",
      "util.address": "Torvegade 66, 1400, København K"
    },
    en: {
      "nav.education": "Educations",
      "nav.courses": "Courses",
      "nav.mentorship": "Mentorship",
      "nav.more": "More",
      "nav.yogabible": "Yoga Bible",
      "nav.ourstory": "Our Story",
      "nav.schedule": "Weekly Class Schedule",
      "nav.careers": "Careers",
      "nav.terms": "Terms & Conditions",
      "nav.privacy": "Privacy Policy",
      "nav.conduct": "Code of Conduct",
      "nav.contact": "Contact",
      "nav.apply": "Apply",
      "mega.200.title": "200 Hours — All Levels",
      "mega.300.title": "300 Hours — Advanced",
      "edu.200.about": "About 200-hour yoga teacher trainings",
      "edu.200.18": "18 weeks — flexible",
      "edu.200.8": "8 weeks — semi-intensive",
      "edu.200.4": "4 weeks — intensive",
      "edu.300.about": "300-hour advanced teacher training",
      "edu.compare": "Compare programs",
      "more.journal": "Yoga Journal",
      "more.photo": "Yoga Photography",
      "more.music": "Yoga Music",
      "more.glossary": "Yoga Glossary",
      "courses.inversions": "Inversions",
      "courses.splits": "Splits",
      "courses.backbends": "Backbends",
      "courses.bundles": "Course Bundles",
      "util.email": "info@yogabible.dk",
      "util.phone": "+45 53 88 12 09",
      "util.address": "Torvegade 66, 1400, Copenhagen K"
    }
  };

  // Apply translations
  var allI18n = document.querySelectorAll('[data-i18n]');
  allI18n.forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    if (dict[lang] && dict[lang][key]) {
      el.textContent = dict[lang][key];
    }
  });

  // ============================================
  // LANGUAGE SWITCHING
  // ============================================

  document.querySelectorAll('[data-lang]').forEach(function(flagBtn) {
    var langCode = flagBtn.getAttribute('data-lang');

    if (langCode === "da") flagBtn.href = daURL;
    if (langCode === "en") flagBtn.href = enURL;

    if (langCode === lang) {
      flagBtn.classList.add('is-active');
    }
  });

  // ============================================
  // DESKTOP DROPDOWNS (regular)
  // ============================================

  var dropdowns = header.querySelectorAll('[data-ybhd-dd]');
  var isDesktop = function() { return window.matchMedia("(min-width:980px)").matches; };

  function openDropdown(dd) {
    dd.classList.add('is-open');
    var btn = dd.querySelector('.ybhd-dd__trigger');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown(dd) {
    dd.classList.remove('is-open');
    var btn = dd.querySelector('.ybhd-dd__trigger');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  dropdowns.forEach(function(dd) {
    var isMega = dd.getAttribute('data-ybhd-dd') === 'mega';
    var btn = dd.querySelector('.ybhd-dd__trigger');
    if (!btn) return;

    // Skip mega — handled separately
    if (isMega) return;

    var menu = dd.querySelector('.ybhd-dd__menu');
    if (!menu) return;

    var closeTimer = null;

    function cancelClose() {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
    }

    function scheduleClose() {
      cancelClose();
      closeTimer = setTimeout(function() { closeDropdown(dd); }, 140);
    }

    btn.addEventListener('pointerenter', function() {
      if (!isDesktop()) return;
      cancelClose();
      openDropdown(dd);
    });

    btn.addEventListener('pointerleave', function() {
      if (!isDesktop()) return;
      scheduleClose();
    });

    menu.addEventListener('pointerenter', function() {
      if (!isDesktop()) return;
      cancelClose();
    });

    menu.addEventListener('pointerleave', function() {
      if (!isDesktop()) return;
      scheduleClose();
    });

    btn.addEventListener('click', function(e) {
      if (!isDesktop()) return;
      e.preventDefault();
      var isOpen = dd.classList.contains('is-open');
      dropdowns.forEach(function(x) { if (x !== dd) closeDropdown(x); });
      closeMega();
      isOpen ? closeDropdown(dd) : openDropdown(dd);
    });
  });

  // ============================================
  // MEGA MENU — Education
  // ============================================

  var megaPanel = document.getElementById('ybhdMegaEdu');
  var megaTrigger = header.querySelector('[data-ybhd-dd="mega"]');
  var megaBtn = megaTrigger ? megaTrigger.querySelector('.ybhd-dd__trigger') : null;
  var megaCloseTimer = null;

  function openMega() {
    if (!megaPanel) return;
    megaPanel.hidden = false;
    megaPanel.setAttribute('aria-hidden', 'false');
    if (megaTrigger) megaTrigger.classList.add('is-open');
    if (megaBtn) megaBtn.setAttribute('aria-expanded', 'true');
    // Close regular dropdowns
    dropdowns.forEach(function(dd) {
      if (dd !== megaTrigger) closeDropdown(dd);
    });
  }

  function closeMega() {
    if (!megaPanel) return;
    megaPanel.hidden = true;
    megaPanel.setAttribute('aria-hidden', 'true');
    if (megaTrigger) megaTrigger.classList.remove('is-open');
    if (megaBtn) megaBtn.setAttribute('aria-expanded', 'false');
  }

  if (megaBtn) {
    megaBtn.addEventListener('pointerenter', function() {
      if (!isDesktop()) return;
      if (megaCloseTimer) { clearTimeout(megaCloseTimer); megaCloseTimer = null; }
      openMega();
    });

    megaBtn.addEventListener('pointerleave', function() {
      if (!isDesktop()) return;
      megaCloseTimer = setTimeout(closeMega, 200);
    });

    megaBtn.addEventListener('click', function(e) {
      if (!isDesktop()) return;
      e.preventDefault();
      megaPanel && !megaPanel.hidden ? closeMega() : openMega();
    });
  }

  if (megaPanel) {
    megaPanel.addEventListener('pointerenter', function() {
      if (megaCloseTimer) { clearTimeout(megaCloseTimer); megaCloseTimer = null; }
    });

    megaPanel.addEventListener('pointerleave', function() {
      if (!isDesktop()) return;
      megaCloseTimer = setTimeout(closeMega, 200);
    });
  }

  // Close dropdowns/mega when clicking outside
  document.addEventListener('click', function(e) {
    if (!header.contains(e.target)) {
      dropdowns.forEach(closeDropdown);
      closeMega();
    }
  });

  // ============================================
  // MOBILE DRAWER
  // ============================================

  var burger = header.querySelector('.ybhd-burger');
  var drawer = document.getElementById('ybhdMobileNav');
  var closeElements = drawer ? drawer.querySelectorAll('[data-close]') : [];

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

  if (burger) {
    burger.addEventListener('click', function() {
      var isExpanded = burger.getAttribute('aria-expanded') === 'true';
      isExpanded ? closeDrawer() : openDrawer();
    });
  }

  closeElements.forEach(function(el) {
    el.addEventListener('click', closeDrawer);
  });

  // ============================================
  // MOBILE CARD ACCORDION
  // ============================================

  if (drawer) {
    drawer.querySelectorAll('[data-mcard]').forEach(function(card) {
      var head = card.querySelector('.ybhd-mCard__head');
      var body = card.querySelector('.ybhd-mCard__body');
      if (!head || !body) return;

      head.addEventListener('click', function() {
        var isOpen = card.classList.contains('is-open');
        card.classList.toggle('is-open', !isOpen);
        body.style.display = isOpen ? 'none' : 'block';
        head.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      });
    });
  }

  // ============================================
  // KEYBOARD NAVIGATION
  // ============================================

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      dropdowns.forEach(closeDropdown);
      closeMega();
      closeDrawer();
    }
  });

  // ============================================
  // FOCUS TRAP IN DRAWER
  // ============================================

  if (drawer) {
    var focusableSelector = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

    drawer.addEventListener('keydown', function(e) {
      if (e.key !== 'Tab' || drawer.hidden) return;

      var focusable = Array.from(drawer.querySelectorAll(focusableSelector));
      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    });
  }

  console.log('Yoga Bible header v2 initialized (Language: ' + lang.toUpperCase() + ')');
})();
