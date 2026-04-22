/**
 * YOGA BIBLE - SCHEDULE MODAL FUNCTIONALITY
 * Handles the unified schedule modal for all 200-hour programs
 */

(function() {
  'use strict';

  const modal = document.getElementById("yb-schedule-modal");
  if (!modal || modal.dataset.ybuInit === "1") return;
  modal.dataset.ybuInit = "1";

  const FORM_URL = '/.netlify/functions/lead';

  const form = document.getElementById("ybuForm");
  const viewForm = document.getElementById("ybu-view-form");
  const viewSuccess = document.getElementById("ybu-view-success");
  const errBox = document.getElementById("ybuError");
  const submitBtn = document.getElementById("ybuSubmit");
  const accHidden = document.getElementById("ybuAccommodation");
  const cityInput = document.getElementById("ybuCity");
  const toggleBtns = modal.querySelectorAll(".yb-modal-u__toggle-btn");

  let scrollY = 0;
  let defaultFormat = '18w';

  // Move modal to body if not already there
  try {
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
  } catch(e) {}

  function closeModal() {
    modal.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    window.scrollTo(0, scrollY);
  }

  function openModal(fmt) {
    defaultFormat = fmt || '18w';
    if (form) form.reset();
    if (errBox) errBox.hidden = true;
    if (viewForm) viewForm.hidden = false;
    if (viewSuccess) viewSuccess.hidden = true;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send & få skema';
    }

    // Reset accommodation
    if (accHidden) accHidden.value = 'No';
    if (cityInput) cityInput.hidden = true;
    toggleBtns.forEach(b => b.classList.toggle('is-active', b.dataset.acc === 'No'));

    // Pre-check default format(s)
    // Support '4w' as a shorthand that selects both 4w-jun and 4w-jul (April is sold out)
    // Support '18w' as a shorthand that selects both 18w-mar and 18w-aug
    modal.querySelectorAll('input[name="format"]').forEach(cb => {
      if (defaultFormat === '4w') {
        cb.checked = cb.value === '4w-jun' || cb.value === '4w-jul';
      } else if (defaultFormat === '18w') {
        cb.checked = cb.value === '18w-mar' || cb.value === '18w-aug';
      } else {
        cb.checked = cb.value === defaultFormat;
      }
    });

    // Lock body scroll
    scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
    }

    modal.setAttribute('aria-hidden', 'false');

    const box = modal.querySelector('.yb-modal-u__box');
    if (box) box.scrollTop = 0;

    setTimeout(() => {
      const first = document.getElementById('ybuFirstName');
      if (first) first.focus();
    }, 50);
  }

  // Expose global function
  window.openYBScheduleModal = openModal;

  // Close handlers
  document.addEventListener('click', e => {
    if (e.target.closest('[data-ybu-close]')) {
      e.preventDefault();
      closeModal();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
      closeModal();
    }
  });

  // Accommodation toggle
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const val = btn.dataset.acc;
      if (accHidden) accHidden.value = val;
      if (cityInput) cityInput.hidden = val !== 'Yes';
    });
  });

  // Form submission via GET with query params (matches working Squarespace version)
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (errBox) errBox.hidden = true;

      // Get selected formats
      const fmts = [];
      modal.querySelectorAll('input[name="format"]:checked').forEach(cb => fmts.push(cb.value));

      if (!fmts.length) {
        if (errBox) {
          errBox.textContent = 'Vælg mindst ét format.';
          errBox.hidden = false;
        }
        return;
      }

      const fn = document.getElementById('ybuFirstName').value.trim();
      const ln = document.getElementById('ybuLastName').value.trim();
      const em = document.getElementById('ybuEmail').value.trim();
      const ph = document.getElementById('ybuPhone').value.trim();
      const acc = accHidden ? accHidden.value : 'No';
      const city = cityInput && !cityInput.hidden ? cityInput.value.trim() : '';

      if (!fn || !ln || !em || !ph) {
        if (errBox) {
          errBox.textContent = 'Udfyld alle obligatoriske felter.';
          errBox.hidden = false;
        }
        return;
      }

      submitBtn.disabled = true;
      var isDa = window.location.pathname.indexOf('/en/') !== 0;
      submitBtn.textContent = isDa ? 'Sender…' : 'Sending…';

      const p = new URLSearchParams();
      p.append('lang', isDa ? 'da' : 'en');
      if (fmts.length > 1) {
        p.append('action', 'lead_schedule_multi');
        p.append('allFormats', fmts.join(','));
      } else {
        p.append('action', 'lead_schedule_' + fmts[0]);
      }
      p.append('firstName', fn);
      p.append('lastName', ln);
      p.append('email', em);
      p.append('phone', ph);
      p.append('accommodation', acc);
      p.append('source', 'Modal-' + (fmts.length > 1 ? 'Multi-' + fmts.join('+') : fmts[0]));
      if (city) p.append('cityCountry', city);

      // Attach attribution data (UTM, referrer, channel)
      if (typeof window.ybAttribution === 'function') {
        var attr = window.ybAttribution();
        if (attr.channel) p.append('channel', attr.channel);
        if (attr.utm_source) p.append('utm_source', attr.utm_source);
        if (attr.utm_medium) p.append('utm_medium', attr.utm_medium);
        if (attr.utm_campaign) p.append('utm_campaign', attr.utm_campaign);
        if (attr.gclid) p.append('gclid', attr.gclid);
        if (attr.fbclid) p.append('fbclid', attr.fbclid);
        if (attr.referrer) p.append('referrer', attr.referrer);
        if (attr.landing_page) p.append('landing_page', attr.landing_page);
      }

      // Pass anonymous visitor ID for identity stitching
      var vidMatch = document.cookie.match(/(?:^|; )yb_vid=([^;]*)/);
      if (vidMatch) p.append('visitor_id', decodeURIComponent(vidMatch[1]));

      // POST to Netlify Function with query params as body
      fetch(FORM_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString() })
        .finally(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send & få skema';
          if (viewForm) viewForm.hidden = true;
          if (viewSuccess) viewSuccess.hidden = false;
        });
    });
  }

  // Start closed
  closeModal();
})();
