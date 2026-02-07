/**
 * YOGA BIBLE - MINDBODY INTEGRATION (Client-Side)
 * Handles schedule display, class booking, checkout, and client sync.
 */

(function() {
  'use strict';

  var API_BASE = '/.netlify/functions';
  var locale = (window.location.hostname.indexOf('en.') === 0) ? 'en' : 'da';

  // ============================================
  // SCHEDULE
  // ============================================

  var scheduleGrid = document.getElementById('yb-mb-schedule');

  if (scheduleGrid) {
    loadSchedule();
  }

  function loadSchedule() {
    var container = document.getElementById('yb-mb-schedule');
    if (!container) return;

    container.innerHTML = '<div class="yb-mb-loading"><div class="yb-mb-spinner"></div><span>' +
      (locale === 'da' ? 'Henter skema...' : 'Loading schedule...') + '</span></div>';

    // Get dates for this week (Mon-Sun)
    var now = new Date();
    var dayOfWeek = now.getDay();
    var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    var monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    var sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    var startDate = formatDate(monday);
    var endDate = formatDate(sunday);

    fetch(API_BASE + '/mb-classes?startDate=' + startDate + '&endDate=' + endDate)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.error) {
          container.innerHTML = '<div class="yb-mb-error">' +
            (locale === 'da' ? 'Kunne ikke hente skema. Prøv igen senere.' : 'Could not load schedule. Please try again later.') +
            '</div>';
          return;
        }
        renderSchedule(container, data.classes || [], monday);
      })
      .catch(function() {
        container.innerHTML = '<div class="yb-mb-error">' +
          (locale === 'da' ? 'Kunne ikke hente skema. Prøv igen senere.' : 'Could not load schedule. Please try again later.') +
          '</div>';
      });
  }

  function renderSchedule(container, classes, monday) {
    if (classes.length === 0) {
      container.innerHTML = '<div class="yb-mb-empty">' +
        (locale === 'da' ? 'Ingen klasser fundet denne uge.' : 'No classes found this week.') +
        '</div>';
      return;
    }

    var dayNames = locale === 'da'
      ? ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag']
      : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // Group classes by day
    var grouped = {};
    for (var d = 0; d < 7; d++) {
      var date = new Date(monday);
      date.setDate(monday.getDate() + d);
      grouped[d] = {
        date: date,
        dayName: dayNames[d],
        classes: []
      };
    }

    classes.forEach(function(cls) {
      if (cls.isCanceled) return;
      var classDate = new Date(cls.startDateTime);
      var dayIndex = classDate.getDay();
      // Convert from JS day (0=Sun) to our index (0=Mon)
      var idx = dayIndex === 0 ? 6 : dayIndex - 1;
      if (grouped[idx]) {
        grouped[idx].classes.push(cls);
      }
    });

    // Sort classes within each day by start time
    Object.keys(grouped).forEach(function(key) {
      grouped[key].classes.sort(function(a, b) {
        return new Date(a.startDateTime) - new Date(b.startDateTime);
      });
    });

    // Render
    var html = '<div class="yb-mb-week">';

    for (var i = 0; i < 7; i++) {
      var day = grouped[i];
      var isToday = isSameDay(day.date, new Date());
      var dateStr = day.date.getDate() + '/' + (day.date.getMonth() + 1);

      html += '<div class="yb-mb-day' + (isToday ? ' yb-mb-day--today' : '') + '">';
      html += '<div class="yb-mb-day__header">';
      html += '<span class="yb-mb-day__name">' + day.dayName + '</span>';
      html += '<span class="yb-mb-day__date">' + dateStr + '</span>';
      html += '</div>';
      html += '<div class="yb-mb-day__classes">';

      if (day.classes.length === 0) {
        html += '<div class="yb-mb-noclass">' +
          (locale === 'da' ? 'Ingen klasser' : 'No classes') + '</div>';
      } else {
        day.classes.forEach(function(cls) {
          var startTime = formatTime(new Date(cls.startDateTime));
          var endTime = formatTime(new Date(cls.endDateTime));
          var spotsLeft = cls.maxCapacity - (cls.totalBooked || 0);
          var isFull = spotsLeft <= 0;

          html += '<div class="yb-mb-class' + (isFull ? ' yb-mb-class--full' : '') + '" data-class-id="' + cls.id + '">';
          html += '<div class="yb-mb-class__time">' + startTime + ' – ' + endTime + '</div>';
          html += '<div class="yb-mb-class__info">';
          html += '<div class="yb-mb-class__name">' + escapeHtml(cls.name) + '</div>';
          html += '<div class="yb-mb-class__instructor">' + escapeHtml(cls.instructor) + '</div>';
          html += '</div>';
          html += '<div class="yb-mb-class__action">';
          if (isFull) {
            html += '<span class="yb-mb-class__full">' + (locale === 'da' ? 'Fuldt' : 'Full') + '</span>';
          } else {
            html += '<button class="yb-mb-class__book" type="button" data-mb-book="' + cls.id + '">' +
              (locale === 'da' ? 'Book' : 'Book') + '</button>';
            html += '<span class="yb-mb-class__spots">' + spotsLeft + ' ' +
              (locale === 'da' ? 'pladser' : 'spots') + '</span>';
          }
          html += '</div>';
          html += '</div>';
        });
      }

      html += '</div></div>';
    }

    html += '</div>';

    // Week navigation
    html += '<div class="yb-mb-week-nav">';
    html += '<button class="yb-mb-week-nav__btn" type="button" data-mb-week="-1">' +
      (locale === 'da' ? '← Forrige uge' : '← Previous week') + '</button>';
    html += '<button class="yb-mb-week-nav__btn" type="button" data-mb-week="1">' +
      (locale === 'da' ? 'Næste uge →' : 'Next week →') + '</button>';
    html += '</div>';

    container.innerHTML = html;

    // Bind week navigation
    container.querySelectorAll('[data-mb-week]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var offset = parseInt(btn.getAttribute('data-mb-week'));
        var newMonday = new Date(monday);
        newMonday.setDate(monday.getDate() + (offset * 7));

        var newStart = formatDate(newMonday);
        var newSunday = new Date(newMonday);
        newSunday.setDate(newMonday.getDate() + 6);
        var newEnd = formatDate(newSunday);

        container.innerHTML = '<div class="yb-mb-loading"><div class="yb-mb-spinner"></div><span>' +
          (locale === 'da' ? 'Henter skema...' : 'Loading schedule...') + '</span></div>';

        fetch(API_BASE + '/mb-classes?startDate=' + newStart + '&endDate=' + newEnd)
          .then(function(res) { return res.json(); })
          .then(function(data) {
            renderSchedule(container, data.classes || [], newMonday);
          })
          .catch(function() {
            container.innerHTML = '<div class="yb-mb-error">' +
              (locale === 'da' ? 'Kunne ikke hente skema.' : 'Could not load schedule.') + '</div>';
          });
      });
    });
  }

  // ============================================
  // BOOKING
  // ============================================

  document.addEventListener('click', function(e) {
    var bookBtn = e.target.closest('[data-mb-book]');
    if (!bookBtn) return;

    var classId = bookBtn.getAttribute('data-mb-book');

    // Check if user is logged in (Firebase)
    if (!window.firebase || !firebase.auth().currentUser) {
      // Open auth modal
      if (window.openYBAuthModal) {
        window.openYBAuthModal('login');
      }
      return;
    }

    bookClass(classId, bookBtn);
  });

  function bookClass(classId, btn) {
    var user = firebase.auth().currentUser;
    if (!user) return;

    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = locale === 'da' ? 'Booker...' : 'Booking...';

    // Get Mindbody client ID from Firestore
    firebase.firestore().collection('users').doc(user.uid).get()
      .then(function(doc) {
        var data = doc.data();
        if (!data || !data.mindbodyClientId) {
          // Need to sync first
          return syncMindbodyClient(user).then(function(result) {
            if (!result.mindbodyClientId) {
              throw new Error(locale === 'da'
                ? 'Kunne ikke finde din Mindbody-konto. Kontakt os venligst.'
                : 'Could not find your Mindbody account. Please contact us.');
            }
            return result.mindbodyClientId;
          });
        }
        return data.mindbodyClientId;
      })
      .then(function(clientId) {
        return fetch(API_BASE + '/mb-book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientId,
            classId: parseInt(classId)
          })
        });
      })
      .then(function(res) { return res.json(); })
      .then(function(result) {
        if (result.error) {
          throw new Error(result.error);
        }

        btn.textContent = locale === 'da' ? 'Booket!' : 'Booked!';
        btn.classList.add('yb-mb-class__book--success');

        setTimeout(function() {
          btn.textContent = originalText;
          btn.disabled = false;
          btn.classList.remove('yb-mb-class__book--success');
        }, 3000);
      })
      .catch(function(err) {
        btn.textContent = originalText;
        btn.disabled = false;
        alert(err.message || (locale === 'da' ? 'Booking fejlede.' : 'Booking failed.'));
      });
  }

  // ============================================
  // MINDBODY CLIENT SYNC
  // ============================================

  function syncMindbodyClient(user) {
    return fetch(API_BASE + '/mb-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        firebaseUid: user.uid
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.found && data.mindbodyClientId) {
        // Save to Firestore
        return firebase.firestore().collection('users').doc(user.uid).update({
          mindbodyClientId: data.mindbodyClientId,
          membershipTier: data.membershipTier || 'free',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function() {
          return data;
        });
      }
      return data;
    });
  }

  // Expose for use by firebase-auth.js
  window.syncMindbodyClient = syncMindbodyClient;

  // ============================================
  // CHECKOUT MODAL
  // ============================================

  var checkoutModal = document.getElementById('yb-checkout-modal');

  window.openYBCheckout = function(serviceId, serviceName, servicePrice) {
    if (!checkoutModal) return;

    // Populate service info
    var nameEl = checkoutModal.querySelector('#yb-checkout-service-name');
    var priceEl = checkoutModal.querySelector('#yb-checkout-service-price');
    var idEl = checkoutModal.querySelector('#yb-checkout-service-id');

    if (nameEl) nameEl.textContent = serviceName || '';
    if (priceEl) priceEl.textContent = servicePrice ? (servicePrice + ' DKK') : '';
    if (idEl) idEl.value = serviceId || '';

    // Pre-fill user info if logged in
    if (window.firebase && firebase.auth().currentUser) {
      var user = firebase.auth().currentUser;
      var emailField = checkoutModal.querySelector('#yb-checkout-email');
      var nameField = checkoutModal.querySelector('#yb-checkout-name');
      if (emailField && user.email) emailField.value = user.email;
      if (nameField && user.displayName) nameField.value = user.displayName;
    }

    // Reset state
    checkoutModal.querySelectorAll('.yb-auth-error').forEach(function(el) {
      el.hidden = true;
    });
    var successView = checkoutModal.querySelector('#yb-checkout-success');
    var formView = checkoutModal.querySelector('#yb-checkout-form-view');
    if (successView) successView.hidden = true;
    if (formView) formView.hidden = false;

    // Show modal
    checkoutModal.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  };

  window.closeYBCheckout = function() {
    if (!checkoutModal) return;
    checkoutModal.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  };

  // Close handlers for checkout
  document.addEventListener('click', function(e) {
    if (e.target.closest('[data-yb-checkout-close]')) {
      e.preventDefault();
      window.closeYBCheckout();
    }
    if (e.target.closest('[data-yb-checkout]')) {
      e.preventDefault();
      var btn = e.target.closest('[data-yb-checkout]');
      window.openYBCheckout(
        btn.getAttribute('data-yb-checkout'),
        btn.getAttribute('data-yb-checkout-name'),
        btn.getAttribute('data-yb-checkout-price')
      );
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && checkoutModal && checkoutModal.getAttribute('aria-hidden') === 'false') {
      window.closeYBCheckout();
    }
  });

  // Checkout form submission
  var checkoutForm = document.getElementById('yb-checkout-form');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', function(e) {
      e.preventDefault();
      processCheckout();
    });
  }

  function processCheckout() {
    var errorEl = document.getElementById('yb-checkout-error');
    var submitBtn = checkoutForm.querySelector('button[type="submit"]');
    var serviceId = document.getElementById('yb-checkout-service-id').value;
    var name = document.getElementById('yb-checkout-name').value.trim();
    var email = document.getElementById('yb-checkout-email').value.trim();
    var phone = document.getElementById('yb-checkout-phone').value.trim();
    var cardNumber = document.getElementById('yb-checkout-card').value.replace(/\s/g, '');
    var expiry = document.getElementById('yb-checkout-expiry').value.trim();
    var cvv = document.getElementById('yb-checkout-cvv').value.trim();

    if (errorEl) errorEl.hidden = true;

    // Validation
    if (!name || !email || !cardNumber || !expiry || !cvv) {
      showCheckoutError(locale === 'da' ? 'Udfyld alle obligatoriske felter.' : 'Please fill in all required fields.');
      return;
    }

    // Parse expiry (MM/YY or MM/YYYY)
    var expiryParts = expiry.split('/');
    if (expiryParts.length !== 2) {
      showCheckoutError(locale === 'da' ? 'Ugyldig udløbsdato (MM/ÅÅ).' : 'Invalid expiry date (MM/YY).');
      return;
    }
    var expMonth = expiryParts[0].trim();
    var expYear = expiryParts[1].trim();
    if (expYear.length === 2) expYear = '20' + expYear;

    submitBtn.disabled = true;
    submitBtn.textContent = locale === 'da' ? 'Behandler betaling...' : 'Processing payment...';

    // Step 1: Find or create Mindbody client
    var nameParts = name.split(' ');
    var firstName = nameParts[0] || name;
    var lastName = nameParts.slice(1).join(' ') || '';

    findOrCreateClient(firstName, lastName, email, phone)
      .then(function(clientId) {
        // Step 2: Process checkout
        return fetch(API_BASE + '/mb-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientId,
            items: [{ type: 'Service', id: parseInt(serviceId), quantity: 1 }],
            payment: {
              cardNumber: cardNumber,
              expMonth: expMonth,
              expYear: expYear,
              cvv: cvv,
              cardHolder: name
            },
            test: false
          })
        });
      })
      .then(function(res) { return res.json(); })
      .then(function(result) {
        if (result.error) {
          throw new Error(result.error);
        }

        if (result.requiresSCA) {
          // Handle SCA redirect
          window.location.href = result.authenticationUrl;
          return;
        }

        // Show success
        var formView = document.getElementById('yb-checkout-form-view');
        var successView = document.getElementById('yb-checkout-success');
        if (formView) formView.hidden = true;
        if (successView) successView.hidden = false;

        submitBtn.disabled = false;
        submitBtn.textContent = locale === 'da' ? 'Betal' : 'Pay';
      })
      .catch(function(err) {
        showCheckoutError(err.message || (locale === 'da' ? 'Betaling fejlede.' : 'Payment failed.'));
        submitBtn.disabled = false;
        submitBtn.textContent = locale === 'da' ? 'Betal' : 'Pay';
      });
  }

  function findOrCreateClient(firstName, lastName, email, phone) {
    // First try to find existing client
    return fetch(API_BASE + '/mb-client?email=' + encodeURIComponent(email))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.found && data.client) {
          return data.client.id;
        }

        // Create new client
        return fetch(API_BASE + '/mb-client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: firstName,
            lastName: lastName || firstName,
            email: email,
            phone: phone || ''
          })
        })
        .then(function(res) { return res.json(); })
        .then(function(createData) {
          if (createData.client) {
            return createData.client.id;
          }
          throw new Error(locale === 'da'
            ? 'Kunne ikke oprette kundekonto.'
            : 'Could not create client account.');
        });
      });
  }

  function showCheckoutError(msg) {
    var el = document.getElementById('yb-checkout-error');
    if (el) {
      el.textContent = msg;
      el.hidden = false;
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  function formatDate(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function formatTime(d) {
    return String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  console.log('✅ Mindbody integration initialized');
})();
