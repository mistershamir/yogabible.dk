/**
 * Country Detection & Normalization — Yoga Bible
 *
 * Detects a lead's country from multiple signals (waterfall):
 *   1. Explicit country field (from form submission) — normalize text
 *   2. Phone prefix detection
 *   3. Language field fallback
 *   4. Default → 'OTHER' (treated as UK for content purposes)
 *
 * Returns a 2-letter code: DK, NO, SE, DE, AT, CH, FI, NL, UK, OTHER
 */

// ── Phone prefix → country code ─────────────────────────────────────────────
const PHONE_PREFIX_MAP = {
  '+45':  'DK',
  '+47':  'NO',
  '+46':  'SE',
  '+49':  'DE',
  '+358': 'FI',
  '+31':  'NL',
  '+44':  'UK',
  '+43':  'AT',
  '+41':  'CH'
};

// Sorted longest-first so +358 matches before +3
const PHONE_PREFIXES = Object.keys(PHONE_PREFIX_MAP).sort((a, b) => b.length - a.length);

// ── Language → country code fallback ────────────────────────────────────────
const LANG_MAP = {
  'da': 'DK',
  'dk': 'DK',
  'no': 'NO',
  'sv': 'SE',
  'se': 'SE',
  'de': 'DE',
  'fi': 'FI',
  'nl': 'NL',
  'en': 'UK'
};

// ── Country name → code normalization ───────────────────────────────────────
const COUNTRY_NAME_MAP = {
  'denmark':        'DK',
  'danmark':        'DK',
  'norway':         'NO',
  'norge':          'NO',
  'sweden':         'SE',
  'sverige':        'SE',
  'germany':        'DE',
  'deutschland':    'DE',
  'finland':        'FI',
  'netherlands':    'NL',
  'holland':        'NL',
  'nederland':      'NL',
  'the netherlands':'NL',
  'united kingdom': 'UK',
  'uk':             'UK',
  'england':        'UK',
  'scotland':       'UK',
  'wales':          'UK',
  'great britain':  'UK',
  'austria':        'AT',
  'österreich':     'AT',
  'switzerland':    'CH',
  'schweiz':        'CH',
  'suisse':         'CH'
};

/**
 * Normalize a country name/code string to a 2-letter code.
 * @param {string} raw - Country name, code, or city/country combo
 * @returns {string|null} 2-letter code or null if not recognized
 */
function normalizeCountryName(raw) {
  if (!raw) return null;
  var lower = String(raw).toLowerCase().trim();

  // Already a known 2-letter code?
  if (lower === 'dk' || lower === 'no' || lower === 'se' || lower === 'de' || lower === 'fi' || lower === 'nl' || lower === 'uk' || lower === 'at' || lower === 'ch') {
    return lower.toUpperCase();
  }

  // Exact match on country name
  if (COUNTRY_NAME_MAP[lower]) return COUNTRY_NAME_MAP[lower];

  // Partial match — check if any known country name is contained in the string
  // (handles "Copenhagen, Denmark" or "Berlin, Germany")
  for (var name in COUNTRY_NAME_MAP) {
    if (lower.includes(name)) return COUNTRY_NAME_MAP[name];
  }

  return null;
}

/**
 * Detect country from phone number prefix.
 * @param {string} phone - Phone number (may include +, spaces, dashes)
 * @returns {string|null} 2-letter code or null
 */
function detectCountryFromPhone(phone) {
  if (!phone) return null;
  var clean = String(phone).replace(/[\s\-()]/g, '');

  // Ensure it starts with +
  if (!clean.startsWith('+')) {
    if (clean.startsWith('00')) {
      clean = '+' + clean.substring(2);
    } else {
      return null; // Can't detect without international prefix
    }
  }

  for (var i = 0; i < PHONE_PREFIXES.length; i++) {
    if (clean.startsWith(PHONE_PREFIXES[i])) {
      return PHONE_PREFIX_MAP[PHONE_PREFIXES[i]];
    }
  }

  return null;
}

/**
 * Detect country from language code.
 * @param {string} lang - Language code (e.g., 'da', 'en', 'de')
 * @returns {string|null} 2-letter country code or null
 */
function detectCountryFromLang(lang) {
  if (!lang) return null;
  var lower = String(lang).toLowerCase().trim().substring(0, 2);
  return LANG_MAP[lower] || null;
}

/**
 * Detect a lead's country using waterfall logic.
 * Priority: explicit country → phone prefix → lang field → 'OTHER'
 *
 * @param {Object} lead - Lead data object
 * @returns {string} 2-letter country code (DK, NO, SE, DE, AT, CH, FI, NL, UK, OTHER)
 */
function detectLeadCountry(lead) {
  if (!lead) return 'OTHER';

  // 1. Explicit country field
  var fromCountry = normalizeCountryName(lead.country || lead.city_country);
  if (fromCountry) return fromCountry;

  // 2. Phone prefix
  var fromPhone = detectCountryFromPhone(lead.phone);
  if (fromPhone) return fromPhone;

  // 3. Language field
  var lang = lead.lang || lead.meta_lang || lead.language;
  var fromLang = detectCountryFromLang(lang);
  if (fromLang) return fromLang;

  // 4. Default
  return 'OTHER';
}

module.exports = {
  detectLeadCountry,
  normalizeCountryName,
  detectCountryFromPhone,
  detectCountryFromLang
};
