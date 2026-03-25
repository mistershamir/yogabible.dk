/**
 * Shared Configuration — Yoga Bible Lead & Application System
 * Netlify Functions + Firestore
 */

const CONFIG = {
  TIMEZONE: 'Europe/Copenhagen',
  DATE_FORMAT: 'yyyy-MM-dd HH:mm:ss',
  EMAIL_FROM: 'info@yogabible.dk',
  EMAIL_ADMIN: 'info@yogabible.dk',
  FROM_NAME: 'Yoga Bible',
  BUNDLE_PROGRAM_ID: '__bundle__',
  MEETING_LINK: 'https://yogabible.dk/?booking=1',
  APPLICATION_FORM_URL: 'https://www.yogabible.dk/apply',
  STUDIO_ADDRESS: 'Torvegade 66, 1400 Kobenhavn K, Danmark',
  STUDIO_MAPS_URL: 'https://www.google.com/maps/search/?api=1&query=Torvegade+66,+1400+Copenhagen,+Denmark',
  UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET,
  UNSUBSCRIBE_STATUS: 'Unsubscribed',
  SITE_URL: process.env.URL || 'https://yogabible.dk',
  TRANSLATIONS: {
    'Kursus': 'Course', 'Uddannelse': 'Education', 'YTT': 'YTT',
    'Teacher Training': 'Teacher Training', 'Ikke aaben endnu': 'Not open yet',
    'Aaben': 'Open', 'Lukket': 'Closed', 'Venteliste': 'Waitlist', 'Fuld': 'Full'
  }
};

const AUTO_SMS_CONFIG = {
  enabled: true,
  templates: {
    en: {
      'ytt': "Hi {{first_name}}! Thank you for your interest in our Yoga Teacher Training. We've sent details to your email (check inbox + spam). Book a free info session: https://yogabible.dk/?booking=1 — Warm regards, Yoga Bible",
      'ytt_intl': "Hi {{first_name}}! Thank you for your interest in our July 2026 Yoga Teacher Training in Copenhagen. We've sent details to your email (check inbox + spam). Book a free online info meeting: https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation — Healthy regards, Yoga Bible",
      'ytt_multi': "Hi {{first_name}}! Thank you for requesting schedules for our {{program}}. We've sent all the schedules to your email (check inbox + spam) so you can compare. Book a free info session: https://yogabible.dk/?booking=1 — Yoga Bible",
      'course': "Hi {{first_name}}! Thank you for your interest in our {{program}} course. We've sent details to your email (check inbox + spam). Book a consultation: https://yogabible.dk/?booking=1 — Warm regards, Yoga Bible",
      'mentorship': "Hi {{first_name}}! Thank you for your interest in our Mentorship program. We've sent details to your email (check inbox + spam). Book a free consultation: https://yogabible.dk/?booking=1 — Warm regards, Yoga Bible",
      'default': "Hi {{first_name}}! Thank you for reaching out to Yoga Bible. We've sent info to your email (check inbox + spam). Book a consultation: https://yogabible.dk/?booking=1 — Warm regards, Yoga Bible"
    },
    da: {
      'ytt': "Hej {{first_name}}! Tak for din interesse i vores yogal\u00e6reruddannelse. Vi har sendt detaljer til din e-mail (tjek ogs\u00e5 spam). Book et gratis infom\u00f8de: https://yogabible.dk/?booking=1 — K\u00e6rlig hilsen, Yoga Bible",
      'ytt_multi': "Hej {{first_name}}! Tak for din foresp\u00f8rgsel p\u00e5 skemaer til vores {{program}}. Vi har sendt alle skemaer til din e-mail (tjek ogs\u00e5 spam), s\u00e5 du kan sammenligne. Book et gratis infom\u00f8de: https://yogabible.dk/?booking=1 — Yoga Bible",
      'course': "Hej {{first_name}}! Tak for din interesse i vores {{program}} kursus. Vi har sendt detaljer til din e-mail (tjek ogs\u00e5 spam). Book en gratis konsultation: https://yogabible.dk/?booking=1 — K\u00e6rlig hilsen, Yoga Bible",
      'mentorship': "Hej {{first_name}}! Tak for din interesse i vores Mentorship-program. Vi har sendt detaljer til din e-mail (tjek ogs\u00e5 spam). Book en gratis konsultation: https://yogabible.dk/?booking=1 — K\u00e6rlig hilsen, Yoga Bible",
      'default': "Hej {{first_name}}! Tak fordi du kontaktede Yoga Bible. Vi har sendt info til din e-mail (tjek ogs\u00e5 spam). Book en konsultation: https://yogabible.dk/?booking=1 — K\u00e6rlig hilsen, Yoga Bible"
    },
    de: {
      'ytt': "Hallo {{first_name}}, hier ist Shamir von Yoga Bible! Danke für dein Interesse an der Yogalehrer-Ausbildung. Schau dir den Stundenplan an und melde dich, wenn du Fragen hast — per E-Mail oder unter +45 53 88 12 09. Bis bald in Kopenhagen!",
      'ytt_intl': "Hallo {{first_name}}! Danke für dein Interesse an unserer Yogalehrer-Ausbildung im Juli 2026 in Kopenhagen. Wir haben alle Details an deine E-Mail geschickt (check auch den Spam-Ordner). Buche ein kostenloses Online-Infogespräch: https://yogabible.dk/en/200-hours-4-weeks-intensive-programs/?booking=consultation — Gesunde Grüße, Yoga Bible",
      'ytt_multi': "Hallo {{first_name}}, hier ist Shamir von Yoga Bible! Danke für deine Anfrage zu unseren {{program}}. Wir haben alle Stundenpläne an deine E-Mail geschickt (check auch den Spam-Ordner). Infogespräch buchen: https://yogabible.dk/?booking=1 — Yoga Bible",
      'course': "Hallo {{first_name}}! Danke für dein Interesse an unserem {{program}} Kurs. Wir haben die Details an deine E-Mail geschickt (check auch den Spam-Ordner). Buche eine Beratung: https://yogabible.dk/?booking=1 — Yoga Bible",
      'mentorship': "Hallo {{first_name}}! Danke für dein Interesse an unserem Mentorship-Programm. Wir haben die Details an deine E-Mail geschickt (check auch den Spam-Ordner). Buche eine Beratung: https://yogabible.dk/?booking=1 — Yoga Bible",
      'default': "Hallo {{first_name}}! Danke, dass du dich an Yoga Bible gewandt hast. Wir haben Infos an deine E-Mail geschickt (check auch den Spam-Ordner). Buche eine Beratung: https://yogabible.dk/?booking=1 — Yoga Bible"
    }
  }
};

// Human-readable program display names (for SMS, admin UI, etc.)
// Maps raw slugs/program types → clean display names in both languages
const PROGRAM_DISPLAY_NAMES = {
  da: {
    '4-week':     '4-ugers intensiv yogal\u00e6reruddannelse (april 2026)',
    '4-week-jul': '4-ugers Vinyasa Plus yogal\u00e6reruddannelse (juli 2026)',
    '8-week':     '8-ugers semi-intensiv yogal\u00e6reruddannelse (maj\u2013juni 2026)',
    '18-week':    '18-ugers fleksibel yogal\u00e6reruddannelse (marts\u2013juni 2026)',
    '18-week-aug':'18-ugers fleksibel yogal\u00e6reruddannelse (august\u2013december 2026)',
    '300h':       '300-timers avanceret yogal\u00e6reruddannelse',
    '50h':        '50-timers specialiseringsmodul',
    '30h':        '30-timers modul',
    'undecided':  'yogal\u00e6reruddannelse (ikke besluttet endnu)'
  },
  en: {
    '4-week':     '4-Week Intensive Yoga Teacher Training (April 2026)',
    '4-week-jul': '4-Week Vinyasa Plus Yoga Teacher Training (July 2026)',
    '8-week':     '8-Week Semi-Intensive Yoga Teacher Training (May\u2013June 2026)',
    '18-week':    '18-Week Flexible Yoga Teacher Training (March\u2013June 2026)',
    '18-week-aug':'18-Week Flexible Yoga Teacher Training (August\u2013December 2026)',
    '300h':       '300-Hour Advanced Yoga Teacher Training',
    '50h':        '50-Hour Specialty Training',
    '30h':        '30-Hour Module',
    'undecided':  'Yoga Teacher Training (undecided)'
  }
};

/**
 * Get human-readable program name from ytt_program_type or raw slug
 */
function getDisplayProgram(leadData, lang) {
  var l = lang || leadData.lang || 'en';
  var names = PROGRAM_DISPLAY_NAMES[l] || PROGRAM_DISPLAY_NAMES.en;

  // Try ytt_program_type first (most reliable)
  if (leadData.ytt_program_type && names[leadData.ytt_program_type]) {
    return names[leadData.ytt_program_type];
  }

  // Multi-format: build a combined name
  if (leadData.all_formats && leadData.all_formats.includes(',')) {
    var fmts = leadData.all_formats.split(',').filter(function (f) { return f; });
    var fmtMap = { '4w': '4-week', '8w': '8-week', '18w': '18-week', '4w-apr': '4-week', '4w-jul': '4-week-jul', '18w-aug': '18-week-aug' };
    var labels = fmts.map(function (f) {
      var key = fmtMap[f] || f;
      return names[key] || key;
    });
    if (l === 'da') {
      return labels.length > 1 ? labels.slice(0, -1).join(', ') + ' og ' + labels[labels.length - 1] : labels[0];
    }
    return labels.length > 1 ? labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1] : labels[0];
  }

  // Fallback: use the program field as-is
  return leadData.program || 'Yoga Teacher Training';
}

const YTT_PROGRAM_TYPES = {
  '18-week': { keywords: ['18 uger', '18-week', '18 week', 'fleksibel', 'flexible', '18w', '18w-mar'], label: '18-Week Flexible (Spring)', shortLabel: '18W' },
  '18-week-aug': { keywords: ['18w-aug', 'efterår 18w', 'autumn 18w', 'august 18w'], label: '18-Week Flexible (Autumn)', shortLabel: '18W-AUG' },
  '4-week': { keywords: ['4 uger', '4-week', '4 week', 'intensiv', 'intensive', '4w', '4w-apr'], label: '4-Week Intensive', shortLabel: '4W' },
  '4-week-jul': { keywords: ['4w-jul', 'vinyasa plus', 'vinyasa+', 'juli 4w'], label: '4-Week Vinyasa Plus (July)', shortLabel: '4W-VP' },
  '8-week': { keywords: ['8 uger', '8-week', '8 week', 'semi-intensiv', 'semi-intensive', '8w'], label: '8-Week Semi-Intensive', shortLabel: '8W' },
  '300h': { keywords: ['300 hour', '300h', '300 timer', '300-hour', 'advanced'], label: '300-Hour Advanced', shortLabel: '300H' },
  '50h': { keywords: ['50 hour', '50h', '50 timer', '50-hour'], label: '50-Hour Specialty', shortLabel: '50H' },
  '30h': { keywords: ['30 hour', '30h', '30 timer', '30-hour'], label: '30-Hour Module', shortLabel: '30H' }
};

// Schedule PDFs — hosted on Bunny CDN
const CDN_BASE = process.env.CDN_BASE_URL || 'https://yogabible.b-cdn.net';

const SCHEDULE_PDFS = {
  '18-week': {
    'Marts-Juni 2026': CDN_BASE + '/v1771280099/18w-mar-jun-2026.pdf_izgiuz',
    'August-December 2026': '', // Upload when ready
    'default': CDN_BASE + '/v1771280099/18w-mar-jun-2026.pdf_izgiuz'
  },
  '4-week': {
    'April 2026': CDN_BASE + '/v1771280041/4w-apr-2026.pdf_x9iwdf',
    'Juli 2026': '',         // Upload when ready
    'default': CDN_BASE + '/v1771280041/4w-apr-2026.pdf_x9iwdf'
  },
  '8-week': {
    'Maj-Juni 2026': CDN_BASE + '/v1771280072/8w-may-jun-2026.pdf_k7i62j',
    'Oktober-November 2026': '', // Upload when ready
    'default': CDN_BASE + '/v1771280072/8w-may-jun-2026.pdf_k7i62j'
  },
  '300h': {
    'Maj-December 2026': '', // Upload when ready
    'default': ''
  },
  // Course schedules (Inversions, Splits, Backbends) — per month
  'courses': {
    'April 2026': '',        // Upload when ready
    'Maj 2026': '',          // Upload when ready
    'Juni 2026': '',         // Upload when ready
    'default': ''
  }
};

const YTT_PAYMENT = {
  '4-week': {
    'Februar 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10113',
    'default': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10113'
  },
  '8-week': { 'default': '' },
  '18-week': {
    'Marts-Juni 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10112',
    'default': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10112'
  },
  '300h': { 'default': '' },
  '50h': { 'default': '' },
  '30h': { 'default': '' },
  'deposit_amount': 3750,
  'deposit_currency': 'DKK'
};

const COURSE_PAYMENT_URLS = {
  'Inversions': {
    'Februar 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10144',
    'Marts 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10145',
    'April 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10146',
    'default': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10144'
  },
  'Splits': {
    'Februar 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10150',
    'Marts 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10151',
    'default': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10150'
  },
  'Backbends': {
    'Februar 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10138',
    'April 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10141',
    'Maj 2026': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10142',
    'default': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=10138'
  }
};

const BUNDLE_PAYMENT_URLS = {
  'Februar 2026': {
    'Backbends|Inversions': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=113',
    'Inversions|Splits': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=114',
    'Backbends|Splits': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=115',
    'ALL': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=125'
  },
  'Marts 2026': {
    'Backbends|Inversions': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=116',
    'Inversions|Splits': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=117',
    'Backbends|Splits': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=118',
    'ALL': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=126'
  },
  'April 2026': {
    'Backbends|Inversions': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=119',
    'Inversions|Splits': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=120',
    'Backbends|Splits': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=121',
    'ALL': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=127'
  },
  'Maj 2026': {
    'Backbends|Inversions': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=122',
    'Inversions|Splits': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=123',
    'Backbends|Splits': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=124',
    'ALL': 'https://clients.mindbodyonline.com/classic/ws?studioid=574883&stype=40&prodid=128'
  }
};

const COURSE_CONFIG = {
  'Inversions': { label: 'Inversions', description: 'Balance, shoulders, core strength', price: 2300, sessions: 8 },
  'Splits': { label: 'Splits', description: 'Hips, hamstrings, control', price: 2300, sessions: 8 },
  'Backbends': { label: 'Backbends', description: 'Chest, spine, technique', price: 2300, sessions: 8 }
};

module.exports = {
  CONFIG,
  AUTO_SMS_CONFIG,
  YTT_PROGRAM_TYPES,
  PROGRAM_DISPLAY_NAMES,
  getDisplayProgram,
  CDN_BASE,
  SCHEDULE_PDFS,
  YTT_PAYMENT,
  COURSE_PAYMENT_URLS,
  BUNDLE_PAYMENT_URLS,
  COURSE_CONFIG
};
