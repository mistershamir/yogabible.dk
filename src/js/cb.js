/* ========================================
   COURSE BUNDLES PAGE — Interactive Components
   - Bundle builder (month + course selection, pricing, CTA)
   - Accommodation galleries (swipe, dots, arrows)
   - FAQ accordion
   - Video autoplay (iOS retry)
   ======================================== */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════════ */

  var SINGLE_PRICE = 2300;

  /* Mindbody bundle product IDs keyed by month → sorted course combo */
  var BUNDLE_URLS = {
    'Februar 2026': { 'Backbends|Inversions': 113, 'Inversions|Splits': 114, 'Backbends|Splits': 115, 'ALL': 125 },
    'Marts 2026':   { 'Backbends|Inversions': 116, 'Inversions|Splits': 117, 'Backbends|Splits': 118, 'ALL': 126 },
    'April 2026':   { 'Backbends|Inversions': 119, 'Inversions|Splits': 120, 'Backbends|Splits': 121, 'ALL': 127 },
    'Maj 2026':     { 'Backbends|Inversions': 122, 'Inversions|Splits': 123, 'Backbends|Splits': 124, 'ALL': 128 }
  };

  /* Direct single-course booking links */
  var SINGLE_URLS = {
    'Inversions': '/mindbody?stype=40&sVT=16&sTG=28',
    'Splits':     '/mindbody?stype=40&sVT=16&sTG=29',
    'Backbends':  '/mindbody?stype=40&sVT=16&sTG=30'
  };

  var MB_BASE = '/mindbody?stype=42&sTG=8&prodId=';

  /* Language detection */
  var isEN = document.documentElement.lang === 'en' ||
             window.location.pathname.indexOf('/en/') === 0;

  /* ═══════════════════════════════════════════════
     1. BUNDLE BUILDER
  ═══════════════════════════════════════════════ */

  /* Pre-select month from any chip that's already active in the HTML */
  var preActiveChip = document.querySelector('.cb-chip[data-month].is-active');
  var selectedMonth = preActiveChip ? preActiveChip.getAttribute('data-month') : null;
  var selectedCourses = [];

  /* DOM nodes */
  var monthChips    = document.querySelectorAll('.cb-chip[data-month]');
  var courseButtons  = document.querySelectorAll('.cb-course[data-course]');
  var elPicked      = document.getElementById('cb-picked');
  var elPackPrice   = document.getElementById('cb-pack-price');
  var elSavings     = document.getElementById('cb-savings');
  var elCta         = document.getElementById('cb-cta-main');

  function formatKR(n) {
    return n.toLocaleString('da-DK') + ' kr.';
  }

  /* --- Month chips --- */
  monthChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      selectedMonth = chip.getAttribute('data-month');
      monthChips.forEach(function (c) { c.classList.remove('is-active'); });
      chip.classList.add('is-active');
      updateBuilder();
    });
  });

  /* --- Course buttons --- */
  courseButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var course = btn.getAttribute('data-course');
      var idx = selectedCourses.indexOf(course);
      if (idx > -1) {
        selectedCourses.splice(idx, 1);
        btn.setAttribute('aria-pressed', 'false');
      } else {
        selectedCourses.push(course);
        btn.setAttribute('aria-pressed', 'true');
      }
      updateBuilder();
    });
  });

  /* --- Calculate & render --- */
  function updateBuilder() {
    var count = selectedCourses.length;

    /* Picked courses */
    if (count === 0) {
      if (elPicked)    elPicked.textContent = '\u2014';
      if (elPackPrice) elPackPrice.textContent = '\u2014';
      if (elSavings)   elSavings.textContent = '\u2014';
    } else {
      if (elPicked) elPicked.textContent = selectedCourses.join(' + ');

      var totalNormal = count * SINGLE_PRICE;
      var discount = 0;
      var packPrice = totalNormal;

      if (count === 2) {
        discount = 0.10;
        packPrice = Math.round(totalNormal * (1 - discount));
      } else if (count >= 3) {
        discount = 0.15;
        packPrice = Math.round(totalNormal * (1 - discount));
      }

      if (elPackPrice) elPackPrice.textContent = formatKR(packPrice);

      if (elSavings) {
        if (discount > 0) {
          var saved = totalNormal - packPrice;
          elSavings.textContent = (isEN ? 'Save ' : 'Spar ') + formatKR(saved) +
            ' (' + Math.round(discount * 100) + '%)';
          if (count >= 3) {
            elSavings.textContent += (isEN ? ' + free pass' : ' + gratis pass');
          }
        } else {
          elSavings.textContent = isEN ? 'Single course — no discount' : 'Enkelt kursus — ingen rabat';
        }
      }
    }

    /* CTA link */
    if (elCta) {
      var url = buildURL();
      if (url) {
        elCta.href = url;
        elCta.removeAttribute('aria-disabled');
        elCta.removeAttribute('tabindex');
        elCta.textContent = isEN ? 'Book Now' : 'Book Nu';
      } else {
        elCta.href = '#';
        elCta.setAttribute('aria-disabled', 'true');
        elCta.setAttribute('tabindex', '-1');
        if (count === 0 && !selectedMonth) {
          elCta.textContent = isEN ? 'Choose month + courses' : 'Vælg måned + kurser';
        } else if (!selectedMonth) {
          elCta.textContent = isEN ? 'Choose a month' : 'Vælg en måned';
        } else if (count === 0) {
          elCta.textContent = isEN ? 'Choose courses' : 'Vælg kurser';
        } else {
          elCta.textContent = isEN ? 'Choose month + courses' : 'Vælg måned + kurser';
        }
      }
    }
  }

  function buildURL() {
    if (!selectedMonth || selectedCourses.length === 0) return null;

    /* "Not sure yet" month — cannot build a Mindbody link */
    if (selectedMonth === 'Ikke sikker endnu') return null;

    var count = selectedCourses.length;

    /* Single course — direct workshop link */
    if (count === 1) {
      return SINGLE_URLS[selectedCourses[0]] || null;
    }

    /* Bundle (2 or 3 courses) */
    var monthData = BUNDLE_URLS[selectedMonth];
    if (!monthData) return null;

    if (count >= 3) {
      return MB_BASE + monthData['ALL'];
    }

    /* 2-course combo: sort and join with pipe to match the key */
    var sorted = selectedCourses.slice().sort();
    var key = sorted.join('|');
    var prodId = monthData[key];
    if (prodId) return MB_BASE + prodId;

    return null;
  }

  /* ═══════════════════════════════════════════════
     2. IMAGE GALLERIES (Accommodation)
  ═══════════════════════════════════════════════ */

  var galleries = document.querySelectorAll('.cb-gallery');

  galleries.forEach(function (gallery) {
    var track    = gallery.querySelector('.cb-gallery__track');
    var images   = track ? track.querySelectorAll('img') : [];
    var prevBtn  = gallery.querySelector('.cb-gallery__nav--prev');
    var nextBtn  = gallery.querySelector('.cb-gallery__nav--next');
    var dotsWrap = gallery.querySelector('.cb-gallery__dots');
    var total    = images.length;
    if (total < 2) return;

    var current = 0;
    var autoTimer = null;
    var dots = [];

    /* Create dots */
    for (var i = 0; i < total; i++) {
      var dot = document.createElement('button');
      dot.className = 'cb-gallery__dot' + (i === 0 ? ' is-active' : '');
      dot.setAttribute('aria-label', (isEN ? 'Go to image ' : 'Gå til billede ') + (i + 1));
      dot.setAttribute('type', 'button');
      (function (idx) {
        dot.addEventListener('click', function () { goTo(idx); });
      })(i);
      dotsWrap.appendChild(dot);
      dots.push(dot);
    }

    function goTo(idx) {
      current = ((idx % total) + total) % total;
      track.style.transform = 'translateX(-' + (current * 100) + '%)';
      dots.forEach(function (d, j) {
        d.classList.toggle('is-active', j === current);
      });
      resetAuto();
    }

    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(current - 1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goTo(current + 1); });

    /* Auto-advance */
    function startAuto() {
      autoTimer = setInterval(function () { goTo(current + 1); }, 5000);
    }
    function resetAuto() {
      clearInterval(autoTimer);
      startAuto();
    }
    startAuto();

    /* Pause on hover / focus */
    gallery.addEventListener('mouseenter', function () { clearInterval(autoTimer); });
    gallery.addEventListener('mouseleave', function () { startAuto(); });
    gallery.addEventListener('focusin', function () { clearInterval(autoTimer); });
    gallery.addEventListener('focusout', function () { startAuto(); });

    /* Touch / swipe */
    var startX = 0;
    var startY = 0;
    var isDragging = false;

    track.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = true;
    }, { passive: true });

    track.addEventListener('touchend', function (e) {
      if (!isDragging) return;
      isDragging = false;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        goTo(dx < 0 ? current + 1 : current - 1);
      }
    }, { passive: true });
  });

  /* ═══════════════════════════════════════════════
     3. FAQ ACCORDION
  ═══════════════════════════════════════════════ */

  var faqList = document.querySelector('[data-cb-accordion]');

  if (faqList) {
    faqList.addEventListener('click', function (e) {
      var btn = e.target.closest('.cb-faq__btn');
      if (!btn) return;

      var item = btn.closest('.cb-faq__item');
      var answer = item ? item.querySelector('.cb-faq__a') : null;
      if (!answer) return;

      var isOpen = btn.getAttribute('aria-expanded') === 'true';

      /* Close all others */
      faqList.querySelectorAll('.cb-faq__btn').forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
        var a = b.closest('.cb-faq__item').querySelector('.cb-faq__a');
        if (a) a.hidden = true;
      });

      /* Toggle clicked */
      if (!isOpen) {
        btn.setAttribute('aria-expanded', 'true');
        answer.hidden = false;
      }
    });
  }

  /* ═══════════════════════════════════════════════
     4. VIDEO AUTOPLAY (iOS retry)
  ═══════════════════════════════════════════════ */

  var videos = document.querySelectorAll('.cb-how__video, .cb-pricing__video, .cb-unlimited__video');

  videos.forEach(function (video) {
    var promise = video.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(function () {
        /* iOS sometimes blocks autoplay until user interacts */
        function retryPlay() {
          video.play().catch(function () {});
          document.removeEventListener('touchstart', retryPlay);
          document.removeEventListener('click', retryPlay);
        }
        document.addEventListener('touchstart', retryPlay, { once: true, passive: true });
        document.addEventListener('click', retryPlay, { once: true });
      });
    }
  });

  /* ═══════════════════════════════════════════════
     5. SMOOTH SCROLL for #coursebuilder anchors
  ═══════════════════════════════════════════════ */

  document.querySelectorAll('a[href="#coursebuilder"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var target = document.getElementById('coursebuilder');
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

})();
