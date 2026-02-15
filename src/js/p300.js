// =========================================================================
// p300.js — 300-Hour Advanced Teacher Training page interactions
// Single-accordion behavior for hours breakdown and FAQ sections
// =========================================================================
(function () {
  'use strict';

  // ── Single-accordion: only one open at a time per group ──
  document.querySelectorAll('[data-p300-single-accordion]').forEach(function (group) {
    group.addEventListener('click', function (e) {
      var summary = e.target.closest('summary');
      if (!summary) return;
      var parent = summary.parentElement;
      if (!parent || parent.tagName !== 'DETAILS') return;

      // If opening, close all siblings
      if (!parent.open) {
        group.querySelectorAll('details[open]').forEach(function (d) {
          if (d !== parent) d.removeAttribute('open');
        });
      }
    });
  });
})();
