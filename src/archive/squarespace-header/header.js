/**
 * YOGA BIBLE - HEADER FUNCTIONALITY
 * Handles navigation, dropdowns, mobile drawer, and language switching
 */

(function() {
  'use strict';

  const header = document.getElementById('yb-header');
  if (!header) return;

  // ============================================
  // LANGUAGE DETECTION & TRANSLATIONS
  // ============================================

  const path = window.location.pathname || "/";
  const isEN = path.indexOf("/en/") === 0 || path === "/en";
  const lang = isEN ? "en" : "da";

  const qs = window.location.search || "";
  const hash = window.location.hash || "";
  // Build language-switch URLs: strip /en/ prefix for DA, add it for EN
  const basePath = isEN ? path.replace(/^\/en(\/|$)/, "/") : path;
  const daURL = basePath + qs + hash;
  const enURL = "/en" + basePath + qs + hash;

  // Translation dictionary
  const dict = {
    da: {
      "nav.education": "Uddannelser",
      "nav.courses": "Kurser",
      "nav.mentorship": "Mentorship & Privat Træning",
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
      "edu.200.title": "200-timer Yogalæreuddannelse",
      "edu.200.18": "18 ugers fleksibel",
      "edu.200.4": "4 ugers intensiv",
      "edu.200.about": "Om 200-timers yogalæreruddannelser",
      "more.journal": "Yoga Journal",
      "more.photo": "Yoga Fotografi",
      "more.music": "Yoga Musik",
      "more.glossary": "Yoga Ordbog",
      "courses.inversions": "Inversions",
      "courses.splits": "Splits",
      "courses.backbends": "Backbends",
      "courses.bundles": "Kursus Bundles",
      "mobile.menu": "Menu",
      "hero.title": "Et sted. To veje.",
      "hero.subtitle": "Yoga Bible er en professionel skole for dig, der vil videre fra almindelig holdpraksis. Vælg din vej: bliv yogalærer – eller løft din praksis gennem målrettede forløb og mentoring.",
      "hero.trust": "Siden 2014 · Erfarne undervisere · Real-class praksis · 500+ uddannede · 4.8★ · 700+ anmeldelser",
      "pathways.title": "Vælg din vej",
      "program.flexible.badge": "Fleksibel",
      "program.flexible.title": "18 Ugers Program",
      "program.flexible.subtitle": "Bliv yogalærer ved siden af job eller studie",
      "program.flexible.feature1": "Start: Marts–Juni 2026",
      "program.flexible.feature2": "Hverdage (10–15) ELLER weekendspor",
      "program.flexible.feature3": "90%+ bestå-rate",
      "program.flexible.feature4": "Real-class praksis inkluderet",
      "program.flexible.feature5": "200-timer certificering",
      "program.intensive.badge": "Intensiv",
      "program.intensive.title": "4 Ugers Program",
      "program.intensive.subtitle": "Kompakt uddannelse på fuld tid",
      "program.intensive.feature1": "Start: Februar 2026",
      "program.intensive.feature2": "Kompakt læring med workshops",
      "program.intensive.feature3": "Valgfrit indkvartering i København",
      "program.intensive.feature4": "Real-class praksis & certificering",
      "program.intensive.feature5": "200-timer certificering",
      "program.cta": "Læs mere",
      "courses.title": "Fordybelseskurser",
      "courses.subtitle": "4-ugers moduler · 8 × 90 minutter · Aftener + udvalgte weekender",
      "courses.inversions.title": "Inversions",
      "courses.inversions.desc": "Handstand, forearm stand, headstand med væg, spotting og partnerarbejde. Fokus på setup, bailouts og skadesforebyggelse.",
      "courses.splits.title": "Splits",
      "courses.splits.desc": "Hoftemobilitet og hamstring-fleksibilitet gennem aktiv/passiv stretching, PNF-teknikker og nervesystem-beroligelse.",
      "courses.backbends.title": "Backbends",
      "courses.backbends.desc": "Bryst- og skulderåbning, ryg- og core-styrke, thoracic mobilitet, vejrtrækning og sikre overgange.",
      "courses.link": "Læs mere →",
      "cta.title": "Klar til at starte din rejse?",
      "cta.text": "Ansøg i dag og bliv en del af Yoga Bible's community",
      "cta.button": "Ansøg nu",
      "trust.since": "Siden 2014",
      "trust.since.sub": "11+ års erfaring",
      "trust.graduates": "500+ Uddannede",
      "trust.graduates.sub": "Certificerede lærere",
      "trust.rating": "4.8★ Bedømmelse",
      "trust.rating.sub": "700+ anmeldelser",
      "trust.practice": "Real-class Praksis",
      "trust.practice.sub": "Hands-on undervisning",
      "instructors.title": "Mød Vores Instruktører",
      "instructors.subtitle": "Erfarne, certificerede yogalærere med passion for at dele deres viden",
      "instructors.lead": "Lead Instruktør",
      "instructors.senior": "Senior Instruktør",
      "instructors.teacher": "Instruktør",
      "instructors.bio1": "E-RYT 500 certificeret med 10+ års erfaring i Vinyasa og Ashtanga yoga.",
      "instructors.bio2": "Specialist i anatomi og skadesforebyggelse med baggrund i fysioterapi.",
      "instructors.bio3": "200-timer certificeret med speciale i inversions og arm balances.",
      "testimonials.title": "Hvad Siger Vores Studerende",
      "testimonial.quote1": "Yoga Bible's 18-ugers program ændrede mit liv. Instruktørerne er utroligt vidende og skaber et trygt rum til at udforske og vokse. Jeg føler mig nu klar til at undervise med selvtillid.",
      "testimonial.meta1": "18-ugers uddannelse, 2024",
      "testimonial.quote2": "Inversions kurset var præcis hvad jeg havde brug for. Jeg gik fra at være bange for at kicke op til at kunne holde en stabil handstand. Fantastisk undervisning og progression!",
      "testimonial.meta2": "Inversions kursus, 2025",
      "testimonial.quote3": "Det 4-ugers intensive program var en transformerende oplevelse. Real-class praksis gjorde hele forskellen - jeg følte mig virkelig forberedt til at stå foran en klasse.",
      "testimonial.meta3": "4-ugers uddannelse, 2025",
      "video.title": "Oplev Yoga Bible",
      "video.subtitle": "Tag et kig ind i vores studie og mød vores community",
      "video.placeholder": "Video kommer snart - Indtil da, besøg vores Instagram @yoga_bible"
    },
    en: {
      "nav.education": "Educations",
      "nav.courses": "Courses",
      "nav.mentorship": "Mentorship & Private Training",
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
      "edu.200.title": "200-hour Yoga Teacher Training",
      "edu.200.18": "18-week flexible",
      "edu.200.4": "4-week intensive",
      "edu.200.about": "About 200-hour yoga teacher trainings",
      "more.journal": "Yoga Journal",
      "more.photo": "Yoga Photography",
      "more.music": "Yoga Music",
      "more.glossary": "Yoga Glossary",
      "courses.inversions": "Inversions",
      "courses.splits": "Splits",
      "courses.backbends": "Backbends",
      "courses.bundles": "Course Bundles",
      "mobile.menu": "Menu",
      "hero.title": "One place. Two paths.",
      "hero.subtitle": "Yoga Bible is a professional school for those ready to move beyond regular studio classes. Choose your path: become a yoga teacher – or elevate your practice through focused programs and mentoring.",
      "hero.trust": "Since 2014 · Experienced instructors · Real-class practice · 500+ trained · 4.8★ · 700+ reviews",
      "pathways.title": "Choose Your Path",
      "program.flexible.badge": "Flexible",
      "program.flexible.title": "18-Week Program",
      "program.flexible.subtitle": "Become a yoga teacher alongside work or studies",
      "program.flexible.feature1": "Start: March–June 2026",
      "program.flexible.feature2": "Weekdays (10–15) OR weekend track",
      "program.flexible.feature3": "90%+ pass rate",
      "program.flexible.feature4": "Real-class practice included",
      "program.flexible.feature5": "200-hour certification",
      "program.intensive.badge": "Intensive",
      "program.intensive.title": "4-Week Program",
      "program.intensive.subtitle": "Compact full-time training",
      "program.intensive.feature1": "Start: February 2026",
      "program.intensive.feature2": "Compact learning with workshops",
      "program.intensive.feature3": "Optional housing in Copenhagen",
      "program.intensive.feature4": "Real-class practice & certification",
      "program.intensive.feature5": "200-hour certification",
      "program.cta": "Learn more",
      "courses.title": "Focused Courses",
      "courses.subtitle": "4-week modules · 8 × 90 minutes · Evenings + selected weekends",
      "courses.inversions.title": "Inversions",
      "courses.inversions.desc": "Handstand, forearm stand, headstand with wall, spotting and partner work. Focus on setup, bailouts, and injury prevention.",
      "courses.splits.title": "Splits",
      "courses.splits.desc": "Hip mobility and hamstring flexibility through active/passive stretching, PNF techniques, and nervous system calming.",
      "courses.backbends.title": "Backbends",
      "courses.backbends.desc": "Chest and shoulder opening, spine and core strength, thoracic mobility, breathing, and safe transitions.",
      "courses.link": "Learn more →",
      "cta.title": "Ready to start your journey?",
      "cta.text": "Apply today and become part of Yoga Bible's community",
      "cta.button": "Apply now",
      "trust.since": "Since 2014",
      "trust.since.sub": "11+ years experience",
      "trust.graduates": "500+ Graduates",
      "trust.graduates.sub": "Certified teachers",
      "trust.rating": "4.8★ Rating",
      "trust.rating.sub": "700+ reviews",
      "trust.practice": "Real-class Practice",
      "trust.practice.sub": "Hands-on training",
      "instructors.title": "Meet Our Instructors",
      "instructors.subtitle": "Experienced, certified yoga teachers passionate about sharing their knowledge",
      "instructors.lead": "Lead Instructor",
      "instructors.senior": "Senior Instructor",
      "instructors.teacher": "Instructor",
      "instructors.bio1": "E-RYT 500 certified with 10+ years experience in Vinyasa and Ashtanga yoga.",
      "instructors.bio2": "Specialist in anatomy and injury prevention with a background in physiotherapy.",
      "instructors.bio3": "200-hour certified with expertise in inversions and arm balances.",
      "testimonials.title": "What Our Students Say",
      "testimonial.quote1": "Yoga Bible's 18-week program changed my life. The instructors are incredibly knowledgeable and create a safe space to explore and grow. I now feel confident to teach.",
      "testimonial.meta1": "18-week training, 2024",
      "testimonial.quote2": "The Inversions course was exactly what I needed. I went from being afraid to kick up to holding a stable handstand. Fantastic instruction and progression!",
      "testimonial.meta2": "Inversions course, 2025",
      "testimonial.quote3": "The 4-week intensive program was a transformative experience. Real-class practice made all the difference - I felt truly prepared to stand in front of a class.",
      "testimonial.meta3": "4-week training, 2025",
      "video.title": "Experience Yoga Bible",
      "video.subtitle": "Take a look inside our studio and meet our community",
      "video.placeholder": "Video coming soon - Until then, visit our Instagram @yoga_bible"
    }
  };

  // Apply translations to all elements with data-i18n attribute
  header.querySelectorAll('[data-i18n]').forEach(function(el) {
    const key = el.getAttribute('data-i18n');
    if (dict[lang] && dict[lang][key]) {
      el.textContent = dict[lang][key];
    }
  });

  // ============================================
  // LANGUAGE SWITCHING
  // ============================================

  // Try to use Weglot if available
  function weglotSwitch(to) {
    try {
      if (window.Weglot && typeof window.Weglot.switchTo === "function") {
        window.Weglot.switchTo(to);
        return true;
      }
    } catch (e) {
      console.warn('Weglot not available:', e);
    }
    return false;
  }

  // Set up language flag buttons
  header.querySelectorAll('[data-lang]').forEach(function(flagBtn) {
    const langCode = flagBtn.getAttribute('data-lang');

    // Set correct URL
    if (langCode === "da") flagBtn.href = daURL;
    if (langCode === "en") flagBtn.href = enURL;

    // Highlight active language
    if (langCode === lang) {
      flagBtn.classList.add('is-active');
    }

    // Handle click
    flagBtn.addEventListener('click', function(e) {
      if (weglotSwitch(langCode)) {
        e.preventDefault();
      }
    });
  });

  // ============================================
  // DESKTOP DROPDOWNS
  // ============================================

  const dropdowns = header.querySelectorAll('[data-ybhd-dd]');
  const isDesktop = () => window.matchMedia("(min-width:980px)").matches;

  function openDropdown(dd) {
    dd.classList.add('is-open');
    const btn = dd.querySelector('.ybhd-dd__trigger');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown(dd) {
    dd.classList.remove('is-open');
    const btn = dd.querySelector('.ybhd-dd__trigger');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  dropdowns.forEach(function(dd) {
    const btn = dd.querySelector('.ybhd-dd__trigger');
    const menu = dd.querySelector('.ybhd-dd__menu');
    if (!btn || !menu) return;

    let closeTimer = null;

    function cancelClose() {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
    }

    function scheduleClose() {
      cancelClose();
      closeTimer = setTimeout(() => closeDropdown(dd), 140);
    }

    function onEnter() {
      if (!isDesktop()) return;
      cancelClose();
      openDropdown(dd);
    }

    function onLeave() {
      if (!isDesktop()) return;
      scheduleClose();
    }

    // Hover events
    btn.addEventListener('pointerenter', onEnter);
    btn.addEventListener('pointerleave', onLeave);
    menu.addEventListener('pointerenter', onEnter);
    menu.addEventListener('pointerleave', onLeave);

    // Click to toggle
    btn.addEventListener('click', function(e) {
      if (!isDesktop()) return;
      e.preventDefault();
      const isOpen = dd.classList.contains('is-open');

      // Close all other dropdowns
      dropdowns.forEach(x => {
        if (x !== dd) closeDropdown(x);
      });

      // Toggle this one
      isOpen ? closeDropdown(dd) : openDropdown(dd);
    });
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', function(e) {
    if (!header.contains(e.target)) {
      dropdowns.forEach(closeDropdown);
    }
  });

  // ============================================
  // MOBILE DRAWER
  // ============================================

  const burger = header.querySelector('.ybhd-burger');
  const drawer = document.getElementById('ybhdMobileNav');
  const closeElements = drawer ? drawer.querySelectorAll('[data-close]') : [];

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

  // Burger button toggle
  if (burger) {
    burger.addEventListener('click', function() {
      const isExpanded = burger.getAttribute('aria-expanded') === 'true';
      isExpanded ? closeDrawer() : openDrawer();
    });
  }

  // Close elements (X button and overlay)
  closeElements.forEach(el => {
    el.addEventListener('click', closeDrawer);
  });

  // ============================================
  // MOBILE ACCORDION GROUPS
  // ============================================

  if (drawer) {
    drawer.querySelectorAll('[data-mgroup]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const next = btn.nextElementSibling;
        if (!next || !next.classList.contains('ybhd-mItems')) return;

        const isOpen = next.style.display === 'flex';
        next.style.display = isOpen ? 'none' : 'flex';
        btn.classList.toggle('is-open', !isOpen);
        btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      });
    });
  }

  // ============================================
  // KEYBOARD NAVIGATION
  // ============================================

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      dropdowns.forEach(closeDropdown);
      closeDrawer();
    }
  });

  // ============================================
  // ACCESSIBILITY IMPROVEMENTS
  // ============================================

  // Trap focus in mobile drawer when open
  if (drawer) {
    const focusableElements = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

    drawer.addEventListener('keydown', function(e) {
      if (e.key !== 'Tab' || drawer.hidden) return;

      const focusable = Array.from(drawer.querySelectorAll(focusableElements));
      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          lastFocusable.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          firstFocusable.focus();
          e.preventDefault();
        }
      }
    });
  }

  console.log('✅ Yoga Bible header initialized (Language:', lang.toUpperCase() + ')');
})();
