/* ========================================
   LINK IN BIO — Video Fallback, Click Tracking, Share & Animations
   ======================================== */

(function () {
  'use strict';

  /* ── Hero Video → Image Fallback ── */
  var video = document.querySelector('.yb-link__video');
  if (video) {
    video.addEventListener('error', function () {
      // Video failed (e.g. .mp4 missing) — show poster as static image
      var poster = video.getAttribute('poster');
      if (poster) {
        var img = document.createElement('img');
        img.src = poster;
        img.alt = 'Yoga Bible';
        img.className = 'yb-link__video';
        img.style.objectFit = 'cover';
        video.parentNode.replaceChild(img, video);
      }
    });
  }

  /* ── GTM Click Tracking ── */
  document.querySelectorAll('[data-yb-link]').forEach(function (el) {
    el.addEventListener('click', function () {
      var label = el.getAttribute('data-yb-link');
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'link_in_bio_click',
        link_name: label,
        link_url: el.href || '',
        link_lang: document.documentElement.lang || 'da'
      });
    });
  });

  /* ── Share / Copy Link Button ── */
  var shareBtn = document.getElementById('yb-link-share');
  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      var url = window.location.origin + '/link/';
      var label = shareBtn.getAttribute('data-label');
      var copiedLabel = shareBtn.getAttribute('data-copied');
      var textEl = shareBtn.querySelector('span');

      // Use native share on mobile if available
      if (navigator.share) {
        navigator.share({ title: 'YOGA BIBLE', url: url }).catch(function () {});
        return;
      }

      // Fallback: copy to clipboard
      navigator.clipboard.writeText(url).then(function () {
        textEl.textContent = copiedLabel;
        shareBtn.classList.add('yb-link__share--copied');
        setTimeout(function () {
          textEl.textContent = label;
          shareBtn.classList.remove('yb-link__share--copied');
        }, 2000);
      });

      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: 'link_in_bio_share' });
    });
  }

  /* ── Fade-Up Entrance Animations ── */
  var fadeEls = document.querySelectorAll('.yb-link__fade');
  if (!fadeEls.length) return;

  // Stagger each section's entrance
  var delay = 80;
  fadeEls.forEach(function (el, i) {
    el.style.transitionDelay = (i * delay) + 'ms';
  });

  // Trigger after a brief paint delay
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      fadeEls.forEach(function (el) {
        el.classList.add('yb-link__fade--visible');
      });
    });
  });
})();
