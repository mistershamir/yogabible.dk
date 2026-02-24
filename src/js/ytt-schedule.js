/**
 * YTT Schedule Page — Interactive schedule with .ics calendar export
 * and Google Calendar conflict detection.
 *
 * Reads program data from URL params: ?program=8w&cohort=may-jun-2026
 * Falls back to 8w May-June 2026 as default.
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

  /* ── Schedule data ──────────────────────────────── */
  /* Each entry: [date, dayOfWeek, startH, startM, endH, endM, topic_da, topic_en, type, online] */
  /* type: 'workshop' | 'exam' | 'graduation' */

  var SCHEDULES = {
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
    }
  };

  /* ── URL params ─────────────────────────────────── */
  var params = new URLSearchParams(window.location.search);
  var programKey = params.get('program') || '8w-may-jun-2026';
  var schedule = SCHEDULES[programKey] || SCHEDULES['8w-may-jun-2026'];

  /* ── Populate hero ──────────────────────────────── */
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
  }

  /* ── Count stats ────────────────────────────────── */
  function initStats() {
    var totalDays = 0;
    schedule.weeks.forEach(function (w) { totalDays += w.days.length; });

    var daysEl = document.getElementById('yts-stat-days');
    var freeEl = document.getElementById('yts-stat-free');
    var weeksEl = document.getElementById('yts-stat-weeks');
    if (daysEl) daysEl.textContent = totalDays;
    if (weeksEl) weeksEl.textContent = schedule.weeks.length;

    // Calculate span of calendar days
    var allDates = [];
    schedule.weeks.forEach(function (w) {
      w.days.forEach(function (d) { allDates.push(new Date(d.date)); });
    });
    allDates.sort(function (a, b) { return a - b; });
    var spanDays = Math.round((allDates[allDates.length - 1] - allDates[0]) / 86400000) + 1;
    var freeDays = spanDays - totalDays;
    if (freeEl) freeEl.textContent = freeDays;
  }

  /* ── Render schedule ────────────────────────────── */
  function renderSchedule() {
    var container = document.getElementById('yts-weeks-container');
    if (!container) return;

    var html = '';
    var lastMonth = -1;

    schedule.weeks.forEach(function (week, wi) {
      // Week header
      var firstDate = new Date(week.days[0].date);
      var lastDate = new Date(week.days[week.days.length - 1].date);
      var range = formatDateShort(firstDate) + ' – ' + formatDateShort(lastDate);

      html += '<div class="yts-week">';
      html += '<div class="yts-week__header">';
      html += '<span class="yts-week__number">' + (isDa ? schedule.weeks[wi].label_da : schedule.weeks[wi].label_en) + '</span>';
      html += '<span class="yts-week__range">' + range + '</span>';
      html += '</div>';

      // Days
      week.days.forEach(function (day) {
        var d = new Date(day.date);
        var m = d.getMonth();

        // Month separator
        if (m !== lastMonth) {
          html += '<div class="yts-month-sep">' + MONTH_NAMES[m] + ' ' + d.getFullYear() + '</div>';
          lastMonth = m;
        }

        var dayType = day.type || 'workshop';
        var cssClass = 'yts-day yts-day--' + dayType;
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
        html += '<div class="yts-day__topic">' + topic + '</div>';
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

  /* ── Calendar conflict checker ──────────────────── */
  function initConflictChecker() {
    var container = document.getElementById('yts-weeks-container');
    if (!container) return;

    // Add conflict checker UI after stats bar
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

  /* ── Conflict analysis ──────────────────────────── */
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

    schedule.weeks.forEach(function (week) {
      week.days.forEach(function (day) {
        var d = new Date(day.date);
        var dow = d.getDay();
        var wsStart = timeToMinutes(day.start);
        var wsEnd = timeToMinutes(day.end);
        var topic = isDa ? day.topic_da : day.topic_en;

        if (workDays.indexOf(dow) !== -1) {
          // Check time overlap
          if (wsStart < workEndMin && wsEnd > workStartMin) {
            var overlapStart = Math.max(wsStart, workStartMin);
            var overlapEnd = Math.min(wsEnd, workEndMin);
            conflicts.push({
              date: day.date,
              topic: topic,
              workshopTime: day.start + '–' + day.end,
              overlapHours: ((overlapEnd - overlapStart) / 60).toFixed(1),
              online: day.online
            });
          } else {
            noConflicts.push({ date: day.date, topic: topic, workshopTime: day.start + '–' + day.end });
          }
        } else {
          noConflicts.push({ date: day.date, topic: topic, workshopTime: day.start + '–' + day.end });
        }
      });
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
      // No conflicts
      html += '<div style="background:#f0fff0;border:1px solid #c3e6c3;border-radius:12px;padding:20px;text-align:center;">';
      html += '<p style="font-size:1.4rem;margin-bottom:8px;">✅</p>';
      html += '<p style="font-weight:700;font-size:1rem;">' + t('Ingen konflikter fundet!', 'No conflicts found!') + '</p>';
      html += '<p style="font-size:.85rem;color:#6F6A66;margin-top:6px;">' + t('Alle ' + totalDays + ' workshopdatoer passer med din arbejdsplan.', 'All ' + totalDays + ' workshop dates fit your work schedule.') + '</p>';
      html += '</div>';
    } else {
      // Summary
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

    // Highlight conflicting dates in the schedule
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

  /* ── .ics generation ────────────────────────────── */
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
      lines.push('UID:' + evt.date + '-' + evt.start.replace(':', '') + '@yogabible.dk');
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
    var events = [];
    schedule.weeks.forEach(function (w) {
      w.days.forEach(function (d) {
        events.push({
          date: d.date,
          start: d.start,
          end: d.end,
          topic: isDa ? d.topic_da : d.topic_en,
          online: d.online
        });
      });
    });
    var ics = generateICS(events);
    downloadICS(ics, 'yoga-bible-ytt-schedule.ics');
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

  /* ── Utility ────────────────────────────────────── */
  function formatICSDate(dateStr, timeStr) {
    // dateStr: 2026-05-02, timeStr: 13:00 → 20260502T130000
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

  /* ── Prep CTA wiring ───────────────────────────── */
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

  /* ── Init ───────────────────────────────────────── */
  function init() {
    initHero();
    initStats();
    renderSchedule();
    initConflictChecker();
    initPrepCta();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
