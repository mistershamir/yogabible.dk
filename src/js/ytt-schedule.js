/**
 * YTT Schedule Page — Interactive schedule with .ics calendar export,
 * conflict detection, and dual-route support (weekday / weekend).
 *
 * URL params: ?program=8w-may-jun-2026  (default)
 *             ?program=18w-feb-jun-2026&route=weekend
 */

(function () {
  'use strict';

  var isDa = window.YTS_LANG === 'da';

  /* ── Translation helper ─────────────────────────── */
  function t(da, en) { return isDa ? da : en; }

  var MONTH_NAMES = isDa
    ? ['Januar','Februar','Marts','April','Maj','Juni','Juli','August','September','Oktober','November','December']
    : ['January','February','March','April','May','June','July','August','September','October','November','December'];

  var DAY_NAMES = isDa
    ? ['Søn','Man','Tir','Ons','Tor','Fre','Lør']
    : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  var DAY_FULL = isDa
    ? ['Søndag','Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag']
    : ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  /* ══════════════════════════════════════════════════
     SCHEDULE DATA
     ══════════════════════════════════════════════════ */

  var SCHEDULES = {

    /* ── 8-Week Semi-Intensive (May–June 2026) ───── */
    '8w-may-jun-2026': {
      title_da: '8 Ugers Semi-Intensiv — Maj–Juni 2026',
      title_en: '8 Weeks Semi-Intensive — May–June 2026',
      subtitle_da: '200-timers yogalæreruddannelse · Yoga Alliance RYT-200 · København',
      subtitle_en: '200-hour yoga teacher training · Yoga Alliance RYT-200 · Copenhagen',
      cert_date: '2026-06-28',
      classes_required: 60,
      classes_deadline: '30. september 2026',
      classes_deadline_en: 'September 30, 2026',
      location: 'Yoga Bible, Torvegade 66, 1400 København K',
      location_en: 'Yoga Bible, Torvegade 66, 1400 Copenhagen K, Denmark',
      note_da: 'Kan du ikke deltage fysisk? Deltag online eller se optagelsen bagefter.',
      note_en: "Can't attend in person? Join online or watch the recording later.",
      prodId: '100121',
      hasRoutes: false,
      weeks: [
        {
          label_da: 'Uge 1 — Introduktion',
          label_en: 'Week 1 — Introduction',
          days: [
            { date: '2026-05-02', start: '13:00', end: '18:00', topic_da: 'Hatha & Class Management — Introduktion', topic_en: 'Hatha & Class Management — Introduction', type: 'workshop' },
            { date: '2026-05-03', start: '14:00', end: '19:00', topic_da: 'Vinyasa & Yin Yoga — Introduktion', topic_en: 'Vinyasa & Yin Yoga — Introduction', type: 'workshop' }
          ]
        },
        {
          label_da: 'Uge 2',
          label_en: 'Week 2',
          days: [
            { date: '2026-05-07', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management', topic_en: 'Hatha & Class Management', type: 'workshop' },
            { date: '2026-05-09', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' },
            { date: '2026-05-10', start: '14:00', end: '18:00', topic_da: 'Yogafilosofi — Online', topic_en: 'Yoga Philosophy — Online', type: 'workshop', online: true },
            { date: '2026-05-11', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' }
          ]
        },
        {
          label_da: 'Uge 3',
          label_en: 'Week 3',
          days: [
            { date: '2026-05-16', start: '13:00', end: '18:00', topic_da: 'Yoga Anatomi', topic_en: 'Yoga Anatomy', type: 'workshop' },
            { date: '2026-05-17', start: '14:00', end: '19:00', topic_da: 'Hatha & Class Management', topic_en: 'Hatha & Class Management', type: 'workshop' },
            { date: '2026-05-18', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' }
          ]
        },
        {
          label_da: 'Uge 4',
          label_en: 'Week 4',
          days: [
            { date: '2026-05-21', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management', topic_en: 'Hatha & Class Management', type: 'workshop' },
            { date: '2026-05-23', start: '13:00', end: '18:00', topic_da: 'Yoga Anatomi', topic_en: 'Yoga Anatomy', type: 'workshop' },
            { date: '2026-05-24', start: '14:00', end: '18:00', topic_da: 'Yogafilosofi — Online', topic_en: 'Yoga Philosophy — Online', type: 'workshop', online: true }
          ]
        },
        {
          label_da: 'Uge 5',
          label_en: 'Week 5',
          days: [
            { date: '2026-05-30', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' },
            { date: '2026-05-31', start: '14:00', end: '19:00', topic_da: 'Hatha & Class Management', topic_en: 'Hatha & Class Management', type: 'workshop' }
          ]
        },
        {
          label_da: 'Uge 6',
          label_en: 'Week 6',
          days: [
            { date: '2026-06-06', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' }
          ]
        },
        {
          label_da: 'Uge 7',
          label_en: 'Week 7',
          days: [
            { date: '2026-06-11', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' },
            { date: '2026-06-13', start: '13:00', end: '18:00', topic_da: 'Yoga Anatomi', topic_en: 'Yoga Anatomy', type: 'workshop' },
            { date: '2026-06-14', start: '14:00', end: '18:00', topic_da: 'Yogafilosofi — Online', topic_en: 'Yoga Philosophy — Online', type: 'workshop', online: true },
            { date: '2026-06-15', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' }
          ]
        },
        {
          label_da: 'Uge 8 — Business & Eksamen',
          label_en: 'Week 8 — Business & Exams',
          days: [
            { date: '2026-06-18', start: '11:00', end: '15:00', topic_da: 'Business of Yoga — Foredrag', topic_en: 'Business of Yoga — Lecture', type: 'workshop' },
            { date: '2026-06-22', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' },
            { date: '2026-06-27', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga — Eksamen', topic_en: 'Vinyasa & Yin Yoga — Exam', type: 'exam' },
            { date: '2026-06-28', start: '14:00', end: '17:00', topic_da: 'Hatha & Class Management — Eksamen + Graduation 🎓', topic_en: 'Hatha & Class Management — Exam + Graduation 🎓', type: 'graduation' }
          ]
        }
      ]
    },

    /* ── 18-Week Flexible (Feb–June 2026) ─────────
       Two routes: weekday (Mon/Wed) & weekend (Sat/Sun)
       Anatomy + Philosophy + Exams are SHARED (same dates for both)
       Each day has route: 'weekday' | 'weekend' | 'shared'
    ──────────────────────────────────────────────── */
    '18w-feb-jun-2026': {
      title_da: '18 Ugers Fleksibelt Program — Feb–Jun 2026',
      title_en: '18 Weeks Flexible Program — Feb–Jun 2026',
      subtitle_da: '200-timers yogalæreruddannelse · Yoga Alliance RYT-200 · København',
      subtitle_en: '200-hour yoga teacher training · Yoga Alliance RYT-200 · Copenhagen',
      cert_date: '2026-06-28',
      classes_required: 60,
      classes_deadline: '30. september 2026',
      classes_deadline_en: 'September 30, 2026',
      location: 'Yoga Bible, Torvegade 66, 1400 København K',
      location_en: 'Yoga Bible, Torvegade 66, 1400 Copenhagen K, Denmark',
      note_da: 'Yoga Anatomi & Filosofi afholdes i weekenden for begge hold.',
      note_en: 'Yoga Anatomy & Philosophy are held during weekends for both groups.',
      prodId: '100121',
      hasRoutes: true,
      routes: {
        weekday: {
          name_da: 'Hverdagsprogram',
          name_en: 'Weekday Program',
          desc_da: 'Mandag & onsdag · kl. 10–15',
          desc_en: 'Monday & Wednesday · 10am–3pm'
        },
        weekend: {
          name_da: 'Weekendprogram',
          name_en: 'Weekend Program',
          desc_da: 'Lørdag & søndag · kl. 13–18 / 14–19',
          desc_en: 'Saturday & Sunday · 1–6pm / 2–7pm'
        }
      },
      weeks: [
        /* ── Week 1: Introduction ── */
        {
          label_da: 'Uge 1 — Introduktion',
          label_en: 'Week 1 — Introduction',
          days: [
            { date: '2026-02-23', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management — Introduktion', topic_en: 'Hatha & Class Management — Introduction', type: 'workshop', route: 'weekday' },
            { date: '2026-02-25', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga — Introduktion', topic_en: 'Vinyasa & Yin Yoga — Introduction', type: 'workshop', route: 'weekday' },
            { date: '2026-02-28', start: '13:00', end: '18:00', topic_da: 'Hatha & Class Management — Introduktion', topic_en: 'Hatha & Class Management — Introduction', type: 'workshop', route: 'weekend' },
            { date: '2026-03-01', start: '14:00', end: '19:00', topic_da: 'Vinyasa & Yin Yoga — Introduktion', topic_en: 'Vinyasa & Yin Yoga — Introduction', type: 'workshop', route: 'weekend' }
          ]
        },
        /* ── Week 2: Anatomy & Philosophy 01 (shared) ── */
        {
          label_da: 'Uge 2 — Anatomi & Filosofi',
          label_en: 'Week 2 — Anatomy & Philosophy',
          days: [
            { date: '2026-03-07', start: '13:00', end: '17:00', topic_da: 'Yoga Anatomi 01', topic_en: 'Yoga Anatomy 01', type: 'workshop', route: 'shared' },
            { date: '2026-03-08', start: '14:00', end: '17:00', topic_da: 'Yogafilosofi 01 — Online', topic_en: 'Yoga Philosophy 01 — Online', type: 'workshop', route: 'shared', online: true }
          ]
        },
        /* ── Week 3: OFF ── */
        {
          label_da: 'Uge 3',
          label_en: 'Week 3',
          off: true,
          off_label_da: 'Fri uge',
          off_label_en: 'Week off'
        },
        /* ── Week 4: Vinyasa & Yin Yoga 02 ── */
        {
          label_da: 'Uge 4',
          label_en: 'Week 4',
          days: [
            { date: '2026-03-16', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 02', topic_en: 'Vinyasa & Yin Yoga 02', type: 'workshop', route: 'weekday' },
            { date: '2026-03-21', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 02', topic_en: 'Vinyasa & Yin Yoga 02', type: 'workshop', route: 'weekend' }
          ]
        },
        /* ── Week 5: HCM 02 + V&Y 03 ── */
        {
          label_da: 'Uge 5',
          label_en: 'Week 5',
          days: [
            { date: '2026-03-23', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management 02', topic_en: 'Hatha & Class Management 02', type: 'workshop', route: 'weekday' },
            { date: '2026-03-25', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 03', topic_en: 'Vinyasa & Yin Yoga 03', type: 'workshop', route: 'weekday' },
            { date: '2026-03-28', start: '13:00', end: '18:00', topic_da: 'Hatha & Class Management 02', topic_en: 'Hatha & Class Management 02', type: 'workshop', route: 'weekend' },
            { date: '2026-03-29', start: '14:00', end: '19:00', topic_da: 'Vinyasa & Yin Yoga 03', topic_en: 'Vinyasa & Yin Yoga 03', type: 'workshop', route: 'weekend' }
          ]
        },
        /* ── Week 6: Easter Break ── */
        {
          label_da: 'Uge 6',
          label_en: 'Week 6',
          off: true,
          off_label_da: 'Påskeferie',
          off_label_en: 'Easter break'
        },
        /* ── Week 7: Anatomy & Philosophy 02 (shared) ── */
        {
          label_da: 'Uge 7 — Anatomi & Filosofi',
          label_en: 'Week 7 — Anatomy & Philosophy',
          days: [
            { date: '2026-04-11', start: '13:00', end: '17:00', topic_da: 'Yoga Anatomi 02', topic_en: 'Yoga Anatomy 02', type: 'workshop', route: 'shared' },
            { date: '2026-04-12', start: '14:00', end: '17:00', topic_da: 'Yogafilosofi 02 — Online', topic_en: 'Yoga Philosophy 02 — Online', type: 'workshop', route: 'shared', online: true }
          ]
        },
        /* ── Week 8: V&Y 04 + HCM 03 ── */
        {
          label_da: 'Uge 8',
          label_en: 'Week 8',
          days: [
            { date: '2026-04-13', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 04', topic_en: 'Vinyasa & Yin Yoga 04', type: 'workshop', route: 'weekday' },
            { date: '2026-04-15', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management 03', topic_en: 'Hatha & Class Management 03', type: 'workshop', route: 'weekday' },
            { date: '2026-04-18', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 04', topic_en: 'Vinyasa & Yin Yoga 04', type: 'workshop', route: 'weekend' },
            { date: '2026-04-19', start: '14:00', end: '19:00', topic_da: 'Hatha & Class Management 03', topic_en: 'Hatha & Class Management 03', type: 'workshop', route: 'weekend' }
          ]
        },
        /* ── Week 9: OFF ── */
        {
          label_da: 'Uge 9',
          label_en: 'Week 9',
          off: true,
          off_label_da: 'Fri uge',
          off_label_en: 'Week off'
        },
        /* ── Week 10: V&Y 05 + HCM 04 ── */
        {
          label_da: 'Uge 10',
          label_en: 'Week 10',
          days: [
            { date: '2026-04-27', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 05', topic_en: 'Vinyasa & Yin Yoga 05', type: 'workshop', route: 'weekday' },
            { date: '2026-04-29', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management 04', topic_en: 'Hatha & Class Management 04', type: 'workshop', route: 'weekday' },
            { date: '2026-05-02', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 05', topic_en: 'Vinyasa & Yin Yoga 05', type: 'workshop', route: 'weekend' },
            { date: '2026-05-03', start: '14:00', end: '19:00', topic_da: 'Hatha & Class Management 04', topic_en: 'Hatha & Class Management 04', type: 'workshop', route: 'weekend' }
          ]
        },
        /* ── Week 11: Anatomy & Philosophy 03 (shared) ── */
        {
          label_da: 'Uge 11 — Anatomi & Filosofi',
          label_en: 'Week 11 — Anatomy & Philosophy',
          days: [
            { date: '2026-05-09', start: '13:00', end: '17:00', topic_da: 'Yoga Anatomi 03', topic_en: 'Yoga Anatomy 03', type: 'workshop', route: 'shared' },
            { date: '2026-05-10', start: '14:00', end: '17:00', topic_da: 'Yogafilosofi 03 — Online', topic_en: 'Yoga Philosophy 03 — Online', type: 'workshop', route: 'shared', online: true }
          ]
        },
        /* ── Week 12: V&Y 06 ── */
        {
          label_da: 'Uge 12',
          label_en: 'Week 12',
          days: [
            { date: '2026-05-11', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 06', topic_en: 'Vinyasa & Yin Yoga 06', type: 'workshop', route: 'weekday' },
            { date: '2026-05-16', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 06', topic_en: 'Vinyasa & Yin Yoga 06', type: 'workshop', route: 'weekend' }
          ]
        },
        /* ── Week 13: V&Y 07 ── */
        {
          label_da: 'Uge 13',
          label_en: 'Week 13',
          days: [
            { date: '2026-05-18', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 07', topic_en: 'Vinyasa & Yin Yoga 07', type: 'workshop', route: 'weekday' },
            { date: '2026-05-23', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 07', topic_en: 'Vinyasa & Yin Yoga 07', type: 'workshop', route: 'weekend' }
          ]
        },
        /* ── Week 14: Anatomy & Philosophy 04 (shared) ── */
        {
          label_da: 'Uge 14 — Anatomi & Filosofi',
          label_en: 'Week 14 — Anatomy & Philosophy',
          days: [
            { date: '2026-05-30', start: '13:00', end: '17:00', topic_da: 'Yoga Anatomi 04', topic_en: 'Yoga Anatomy 04', type: 'workshop', route: 'shared' },
            { date: '2026-05-31', start: '14:00', end: '17:00', topic_da: 'Yogafilosofi 04 — Online', topic_en: 'Yoga Philosophy 04 — Online', type: 'workshop', route: 'shared', online: true }
          ]
        },
        /* ── Week 15: V&Y 08 + HCM 05 ── */
        {
          label_da: 'Uge 15',
          label_en: 'Week 15',
          days: [
            { date: '2026-06-01', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 08', topic_en: 'Vinyasa & Yin Yoga 08', type: 'workshop', route: 'weekday' },
            { date: '2026-06-03', start: '10:00', end: '14:00', topic_da: 'Hatha & Class Management 05', topic_en: 'Hatha & Class Management 05', type: 'workshop', route: 'weekday' },
            { date: '2026-06-06', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 08', topic_en: 'Vinyasa & Yin Yoga 08', type: 'workshop', route: 'weekend' },
            { date: '2026-06-07', start: '14:00', end: '18:00', topic_da: 'Hatha & Class Management 05', topic_en: 'Hatha & Class Management 05', type: 'workshop', route: 'weekend' }
          ]
        },
        /* ── Week 16: V&Y 09 + Business of Yoga ── */
        {
          label_da: 'Uge 16 — Business of Yoga',
          label_en: 'Week 16 — Business of Yoga',
          days: [
            { date: '2026-06-08', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 09', topic_en: 'Vinyasa & Yin Yoga 09', type: 'workshop', route: 'weekday' },
            { date: '2026-06-10', start: '11:00', end: '14:00', topic_da: 'Business of Yoga — Foredrag', topic_en: 'Business of Yoga — Lecture', type: 'workshop', route: 'weekday' },
            { date: '2026-06-13', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 09', topic_en: 'Vinyasa & Yin Yoga 09', type: 'workshop', route: 'weekend' },
            { date: '2026-06-14', start: '14:00', end: '17:00', topic_da: 'Business of Yoga — Foredrag', topic_en: 'Business of Yoga — Lecture', type: 'workshop', route: 'weekend' }
          ]
        },
        /* ── Week 17: OFF (prep for exams) ── */
        {
          label_da: 'Uge 17',
          label_en: 'Week 17',
          off: true,
          off_label_da: 'Fri uge — forbered dig til eksamen',
          off_label_en: 'Week off — prepare for exams'
        },
        /* ── Week 18: Exams & Graduation (shared) ── */
        {
          label_da: 'Uge 18 — Eksamen & Graduation',
          label_en: 'Week 18 — Exams & Graduation',
          days: [
            { date: '2026-06-27', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga — Eksamen', topic_en: 'Vinyasa & Yin Yoga — Exam', type: 'exam', route: 'shared' },
            { date: '2026-06-28', start: '14:00', end: '17:00', topic_da: 'Hatha & Class Management — Eksamen + Graduation 🎓', topic_en: 'Hatha & Class Management — Exam + Graduation 🎓', type: 'graduation', route: 'shared' }
          ]
        }
      ]
    }
  };

  /* ══════════════════════════════════════════════════
     STATE
     ══════════════════════════════════════════════════ */

  var params = new URLSearchParams(window.location.search);
  var programKey = params.get('program') || '8w-may-jun-2026';
  var schedule = SCHEDULES[programKey] || SCHEDULES['8w-may-jun-2026'];
  var activeRoute = params.get('route') || 'weekday';

  /* ── Route helpers ─────────────────────────────── */
  function getVisibleDays(week) {
    if (!week.days) return [];
    if (!schedule.hasRoutes) return week.days;
    return week.days.filter(function (d) {
      return d.route === activeRoute || d.route === 'shared';
    });
  }

  function getAllVisibleDays() {
    var days = [];
    schedule.weeks.forEach(function (w) {
      if (w.off) return;
      getVisibleDays(w).forEach(function (d) { days.push(d); });
    });
    return days;
  }

  /* ══════════════════════════════════════════════════
     PROGRAM SELECTOR
     ══════════════════════════════════════════════════ */

  function renderProgramSelector() {
    var container = document.getElementById('yts-program-selector');
    if (!container) return;

    var programs = [
      { key: '8w-may-jun-2026', label_da: '8 uger · Semi-Intensiv', label_en: '8 weeks · Semi-Intensive', period_da: 'Maj–Jun 2026', period_en: 'May–Jun 2026' },
      { key: '18w-feb-jun-2026', label_da: '18 uger · Fleksibelt', label_en: '18 weeks · Flexible', period_da: 'Feb–Jun 2026', period_en: 'Feb–Jun 2026' }
    ];

    var html = '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">';
    programs.forEach(function (p) {
      var isActive = p.key === programKey;
      var baseUrl = window.location.pathname;
      var href = baseUrl + '?program=' + p.key;
      html += '<a href="' + href + '" style="' +
        'display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 22px;border-radius:50px;font-size:.82rem;text-decoration:none;transition:all .2s;' +
        (isActive
          ? 'background:#f75c03;color:#fff;font-weight:700;'
          : 'background:rgba(255,255,255,.1);color:rgba(255,255,255,.55);font-weight:500;') +
      '">' +
        '<span>' + (isDa ? p.label_da : p.label_en) + '</span>' +
        '<span style="font-size:.7rem;opacity:.75;">' + (isDa ? p.period_da : p.period_en) + '</span>' +
      '</a>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════
     ROUTE TOGGLE
     ══════════════════════════════════════════════════ */

  function renderRouteToggle() {
    var container = document.getElementById('yts-route-toggle');
    if (!container) return;

    if (!schedule.hasRoutes) {
      container.innerHTML = '';
      return;
    }

    var html = '<div style="display:flex;gap:0;background:rgba(255,255,255,.08);border-radius:16px;padding:4px;max-width:480px;margin:0 auto;">';

    ['weekday', 'weekend'].forEach(function (r) {
      var route = schedule.routes[r];
      var isActive = r === activeRoute;
      html += '<button onclick="ytsSetRoute(\'' + r + '\')" style="' +
        'flex:1;padding:14px 20px;border-radius:12px;border:none;cursor:pointer;font-family:inherit;text-align:center;transition:all .25s;' +
        (isActive
          ? 'background:#f75c03;color:#fff;box-shadow:0 4px 12px rgba(247,92,3,.3);'
          : 'background:transparent;color:rgba(255,255,255,.55);') +
      '">';
      html += '<span style="display:block;font-weight:700;font-size:.92rem;">' + (isDa ? route.name_da : route.name_en) + '</span>';
      html += '<span style="display:block;font-size:.72rem;margin-top:3px;opacity:.8;">' + (isDa ? route.desc_da : route.desc_en) + '</span>';
      html += '</button>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  window.ytsSetRoute = function (route) {
    activeRoute = route;
    renderRouteToggle();
    initStats();
    renderSchedule();
    renderTypicalWeek();

    // Remove previous conflict results
    var conflictEl = document.getElementById('yts-conflict-results');
    if (conflictEl) conflictEl.style.display = 'none';

    // Reset any conflict highlights
    document.querySelectorAll('.yts-day').forEach(function (el) {
      el.style.borderColor = '';
      el.style.borderWidth = '';
      el.style.background = '';
    });

    // Update URL without reload
    var url = new URL(window.location);
    url.searchParams.set('route', route);
    history.replaceState(null, '', url);
  };

  /* ══════════════════════════════════════════════════
     POPULATE HERO
     ══════════════════════════════════════════════════ */

  function initHero() {
    var titleEl = document.getElementById('yts-program-title');
    var subtitleEl = document.getElementById('yts-program-subtitle');
    var metaEl = document.getElementById('yts-program-meta');

    if (titleEl) titleEl.textContent = isDa ? schedule.title_da : schedule.title_en;
    if (subtitleEl) subtitleEl.textContent = isDa ? schedule.subtitle_da : schedule.subtitle_en;

    if (metaEl) {
      var chips = [
        { text: t('Yoga Alliance RYT-200', 'Yoga Alliance RYT-200'), color: '#2ecc71' },
        { text: t('Max 12 studerende', 'Max 12 students'), color: '#ff9966' },
        { text: t(schedule.note_da, schedule.note_en), color: 'rgba(255,255,255,.3)' }
      ];
      metaEl.innerHTML = chips.map(function (c) {
        return '<span style="background:' + c.color + ';color:#fff;padding:5px 14px;border-radius:50px;font-size:.78rem;font-weight:600;">' + c.text + '</span>';
      }).join('');
    }

    // Program selector + route toggle
    renderProgramSelector();
    renderRouteToggle();

    // Show/hide shared legend item
    var sharedLegend = document.getElementById('yts-legend-shared');
    if (sharedLegend) sharedLegend.style.display = schedule.hasRoutes ? 'flex' : 'none';

    // Show/hide off legend item
    var offLegend = document.getElementById('yts-legend-off');
    if (offLegend) offLegend.style.display = schedule.hasRoutes ? 'flex' : 'none';
  }

  /* ══════════════════════════════════════════════════
     COUNT STATS
     ══════════════════════════════════════════════════ */

  function initStats() {
    var visibleDays = getAllVisibleDays();
    var totalDays = visibleDays.length;

    // Count active weeks (non-off weeks with visible days)
    var totalWeeks = schedule.weeks.length;

    var daysEl = document.getElementById('yts-stat-days');
    var freeEl = document.getElementById('yts-stat-free');
    var weeksEl = document.getElementById('yts-stat-weeks');

    if (daysEl) daysEl.textContent = totalDays;
    if (weeksEl) weeksEl.textContent = totalWeeks;

    // Calculate free days (calendar span minus training days)
    if (visibleDays.length > 0) {
      var allDates = visibleDays.map(function (d) { return new Date(d.date); });
      allDates.sort(function (a, b) { return a - b; });
      var spanDays = Math.round((allDates[allDates.length - 1] - allDates[0]) / 86400000) + 1;
      var freeDays = spanDays - totalDays;
      if (freeEl) freeEl.textContent = freeDays;
    }
  }

  /* ══════════════════════════════════════════════════
     RENDER SCHEDULE
     ══════════════════════════════════════════════════ */

  function renderSchedule() {
    var container = document.getElementById('yts-weeks-container');
    if (!container) return;

    var html = '';
    var lastMonth = -1;

    schedule.weeks.forEach(function (week, wi) {
      var days = getVisibleDays(week);

      /* ── OFF week ── */
      if (week.off) {
        html += '<div class="yts-week yts-week--off">';
        html += '<div class="yts-week__header yts-week__header--off">';
        html += '<span class="yts-week__number yts-week__number--off">' + (isDa ? week.label_da : week.label_en) + '</span>';
        html += '<span class="yts-week__off-label">' + (isDa ? week.off_label_da : week.off_label_en) + '</span>';
        html += '</div>';
        html += '</div>';
        return;
      }

      /* Skip weeks with no visible days (route filtered) */
      if (days.length === 0) return;

      /* ── Week header ── */
      var firstDate = new Date(days[0].date);
      var lastDate = new Date(days[days.length - 1].date);
      var range = formatDateShort(firstDate) + ' – ' + formatDateShort(lastDate);

      html += '<div class="yts-week">';
      html += '<div class="yts-week__header">';
      html += '<span class="yts-week__number">' + (isDa ? week.label_da : week.label_en) + '</span>';
      html += '<span class="yts-week__range">' + range + '</span>';
      html += '</div>';

      /* ── Days ── */
      days.forEach(function (day) {
        var d = new Date(day.date);
        var m = d.getMonth();

        // Month separator
        if (m !== lastMonth) {
          html += '<div class="yts-month-sep">' + MONTH_NAMES[m] + ' ' + d.getFullYear() + '</div>';
          lastMonth = m;
        }

        var dayType = day.type || 'workshop';
        var isShared = schedule.hasRoutes && day.route === 'shared';
        var cssClass = 'yts-day yts-day--' + dayType;
        if (isShared) cssClass += ' yts-day--shared';

        var topic = isDa ? day.topic_da : day.topic_en;
        var dayOfWeek = DAY_NAMES[d.getDay()];
        var dateNum = d.getDate();
        var timeStr = day.start + ' – ' + day.end;

        var badgeLabel = '';
        var badgeClass = '';
        switch (dayType) {
          case 'workshop':
            badgeLabel = day.online ? 'Online' : t('Workshop', 'Workshop');
            badgeClass = 'yts-day__badge--workshop';
            break;
          case 'exam':
            badgeLabel = t('Eksamen', 'Exam');
            badgeClass = 'yts-day__badge--graduation';
            break;
          case 'graduation':
            badgeLabel = t('Graduation', 'Graduation');
            badgeClass = 'yts-day__badge--graduation';
            break;
          default:
            badgeLabel = t('Workshop', 'Workshop');
            badgeClass = 'yts-day__badge--workshop';
        }

        html += '<div class="' + cssClass + '" data-date="' + day.date + '">';

        // Date column
        html += '<div class="yts-day__date">';
        html += '<div class="yts-day__date-num">' + dateNum + '</div>';
        html += '<div class="yts-day__date-day">' + dayOfWeek + '</div>';
        html += '</div>';

        // Info column
        html += '<div class="yts-day__info">';
        html += '<div class="yts-day__topic">' + topic;
        if (isShared) {
          html += ' <span class="yts-shared-pill">' + t('Begge hold', 'Both groups') + '</span>';
        }
        html += '</div>';
        html += '<div class="yts-day__time">' + timeStr;
        if (day.online) html += ' · <span style="color:#f75c03;">Online</span>';
        html += '</div>';
        html += '</div>';

        // Actions column
        html += '<div style="display:flex;gap:6px;align-items:center;">';
        html += '<span class="yts-day__badge ' + badgeClass + '">' + badgeLabel + '</span>';
        html += '<button class="yts-day__cal-btn" onclick="ytsAddToCalendar(\'' + day.date + '\',\'' + day.start + '\',\'' + day.end + '\',' + JSON.stringify(topic).replace(/'/g, "\\'") + ',' + (day.online ? 'true' : 'false') + ')" title="' + t('Tilføj til kalender', 'Add to calendar') + '">';
        html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>';
        html += '</button>';
        html += '</div>';

        html += '</div>'; // .yts-day
      });

      html += '</div>'; // .yts-week
    });

    // Info cards after schedule
    html += '<div style="margin-top:40px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">';

    // Classes required card
    html += '<div style="background:#FFF8F3;border:1px solid #FFE5D0;border-radius:12px;padding:20px;">';
    html += '<p style="font-weight:700;font-size:.88rem;margin-bottom:6px;">' + t('60 studietimer påkrævet', '60 studio classes required') + '</p>';
    html += '<p style="font-size:.82rem;color:#6F6A66;line-height:1.5;">' + t('Senest ' + schedule.classes_deadline + '. Op til 30 klasser ugentligt (morgen + aften). Op til 20 klasser kan gennemføres andetsteds med dokumentation.', 'By ' + schedule.classes_deadline_en + '. Up to 30 classes weekly (morning + evening). Up to 20 classes may be done elsewhere with documentation.') + '</p>';
    html += '</div>';

    // Certification card
    html += '<div style="background:#f0fff0;border:1px solid #c3e6c3;border-radius:12px;padding:20px;">';
    html += '<p style="font-weight:700;font-size:.88rem;margin-bottom:6px;">' + t('Certificering', 'Certification') + '</p>';
    html += '<p style="font-size:.82rem;color:#6F6A66;line-height:1.5;">' + t('Graduation: 28. juni 2026. Yoga Alliance-bekræftelse udstedes efter 60 klasser er gennemført.', 'Graduation: June 28, 2026. Yoga Alliance confirmation issued after 60 classes are completed.') + '</p>';
    html += '</div>';

    html += '</div>';

    container.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════
     TYPICAL WEEK / ROUTE OVERVIEW
     ══════════════════════════════════════════════════ */

  function renderTypicalWeek() {
    var section = document.getElementById('yts-typical-section');
    if (!section) return;

    /* For 8w program, keep the static Nunjucks content */
    var inner = document.getElementById('yts-typical-inner');
    if (!schedule.hasRoutes) {
      if (inner) inner.style.display = '';
      var dynamic = document.getElementById('yts-typical-dynamic');
      if (dynamic) dynamic.remove();
      return;
    }

    /* For 18w program, replace with route-specific overview */
    if (inner) inner.style.display = 'none';

    var existing = document.getElementById('yts-typical-dynamic');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'yts-typical-dynamic';
      section.querySelector('[style*="max-width"]').appendChild(existing);
    }

    var isWeekday = activeRoute === 'weekday';
    var html = '';

    // Title
    html += '<h2 style="font-size:1.5rem;font-weight:700;margin-bottom:8px;text-align:center;">' +
      t('Din ugestruktur', 'Your weekly structure') + '</h2>';
    html += '<p style="text-align:center;font-size:.88rem;color:#6F6A66;margin-bottom:28px;">' +
      (isDa ? schedule.routes[activeRoute].name_da : schedule.routes[activeRoute].name_en) + ' — ' +
      (isDa ? schedule.routes[activeRoute].desc_da : schedule.routes[activeRoute].desc_en) + '</p>';

    // 7-day grid
    var dayLabels = isDa
      ? ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag']
      : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    var dayTypes, dayDescs, dayTimes;

    if (isWeekday) {
      dayTypes = ['workshop', 'free', 'workshop', 'free', 'free', 'free', 'free'];
      dayDescs = isDa
        ? ['Hatha/Vinyasa workshop', 'Fri dag', 'Hatha/Vinyasa workshop', 'Fri dag', 'Fri dag', 'Anatomi/filosofi*', 'Anatomi/filosofi*']
        : ['Hatha/Vinyasa workshop', 'Free day', 'Hatha/Vinyasa workshop', 'Free day', 'Free day', 'Anatomy/philosophy*', 'Anatomy/philosophy*'];
      dayTimes = ['10:00–15:00', '', '10:00–15:00', '', '', '13:00–17:00', '14:00–17:00'];
      dayTypes[5] = 'shared';
      dayTypes[6] = 'shared';
    } else {
      dayTypes = ['free', 'free', 'free', 'free', 'free', 'weekend', 'weekend'];
      dayDescs = isDa
        ? ['Fri dag', 'Fri dag', 'Fri dag', 'Fri dag', 'Fri dag', 'Hatha/Vinyasa workshop', 'Vinyasa/Yin/Filosofi*']
        : ['Free day', 'Free day', 'Free day', 'Free day', 'Free day', 'Hatha/Vinyasa workshop', 'Vinyasa/Yin/Philosophy*'];
      dayTimes = ['', '', '', '', '', '13:00–18:00', '14:00–19:00'];
    }

    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;" id="yts-typical-grid">';
    for (var i = 0; i < 7; i++) {
      var borderCol = dayTypes[i] === 'workshop' ? '#f75c03'
        : dayTypes[i] === 'weekend' ? '#ff9966'
        : dayTypes[i] === 'shared' ? '#3498db'
        : '#E8E4E0';
      var labelCol = dayTypes[i] === 'workshop' ? '#f75c03'
        : dayTypes[i] === 'weekend' ? '#ff9966'
        : dayTypes[i] === 'shared' ? '#3498db'
        : '#6F6A66';

      html += '<div style="background:#fff;border:1px solid ' + borderCol + ';border-radius:12px;padding:14px 10px;text-align:center;min-height:120px;display:flex;flex-direction:column;justify-content:space-between;">';
      html += '<p style="font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:' + labelCol + ';margin-bottom:8px;">' + dayLabels[i] + '</p>';
      html += '<p style="font-size:.72rem;color:#333;line-height:1.4;flex:1;">' + dayDescs[i] + '</p>';
      if (dayTimes[i]) {
        html += '<p style="font-size:.68rem;color:#6F6A66;margin-top:8px;">' + dayTimes[i] + '</p>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Footnote
    html += '<p style="text-align:center;font-size:.78rem;color:#6F6A66;margin-top:16px;line-height:1.55;">';
    if (isWeekday) {
      html += t(
        '* Anatomi & filosofi afholdes 4 weekender i løbet af programmet — begge hold deltager sammen.',
        '* Anatomy & philosophy are held on 4 weekends during the program — both groups attend together.'
      );
    } else {
      html += t(
        '* Anatomi & filosofi (4 weekender) er allerede inkluderet i dit weekendprogram.',
        '* Anatomy & philosophy (4 weekends) are already included in your weekend schedule.'
      );
    }
    html += '</p>';

    existing.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════
     CONFLICT CHECKER
     ══════════════════════════════════════════════════ */

  function initConflictChecker() {
    var container = document.getElementById('yts-weeks-container');
    if (!container) return;

    var statsSection = document.getElementById('yts-stats');
    if (!statsSection) return;

    var checkerHtml = '<div id="yts-conflict-checker" style="max-width:800px;margin:0 auto;padding:24px 24px 0;">';
    checkerHtml += '<div style="background:#fff;border:1.5px solid #f75c03;border-radius:16px;padding:24px;position:relative;">';
    checkerHtml += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">';
    checkerHtml += '<span style="background:#FFF0E6;color:#f75c03;width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">📅</span>';
    checkerHtml += '<div>';
    checkerHtml += '<p style="font-weight:700;font-size:1rem;">' + t('Tjek dit skema for konflikter', 'Check your schedule for conflicts') + '</p>';
    checkerHtml += '<p style="font-size:.82rem;color:#6F6A66;">' + t('Fortæl os lidt om din hverdag, så finder vi eventuelle overlap.', 'Tell us about your typical week and we\'ll find any overlaps.') + '</p>';
    checkerHtml += '</div>';
    checkerHtml += '</div>';

    // Work schedule form
    checkerHtml += '<div id="yts-conflict-form">';
    checkerHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">';

    // Work days
    checkerHtml += '<div>';
    checkerHtml += '<label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:6px;">' + t('Arbejdsdage', 'Work days') + '</label>';
    checkerHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    var shortDays = isDa ? ['Man','Tir','Ons','Tor','Fre','Lør','Søn'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    var dayIndexMap = [1, 2, 3, 4, 5, 6, 0]; // JS day indices
    shortDays.forEach(function (d, i) {
      var checked = i < 5 ? 'checked' : '';
      checkerHtml += '<label style="display:flex;align-items:center;gap:4px;font-size:.78rem;cursor:pointer;background:#F5F3F0;padding:4px 10px;border-radius:50px;">';
      checkerHtml += '<input type="checkbox" name="yts-workday" value="' + dayIndexMap[i] + '" ' + checked + ' style="accent-color:#f75c03;width:14px;height:14px;">';
      checkerHtml += d + '</label>';
    });
    checkerHtml += '</div></div>';

    // Work hours
    checkerHtml += '<div>';
    checkerHtml += '<label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:6px;">' + t('Arbejdstider', 'Work hours') + '</label>';
    checkerHtml += '<div style="display:flex;align-items:center;gap:8px;">';
    checkerHtml += '<input type="time" id="yts-work-start" value="09:00" style="border:1px solid #E8E4E0;border-radius:8px;padding:6px 10px;font-family:inherit;font-size:.85rem;">';
    checkerHtml += '<span style="color:#6F6A66;">–</span>';
    checkerHtml += '<input type="time" id="yts-work-end" value="17:00" style="border:1px solid #E8E4E0;border-radius:8px;padding:6px 10px;font-family:inherit;font-size:.85rem;">';
    checkerHtml += '</div></div>';

    checkerHtml += '</div>'; // grid

    // Extra commitments
    checkerHtml += '<div style="margin-bottom:16px;">';
    checkerHtml += '<label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:6px;">' + t('Faste aftaler (valgfrit)', 'Regular commitments (optional)') + '</label>';
    checkerHtml += '<textarea id="yts-commitments" placeholder="' + t('F.eks. "Tirsdag 18-20 fodbold", "Henter børn 15:30 dagligt"...', 'E.g. "Tuesday 18-20 football", "Pick up kids 15:30 daily"...') + '" style="width:100%;border:1px solid #E8E4E0;border-radius:8px;padding:10px;font-family:inherit;font-size:.85rem;resize:vertical;min-height:60px;box-sizing:border-box;"></textarea>';
    checkerHtml += '</div>';

    checkerHtml += '<button onclick="ytsCheckConflicts()" style="background:#0F0F0F;color:#fff;border:none;padding:12px 24px;border-radius:50px;font-size:.88rem;font-weight:600;cursor:pointer;font-family:inherit;transition:background .2s;">' + t('Tjek konflikter', 'Check conflicts') + '</button>';

    checkerHtml += '</div>'; // form

    // Results area
    checkerHtml += '<div id="yts-conflict-results" style="display:none;margin-top:20px;"></div>';

    checkerHtml += '</div></div>'; // card, section

    statsSection.insertAdjacentHTML('afterend', checkerHtml);
  }

  /* ── Conflict analysis (route-aware) ────────────── */
  window.ytsCheckConflicts = function () {
    var workDayCbs = document.querySelectorAll('input[name="yts-workday"]:checked');
    var workDays = [];
    workDayCbs.forEach(function (cb) { workDays.push(parseInt(cb.value)); });

    var workStart = document.getElementById('yts-work-start').value || '09:00';
    var workEnd = document.getElementById('yts-work-end').value || '17:00';
    var workStartMin = timeToMinutes(workStart);
    var workEndMin = timeToMinutes(workEnd);

    var conflicts = [];
    var noConflicts = [];

    /* Only check visible days for the active route */
    var visibleDays = getAllVisibleDays();

    visibleDays.forEach(function (day) {
      var d = new Date(day.date);
      var dow = d.getDay();
      var wsStart = timeToMinutes(day.start);
      var wsEnd = timeToMinutes(day.end);
      var topic = isDa ? day.topic_da : day.topic_en;

      if (workDays.indexOf(dow) !== -1) {
        if (wsStart < workEndMin && wsEnd > workStartMin) {
          var overlapStart = Math.max(wsStart, workStartMin);
          var overlapEnd = Math.min(wsEnd, workEndMin);
          conflicts.push({
            date: day.date,
            topic: topic,
            workshopTime: day.start + '–' + day.end,
            overlapHours: ((overlapEnd - overlapStart) / 60).toFixed(1),
            online: day.online,
            shared: day.route === 'shared'
          });
        } else {
          noConflicts.push({ date: day.date, topic: topic, workshopTime: day.start + '–' + day.end });
        }
      } else {
        noConflicts.push({ date: day.date, topic: topic, workshopTime: day.start + '–' + day.end });
      }
    });

    renderConflictResults(conflicts, noConflicts);
  };

  function renderConflictResults(conflicts, noConflicts) {
    var el = document.getElementById('yts-conflict-results');
    if (!el) return;
    el.style.display = 'block';

    var totalDays = conflicts.length + noConflicts.length;
    var html = '';

    if (conflicts.length === 0) {
      html += '<div style="background:#f0fff0;border:1px solid #c3e6c3;border-radius:12px;padding:20px;text-align:center;">';
      html += '<p style="font-size:1.4rem;margin-bottom:8px;">✅</p>';
      html += '<p style="font-weight:700;font-size:1rem;">' + t('Ingen konflikter fundet!', 'No conflicts found!') + '</p>';
      html += '<p style="font-size:.85rem;color:#6F6A66;margin-top:6px;">' + t('Alle ' + totalDays + ' workshopdatoer passer med din arbejdsplan.', 'All ' + totalDays + ' workshop dates fit your work schedule.') + '</p>';
      html += '</div>';
    } else {
      var pct = Math.round((noConflicts.length / totalDays) * 100);
      html += '<div style="background:#FFF8F3;border:1px solid #FFE5D0;border-radius:12px;padding:20px;margin-bottom:16px;">';
      html += '<p style="font-weight:700;font-size:1rem;margin-bottom:8px;">';
      html += conflicts.length + t(' konflikter fundet af ' + totalDays + ' datoer', ' conflicts found out of ' + totalDays + ' dates');
      html += '</p>';

      // Progress bar
      html += '<div style="background:#E8E4E0;border-radius:50px;height:8px;overflow:hidden;margin-bottom:12px;">';
      html += '<div style="background:#2ecc71;height:100%;width:' + pct + '%;border-radius:50px;transition:width .5s;"></div>';
      html += '</div>';
      html += '<p style="font-size:.82rem;color:#6F6A66;">' + pct + '% ' + t('af datoerne passer. Husk: du kan deltage online på mange workshops.', 'of dates fit. Remember: you can join many workshops online.') + '</p>';

      // Route switch suggestion for 18w
      if (schedule.hasRoutes) {
        var altRoute = activeRoute === 'weekday' ? 'weekend' : 'weekday';
        var altName = isDa ? schedule.routes[altRoute].name_da : schedule.routes[altRoute].name_en;
        html += '<p style="font-size:.82rem;color:#f75c03;margin-top:8px;cursor:pointer;" onclick="ytsSetRoute(\'' + altRoute + '\')">';
        html += '→ ' + t('Prøv ' + altName + ' i stedet?', 'Try ' + altName + ' instead?') + '</p>';
      }

      html += '</div>';

      // Conflict list
      html += '<div style="margin-bottom:12px;">';
      conflicts.forEach(function (c) {
        var d = new Date(c.date);
        html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fff;border:1px solid #FFE5D0;border-radius:10px;margin-bottom:6px;">';
        html += '<span style="color:#e74c3c;font-size:1.1rem;">⚠️</span>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<p style="font-weight:600;font-size:.88rem;">' + formatDateShort(d) + ' · ' + c.workshopTime + '</p>';
        html += '<p style="font-size:.78rem;color:#6F6A66;">' + c.topic + ' · ' + c.overlapHours + t(' timers overlap', ' hours overlap') + '</p>';
        html += '</div>';
        if (c.online) {
          html += '<span style="background:#f0fff0;color:#2ecc71;padding:3px 10px;border-radius:50px;font-size:.72rem;font-weight:600;">' + t('Online mulig', 'Online available') + '</span>';
        }
        if (c.shared) {
          html += '<span style="background:#EBF5FB;color:#3498db;padding:3px 10px;border-radius:50px;font-size:.72rem;font-weight:600;">' + t('Begge hold', 'Both groups') + '</span>';
        }
        html += '</div>';
      });
      html += '</div>';

      // Reassurance
      html += '<div style="background:#F5F3F0;border-radius:12px;padding:16px;font-size:.85rem;color:#6F6A66;line-height:1.55;">';
      html += '<strong style="color:#0F0F0F;">' + t('Godt at vide:', 'Good to know:') + '</strong> ';
      html += t(
        'De fleste studerende kombinerer uddannelsen med deltidsarbejde. Du kan deltage online på nogle workshops, og vi tilbyder fleksible løsninger. Book et infomøde, så finder vi den bedste plan sammen.',
        'Most students combine the training with part-time work. You can attend some workshops online, and we offer flexible solutions. Book an info session and we\'ll find the best plan together.'
      );
      html += '</div>';
    }

    el.innerHTML = html;

    // Highlight conflicting dates
    conflicts.forEach(function (c) {
      var dayEl = document.querySelector('.yts-day[data-date="' + c.date + '"]');
      if (dayEl) {
        dayEl.style.borderColor = '#e74c3c';
        dayEl.style.borderWidth = '2px';
        dayEl.style.background = '#fff5f5';
      }
    });
    noConflicts.forEach(function (c) {
      var dayEl = document.querySelector('.yts-day[data-date="' + c.date + '"]');
      if (dayEl && dayEl.style.borderColor !== 'rgb(231, 76, 60)') {
        dayEl.style.borderColor = '#2ecc71';
      }
    });
  }

  /* ══════════════════════════════════════════════════
     .ICS CALENDAR EXPORT (route-aware)
     ══════════════════════════════════════════════════ */

  function generateICS(events) {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Yoga Bible//YTT Schedule//DA',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + (isDa ? schedule.title_da : schedule.title_en),
      'X-WR-TIMEZONE:Europe/Copenhagen'
    ];

    events.forEach(function (evt) {
      var dtStart = formatICSDate(evt.date, evt.start);
      var dtEnd = formatICSDate(evt.date, evt.end);
      var loc = evt.online ? 'Online' : (isDa ? schedule.location : schedule.location_en);
      var summary = t(schedule.title_da, schedule.title_en).split('—')[0].trim() + ' — ' + evt.topic;

      lines.push('BEGIN:VEVENT');
      lines.push('DTSTART;TZID=Europe/Copenhagen:' + dtStart);
      lines.push('DTEND;TZID=Europe/Copenhagen:' + dtEnd);
      lines.push('SUMMARY:' + escapeICS(summary));
      lines.push('LOCATION:' + escapeICS(loc));
      lines.push('DESCRIPTION:' + escapeICS(t('Yoga Bible — Yogalæreruddannelse', 'Yoga Bible — Yoga Teacher Training') + '\\n' + loc));
      lines.push('STATUS:CONFIRMED');
      lines.push('UID:' + evt.date + '-' + evt.start.replace(':', '') + '-' + (activeRoute || 'all') + '@yogabible.dk');
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  window.ytsAddToCalendar = function (date, start, end, topic, online) {
    var ics = generateICS([{ date: date, start: start, end: end, topic: topic, online: online }]);
    downloadICS(ics, 'yoga-bible-' + date + '.ics');
  };

  window.ytsAddAllToCalendar = function () {
    var visibleDays = getAllVisibleDays();
    var events = visibleDays.map(function (d) {
      return {
        date: d.date,
        start: d.start,
        end: d.end,
        topic: isDa ? d.topic_da : d.topic_en,
        online: d.online
      };
    });
    var routeSuffix = schedule.hasRoutes ? '-' + activeRoute : '';
    var ics = generateICS(events);
    downloadICS(ics, 'yoga-bible-ytt' + routeSuffix + '-schedule.ics');
  };

  function downloadICS(content, filename) {
    var blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ══════════════════════════════════════════════════
     UTILITY
     ══════════════════════════════════════════════════ */

  function formatICSDate(dateStr, timeStr) {
    return dateStr.replace(/-/g, '') + 'T' + timeStr.replace(':', '') + '00';
  }

  function escapeICS(str) {
    return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function formatDateShort(d) {
    return d.getDate() + '. ' + MONTH_NAMES[d.getMonth()].substring(0, 3);
  }

  function timeToMinutes(timeStr) {
    var parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }

  /* ══════════════════════════════════════════════════
     PREP CTA WIRING
     ══════════════════════════════════════════════════ */

  function initPrepCta() {
    var btn = document.getElementById('yts-prep-cta');
    if (btn && schedule.prodId) {
      btn.addEventListener('click', function () {
        if (window.startCheckoutFunnel) {
          window.startCheckoutFunnel(schedule.prodId);
        } else if (window.openCheckoutFlow) {
          window.openCheckoutFlow(schedule.prodId);
        }
      });
    }
  }

  /* ══════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════ */

  function init() {
    initHero();
    initStats();
    renderSchedule();
    initConflictChecker();
    renderTypicalWeek();
    initPrepCta();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
