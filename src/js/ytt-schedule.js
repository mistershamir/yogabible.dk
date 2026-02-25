/**
 * YTT Schedule Page — Interactive schedule with .ics calendar export,
 * conflict detection, and dual-route support (weekday / weekend).
 *
 * URL params: ?program=8w-may-jun-2026  (default)
 *             ?program=18w-feb-jun-2026
 *             ?program=18w-feb-jun-2026&route=weekday
 *
 * Route states for 18w: 'both' (default), 'weekday', 'weekend'
 */

(function () {
  'use strict';

  var isDa = window.YTS_LANG === 'da';
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
        { label_da: 'Uge 1 — Introduktion', label_en: 'Week 1 — Introduction', days: [
          { date: '2026-05-02', start: '13:00', end: '18:00', topic_da: 'Hatha & Class Management — Introduktion', topic_en: 'Hatha & Class Management — Introduction', type: 'workshop' },
          { date: '2026-05-03', start: '14:00', end: '19:00', topic_da: 'Vinyasa & Yin Yoga — Introduktion', topic_en: 'Vinyasa & Yin Yoga — Introduction', type: 'workshop' }
        ]},
        { label_da: 'Uge 2', label_en: 'Week 2', days: [
          { date: '2026-05-07', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management', topic_en: 'Hatha & Class Management', type: 'workshop' },
          { date: '2026-05-09', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' },
          { date: '2026-05-10', start: '14:00', end: '18:00', topic_da: 'Yogafilosofi — Online', topic_en: 'Yoga Philosophy — Online', type: 'workshop', online: true },
          { date: '2026-05-11', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' }
        ]},
        { label_da: 'Uge 3', label_en: 'Week 3', days: [
          { date: '2026-05-16', start: '13:00', end: '18:00', topic_da: 'Yoga Anatomi', topic_en: 'Yoga Anatomy', type: 'workshop' },
          { date: '2026-05-17', start: '14:00', end: '19:00', topic_da: 'Hatha & Class Management', topic_en: 'Hatha & Class Management', type: 'workshop' },
          { date: '2026-05-18', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' }
        ]},
        { label_da: 'Uge 4', label_en: 'Week 4', days: [
          { date: '2026-05-21', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management', topic_en: 'Hatha & Class Management', type: 'workshop' },
          { date: '2026-05-23', start: '13:00', end: '18:00', topic_da: 'Yoga Anatomi', topic_en: 'Yoga Anatomy', type: 'workshop' },
          { date: '2026-05-24', start: '14:00', end: '18:00', topic_da: 'Yogafilosofi — Online', topic_en: 'Yoga Philosophy — Online', type: 'workshop', online: true }
        ]},
        { label_da: 'Uge 5', label_en: 'Week 5', days: [
          { date: '2026-05-30', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' },
          { date: '2026-05-31', start: '14:00', end: '19:00', topic_da: 'Hatha & Class Management', topic_en: 'Hatha & Class Management', type: 'workshop' }
        ]},
        { label_da: 'Uge 6', label_en: 'Week 6', days: [
          { date: '2026-06-06', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' }
        ]},
        { label_da: 'Uge 7', label_en: 'Week 7', days: [
          { date: '2026-06-11', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' },
          { date: '2026-06-13', start: '13:00', end: '18:00', topic_da: 'Yoga Anatomi', topic_en: 'Yoga Anatomy', type: 'workshop' },
          { date: '2026-06-14', start: '14:00', end: '18:00', topic_da: 'Yogafilosofi — Online', topic_en: 'Yoga Philosophy — Online', type: 'workshop', online: true },
          { date: '2026-06-15', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' }
        ]},
        { label_da: 'Uge 8 — Business & Eksamen', label_en: 'Week 8 — Business & Exams', days: [
          { date: '2026-06-18', start: '11:00', end: '15:00', topic_da: 'Business of Yoga — Foredrag', topic_en: 'Business of Yoga — Lecture', type: 'workshop' },
          { date: '2026-06-22', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga', topic_en: 'Vinyasa & Yin Yoga', type: 'workshop' },
          { date: '2026-06-27', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga — Eksamen', topic_en: 'Vinyasa & Yin Yoga — Exam', type: 'exam' },
          { date: '2026-06-28', start: '14:00', end: '17:00', topic_da: 'Hatha & Class Management — Eksamen + Graduation 🎓', topic_en: 'Hatha & Class Management — Exam + Graduation 🎓', type: 'graduation' }
        ]}
      ]
    },

    /* ── 18-Week Flexible (Feb–June 2026) ───────── */
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
        weekday: { name_da: 'Hverdagshold', name_en: 'Weekday Track', desc_da: 'Man & ons · kl. 10–15', desc_en: 'Mon & Wed · 10am–3pm' },
        weekend: { name_da: 'Weekendhold', name_en: 'Weekend Track', desc_da: 'Lør & søn · kl. 13–18 / 14–19', desc_en: 'Sat & Sun · 1–6pm / 2–7pm' }
      },
      weeks: [
        { label_da: 'Uge 1 — Introduktion', label_en: 'Week 1 — Introduction', days: [
          { date: '2026-02-23', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management — Introduktion', topic_en: 'Hatha & Class Management — Introduction', type: 'workshop', route: 'weekday' },
          { date: '2026-02-25', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga — Introduktion', topic_en: 'Vinyasa & Yin Yoga — Introduction', type: 'workshop', route: 'weekday' },
          { date: '2026-02-28', start: '13:00', end: '18:00', topic_da: 'Hatha & Class Management — Introduktion', topic_en: 'Hatha & Class Management — Introduction', type: 'workshop', route: 'weekend' },
          { date: '2026-03-01', start: '14:00', end: '19:00', topic_da: 'Vinyasa & Yin Yoga — Introduktion', topic_en: 'Vinyasa & Yin Yoga — Introduction', type: 'workshop', route: 'weekend' }
        ]},
        { label_da: 'Uge 2 — Anatomi & Filosofi', label_en: 'Week 2 — Anatomy & Philosophy', days: [
          { date: '2026-03-07', start: '13:00', end: '17:00', topic_da: 'Yoga Anatomi 01', topic_en: 'Yoga Anatomy 01', type: 'workshop', route: 'shared' },
          { date: '2026-03-08', start: '14:00', end: '17:00', topic_da: 'Yogafilosofi 01 — Online', topic_en: 'Yoga Philosophy 01 — Online', type: 'workshop', route: 'shared', online: true }
        ]},
        { label_da: 'Uge 3', label_en: 'Week 3', off: true, off_label_da: 'Fri uge', off_label_en: 'Week off' },
        { label_da: 'Uge 4', label_en: 'Week 4', days: [
          { date: '2026-03-16', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 02', topic_en: 'Vinyasa & Yin Yoga 02', type: 'workshop', route: 'weekday' },
          { date: '2026-03-21', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 02', topic_en: 'Vinyasa & Yin Yoga 02', type: 'workshop', route: 'weekend' }
        ]},
        { label_da: 'Uge 5', label_en: 'Week 5', days: [
          { date: '2026-03-23', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management 02', topic_en: 'Hatha & Class Management 02', type: 'workshop', route: 'weekday' },
          { date: '2026-03-25', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 03', topic_en: 'Vinyasa & Yin Yoga 03', type: 'workshop', route: 'weekday' },
          { date: '2026-03-28', start: '13:00', end: '18:00', topic_da: 'Hatha & Class Management 02', topic_en: 'Hatha & Class Management 02', type: 'workshop', route: 'weekend' },
          { date: '2026-03-29', start: '14:00', end: '19:00', topic_da: 'Vinyasa & Yin Yoga 03', topic_en: 'Vinyasa & Yin Yoga 03', type: 'workshop', route: 'weekend' }
        ]},
        { label_da: 'Uge 6', label_en: 'Week 6', off: true, off_label_da: 'Påskeferie', off_label_en: 'Easter break' },
        { label_da: 'Uge 7 — Anatomi & Filosofi', label_en: 'Week 7 — Anatomy & Philosophy', days: [
          { date: '2026-04-11', start: '13:00', end: '17:00', topic_da: 'Yoga Anatomi 02', topic_en: 'Yoga Anatomy 02', type: 'workshop', route: 'shared' },
          { date: '2026-04-12', start: '14:00', end: '17:00', topic_da: 'Yogafilosofi 02 — Online', topic_en: 'Yoga Philosophy 02 — Online', type: 'workshop', route: 'shared', online: true }
        ]},
        { label_da: 'Uge 8', label_en: 'Week 8', days: [
          { date: '2026-04-13', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 04', topic_en: 'Vinyasa & Yin Yoga 04', type: 'workshop', route: 'weekday' },
          { date: '2026-04-15', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management 03', topic_en: 'Hatha & Class Management 03', type: 'workshop', route: 'weekday' },
          { date: '2026-04-18', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 04', topic_en: 'Vinyasa & Yin Yoga 04', type: 'workshop', route: 'weekend' },
          { date: '2026-04-19', start: '14:00', end: '19:00', topic_da: 'Hatha & Class Management 03', topic_en: 'Hatha & Class Management 03', type: 'workshop', route: 'weekend' }
        ]},
        { label_da: 'Uge 9', label_en: 'Week 9', off: true, off_label_da: 'Fri uge', off_label_en: 'Week off' },
        { label_da: 'Uge 10', label_en: 'Week 10', days: [
          { date: '2026-04-27', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 05', topic_en: 'Vinyasa & Yin Yoga 05', type: 'workshop', route: 'weekday' },
          { date: '2026-04-29', start: '10:00', end: '15:00', topic_da: 'Hatha & Class Management 04', topic_en: 'Hatha & Class Management 04', type: 'workshop', route: 'weekday' },
          { date: '2026-05-02', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 05', topic_en: 'Vinyasa & Yin Yoga 05', type: 'workshop', route: 'weekend' },
          { date: '2026-05-03', start: '14:00', end: '19:00', topic_da: 'Hatha & Class Management 04', topic_en: 'Hatha & Class Management 04', type: 'workshop', route: 'weekend' }
        ]},
        { label_da: 'Uge 11 — Anatomi & Filosofi', label_en: 'Week 11 — Anatomy & Philosophy', days: [
          { date: '2026-05-09', start: '13:00', end: '17:00', topic_da: 'Yoga Anatomi 03', topic_en: 'Yoga Anatomy 03', type: 'workshop', route: 'shared' },
          { date: '2026-05-10', start: '14:00', end: '17:00', topic_da: 'Yogafilosofi 03 — Online', topic_en: 'Yoga Philosophy 03 — Online', type: 'workshop', route: 'shared', online: true }
        ]},
        { label_da: 'Uge 12', label_en: 'Week 12', days: [
          { date: '2026-05-11', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 06', topic_en: 'Vinyasa & Yin Yoga 06', type: 'workshop', route: 'weekday' },
          { date: '2026-05-16', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 06', topic_en: 'Vinyasa & Yin Yoga 06', type: 'workshop', route: 'weekend' }
        ]},
        { label_da: 'Uge 13', label_en: 'Week 13', days: [
          { date: '2026-05-18', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 07', topic_en: 'Vinyasa & Yin Yoga 07', type: 'workshop', route: 'weekday' },
          { date: '2026-05-23', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 07', topic_en: 'Vinyasa & Yin Yoga 07', type: 'workshop', route: 'weekend' }
        ]},
        { label_da: 'Uge 14 — Anatomi & Filosofi', label_en: 'Week 14 — Anatomy & Philosophy', days: [
          { date: '2026-05-30', start: '13:00', end: '17:00', topic_da: 'Yoga Anatomi 04', topic_en: 'Yoga Anatomy 04', type: 'workshop', route: 'shared' },
          { date: '2026-05-31', start: '14:00', end: '17:00', topic_da: 'Yogafilosofi 04 — Online', topic_en: 'Yoga Philosophy 04 — Online', type: 'workshop', route: 'shared', online: true }
        ]},
        { label_da: 'Uge 15', label_en: 'Week 15', days: [
          { date: '2026-06-01', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 08', topic_en: 'Vinyasa & Yin Yoga 08', type: 'workshop', route: 'weekday' },
          { date: '2026-06-03', start: '10:00', end: '14:00', topic_da: 'Hatha & Class Management 05', topic_en: 'Hatha & Class Management 05', type: 'workshop', route: 'weekday' },
          { date: '2026-06-06', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 08', topic_en: 'Vinyasa & Yin Yoga 08', type: 'workshop', route: 'weekend' },
          { date: '2026-06-07', start: '14:00', end: '18:00', topic_da: 'Hatha & Class Management 05', topic_en: 'Hatha & Class Management 05', type: 'workshop', route: 'weekend' }
        ]},
        { label_da: 'Uge 16 — Business of Yoga', label_en: 'Week 16 — Business of Yoga', days: [
          { date: '2026-06-08', start: '10:00', end: '15:00', topic_da: 'Vinyasa & Yin Yoga 09', topic_en: 'Vinyasa & Yin Yoga 09', type: 'workshop', route: 'weekday' },
          { date: '2026-06-10', start: '11:00', end: '14:00', topic_da: 'Business of Yoga — Foredrag', topic_en: 'Business of Yoga — Lecture', type: 'workshop', route: 'weekday' },
          { date: '2026-06-13', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga 09', topic_en: 'Vinyasa & Yin Yoga 09', type: 'workshop', route: 'weekend' },
          { date: '2026-06-14', start: '14:00', end: '17:00', topic_da: 'Business of Yoga — Foredrag', topic_en: 'Business of Yoga — Lecture', type: 'workshop', route: 'weekend' }
        ]},
        { label_da: 'Uge 17', label_en: 'Week 17', off: true, off_label_da: 'Fri uge — forbered dig til eksamen', off_label_en: 'Week off — prepare for exams' },
        { label_da: 'Uge 18 — Eksamen & Graduation', label_en: 'Week 18 — Exams & Graduation', days: [
          { date: '2026-06-27', start: '13:00', end: '18:00', topic_da: 'Vinyasa & Yin Yoga — Eksamen', topic_en: 'Vinyasa & Yin Yoga — Exam', type: 'exam', route: 'shared' },
          { date: '2026-06-28', start: '14:00', end: '17:00', topic_da: 'Hatha & Class Management — Eksamen + Graduation 🎓', topic_en: 'Hatha & Class Management — Exam + Graduation 🎓', type: 'graduation', route: 'shared' }
        ]}
      ]
    }
  };

  /* ══════════════════════════════════════════════════
     STATE
     ══════════════════════════════════════════════════ */

  var params = new URLSearchParams(window.location.search);
  var programKey = params.get('program') || '8w-may-jun-2026';
  var schedule = SCHEDULES[programKey] || SCHEDULES['8w-may-jun-2026'];
  var activeRoute = params.get('route') || (schedule.hasRoutes ? 'both' : 'all');

  /* ── Helpers ─────────────────────────────────────── */
  function getRouteDays(week, route) {
    if (!week.days) return [];
    if (!schedule.hasRoutes) return week.days;
    var r = route || activeRoute;
    if (r === 'both') return week.days;
    return week.days.filter(function (d) { return d.route === r || d.route === 'shared'; });
  }

  /** Returns days the student actually attends for one route (for stats/ics) */
  function getAttendDays(route) {
    var r = route || (activeRoute === 'both' ? 'weekday' : activeRoute);
    var days = [];
    schedule.weeks.forEach(function (w) {
      if (w.off || !w.days) return;
      w.days.forEach(function (d) {
        if (d.route === r || d.route === 'shared') days.push(d);
      });
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
      { key: '8w-may-jun-2026', label_da: '8 uger · Semi-Intensiv', label_en: '8 weeks · Semi-Intensive', period_da: 'Maj–Jun', period_en: 'May–Jun' },
      { key: '18w-feb-jun-2026', label_da: '18 uger · Fleksibelt', label_en: '18 weeks · Flexible', period_da: 'Feb–Jun', period_en: 'Feb–Jun' }
    ];
    var html = '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">';
    programs.forEach(function (p) {
      var isActive = p.key === programKey;
      html += '<a href="' + window.location.pathname + '?program=' + p.key + '" style="' +
        'display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 22px;border-radius:50px;font-size:.82rem;text-decoration:none;transition:all .2s;' +
        (isActive ? 'background:#f75c03;color:#fff;font-weight:700;' : 'background:rgba(255,255,255,.1);color:rgba(255,255,255,.55);font-weight:500;') +
      '"><span>' + (isDa ? p.label_da : p.label_en) + '</span>' +
        '<span style="font-size:.7rem;opacity:.75;">' + (isDa ? p.period_da : p.period_en) + '</span></a>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════
     ROUTE TOGGLE  (both | weekday | weekend)
     ══════════════════════════════════════════════════ */

  function renderRouteToggle() {
    var container = document.getElementById('yts-route-toggle');
    if (!container) return;
    if (!schedule.hasRoutes) { container.innerHTML = ''; return; }

    var options = [
      { key: 'both',    label_da: 'Samlet overblik',  label_en: 'Full overview',    desc_da: 'Se begge hold', desc_en: 'See both tracks' },
      { key: 'weekday', label_da: schedule.routes.weekday.name_da, label_en: schedule.routes.weekday.name_en, desc_da: schedule.routes.weekday.desc_da, desc_en: schedule.routes.weekday.desc_en },
      { key: 'weekend', label_da: schedule.routes.weekend.name_da, label_en: schedule.routes.weekend.name_en, desc_da: schedule.routes.weekend.desc_da, desc_en: schedule.routes.weekend.desc_en }
    ];

    var html = '<div style="display:flex;gap:0;background:rgba(255,255,255,.08);border-radius:16px;padding:4px;max-width:560px;margin:0 auto;">';
    options.forEach(function (o) {
      var isActive = o.key === activeRoute;
      html += '<button onclick="ytsSetRoute(\'' + o.key + '\')" style="' +
        'flex:1;padding:12px 14px;border-radius:12px;border:none;cursor:pointer;font-family:inherit;text-align:center;transition:all .25s;' +
        (isActive ? 'background:#f75c03;color:#fff;box-shadow:0 4px 12px rgba(247,92,3,.3);' : 'background:transparent;color:rgba(255,255,255,.55);') +
      '"><span style="display:block;font-weight:700;font-size:.85rem;">' + (isDa ? o.label_da : o.label_en) + '</span>' +
        '<span style="display:block;font-size:.68rem;margin-top:2px;opacity:.8;">' + (isDa ? o.desc_da : o.desc_en) + '</span></button>';
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
    updateCalendarButtons();
    var cr = document.getElementById('yts-conflict-results');
    if (cr) cr.style.display = 'none';
    var url = new URL(window.location);
    if (route === 'both') { url.searchParams.delete('route'); } else { url.searchParams.set('route', route); }
    history.replaceState(null, '', url);
  };

  /* ══════════════════════════════════════════════════
     HERO
     ══════════════════════════════════════════════════ */

  function initHero() {
    var titleEl = document.getElementById('yts-program-title');
    var subtitleEl = document.getElementById('yts-program-subtitle');
    var metaEl = document.getElementById('yts-program-meta');
    if (titleEl) titleEl.textContent = isDa ? schedule.title_da : schedule.title_en;
    if (subtitleEl) subtitleEl.textContent = isDa ? schedule.subtitle_da : schedule.subtitle_en;
    if (metaEl) {
      var chips = [
        { text: 'Yoga Alliance RYT-200', color: '#2ecc71' },
        { text: t('Max 12 studerende', 'Max 12 students'), color: '#ff9966' },
        { text: t(schedule.note_da, schedule.note_en), color: 'rgba(255,255,255,.3)' }
      ];
      metaEl.innerHTML = chips.map(function (c) {
        return '<span style="background:' + c.color + ';color:#fff;padding:5px 14px;border-radius:50px;font-size:.78rem;font-weight:600;">' + c.text + '</span>';
      }).join('');
    }
    renderProgramSelector();
    renderRouteToggle();
    updateCalendarButtons();
    var sl = document.getElementById('yts-legend-shared');
    if (sl) sl.style.display = schedule.hasRoutes ? 'flex' : 'none';
    var ol = document.getElementById('yts-legend-off');
    if (ol) ol.style.display = schedule.hasRoutes ? 'flex' : 'none';
  }

  function updateCalendarButtons() {
    var btn = document.getElementById('yts-add-all-btn');
    if (!btn) return;
    if (!schedule.hasRoutes || activeRoute !== 'both') {
      btn.style.display = 'inline-flex';
      btn.onclick = function () { window.ytsAddAllToCalendar(); };
      return;
    }
    // In 'both' mode, replace single button with two
    btn.style.display = 'none';
    var existingPair = document.getElementById('yts-cal-pair');
    if (existingPair) existingPair.remove();
    var wrap = document.createElement('div');
    wrap.id = 'yts-cal-pair';
    wrap.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:8px;';
    ['weekday','weekend'].forEach(function (r) {
      var b = document.createElement('button');
      b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);color:#fff;border:1.5px solid rgba(255,255,255,.3);padding:10px 20px;border-radius:50px;font-size:.85rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s;';
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ' +
        (isDa ? schedule.routes[r].name_da : schedule.routes[r].name_en);
      b.onclick = (function (route) { return function () { ytsExportRoute(route); }; })(r);
      wrap.appendChild(b);
    });
    btn.parentNode.insertBefore(wrap, btn.nextSibling);
  }

  /* ══════════════════════════════════════════════════
     STATS
     ══════════════════════════════════════════════════ */

  function initStats() {
    var attend = getAttendDays();
    var totalDays = attend.length;
    var totalWeeks = schedule.weeks.length;
    var daysEl = document.getElementById('yts-stat-days');
    var freeEl = document.getElementById('yts-stat-free');
    var weeksEl = document.getElementById('yts-stat-weeks');
    if (daysEl) daysEl.textContent = totalDays;
    if (weeksEl) weeksEl.textContent = totalWeeks;
    if (attend.length > 0) {
      var dates = attend.map(function (d) { return new Date(d.date); }).sort(function (a, b) { return a - b; });
      var span = Math.round((dates[dates.length - 1] - dates[0]) / 86400000) + 1;
      if (freeEl) freeEl.textContent = span - totalDays;
    }
  }

  /* ══════════════════════════════════════════════════
     RENDER SCHEDULE
     ══════════════════════════════════════════════════ */

  function renderSchedule() {
    if (schedule.hasRoutes && activeRoute === 'both') { renderBothView(); return; }
    renderSingleRouteView();
  }

  /* ── Single-route view (8w, or filtered 18w) ── */
  function renderSingleRouteView() {
    var container = document.getElementById('yts-weeks-container');
    if (!container) return;
    var html = '';
    var lastMonth = -1;

    schedule.weeks.forEach(function (week) {
      if (week.off) { html += offWeekHtml(week); return; }
      var days = getRouteDays(week);
      if (days.length === 0) return;
      html += '<div class="yts-week">';
      html += weekHeaderHtml(week, days);
      days.forEach(function (day) {
        var d = new Date(day.date);
        var m = d.getMonth();
        if (m !== lastMonth) { html += monthSepHtml(d); lastMonth = m; }
        html += dayRowHtml(day, d);
      });
      html += '</div>';
    });

    html += infoCardsHtml();
    container.innerHTML = html;
  }

  /* ── Both-routes view: side-by-side session pairing ── */
  function renderBothView() {
    var container = document.getElementById('yts-weeks-container');
    if (!container) return;
    var html = '';
    var lastMonth = -1;

    // Flexibility banner
    html += '<div class="yts-flex-banner">';
    html += '<div class="yts-flex-banner__icon">↔</div>';
    html += '<div>';
    html += '<p style="font-weight:700;font-size:.95rem;margin-bottom:4px;">' +
      t('Fuld fleksibilitet — skift fra uge til uge', 'Full flexibility — switch week by week') + '</p>';
    html += '<p style="font-size:.82rem;color:#6F6A66;line-height:1.5;">' +
      t('Samme indhold undervises begge dage. Vælg frit hverdags- eller weekendholdet fra uge til uge — du binder dig ikke til ét spor.',
        'The same content is taught on both days. Freely choose weekday or weekend each week — you\'re not locked into one track.') + '</p>';
    html += '</div></div>';

    schedule.weeks.forEach(function (week) {
      if (week.off) { html += offWeekHtml(week); return; }
      if (!week.days || week.days.length === 0) return;

      var weekday = week.days.filter(function (d) { return d.route === 'weekday'; });
      var weekend = week.days.filter(function (d) { return d.route === 'weekend'; });
      var shared  = week.days.filter(function (d) { return d.route === 'shared'; });

      // Month separator from first day
      var first = week.days[0];
      var fd = new Date(first.date);
      if (fd.getMonth() !== lastMonth) { html += monthSepHtml(fd); lastMonth = fd.getMonth(); }

      html += '<div class="yts-week">';
      html += '<div class="yts-week__header"><span class="yts-week__number">' +
        (isDa ? week.label_da : week.label_en) + '</span></div>';

      // Shared sessions — full width
      shared.forEach(function (day) {
        var d = new Date(day.date);
        var isExam = day.type === 'exam' || day.type === 'graduation';
        html += '<div class="yts-session yts-session--shared' + (isExam ? ' yts-session--exam' : '') + '">';
        html += '<div class="yts-session__topic">' + (isDa ? day.topic_da : day.topic_en) +
          ' <span class="yts-shared-pill">' + t('Begge hold', 'Both groups') + '</span></div>';
        html += '<div class="yts-session__single">';
        html += '<div><span class="yts-session__date-text">' + DAY_FULL[d.getDay()] + ' ' + d.getDate() + '. ' + MONTH_NAMES[d.getMonth()] + '</span>';
        html += '<span class="yts-session__time-text">' + day.start + ' – ' + day.end;
        if (day.online) html += ' · <span style="color:#f75c03;">Online</span>';
        html += '</span></div>';
        html += calBtnSmall(day);
        html += '</div></div>';
      });

      // Paired sessions — side by side
      var pairs = Math.max(weekday.length, weekend.length);
      for (var i = 0; i < pairs; i++) {
        var wd = weekday[i];
        var we = weekend[i];
        var topic = wd ? (isDa ? wd.topic_da : wd.topic_en) : (isDa ? we.topic_da : we.topic_en);

        html += '<div class="yts-session">';
        html += '<div class="yts-session__topic">' + topic + '</div>';
        html += '<div class="yts-session__options">';

        if (wd) html += sessionOptionHtml(wd, 'weekday');
        html += '<div class="yts-session__or">' + t('eller', 'or') + '</div>';
        if (we) html += sessionOptionHtml(we, 'weekend');

        html += '</div></div>';
      }

      html += '</div>';
    });

    html += infoCardsHtml();
    container.innerHTML = html;
  }

  /* ── Rendering helpers ── */

  function sessionOptionHtml(day, route) {
    var d = new Date(day.date);
    var color = route === 'weekday' ? '#f75c03' : '#ff9966';
    var label = route === 'weekday' ? t('Hverdagshold', 'Weekday') : t('Weekendhold', 'Weekend');
    var html = '<div class="yts-session__option" style="border-left:3px solid ' + color + ';" data-date="' + day.date + '">';
    html += '<div class="yts-session__route-label" style="color:' + color + ';">' + label + '</div>';
    html += '<div class="yts-session__date-text">' + DAY_FULL[d.getDay()] + ' ' + d.getDate() + '. ' + MONTH_NAMES[d.getMonth()].substring(0, 3) + '</div>';
    html += '<div class="yts-session__time-text">' + day.start + ' – ' + day.end + '</div>';
    html += calBtnSmall(day);
    html += '</div>';
    return html;
  }

  function calBtnSmall(day) {
    var topic = isDa ? day.topic_da : day.topic_en;
    return '<button class="yts-day__cal-btn" style="margin-top:6px;" onclick="ytsAddToCalendar(\'' +
      day.date + '\',\'' + day.start + '\',\'' + day.end + '\',' +
      JSON.stringify(topic).replace(/'/g, "\\'") + ',' + (day.online ? 'true' : 'false') +
      ')" title="' + t('Tilføj til kalender', 'Add to calendar') + '">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg></button>';
  }

  function dayRowHtml(day, d) {
    var dayType = day.type || 'workshop';
    var isShared = schedule.hasRoutes && day.route === 'shared';
    var topic = isDa ? day.topic_da : day.topic_en;
    var badge = dayType === 'exam' ? t('Eksamen', 'Exam') : dayType === 'graduation' ? 'Graduation' : day.online ? 'Online' : 'Workshop';
    var badgeCls = (dayType === 'exam' || dayType === 'graduation') ? 'yts-day__badge--graduation' : 'yts-day__badge--workshop';

    var html = '<div class="yts-day yts-day--' + dayType + (isShared ? ' yts-day--shared' : '') + '" data-date="' + day.date + '">';
    html += '<div class="yts-day__date"><div class="yts-day__date-num">' + d.getDate() + '</div><div class="yts-day__date-day">' + DAY_NAMES[d.getDay()] + '</div></div>';
    html += '<div class="yts-day__info"><div class="yts-day__topic">' + topic;
    if (isShared) html += ' <span class="yts-shared-pill">' + t('Begge hold', 'Both groups') + '</span>';
    html += '</div><div class="yts-day__time">' + day.start + ' – ' + day.end;
    if (day.online) html += ' · <span style="color:#f75c03;">Online</span>';
    html += '</div></div>';
    html += '<div style="display:flex;gap:6px;align-items:center;"><span class="yts-day__badge ' + badgeCls + '">' + badge + '</span>';
    html += calBtnSmall(day);
    html += '</div></div>';
    return html;
  }

  function offWeekHtml(week) {
    return '<div class="yts-week yts-week--off"><div class="yts-week__header yts-week__header--off">' +
      '<span class="yts-week__number yts-week__number--off">' + (isDa ? week.label_da : week.label_en) + '</span>' +
      '<span class="yts-week__off-label">' + (isDa ? week.off_label_da : week.off_label_en) + '</span></div></div>';
  }

  function weekHeaderHtml(week, days) {
    var f = new Date(days[0].date);
    var l = new Date(days[days.length - 1].date);
    return '<div class="yts-week__header"><span class="yts-week__number">' + (isDa ? week.label_da : week.label_en) +
      '</span><span class="yts-week__range">' + formatDateShort(f) + ' – ' + formatDateShort(l) + '</span></div>';
  }

  function monthSepHtml(d) {
    return '<div class="yts-month-sep">' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear() + '</div>';
  }

  function infoCardsHtml() {
    var html = '<div style="margin-top:40px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">';
    html += '<div style="background:#FFF8F3;border:1px solid #FFE5D0;border-radius:12px;padding:20px;">';
    html += '<p style="font-weight:700;font-size:.88rem;margin-bottom:6px;">' + t('60 studietimer påkrævet', '60 studio classes required') + '</p>';
    html += '<p style="font-size:.82rem;color:#6F6A66;line-height:1.5;">' + t('Senest ' + schedule.classes_deadline, 'By ' + schedule.classes_deadline_en) + '</p></div>';
    html += '<div style="background:#f0fff0;border:1px solid #c3e6c3;border-radius:12px;padding:20px;">';
    html += '<p style="font-weight:700;font-size:.88rem;margin-bottom:6px;">' + t('Certificering', 'Certification') + '</p>';
    html += '<p style="font-size:.82rem;color:#6F6A66;line-height:1.5;">' + t('Graduation: 28. juni 2026', 'Graduation: June 28, 2026') + '</p></div></div>';
    return html;
  }

  /* ══════════════════════════════════════════════════
     TYPICAL WEEK / ROUTE OVERVIEW
     ══════════════════════════════════════════════════ */

  function renderTypicalWeek() {
    var section = document.getElementById('yts-typical-section');
    if (!section) return;
    var inner = document.getElementById('yts-typical-inner');
    if (!schedule.hasRoutes) {
      if (inner) inner.style.display = '';
      var d = document.getElementById('yts-typical-dynamic');
      if (d) d.remove();
      return;
    }
    if (inner) inner.style.display = 'none';
    var existing = document.getElementById('yts-typical-dynamic');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'yts-typical-dynamic';
      section.querySelector('[style*="max-width"]').appendChild(existing);
    }

    var html = '';

    if (activeRoute === 'both') {
      // Show both routes side by side
      html += '<h2 style="font-size:1.5rem;font-weight:700;margin-bottom:8px;text-align:center;">' + t('Vælg den dag der passer dig', 'Choose the day that suits you') + '</h2>';
      html += '<p style="text-align:center;font-size:.88rem;color:#6F6A66;margin-bottom:28px;">' + t('Hver uge undervises det samme indhold to gange — én hverdag og én weekend. Du vælger frit.', 'Each week the same content is taught twice — once weekday, once weekend. You choose freely.') + '</p>';

      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">';

      // Weekday card
      html += '<div style="background:#fff;border:2px solid #f75c03;border-radius:16px;padding:24px;text-align:center;">';
      html += '<p style="font-weight:700;font-size:1rem;color:#f75c03;margin-bottom:4px;">' + t('Hverdagshold', 'Weekday Track') + '</p>';
      html += '<p style="font-size:.82rem;color:#6F6A66;margin-bottom:16px;">' + schedule.routes.weekday.desc_da + '</p>';
      html += '<div style="display:flex;justify-content:center;gap:8px;">';
      ['Man', 'Ons'].forEach(function (d) {
        html += '<span style="background:#FFF0E6;color:#f75c03;padding:6px 14px;border-radius:50px;font-size:.78rem;font-weight:600;">' + d + '</span>';
      });
      html += '</div>';
      html += '<p style="font-size:.75rem;color:#6F6A66;margin-top:12px;">' + t('+ 4 fælles weekender (anatomi & filosofi)', '+ 4 shared weekends (anatomy & philosophy)') + '</p>';
      html += '</div>';

      // Weekend card
      html += '<div style="background:#fff;border:2px solid #ff9966;border-radius:16px;padding:24px;text-align:center;">';
      html += '<p style="font-weight:700;font-size:1rem;color:#ff9966;margin-bottom:4px;">' + t('Weekendhold', 'Weekend Track') + '</p>';
      html += '<p style="font-size:.82rem;color:#6F6A66;margin-bottom:16px;">' + schedule.routes.weekend.desc_da + '</p>';
      html += '<div style="display:flex;justify-content:center;gap:8px;">';
      ['Lør', 'Søn'].forEach(function (d) {
        html += '<span style="background:#FFF5ED;color:#ff9966;padding:6px 14px;border-radius:50px;font-size:.78rem;font-weight:600;">' + d + '</span>';
      });
      html += '</div>';
      html += '<p style="font-size:.75rem;color:#6F6A66;margin-top:12px;">' + t('Anatomi & filosofi er allerede i weekenderne', 'Anatomy & philosophy already on weekends') + '</p>';
      html += '</div>';

      html += '</div>';
      html += '<p style="text-align:center;font-size:.78rem;color:#6F6A66;margin-top:16px;line-height:1.55;">' +
        t('Du kan mikse — f.eks. hverdagsholdet i uge 1, weekendholdet i uge 4, og så videre.', 'You can mix — e.g. weekday track in week 1, weekend track in week 4, and so on.') + '</p>';
    } else {
      // Single route typical week (same as before)
      var isWd = activeRoute === 'weekday';
      html += '<h2 style="font-size:1.5rem;font-weight:700;margin-bottom:8px;text-align:center;">' + t('Din ugestruktur', 'Your weekly structure') + '</h2>';
      html += '<p style="text-align:center;font-size:.88rem;color:#6F6A66;margin-bottom:28px;">' +
        (isDa ? schedule.routes[activeRoute].name_da : schedule.routes[activeRoute].name_en) + ' — ' +
        (isDa ? schedule.routes[activeRoute].desc_da : schedule.routes[activeRoute].desc_en) + '</p>';
      var labels = isDa ? ['Man','Tir','Ons','Tor','Fre','Lør','Søn'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      var types = isWd ? ['workshop','free','workshop','free','free','shared','shared'] : ['free','free','free','free','free','weekend','weekend'];
      var descs = isWd
        ? (isDa ? ['Workshop','Fri','Workshop','Fri','Fri','Anatomi*','Filosofi*'] : ['Workshop','Free','Workshop','Free','Free','Anatomy*','Philosophy*'])
        : (isDa ? ['Fri','Fri','Fri','Fri','Fri','Workshop','Workshop'] : ['Free','Free','Free','Free','Free','Workshop','Workshop']);
      var times = isWd ? ['10–15','','10–15','','','13–17','14–17'] : ['','','','','','13–18','14–19'];
      html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;" id="yts-typical-grid">';
      for (var i = 0; i < 7; i++) {
        var bc = types[i] === 'workshop' ? '#f75c03' : types[i] === 'weekend' ? '#ff9966' : types[i] === 'shared' ? '#3498db' : '#E8E4E0';
        var tc = bc === '#E8E4E0' ? '#6F6A66' : bc;
        html += '<div style="background:#fff;border:1px solid ' + bc + ';border-radius:12px;padding:14px 10px;text-align:center;min-height:100px;display:flex;flex-direction:column;justify-content:space-between;">';
        html += '<p style="font-weight:700;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:' + tc + ';">' + labels[i] + '</p>';
        html += '<p style="font-size:.7rem;color:#333;flex:1;display:flex;align-items:center;justify-content:center;">' + descs[i] + '</p>';
        if (times[i]) html += '<p style="font-size:.65rem;color:#6F6A66;">' + times[i] + '</p>';
        html += '</div>';
      }
      html += '</div>';
      html += '<p style="text-align:center;font-size:.78rem;color:#6F6A66;margin-top:16px;">' +
        (isWd ? t('* Anatomi & filosofi: 4 fælles weekender', '* Anatomy & philosophy: 4 shared weekends')
              : t('* Anatomi & filosofi er allerede i dit weekendprogram', '* Anatomy & philosophy already in your weekend schedule')) + '</p>';
    }

    existing.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════
     CONFLICT CHECKER
     ══════════════════════════════════════════════════ */

  function initConflictChecker() {
    var statsSection = document.getElementById('yts-stats');
    if (!statsSection) return;

    var h = '<div id="yts-conflict-checker" style="max-width:800px;margin:0 auto;padding:24px 24px 0;">';
    h += '<div style="background:#fff;border:1.5px solid #f75c03;border-radius:16px;padding:24px;">';
    h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">';
    h += '<span style="background:#FFF0E6;color:#f75c03;width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">📅</span>';
    h += '<div><p style="font-weight:700;font-size:1rem;">' + t('Tjek dit skema for konflikter', 'Check your schedule for conflicts') + '</p>';
    h += '<p style="font-size:.82rem;color:#6F6A66;">' + t('Fortæl os om din arbejdsuge, så sammenligner vi begge hold for dig.', 'Tell us about your work week and we\'ll compare both tracks for you.') + '</p></div></div>';

    // Form
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">';
    h += '<div><label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:6px;">' + t('Arbejdsdage', 'Work days') + '</label>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    var sd = isDa ? ['Man','Tir','Ons','Tor','Fre','Lør','Søn'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    var dim = [1,2,3,4,5,6,0];
    sd.forEach(function (d, i) {
      h += '<label style="display:flex;align-items:center;gap:4px;font-size:.78rem;cursor:pointer;background:#F5F3F0;padding:4px 10px;border-radius:50px;">';
      h += '<input type="checkbox" name="yts-workday" value="' + dim[i] + '"' + (i < 5 ? ' checked' : '') + ' style="accent-color:#f75c03;width:14px;height:14px;">' + d + '</label>';
    });
    h += '</div></div>';
    h += '<div><label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:6px;">' + t('Arbejdstider', 'Work hours') + '</label>';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += '<input type="time" id="yts-work-start" value="09:00" style="border:1px solid #E8E4E0;border-radius:8px;padding:6px 10px;font-family:inherit;font-size:.85rem;">';
    h += '<span style="color:#6F6A66;">–</span>';
    h += '<input type="time" id="yts-work-end" value="17:00" style="border:1px solid #E8E4E0;border-radius:8px;padding:6px 10px;font-family:inherit;font-size:.85rem;">';
    h += '</div></div></div>';
    h += '<button onclick="ytsCheckConflicts()" style="background:#0F0F0F;color:#fff;border:none;padding:12px 24px;border-radius:50px;font-size:.88rem;font-weight:600;cursor:pointer;font-family:inherit;">' + t('Tjek konflikter', 'Check conflicts') + '</button>';
    h += '<div id="yts-conflict-results" style="display:none;margin-top:20px;"></div>';
    h += '</div></div>';

    statsSection.insertAdjacentHTML('afterend', h);
  }

  function countConflicts(route, workDays, wsMin, weMin) {
    var days = getAttendDays(route);
    var conflicts = 0;
    days.forEach(function (day) {
      var dow = new Date(day.date).getDay();
      if (workDays.indexOf(dow) === -1) return;
      var s = timeToMinutes(day.start), e = timeToMinutes(day.end);
      if (s < weMin && e > wsMin) conflicts++;
    });
    return { total: days.length, conflicts: conflicts, clear: days.length - conflicts };
  }

  window.ytsCheckConflicts = function () {
    var cbs = document.querySelectorAll('input[name="yts-workday"]:checked');
    var workDays = []; cbs.forEach(function (c) { workDays.push(parseInt(c.value)); });
    var wsMin = timeToMinutes(document.getElementById('yts-work-start').value || '09:00');
    var weMin = timeToMinutes(document.getElementById('yts-work-end').value || '17:00');

    var el = document.getElementById('yts-conflict-results');
    if (!el) return;
    el.style.display = 'block';

    // For 18w: always compare both routes
    if (schedule.hasRoutes) {
      var wd = countConflicts('weekday', workDays, wsMin, weMin);
      var we = countConflicts('weekend', workDays, wsMin, weMin);
      el.innerHTML = renderComparison(wd, we);
      return;
    }

    // For 8w: single route check
    var result = countConflicts(null, workDays, wsMin, weMin);
    if (result.conflicts === 0) {
      el.innerHTML = '<div style="background:#f0fff0;border:1px solid #c3e6c3;border-radius:12px;padding:20px;text-align:center;">' +
        '<p style="font-size:1.4rem;margin-bottom:8px;">✅</p>' +
        '<p style="font-weight:700;">' + t('Ingen konflikter!', 'No conflicts!') + '</p>' +
        '<p style="font-size:.85rem;color:#6F6A66;margin-top:6px;">' + t('Alle ' + result.total + ' datoer passer.', 'All ' + result.total + ' dates fit.') + '</p></div>';
    } else {
      var pct = Math.round((result.clear / result.total) * 100);
      el.innerHTML = '<div style="background:#FFF8F3;border:1px solid #FFE5D0;border-radius:12px;padding:20px;">' +
        '<p style="font-weight:700;margin-bottom:8px;">' + result.conflicts + t(' konflikter af ', ' conflicts of ') + result.total + '</p>' +
        '<div style="background:#E8E4E0;border-radius:50px;height:8px;overflow:hidden;margin-bottom:12px;"><div style="background:#2ecc71;height:100%;width:' + pct + '%;border-radius:50px;"></div></div>' +
        '<p style="font-size:.82rem;color:#6F6A66;">' + pct + '% ' + t('passer. Du kan deltage online på nogle workshops.', 'fit. You can join some workshops online.') + '</p></div>';
    }
  };

  function renderComparison(wd, we) {
    var html = '';

    // Side-by-side comparison cards
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">';

    var wdPct = Math.round((wd.clear / wd.total) * 100);
    var wePct = Math.round((we.clear / we.total) * 100);
    var wdBest = wd.conflicts < we.conflicts;
    var weBest = we.conflicts < wd.conflicts;
    var bothPerfect = wd.conflicts === 0 && we.conflicts === 0;

    // Weekday card
    html += '<div style="background:' + (wdBest || bothPerfect ? '#f0fff0' : '#fff') + ';border:2px solid ' + (wdBest ? '#2ecc71' : '#E8E4E0') + ';border-radius:12px;padding:16px;text-align:center;position:relative;">';
    if (wdBest && !bothPerfect) html += '<span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#2ecc71;color:#fff;padding:3px 12px;border-radius:50px;font-size:.68rem;font-weight:700;white-space:nowrap;">' + t('Bedste match', 'Best match') + '</span>';
    html += '<p style="font-weight:700;font-size:.85rem;margin-bottom:4px;color:#f75c03;">' + t('Hverdagshold', 'Weekday') + '</p>';
    html += '<p style="font-size:2.2rem;font-weight:700;' + (wd.conflicts === 0 ? 'color:#2ecc71;' : 'color:#0F0F0F;') + '">' + wd.conflicts + '</p>';
    html += '<p style="font-size:.75rem;color:#6F6A66;">' + t('konflikter af ' + wd.total, 'conflicts of ' + wd.total) + '</p>';
    html += '<div style="background:#E8E4E0;border-radius:50px;height:6px;overflow:hidden;margin-top:10px;"><div style="background:#2ecc71;height:100%;width:' + wdPct + '%;border-radius:50px;"></div></div></div>';

    // Weekend card
    html += '<div style="background:' + (weBest || bothPerfect ? '#f0fff0' : '#fff') + ';border:2px solid ' + (weBest ? '#2ecc71' : '#E8E4E0') + ';border-radius:12px;padding:16px;text-align:center;position:relative;">';
    if (weBest && !bothPerfect) html += '<span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#2ecc71;color:#fff;padding:3px 12px;border-radius:50px;font-size:.68rem;font-weight:700;white-space:nowrap;">' + t('Bedste match', 'Best match') + '</span>';
    html += '<p style="font-weight:700;font-size:.85rem;margin-bottom:4px;color:#ff9966;">' + t('Weekendhold', 'Weekend') + '</p>';
    html += '<p style="font-size:2.2rem;font-weight:700;' + (we.conflicts === 0 ? 'color:#2ecc71;' : 'color:#0F0F0F;') + '">' + we.conflicts + '</p>';
    html += '<p style="font-size:.75rem;color:#6F6A66;">' + t('konflikter af ' + we.total, 'conflicts of ' + we.total) + '</p>';
    html += '<div style="background:#E8E4E0;border-radius:50px;height:6px;overflow:hidden;margin-top:10px;"><div style="background:#2ecc71;height:100%;width:' + wePct + '%;border-radius:50px;"></div></div></div>';

    html += '</div>';

    // Recommendation
    if (bothPerfect) {
      html += '<div style="background:#f0fff0;border:1px solid #c3e6c3;border-radius:12px;padding:16px;text-align:center;">';
      html += '<p style="font-size:1.2rem;margin-bottom:4px;">✅</p>';
      html += '<p style="font-weight:700;">' + t('Begge hold passer perfekt!', 'Both tracks fit perfectly!') + '</p>';
      html += '<p style="font-size:.85rem;color:#6F6A66;margin-top:4px;">' + t('Du har fuld frihed til at mikse fra uge til uge.', 'You have total freedom to mix week by week.') + '</p></div>';
    } else {
      var best = wdBest ? 'weekday' : 'weekend';
      var bestName = isDa ? schedule.routes[best].name_da : schedule.routes[best].name_en;
      var bestCount = Math.min(wd.conflicts, we.conflicts);

      if (bestCount === 0) {
        html += '<div style="background:#f0fff0;border:1px solid #c3e6c3;border-radius:12px;padding:16px;">';
        html += '<p style="font-weight:700;">' + t('Anbefaling: ' + bestName, 'Recommendation: ' + bestName) + '</p>';
        html += '<p style="font-size:.85rem;color:#6F6A66;margin-top:4px;">' + t('Nul konflikter — og du kan stadig skifte til det andet hold enkelte uger.', 'Zero conflicts — and you can still switch to the other track for individual weeks.') + '</p></div>';
      } else {
        html += '<div style="background:#FFF8F3;border:1px solid #FFE5D0;border-radius:12px;padding:16px;">';
        html += '<p style="font-weight:700;">' + t(bestName + ' passer bedst — men du kan mikse!', bestName + ' fits best — but you can mix!') + '</p>';
        html += '<p style="font-size:.85rem;color:#6F6A66;margin-top:4px;line-height:1.5;">' +
          t('Brug ' + bestName + ' som udgangspunkt, og skift de ' + bestCount + ' konfliktuger til det andet hold. Det er hele pointen med det fleksible format.',
            'Use ' + bestName + ' as your base, and switch the ' + bestCount + ' conflict weeks to the other track. That\'s the whole point of the flexible format.') + '</p></div>';
      }
    }

    return html;
  }

  /* ══════════════════════════════════════════════════
     .ICS CALENDAR EXPORT
     ══════════════════════════════════════════════════ */

  function generateICS(events) {
    var lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Yoga Bible//YTT Schedule//DA','CALSCALE:GREGORIAN','METHOD:PUBLISH',
      'X-WR-CALNAME:' + (isDa ? schedule.title_da : schedule.title_en),'X-WR-TIMEZONE:Europe/Copenhagen'];
    events.forEach(function (evt) {
      var loc = evt.online ? 'Online' : (isDa ? schedule.location : schedule.location_en);
      lines.push('BEGIN:VEVENT');
      lines.push('DTSTART;TZID=Europe/Copenhagen:' + formatICSDate(evt.date, evt.start));
      lines.push('DTEND;TZID=Europe/Copenhagen:' + formatICSDate(evt.date, evt.end));
      lines.push('SUMMARY:' + escapeICS('YB YTT — ' + evt.topic));
      lines.push('LOCATION:' + escapeICS(loc));
      lines.push('UID:' + evt.date + '-' + evt.start.replace(':','') + '@yogabible.dk');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  window.ytsAddToCalendar = function (date, start, end, topic, online) {
    downloadICS(generateICS([{ date: date, start: start, end: end, topic: topic, online: online }]), 'yoga-bible-' + date + '.ics');
  };

  window.ytsAddAllToCalendar = function () {
    var days = getAttendDays();
    var events = days.map(function (d) { return { date: d.date, start: d.start, end: d.end, topic: isDa ? d.topic_da : d.topic_en, online: d.online }; });
    downloadICS(generateICS(events), 'yoga-bible-ytt-schedule.ics');
  };

  window.ytsExportRoute = function (route) {
    var days = getAttendDays(route);
    var events = days.map(function (d) { return { date: d.date, start: d.start, end: d.end, topic: isDa ? d.topic_da : d.topic_en, online: d.online }; });
    downloadICS(generateICS(events), 'yoga-bible-ytt-' + route + '.ics');
  };

  function downloadICS(content, filename) {
    var blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ══════════════════════════════════════════════════
     UTILITY
     ══════════════════════════════════════════════════ */

  function formatICSDate(d, t) { return d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00'; }
  function escapeICS(s) { return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function formatDateShort(d) { return d.getDate() + '. ' + MONTH_NAMES[d.getMonth()].substring(0, 3); }
  function timeToMinutes(t) { var p = t.split(':'); return parseInt(p[0]) * 60 + parseInt(p[1]); }

  /* ══════════════════════════════════════════════════
     PREP CTA + INIT
     ══════════════════════════════════════════════════ */

  function initPrepCta() {
    var btn = document.getElementById('yts-prep-cta');
    if (btn && schedule.prodId) {
      btn.addEventListener('click', function () {
        if (window.startCheckoutFunnel) window.startCheckoutFunnel(schedule.prodId);
        else if (window.openCheckoutFlow) window.openCheckoutFlow(schedule.prodId);
      });
    }
  }

  function init() {
    initHero();
    initStats();
    renderSchedule();
    initConflictChecker();
    renderTypicalWeek();
    initPrepCta();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
