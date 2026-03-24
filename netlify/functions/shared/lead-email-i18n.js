/**
 * Lead Email Translations — Yoga Bible
 * Bilingual text for all auto-send welcome emails (DA + EN).
 *
 * IMPORTANT: Every key must exist in BOTH 'da' and 'en'.
 * When adding new emails or modifying existing ones, ALWAYS update both languages.
 */

const { CONFIG } = require('./config');

// =========================================================================
// Shared text blocks used across multiple email templates
// =========================================================================

const SHARED = {
  da: {
    greeting: 'Hej',
    bookingCta: 'Har du lyst til at h\u00f8re mere eller stille sp\u00f8rgsm\u00e5l? Book et gratis og uforpligtende infom\u00f8de:',
    bookingBtn: 'Book et gratis infom\u00f8de',
    questionPrompt: 'Jeg vil ogs\u00e5 gerne h\u00f8re: <strong>Hvad fik dig til at overveje en yogauddannelse?</strong> Du er velkommen til bare at svare p\u00e5 denne mail.',
    lookingForward: 'Gl\u00e6der mig til at h\u00f8re fra dig.',
    highlightsIntro: 'Kort om uddannelsen:',
    highlights: [
      '200 timer \u00b7 Yoga Alliance-certificeret',
      'Hatha, Vinyasa, Yin, Hot Yoga & Meditation',
      'Anatomi, filosofi, sekvensering & undervisningsmetodik',
      'Alle niveauer er velkomne'
    ],
    alumniNote: 'Vi har uddannet yogal\u00e6rere siden 2014, og vores dimittender underviser i hele Europa og videre.',
    prepPhaseTitle: '\ud83d\udca1 Vidste du?',
    prepPhaseIntro: 'De fleste studerende starter med forberedelsesfasen allerede nu \u2014 og det er der en god grund til:',
    prepPhaseBullets: [
      'Du kan begynde at deltage i klasser i studiet med det samme',
      'Du opbygger styrke, fleksibilitet og rutine inden uddannelsesstart',
      'Du m\u00f8der dine kommende medstuderende i et afslappet milj\u00f8',
      'Dine klasser t\u00e6ller med i dine tr\u00e6ningstimer'
    ],
    prepPhaseBtn: 'Start forberedelsesfasen \u2014 3.750 kr.',
    prepPhaseSmart: '\ud83d\udca1 Smart tr\u00e6k: Start forberedelsesfasen nu',
    priceLabel: 'Pris',
    prepLabel: 'Forberedelsesfasen',
    remainLabel: 'Rest',
    noFees: 'ingen ekstra gebyrer',
    accommodationTitle: '\ud83c\udfe0 Bolig:',
    accommodationIntro: 'Jeg kan se, at du',
    accommodationFromCity: ' kommer fra ',
    accommodationNeedHousing: ' har brug for bolig i K\u00f8benhavn.',
    accommodationLink: 'Se boligmuligheder her \u2192',
    accommodationLinkUrl: 'https://yogabible.dk/accommodation',
    accommodationQuestion: 'Har du sp\u00f8rgsm\u00e5l om bolig? Svar bare p\u00e5 denne e-mail.',
    replyInvite: 'Du er velkommen til at svare p\u00e5 denne e-mail med sp\u00f8rgsm\u00e5l.',
    viewScheduleBtn: 'Se dit skema \u2192',
    readMore: 'L\u00e6s mere om programmet \u2192',
    compareFormats: 'Sammenlign alle formater',
    onlineBackup: 'Online backup hvis du ikke kan deltage en dag',
    smallCohort: 'Max 12 studerende pr. hold \u2014 personlig feedback',
    classesIncluded: '60 yogaklasser i studiet inkluderet',
    chooseTrack: 'V\u00e6lg hverdags- eller weekendspor \u2014 skift frit'
  },
  en: {
    greeting: 'Hi',
    bookingCta: 'Want to learn more or ask questions? Book a free info session:',
    bookingBtn: 'Book a Free Info Session',
    questionPrompt: 'I\u2019d also love to hear: <strong>What made you consider a yoga teacher training?</strong> Feel free to simply reply to this email.',
    lookingForward: 'Looking forward to hearing from you!',
    highlightsIntro: 'About the training:',
    highlights: [
      '200 hours \u00b7 Yoga Alliance certified (RYT-200)',
      'Hatha, Vinyasa, Yin, Hot Yoga & Meditation',
      'Anatomy, philosophy, sequencing & teaching methodology',
      'All levels welcome'
    ],
    alumniNote: 'We have trained yoga teachers since 2014, and our graduates teach across Europe and beyond.',
    prepPhaseTitle: '\ud83d\udca1 Did you know?',
    prepPhaseIntro: 'Most students start their Preparation Phase early \u2014 and for good reason:',
    prepPhaseBullets: [
      'Start attending classes at the studio right away',
      'Build strength, flexibility and routine before training starts',
      'Meet your future classmates in a relaxed setting',
      'Your classes count towards your training hours'
    ],
    prepPhaseBtn: 'Start Preparation Phase \u2014 3,750 DKK',
    prepPhaseSmart: '\ud83d\udca1 Smart move: Start your Preparation Phase now',
    priceLabel: 'Price',
    prepLabel: 'Preparation Phase',
    remainLabel: 'Remaining',
    noFees: 'no hidden fees',
    accommodationTitle: '\ud83c\udfe0 Accommodation:',
    accommodationIntro: 'I can see that you',
    accommodationFromCity: ' are coming from ',
    accommodationNeedHousing: ' need accommodation in Copenhagen.',
    accommodationLink: 'See accommodation options here \u2192',
    accommodationLinkUrl: 'https://yogabible.dk/en/accommodation',
    accommodationQuestion: 'Questions about housing? Just reply to this email.',
    replyInvite: 'Feel free to reply to this email with any questions.',
    viewScheduleBtn: 'View your schedule \u2192',
    readMore: 'Read more about the program \u2192',
    compareFormats: 'Compare all formats',
    onlineBackup: 'Online backup if you can\u2019t attend a day',
    smallCohort: 'Max 12 students per cohort \u2014 personal feedback',
    classesIncluded: '60 yoga classes at the studio included',
    chooseTrack: 'Choose weekday or weekend track \u2014 switch freely'
  },
  de: {
    greeting: 'Hallo',
    bookingCta: 'Möchtest du mehr erfahren oder hast du Fragen? Buche ein kostenloses Infogespräch — online oder vor Ort:',
    bookingBtn: 'Kostenloses Infogespräch buchen',
    questionPrompt: 'Ich würde auch gerne wissen: <strong>Was hat dich dazu gebracht, über eine Yogalehrer-Ausbildung nachzudenken?</strong> Antworte einfach auf diese E-Mail.',
    lookingForward: 'Ich freue mich, von dir zu hören!',
    highlightsIntro: 'Über die Ausbildung:',
    highlights: [
      '200 Stunden · Yoga Alliance zertifiziert (RYT-200)',
      'Hatha, Vinyasa, Yin, Hot Yoga & Meditation',
      'Anatomie, Philosophie, Sequenzierung & Unterrichtsmethodik',
      'Alle Level willkommen'
    ],
    alumniNote: 'Wir bilden seit 2014 Yogalehrer aus. Unsere Absolventen unterrichten in ganz Europa und darüber hinaus.',
    prepPhaseTitle: '\ud83d\udca1 Wusstest du?',
    prepPhaseIntro: 'Die meisten internationalen Studierenden starten ihre Vorbereitungsphase früh — und das hat gute Gründe:',
    prepPhaseBullets: [
      'Sichere deinen Platz in der Juli-Gruppe',
      'Erhalte Zugang zu Online-Vorbereitungsmaterialien im Mitgliederbereich',
      'Wir helfen dir bei Unterkunft und Logistik in Kopenhagen',
      'Starte deine Vorbereitung von zu Hause aus'
    ],
    prepPhaseBtn: 'Vorbereitungsphase starten — 3.750 DKK',
    prepPhaseSmart: '\ud83d\udca1 Kluger Schritt: Starte jetzt deine Vorbereitungsphase',
    priceLabel: 'Preis',
    prepLabel: 'Vorbereitungsphase',
    remainLabel: 'Restbetrag',
    noFees: 'keine versteckten Gebühren',
    accommodationTitle: '\ud83c\udfe0 Unterkunft:',
    accommodationIntro: 'Ich sehe, dass du',
    accommodationFromCity: ' aus ',
    accommodationNeedHousing: ' kommst und Unterkunft in Kopenhagen brauchst.',
    accommodationLink: 'Unterkunftsmöglichkeiten ansehen →',
    accommodationLinkUrl: 'https://yogabible.dk/en/accommodation',
    accommodationQuestion: 'Fragen zur Unterkunft? Antworte einfach auf diese E-Mail.',
    replyInvite: 'Antworte gerne auf diese E-Mail, wenn du Fragen hast.',
    viewScheduleBtn: 'Stundenplan ansehen →',
    readMore: 'Mehr über das Programm erfahren →',
    compareFormats: 'Alle Formate vergleichen',
    onlineBackup: 'Online-Backup, falls du einen Tag nicht teilnehmen kannst',
    smallCohort: 'Max. 12 Studierende pro Gruppe — persönliches Feedback',
    classesIncluded: '60 Yogaklassen im Studio inklusive',
    chooseTrack: 'Wähle Wochentags- oder Wochenendkurs — wechsle frei'
  }
};

// =========================================================================
// Program-specific email content
// =========================================================================

function scheduleUrl(path, lang, tokenData) {
  var base = 'https://www.yogabible.dk' + path;
  var params = '';
  if (tokenData && tokenData.leadId && tokenData.token) {
    params = '?tid=' + encodeURIComponent(tokenData.leadId) + '&tok=' + encodeURIComponent(tokenData.token);
  }
  return base + params;
}

// Schedule page paths per language
const SCHEDULE_PATHS = {
  da: {
    '4-week':      '/skema/4-uger/',
    '4-week-jul':  '/skema/4-uger-juli/',
    '8-week':      '/skema/8-uger/',
    '18-week':     '/skema/18-uger/',
    '18-week-aug': '/skema/18-uger-august/'
  },
  en: {
    '4-week':      '/en/schedule/4-weeks/',
    '4-week-jul':  '/en/schedule/4-weeks-july/',
    '8-week':      '/en/schedule/8-weeks/',
    '18-week':     '/en/schedule/18-weeks/',
    '18-week-aug': '/en/schedule/18-weeks-august/'
  }
};

// Program info page URLs per language
const PROGRAM_PAGES = {
  da: {
    '4-week':    'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs',
    '4-week-jul':'https://www.yogabible.dk/200-hours-4-weeks-intensive-programs',
    '8-week':    'https://www.yogabible.dk/200-hours-8-weeks-semi-intensive-programs',
    '18-week':   'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',
    '18-week-aug':'https://www.yogabible.dk/200-hours-18-weeks-flexible-programs',
    'about200h': 'https://www.yogabible.dk/om-200hrs-yogalaereruddannelser'
  },
  en: {
    '4-week':    'https://www.yogabible.dk/en/200-hours-4-weeks-intensive-programs',
    '4-week-jul':'https://www.yogabible.dk/en/200-hours-4-weeks-intensive-programs',
    '8-week':    'https://www.yogabible.dk/en/200-hours-8-weeks-semi-intensive-programs',
    '18-week':   'https://www.yogabible.dk/en/200-hours-18-weeks-flexible-programs',
    '18-week-aug':'https://www.yogabible.dk/en/200-hours-18-weeks-flexible-programs',
    'about200h': 'https://www.yogabible.dk/en/om-200hrs-yogalaereruddannelser'
  }
};

// Per-program email content
const PROGRAMS = {
  '4-week': {
    da: {
      subject: '{{name}}, her er alle datoer til 4-ugers yogauddannelsen',
      intro: 'Tak fordi du viste interesse for vores <strong>4-ugers intensive 200-timers yogal\u00e6reruddannelse</strong>.',
      description: 'Det intensive format er for dig, der kan dedikere sig fuldt ud i 4 uger. Daglig tr\u00e6ning og teori, hvor du fordyber dig fuldst\u00e6ndigt. Mange dimittender fort\u00e6ller, at det intensive format hjalp dem med at l\u00e6re mere, fordi de dedikerede sig 100%.',
      period: 'April 2026',
      extras: ['Online backup hvis du ikke kan deltage en dag'],
      rateNote: 'fleksibel ratebetaling'
    },
    en: {
      subject: '{{name}}, here are all the dates for the 4-week yoga training',
      intro: 'Thank you for your interest in our <strong>4-Week Intensive 200-Hour Yoga Teacher Training</strong>.',
      description: 'The intensive format is for those who can fully dedicate themselves for 4 weeks. Daily training and theory where you immerse yourself completely. Many graduates report that the intensive format helped them learn more because they dedicated 100% of their time.',
      period: 'April 2026',
      extras: ['Online backup if you can\u2019t attend a day'],
      rateNote: 'flexible instalments'
    }
  },
  '4-week-jul': {
    da: {
      subject: '{{name}}, her er alle datoer til 4-ugers Vinyasa Plus yogauddannelsen (juli)',
      intro: 'Tak fordi du viste interesse for vores <strong>4-ugers Vinyasa Plus yogal\u00e6reruddannelse</strong> (juli 2026).',
      description: 'Vinyasa Plus er et specialiseret format med fokus p\u00e5 flow-baseret undervisning.',
      vinyasaDetail: true,
      vinyasaTitle: 'Hvad er Vinyasa Plus-formatet?',
      vinyasaFlow: '<strong>70% Vinyasa Flow</strong> \u2014 kreativ sekvensering, klasseledelse og avancerede undervisningsteknikker',
      vinyasaYin: '<strong>30% Yin Yoga + Hot Yoga</strong> \u2014 genopretning, dybe str\u00e6k og undervisning i opvarmet milj\u00f8',
      vinyasaCert: 'Du certificeres til at undervise b\u00e5de opvarmede og ikke-opvarmede Vinyasa + Yin klasser.',
      period: 'Juli 2026',
      extras: [],
      rateNote: 'fleksibel ratebetaling'
    },
    en: {
      subject: '{{name}}, here are all the dates for the 4-week Vinyasa Plus training (July)',
      intro: 'Thank you for your interest in our <strong>4-Week Vinyasa Plus Yoga Teacher Training</strong> (July 2026).',
      description: 'Vinyasa Plus is a specialised format focused on flow-based teaching.',
      vinyasaDetail: true,
      vinyasaTitle: 'What is the Vinyasa Plus format?',
      vinyasaFlow: '<strong>70% Vinyasa Flow</strong> \u2014 creative sequencing, class leadership and advanced teaching techniques',
      vinyasaYin: '<strong>30% Yin Yoga + Hot Yoga</strong> \u2014 restoration, deep stretches and teaching in a heated environment',
      vinyasaCert: 'You will be certified to teach both heated and non-heated Vinyasa + Yin classes.',
      period: 'July 2026',
      extras: [],
      rateNote: 'flexible instalments'
    },
    de: {
      subject: '{{name}}, hier sind alle Termine für die 4-Wochen Vinyasa Plus Ausbildung (Juli)',
      intro: 'Danke für dein Interesse an unserer <strong>4-Wochen Vinyasa Plus Yogalehrer-Ausbildung</strong> (Juli 2026).',
      description: 'Vinyasa Plus ist ein spezialisiertes Format mit Fokus auf Flow-basiertem Unterricht. Du trainierst in unserem eigenen Studio in Christianshavn — einem der schönsten Viertel Kopenhagens.',
      vinyasaDetail: true,
      vinyasaTitle: 'Was ist das Vinyasa Plus Format?',
      vinyasaFlow: '<strong>70% Vinyasa Flow</strong> — kreative Sequenzierung, Klassenleitung und fortgeschrittene Unterrichtstechniken',
      vinyasaYin: '<strong>30% Yin Yoga + Hot Yoga</strong> — Erholung, tiefe Dehnungen und Unterricht in beheizter Umgebung',
      vinyasaCert: 'Du wirst zertifiziert, sowohl beheizte als auch nicht-beheizte Vinyasa + Yin Klassen zu unterrichten.',
      period: 'Juli 2026',
      extras: [],
      rateNote: 'flexible Ratenzahlung'
    }
  },
  '8-week': {
    da: {
      subject: '{{name}}, her er alle datoer til 8-ugers yogauddannelsen',
      intro: 'Tak fordi du viste interesse for vores <strong>8-ugers semi-intensive 200-timers yogal\u00e6reruddannelse</strong>.',
      description: 'En god balance mellem intensitet og hverdagsliv. Nok fokus til reelle fremskridt, men stadig plads til arbejde, familie eller andre forpligtelser. Et popul\u00e6rt valg for dem, der vil have en dyb oplevelse uden at s\u00e6tte hele livet p\u00e5 pause.',
      period: 'Maj\u2013Juni 2026',
      extras: ['Online backup hvis du ikke kan deltage en dag'],
      rateNote: 'fleksibel ratebetaling'
    },
    en: {
      subject: '{{name}}, here are all the dates for the 8-week yoga training',
      intro: 'Thank you for your interest in our <strong>8-Week Semi-Intensive 200-Hour Yoga Teacher Training</strong>.',
      description: 'A great balance between intensity and daily life. Enough focus for real progress, yet still room for work, family or other commitments. A popular choice for those who want a deep experience without putting their whole life on pause.',
      period: 'May\u2013June 2026',
      extras: ['Online backup if you can\u2019t attend a day'],
      rateNote: 'flexible instalments'
    }
  },
  '18-week': {
    da: {
      subject: '{{name}}, dit skema til 18-ugers yogauddannelsen er klar',
      intro: 'Tak fordi du viste interesse for vores <strong>18-ugers fleksible yogal\u00e6reruddannelse</strong>.',
      description: 'Det mest fleksible format \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Perfekt hvis du har arbejde, studie eller familie ved siden af. Sm\u00e5 hold (max 12) med personlig feedback.',
      period: 'Marts\u2013Juni 2026',
      extras: [
        'V\u00e6lg hverdags- eller weekendspor \u2014 skift frit',
        'Online backup hvis du ikke kan deltage en dag',
        '60 yogaklasser i studiet inkluderet'
      ],
      rateNote: 'fleksibel ratebetaling'
    },
    en: {
      subject: '{{name}}, your schedule for the 18-week yoga training is ready',
      intro: 'Thank you for your interest in our <strong>18-Week Flexible Yoga Teacher Training</strong>.',
      description: 'The most flexible format \u2014 choose a weekday or weekend track and switch freely throughout. Perfect if you have work, studies or family alongside. Small cohorts (max 12) with personal feedback.',
      period: 'March\u2013June 2026',
      extras: [
        'Choose weekday or weekend track \u2014 switch freely',
        'Online backup if you can\u2019t attend a day',
        '60 yoga classes at the studio included'
      ],
      rateNote: 'flexible instalments'
    }
  },
  '18-week-aug': {
    da: {
      subject: '{{name}}, dit skema til efter\u00e5rets 18-ugers program er klar',
      intro: 'Tak fordi du viste interesse for vores <strong>18-ugers fleksible yogal\u00e6reruddannelse</strong> \u2014 efter\u00e5rsholdet august\u2013december 2026.',
      description: 'Det mest fleksible format \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Perfekt hvis du har arbejde, studie eller familie ved siden af.',
      period: 'August\u2013December 2026',
      extras: [
        'V\u00e6lg hverdags- eller weekendspor \u2014 skift frit',
        'Online backup hvis du ikke kan deltage en dag',
        '60 yogaklasser i studiet inkluderet',
        'Start: 10. august 2026 \u00b7 Graduation: 13. december 2026'
      ],
      rateNote: 'fleksibel ratebetaling'
    },
    en: {
      subject: '{{name}}, your schedule for the autumn 18-week program is ready',
      intro: 'Thank you for your interest in our <strong>18-Week Flexible Yoga Teacher Training</strong> \u2014 the autumn cohort, August\u2013December 2026.',
      description: 'The most flexible format \u2014 choose a weekday or weekend track and switch freely throughout. Perfect if you have work, studies or family alongside.',
      period: 'August\u2013December 2026',
      extras: [
        'Choose weekday or weekend track \u2014 switch freely',
        'Online backup if you can\u2019t attend a day',
        '60 yoga classes at the studio included',
        'Start: 10 August 2026 \u00b7 Graduation: 13 December 2026'
      ],
      rateNote: 'flexible instalments'
    }
  },
  '300h': {
    da: {
      subject: 'Din foresp\u00f8rgsel \u2014 300-timers avanceret yogal\u00e6reruddannelse',
      intro: 'Tak for din interesse i vores <strong>300-timers avancerede yogal\u00e6reruddannelse</strong> (24 uger, maj\u2013december 2026)!',
      description: 'Dette program er designet til certificerede yogal\u00e6rere, der vil fordybe deres praksis og undervisning p\u00e5 det h\u00f8jeste niveau.',
      period: 'Maj\u2013December 2026'
    },
    en: {
      subject: 'Your enquiry \u2014 300-Hour Advanced Yoga Teacher Training',
      intro: 'Thank you for your interest in our <strong>300-Hour Advanced Yoga Teacher Training</strong> (24 weeks, May\u2013December 2026)!',
      description: 'This program is designed for certified yoga teachers who want to deepen their practice and teaching at the highest level.',
      period: 'May\u2013December 2026'
    }
  },
  'specialty': {
    da: {
      subject: 'Din foresp\u00f8rgsel \u2014 {{program}}',
      intro: 'Tak for din interesse i vores <strong>{{program}}</strong>!',
      description: 'Vores specialmoduler er perfekte for l\u00e6rere, der vil fordybe sig inden for specifikke omr\u00e5der. Vi er ved at finalisere 2026-skemaet.'
    },
    en: {
      subject: 'Your enquiry \u2014 {{program}}',
      intro: 'Thank you for your interest in our <strong>{{program}}</strong>!',
      description: 'Our specialty modules are perfect for teachers who want to go deeper in specific areas. We are finalising the 2026 schedule.'
    }
  },
  'courses': {
    da: {
      subjectSingle: 'Dit kursus \u2014 Yoga Bible',
      subjectBundle: 'Dine kursus-detaljer \u2014 Yoga Bible',
      introSingle: 'Tak for din interesse i vores <strong>{{courses}}</strong> kursus!',
      introBundle: 'Tak for din interesse i vores <strong>kursusbundle</strong>!',
      pricePer: '2.300 kr. pr. kursus',
      bundle2Discount: '10% rabat',
      bundle3Discount: '15% rabat + GRATIS 1-m\u00e5neds yogapas',
      sessions: '8 sessioner',
      enrollBtn: 'Tilmeld dig her',
      consultBtn: 'Book en gratis konsultation'
    },
    en: {
      subjectSingle: 'Your course \u2014 Yoga Bible',
      subjectBundle: 'Your course details \u2014 Yoga Bible',
      introSingle: 'Thank you for your interest in our <strong>{{courses}}</strong> course!',
      introBundle: 'Thank you for your interest in our <strong>course bundle</strong>!',
      pricePer: '2,300 DKK per course',
      bundle2Discount: '10% discount',
      bundle3Discount: '15% discount + FREE 1-month yoga pass',
      sessions: '8 sessions',
      enrollBtn: 'Enrol here',
      consultBtn: 'Book a free consultation'
    }
  },
  'mentorship': {
    da: {
      subject: 'Din mentorship-foresp\u00f8rgsel \u2014 Yoga Bible',
      intro: 'Tak for din interesse i vores <strong>{{service}}</strong>-program!',
      description: 'Vi kontakter dig snarest med mere information og n\u00e6ste skridt.'
    },
    en: {
      subject: 'Your mentorship enquiry \u2014 Yoga Bible',
      intro: 'Thank you for your interest in our <strong>{{service}}</strong> program!',
      description: 'We will be in touch shortly with more information and next steps.'
    }
  },
  'generic': {
    da: {
      subject: 'Tak for din henvendelse \u2014 Yoga Bible',
      intro: 'Tak fordi du tog kontakt til <strong>Yoga Bible</strong>!',
      body: 'Vi har modtaget din foresp\u00f8rgsel og vender tilbage snarest.',
      meanwhile: 'I mellemtiden:',
      bookLink: 'Book en samtale',
      visitLink: 'Bes\u00f8g vores hjemmeside',
      visitUrl: 'https://www.yogabible.dk'
    },
    en: {
      subject: 'Thank you for reaching out \u2014 Yoga Bible',
      intro: 'Thank you for contacting <strong>Yoga Bible</strong>!',
      body: 'We have received your enquiry and will get back to you shortly.',
      meanwhile: 'In the meantime:',
      bookLink: 'Book a consultation',
      visitLink: 'Visit our website',
      visitUrl: 'https://www.yogabible.dk/en/'
    },
    de: {
      subject: 'Danke für deine Anfrage — Yoga Bible',
      intro: 'Danke, dass du dich an <strong>Yoga Bible</strong> gewandt hast!',
      body: 'Wir haben deine Anfrage erhalten und melden uns schnellstmöglich bei dir.',
      meanwhile: 'In der Zwischenzeit:',
      bookLink: 'Infogespräch buchen',
      visitLink: 'Besuche unsere Website',
      visitUrl: 'https://www.yogabible.dk/en/'
    }
  }
};

// Multi-format comparison email: FORMAT_INFO per language
const MULTI_FORMAT_INFO = {
  da: {
    subject: '{{name}}, dine YTT-skemaer er klar',
    intro: 'Tak fordi du viste interesse for vores <strong>200-timers yogal\u00e6reruddannelse</strong>!',
    compareIntro: 'Jeg kan se, at du gerne vil sammenligne vores <strong>{{formats}}</strong>. Godt t\u00e6nkt \u2014 herunder finder du skemaer og datoer for hvert format.',
    comparisonPromptTitle: '\ud83d\udcad Et hurtigt sp\u00f8rgsm\u00e5l:',
    comparisonPromptBody: 'Jeg kan se du sammenligner flere formater. Er det fordi du har arbejde, studie eller andre forpligtelser, der p\u00e5virker hvilken form der passer bedst?',
    comparisonPromptReply: 'Svar gerne p\u00e5 denne e-mail \u2014 s\u00e5 hj\u00e6lper jeg dig med at finde det perfekte match!',
    overviewTitle: 'Her er en oversigt over de formater du valgte:',
    samePriceNote: 'samme pris for alle formater \u2014 fleksibel ratebetaling',
    seeStudio: 'Har du lyst til at se studiet eller f\u00e5 hj\u00e6lp til at v\u00e6lge det rigtige format?',
    joiner: ' og ',
    formats: {
      '18w':     { name: '18-ugers fleksible program (for\u00e5r)', period: 'marts\u2013juni 2026', desc: 'Det mest fleksible format \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Perfekt hvis du har arbejde, studie eller familie ved siden af.', programType: '18-week' },
      '18w-mar': { name: '18-ugers fleksible program (for\u00e5r)', period: 'marts\u2013juni 2026', desc: 'For\u00e5rsholdet \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs.', programType: '18-week' },
      '18w-aug': { name: '18-ugers fleksible program (efter\u00e5r)', period: 'august\u2013december 2026', desc: 'Efter\u00e5rsholdet \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. Start 10. august, graduation 13. december.', programType: '18-week-aug' },
      '8w':      { name: '8-ugers semi-intensive program', period: 'maj\u2013juni 2026', desc: 'En god balance mellem intensitet og hverdagsliv. Nok fokus til reelle fremskridt, men stadig plads til andre forpligtelser.', programType: '8-week' },
      '4w':      { name: '4-ugers intensive program (april)', period: 'april 2026', desc: 'Fuldt fordybende \u2014 daglig tr\u00e6ning og teori i 4 uger. Complete Program: Hatha, Vinyasa, Yin, Hot Yoga og Meditation.', programType: '4-week' },
      '4w-apr':  { name: '4-ugers Complete Program (april)', period: 'april 2026', desc: 'Fuldt fordybende \u2014 daglig tr\u00e6ning og teori i 4 uger. Hatha, Vinyasa, Yin, Hot Yoga og Meditation.', programType: '4-week' },
      '4w-jul':  { name: '4-ugers Vinyasa Plus (juli)', period: 'juli 2026', desc: '70% Vinyasa Flow \u2014 kreativ sekvensering, klasseledelse og undervisningsteknikker. Plus 30% Yin Yoga + Hot Yoga.', programType: '4-week-jul' }
    }
  },
  en: {
    subject: '{{name}}, your YTT schedules are ready',
    intro: 'Thank you for your interest in our <strong>200-Hour Yoga Teacher Training</strong>!',
    compareIntro: 'I can see that you would like to compare our <strong>{{formats}}</strong>. Great thinking \u2014 below you will find schedules and dates for each format.',
    comparisonPromptTitle: '\ud83d\udcad A quick question:',
    comparisonPromptBody: 'I can see you are comparing multiple formats. Is it because you have work, studies or other commitments that affect which format suits you best?',
    comparisonPromptReply: 'Feel free to reply to this email \u2014 I will help you find the perfect match!',
    overviewTitle: 'Here is an overview of the formats you selected:',
    samePriceNote: 'same price for all formats \u2014 flexible instalments',
    seeStudio: 'Want to visit the studio or get help choosing the right format?',
    joiner: ' and ',
    formats: {
      '18w':     { name: '18-Week Flexible Program (Spring)', period: 'March\u2013June 2026', desc: 'The most flexible format \u2014 choose a weekday or weekend track and switch freely. Perfect if you have work, studies or family alongside.', programType: '18-week' },
      '18w-mar': { name: '18-Week Flexible Program (Spring)', period: 'March\u2013June 2026', desc: 'The spring cohort \u2014 choose weekday or weekend track and switch freely.', programType: '18-week' },
      '18w-aug': { name: '18-Week Flexible Program (Autumn)', period: 'August\u2013December 2026', desc: 'The autumn cohort \u2014 choose weekday or weekend track and switch freely. Start 10 August, graduation 13 December.', programType: '18-week-aug' },
      '8w':      { name: '8-Week Semi-Intensive Program', period: 'May\u2013June 2026', desc: 'A great balance between intensity and daily life. Enough focus for real progress, yet still room for other commitments.', programType: '8-week' },
      '4w':      { name: '4-Week Intensive Program (April)', period: 'April 2026', desc: 'Fully immersive \u2014 daily training and theory over 4 weeks. Complete Program: Hatha, Vinyasa, Yin, Hot Yoga and Meditation.', programType: '4-week' },
      '4w-apr':  { name: '4-Week Complete Program (April)', period: 'April 2026', desc: 'Fully immersive \u2014 daily training and theory over 4 weeks. Hatha, Vinyasa, Yin, Hot Yoga and Meditation.', programType: '4-week' },
      '4w-jul':  { name: '4-Week Vinyasa Plus (July)', period: 'July 2026', desc: '70% Vinyasa Flow \u2014 creative sequencing, class leadership and teaching techniques. Plus 30% Yin Yoga + Hot Yoga.', programType: '4-week-jul' }
    }
  }
};

// Undecided YTT email: format showcase per language
const UNDECIDED_INFO = {
  da: {
    subject: '{{name}}, find dit perfekte yogauddannelsesformat',
    intro: 'Tak for din interesse i vores <strong>200-timers yogal\u00e6reruddannelse</strong>!',
    normalText: 'Det er helt normalt ikke at vide, hvilket format der passer bedst \u2014 det afh\u00e6nger af din hverdag, dine m\u00e5l og din l\u00e6ringsstil. Lad mig give dig et overblik, s\u00e5 du lettere kan v\u00e6lge.',
    sameCertTitle: '\ud83d\udca1 Alle formater giver dig det samme certifikat',
    sameCertBody: 'Uanset hvilket format du v\u00e6lger, f\u00e5r du en <strong>200-timers Yoga Alliance-certificering</strong> med samme pensum: Hatha, Vinyasa, Yin, Hot Yoga, Meditation, anatomi, filosofi og undervisningsmetodik. Max 12 studerende pr. hold.',
    optionsTitle: 'Her er dine muligheder:',
    goodFor: 'God til:',
    stillUndecided: 'Stadig i tvivl?',
    compareBtn: 'Sammenlign alle formater side om side \u2192',
    meetingCta: 'Det bedste du kan g\u00f8re nu? <strong>Book et gratis infom\u00f8de</strong> \u2014 s\u00e5 hj\u00e6lper jeg dig personligt med at finde det rigtige format:',
    replyOk: 'Du er ogs\u00e5 velkommen til bare at svare p\u00e5 denne e-mail med dine sp\u00f8rgsm\u00e5l.',
    samePriceNote: 'samme pris for alle formater \u2014 fleksibel ratebetaling',
    formats: [
      { name: '4-ugers intensiv', period: 'April 2026', emoji: '\ud83d\udd25', desc: 'Fuldt fordybende daglig tr\u00e6ning i 4 uger. Det mest intense format \u2014 perfekt hvis du kan s\u00e6tte alt andet p\u00e5 pause.', goodFor: 'Dig der vil have en komplet immersion og kan dedikere 4 uger fuld tid.', programType: '4-week' },
      { name: '8-ugers semi-intensiv', period: 'Maj\u2013Juni 2026', emoji: '\u26a1', desc: 'En god balance mellem intensitet og hverdagsliv. Nok fokus til reelle fremskridt, men stadig plads til arbejde eller studie.', goodFor: 'Dig der vil have fokuseret uddannelse men har brug for lidt mere tid end 4 uger.', programType: '8-week' },
      { name: '4-ugers Vinyasa Plus', period: 'Juli 2026', emoji: '\ud83c\udf0a', desc: '70% Vinyasa Flow \u2014 kreativ sekvensering, klasseledelse og avancerede undervisningsteknikker. Plus 30% Yin Yoga + Hot Yoga.', goodFor: 'Dig der allerede ved du vil specialisere dig i Vinyasa Flow.', programType: '4-week-jul' },
      { name: '18-ugers fleksibel', period: 'August\u2013December 2026', emoji: '\ud83e\uddd8', desc: 'Det mest fleksible format \u2014 v\u00e6lg hverdags- eller weekendspor og skift frit undervejs. 60 yogaklasser inkluderet.', goodFor: 'Dig der vil tage uddannelsen uden at s\u00e6tte hverdagen p\u00e5 pause.', programType: '18-week-aug' }
    ]
  },
  en: {
    subject: '{{name}}, find your perfect yoga training format',
    intro: 'Thank you for your interest in our <strong>200-Hour Yoga Teacher Training</strong>!',
    normalText: 'It is completely normal not to know which format suits you best \u2014 it depends on your daily life, your goals and your learning style. Let me give you an overview so you can choose more easily.',
    sameCertTitle: '\ud83d\udca1 All formats give you the same certification',
    sameCertBody: 'Regardless of which format you choose, you receive a <strong>200-hour Yoga Alliance certification</strong> with the same curriculum: Hatha, Vinyasa, Yin, Hot Yoga, Meditation, anatomy, philosophy and teaching methodology. Max 12 students per cohort.',
    optionsTitle: 'Here are your options:',
    goodFor: 'Great for:',
    stillUndecided: 'Still undecided?',
    compareBtn: 'Compare all formats side by side \u2192',
    meetingCta: 'The best thing you can do now? <strong>Book a free info session</strong> \u2014 I will personally help you find the right format:',
    replyOk: 'You are also welcome to simply reply to this email with your questions.',
    samePriceNote: 'same price for all formats \u2014 flexible instalments',
    formats: [
      { name: '4-Week Intensive', period: 'April 2026', emoji: '\ud83d\udd25', desc: 'Fully immersive daily training over 4 weeks. The most intense format \u2014 perfect if you can put everything else on hold.', goodFor: 'Those who want a complete immersion and can dedicate 4 full weeks.', programType: '4-week' },
      { name: '8-Week Semi-Intensive', period: 'May\u2013June 2026', emoji: '\u26a1', desc: 'A great balance between intensity and daily life. Enough focus for real progress, yet still room for work or studies.', goodFor: 'Those who want focused training but need a bit more time than 4 weeks.', programType: '8-week' },
      { name: '4-Week Vinyasa Plus', period: 'July 2026', emoji: '\ud83c\udf0a', desc: '70% Vinyasa Flow \u2014 creative sequencing, class leadership and advanced teaching techniques. Plus 30% Yin Yoga + Hot Yoga.', goodFor: 'Those who already know they want to specialise in Vinyasa Flow.', programType: '4-week-jul' },
      { name: '18-Week Flexible', period: 'August\u2013December 2026', emoji: '\ud83e\uddd8', desc: 'The most flexible format \u2014 choose weekday or weekend track and switch freely. 60 yoga classes included.', goodFor: 'Those who want to complete the training without putting daily life on pause.', programType: '18-week-aug' }
    ]
  }
};

module.exports = {
  SHARED,
  PROGRAMS,
  MULTI_FORMAT_INFO,
  UNDECIDED_INFO,
  SCHEDULE_PATHS,
  PROGRAM_PAGES,
  scheduleUrl,
  isCopenhagenLead
};

/**
 * Check if a lead is from the Copenhagen area (based on city_country field).
 * Used to route non-CPH Danish leads to the enhanced EN schedule page
 * (which includes accommodation info they may need).
 */
function isCopenhagenLead(leadData) {
  var city = (leadData.city_country || '').toLowerCase();
  if (!city) return true; // No city info — assume local (conservative: don't show accommodation)
  var cphAreas = [
    'københavn', 'copenhagen', 'cph', 'christianshavn', 'frederiksberg',
    'amager', 'østerbro', 'nørrebro', 'vesterbro', 'valby', 'vanløse',
    'brønshøj', 'hellerup', 'gentofte', 'glostrup', 'hvidovre', 'tårnby',
    'dragør', 'rødovre', 'albertslund', 'ballerup', 'lyngby', 'kongens lyngby'
  ];
  return cphAreas.some(function(a) { return city.indexOf(a) !== -1; });
}
