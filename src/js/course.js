/* ═══════════════════════════════════════════════════════════════
   course.js — Unified JS for all course pages
   Handles: FAQ accordion, video player, quote animation,
            scroll-triggered effects, month chip
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── FAQ Accordion ── */
  document.querySelectorAll('.ybc-faq__item').forEach(function (item) {
    var btn = item.querySelector('.ybc-faq__toggle');
    var panel = item.querySelector('.ybc-faq__panel');
    if (!btn || !panel) return;

    btn.addEventListener('click', function () {
      var isOpen = item.classList.contains('is-open');

      // Close all siblings
      item.closest('.ybc-faq').querySelectorAll('.ybc-faq__item').forEach(function (sib) {
        if (sib !== item) {
          sib.classList.remove('is-open');
          var sp = sib.querySelector('.ybc-faq__panel');
          if (sp) sp.style.maxHeight = '0px';
        }
      });

      if (isOpen) {
        item.classList.remove('is-open');
        panel.style.maxHeight = '0px';
      } else {
        item.classList.add('is-open');
        panel.style.maxHeight = panel.scrollHeight + 'px';
      }
    });
  });

  /* ── Video Player ── */
  var videoSection = document.getElementById('ybc-journey');
  if (videoSection) {
    var video = videoSection.querySelector('.ybc-journey__video');
    var toggle = videoSection.querySelector('.ybc-video-toggle');
    var poster = videoSection.querySelector('.ybc-video-poster');

    function setVideoUI(playing) {
      if (toggle) {
        toggle.classList.toggle('is-playing', playing);
        toggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
      }
      if (poster) poster.classList.toggle('is-hidden', playing);
    }

    function tryPlay() {
      if (!video) return;
      video.muted = false;
      video.loop = true;
      var p = video.play();
      if (p && p.catch) {
        p.catch(function () {
          video.setAttribute('controls', '');
          video.play().catch(function () {});
        });
      }
    }

    if (poster) poster.addEventListener('click', tryPlay);

    if (toggle) {
      toggle.addEventListener('click', function () {
        if (!video) return;
        if (video.paused) tryPlay();
        else video.pause();
      });
    }

    if (video) {
      video.addEventListener('click', function () {
        if (video.paused) tryPlay();
        else video.pause();
      });
      video.addEventListener('play', function () { setVideoUI(true); });
      video.addEventListener('pause', function () { setVideoUI(false); });
    }
  }

  /* ── Inspiration Quote Animation ── */
  var quoteSection = document.querySelector('.ybc-quote');
  if (quoteSection) {
    var quoteVideo = quoteSection.querySelector('.ybc-quote__video');
    var lines = Array.from(quoteSection.querySelectorAll('.ybc-quote__line'));
    var seqTimer = null;
    var idx = 0;

    function loadQuoteVideo() {
      if (!quoteVideo) return;
      if (!quoteVideo.src) {
        var src = quoteVideo.getAttribute('data-src');
        if (src) quoteVideo.src = src;
      }
      quoteVideo.muted = true;
      var p = quoteVideo.play && quoteVideo.play();
      if (p && p.catch) p.catch(function () {});
    }

    function clearHot() {
      lines.forEach(function (l) { l.classList.remove('is-hot'); });
    }

    function startLoop() {
      if (seqTimer) return;
      clearHot();
      idx = 0;
      if (lines[idx]) lines[idx].classList.add('is-hot');

      seqTimer = setInterval(function () {
        if (lines[idx]) lines[idx].classList.remove('is-hot');
        idx = (idx + 1) % lines.length;
        setTimeout(function () {
          if (!quoteSection.classList.contains('is-inview')) return;
          if (lines[idx]) lines[idx].classList.add('is-hot');
        }, 120);
      }, 1200);
    }

    function stopLoop() {
      if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
      clearHot();
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            quoteSection.classList.add('is-inview');
            loadQuoteVideo();
            startLoop();
          } else {
            quoteSection.classList.remove('is-inview');
            if (quoteVideo) quoteVideo.pause();
            stopLoop();
          }
        });
      }, { threshold: 0.35 });
      io.observe(quoteSection);
    } else {
      quoteSection.classList.add('is-inview');
      loadQuoteVideo();
      startLoop();
    }
  }

  /* ── Scroll-triggered fade-in ── */
  if ('IntersectionObserver' in window) {
    var fadeObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          fadeObserver.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });

    document.querySelectorAll('.ybc-fade-up').forEach(function (el) {
      fadeObserver.observe(el);
    });
  }

  /* ── Journey section: match heights on desktop ── */
  var journeyLeft = document.querySelector('.ybc-journey__text');
  var journeyRight = document.querySelector('.ybc-journey__video-wrap');

  function matchJourneyHeights() {
    if (!journeyLeft || !journeyRight) return;
    if (!window.matchMedia('(min-width: 880px)').matches) {
      journeyRight.style.height = 'auto';
      return;
    }
    journeyRight.style.height = Math.max(200, journeyLeft.offsetHeight - 1) + 'px';
  }

  /* ── Journey FAQ: mobile repositioning ── */
  var journeyGrid = document.querySelector('.ybc-journey__grid');
  var journeyFaq = document.querySelector('.ybc-journey .ybc-faq');

  function placeJourneyFaq() {
    if (!journeyFaq || !journeyLeft || !journeyGrid) return;
    if (window.matchMedia('(max-width: 879px)').matches) {
      if (journeyFaq.parentElement !== journeyGrid) {
        journeyGrid.appendChild(journeyFaq);
      }
    } else {
      if (journeyFaq.parentElement !== journeyLeft) {
        journeyLeft.appendChild(journeyFaq);
      }
    }
    matchJourneyHeights();
  }

  window.addEventListener('load', function () {
    placeJourneyFaq();
    matchJourneyHeights();
  });
  window.addEventListener('resize', placeJourneyFaq);
  setTimeout(placeJourneyFaq, 300);
})();
