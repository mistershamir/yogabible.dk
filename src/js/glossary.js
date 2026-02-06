/**
 * Yoga Bible — Glossary v3
 * 3-column grid, scope toggle, language switch, dynamic sub-filters, A-Z nav.
 */
(function () {
  'use strict';

  /* ── Data ── */
  var data = window.YB_GLOSSARY_DATA || { terms: [], categories: [] };
  var TERMS = data.terms;
  var CATEGORIES = data.categories;

  /* ── State ── */
  var PER_PAGE = 36;
  var visible = PER_PAGE;
  var activeFilter = 'all';
  var activeScope = 'common';
  var activeLang = 'da';
  var activeSubFilters = {};
  var searchQuery = '';
  var debounceTimer = null;

  /* ── Common asanas (curated for "Mest brugte" scope) ── */
  var COMMON_ASANAS = {
    'Adho Mukha Svanasana': 1, 'Anjaneyasana': 1, 'Ardha Chandrasana': 1,
    'Ardha Matsyendrasana': 1, 'Baddha Konasana': 1, 'Bakasana': 1,
    'Balasana': 1, 'Bhujangasana': 1, 'Bitilasana': 1,
    'Chaturanga Dandasana': 1, 'Dandasana': 1, 'Dhanurasana': 1,
    'Eka Pada Rajakapotasana': 1, 'Garudasana': 1, 'Gomukhasana': 1,
    'Halasana': 1, 'Malasana': 1, 'Marjaryasana': 1,
    'Marjaryasana\u2013Bitilasana': 1, 'Matsyasana': 1,
    'Natarajasana': 1, 'Navasana': 1, 'Padmasana': 1,
    'Paschimottanasana': 1, 'Phalakasana': 1, 'Prasarita Padottanasana': 1,
    'Salamba Sarvangasana': 1, 'Savasana': 1,
    'Setu Bandha Sarvangasana': 1, 'Sirsasana': 1, 'Sukhasana': 1,
    'Tadasana': 1, 'Trikonasana': 1, 'Urdhva Dhanurasana': 1,
    'Urdhva Mukha Svanasana': 1, 'Ustrasana': 1, 'Utkatasana': 1,
    'Uttanasana': 1, 'Utthita Parsvakonasana': 1, 'Vasisthasana': 1,
    'Viparita Karani': 1, 'Virabhadrasana I': 1, 'Virabhadrasana II': 1,
    'Virabhadrasana III': 1, 'Vrksasana': 1
  };

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

  /* ── Subcategory label maps per category ── */
  var anatomySubLabels = {
    'alignment-principles': 'Alignment principper',
    'joint-movement': 'Ledbevægelse',
    'body-systems': 'Kroppens systemer'
  };

  var breathingSubLabels = {
    technique: 'Teknik',
    concept: 'Koncept'
  };

  var meditationSubLabels = {
    limb: 'Yogas lemmer',
    technique: 'Teknik',
    tool: 'Redskab'
  };

  var philosophySubLabels = {
    yama: 'Yama',
    niyama: 'Niyama',
    text: 'Tekster',
    concept: 'Koncept'
  };

  var energySubLabels = {
    chakra: 'Chakra',
    nadi: 'Nadi',
    bandha: 'Bandha',
    mudra: 'Mudra',
    concept: 'Koncept'
  };

  var teachingSubLabels = {
    'class-structure': 'Klasseopbygning',
    instruction: 'Instruktion',
    adaptation: 'Tilpasning'
  };

  var stylesSubLabels = {
    physical: 'Fysisk stil',
    path: 'Yogavej'
  };

  var businessSubLabels = {
    certification: 'Certificering',
    'studio-training': 'Studio & uddannelse'
  };

  var equipmentSubLabels = {
    essential: 'Basis',
    support: 'Støtte & komfort'
  };

  /* ── Sub-filter definitions per category ── */
  var SUB_FILTER_DEFS = {
    asana: [
      { key: 'level', label: 'Niveau', labelMap: levelLabels },
      { key: 'position', label: 'Position', labelMap: positionLabels },
      { key: 'yoga_styles', label: 'Yogastil', labelMap: styleLabels, isArray: true }
    ],
    anatomy: [
      { key: 'subcategory', label: 'Underkategori', labelMap: anatomySubLabels }
    ],
    breathing: [
      { key: 'subcategory', label: 'Type', labelMap: breathingSubLabels }
    ],
    meditation: [
      { key: 'subcategory', label: 'Type', labelMap: meditationSubLabels }
    ],
    philosophy: [
      { key: 'subcategory', label: 'Tradition', labelMap: philosophySubLabels }
    ],
    energy: [
      { key: 'subcategory', label: 'System', labelMap: energySubLabels }
    ],
    teaching: [
      { key: 'subcategory', label: 'Område', labelMap: teachingSubLabels }
    ],
    styles: [
      { key: 'subcategory', label: 'Type', labelMap: stylesSubLabels }
    ],
    business: [
      { key: 'subcategory', label: 'Område', labelMap: businessSubLabels }
    ],
    equipment: [
      { key: 'subcategory', label: 'Type', labelMap: equipmentSubLabels }
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
  var langBtns = document.querySelectorAll('.yb-glossary__lang-btn');

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

  /* ── Collect unique values for sub-filters ── */
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

      html += '<div class="yb-glossary__subfilter-row">';
      html += '<span class="yb-glossary__subfilter-label">' + esc(def.label) + '</span>';
      html += '<div class="yb-glossary__subfilter-chips">';
      html += '<button class="yb-glossary__chip active" data-subkey="' + def.key + '" data-subval="all" type="button">Alle</button>';

      values.forEach(function (val) {
        var display = (def.labelMap && def.labelMap[val]) ? def.labelMap[val] : capitalize(val);
        html += '<button class="yb-glossary__chip" data-subkey="' + def.key + '" data-subval="' + esc(val) + '" type="button">' + esc(display) + '</button>';
      });
      html += '</div></div>';
    });

    subFiltersEl.innerHTML = html;
    subFiltersEl.hidden = !html;
    activeSubFilters = {};

    /* Bind chip click events */
    subFiltersEl.querySelectorAll('.yb-glossary__chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = this.getAttribute('data-subkey');
        var val = this.getAttribute('data-subval');
        /* Toggle active within the same row */
        var row = this.closest('.yb-glossary__subfilter-row');
        row.querySelectorAll('.yb-glossary__chip').forEach(function (b) {
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
      /* Scope */
      if (activeScope === 'common' && !isCommon(t)) return false;
      /* Category */
      if (activeFilter !== 'all' && t.category !== activeFilter) return false;

      /* Sub-filters */
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

      /* Search */
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
        /* Show ALL items so the letter heading is guaranteed to exist */
        var allItems = filtered();
        visible = allItems.length;
        render();
        /* Scroll to letter heading after render */
        requestAnimationFrame(function () {
          var target = document.querySelector('[data-glossary-letter="' + letter + '"]');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    });
  }

  /* ── Build card HTML ── */
  function buildCard(t, q) {
    var catLabel = categoryLabels[t.category] || t.category;
    var pron = t.pronunciation
      ? '<div class="yb-glossary__pron">' + esc(t.pronunciation) + '</div>'
      : '';

    /* Meta line: level + position + styles as text */
    var metaParts = [];
    if (t.level) {
      var lvl = levelLabels[t.level] || t.level;
      metaParts.push('<span class="yb-glossary__level yb-glossary__level--' + t.level + '">' + esc(lvl) + '</span>');
    }
    if (t.position) {
      var pos = positionLabels[t.position] || capitalize(t.position);
      metaParts.push('<span class="yb-glossary__tag">' + esc(pos) + '</span>');
    }
    /* Yoga styles as a single compact tag */
    if (t.yoga_styles && t.yoga_styles.length) {
      var styleNames = t.yoga_styles.map(function (s) {
        return styleLabels[s] || capitalize(s);
      });
      metaParts.push('<span class="yb-glossary__tag yb-glossary__tag--styles">' + esc(styleNames.join(' \u00B7 ')) + '</span>');
    }
    var metaHtml = metaParts.length
      ? '<div class="yb-glossary__meta">' + metaParts.join('') + '</div>'
      : '';

    /* Description — active language only */
    var desc = activeLang === 'da' ? t.desc_da : t.desc_en;

    /* Expandable details — active language only */
    var detailsHtml = '';
    var alignText = activeLang === 'da' ? t.alignment_da : t.alignment_en;
    var contraText = activeLang === 'da' ? t.contraindications_da : t.contraindications_en;
    var modText = activeLang === 'da' ? t.modifications_da : t.modifications_en;

    if (alignText) {
      detailsHtml += '<details class="yb-glossary__detail"><summary>Alignment cues</summary>' +
        '<div class="yb-glossary__detail-body"><p>' + esc(alignText) + '</p></div></details>';
    }
    if (contraText) {
      detailsHtml += '<details class="yb-glossary__detail"><summary>Kontraindikationer</summary>' +
        '<div class="yb-glossary__detail-body"><p>' + esc(contraText) + '</p></div></details>';
    }
    if (modText) {
      detailsHtml += '<details class="yb-glossary__detail"><summary>Modifikationer</summary>' +
        '<div class="yb-glossary__detail-body"><p>' + esc(modText) + '</p></div></details>';
    }

    return '<article class="yb-glossary__card">' +
      '<div class="yb-glossary__card-head">' +
        '<h3 class="yb-glossary__term">' + highlight(t.sanskrit, q) + '</h3>' +
        '<span class="yb-glossary__cat">' + esc(catLabel) + '</span>' +
      '</div>' +
      pron +
      '<div class="yb-glossary__names">' +
        '<span title="English">' + highlight(t.en, q) + '</span>' +
        '<span class="yb-glossary__names-sep">/</span>' +
        '<span title="Dansk">' + highlight(t.da, q) + '</span>' +
      '</div>' +
      metaHtml +
      '<p class="yb-glossary__desc">' + highlight(desc, q) + '</p>' +
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
        html += '<div class="yb-glossary__letter" data-glossary-letter="' + first + '">' + first + '</div>';
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

  /* ── Language toggle ── */
  langBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      langBtns.forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      activeLang = this.getAttribute('data-lang');
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
    if (activeLang !== 'da') parts.push('lang=' + activeLang);
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
      if (kv[0] === 'lang' && kv[1]) {
        activeLang = kv[1];
        langBtns.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-lang') === activeLang);
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
