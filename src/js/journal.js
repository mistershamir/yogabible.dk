/**
 * YOGA BIBLE - JOURNAL FUNCTIONALITY
 * Handles language switching, search, filtering, and related journals
 */

(function() {
  'use strict';

  // ============================================
  // LANGUAGE DETECTION & STATE
  // ============================================

  var STORAGE_KEY = 'yb-journal-lang';
  var host = window.location.hostname.toLowerCase();
  var isENHost = host.indexOf('en.') === 0;

  // Priority: localStorage > hostname > default (da)
  var stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch(e) {}
  var currentLang = stored || (isENHost ? 'en' : 'da');

  // ============================================
  // LANGUAGE SWITCHING
  // ============================================

  function applyLanguage(lang) {
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch(e) {}

    // Toggle visibility of all data-yj-da and data-yj-en elements
    var daEls = document.querySelectorAll('[data-yj-da]');
    var enEls = document.querySelectorAll('[data-yj-en]');

    for (var i = 0; i < daEls.length; i++) {
      daEls[i].hidden = lang !== 'da';
    }
    for (var i = 0; i < enEls.length; i++) {
      enEls[i].hidden = lang !== 'en';
    }

    // Update active state on language buttons
    var langBtns = document.querySelectorAll('[data-yj-lang]');
    for (var i = 0; i < langBtns.length; i++) {
      var btn = langBtns[i];
      if (btn.getAttribute('data-yj-lang') === lang) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    }

    // Update search placeholder
    var searchInput = document.getElementById('yjSearch');
    if (searchInput) {
      searchInput.placeholder = lang === 'da'
        ? (searchInput.getAttribute('data-yj-placeholder-da') || 'Søg...')
        : (searchInput.getAttribute('data-yj-placeholder-en') || 'Search...');
    }

    // Update results count
    updateResultsCount();
  }

  // Bind language toggle buttons
  var langBtns = document.querySelectorAll('[data-yj-lang]');
  for (var i = 0; i < langBtns.length; i++) {
    langBtns[i].addEventListener('click', function() {
      applyLanguage(this.getAttribute('data-yj-lang'));
    });
  }

  // Apply initial language
  applyLanguage(currentLang);

  // ============================================
  // SEARCH & FILTERING (Listing Page Only)
  // ============================================

  var searchInput = document.getElementById('yjSearch');
  var grid = document.getElementById('yjGrid');
  var emptyState = document.getElementById('yjEmpty');
  var filterBtns = document.querySelectorAll('[data-yj-filter]');

  if (!grid) return; // Exit if not on listing page

  var cards = grid.querySelectorAll('.yj-card');
  var activeFilter = 'all';
  var searchQuery = '';

  function normalizeText(str) {
    return (str || '').toLowerCase()
      .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
      .replace(/[^\w\s]/g, '');
  }

  function filterAndSearch() {
    var visibleCount = 0;

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var category = card.getAttribute('data-yj-category') || '';
      var tags = card.getAttribute('data-yj-tags') || '';

      // Category filter
      var matchesFilter = activeFilter === 'all' || category === activeFilter;

      // Search query
      var matchesSearch = true;
      if (searchQuery) {
        var q = normalizeText(searchQuery);
        // Get all text content from the card for search
        var titleDa = card.querySelector('.yj-card__title [data-yj-da]');
        var titleEn = card.querySelector('.yj-card__title [data-yj-en]');
        var excerptDa = card.querySelector('.yj-card__excerpt [data-yj-da]');
        var excerptEn = card.querySelector('.yj-card__excerpt [data-yj-en]');

        var searchableText = normalizeText(
          (titleDa ? titleDa.textContent : '') + ' ' +
          (titleEn ? titleEn.textContent : '') + ' ' +
          (excerptDa ? excerptDa.textContent : '') + ' ' +
          (excerptEn ? excerptEn.textContent : '') + ' ' +
          tags + ' ' + category
        );

        matchesSearch = searchableText.indexOf(q) !== -1;
      }

      var visible = matchesFilter && matchesSearch;
      card.style.display = visible ? '' : 'none';
      if (visible) visibleCount++;
    }

    // Show/hide empty state
    if (emptyState) {
      emptyState.hidden = visibleCount > 0;
    }

    updateResultsCount(visibleCount);
  }

  function updateResultsCount(count) {
    var countEl = document.getElementById('yjResultsCount');
    if (!countEl) return;

    if (typeof count === 'undefined') {
      // Count visible cards
      count = 0;
      if (cards) {
        for (var i = 0; i < cards.length; i++) {
          if (cards[i].style.display !== 'none') count++;
        }
      }
    }

    if (currentLang === 'da') {
      countEl.textContent = count + (count === 1 ? ' artikel' : ' artikler');
    } else {
      countEl.textContent = count + (count === 1 ? ' article' : ' articles');
    }
  }

  // Search input handler with debounce
  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function() {
        searchQuery = searchInput.value.trim();
        filterAndSearch();
      }, 200);
    });
  }

  // Filter button handlers
  for (var i = 0; i < filterBtns.length; i++) {
    filterBtns[i].addEventListener('click', function() {
      // Update active state
      for (var j = 0; j < filterBtns.length; j++) {
        filterBtns[j].classList.remove('is-active');
      }
      this.classList.add('is-active');

      activeFilter = this.getAttribute('data-yj-filter');
      filterAndSearch();
    });
  }

  // Initial count
  filterAndSearch();

  console.log('Yoga Journal initialized (Language: ' + currentLang.toUpperCase() + ')');
})();
