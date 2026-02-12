(function() {
  'use strict';

  var activeFrames = {};
  var sectionInits = {};
  var PI = Math.PI;
  var TAU = PI * 2;

  /* ── Helpers ── */

  function getScrollPercent(section) {
    var rect = section.getBoundingClientRect();
    var vh = window.innerHeight;
    return Math.max(0, Math.min(1, (vh - rect.top) / (vh + rect.height)));
  }

  function resizeCanvas(canvas) {
    var parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
  }

  /* ── Section activation / deactivation ── */

  function activateSection(sections, idx) {
    var section = sections[idx];
    if (!section) return;
    if (sectionInits[idx]) return;

    var canvas = section.querySelector('.vs-canvas') || section.querySelector('.vs-seismic-canvas');
    var type = null;
    if (canvas) {
      type = canvas.getAttribute('data-vs-type');
      resizeCanvas(canvas);
    }

    var cleanup = null;

    switch (type) {
      case 'oscilloscope':   cleanup = initOscilloscope(section, canvas, idx); break;
      case 'molecular':      cleanup = initMolecular(section, canvas, idx); break;
      case 'frequency':      cleanup = initFrequency(section, canvas, idx); break;
      case 'cursor-field':   cleanup = initCursorField(section, canvas, idx); break;
      case 'cymatics':       cleanup = initCymatics(section, canvas, idx); break;
      case 'ripple':         cleanup = initRipple(section, canvas, idx); break;
      case 'pendulum':       cleanup = initPendulum(section, canvas, idx); break;
      case 'waveform':       cleanup = initWaveform(section, canvas, idx); break;
      case 'standing':       cleanup = initStanding(section, canvas, idx); break;
      case 'chladni':        cleanup = initChladni(section, canvas, idx); break;
      case 'harmonics':      cleanup = initHarmonics(section, canvas, idx); break;
      case 'pressure':       cleanup = initPressure(section, canvas, idx); break;
      case 'doppler':        cleanup = initDoppler(section, canvas, idx); break;
      case 'tuning-fork':    cleanup = initTuningFork(section, canvas, idx); break;
      case 'binaural':       cleanup = initBinaural(section, canvas, idx); break;
      case 'pranayama':      cleanup = initPranayama(section, canvas, idx); break;
      case 'fascia':         cleanup = initFascia(section, canvas, idx); break;
      case 'spine':          cleanup = initSpine(section, canvas, idx); break;
      case 'chakra':         cleanup = initChakra(section, canvas, idx); break;
      case 'lotus':          cleanup = initLotus(section, canvas, idx); break;
      case 'meditation':     cleanup = initMeditation(section, canvas, idx); break;
      case 'muscle':         cleanup = initMuscle(section, canvas, idx); break;
      case 'focus':          cleanup = initFocus(section, canvas, idx); break;
      case 'heartbeat':      cleanup = initHeartbeat(section, canvas, idx); break;
      case 'neural':         cleanup = initNeural(section, canvas, idx); break;
      case 'flow':           cleanup = initFlow(section, canvas, idx); break;
      case 'kundalini':      cleanup = initKundalini(section, canvas, idx); break;
      default:
        if (idx === 1) cleanup = initSeismic(section, idx);
        if (idx === 2) cleanup = initResonance(section, idx);
        if (idx === 7) cleanup = initStrings(section, idx);
        break;
    }

    if (cleanup) {
      sectionInits[idx] = cleanup;
    }
  }

  function deactivateSection(idx) {
    if (activeFrames[idx]) {
      cancelAnimationFrame(activeFrames[idx]);
      delete activeFrames[idx];
    }
    if (sectionInits[idx]) {
      sectionInits[idx]();
      delete sectionInits[idx];
    }
  }

  /* ══════════════════════════════════════════
     0: OSCILLOSCOPE
     ══════════════════════════════════════════ */
  function initOscilloscope(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var mouseY = 0.5;
    var phase = 0;

    function onMouseMove(e) {
      var rect = section.getBoundingClientRect();
      mouseY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    }

    section.addEventListener('mousemove', onMouseMove, { passive: true });

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      for (var wave = 0; wave < 3; wave++) {
        var opacity = 0.8 - wave * 0.2;
        var amplitude = mouseY * h * 0.35 * (1 - wave * 0.2);
        var freq = 0.01 + wave * 0.005;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(124,92,255,' + opacity + ')';
        ctx.lineWidth = 2.5 - wave * 0.5;
        for (var x = 0; x < w; x++) {
          var y = h / 2 + Math.sin(x * freq + phase + wave * 1.2) * amplitude;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      phase += 0.02;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      section.removeEventListener('mousemove', onMouseMove);
    };
  }

  /* ══════════════════════════════════════════
     1: SEISMIC
     ══════════════════════════════════════════ */
  function initSeismic(section, idx) {
    var canvas = section.querySelector('.vs-seismic-canvas');
    if (!canvas) return function() {};
    var ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.clientWidth;
    var data = [];
    var maxPoints = canvas.width;
    var shakeCards = section.querySelectorAll('[data-vs-shake]');
    var handlers = [];

    for (var i = 0; i < shakeCards.length; i++) {
      (function(card) {
        var enterFn = function() { card.classList.add('is-shaking'); };
        var leaveFn = function() { card.classList.remove('is-shaking'); };
        card.addEventListener('mouseenter', enterFn);
        card.addEventListener('mouseleave', leaveFn);
        handlers.push({ el: card, enter: enterFn, leave: leaveFn });
      })(shakeCards[i]);
    }

    function draw() {
      var scrollIntensity = getScrollPercent(section);
      var h = canvas.height;
      var point = h / 2 + (Math.random() - 0.5) * scrollIntensity * 40;
      data.push(point);
      if (data.length > maxPoints) data.shift();

      ctx.clearRect(0, 0, canvas.width, h);

      // Center baseline
      ctx.strokeStyle = 'rgba(204,68,0,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(canvas.width, h / 2);
      ctx.stroke();

      // Seismic line
      ctx.strokeStyle = '#cc4400';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var j = 0; j < data.length; j++) {
        if (j === 0) ctx.moveTo(j, data[j]);
        else ctx.lineTo(j, data[j]);
      }
      ctx.stroke();

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      for (var k = 0; k < handlers.length; k++) {
        handlers[k].el.removeEventListener('mouseenter', handlers[k].enter);
        handlers[k].el.removeEventListener('mouseleave', handlers[k].leave);
      }
    };
  }

  /* ══════════════════════════════════════════
     2: RESONANCE CASCADE (no canvas)
     ══════════════════════════════════════════ */
  function initResonance(section, idx) {
    var cards = section.querySelectorAll('[data-vs-cascade]');
    var handlers = [];
    var allTimers = [];

    for (var i = 0; i < cards.length; i++) {
      (function(card, cardIdx) {
        var enterFn = function() {
          for (var j = 0; j < cards.length; j++) {
            if (j === cardIdx) continue;
            var distance = Math.abs(j - cardIdx);
            (function(target, delay) {
              var timer = setTimeout(function() {
                target.classList.add('is-cascading');
                var removeTimer = setTimeout(function() {
                  target.classList.remove('is-cascading');
                }, 600);
                allTimers.push(removeTimer);
              }, delay);
              allTimers.push(timer);
            })(cards[j], distance * 150);
          }
        };
        card.addEventListener('mouseenter', enterFn);
        handlers.push({ el: card, fn: enterFn });
      })(cards[i], i);
    }

    return function() {
      for (var k = 0; k < handlers.length; k++) {
        handlers[k].el.removeEventListener('mouseenter', handlers[k].fn);
      }
      for (var m = 0; m < allTimers.length; m++) {
        clearTimeout(allTimers[m]);
      }
      for (var n = 0; n < cards.length; n++) {
        cards[n].classList.remove('is-cascading');
      }
    };
  }

  /* ══════════════════════════════════════════
     3: MOLECULAR
     ══════════════════════════════════════════ */
  function initMolecular(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var particles = [];
    var count = 120;
    var tempFill = section.querySelector('[data-vs-temp-fill]');

    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        r: 2 + Math.random() * 3
      });
    }

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var scrollP = getScrollPercent(section);
      var temperature = 0.1 + scrollP * 2.4;

      if (tempFill) {
        tempFill.style.width = (scrollP * 100) + '%';
      }

      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < count; i++) {
        var p = particles[i];
        p.vx += (Math.random() - 0.5) * temperature * 0.5;
        p.vy += (Math.random() - 0.5) * temperature * 0.5;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        if (p.x > w) { p.x = w; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        if (p.y > h) { p.y = h; p.vy *= -1; }
      }

      // Bonds
      for (var a = 0; a < count; a++) {
        for (var b = a + 1; b < count; b++) {
          var dx = particles[a].x - particles[b].x;
          var dy = particles[a].y - particles[b].y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 60) {
            var opacity = (1 - dist / 60) * 0.4;
            ctx.strokeStyle = 'rgba(0,191,165,' + opacity + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.stroke();
          }
        }
      }

      // Particles
      for (var j = 0; j < count; j++) {
        var pp = particles[j];
        var speed = Math.sqrt(pp.vx * pp.vx + pp.vy * pp.vy);
        var op = Math.min(1, 0.3 + speed * 0.15);
        ctx.fillStyle = 'rgba(0,191,165,' + op + ')';
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, pp.r, 0, TAU);
        ctx.fill();
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     4: FREQUENCY
     ══════════════════════════════════════════ */
  function initFrequency(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var phase = 0;
    var freqBarsContainer = section.querySelector('[data-vs-freq-bars]');
    var bars = freqBarsContainer ? freqBarsContainer.querySelectorAll('.vs-freq-bar') : [];
    var letters = section.querySelectorAll('.vs-vibrate-letter');

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var scrollP = getScrollPercent(section);
      ctx.clearRect(0, 0, w, h);

      for (var wave = 0; wave < 3; wave++) {
        var opacity = 0.6 - wave * 0.15;
        var amplitude = h * 0.2 * (1 - wave * 0.15);
        var freq = 0.008 + wave * 0.004 + scrollP * 0.01;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(63,153,165,' + opacity + ')';
        ctx.lineWidth = 2 - wave * 0.4;
        for (var x = 0; x < w; x++) {
          var y = h / 2 + Math.sin(x * freq + phase + wave * 0.8) * amplitude;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      for (var b = 0; b < bars.length; b++) {
        var barHeight = 10 + Math.abs(Math.sin(b * 0.3 + phase * 0.5 + scrollP * 5)) * (30 + scrollP * 50);
        bars[b].style.height = barHeight + 'px';
      }

      var intensity = 0.5 + scrollP * 1.5;
      for (var l = 0; l < letters.length; l++) {
        letters[l].style.setProperty('--vibrate-intensity', intensity);
      }

      phase += 0.02;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     5: CURSOR FIELD
     ══════════════════════════════════════════ */
  function initCursorField(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var particles = [];
    var count = 80;
    var cursor = { x: -9999, y: -9999 };
    var magneticTitle = section.querySelector('[data-vs-magnetic]');

    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        baseX: Math.random() * canvas.width,
        baseY: Math.random() * canvas.height,
        vx: 0,
        vy: 0
      });
    }

    function onMouseMove(e) {
      var rect = section.getBoundingClientRect();
      cursor.x = e.clientX - rect.left;
      cursor.y = e.clientY - rect.top;
    }

    section.addEventListener('mousemove', onMouseMove, { passive: true });

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < count; i++) {
        var p = particles[i];
        var dx = cursor.x - p.x;
        var dy = cursor.y - p.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 150 && dist > 0) {
          var force = (150 - dist) / 150;
          p.vx -= (dx / dist) * force * 3;
          p.vy -= (dy / dist) * force * 3;
        }

        p.vx += (p.baseX - p.x) * 0.02;
        p.vy += (p.baseY - p.y) * 0.02;
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.x += p.vx;
        p.y += p.vy;
      }

      for (var a = 0; a < count; a++) {
        for (var b = a + 1; b < count; b++) {
          var cdx = particles[a].x - particles[b].x;
          var cdy = particles[a].y - particles[b].y;
          var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
          if (cdist < 100) {
            var lineOp = (1 - cdist / 100) * 0.3;
            ctx.strokeStyle = 'rgba(63,153,165,' + lineOp + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.stroke();
          }
        }
      }

      for (var j = 0; j < count; j++) {
        ctx.fillStyle = 'rgba(63,153,165,0.6)';
        ctx.beginPath();
        ctx.arc(particles[j].x, particles[j].y, 2.5, 0, TAU);
        ctx.fill();
      }

      if (magneticTitle) {
        var titleRect = magneticTitle.getBoundingClientRect();
        var sectionRect = section.getBoundingClientRect();
        var titleCX = titleRect.left + titleRect.width / 2 - sectionRect.left;
        var titleCY = titleRect.top + titleRect.height / 2 - sectionRect.top;
        var tdx = cursor.x - titleCX;
        var tdy = cursor.y - titleCY;
        var tdist = Math.sqrt(tdx * tdx + tdy * tdy);
        if (tdist < 300 && tdist > 0) {
          var pull = (300 - tdist) / 300 * 15;
          magneticTitle.style.transform = 'translate(' + (tdx / tdist) * pull + 'px, ' + (tdy / tdist) * pull + 'px)';
        } else {
          magneticTitle.style.transform = 'translate(0,0)';
        }
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      section.removeEventListener('mousemove', onMouseMove);
      if (magneticTitle) magneticTitle.style.transform = '';
    };
  }

  /* ══════════════════════════════════════════
     6: CYMATICS
     ══════════════════════════════════════════ */
  function initCymatics(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var phase = 0;

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var scrollP = getScrollPercent(section);
      var freq = 1 + scrollP * 5;
      ctx.clearRect(0, 0, w, h);

      var gridSize = 40;
      var spacingX = w / gridSize;
      var spacingY = h / gridSize;
      var cx = w / 2;
      var cy = h / 2;

      for (var gx = 0; gx < gridSize; gx++) {
        for (var gy = 0; gy < gridSize; gy++) {
          var px = gx * spacingX + spacingX / 2;
          var py = gy * spacingY + spacingY / 2;
          var dx = px - cx;
          var dy = py - cy;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var displacement = Math.sin(dist * freq * 0.02 + phase) * 5;
          var drawX = px + (dx / (dist || 1)) * displacement;
          var drawY = py + (dy / (dist || 1)) * displacement;
          var opacity = 0.2 + Math.abs(Math.sin(dist * freq * 0.02 + phase)) * 0.6;

          ctx.fillStyle = 'rgba(232,220,200,' + opacity + ')';
          ctx.beginPath();
          ctx.arc(drawX, drawY, 2, 0, TAU);
          ctx.fill();
        }
      }

      phase += 0.03;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     7: STRINGS (no canvas)
     ══════════════════════════════════════════ */
  function initStrings(section, idx) {
    var strings = section.querySelectorAll('.vs-string-svg');
    var handlers = [];

    for (var i = 0; i < strings.length; i++) {
      (function(svg) {
        var enterFn = function() {
          svg.classList.add('is-plucked');
        };
        var endFn = function() {
          svg.classList.remove('is-plucked');
        };
        svg.addEventListener('mouseenter', enterFn);
        svg.addEventListener('animationend', endFn);
        handlers.push({ el: svg, enter: enterFn, end: endFn });
      })(strings[i]);
    }

    return function() {
      for (var k = 0; k < handlers.length; k++) {
        handlers[k].el.removeEventListener('mouseenter', handlers[k].enter);
        handlers[k].el.removeEventListener('animationend', handlers[k].end);
        handlers[k].el.classList.remove('is-plucked');
      }
    };
  }

  /* ══════════════════════════════════════════
     8: RIPPLE INTERFERENCE
     ══════════════════════════════════════════ */
  function initRipple(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var sources = [];
    var countDisplay = section.querySelector('[data-vs-ripple-count]');

    function onClick(e) {
      var rect = canvas.getBoundingClientRect();
      sources.push({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        time: Date.now()
      });
      if (countDisplay) countDisplay.textContent = sources.length;
    }

    section.addEventListener('click', onClick);

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var now = Date.now();
      ctx.clearRect(0, 0, w, h);

      // Remove old sources (older than 12 seconds)
      var i = sources.length;
      while (i--) {
        if (now - sources[i].time > 12000) {
          sources.splice(i, 1);
        }
      }
      if (countDisplay) countDisplay.textContent = sources.length;

      if (sources.length > 0) {
        var step = 4;
        for (var px = 0; px < w; px += step) {
          for (var py = 0; py < h; py += step) {
            var sum = 0;
            for (var s = 0; s < sources.length; s++) {
              var dx = px - sources[s].x;
              var dy = py - sources[s].y;
              var dist = Math.sqrt(dx * dx + dy * dy);
              var age = (now - sources[s].time) * 0.003;
              var falloff = Math.max(0, 1 - dist / 350);
              sum += Math.sin(dist / 20 - age) * falloff;
            }
            if (Math.abs(sum) > 0.01) {
              ctx.fillStyle = 'rgba(68,136,204,' + Math.abs(sum) * 0.5 + ')';
              ctx.fillRect(px, py, step, step);
            }
          }
        }
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      section.removeEventListener('click', onClick);
    };
  }

  /* ══════════════════════════════════════════
     9: PENDULUM WAVE
     ══════════════════════════════════════════ */
  function initPendulum(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var startTime = Date.now();
    var numBobs = 15;
    var resetBtn = section.querySelector('[data-vs-pendulum-reset]');

    function onReset() {
      startTime = Date.now();
    }

    if (resetBtn) resetBtn.addEventListener('click', onReset);

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var now = Date.now();
      ctx.clearRect(0, 0, w, h);

      var pivotY = h * 0.1;
      var spacing = w / (numBobs + 1);

      for (var i = 0; i < numBobs; i++) {
        var period = 3000 + i * 120;
        var angle = 0.5 * Math.cos(TAU * (now - startTime) / period);
        var length = h * 0.5 + i * (h * 0.02);
        var pivotX = spacing * (i + 1);
        var bobX = pivotX + Math.sin(angle) * length;
        var bobY = pivotY + Math.cos(angle) * length;
        var opacity = 0.4 + (i / numBobs) * 0.6;

        ctx.strokeStyle = 'rgba(85,204,136,' + opacity * 0.4 + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotY);
        ctx.lineTo(bobX, bobY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(85,204,136,' + opacity + ')';
        ctx.beginPath();
        ctx.arc(bobX, bobY, 8, 0, TAU);
        ctx.fill();
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      if (resetBtn) resetBtn.removeEventListener('click', onReset);
    };
  }

  /* ══════════════════════════════════════════
     10: WAVEFORM SYNTH
     ══════════════════════════════════════════ */
  function initWaveform(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var phase = 0;
    var waveType = 'sine';
    var buttons = section.querySelectorAll('[data-vs-wave]');
    var handlers = [];

    for (var i = 0; i < buttons.length; i++) {
      (function(btn) {
        var clickFn = function() {
          waveType = btn.getAttribute('data-vs-wave');
          for (var j = 0; j < buttons.length; j++) {
            buttons[j].classList.remove('is-active');
          }
          btn.classList.add('is-active');
        };
        btn.addEventListener('click', clickFn);
        handlers.push({ el: btn, fn: clickFn });
      })(buttons[i]);
    }

    function getWaveValue(x, freq, ph) {
      var v = 0;
      var t = x * freq + ph;
      switch (waveType) {
        case 'sine':
          v = Math.sin(t);
          break;
        case 'square':
          v = Math.sign(Math.sin(t));
          break;
        case 'sawtooth':
          v = 2 * ((t / TAU) % 1) - 1;
          break;
        case 'triangle':
          v = 2 * Math.abs(2 * ((t / TAU) % 1) - 1) - 1;
          break;
      }
      return v;
    }

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      var freq = 0.03;
      ctx.beginPath();
      ctx.strokeStyle = '#66ff66';
      ctx.lineWidth = 2;
      for (var x = 0; x < w; x++) {
        var y = h / 2 + getWaveValue(x, freq, phase) * h * 0.35;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      phase += 0.02;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      for (var k = 0; k < handlers.length; k++) {
        handlers[k].el.removeEventListener('click', handlers[k].fn);
      }
    };
  }

  /* ══════════════════════════════════════════
     11: STANDING WAVES
     ══════════════════════════════════════════ */
  function initStanding(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var phase = 0;

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var scrollP = getScrollPercent(section);
      var nodes = 1 + Math.floor(scrollP * 5);
      var freq = nodes * PI / w;
      ctx.clearRect(0, 0, w, h);

      var amplitude = h * 0.25;

      // Wave 1 (traveling right)
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(102,102,255,0.2)';
      ctx.lineWidth = 1.5;
      for (var x1 = 0; x1 < w; x1++) {
        var y1 = h / 2 + Math.sin(x1 * freq - phase) * amplitude;
        if (x1 === 0) ctx.moveTo(x1, y1);
        else ctx.lineTo(x1, y1);
      }
      ctx.stroke();

      // Wave 2 (traveling left)
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(102,102,255,0.2)';
      ctx.lineWidth = 1.5;
      for (var x2 = 0; x2 < w; x2++) {
        var y2 = h / 2 + Math.sin(x2 * freq + phase) * amplitude;
        if (x2 === 0) ctx.moveTo(x2, y2);
        else ctx.lineTo(x2, y2);
      }
      ctx.stroke();

      // Sum (standing wave)
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(102,102,255,0.6)';
      ctx.lineWidth = 2.5;
      for (var x3 = 0; x3 < w; x3++) {
        var ySum = h / 2 + (Math.sin(x3 * freq - phase) + Math.sin(x3 * freq + phase)) * amplitude * 0.5;
        if (x3 === 0) ctx.moveTo(x3, ySum);
        else ctx.lineTo(x3, ySum);
      }
      ctx.stroke();

      phase += 0.04;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     12: CHLADNI PATTERNS
     ══════════════════════════════════════════ */
  function initChladni(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var numParticles = 2000;
    var particles = [];
    var L = 400;
    var modes = [[1,2],[2,3],[3,4],[4,5],[2,5],[3,5]];

    for (var i = 0; i < numParticles; i++) {
      particles.push({
        x: Math.random() * L,
        y: Math.random() * L
      });
    }

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var ox = (w - L) / 2;
      var oy = (h - L) / 2;

      var scrollP = getScrollPercent(section);
      var modeIdx = Math.min(modes.length - 1, Math.floor(scrollP * modes.length));
      var n = modes[modeIdx][0];
      var m = modes[modeIdx][1];

      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < numParticles; i++) {
        var p = particles[i];
        var val = Math.sin(n * PI * p.x / L) * Math.sin(m * PI * p.y / L) +
                  Math.sin(m * PI * p.x / L) * Math.sin(n * PI * p.y / L);

        var gx = (n * PI / L) * Math.cos(n * PI * p.x / L) * Math.sin(m * PI * p.y / L) +
                 (m * PI / L) * Math.cos(m * PI * p.x / L) * Math.sin(n * PI * p.y / L);
        var gy = (m * PI / L) * Math.sin(n * PI * p.x / L) * Math.cos(m * PI * p.y / L) +
                 (n * PI / L) * Math.sin(m * PI * p.x / L) * Math.cos(n * PI * p.y / L);

        var nudge = -val * 0.8;
        var gMag = Math.sqrt(gx * gx + gy * gy) || 1;
        p.x += (gx / gMag) * nudge + (Math.random() - 0.5) * 0.5;
        p.y += (gy / gMag) * nudge + (Math.random() - 0.5) * 0.5;

        if (p.x < 0) p.x = 0;
        if (p.x > L) p.x = L;
        if (p.y < 0) p.y = 0;
        if (p.y > L) p.y = L;

        var opacity = 0.3 + (1 - Math.min(1, Math.abs(val))) * 0.7;
        ctx.fillStyle = 'rgba(204,136,68,' + opacity + ')';
        ctx.fillRect(ox + p.x, oy + p.y, 2, 2);
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     13: HARMONIC SERIES
     ══════════════════════════════════════════ */
  function initHarmonics(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var phase = 0;
    var numHarmonics = 7;
    var colors = [
      [255, 255, 255],
      [255, 220, 220],
      [255, 200, 180],
      [220, 200, 180],
      [200, 200, 200],
      [180, 180, 190],
      [160, 160, 180]
    ];

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      var slotHeight = h / (numHarmonics + 1);

      for (var n = 0; n < numHarmonics; n++) {
        var harmonic = n + 1;
        var centerY = slotHeight * (n + 1);
        var amplitude = (slotHeight * 0.35) / harmonic;
        var freq = 0.01 * harmonic;
        var opacity = 0.9 - n * 0.08;
        var c = colors[n];

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + opacity + ')';
        ctx.lineWidth = 2 - n * 0.15;
        for (var x = 0; x < w; x++) {
          var y = centerY + Math.sin(x * freq + phase * harmonic) * amplitude;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '11px Abacaxi, sans-serif';
        ctx.fillText('H' + harmonic, 10, centerY - amplitude - 5);
      }

      phase += 0.03;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     14: SOUND PRESSURE (longitudinal)
     ══════════════════════════════════════════ */
  function initPressure(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var phase = 0;
    var numDots = 200;

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      var centerY = h / 2;
      var spacing = w / numDots;
      var amplitude = 15;
      var k = 0.06;

      var positions = [];
      for (var i = 0; i < numDots; i++) {
        var baseX = i * spacing;
        var displacement = amplitude * Math.sin(k * baseX - phase);
        positions.push(baseX + displacement);
      }

      for (var j = 0; j < numDots; j++) {
        var localDensity = 1;
        if (j > 0 && j < numDots - 1) {
          var gap = positions[j + 1] - positions[j - 1];
          var normalGap = spacing * 2;
          localDensity = normalGap / (Math.abs(gap) || 0.1);
        }
        var opacity = Math.min(1, 0.2 + Math.abs(localDensity - 1) * 0.8);
        ctx.fillStyle = 'rgba(204,136,51,' + opacity + ')';
        ctx.beginPath();
        ctx.arc(positions[j], centerY, 3, 0, TAU);
        ctx.fill();
      }

      phase += 0.06;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     15: DOPPLER SHIFT
     ══════════════════════════════════════════ */
  function initDoppler(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var sourceX = 0;
    var speed = 2;
    var rings = [];
    var frameCount = 0;

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var centerY = h / 2;
      ctx.clearRect(0, 0, w, h);

      sourceX += speed;
      if (sourceX > w + 50) sourceX = -50;

      frameCount++;
      if (frameCount % 15 === 0) {
        rings.push({ x: sourceX, y: centerY, radius: 0 });
      }

      var i = rings.length;
      while (i--) {
        rings[i].radius += 3;
        var opacity = Math.max(0, 1 - rings[i].radius / 400);
        if (opacity <= 0) {
          rings.splice(i, 1);
          continue;
        }

        var ahead = rings[i].x < sourceX;
        var color;
        if (ahead) {
          color = 'rgba(68,68,255,' + opacity * 0.5 + ')';
        } else {
          color = 'rgba(255,68,68,' + opacity * 0.5 + ')';
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(rings[i].x, rings[i].y, rings[i].radius, 0, TAU);
        ctx.stroke();
      }

      ctx.fillStyle = '#cc66cc';
      ctx.beginPath();
      ctx.arc(sourceX, centerY, 10, 0, TAU);
      ctx.fill();

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     16: TUNING FORK
     ══════════════════════════════════════════ */
  function initTuningFork(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var strikes = [];
    var phase = 0;

    function onClick(e) {
      var rect = canvas.getBoundingClientRect();
      strikes.push({
        x: rect.width / 2,
        y: rect.height / 2,
        time: Date.now()
      });
    }

    section.addEventListener('click', onClick);

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var now = Date.now();
      var cx = w / 2;
      var cy = h / 2;
      ctx.clearRect(0, 0, w, h);

      // Tuning fork vibration
      var vibration = 0;
      if (strikes.length > 0) {
        var lastStrike = strikes[strikes.length - 1];
        var elapsed = (now - lastStrike.time) / 1000;
        vibration = Math.max(0, 1 - elapsed / 4) * Math.sin(phase * 10) * 6;
      }

      // Handle
      ctx.strokeStyle = 'rgba(170,170,204,0.5)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 60);
      ctx.lineTo(cx, cy + 150);
      ctx.stroke();

      // Left prong
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy + 60);
      ctx.lineTo(cx - 8 + vibration, cy - 50);
      ctx.stroke();

      // Right prong
      ctx.beginPath();
      ctx.moveTo(cx + 8, cy + 60);
      ctx.lineTo(cx + 8 - vibration, cy - 50);
      ctx.stroke();

      // Rings from strikes
      var i = strikes.length;
      while (i--) {
        var age = (now - strikes[i].time) / 1000;
        if (age > 6) {
          strikes.splice(i, 1);
          continue;
        }
        for (var r = 0; r < 5; r++) {
          var ringAge = age - r * 0.3;
          if (ringAge < 0) continue;
          var radius = ringAge * 80;
          var ringOp = Math.max(0, (1 - ringAge / 5) * 0.4);
          ctx.strokeStyle = 'rgba(170,170,204,' + ringOp + ')';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(strikes[i].x, strikes[i].y, radius, 0, TAU);
          ctx.stroke();
        }
      }

      phase += 0.03;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      section.removeEventListener('click', onClick);
    };
  }

  /* ══════════════════════════════════════════
     17: BINAURAL BEATS
     ══════════════════════════════════════════ */
  function initBinaural(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var phase = 0;

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      var freq1 = 0.02;
      var freq2 = 0.022;
      var amplitude = h * 0.2;

      // Wave 1
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(204,68,204,0.25)';
      ctx.lineWidth = 1.5;
      for (var x1 = 0; x1 < w; x1++) {
        var y1 = h * 0.3 + Math.sin(x1 * freq1 + phase) * amplitude * 0.5;
        if (x1 === 0) ctx.moveTo(x1, y1);
        else ctx.lineTo(x1, y1);
      }
      ctx.stroke();

      // Wave 2
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(204,68,204,0.25)';
      ctx.lineWidth = 1.5;
      for (var x2 = 0; x2 < w; x2++) {
        var y2 = h * 0.5 + Math.sin(x2 * freq2 + phase) * amplitude * 0.5;
        if (x2 === 0) ctx.moveTo(x2, y2);
        else ctx.lineTo(x2, y2);
      }
      ctx.stroke();

      // Sum (interference / beat)
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(204,68,204,0.6)';
      ctx.lineWidth = 2.5;
      for (var x3 = 0; x3 < w; x3++) {
        var ySum = h * 0.7 + (Math.sin(x3 * freq1 + phase) + Math.sin(x3 * freq2 + phase)) * amplitude * 0.4;
        if (x3 === 0) ctx.moveTo(x3, ySum);
        else ctx.lineTo(x3, ySum);
      }
      ctx.stroke();

      phase += 0.02;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     18: PRANAYAMA
     ══════════════════════════════════════════ */
  function initPranayama(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var breathText = section.querySelector('[data-vs-breath-text]');
    var startTime = Date.now();
    var totalCycle = 19000;
    var inhale = 4000;
    var hold = 7000;
    var exhale = 8000;

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var cx = w / 2;
      var cy = h / 2;
      var now = Date.now();
      var elapsed = (now - startTime) % totalCycle;
      var radius, label;

      if (elapsed < inhale) {
        var progress = elapsed / inhale;
        radius = 40 + progress * 80;
        label = 'Breathe In';
      } else if (elapsed < inhale + hold) {
        radius = 120;
        label = 'Hold';
      } else {
        var exhaleProgress = (elapsed - inhale - hold) / exhale;
        radius = 120 - exhaleProgress * 80;
        label = 'Breathe Out';
      }

      if (breathText) breathText.textContent = label;

      ctx.clearRect(0, 0, w, h);

      // Glow
      var gradient = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius * 1.5);
      gradient.addColorStop(0, 'rgba(102,170,204,0.1)');
      gradient.addColorStop(1, 'rgba(102,170,204,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.5, 0, TAU);
      ctx.fill();

      // Main circle
      ctx.strokeStyle = 'rgba(102,170,204,0.6)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.stroke();

      // Particle ring
      var numParticles = 24;
      for (var i = 0; i < numParticles; i++) {
        var angle = (TAU / numParticles) * i + (now * 0.0005);
        var pr = radius + 15 + Math.sin(now * 0.002 + i) * 5;
        var px = cx + Math.cos(angle) * pr;
        var py = cy + Math.sin(angle) * pr;
        ctx.fillStyle = 'rgba(102,170,204,0.3)';
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, TAU);
        ctx.fill();
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     19: FASCIA WEB
     ══════════════════════════════════════════ */
  function initFascia(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var gridSize = 20;
    var points = [];
    var cursor = { x: -9999, y: -9999 };

    resizeCanvas(canvas);
    var w = canvas.width;
    var h = canvas.height;
    var spacingX = w / (gridSize - 1);
    var spacingY = h / (gridSize - 1);

    for (var gy = 0; gy < gridSize; gy++) {
      for (var gx = 0; gx < gridSize; gx++) {
        var rx = gx * spacingX;
        var ry = gy * spacingY;
        points.push({
          x: rx,
          y: ry,
          restX: rx,
          restY: ry,
          vx: 0,
          vy: 0
        });
      }
    }

    function onMouseMove(e) {
      var rect = section.getBoundingClientRect();
      cursor.x = e.clientX - rect.left;
      cursor.y = e.clientY - rect.top;
    }

    section.addEventListener('mousemove', onMouseMove, { passive: true });

    function draw() {
      resizeCanvas(canvas);
      var cw = canvas.width;
      var ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      // Update points
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        var dx = cursor.x - p.x;
        var dy = cursor.y - p.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 100 && dist > 0) {
          var force = (100 - dist) / 100 * 2;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        p.vx += (p.restX - p.x) * 0.05;
        p.vy += (p.restY - p.y) * 0.05;
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.x += p.vx;
        p.y += p.vy;
      }

      // Draw connections
      for (var gy2 = 0; gy2 < gridSize; gy2++) {
        for (var gx2 = 0; gx2 < gridSize; gx2++) {
          var pi = gy2 * gridSize + gx2;
          var pt = points[pi];

          if (gx2 < gridSize - 1) {
            var right = points[pi + 1];
            var stretch = Math.sqrt(Math.pow(pt.x - right.x, 2) + Math.pow(pt.y - right.y, 2));
            var baseStretch = spacingX;
            var stretchRatio = Math.min(1, Math.abs(stretch - baseStretch) / 30);
            var op = 0.1 + stretchRatio * 0.5;
            ctx.strokeStyle = 'rgba(204,119,102,' + op + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(right.x, right.y);
            ctx.stroke();
          }

          if (gy2 < gridSize - 1) {
            var below = points[pi + gridSize];
            var stretchB = Math.sqrt(Math.pow(pt.x - below.x, 2) + Math.pow(pt.y - below.y, 2));
            var baseStretchB = spacingY;
            var stretchRatioB = Math.min(1, Math.abs(stretchB - baseStretchB) / 30);
            var opB = 0.1 + stretchRatioB * 0.5;
            ctx.strokeStyle = 'rgba(204,119,102,' + opB + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(below.x, below.y);
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      for (var j = 0; j < points.length; j++) {
        ctx.fillStyle = 'rgba(204,119,102,0.3)';
        ctx.beginPath();
        ctx.arc(points[j].x, points[j].y, 1.5, 0, TAU);
        ctx.fill();
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      section.removeEventListener('mousemove', onMouseMove);
    };
  }

  /* ══════════════════════════════════════════
     20: SPINE WAVE
     ══════════════════════════════════════════ */
  function initSpine(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var phase = 0;
    var numVerts = 24;

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var cx = w / 2;
      ctx.clearRect(0, 0, w, h);

      var spacing = (h * 0.8) / (numVerts - 1);
      var startY = h * 0.1;
      var freq = 0.4;
      var prevX = 0;
      var prevY = 0;

      for (var i = 0; i < numVerts; i++) {
        var baseY = startY + i * spacing;
        var shift = Math.sin(i * freq - phase) * 40;
        var vertX = cx + shift;
        var vertY = baseY;

        var sizeBase = 5;
        var lowerBackFactor = 1 + Math.max(0, 1 - Math.abs(i - 16) / 6) * 0.8;
        var size = sizeBase * lowerBackFactor;

        var opacity = 0.4 + (i / numVerts) * 0.5;

        if (i > 0) {
          ctx.strokeStyle = 'rgba(221,204,187,' + opacity * 0.4 + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(vertX, vertY);
          ctx.stroke();
        }

        ctx.fillStyle = 'rgba(221,204,187,' + opacity + ')';
        ctx.beginPath();
        ctx.arc(vertX, vertY, size, 0, TAU);
        ctx.fill();

        prevX = vertX;
        prevY = vertY;
      }

      phase += 0.04;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     21: CHAKRA ENERGY
     ══════════════════════════════════════════ */
  function initChakra(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var chakraColors = ['#ff0000', '#ff7700', '#ffff00', '#00ff00', '#0088ff', '#4400ff', '#aa00ff'];
    var phase = 0;

    function hexToRgb(hex) {
      var r = parseInt(hex.slice(1, 3), 16);
      var g = parseInt(hex.slice(3, 5), 16);
      var b = parseInt(hex.slice(5, 7), 16);
      return { r: r, g: g, b: b };
    }

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var cx = w / 2;
      var scrollP = getScrollPercent(section);
      ctx.clearRect(0, 0, w, h);

      var spacing = (h * 0.7) / 6;
      var startY = h * 0.85;

      for (var i = 0; i < 7; i++) {
        var cy = startY - i * spacing;
        var activeThreshold = (i + 0.5) / 7;
        var isActive = scrollP >= activeThreshold;
        var color = hexToRgb(chakraColors[i]);

        if (isActive) {
          // Glow
          var glow = ctx.createRadialGradient(cx, cy, 5, cx, cy, 50);
          glow.addColorStop(0, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.3)');
          glow.addColorStop(1, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(cx, cy, 50, 0, TAU);
          ctx.fill();

          // Spinning arcs
          for (var a = 0; a < 3; a++) {
            var arcAngle = phase * (1 + i * 0.2) + a * (TAU / 3);
            ctx.strokeStyle = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.6)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 20 + a * 5, arcAngle, arcAngle + PI * 0.5);
            ctx.stroke();
          }

          // Center dot
          ctx.fillStyle = chakraColors[i];
          ctx.beginPath();
          ctx.arc(cx, cy, 8, 0, TAU);
          ctx.fill();
        } else {
          // Dim circle
          ctx.fillStyle = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.15)';
          ctx.beginPath();
          ctx.arc(cx, cy, 8, 0, TAU);
          ctx.fill();
        }
      }

      phase += 0.03;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     22: LOTUS BLOOM
     ══════════════════════════════════════════ */
  function initLotus(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var rotation = 0;
    var numPetals = 12;

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var cx = w / 2;
      var cy = h / 2;
      var scrollP = getScrollPercent(section);
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);

      // Two layers of petals
      for (var layer = 0; layer < 2; layer++) {
        var petalCount = layer === 0 ? numPetals : Math.floor(numPetals / 2);
        var layerDelay = layer * 0.15;
        var layerOpen = Math.max(0, Math.min(1, (scrollP - layerDelay) / (1 - layerDelay)));
        var petalLength = 80 + layer * 30;

        for (var i = 0; i < petalCount; i++) {
          var baseAngle = (TAU / petalCount) * i;

          ctx.save();
          ctx.rotate(baseAngle);

          var tipY = -petalLength * layerOpen;
          var cp1x = -20 * layerOpen;
          var cp1y = -petalLength * 0.4;
          var cp2x = 20 * layerOpen;
          var cp2y = -petalLength * 0.4;

          var opacity = 0.2 + layerOpen * 0.5;
          ctx.fillStyle = 'rgba(221,136,170,' + opacity + ')';
          ctx.strokeStyle = 'rgba(221,136,170,' + Math.min(1, opacity + 0.1) + ')';
          ctx.lineWidth = 1;

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(cp1x - 10, cp1y, cp1x - 5, tipY + 10, 0, tipY);
          ctx.bezierCurveTo(cp2x + 5, tipY + 10, cp2x + 10, cp2y, 0, 0);
          ctx.fill();
          ctx.stroke();

          ctx.restore();
        }
      }

      // Golden center
      ctx.fillStyle = 'rgba(218,185,107,0.7)';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, TAU);
      ctx.fill();

      ctx.restore();

      rotation += 0.003;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     23: MEDITATION STILLNESS
     ══════════════════════════════════════════ */
  function initMeditation(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var particles = [];
    var count = 200;

    resizeCanvas(canvas);
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6
      });
    }

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var cx = w / 2;
      var cy = h / 2;
      var scrollP = getScrollPercent(section);
      ctx.clearRect(0, 0, w, h);

      var chaos = 1 - scrollP;

      for (var i = 0; i < count; i++) {
        var p = particles[i];

        p.vx *= (0.95 + chaos * 0.04);
        p.vy *= (0.95 + chaos * 0.04);

        p.vx += (Math.random() - 0.5) * chaos * 2;
        p.vy += (Math.random() - 0.5) * chaos * 2;

        var pull = scrollP * 0.03;
        p.vx += (cx - p.x) * pull;
        p.vy += (cy - p.y) * pull;

        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > w) p.vx *= -0.8;
        if (p.y < 0 || p.y > h) p.vy *= -0.8;
        p.x = Math.max(0, Math.min(w, p.x));
        p.y = Math.max(0, Math.min(h, p.y));

        var opacity = 0.2 + scrollP * 0.5;
        ctx.fillStyle = 'rgba(153,153,153,' + opacity + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, TAU);
        ctx.fill();
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     24: MUSCLE FIBER
     ══════════════════════════════════════════ */
  function initMuscle(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var numFibers = 30;
    var cursorY = -1;
    var isHovering = false;
    var phase = 0;

    function onMouseMove(e) {
      var rect = section.getBoundingClientRect();
      cursorY = (e.clientY - rect.top) / rect.height;
      isHovering = true;
    }

    function onMouseLeave() {
      isHovering = false;
      cursorY = -1;
    }

    section.addEventListener('mousemove', onMouseMove, { passive: true });
    section.addEventListener('mouseleave', onMouseLeave);

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      var spacing = h / (numFibers + 1);

      for (var i = 0; i < numFibers; i++) {
        var restY = spacing * (i + 1);
        var normalizedY = restY / h;
        var drawY = restY;
        var waviness = 2;

        if (isHovering && cursorY >= 0) {
          var distFromCursor = Math.abs(normalizedY - cursorY);
          var influence = Math.max(0, 1 - distFromCursor / 0.2);
          drawY = restY + (cursorY * h - restY) * influence * 0.4;
          waviness = 2 + influence * 8;
        }

        var opacity = 0.3 + (isHovering ? 0.3 : 0);
        ctx.strokeStyle = 'rgba(204,102,68,' + opacity + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (var x = 0; x < w; x++) {
          var y = drawY + Math.sin(x * 0.02 + phase + i * 0.3) * waviness;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      phase += 0.02;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      section.removeEventListener('mousemove', onMouseMove);
      section.removeEventListener('mouseleave', onMouseLeave);
    };
  }

  /* ══════════════════════════════════════════
     25: FOCUS POINT
     ══════════════════════════════════════════ */
  function initFocus(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var particles = [];
    var count = 150;
    var cursor = { x: -9999, y: -9999, prevX: -9999, prevY: -9999 };
    var lastMoveTime = Date.now();

    resizeCanvas(canvas);
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2
      });
    }

    function onMouseMove(e) {
      var rect = section.getBoundingClientRect();
      cursor.prevX = cursor.x;
      cursor.prevY = cursor.y;
      cursor.x = e.clientX - rect.left;
      cursor.y = e.clientY - rect.top;
      lastMoveTime = Date.now();
    }

    section.addEventListener('mousemove', onMouseMove, { passive: true });

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var now = Date.now();
      ctx.clearRect(0, 0, w, h);

      var cursorVelX = cursor.x - cursor.prevX;
      var cursorVelY = cursor.y - cursor.prevY;
      var cursorSpeed = Math.sqrt(cursorVelX * cursorVelX + cursorVelY * cursorVelY);
      var timeSinceMove = (now - lastMoveTime) / 1000;
      var attraction = Math.min(1, timeSinceMove * 0.5);

      if (cursorSpeed > 5) {
        attraction = 0;
      }

      for (var i = 0; i < count; i++) {
        var p = particles[i];

        if (cursor.x > 0 && cursor.y > 0) {
          var dx = cursor.x - p.x;
          var dy = cursor.y - p.y;
          var dist = Math.sqrt(dx * dx + dy * dy);

          if (attraction > 0.1 && dist > 1) {
            p.vx += (dx / dist) * attraction * 0.5;
            p.vy += (dy / dist) * attraction * 0.5;
          }

          if (cursorSpeed > 10 && dist < 200) {
            p.vx += (Math.random() - 0.5) * cursorSpeed * 0.2;
            p.vy += (Math.random() - 0.5) * cursorSpeed * 0.2;
          }
        }

        p.vx *= 0.95;
        p.vy *= 0.95;
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        if (p.x > w) { p.x = w; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        if (p.y > h) { p.y = h; p.vy *= -1; }

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, TAU);
        ctx.fill();
      }

      // Connection lines when clustered
      for (var a = 0; a < count; a++) {
        for (var b = a + 1; b < count; b++) {
          var cdx = particles[a].x - particles[b].x;
          var cdy = particles[a].y - particles[b].y;
          var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
          if (cdist < 40) {
            var lineOp = (1 - cdist / 40) * 0.2;
            ctx.strokeStyle = 'rgba(255,255,255,' + lineOp + ')';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.stroke();
          }
        }
      }

      cursor.prevX = cursor.x;
      cursor.prevY = cursor.y;

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {
      section.removeEventListener('mousemove', onMouseMove);
    };
  }

  /* ══════════════════════════════════════════
     26: HEARTBEAT
     ══════════════════════════════════════════ */
  function initHeartbeat(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var dataPoints = [];
    var phase = 0;

    function ecgValue(t) {
      var cycle = t % 1;
      if (cycle < 0) cycle += 1;
      // P wave
      if (cycle < 0.1) return Math.sin(cycle / 0.1 * PI) * 0.15;
      // Flat
      if (cycle < 0.15) return 0;
      // Q dip
      if (cycle < 0.18) return -0.1;
      // R spike (up then down)
      if (cycle < 0.22) {
        var rT = (cycle - 0.18) / 0.04;
        if (rT < 0.5) return -0.1 + rT * 2 * 1.1;
        return 1.0 - (rT - 0.5) * 2 * 1.1;
      }
      // S dip
      if (cycle < 0.27) return -((0.27 - cycle) / 0.05) * 0.2;
      // Flat
      if (cycle < 0.45) return 0;
      // T wave
      if (cycle < 0.6) return Math.sin((cycle - 0.45) / 0.15 * PI) * 0.2;
      // Flat
      return 0;
    }

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var maxPoints = w;
      ctx.clearRect(0, 0, w, h);

      var scrollP = getScrollPercent(section);
      var bpm = 150 - scrollP * 90;
      var cyclesPerFrame = bpm / 60 / 60;
      phase += cyclesPerFrame;

      var cy = h / 2;
      var amplitude = h * 0.3;
      var val = ecgValue(phase);
      dataPoints.push(val);
      if (dataPoints.length > maxPoints) dataPoints.shift();

      // Fill area below
      ctx.fillStyle = 'rgba(204,51,51,0.05)';
      ctx.beginPath();
      ctx.moveTo(0, cy);
      for (var i = 0; i < dataPoints.length; i++) {
        ctx.lineTo(i, cy - dataPoints[i] * amplitude);
      }
      ctx.lineTo(dataPoints.length - 1, cy);
      ctx.closePath();
      ctx.fill();

      // ECG line with glow
      ctx.save();
      ctx.strokeStyle = '#cc3333';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#cc3333';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      for (var j = 0; j < dataPoints.length; j++) {
        var y = cy - dataPoints[j] * amplitude;
        if (j === 0) ctx.moveTo(j, y);
        else ctx.lineTo(j, y);
      }
      ctx.stroke();
      ctx.restore();

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     27: NEURAL FIRE
     ══════════════════════════════════════════ */
  function initNeural(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var neurons = [];
    var signals = [];
    var numNeurons = 40;
    var lastFire = 0;

    resizeCanvas(canvas);
    var w = canvas.width;
    var h = canvas.height;

    for (var i = 0; i < numNeurons; i++) {
      neurons.push({
        x: Math.random() * w,
        y: Math.random() * h,
        brightness: 0,
        connections: []
      });
    }

    // Build connections
    for (var a = 0; a < numNeurons; a++) {
      for (var b = a + 1; b < numNeurons; b++) {
        var dx = neurons[a].x - neurons[b].x;
        var dy = neurons[a].y - neurons[b].y;
        if (Math.sqrt(dx * dx + dy * dy) < 150) {
          neurons[a].connections.push(b);
          neurons[b].connections.push(a);
        }
      }
    }

    function fireNeuron(nIdx) {
      neurons[nIdx].brightness = 1;
      var conns = neurons[nIdx].connections;
      for (var c = 0; c < conns.length; c++) {
        signals.push({
          from: nIdx,
          to: conns[c],
          progress: 0,
          speed: 0.03
        });
      }
    }

    function draw() {
      resizeCanvas(canvas);
      var cw = canvas.width;
      var ch = canvas.height;
      var scrollP = getScrollPercent(section);
      var now = Date.now();
      ctx.clearRect(0, 0, cw, ch);

      // Random firing based on scroll
      var fireInterval = 2000 - scrollP * 1800;
      if (fireInterval < 200) fireInterval = 200;
      if (now - lastFire > fireInterval && neurons.length > 0) {
        fireNeuron(Math.floor(Math.random() * numNeurons));
        lastFire = now;
      }

      // Draw connections
      for (var a = 0; a < numNeurons; a++) {
        var conns = neurons[a].connections;
        for (var c = 0; c < conns.length; c++) {
          if (conns[c] > a) {
            ctx.strokeStyle = 'rgba(51,136,255,0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(neurons[a].x, neurons[a].y);
            ctx.lineTo(neurons[conns[c]].x, neurons[conns[c]].y);
            ctx.stroke();
          }
        }
      }

      // Update and draw signals
      var si = signals.length;
      while (si--) {
        var sig = signals[si];
        sig.progress += sig.speed;
        if (sig.progress >= 1) {
          if (Math.random() < 0.6) {
            fireNeuron(sig.to);
          }
          signals.splice(si, 1);
          continue;
        }
        var fromN = neurons[sig.from];
        var toN = neurons[sig.to];
        var sx = fromN.x + (toN.x - fromN.x) * sig.progress;
        var sy = fromN.y + (toN.y - fromN.y) * sig.progress;
        ctx.fillStyle = '#3388ff';
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, TAU);
        ctx.fill();
      }

      // Draw neurons
      for (var n = 0; n < numNeurons; n++) {
        neurons[n].brightness *= 0.95;
        var br = neurons[n].brightness;
        var opacity = 0.2 + br * 0.8;
        var radius = 4 + br * 4;
        ctx.fillStyle = 'rgba(51,136,255,' + opacity + ')';
        ctx.beginPath();
        ctx.arc(neurons[n].x, neurons[n].y, radius, 0, TAU);
        ctx.fill();
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     28: FLOW STATE
     ══════════════════════════════════════════ */
  function initFlow(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var curves = [];
    var numCurves = 6;
    var particlesPerCurve = 10;

    resizeCanvas(canvas);
    var w = canvas.width;
    var h = canvas.height;

    for (var c = 0; c < numCurves; c++) {
      var yBase = (h / (numCurves + 1)) * (c + 1);
      var pts = [
        { x: 0, y: yBase + (Math.random() - 0.5) * 60 },
        { x: w * 0.33, y: yBase + (Math.random() - 0.5) * 80 },
        { x: w * 0.66, y: yBase + (Math.random() - 0.5) * 80 },
        { x: w, y: yBase + (Math.random() - 0.5) * 60 }
      ];
      var cParticles = [];
      for (var p = 0; p < particlesPerCurve; p++) {
        cParticles.push({ t: p / particlesPerCurve });
      }
      curves.push({ points: pts, particles: cParticles });
    }

    function bezierPoint(p0, p1, p2, p3, t) {
      var mt = 1 - t;
      return {
        x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
        y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
      };
    }

    function draw() {
      resizeCanvas(canvas);
      var cw = canvas.width;
      var ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      for (var c = 0; c < curves.length; c++) {
        var curve = curves[c];
        var pts = curve.points;

        // Draw faint curve path
        ctx.strokeStyle = 'rgba(136,204,136,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
        ctx.stroke();

        // Update and draw particles
        for (var p = 0; p < curve.particles.length; p++) {
          var particle = curve.particles[p];
          particle.t += 0.003;
          if (particle.t > 1) particle.t -= 1;

          var pos = bezierPoint(pts[0], pts[1], pts[2], pts[3], particle.t);

          // Trail
          for (var tr = 1; tr <= 5; tr++) {
            var trailT = particle.t - tr * 0.005;
            if (trailT < 0) trailT += 1;
            var trailPos = bezierPoint(pts[0], pts[1], pts[2], pts[3], trailT);
            var trailOp = 0.3 - tr * 0.05;
            if (trailOp < 0) trailOp = 0;
            ctx.fillStyle = 'rgba(136,204,136,' + trailOp + ')';
            ctx.beginPath();
            ctx.arc(trailPos.x, trailPos.y, Math.max(0.5, 2 - tr * 0.2), 0, TAU);
            ctx.fill();
          }

          // Main dot
          ctx.fillStyle = 'rgba(136,204,136,0.7)';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 3, 0, TAU);
          ctx.fill();
        }
      }

      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     29: KUNDALINI SPIRAL
     ══════════════════════════════════════════ */
  function initKundalini(section, canvas, idx) {
    var ctx = canvas.getContext('2d');
    var numParticles = 30;
    var particles = [];
    var phase = 0;

    for (var i = 0; i < numParticles; i++) {
      particles.push({ t: i / numParticles });
    }

    function getColorForHeight(t) {
      var r, g, b;
      if (t < 0.17) {
        // Red
        r = 255; g = Math.floor(t / 0.17 * 119); b = 0;
      } else if (t < 0.33) {
        // Orange -> Yellow
        var p1 = (t - 0.17) / 0.16;
        r = 255; g = 119 + Math.floor(p1 * 136); b = 0;
      } else if (t < 0.5) {
        // Yellow -> Green
        var p2 = (t - 0.33) / 0.17;
        r = 255 - Math.floor(p2 * 255); g = 255; b = 0;
      } else if (t < 0.67) {
        // Green -> Blue
        var p3 = (t - 0.5) / 0.17;
        r = 0; g = 255 - Math.floor(p3 * 255); b = Math.floor(p3 * 255);
      } else if (t < 0.83) {
        // Blue -> Indigo
        var p4 = (t - 0.67) / 0.16;
        r = Math.floor(p4 * 68); g = 0; b = 255;
      } else {
        // Indigo -> Violet
        var p5 = (t - 0.83) / 0.17;
        r = 68 + Math.floor(p5 * 102); g = 0; b = 255;
      }
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      return { r: r, g: g, b: b };
    }

    function draw() {
      resizeCanvas(canvas);
      var w = canvas.width;
      var h = canvas.height;
      var cx = w / 2;
      var scrollP = getScrollPercent(section);
      ctx.clearRect(0, 0, w, h);

      var spiralHeight = h * 0.8;
      var startY = h * 0.9;
      var spiralRadius = 60;
      var turns = 5;
      var steps = 200;

      // Draw faint spiral path (helix 1)
      ctx.strokeStyle = 'rgba(255,136,68,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var s = 0; s <= steps; s++) {
        var st = s / steps;
        var sy = startY - st * spiralHeight;
        var sAngle = st * turns * TAU + phase;
        var sx = cx + Math.cos(sAngle) * spiralRadius;
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      // Helix 2
      ctx.beginPath();
      for (var s2 = 0; s2 <= steps; s2++) {
        var st2 = s2 / steps;
        var sy2 = startY - st2 * spiralHeight;
        var sAngle2 = st2 * turns * TAU + phase + PI;
        var sx2 = cx + Math.cos(sAngle2) * spiralRadius;
        if (s2 === 0) ctx.moveTo(sx2, sy2);
        else ctx.lineTo(sx2, sy2);
      }
      ctx.stroke();

      // Particles
      var maxHeight = scrollP;
      for (var i = 0; i < numParticles; i++) {
        var pt = particles[i];
        pt.t += 0.002;
        if (pt.t > maxHeight) pt.t = 0;
        if (maxHeight <= 0) continue;

        var py = startY - pt.t * spiralHeight;
        var pAngle = pt.t * turns * TAU + phase;
        var px = cx + Math.cos(pAngle) * spiralRadius;
        var color = getColorForHeight(pt.t);

        // Glow
        var glowGrad = ctx.createRadialGradient(px, py, 0, px, py, 15);
        glowGrad.addColorStop(0, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.4)');
        glowGrad.addColorStop(1, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(px, py, 15, 0, TAU);
        ctx.fill();

        // Core dot
        ctx.fillStyle = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.9)';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, TAU);
        ctx.fill();

        // Trail
        for (var tr = 1; tr <= 4; tr++) {
          var trailT = pt.t - tr * 0.008;
          if (trailT < 0) continue;
          var tpy = startY - trailT * spiralHeight;
          var tAngle = trailT * turns * TAU + phase;
          var tpx = cx + Math.cos(tAngle) * spiralRadius;
          var trOp = 0.4 - tr * 0.08;
          if (trOp < 0) trOp = 0;
          ctx.fillStyle = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + trOp + ')';
          ctx.beginPath();
          ctx.arc(tpx, tpy, Math.max(1, 3 - tr * 0.5), 0, TAU);
          ctx.fill();
        }
      }

      phase += 0.02;
      activeFrames[idx] = requestAnimationFrame(draw);
    }

    draw();

    return function() {};
  }

  /* ══════════════════════════════════════════
     INITIALIZATION
     ══════════════════════════════════════════ */

  document.addEventListener('DOMContentLoaded', function() {
    var sections = document.querySelectorAll('.vs-section');
    var progressBar = document.getElementById('vs-progress-bar');
    var navLinks = document.querySelectorAll('.vs-nav__link');

    // Generate frequency bars
    var freqBarsContainer = document.querySelector('[data-vs-freq-bars]');
    if (freqBarsContainer) {
      for (var fb = 0; fb < 40; fb++) {
        var bar = document.createElement('div');
        bar.className = 'vs-freq-bar';
        freqBarsContainer.appendChild(bar);
      }
    }

    // IntersectionObserver
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          var sIdx = parseInt(entry.target.getAttribute('data-vs-idx'), 10);
          if (entry.isIntersecting) {
            activateSection(sections, sIdx);
          } else {
            deactivateSection(sIdx);
          }
        }
      }, { threshold: 0.2 });

      for (var s = 0; s < sections.length; s++) {
        observer.observe(sections[s]);
      }
    }

    // Scroll listener (throttled with rAF)
    var scrollTicking = false;
    function onScroll() {
      if (!scrollTicking) {
        requestAnimationFrame(function() {
          // Progress bar
          var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
          var docHeight = document.documentElement.scrollHeight - window.innerHeight;
          var scrollFraction = docHeight > 0 ? scrollTop / docHeight : 0;
          if (progressBar) {
            progressBar.style.width = (scrollFraction * 100) + '%';
          }

          // Active nav link
          var currentIdx = 0;
          for (var si = 0; si < sections.length; si++) {
            var rect = sections[si].getBoundingClientRect();
            if (rect.top < window.innerHeight * 0.5) {
              currentIdx = si;
            }
          }
          for (var n = 0; n < navLinks.length; n++) {
            var linkIdx = parseInt(navLinks[n].getAttribute('data-section'), 10);
            if (linkIdx === currentIdx) {
              navLinks[n].classList.add('is-active');
            } else {
              navLinks[n].classList.remove('is-active');
            }
          }

          scrollTicking = false;
        });
        scrollTicking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    // Nav link smooth scroll
    for (var nl = 0; nl < navLinks.length; nl++) {
      navLinks[nl].addEventListener('click', function(e) {
        var href = this.getAttribute('href');
        if (href && href.charAt(0) === '#') {
          e.preventDefault();
          var target = document.getElementById(href.substring(1));
          if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });
    }

    // Initial scroll update
    onScroll();
  });

})();
