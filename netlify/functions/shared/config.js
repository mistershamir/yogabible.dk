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
  MEETING_LINK: 'https://calendly.com/yogabible/studio-tour-consultation-yoga-teacher-training',
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
    'ytt': "Hi {{first_name}}! Thank you for your interest in our Yoga Teacher Training. We have just sent detailed information to your email - please check your inbox and spam or promotions folder. Feel free to reply here or call anytime with questions. Warm regards, Yoga Bible",
    'course': "Hi {{first_name}}! Thank you for your interest in our {{program}} course. We have just sent you all the details by email - please check your inbox and spam or promotions folder. Reply here anytime with questions! Warm regards, Yoga Bible",
    'mentorship': "Hi {{first_name}}! Thank you for your interest in our Personlig Mentorship program. We have sent you more information by email - check your inbox and spam or promotions folder. Looking forward to connecting! Warm regards, Yoga Bible",
    'default': "Hi {{first_name}}! Thank you for reaching out to Yoga Bible. We have sent you information by email - please check your inbox and spam or promotions folder. Feel free to reply here or call us with any questions! Warm regards, Yoga Bible"
  }
};

const YTT_PROGRAM_TYPES = {
  '18-week': { keywords: ['18 uger', '18-week', '18 week', 'fleksibel', 'flexible', '18w'], label: '18-Week Flexible', shortLabel: '18W' },
  '4-week': { keywords: ['4 uger', '4-week', '4 week', 'intensiv', 'intensive', '4w'], label: '4-Week Intensive', shortLabel: '4W' },
  '8-week': { keywords: ['8 uger', '8-week', '8 week', 'semi-intensiv', 'semi-intensive', '8w'], label: '8-Week Semi-Intensive', shortLabel: '8W' },
  '300h': { keywords: ['300 hour', '300h', '300 timer', '300-hour', 'advanced'], label: '300-Hour Advanced', shortLabel: '300H' },
  '50h': { keywords: ['50 hour', '50h', '50 timer', '50-hour'], label: '50-Hour Specialty', shortLabel: '50H' },
  '30h': { keywords: ['30 hour', '30h', '30 timer', '30-hour'], label: '30-Hour Module', shortLabel: '30H' }
};

// Schedule PDFs are now served from Cloudinary — no Google Drive file IDs needed.

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
  YTT_PAYMENT,
  COURSE_PAYMENT_URLS,
  BUNDLE_PAYMENT_URLS,
  COURSE_CONFIG
};
