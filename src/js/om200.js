/* ========================================
   OM200 PAGE — Interactive Components
   - Hero image carousel
   - Donut chart
   - Single-open accordions
   - Online video player
   - YA FAQ accordion
   ======================================== */

(function () {
  'use strict';

  /* ═══ Media base URL (Bunny CDN) ═══ */
  var MEDIA_BASE = document.documentElement.getAttribute('data-media-base') || 'https://yogabible.b-cdn.net';

  /* ═══ 1. HERO CAROUSEL ═══ */
  var IMAGES = [
    MEDIA_BASE + '/yoga-bible-DK/programs/ytt-200h.webp',
    MEDIA_BASE + '/yoga-bible-DK/programs/ytt-kbh.jpg',
    MEDIA_BASE + '/yoga-bible-DK/programs/ytt-kbh.jpg',
    MEDIA_BASE + '/yoga-bible-DK/programs/ytt-kbh.jpg'
  ];

  var viewport = document.querySelector('[data-om2-viewport]');
  var track = document.querySelector('[data-om2-track]');
  var dotsContainer = document.querySelector('[data-om2-dots]');
  var prevBtn = document.querySelector('[data-om2-prev]');
  var nextBtn = document.querySelector('[data-om2-next]');

  if (viewport && track && dotsContainer) {
    var currentIndex = 0;
    var dots = [];

    // Create slides
    IMAGES.forEach(function (src, i) {
      var slide = document.createElement('div');
      slide.className = 'om2-hero__slide';
      slide.setAttribute('role', 'group');
      slide.setAttribute('aria-label', 'Billede ' + (i + 1));
      var img = document.createElement('img');
      img.alt = 'Yoga teacher training ' + (i + 1);
      img.decoding = 'async';
      img.loading = i === 0 ? 'eager' : 'lazy';
      img.src = src;
      img.onerror = function () {
        slide.style.background = 'linear-gradient(145deg, #f5ede5 0%, #faf6f2 100%)';
      };
      slide.appendChild(img);
      track.appendChild(slide);
    });

    // Create dots
    IMAGES.forEach(function (_, i) {
      var dot = document.createElement('button');
      dot.className = 'om2-hero__dot' + (i === 0 ? ' is-active' : '');
      dot.setAttribute('aria-label', 'Go to image ' + (i + 1));
      dot.addEventListener('click', function () { goToSlide(i); });
      dotsContainer.appendChild(dot);
      dots.push(dot);
    });

    function updateDots() {
      dots.forEach(function (dot, i) {
        dot.classList.toggle('is-active', i === currentIndex);
      });
    }

    function goToSlide(index) {
      var page = viewport.clientWidth;
      currentIndex = Math.max(0, Math.min(index, IMAGES.length - 1));
      viewport.scrollTo({ left: currentIndex * page, behavior: 'smooth' });
      updateDots();
    }

    function pageScroll(dir) {
      var newIndex = currentIndex + dir;
      if (newIndex < 0) newIndex = IMAGES.length - 1;
      if (newIndex >= IMAGES.length) newIndex = 0;
      goToSlide(newIndex);
    }

    // Scroll sync
    viewport.addEventListener('scroll', function () {
      var page = viewport.clientWidth;
      var newIndex = Math.round(viewport.scrollLeft / Math.max(1, page));
      if (newIndex !== currentIndex) {
        currentIndex = newIndex;
        updateDots();
      }
    }, { passive: true });

    // Drag handling
    var down = false, startX = 0, startL = 0;
    viewport.addEventListener('pointerdown', function (e) {
      down = true;
      viewport.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startL = viewport.scrollLeft;
    }, { passive: true });
    viewport.addEventListener('pointermove', function (e) {
      if (!down) return;
      viewport.scrollLeft = startL - (e.clientX - startX);
    }, { passive: true });
    function onUp(e) {
      if (!down) return;
      down = false;
      viewport.releasePointerCapture(e.pointerId);
      var w = viewport.clientWidth;
      goToSlide(Math.round(viewport.scrollLeft / Math.max(1, w)));
    }
    viewport.addEventListener('pointerup', onUp, { passive: true });
    viewport.addEventListener('pointerleave', onUp, { passive: true });

    // Nav buttons
    if (prevBtn) prevBtn.addEventListener('click', function () { pageScroll(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { pageScroll(1); });

    // Resize handler
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        viewport.scrollTo({ left: currentIndex * viewport.clientWidth, behavior: 'instant' });
      }, 120);
    }, { passive: true });

    // Keyboard nav
    var heroSection = document.getElementById('om2-hero');
    if (heroSection) {
      heroSection.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') pageScroll(-1);
        if (e.key === 'ArrowRight') pageScroll(1);
      });
    }
  }

  /* ═══ 2. DONUT CHART ═══ */
  var donutData = [
    { label: 'Hatha & Class Mgmt', hours: 32, color: '#f75c03' },
    { label: 'Vinyasa & Sequencing', hours: 30, color: '#EA8E52' },
    { label: 'Yin Yoga', hours: 20, color: '#F0A778' },
    { label: 'Anatomi', hours: 16, color: '#F5BE99' },
    { label: 'Filosofi & Meditation', hours: 12, color: '#F9D4B8' },
    { label: 'Selvpraksis & Hjemmearbejde', hours: 90, color: '#B85313' }
  ];

  var donut = document.querySelector('.om2-hours__donut');
  var legend = document.querySelector('[data-om2-legend]');
  var totalEl = document.querySelector('[data-om2-total]');

  if (donut && legend) {
    var total = donutData.reduce(function (s, d) { return s + d.hours; }, 0);
    if (totalEl) totalEl.textContent = total;

    var acc = 0;
    donutData.forEach(function (d, i) {
      acc += d.hours;
      var end = (acc / total) * 360;
      donut.style.setProperty('--stop-' + i, end + 'deg');

      var li = document.createElement('li');
      li.className = 'om2-hours__legend-item';
      li.innerHTML =
        '<div class="om2-hours__legend-left">' +
          '<span class="om2-hours__swatch" style="background:' + d.color + '"></span>' +
          '<span class="om2-hours__legend-label">' + d.label + '</span>' +
        '</div>' +
        '<span class="om2-hours__legend-hours">' + d.hours + ' timer</span>';
      legend.appendChild(li);
    });
  }

  /* ═══ 3. SINGLE-OPEN ACCORDION (Hour Breakdown) ═══ */
  var singleAcc = document.querySelector('[data-om2-single-accordion]');
  if (singleAcc) {
    // Close all but first on init
    var openItems = singleAcc.querySelectorAll('details[open]');
    for (var i = 1; i < openItems.length; i++) {
      openItems[i].removeAttribute('open');
    }

    singleAcc.addEventListener('toggle', function (e) {
      var t = e.target;
      if (t.tagName.toLowerCase() !== 'details' || !t.open) return;
      var allDetails = singleAcc.querySelectorAll('details[open]');
      allDetails.forEach(function (d) {
        if (d !== t) d.open = false;
      });
    }, true);

    singleAcc.addEventListener('click', function (e) {
      var sum = e.target.closest('summary');
      if (!sum) return;
      var current = sum.parentElement;
      requestAnimationFrame(function () {
        if (current.open) {
          var allOpen = singleAcc.querySelectorAll('details[open]');
          allOpen.forEach(function (d) {
            if (d !== current) d.open = false;
          });
        }
      });
    });
  }

  /* ═══ 4. ONLINE VIDEO PLAYER ═══ */
  var playOnlineBtn = document.querySelector('[data-om2-play-online]');
  var onlineCard = document.querySelector('[data-om2-online-video]');

  if (playOnlineBtn && onlineCard) {
    var videoSrc = onlineCard.getAttribute('data-src') || '';

    function buildOnlinePlayer() {
      if (onlineCard.dataset.loaded === 'true') return;

      var player = document.createElement('div');
      player.className = 'om2-online__player';
      player.setAttribute('role', 'region');
      player.setAttribute('aria-label', 'Video player');

      var video = document.createElement('video');
      video.src = videoSrc;
      video.playsInline = true;
      video.preload = 'metadata';
      video.muted = false;
      video.controls = false;

      var controls = document.createElement('div');
      controls.className = 'om2-online__controls';

      var play = document.createElement('button');
      play.className = 'om2-online__ctrl-btn';
      play.type = 'button';
      play.setAttribute('aria-label', 'Play/Pause');
      play.textContent = '\u25B6';

      var seek = document.createElement('input');
      seek.className = 'om2-online__seek';
      seek.type = 'range';
      seek.min = '0';
      seek.max = '100';
      seek.step = '0.1';
      seek.value = '0';
      seek.setAttribute('aria-label', 'Seek');

      var time = document.createElement('div');
      time.className = 'om2-online__time';
      time.textContent = '0:00';

      controls.appendChild(play);
      controls.appendChild(seek);
      controls.appendChild(time);
      player.appendChild(video);
      player.appendChild(controls);

      onlineCard.innerHTML = '';
      onlineCard.appendChild(player);
      onlineCard.dataset.loaded = 'true';

      var fmt = function (s) {
        s = Math.max(0, s | 0);
        var m = (s / 60) | 0;
        var ss = s % 60;
        return m + ':' + ss.toString().padStart(2, '0');
      };

      var duration = 0;
      video.addEventListener('loadedmetadata', function () {
        duration = Math.floor(video.duration || 0);
      });
      video.addEventListener('timeupdate', function () {
        if (duration) {
          var p = (video.currentTime / duration) * 100;
          seek.value = isFinite(p) ? p : 0;
          time.textContent = fmt(video.currentTime);
        }
        play.textContent = video.paused ? '\u25B6' : '\u275A\u275A';
        play.setAttribute('aria-pressed', String(!video.paused));
      });
      play.addEventListener('click', function () {
        if (video.paused) video.play().catch(function () {});
        else video.pause();
      });
      seek.addEventListener('input', function () {
        if (duration) video.currentTime = (seek.valueAsNumber / 100) * duration;
      });

      player.tabIndex = 0;
      player.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); play.click(); }
        else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
        else if (e.key === 'ArrowRight') video.currentTime = Math.min(duration, video.currentTime + 5);
      });

      video.play().catch(function () {});
    }

    playOnlineBtn.addEventListener('click', buildOnlinePlayer);
  }

  /* ═══ 5. YA FAQ ACCORDION ═══ */
  var yaAcc = document.querySelector('[data-om2-ya-accordion]');
  if (yaAcc) {
    var buttons = yaAcc.querySelectorAll('.om2-ya__acc-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';

        // Close all others
        buttons.forEach(function (b) {
          if (b !== btn) {
            b.setAttribute('aria-expanded', 'false');
            var panel = document.getElementById(b.getAttribute('aria-controls'));
            if (panel) panel.hidden = true;
          }
        });

        // Toggle current
        btn.setAttribute('aria-expanded', String(!open));
        var panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (panel) panel.hidden = open;
      });
    });
  }

  /* ═══ 6. LOCATION GALLERY SLIDER ═══ */
  var locSlider = document.querySelector('[data-om2-loc-slider]');
  var locTrack = document.querySelector('[data-om2-loc-track]');
  var locDotsContainer = document.querySelector('[data-om2-loc-dots]');
  var locPrevBtn = document.querySelector('[data-om2-loc-prev]');
  var locNextBtn = document.querySelector('[data-om2-loc-next]');

  if (locSlider && locTrack) {
    var locSlides = locTrack.children;
    var locTotal = locSlides.length;
    var locIndex = 0;
    var locDots = [];

    // Create dots
    if (locDotsContainer) {
      for (var li = 0; li < locTotal; li++) {
        var locDot = document.createElement('button');
        locDot.className = 'om2-location__slider-dot' + (li === 0 ? ' is-active' : '');
        locDot.setAttribute('aria-label', 'Slide ' + (li + 1));
        (function (idx) {
          locDot.addEventListener('click', function () { goToLocSlide(idx); });
        })(li);
        locDotsContainer.appendChild(locDot);
        locDots.push(locDot);
      }
    }

    function updateLocDots() {
      locDots.forEach(function (d, idx) {
        d.classList.toggle('is-active', idx === locIndex);
      });
    }

    function goToLocSlide(index) {
      locIndex = Math.max(0, Math.min(index, locTotal - 1));
      locTrack.style.transform = 'translateX(-' + (locIndex * 100) + '%)';
      updateLocDots();
    }

    function locPageScroll(dir) {
      var newIdx = locIndex + dir;
      if (newIdx < 0) newIdx = locTotal - 1;
      if (newIdx >= locTotal) newIdx = 0;
      goToLocSlide(newIdx);
    }

    if (locPrevBtn) locPrevBtn.addEventListener('click', function () { locPageScroll(-1); });
    if (locNextBtn) locNextBtn.addEventListener('click', function () { locPageScroll(1); });
  }

  /* ═══ 7. GENERAL FAQ ACCORDION ═══ */
  var faqAcc = document.querySelector('[data-om2-faq-accordion]');
  if (faqAcc) {
    var faqBtns = faqAcc.querySelectorAll('.om2-faq__btn');
    faqBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var isOpen = btn.getAttribute('aria-expanded') === 'true';

        // Close all others
        faqBtns.forEach(function (b) {
          if (b !== btn) {
            b.setAttribute('aria-expanded', 'false');
            var p = document.getElementById(b.getAttribute('aria-controls'));
            if (p) p.hidden = true;
          }
        });

        // Toggle current
        btn.setAttribute('aria-expanded', String(!isOpen));
        var panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (panel) panel.hidden = isOpen;
      });
    });
  }

  /* ═══ 8. CREDENTIALS VIDEO ═══ */
  var credVideo = document.querySelector('[data-om2-video-id]');
  if (credVideo) {
    var fileId = credVideo.getAttribute('data-om2-video-id');
    var iframe = credVideo.querySelector('iframe');
    if (fileId && iframe) {
      var srcUrl = 'https://drive.google.com/uc?export=download&id=' + fileId;
      var posterUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1280';
      var test = document.createElement('video');
      test.preload = 'metadata';
      test.muted = true;
      test.src = srcUrl;
      var swapped = false;

      function swapToNative() {
        if (swapped) return;
        swapped = true;
        var v = document.createElement('video');
        v.src = srcUrl;
        v.controls = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.poster = posterUrl;
        v.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        credVideo.replaceChild(v, iframe);
      }

      test.addEventListener('loadedmetadata', swapToNative);
      setTimeout(function () { test.src = ''; }, 6000);
    }
  }

  /* ═══ 9. REVIEWS CAROUSEL (p18w pattern) ═══ */
  var reviewsDataEl = document.getElementById('om2-reviews-data');
  var reviewsAriaEl = document.getElementById('om2-reviews-aria');
  var reviewsSection = document.getElementById('om2-reviews-section');

  if (reviewsDataEl && reviewsSection) {
    var REVIEWS = JSON.parse(reviewsDataEl.textContent);
    var reviewAriaPrefix = reviewsAriaEl ? JSON.parse(reviewsAriaEl.textContent) : 'Review from';

    var revTrack = reviewsSection.querySelector('[data-om2-rev-track]');
    var revViewport = reviewsSection.querySelector('[data-om2-rev-viewport]');
    var revPrev = reviewsSection.querySelector('[data-om2-rev-prev]');
    var revNext = reviewsSection.querySelector('[data-om2-rev-next]');

    if (revTrack && revViewport) {
      REVIEWS.forEach(function (review) {
        var card = document.createElement('article');
        card.className = 'yb-reviews__card';
        card.setAttribute('aria-label', reviewAriaPrefix + ' ' + review.name);
        card.innerHTML =
          '<div class="yb-reviews__card-header">' +
            '<div class="yb-reviews__card-info">' +
              '<h3 class="yb-reviews__name">' + review.name + '</h3>' +
              '<p class="yb-reviews__when">' + review.when + '</p>' +
            '</div>' +
            '<span class="yb-reviews__card-stars" aria-hidden="true">★★★★★</span>' +
          '</div>' +
          '<p class="yb-reviews__text">' + review.text + '</p>';
        revTrack.appendChild(card);
      });

      var getRevScrollAmount = function () {
        var card = revTrack.querySelector('.yb-reviews__card');
        if (!card) return 0;
        var style = window.getComputedStyle(revTrack);
        var gap = parseInt(style.gap) || 16;
        return card.offsetWidth + gap;
      };

      var getRevVisibleCount = function () {
        var w = window.innerWidth;
        if (w >= 900) return 3;
        if (w >= 600) return 2;
        return 1;
      };

      var updateRevButtons = function () {
        if (!revPrev || !revNext) return;
        var scrollLeft = revViewport.scrollLeft;
        var maxScroll = revViewport.scrollWidth - revViewport.clientWidth;
        revPrev.disabled = scrollLeft <= 5;
        revNext.disabled = scrollLeft >= maxScroll - 5;
      };

      var scrollRevByCards = function (direction) {
        var amount = getRevScrollAmount() * getRevVisibleCount();
        revViewport.scrollBy({ left: direction * amount, behavior: 'smooth' });
      };

      if (revPrev) revPrev.addEventListener('click', function () { scrollRevByCards(-1); });
      if (revNext) revNext.addEventListener('click', function () { scrollRevByCards(1); });
      revViewport.addEventListener('scroll', updateRevButtons, { passive: true });
      window.addEventListener('resize', updateRevButtons, { passive: true });
      requestAnimationFrame(function () {
        requestAnimationFrame(updateRevButtons);
      });
    }
  }

  /* ═══ 10. BREAKDOWN VIDEO PLAYER (minimal controls, no fullscreen) ═══ */
  var breakdownPlayBtn = document.querySelector('[data-om2-breakdown-play]');
  if (breakdownPlayBtn) {
    breakdownPlayBtn.addEventListener('click', function () {
      var videoWrap = breakdownPlayBtn.closest('.om2-breakdown__video');
      if (!videoWrap || videoWrap.dataset.loaded === 'true') return;

      var playerDiv = document.createElement('div');
      playerDiv.className = 'om2-breakdown__video-player';

      var video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('controlsList', 'nodownload nofullscreen');
      video.setAttribute('disablePictureInPicture', '');
      video.preload = 'metadata';
      video.style.cssText = 'width:100%;height:100%;border-radius:16px;';

      /* Placeholder: replace src with actual video URL when available */
      video.poster = '';

      playerDiv.appendChild(video);

      var card = videoWrap.querySelector('.om2-breakdown__video-card');
      if (card) {
        card.innerHTML = '';
        card.appendChild(playerDiv);
      }
      videoWrap.dataset.loaded = 'true';
    });
  }
})();
