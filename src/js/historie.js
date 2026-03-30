/* ═══════════════════════════════════════════════════════════════
   YOGA BIBLE HISTORIE — Scroll animations, counters, video
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Scroll-reveal observer ── */
  var revealEls = document.querySelectorAll('.ybh-scroll-reveal');
  if (revealEls.length) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('ybh-visible');
          revealObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(function (el) { revealObs.observe(el); });
  }

  /* ── Stats counter animation ── */
  var statEls = document.querySelectorAll('[data-ybh-target]');
  if (statEls.length) {
    var counted = false;
    var statsObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !counted) {
          counted = true;
          animateCounters();
          statsObs.disconnect();
        }
      });
    }, { threshold: 0.3 });
    var statsSection = document.querySelector('.ybh-stats');
    if (statsSection) statsObs.observe(statsSection);
  }

  function animateCounters() {
    statEls.forEach(function (el) {
      var target = parseFloat(el.getAttribute('data-ybh-target'));
      var isDecimal = el.hasAttribute('data-ybh-decimal');
      var duration = 1800;
      var start = performance.now();

      function update(now) {
        var elapsed = now - start;
        var progress = Math.min(elapsed / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        var current = eased * target;

        if (isDecimal) {
          el.textContent = current.toFixed(1);
        } else {
          el.textContent = Math.round(current);
        }

        if (progress < 1) {
          requestAnimationFrame(update);
        }
      }

      requestAnimationFrame(update);
    });
  }

  /* ── Testimonial video play/pause ── */
  var playBtn = document.querySelector('.ybh-testimonial__play');
  var video = document.querySelector('.ybh-testimonial__media video');
  if (playBtn && video) {
    playBtn.addEventListener('click', function () {
      if (video.paused) {
        video.muted = false;
        video.play();
        playBtn.classList.add('ybh-hidden');
      } else {
        video.pause();
        video.muted = true;
        playBtn.classList.remove('ybh-hidden');
      }
    });

    video.addEventListener('ended', function () {
      playBtn.classList.remove('ybh-hidden');
      video.muted = true;
    });

    video.addEventListener('click', function () {
      if (!video.paused) {
        video.pause();
        video.muted = true;
        playBtn.classList.remove('ybh-hidden');
      }
    });
  }
})();
