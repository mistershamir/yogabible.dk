// =========================================================================
// workshop-browser.js — Browse & book individual YTT workshops
// Opens a modal listing all upcoming workshops (SessionTypeId 24)
// Users can book directly if they have a valid pass, or buy one (ProdId 100075)
// =========================================================================
(function () {
  'use strict';

  var API = '/.netlify/functions';
  var WORKSHOP_PROD_ID = '100075';
  var isDa = window.location.pathname.indexOf('/en/') !== 0;

  // State
  var modal = null;
  var scrollY = 0;
  var workshops = [];
  var mbClientId = null;
  var isLoggedIn = false;

  function t(da, en) { return isDa ? da : en; }
  function $(id) { return document.getElementById(id); }

  // ── Date helpers ──
  var dayNames = {
    da: ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'],
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  };
  var monthNames = {
    da: ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  };

  function formatDate(iso) {
    var d = new Date(iso);
    var lang = isDa ? 'da' : 'en';
    return dayNames[lang][d.getDay()] + ' ' + d.getDate() + '. ' + monthNames[lang][d.getMonth()];
  }

  function formatTime(iso) {
    var d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function dateKey(iso) {
    return iso.split('T')[0];
  }

  // ── Fetch workshops ──
  async function fetchWorkshops() {
    var now = new Date();
    var start = now.toISOString().split('T')[0];
    // Fetch 6 months ahead
    var end = new Date(now.getTime() + 180 * 86400000).toISOString().split('T')[0];

    var url = API + '/mb-classes?sessionTypeIds=24&startDate=' + start + '&endDate=' + end;

    // Include clientId if available for isBooked detection
    if (mbClientId) {
      url += '&clientId=' + mbClientId;
    }

    var resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch workshops');
    var data = await resp.json();

    // Filter to YTT workshops only (all start with "Teacher Training:")
    return (data.classes || []).filter(function (c) {
      return !c.isCanceled && new Date(c.startDateTime) > now &&
        c.name.indexOf('Teacher Training:') === 0;
    });
  }

  // ── Render workshop list ──
  function renderWorkshops(list) {
    var container = $('ywb-list');
    if (!container) return;
    container.innerHTML = '';

    if (!list.length) {
      $('ywb-empty').hidden = false;
      return;
    }
    $('ywb-empty').hidden = true;

    // Group by date
    var groups = {};
    var order = [];
    list.forEach(function (ws) {
      var key = dateKey(ws.startDateTime);
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(ws);
    });

    order.forEach(function (key) {
      var label = formatDate(groups[key][0].startDateTime);

      var section = document.createElement('div');
      section.className = 'ywb-day';

      var header = document.createElement('div');
      header.className = 'ywb-day__header';
      header.textContent = label;
      section.appendChild(header);

      groups[key].forEach(function (ws) {
        var card = document.createElement('div');
        card.className = 'ywb-card';
        if (ws.isBooked) card.classList.add('ywb-card--booked');

        var time = formatTime(ws.startDateTime) + ' – ' + formatTime(ws.endDateTime);
        var spots = ws.spotsLeft !== null ? ws.spotsLeft : '–';
        var isFull = ws.spotsLeft !== null && ws.spotsLeft <= 0;

        card.innerHTML =
          '<div class="ywb-card__main">' +
            '<div class="ywb-card__time">' + time + '</div>' +
            '<div class="ywb-card__info">' +
              '<div class="ywb-card__name">' + ws.name + '</div>' +
              '<div class="ywb-card__instructor">' + ws.instructor + '</div>' +
            '</div>' +
            '<div class="ywb-card__right">' +
              (ws.isBooked
                ? '<span class="ywb-badge ywb-badge--booked">' + t('Booket', 'Booked') + '</span>'
                : isFull
                  ? '<span class="ywb-badge ywb-badge--full">' + t('Fuld', 'Full') + '</span>'
                  : '<span class="ywb-card__spots">' + spots + ' ' + t('pladser', 'spots') + '</span>') +
              (!ws.isBooked && !isFull
                ? '<button type="button" class="ywb-book-btn" data-class-id="' + ws.id + '">' + t('Book', 'Book') + '</button>'
                : '') +
              (ws.isBooked
                ? '<button type="button" class="ywb-cancel-btn" data-class-id="' + ws.id + '">' + t('Afmeld', 'Cancel') + '</button>'
                : '') +
            '</div>' +
          '</div>';

        section.appendChild(card);
      });

      container.appendChild(section);
    });

    // Attach click handlers
    container.querySelectorAll('.ywb-book-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleBook(btn.getAttribute('data-class-id'), btn);
      });
    });

    container.querySelectorAll('.ywb-cancel-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleCancel(btn.getAttribute('data-class-id'), btn);
      });
    });
  }

  // ── Resolve MB client from Firebase auth ──
  async function resolveMbClient() {
    if (mbClientId) return mbClientId;
    if (typeof firebase === 'undefined' || !firebase.auth) return null;

    var user = firebase.auth().currentUser;
    if (!user) return null;
    isLoggedIn = true;

    try {
      var doc = await firebase.firestore().collection('users').doc(user.uid).get();
      if (doc.exists && doc.data().mindbodyClientId) {
        mbClientId = doc.data().mindbodyClientId;
        return mbClientId;
      }
    } catch (e) {
      console.warn('ywb: could not resolve MB client', e);
    }
    return null;
  }

  // ── Book a workshop ──
  async function handleBook(classId, btn) {
    // Check auth
    if (!isLoggedIn || !firebase.auth().currentUser) {
      // Open checkout flow for workshop pass — handles auth + purchase
      if (typeof window.openCheckoutFlow === 'function') {
        closeModal();
        window.openCheckoutFlow(WORKSHOP_PROD_ID);
      } else if (typeof window.openAuthModal === 'function') {
        closeModal();
        window.openAuthModal();
      }
      return;
    }

    // Resolve MB client
    var clientId = await resolveMbClient();
    if (!clientId) {
      alert(t('Kunne ikke finde din Mindbody-profil. Prøv at logge ind igen.', 'Could not find your Mindbody profile. Please try logging in again.'));
      return;
    }

    // Try booking
    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';

    try {
      var resp = await fetch(API + '/mb-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientId, classId: Number(classId) })
      });
      var data = await resp.json();

      if (resp.ok && data.success) {
        // Success — update card to show booked state
        btn.closest('.ywb-card').classList.add('ywb-card--booked');
        var right = btn.closest('.ywb-card__right');
        right.innerHTML =
          '<span class="ywb-badge ywb-badge--booked">' + t('Booket', 'Booked') + '</span>' +
          '<button type="button" class="ywb-cancel-btn" data-class-id="' + classId + '">' + t('Afmeld', 'Cancel') + '</button>';
        right.querySelector('.ywb-cancel-btn').addEventListener('click', function () {
          handleCancel(classId, right.querySelector('.ywb-cancel-btn'));
        });
      } else if (data.error === 'no_pass') {
        // No valid pass — offer to buy workshop pass
        if (confirm(t(
          'Du har ikke et gyldigt workshop-pass. Vil du købe et? (975 kr.)',
          "You don't have a valid workshop pass. Would you like to buy one? (975 DKK)"
        ))) {
          closeModal();
          if (typeof window.openCheckoutFlow === 'function') {
            window.openCheckoutFlow(WORKSHOP_PROD_ID);
          }
        }
        btn.disabled = false;
        btn.textContent = origText;
      } else {
        alert(data.error || t('Booking fejlede', 'Booking failed'));
        btn.disabled = false;
        btn.textContent = origText;
      }
    } catch (err) {
      console.error('ywb: book error', err);
      alert(t('Noget gik galt. Prøv igen.', 'Something went wrong. Please try again.'));
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  // ── Cancel a booking ──
  async function handleCancel(classId, btn) {
    if (!confirm(t('Er du sikker på at du vil afmelde denne workshop?', 'Are you sure you want to cancel this workshop?'))) return;

    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';

    try {
      var resp = await fetch(API + '/mb-book', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: mbClientId, classId: Number(classId) })
      });
      var data = await resp.json();

      if (resp.ok && data.success) {
        // Refresh the whole list to get correct state
        await loadWorkshops();
      } else {
        alert(data.error || t('Afmelding fejlede', 'Cancellation failed'));
        btn.disabled = false;
        btn.textContent = origText;
      }
    } catch (err) {
      console.error('ywb: cancel error', err);
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  // ── Load + render ──
  async function loadWorkshops() {
    $('ywb-loading').hidden = false;
    $('ywb-error').hidden = true;
    $('ywb-empty').hidden = true;
    $('ywb-list').innerHTML = '';

    try {
      workshops = await fetchWorkshops();
      $('ywb-loading').hidden = true;
      renderWorkshops(workshops);

      // Show footer CTA if user is not logged in or for general info
      var footer = $('ywb-footer');
      if (footer) footer.hidden = false;
    } catch (err) {
      console.error('ywb: load error', err);
      $('ywb-loading').hidden = true;
      $('ywb-error').hidden = false;
    }
  }

  // ── Modal open/close ──
  function openModal() {
    modal = $('ywb-modal');
    if (!modal) return;

    scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = '-' + scrollY + 'px';
    }
    modal.setAttribute('aria-hidden', 'false');

    // Resolve auth state then load
    resolveMbClient().then(function () {
      loadWorkshops();
    });
  }

  function closeModal() {
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      window.scrollTo(0, scrollY);
    }
  }

  // ── Init ──
  function init() {
    modal = $('ywb-modal');
    if (!modal) return;

    // Close handlers
    modal.querySelectorAll('[data-ywb-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });

    // ESC key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && modal.getAttribute('aria-hidden') === 'false') {
        closeModal();
      }
    });

    // Retry button
    var retryBtn = $('ywb-retry');
    if (retryBtn) retryBtn.addEventListener('click', loadWorkshops);
    var retryBtnEn = $('ywb-retry-en');
    if (retryBtnEn) retryBtnEn.addEventListener('click', loadWorkshops);

    // Buy pass button in footer
    var buyBtn = $('ywb-buy-pass');
    if (buyBtn) {
      buyBtn.addEventListener('click', function () {
        closeModal();
        if (typeof window.openCheckoutFlow === 'function') {
          window.openCheckoutFlow(WORKSHOP_PROD_ID);
        }
      });
    }

    // Open triggers — any element with data-open-workshops
    document.querySelectorAll('[data-open-workshops]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
      });
    });

    // Listen for auth state changes to refresh booking state
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().onAuthStateChanged(function (user) {
        isLoggedIn = !!user;
        if (!user) {
          mbClientId = null;
        }
      });
    }
  }

  // Expose global opener for use from other scripts
  window.openWorkshopBrowser = openModal;

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
