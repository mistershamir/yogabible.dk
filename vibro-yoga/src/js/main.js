/**
 * Vibro Yoga DK — Main JS
 */
(function() {
  'use strict';

  /* ── Header: Sticky + Shrink ── */
  var header = document.getElementById('vy-header');
  if (header) {
    window.addEventListener('scroll', function() {
      header.classList.toggle('vy-header--scrolled', window.scrollY > 40);
    });
  }

  /* ── Mobile Drawer ── */
  var burger = document.getElementById('vy-burger');
  var drawer = document.getElementById('vy-drawer');
  if (burger && drawer) {
    burger.addEventListener('click', function() {
      var open = drawer.classList.toggle('vy-drawer--open');
      burger.classList.toggle('vy-header__burger--open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });
    drawer.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        drawer.classList.remove('vy-drawer--open');
        burger.classList.remove('vy-header__burger--open');
        document.body.style.overflow = '';
      });
    });
  }

  /* ── Scroll Reveal ── */
  var reveals = document.querySelectorAll('.vy-reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('vy-reveal--visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function(el) { observer.observe(el); });
  }

  /* ── Smooth Scroll for anchor links ── */
  document.querySelectorAll('a[href^="#"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      var target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        var offset = header ? header.offsetHeight + 20 : 80;
        var top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
    });
  });

})();
