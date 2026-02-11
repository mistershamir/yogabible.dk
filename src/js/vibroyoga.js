/* ========================================================
   VIBRO YOGA — Dynamic Interactions
   Scroll reveals, parallax, counter animation, nav state
   ======================================================== */

(function () {
  'use strict';

  /* ── Scroll-triggered reveals ── */
  function initReveals() {
    var els = document.querySelectorAll('.vy-reveal, .vy-reveal-left, .vy-reveal-right, .vy-reveal-scale');
    if (!els.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    els.forEach(function (el) { observer.observe(el); });
  }

  /* ── Stagger children ── */
  function initStagger() {
    document.querySelectorAll('.vy-stagger').forEach(function (parent) {
      Array.from(parent.children).forEach(function (child, i) {
        child.style.setProperty('--i', i);
      });
    });
  }

  /* ── Navbar scroll state ── */
  function initNav() {
    var nav = document.querySelector('.vy-nav');
    if (!nav) return;

    var scrolled = false;
    function check() {
      var isScrolled = window.scrollY > 60;
      if (isScrolled !== scrolled) {
        scrolled = isScrolled;
        nav.classList.toggle('is-scrolled', scrolled);
      }
    }
    window.addEventListener('scroll', check, { passive: true });
    check();
  }

  /* ── Mobile nav ── */
  function initMobileNav() {
    var toggle = document.querySelector('.vy-nav__toggle');
    var drawer = document.querySelector('.vy-mobile-nav');
    var overlay = document.querySelector('.vy-mobile-nav__overlay');
    var close = document.querySelector('.vy-mobile-nav__close');
    if (!toggle || !drawer) return;

    function open() {
      drawer.classList.add('is-open');
      if (overlay) overlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
    function shut() {
      drawer.classList.remove('is-open');
      if (overlay) overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }
    toggle.addEventListener('click', open);
    if (close) close.addEventListener('click', shut);
    if (overlay) overlay.addEventListener('click', shut);

    // Close on link click
    drawer.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', shut);
    });
  }

  /* ── Counter animation ── */
  function initCounters() {
    var counters = document.querySelectorAll('[data-vy-count]');
    if (!counters.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var target = parseInt(el.getAttribute('data-vy-count'), 10);
        var suffix = el.getAttribute('data-vy-suffix') || '';
        var prefix = el.getAttribute('data-vy-prefix') || '';
        var duration = 1800;
        var start = performance.now();

        function step(now) {
          var progress = Math.min((now - start) / duration, 1);
          // Ease out cubic
          var eased = 1 - Math.pow(1 - progress, 3);
          var current = Math.round(eased * target);
          el.textContent = prefix + current.toLocaleString() + suffix;
          if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        observer.unobserve(el);
      });
    }, { threshold: 0.5 });

    counters.forEach(function (el) { observer.observe(el); });
  }

  /* ── Smooth scroll for anchor links ── */
  function initSmoothScroll() {
    document.querySelectorAll('.vy a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = this.getAttribute('href');
        if (id === '#') return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ── Parallax on hero background ── */
  function initParallax() {
    var heroBg = document.querySelector('.vy-hero__bg img');
    if (!heroBg) return;

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(function () {
          var scrolled = window.scrollY;
          var heroH = document.querySelector('.vy-hero').offsetHeight;
          if (scrolled < heroH) {
            heroBg.style.transform = 'scale(1.1) translateY(' + (scrolled * 0.25) + 'px)';
          }
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  /* ── Horizontal scroll classes ── */
  function initClassesScroll() {
    var track = document.querySelector('.vy-classes-scroll');
    if (!track) return;

    // Mouse drag scrolling
    var isDown = false;
    var startX, scrollLeft;
    track.addEventListener('mousedown', function (e) {
      isDown = true;
      track.style.cursor = 'grabbing';
      startX = e.pageX - track.offsetLeft;
      scrollLeft = track.scrollLeft;
    });
    track.addEventListener('mouseleave', function () { isDown = false; track.style.cursor = 'grab'; });
    track.addEventListener('mouseup', function () { isDown = false; track.style.cursor = 'grab'; });
    track.addEventListener('mousemove', function (e) {
      if (!isDown) return;
      e.preventDefault();
      var x = e.pageX - track.offsetLeft;
      var walk = (x - startX) * 1.5;
      track.scrollLeft = scrollLeft - walk;
    });
    track.style.cursor = 'grab';
  }

  /* ── Progress bar on scroll ── */
  function initProgressBar() {
    var bar = document.querySelector('.vy-progress-bar');
    if (!bar) return;

    window.addEventListener('scroll', function () {
      var h = document.documentElement;
      var percent = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
      bar.style.width = percent + '%';
    }, { passive: true });
  }

  /* ── Init all ── */
  function init() {
    initReveals();
    initStagger();
    initNav();
    initMobileNav();
    initCounters();
    initSmoothScroll();
    initParallax();
    initClassesScroll();
    initProgressBar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
