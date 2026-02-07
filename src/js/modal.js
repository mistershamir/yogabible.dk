/**
 * YOGA BIBLE - SCHEDULE MODAL FUNCTIONALITY
 * Handles the unified schedule modal for all 200-hour programs
 */

(function() {
  'use strict';

  const modal = document.getElementById("yb-schedule-modal");
  if (!modal || modal.dataset.ybuInit === "1") return;
  modal.dataset.ybuInit = "1";

  const FORM_URL = 'https://script.google.com/macros/s/AKfycbyhs4bfPcvcqaJRTmAlPTFf_uIOkFatZviKKO20nckBfGi78JqkNzy4FNpWztl7nQsSAA/exec';

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

    // Pre-check default format
    modal.querySelectorAll('input[name="format"]').forEach(cb => {
      cb.checked = cb.value === defaultFormat;
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
      submitBtn.textContent = 'Sender…';

      const p = new URLSearchParams();
      p.append('action', 'lead_schedule_' + fmts[0]);
      p.append('firstName', fn);
      p.append('lastName', ln);
      p.append('email', em);
      p.append('phone', ph);
      p.append('accommodation', acc);
      p.append('source', 'Modal-' + (fmts.length > 1 ? 'Multi' : fmts[0]));
      if (city) p.append('cityCountry', city);
      if (fmts.length > 1) {
        p.append('multiFormat', 'Yes');
        p.append('allFormats', fmts.join(','));
      }

      // GET request with query params — Google Apps Script redirects,
      // and GET survives the redirect (POST body gets dropped)
      fetch(FORM_URL + '?' + p.toString(), { method: 'GET', mode: 'no-cors' })
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
