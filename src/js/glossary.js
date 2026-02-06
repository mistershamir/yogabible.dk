/**
 * Yoga Bible — Glossary
 * Reads from window.YB_GLOSSARY_DATA (injected at build time from JSON data files).
 * Handles search, category filtering, alphabet navigation, and pagination.
 */
(function () {
  'use strict';

  /* ── Data ── */
  var data = window.YB_GLOSSARY_DATA || { terms: [], categories: [] };
  var TERMS = data.terms;
  var CATEGORIES = data.categories;
  var PER_PAGE = 20;
  var visible = PER_PAGE;
  var activeFilter = 'all';
  var searchQuery = '';
  var debounceTimer = null;

  /* ── Category label map ── */
  var categoryLabels = {};
  CATEGORIES.forEach(function (c) {
    categoryLabels[c.id] = c.name_da;
  });

  /* ── DOM refs ── */
  var resultsEl = document.getElementById('ybGlossaryResults');
  var moreBtn = document.getElementById('ybGlossaryMore');
  var searchInput = document.getElementById('ybGlossarySearch');
  var filterBtns = document.querySelectorAll('.yb-glossary__filter-btn');
  var countEl = document.getElementById('ybGlossaryCount');
  var alphaEl = document.getElementById('ybGlossaryAlpha');

  /* ── Filter logic ── */
  function filtered() {
    return TERMS.filter(function (t) {
      if (activeFilter !== 'all' && t.category !== activeFilter) return false;
      if (!searchQuery) return true;
      var q = searchQuery.toLowerCase();
      return (
        t.sanskrit.toLowerCase().indexOf(q) !== -1 ||
        t.en.toLowerCase().indexOf(q) !== -1 ||
        t.da.toLowerCase().indexOf(q) !== -1 ||
        t.desc_da.toLowerCase().indexOf(q) !== -1 ||
        t.desc_en.toLowerCase().indexOf(q) !== -1
      );
    });
  }

  /* ── Escape HTML to prevent XSS ── */
  function esc(str) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  /* ── Highlight search matches ── */
  function highlight(text, query) {
    if (!query) return esc(text);
    var escaped = esc(text);
    var qEsc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(
      new RegExp('(' + qEsc + ')', 'gi'),
      '<mark>$1</mark>'
    );
  }

  /* ── Build alphabet nav ── */
  function buildAlphaNav(items) {
    var letters = {};
    items.forEach(function (t) {
      var first = t.sanskrit.charAt(0).toUpperCase();
      letters[first] = true;
    });
    var sorted = Object.keys(letters).sort();
    var html = '';
    sorted.forEach(function (letter) {
      html +=
        '<button class="yb-glossary__alpha-btn" type="button" data-letter="' +
        letter +
        '">' +
        letter +
        '</button>';
    });
    alphaEl.innerHTML = html;

    alphaEl.querySelectorAll('.yb-glossary__alpha-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var letter = this.getAttribute('data-letter');
        var target = document.querySelector(
          '[data-glossary-letter="' + letter + '"]'
        );
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  /* ── Render ── */
  function render() {
    var items = filtered();
    var show = items.slice(0, visible);

    /* Count */
    countEl.textContent =
      items.length +
      (items.length === 1 ? ' begreb fundet' : ' begreber fundet');

    /* Alpha nav */
    buildAlphaNav(items);

    /* Empty state */
    if (show.length === 0) {
      resultsEl.innerHTML =
        '<p class="yb-glossary__empty">Ingen termer matcher din søgning. Prøv et andet ord, bogstav eller filter.</p>';
      moreBtn.style.display = 'none';
      return;
    }

    /* Build HTML */
    var html = '';
    var lastLetter = '';
    var q = searchQuery ? searchQuery.toLowerCase() : '';

    show.forEach(function (t) {
      var first = t.sanskrit.charAt(0).toUpperCase();
      var letterAttr = '';
      if (first !== lastLetter) {
        letterAttr = ' data-glossary-letter="' + first + '"';
        html +=
          '<div class="yb-glossary__letter-heading"' +
          letterAttr +
          ' role="presentation">' +
          first +
          '</div>';
        lastLetter = first;
      }

      var catLabel = categoryLabels[t.category] || t.category;

      html +=
        '<article class="yb-glossary__entry" role="listitem">' +
        '<div class="yb-glossary__entry-header">' +
        '<h3 class="yb-glossary__term">' +
        highlight(t.sanskrit, q) +
        '</h3>' +
        '<span class="yb-glossary__cat">' +
        esc(catLabel) +
        '</span>' +
        '</div>' +
        '<div class="yb-glossary__translations">' +
        '<span class="yb-glossary__en" title="English">' +
        highlight(t.en, q) +
        '</span>' +
        '<span class="yb-glossary__da" title="Dansk">' +
        highlight(t.da, q) +
        '</span>' +
        '</div>' +
        '<p class="yb-glossary__desc">' +
        highlight(t.desc_da, q) +
        '</p>' +
        '<p class="yb-glossary__desc yb-glossary__desc--en">' +
        highlight(t.desc_en, q) +
        '</p>' +
        '</article>';
    });

    resultsEl.innerHTML = html;
    moreBtn.style.display = show.length < items.length ? 'block' : 'none';
  }

  /* ── Search with debounce ── */
  searchInput.addEventListener('input', function () {
    var val = this.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      searchQuery = val;
      visible = PER_PAGE;
      render();
      updateHash();
    }, 180);
  });

  /* ── Category filter ── */
  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) {
        b.classList.remove('active');
      });
      this.classList.add('active');
      activeFilter = this.getAttribute('data-filter');
      visible = PER_PAGE;
      render();
      updateHash();
    });
  });

  /* ── Load more ── */
  moreBtn.addEventListener('click', function () {
    visible += PER_PAGE;
    render();
  });

  /* ── URL hash state ── */
  function updateHash() {
    var parts = [];
    if (activeFilter !== 'all') parts.push('cat=' + activeFilter);
    if (searchQuery) parts.push('q=' + encodeURIComponent(searchQuery));
    var hash = parts.length ? '#' + parts.join('&') : '';
    if (history.replaceState) {
      history.replaceState(null, '', window.location.pathname + hash);
    }
  }

  function readHash() {
    var hash = window.location.hash.replace('#', '');
    if (!hash) return;
    hash.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0] === 'cat' && kv[1]) {
        activeFilter = kv[1];
        filterBtns.forEach(function (b) {
          b.classList.toggle(
            'active',
            b.getAttribute('data-filter') === activeFilter
          );
        });
      }
      if (kv[0] === 'q' && kv[1]) {
        searchQuery = decodeURIComponent(kv[1]);
        searchInput.value = searchQuery;
      }
    });
  }

  /* ── Init ── */
  readHash();
  render();
})();
