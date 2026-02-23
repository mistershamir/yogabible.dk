/**
 * YOGA BIBLE - MAIN JAVASCRIPT
 * Additional page functionality and utilities
 */

(function() {
  'use strict';

  // ============================================
  // GLOBAL BILINGUAL TOGGLE (data-yj-da / data-yj-en)
  // Ensures all modals + global components show correct language
  // ============================================

  var pathname = window.location.pathname || '/';
  var isEnglish = pathname.indexOf('/en/') === 0 || pathname === '/en';

  if (isEnglish) {
    document.querySelectorAll('[data-yj-da]').forEach(function(el) { el.hidden = true; });
    document.querySelectorAll('[data-yj-en]').forEach(function(el) { el.hidden = false; });
  }

  // ============================================
  // SMOOTH SCROLL FOR ANCHOR LINKS
  // ============================================

  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href === '#') return;

      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // ============================================
  // LAZY LOADING IMAGES
  // ============================================

  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          observer.unobserve(img);
        }
      });
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
      imageObserver.observe(img);
    });
  }

  // ============================================
  // PERFORMANCE MONITORING
  // ============================================

  window.addEventListener('load', () => {
    if ('performance' in window) {
      const perfData = window.performance.timing;
      const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
      console.log(`⚡ Page load time: ${pageLoadTime}ms`);
    }
  });

  console.log('✅ Main scripts initialized');
})();
