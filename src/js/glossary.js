/**
 * Yoga Bible — Glossary
 * Reads from window.YB_GLOSSARY_DATA (injected at build time from JSON data files).
 * Handles search, category filtering, alphabet navigation, pagination,
 * and rich card rendering (pronunciation, level, alignment, modifications).
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

  /* ── Level labels ── */
  var levelLabels = {
    beginner: 'Begynder',
    intermediate: 'Mellem',
    advanced: 'Avanceret'
  };

  /* ── Position labels ── */
  var positionLabels = {
    standing: 'Stående',
    seated: 'Siddende',
    kneeling: 'Knælende',
    supine: 'Rygleje',
    prone: 'Maveleje',
    'all-fours': 'Alle fire',
    'arm-balance': 'Armbalance',
    inversion: 'Omvendt'
  };

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
      var fields = [t.sanskrit, t.en, t.da, t.desc_da, t.desc_en];
      if (t.tags) fields = fields.concat(t.tags);
      if (t.pronunciation) fields.push(t.pronunciation);
      for (var i = 0; i < fields.length; i++) {
        if (fields[i] && fields[i].toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    });
  }

  /* ── Escape HTML ── */
  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  /* ── Highlight search matches ── */
  function highlight(text, query) {
    if (!text) return '';
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
        letter + '">' + letter + '</button>';
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

  /* ── Build meta badges row (level, position, body areas) ── */
  function buildMeta(t) {
    var parts = [];
    if (t.level) {
      var lvl = levelLabels[t.level] || t.level;
      var cls = 'yb-glossary__level yb-glossary__level--' + t.level;
      parts.push('<span class="' + cls + '">' + esc(lvl) + '</span>');
    }
    if (t.position) {
      var pos = positionLabels[t.position] || t.position;
      parts.push('<span class="yb-glossary__position">' + esc(pos) + '</span>');
    }
    if (t.body_areas && t.body_areas.length) {
      t.body_areas.forEach(function (area) {
        parts.push('<span class="yb-glossary__body-area">' + esc(area) + '</span>');
      });
    }
    if (t.props && t.props.length) {
      t.props.forEach(function (prop) {
        parts.push('<span class="yb-glossary__prop">' + esc(prop) + '</span>');
      });
    }
    if (!parts.length) return '';
    return '<div class="yb-glossary__meta">' + parts.join('') + '</div>';
  }

  /* ── Build expandable detail section ── */
  function buildDetail(id, labelDa, textDa, textEn) {
    if (!textDa && !textEn) return '';
    return (
      '<details class="yb-glossary__detail">' +
      '<summary class="yb-glossary__detail-toggle">' + esc(labelDa) + '</summary>' +
      '<div class="yb-glossary__detail-body">' +
      (textDa ? '<p class="yb-glossary__desc">' + esc(textDa) + '</p>' : '') +
      (textEn ? '<p class="yb-glossary__desc yb-glossary__desc--en">' + esc(textEn) + '</p>' : '') +
      '</div></details>'
    );
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
      if (first !== lastLetter) {
        html +=
          '<div class="yb-glossary__letter-heading" data-glossary-letter="' +
          first + '" role="presentation">' + first + '</div>';
        lastLetter = first;
      }

      var catLabel = categoryLabels[t.category] || t.category;
      var pron = t.pronunciation
        ? '<span class="yb-glossary__pron">' + esc(t.pronunciation) + '</span>'
        : '';

      html +=
        '<article class="yb-glossary__entry" role="listitem">' +

        /* Header: term + category */
        '<div class="yb-glossary__entry-header">' +
        '<h3 class="yb-glossary__term">' + highlight(t.sanskrit, q) + pron + '</h3>' +
        '<span class="yb-glossary__cat">' + esc(catLabel) + '</span>' +
        '</div>' +

        /* Translations */
        '<div class="yb-glossary__translations">' +
        '<span class="yb-glossary__en" title="English">' + highlight(t.en, q) + '</span>' +
        '<span class="yb-glossary__da" title="Dansk">' + highlight(t.da, q) + '</span>' +
        '</div>' +

        /* Meta badges (level, position, body areas) */
        buildMeta(t) +

        /* Description */
        '<p class="yb-glossary__desc">' + highlight(t.desc_da, q) + '</p>' +
        '<p class="yb-glossary__desc yb-glossary__desc--en">' + highlight(t.desc_en, q) + '</p>' +

        /* Expandable details (only if data present) */
        buildDetail('align', 'Alignment cues', t.alignment_da, t.alignment_en) +
        buildDetail('contra', 'Kontraindikationer', t.contraindications_da, t.contraindications_en) +
        buildDetail('mods', 'Modifikationer & variationer', t.modifications_da, t.modifications_en) +

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
