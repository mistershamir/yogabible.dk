/**
 * YOGA BIBLE - FOOTER FUNCTIONALITY
 * Handles footer accordion on mobile
 */

(function() {
  'use strict';

  const cols = document.querySelectorAll('.yb-col');
  if (!cols.length) return;

  cols.forEach(function(col) {
    const header = col.querySelector('.yb-col-header');
    const body = col.querySelector('.yb-col-body');

    if (!header || !body) return;

    header.addEventListener('click', function() {
      // Only toggle on mobile
      if (window.innerWidth > 768) return;

      col.classList.toggle('yb-col--open');
    });
  });

  console.log('✅ Footer accordion initialized');
})();
