/**
 * YOGA BIBLE - JOURNAL FUNCTIONALITY
 * Handles bilingual content toggle, search, filtering, progress bar, and sharing
 * Language is determined by the global site language switcher (hostname-based)
 */

(function() {
  'use strict';

  // ============================================
  // LANGUAGE DETECTION (from global switcher)
  // ============================================

  var pathname = window.location.pathname || "/";
  var currentLang = (pathname.indexOf('/en/') === 0 || pathname === '/en') ? 'en' : 'da';

  // ============================================
  // BILINGUAL CONTENT TOGGLE
  // ============================================

  function applyLanguage() {
    var daEls = document.querySelectorAll('[data-yj-da]');
    var enEls = document.querySelectorAll('[data-yj-en]');

    for (var i = 0; i < daEls.length; i++) {
      daEls[i].hidden = currentLang !== 'da';
    }
    for (var i = 0; i < enEls.length; i++) {
      enEls[i].hidden = currentLang !== 'en';
    }

    // Update search placeholder
    var searchInput = document.getElementById('yjSearch');
    if (searchInput) {
      searchInput.placeholder = currentLang === 'da'
        ? (searchInput.getAttribute('data-yj-placeholder-da') || 'Søg...')
        : (searchInput.getAttribute('data-yj-placeholder-en') || 'Search...');
    }

    updateResultsCount();
  }

  applyLanguage();

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

      var matchesFilter = activeFilter === 'all' || category === activeFilter;

      var matchesSearch = true;
      if (searchQuery) {
        var q = normalizeText(searchQuery);
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

    if (emptyState) {
      emptyState.hidden = visibleCount > 0;
    }

    updateResultsCount(visibleCount);
  }

  function updateResultsCount(count) {
    var countEl = document.getElementById('yjResultsCount');
    if (!countEl) return;

    if (typeof count === 'undefined') {
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

  for (var i = 0; i < filterBtns.length; i++) {
    filterBtns[i].addEventListener('click', function() {
      for (var j = 0; j < filterBtns.length; j++) {
        filterBtns[j].classList.remove('is-active');
      }
      this.classList.add('is-active');
      activeFilter = this.getAttribute('data-yj-filter');
      filterAndSearch();
    });
  }

  if (grid) {
    filterAndSearch();
  }

  // ============================================
  // AUTO TABLE OF CONTENTS (Post Page Only)
  // ============================================

  function buildTOC() {
    var postBodies = document.querySelectorAll('.yj-post-body');
    if (!postBodies.length) return;

    for (var b = 0; b < postBodies.length; b++) {
      var body = postBodies[b];
      var h2s = body.querySelectorAll('h2');
      if (h2s.length < 3) continue; // only show TOC for posts with 3+ sections

      // Add IDs to headings
      for (var i = 0; i < h2s.length; i++) {
        if (!h2s[i].id) {
          h2s[i].id = 'section-' + (b > 0 ? 'en-' : '') + (i + 1);
        }
      }

      // Build TOC element
      var toc = document.createElement('nav');
      toc.className = 'yj-toc';
      toc.setAttribute('aria-label', 'Table of contents');

      var title = document.createElement('div');
      title.className = 'yj-toc__title';
      title.textContent = currentLang === 'da' ? 'Indhold' : 'Contents';
      toc.appendChild(title);

      var list = document.createElement('ol');
      list.className = 'yj-toc__list';

      for (var i = 0; i < h2s.length; i++) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '#' + h2s[i].id;
        a.textContent = h2s[i].textContent;
        li.appendChild(a);
        list.appendChild(li);
      }

      toc.appendChild(list);

      // Insert after first paragraph
      var firstP = body.querySelector('p');
      if (firstP && firstP.nextSibling) {
        body.insertBefore(toc, firstP.nextSibling);
      } else {
        body.insertBefore(toc, body.firstChild);
      }

      // Smooth scroll for TOC links
      var tocLinks = toc.querySelectorAll('a');
      for (var i = 0; i < tocLinks.length; i++) {
        tocLinks[i].addEventListener('click', function(e) {
          e.preventDefault();
          var target = document.querySelector(this.getAttribute('href'));
          if (target) {
            var top = target.getBoundingClientRect().top + window.pageYOffset - 80;
            window.scrollTo({ top: top, behavior: 'smooth' });
          }
        });
      }

      // Scroll spy — highlight active section
      if (h2s.length > 0 && tocLinks.length > 0) {
        (function(headings, links) {
          var spyTicking = false;
          window.addEventListener('scroll', function() {
            if (!spyTicking) {
              requestAnimationFrame(function() {
                var scrollPos = window.pageYOffset + 120;
                var activeIdx = 0;
                for (var j = 0; j < headings.length; j++) {
                  if (headings[j].getBoundingClientRect().top + window.pageYOffset <= scrollPos) {
                    activeIdx = j;
                  }
                }
                for (var j = 0; j < links.length; j++) {
                  links[j].classList.toggle('yj-toc--active', j === activeIdx);
                }
                spyTicking = false;
              });
              spyTicking = true;
            }
          }, { passive: true });
        })(h2s, tocLinks);
      }
    }
  }

  buildTOC();

  // ============================================
  // RESPONSIVE TABLE WRAPPING (Post Page Only)
  // ============================================

  var postTables = document.querySelectorAll('.yj-post-body table');
  for (var t = 0; t < postTables.length; t++) {
    var table = postTables[t];
    if (!table.parentElement.classList.contains('yj-table-wrap')) {
      var wrap = document.createElement('div');
      wrap.className = 'yj-table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
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
