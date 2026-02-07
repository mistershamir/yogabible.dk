/**
 * YOGA BIBLE - JOURNAL FUNCTIONALITY
 * Handles language switching, search, filtering, progress bar, and sharing
 */

(function() {
  'use strict';

  // ============================================
  // LANGUAGE DETECTION & STATE
  // ============================================

  var STORAGE_KEY = 'yb-journal-lang';
  var pathname = window.location.pathname || "/";
  var isENPath = pathname.indexOf('/en/') === 0 || pathname === '/en';

  // Priority: localStorage > URL path > default (da)
  var stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch(e) {}
  var currentLang = stored || (isENPath ? 'en' : 'da');

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

  var cards = grid ? grid.querySelectorAll('.yj-card') : [];
  var activeFilter = 'all';
  var searchQuery = '';

  function normalizeText(str) {
    return (str || '').toLowerCase()
      .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
      .replace(/[^\w\s]/g, '');
  }

  function filterAndSearch() {
    if (!grid) return;
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

  // Initial count (listing page only)
  if (grid) {
    filterAndSearch();
  }

  // ============================================
  // READING PROGRESS BAR (Post Page Only)
  // ============================================

  var progressBar = document.getElementById('yjProgressBar');
  var postContent = document.querySelector('.yj-post-content');

  if (progressBar && postContent) {
    var ticking = false;

    function updateProgress() {
      var contentRect = postContent.getBoundingClientRect();
      var contentTop = contentRect.top + window.pageYOffset;
      var contentHeight = postContent.offsetHeight;
      var windowHeight = window.innerHeight;
      var scrolled = window.pageYOffset;

      // Calculate progress: 0 at top of content, 100 at bottom
      var start = contentTop - windowHeight * 0.3;
      var end = contentTop + contentHeight - windowHeight * 0.5;
      var progress = Math.min(Math.max((scrolled - start) / (end - start), 0), 1);

      progressBar.style.width = (progress * 100) + '%';
      ticking = false;
    }

    window.addEventListener('scroll', function() {
      if (!ticking) {
        requestAnimationFrame(updateProgress);
        ticking = true;
      }
    }, { passive: true });

    updateProgress();
  }

  // ============================================
  // SHARE BUTTONS (Post Page Only)
  // ============================================

  var copyBtn = document.querySelector('[data-yj-share="copy"]');
  if (copyBtn) {
    copyBtn.addEventListener('click', function() {
      var url = window.location.href;
      var btn = this;

      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function() {
          showCopyFeedback(btn);
        });
      } else {
        // Fallback for older browsers
        var input = document.createElement('input');
        input.value = url;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showCopyFeedback(btn);
      }
    });
  }

  function showCopyFeedback(btn) {
    var originalHTML = btn.innerHTML;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    btn.style.borderColor = 'var(--yb-brand)';
    btn.style.color = 'var(--yb-brand)';

    setTimeout(function() {
      btn.innerHTML = originalHTML;
      btn.style.borderColor = '';
      btn.style.color = '';
    }, 1500);
  }

  console.log('Yoga Journal initialized (Language: ' + currentLang.toUpperCase() + ')');
})();
