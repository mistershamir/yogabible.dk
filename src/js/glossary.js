/**
 * Yoga Bible — Glossary v2
 * Grid card layout, scope toggle, dynamic sub-filters, A-Z nav.
 */
(function () {
  'use strict';

  /* ── Data ── */
  var data = window.YB_GLOSSARY_DATA || { terms: [], categories: [] };
  var TERMS = data.terms;
  var CATEGORIES = data.categories;
  var PER_PAGE = 36;
  var visible = PER_PAGE;
  var activeFilter = 'all';
  var activeScope = 'common';
  var activeSubFilters = {};
  var searchQuery = '';
  var debounceTimer = null;

  /* ── Common asanas (curated for "Mest brugte" scope) ── */
  var COMMON_ASANAS = {
    'Adho Mukha Svanasana': 1, 'Anjaneyasana': 1, 'Ardha Chandrasana': 1,
    'Ardha Matsyendrasana': 1, 'Baddha Konasana': 1, 'Bakasana': 1,
    'Balasana': 1, 'Bhujangasana': 1, 'Chaturanga Dandasana': 1,
    'Dandasana': 1, 'Dhanurasana': 1, 'Eka Pada Rajakapotasana': 1,
    'Garudasana': 1, 'Gomukhasana': 1, 'Halasana': 1, 'Malasana': 1,
    'Marjaryasana\u2013Bitilasana': 1, 'Matsyasana': 1, 'Natarajasana': 1,
    'Navasana': 1, 'Padmasana': 1, 'Paschimottanasana': 1,
    'Phalakasana': 1, 'Prasarita Padottanasana': 1,
    'Salamba Sarvangasana': 1, 'Savasana': 1,
    'Setu Bandha Sarvangasana': 1, 'Sirsasana': 1, 'Sukhasana': 1,
    'Tadasana': 1, 'Trikonasana': 1, 'Urdhva Dhanurasana': 1,
    'Urdhva Mukha Svanasana': 1, 'Ustrasana': 1, 'Utkatasana': 1,
    'Uttanasana': 1, 'Utthita Parsvakonasana': 1, 'Vasisthasana': 1,
    'Viparita Karani': 1, 'Virabhadrasana I': 1, 'Virabhadrasana II': 1,
    'Virabhadrasana III': 1, 'Vrksasana': 1
  };

  /* For non-asana categories all terms are common/foundational */
  function isCommon(t) {
    if (t.category !== 'asana') return true;
    return !!COMMON_ASANAS[t.sanskrit];
  }

  /* ── Label maps ── */
  var categoryLabels = {};
  CATEGORIES.forEach(function (c) { categoryLabels[c.id] = c.name_da; });

  var levelLabels = {
    beginner: 'Begynder', intermediate: 'Mellem', advanced: 'Avanceret'
  };

  var positionLabels = {
    standing: 'Stående', seated: 'Siddende', kneeling: 'Knælende',
    supine: 'Rygleje', prone: 'Maveleje', 'all-fours': 'Alle fire',
    'arm-balance': 'Armbalance', inversion: 'Omvendt'
  };

  var styleLabels = {
    hatha: 'Hatha', vinyasa: 'Vinyasa', ashtanga: 'Ashtanga',
    iyengar: 'Iyengar', power: 'Power', hot: 'Hot', bikram: 'Bikram',
    yin: 'Yin', restorative: 'Restorative', kundalini: 'Kundalini'
  };

  /* ── Sub-filter definitions per category ── */
  var SUB_FILTER_DEFS = {
    asana: [
      { key: 'level', label: 'Niveau', labelMap: levelLabels },
      { key: 'position', label: 'Position', labelMap: positionLabels },
      { key: 'yoga_styles', label: 'Yogastil', labelMap: styleLabels, isArray: true }
    ]
  };

  /* ── DOM refs ── */
  var resultsEl = document.getElementById('ybGlossaryResults');
  var moreBtn = document.getElementById('ybGlossaryMore');
  var searchInput = document.getElementById('ybGlossarySearch');
  var filterBtns = document.querySelectorAll('.yb-glossary__filter-btn');
  var countEl = document.getElementById('ybGlossaryCount');
  var alphaEl = document.getElementById('ybGlossaryAlpha');
  var subFiltersEl = document.getElementById('ybGlossarySubFilters');
  var scopeBtns = document.querySelectorAll('.yb-glossary__scope-btn');

  /* ── Helpers ── */
  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  function highlight(text, query) {
    if (!text) return '';
    if (!query) return esc(text);
    var escaped = esc(text);
    var qEsc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp('(' + qEsc + ')', 'gi'), '<mark>$1</mark>');
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  /* ── Collect unique values from terms ── */
  function collectValues(terms, key) {
    var vals = {};
    terms.forEach(function (t) { if (t[key]) vals[t[key]] = true; });
    return Object.keys(vals).sort();
  }

  function collectArrayValues(terms, key) {
    var vals = {};
    terms.forEach(function (t) {
      if (t[key] && Array.isArray(t[key])) {
        t[key].forEach(function (v) { vals[v] = true; });
      }
    });
    return Object.keys(vals).sort();
  }

  /* ── Build sub-filter chips ── */
  function buildSubFilters() {
    var defs = SUB_FILTER_DEFS[activeFilter];
    if (!defs) {
      subFiltersEl.hidden = true;
      subFiltersEl.innerHTML = '';
      activeSubFilters = {};
      return;
    }

    var catTerms = TERMS.filter(function (t) { return t.category === activeFilter; });
    var html = '';

    defs.forEach(function (def) {
      var values = def.isArray
        ? collectArrayValues(catTerms, def.key)
        : collectValues(catTerms, def.key);
      if (!values.length) return;

      html += '<div class="yb-glossary__subfilter-group">';
      html += '<span class="yb-glossary__subfilter-label">' + esc(def.label) + '</span>';
      html += '<button class="yb-glossary__subfilter-chip active" data-subkey="' + def.key + '" data-subval="all" type="button">Alle</button>';

      values.forEach(function (val) {
        var display = (def.labelMap && def.labelMap[val]) ? def.labelMap[val] : capitalize(val);
        html += '<button class="yb-glossary__subfilter-chip" data-subkey="' + def.key + '" data-subval="' + esc(val) + '" type="button">' + esc(display) + '</button>';
      });
      html += '</div>';
    });

    subFiltersEl.innerHTML = html;
    subFiltersEl.hidden = !html;
    activeSubFilters = {};

    subFiltersEl.querySelectorAll('.yb-glossary__subfilter-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = this.getAttribute('data-subkey');
        var val = this.getAttribute('data-subval');
        var group = this.parentNode;
        group.querySelectorAll('.yb-glossary__subfilter-chip').forEach(function (b) {
          b.classList.remove('active');
        });
        this.classList.add('active');

        if (val === 'all') {
          delete activeSubFilters[key];
        } else {
          activeSubFilters[key] = val;
        }
        visible = PER_PAGE;
        render();
      });
    });
  }

  /* ── Filter logic ── */
  function filtered() {
    return TERMS.filter(function (t) {
      if (activeScope === 'common' && !isCommon(t)) return false;
      if (activeFilter !== 'all' && t.category !== activeFilter) return false;

      for (var key in activeSubFilters) {
        var val = activeSubFilters[key];
        var def = null;
        var defs = SUB_FILTER_DEFS[activeFilter];
        if (defs) {
          for (var i = 0; i < defs.length; i++) {
            if (defs[i].key === key) { def = defs[i]; break; }
          }
        }
        if (def && def.isArray) {
          if (!t[key] || !Array.isArray(t[key]) || t[key].indexOf(val) === -1) return false;
        } else {
          if (t[key] !== val) return false;
        }
      }

      if (!searchQuery) return true;
      var q = searchQuery.toLowerCase();
      var fields = [t.sanskrit, t.en, t.da, t.desc_da, t.desc_en];
      if (t.tags) fields = fields.concat(t.tags);
      if (t.pronunciation) fields.push(t.pronunciation);
      for (var j = 0; j < fields.length; j++) {
        if (fields[j] && fields[j].toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    });
  }

  /* ── Build A-Z nav ── */
  function buildAlphaNav(items) {
    var letters = {};
    items.forEach(function (t) {
      letters[t.sanskrit.charAt(0).toUpperCase()] = true;
    });
    var sorted = Object.keys(letters).sort();
    var html = '';
    sorted.forEach(function (letter) {
      html += '<button class="yb-glossary__alpha-btn" type="button" data-letter="' + letter + '">' + letter + '</button>';
    });
    alphaEl.innerHTML = html;

    alphaEl.querySelectorAll('.yb-glossary__alpha-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var letter = this.getAttribute('data-letter');
        var target = document.querySelector('[data-glossary-letter="' + letter + '"]');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ── Build card HTML ── */
  function buildCard(t, q) {
    var catLabel = categoryLabels[t.category] || t.category;

    var pron = t.pronunciation
      ? '<span class="yb-glossary__pron">' + esc(t.pronunciation) + '</span>'
      : '';

    /* Meta badges */
    var metaParts = [];
    if (t.level) {
      var lvl = levelLabels[t.level] || t.level;
      metaParts.push('<span class="yb-glossary__level yb-glossary__level--' + t.level + '">' + esc(lvl) + '</span>');
    }
    if (t.position) {
      var pos = positionLabels[t.position] || capitalize(t.position);
      metaParts.push('<span class="yb-glossary__badge">' + esc(pos) + '</span>');
    }
    if (t.yoga_styles && t.yoga_styles.length) {
      t.yoga_styles.slice(0, 4).forEach(function (s) {
        var label = styleLabels[s] || capitalize(s);
        metaParts.push('<span class="yb-glossary__badge yb-glossary__badge--style">' + esc(label) + '</span>');
      });
      if (t.yoga_styles.length > 4) {
        metaParts.push('<span class="yb-glossary__badge yb-glossary__badge--more">+' + (t.yoga_styles.length - 4) + '</span>');
      }
    }
    if (t.props && t.props.length) {
      t.props.forEach(function (prop) {
        metaParts.push('<span class="yb-glossary__badge yb-glossary__badge--prop">' + esc(capitalize(prop)) + '</span>');
      });
    }
    var metaHtml = metaParts.length
      ? '<div class="yb-glossary__meta">' + metaParts.join('') + '</div>'
      : '';

    /* Expandable details */
    var detailsHtml = '';
    if (t.alignment_da || t.alignment_en) {
      detailsHtml += '<details class="yb-glossary__detail"><summary>Alignment</summary><div class="yb-glossary__detail-body">' +
        (t.alignment_da ? '<p>' + esc(t.alignment_da) + '</p>' : '') +
        (t.alignment_en ? '<p class="yb-glossary__desc--en">' + esc(t.alignment_en) + '</p>' : '') +
        '</div></details>';
    }
    if (t.contraindications_da || t.contraindications_en) {
      detailsHtml += '<details class="yb-glossary__detail"><summary>Kontraindikationer</summary><div class="yb-glossary__detail-body">' +
        (t.contraindications_da ? '<p>' + esc(t.contraindications_da) + '</p>' : '') +
        (t.contraindications_en ? '<p class="yb-glossary__desc--en">' + esc(t.contraindications_en) + '</p>' : '') +
        '</div></details>';
    }
    if (t.modifications_da || t.modifications_en) {
      detailsHtml += '<details class="yb-glossary__detail"><summary>Modifikationer</summary><div class="yb-glossary__detail-body">' +
        (t.modifications_da ? '<p>' + esc(t.modifications_da) + '</p>' : '') +
        (t.modifications_en ? '<p class="yb-glossary__desc--en">' + esc(t.modifications_en) + '</p>' : '') +
        '</div></details>';
    }

    return '<article class="yb-glossary__card">' +
      '<div class="yb-glossary__card-top">' +
        '<div class="yb-glossary__card-title">' +
          '<h3 class="yb-glossary__term">' + highlight(t.sanskrit, q) + '</h3>' +
          pron +
        '</div>' +
        '<span class="yb-glossary__cat">' + esc(catLabel) + '</span>' +
      '</div>' +
      '<div class="yb-glossary__translations">' +
        '<span class="yb-glossary__lang" title="English">' + highlight(t.en, q) + '</span>' +
        '<span class="yb-glossary__lang" title="Dansk">' + highlight(t.da, q) + '</span>' +
      '</div>' +
      metaHtml +
      '<p class="yb-glossary__desc">' + highlight(t.desc_da, q) + '</p>' +
      '<p class="yb-glossary__desc yb-glossary__desc--en">' + highlight(t.desc_en, q) + '</p>' +
      detailsHtml +
    '</article>';
  }

  /* ── Render ── */
  function render() {
    var items = filtered();
    var show = items.slice(0, visible);

    countEl.textContent = items.length + (items.length === 1 ? ' begreb fundet' : ' begreber fundet');
    buildAlphaNav(items);

    if (show.length === 0) {
      resultsEl.innerHTML = '<p class="yb-glossary__empty">Ingen termer matcher din søgning. Prøv et andet ord, bogstav eller filter.</p>';
      moreBtn.style.display = 'none';
      return;
    }

    var html = '';
    var lastLetter = '';
    var q = searchQuery ? searchQuery.toLowerCase() : '';

    show.forEach(function (t) {
      var first = t.sanskrit.charAt(0).toUpperCase();
      if (first !== lastLetter) {
        html += '<div class="yb-glossary__letter-heading" data-glossary-letter="' + first + '">' + first + '</div>';
        lastLetter = first;
      }
      html += buildCard(t, q);
    });

    resultsEl.innerHTML = html;
    moreBtn.style.display = show.length < items.length ? '' : 'none';
  }

  /* ── Scope toggle ── */
  scopeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      scopeBtns.forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      activeScope = this.getAttribute('data-scope');
      visible = PER_PAGE;
      render();
      updateHash();
    });
  });

  /* ── Search ── */
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
      filterBtns.forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      activeFilter = this.getAttribute('data-filter');
      activeSubFilters = {};
      visible = PER_PAGE;
      buildSubFilters();
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
    if (activeScope !== 'common') parts.push('scope=' + activeScope);
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
      if (kv[0] === 'scope' && kv[1]) {
        activeScope = kv[1];
        scopeBtns.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-scope') === activeScope);
        });
      }
      if (kv[0] === 'cat' && kv[1]) {
        activeFilter = kv[1];
        filterBtns.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-filter') === activeFilter);
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
  buildSubFilters();
  render();
})();
