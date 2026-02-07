/**
 * Yoga Bible — Glossary v4
 * Global language integration via path + hostname detection (mirrors header.js).
 * Dynamic field access pattern: field(obj, 'desc') → obj['desc_' + lang]
 * Future-proof for yogabible.com with additional languages.
 */
(function () {
  'use strict';

  /* ── Language detection (mirrors header.js: path-based first, hostname fallback) ── */
  function detectLang() {
    var path = window.location.pathname || '/';
    /* Path-based: /en/yoga-glossary/ (current yogabible.dk setup) */
    var pathMatch = path.match(/^\/([a-z]{2})\//);
    if (pathMatch) return pathMatch[1];
    /* Hostname-based: en.yogabible.com (future yogabible.com setup) */
    var host = window.location.hostname.toLowerCase();
    var hostMatch = host.match(/^([a-z]{2})\./);
    if (hostMatch) return hostMatch[1];
    return 'da';
  }
  var activeLang = detectLang();

  /* ── Localized field accessor with fallback chain ── */
  function field(obj, key) {
    return obj[key + '_' + activeLang] || obj[key + '_en'] || obj[key + '_da'] || '';
  }

  /* ── UI Strings (extend per language as needed) ── */
  var UI = {
    da: {
      scope_common: 'Mest brugte',
      scope_all: 'Komplet ordbog',
      search_placeholder: 'S\u00F8g fx "tadasana", "pranayama" eller "vinyasa"...',
      filter_all: 'Alle',
      sub_all: 'Alle',
      count_one: ' begreb fundet',
      count_many: ' begreber fundet',
      empty: 'Ingen termer matcher din s\u00F8gning. Pr\u00F8v et andet ord, bogstav eller filter.',
      show_more: 'Vis flere begreber',
      detail_alignment: 'Alignment cues',
      detail_contra: 'Kontraindikationer',
      detail_mods: 'Modifikationer',
      sub_level: 'Niveau',
      sub_position: 'Position',
      sub_style: 'Yogastil',
      sub_anatomy: 'Underkategori',
      sub_breathing: 'Type',
      sub_meditation: 'Type',
      sub_philosophy: 'Tradition',
      sub_energy: 'System',
      sub_teaching: 'Omr\u00E5de',
      sub_styles: 'Type',
      sub_business: 'Omr\u00E5de',
      sub_equipment: 'Type',
      hero_badge: 'YOGA ORDBOG',
      hero_subtitle: 'Denne ordliste er udviklet af Yoga Bible i K\u00F8benhavn som et fagligt opslagsv\u00E6rk til vores yogal\u00E6reruddannelser, studerende og nysgerrige ud\u00F8vere. Her samler vi centrale begreber fra klassisk og moderne yoga \u2014 p\u00E5 sanskrit, dansk og engelsk.',
      cta_title: 'Vil du l\u00E6re mere?',
      cta_text: 'Vores 200-timers yogal\u00E6reruddannelse d\u00E6kker alle disse begreber i dybden.',
      cta_btn: 'Se Uddannelser'
    },
    en: {
      scope_common: 'Most Common',
      scope_all: 'Complete Glossary',
      search_placeholder: 'Search e.g. "tadasana", "pranayama" or "vinyasa"...',
      filter_all: 'All',
      sub_all: 'All',
      count_one: ' term found',
      count_many: ' terms found',
      empty: 'No terms match your search. Try another word, letter, or filter.',
      show_more: 'Show more terms',
      detail_alignment: 'Alignment Cues',
      detail_contra: 'Contraindications',
      detail_mods: 'Modifications',
      sub_level: 'Level',
      sub_position: 'Position',
      sub_style: 'Yoga Style',
      sub_anatomy: 'Subcategory',
      sub_breathing: 'Type',
      sub_meditation: 'Type',
      sub_philosophy: 'Tradition',
      sub_energy: 'System',
      sub_teaching: 'Area',
      sub_styles: 'Type',
      sub_business: 'Area',
      sub_equipment: 'Type',
      hero_badge: 'YOGA GLOSSARY',
      hero_subtitle: 'This glossary was developed by Yoga Bible in Copenhagen as a professional reference for our yoga teacher trainings, students, and curious practitioners. Here we gather key concepts from classical and modern yoga \u2014 in Sanskrit, Danish, and English.',
      cta_title: 'Want to learn more?',
      cta_text: 'Our 200-hour yoga teacher training covers all these concepts in depth.',
      cta_btn: 'View Programs'
    }
  };

  function ui(key) {
    return (UI[activeLang] && UI[activeLang][key]) || UI.da[key] || key;
  }

  /* ── Data ── */
  var data = window.YB_GLOSSARY_DATA || { terms: [], categories: [] };
  var TERMS = data.terms;
  var CATEGORIES = data.categories;

  /* ── State ── */
  var PER_PAGE = 36;
  var visible = PER_PAGE;
  var activeFilter = 'all';
  var activeScope = 'common';
  var activeSubFilters = {};
  var searchQuery = '';
  var debounceTimer = null;

  /* ── Common asanas (curated for scope toggle) ── */
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

  /* ── Label helpers (multi-language) ── */
  var categoryLabels = {};
  CATEGORIES.forEach(function (c) {
    categoryLabels[c.id] = c['name_' + activeLang] || c.name_da || c.name_en;
  });

  var LEVEL_LABELS = {
    da: { beginner: 'Begynder', intermediate: 'Mellem', advanced: 'Avanceret' },
    en: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
  };

  var POSITION_LABELS = {
    da: {
      standing: 'St\u00E5ende', seated: 'Siddende', kneeling: 'Kn\u00E6lende',
      supine: 'Rygleje', prone: 'Maveleje', 'all-fours': 'Alle fire',
      'arm-balance': 'Armbalance', inversion: 'Omvendt'
    },
    en: {
      standing: 'Standing', seated: 'Seated', kneeling: 'Kneeling',
      supine: 'Supine', prone: 'Prone', 'all-fours': 'All Fours',
      'arm-balance': 'Arm Balance', inversion: 'Inversion'
    }
  };

  var styleLabels = {
    hatha: 'Hatha', vinyasa: 'Vinyasa', ashtanga: 'Ashtanga',
    iyengar: 'Iyengar', power: 'Power', hot: 'Hot', bikram: 'Bikram',
    yin: 'Yin', restorative: 'Restorative', kundalini: 'Kundalini'
  };

  function getLevelLabel(val) {
    var map = LEVEL_LABELS[activeLang] || LEVEL_LABELS.da;
    return map[val] || capitalize(val);
  }

  function getPositionLabel(val) {
    var map = POSITION_LABELS[activeLang] || POSITION_LABELS.da;
    return map[val] || capitalize(val);
  }

  function getStyleLabel(val) {
    return styleLabels[val] || capitalize(val);
  }

  /* ── Subcategory label maps (bilingual, per category) ── */
  function makeLabelFn(bilingualMap) {
    return function (val) {
      var map = bilingualMap[activeLang] || bilingualMap.da;
      return (map && map[val]) || capitalize(val);
    };
  }

  var ANATOMY_SUB_LABELS = {
    da: { 'alignment-principles': 'Alignment principper', 'joint-movement': 'Ledbev\u00E6gelse', 'body-systems': 'Kroppens systemer' },
    en: { 'alignment-principles': 'Alignment Principles', 'joint-movement': 'Joint Movement', 'body-systems': 'Body Systems' }
  };

  var BREATHING_SUB_LABELS = {
    da: { technique: 'Teknik', concept: 'Koncept' },
    en: { technique: 'Technique', concept: 'Concept' }
  };

  var MEDITATION_SUB_LABELS = {
    da: { limb: 'Yogas lemmer', technique: 'Teknik', tool: 'Redskab' },
    en: { limb: 'Yoga Limbs', technique: 'Technique', tool: 'Tool' }
  };

  var PHILOSOPHY_SUB_LABELS = {
    da: { yama: 'Yama', niyama: 'Niyama', text: 'Tekster', concept: 'Koncept' },
    en: { yama: 'Yama', niyama: 'Niyama', text: 'Texts', concept: 'Concept' }
  };

  var ENERGY_SUB_LABELS = {
    da: { chakra: 'Chakra', nadi: 'Nadi', bandha: 'Bandha', mudra: 'Mudra', concept: 'Koncept' },
    en: { chakra: 'Chakra', nadi: 'Nadi', bandha: 'Bandha', mudra: 'Mudra', concept: 'Concept' }
  };

  var TEACHING_SUB_LABELS = {
    da: { 'class-structure': 'Klasseopbygning', instruction: 'Instruktion', adaptation: 'Tilpasning' },
    en: { 'class-structure': 'Class Structure', instruction: 'Instruction', adaptation: 'Adaptation' }
  };

  var STYLES_SUB_LABELS = {
    da: { physical: 'Fysisk stil', path: 'Yogavej' },
    en: { physical: 'Physical Style', path: 'Yoga Path' }
  };

  var BUSINESS_SUB_LABELS = {
    da: { certification: 'Certificering', 'studio-training': 'Studio & uddannelse' },
    en: { certification: 'Certification', 'studio-training': 'Studio & Training' }
  };

  var EQUIPMENT_SUB_LABELS = {
    da: { essential: 'Basis', support: 'St\u00F8tte & komfort' },
    en: { essential: 'Essential', support: 'Support & Comfort' }
  };

  /* ── Sub-filter definitions per category ── */
  var SUB_FILTER_DEFS = {
    asana: [
      { key: 'level', uiKey: 'sub_level', labelFn: getLevelLabel },
      { key: 'position', uiKey: 'sub_position', labelFn: getPositionLabel },
      { key: 'yoga_styles', uiKey: 'sub_style', labelFn: getStyleLabel, isArray: true }
    ],
    anatomy: [
      { key: 'subcategory', uiKey: 'sub_anatomy', labelFn: makeLabelFn(ANATOMY_SUB_LABELS) }
    ],
    breathing: [
      { key: 'subcategory', uiKey: 'sub_breathing', labelFn: makeLabelFn(BREATHING_SUB_LABELS) }
    ],
    meditation: [
      { key: 'subcategory', uiKey: 'sub_meditation', labelFn: makeLabelFn(MEDITATION_SUB_LABELS) }
    ],
    philosophy: [
      { key: 'subcategory', uiKey: 'sub_philosophy', labelFn: makeLabelFn(PHILOSOPHY_SUB_LABELS) }
    ],
    energy: [
      { key: 'subcategory', uiKey: 'sub_energy', labelFn: makeLabelFn(ENERGY_SUB_LABELS) }
    ],
    teaching: [
      { key: 'subcategory', uiKey: 'sub_teaching', labelFn: makeLabelFn(TEACHING_SUB_LABELS) }
    ],
    styles: [
      { key: 'subcategory', uiKey: 'sub_styles', labelFn: makeLabelFn(STYLES_SUB_LABELS) }
    ],
    business: [
      { key: 'subcategory', uiKey: 'sub_business', labelFn: makeLabelFn(BUSINESS_SUB_LABELS) }
    ],
    equipment: [
      { key: 'subcategory', uiKey: 'sub_equipment', labelFn: makeLabelFn(EQUIPMENT_SUB_LABELS) }
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

  /* ── Translate static page elements on init ── */
  function translatePage() {
    document.querySelectorAll('[data-glossary-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-glossary-i18n');
      var text = ui(key);
      if (text && text !== key) el.textContent = text;
    });
    searchInput.placeholder = ui('search_placeholder');
    scopeBtns.forEach(function (btn) {
      var scope = btn.getAttribute('data-scope');
      if (scope === 'common') btn.textContent = ui('scope_common');
      if (scope === 'all') btn.textContent = ui('scope_all');
    });
    filterBtns.forEach(function (btn) {
      var filter = btn.getAttribute('data-filter');
      if (filter === 'all') {
        btn.textContent = ui('filter_all');
      } else {
        var label = categoryLabels[filter];
        if (label) btn.textContent = label;
      }
    });
    moreBtn.textContent = ui('show_more');
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
      html += '<span class="yb-glossary__subfilter-label">' + esc(ui(def.uiKey)) + '</span>';
      html += '<div class="yb-glossary__subfilter-chips">';
      html += '<button class="yb-glossary__chip active" data-subkey="' + def.key + '" data-subval="all" type="button">' + esc(ui('sub_all')) + '</button>';

      values.forEach(function (val) {
        var display = def.labelFn(val);
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
      var fields = [t.sanskrit, t.en, t.da, field(t, 'desc')];
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

    /* Meta line: level + position + styles */
    var metaParts = [];
    if (t.level) {
      var lvl = getLevelLabel(t.level);
      metaParts.push('<span class="yb-glossary__level yb-glossary__level--' + t.level + '">' + esc(lvl) + '</span>');
    }
    if (t.position) {
      var pos = getPositionLabel(t.position);
      metaParts.push('<span class="yb-glossary__tag">' + esc(pos) + '</span>');
    }
    if (t.yoga_styles && t.yoga_styles.length) {
      var styleNames = t.yoga_styles.map(function (s) { return getStyleLabel(s); });
      metaParts.push('<span class="yb-glossary__tag yb-glossary__tag--styles">' + esc(styleNames.join(' \u00B7 ')) + '</span>');
    }
    var metaHtml = metaParts.length
      ? '<div class="yb-glossary__meta">' + metaParts.join('') + '</div>'
      : '';

    /* Description — dynamic language field with fallback */
    var desc = field(t, 'desc');

    /* Expandable details — dynamic language field with fallback */
    var detailsHtml = '';
    var alignText = field(t, 'alignment');
    var contraText = field(t, 'contraindications');
    var modText = field(t, 'modifications');

    if (alignText) {
      detailsHtml += '<details class="yb-glossary__detail"><summary>' + esc(ui('detail_alignment')) + '</summary>' +
        '<div class="yb-glossary__detail-body"><p>' + esc(alignText) + '</p></div></details>';
    }
    if (contraText) {
      detailsHtml += '<details class="yb-glossary__detail"><summary>' + esc(ui('detail_contra')) + '</summary>' +
        '<div class="yb-glossary__detail-body"><p>' + esc(contraText) + '</p></div></details>';
    }
    if (modText) {
      detailsHtml += '<details class="yb-glossary__detail"><summary>' + esc(ui('detail_mods')) + '</summary>' +
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

    countEl.textContent = items.length + (items.length === 1 ? ui('count_one') : ui('count_many'));
    buildAlphaNav(items);

    if (show.length === 0) {
      resultsEl.innerHTML = '<p class="yb-glossary__empty">' + esc(ui('empty')) + '</p>';
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

  /* ── URL hash state (no lang — language comes from subdomain) ── */
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
  translatePage();
  readHash();
  buildSubFilters();
  render();
})();
