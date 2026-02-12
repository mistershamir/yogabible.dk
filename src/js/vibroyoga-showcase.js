(function() {
  'use strict';

  // ─── Global State ───
  var sections = [];
  var activeCanvases = {};
  var state = {
    oscilloscope: { mouseY: 0.5, phase: 0 },
    seismic: { data: [], intensity: 0 },
    molecular: { particles: [], temperature: 0.1 },
    frequency: { wavePhase: 0 },
    cursorField: { particles: [], mouseX: 0, mouseY: 0 },
    cymatics: { dots: [], phase: 0 },
    ripple: { sources: [], phase: 0 },
    pendulum: { bobs: [], startTime: 0, trails: [] }
  };

  // ─── Utility Functions ───

  function getScrollPercentOfSection(section) {
    var rect = section.getBoundingClientRect();
    var viewportCenter = window.innerHeight / 2;
    var sectionTop = rect.top;
    var sectionHeight = rect.height;
    var percent = (viewportCenter - sectionTop) / sectionHeight;
    if (percent < 0) return 0;
    if (percent > 1) return 1;
    return percent;
  }

  function resizeCanvas(canvas) {
    var parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
  }

  function resizeAllVisibleCanvases() {
    for (var idx in activeCanvases) {
      if (activeCanvases.hasOwnProperty(idx)) {
        var section = sections[parseInt(idx, 10)];
        if (section) {
          var canvas = section.querySelector('.vs-canvas, .vs-seismic-canvas');
          if (canvas) {
            if (canvas.classList.contains('vs-seismic-canvas')) {
              canvas.width = canvas.parentElement.clientWidth;
            } else {
              resizeCanvas(canvas);
            }
          }
        }
      }
    }
  }

  // ─── Section Initializers ───

  function initOscilloscope(section, index) {
    var canvas = section.querySelector('[data-vs-type="oscilloscope"]');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    resizeCanvas(canvas);

    var onMouseMove = function(e) {
      state.oscilloscope.mouseY = e.clientY / window.innerHeight;
    };
    section.addEventListener('mousemove', onMouseMove);
    section._vsCleanup = function() {
      section.removeEventListener('mousemove', onMouseMove);
    };

    state.oscilloscope.phase = 0;

    function animate() {
      var w = canvas.width;
      var h = canvas.height;
      var centerY = h / 2;
      var mouseY = state.oscilloscope.mouseY;

      ctx.clearRect(0, 0, w, h);

      var waves = [
        { amp: 20 + mouseY * 60, freq: 0.015, speed: 0.02, opacity: 0.15 },
        { amp: 30 + mouseY * 40, freq: 0.02, speed: 0.015, opacity: 0.3 },
        { amp: 15 + mouseY * 30, freq: 0.025, speed: 0.025, opacity: 0.5 }
      ];

      for (var w_i = 0; w_i < waves.length; w_i++) {
        var wave = waves[w_i];
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(124, 92, 255, ' + wave.opacity + ')';
        ctx.lineWidth = 2;

        for (var x = 0; x < w; x++) {
          var y = centerY + Math.sin(x * wave.freq + state.oscilloscope.phase * wave.speed) * wave.amp;
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      state.oscilloscope.phase += 2;

      activeCanvases[index] = requestAnimationFrame(animate);
    }

    activeCanvases[index] = requestAnimationFrame(animate);
  }

  function initSeismic(section, index) {
    var canvas = section.querySelector('.vs-seismic-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.clientWidth;
    var h = 120;

    state.seismic.data = [];

    // Hover events on shake cards
    var shakeCards = section.querySelectorAll('[data-vs-shake]');
    for (var i = 0; i < shakeCards.length; i++) {
      (function(card) {
        card.addEventListener('mouseenter', function() {
          card.classList.add('is-shaking');
        });
        card.addEventListener('mouseleave', function() {
          card.classList.remove('is-shaking');
        });
      })(shakeCards[i]);
    }

    function animate() {
      var w = canvas.width;
      var scrollPercent = getScrollPercentOfSection(section);
      var intensity = scrollPercent * 3;

      // Add new data point
      state.seismic.data.push(h / 2 + (Math.random() - 0.5) * intensity * 40);

      // Remove oldest if beyond canvas width
      if (state.seismic.data.length > w) {
        state.seismic.data.shift();
      }

      ctx.clearRect(0, 0, w, h);

      // Draw center baseline
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(204, 68, 0, 0.15)';
      ctx.lineWidth = 1;
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Draw seismic line
      if (state.seismic.data.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = '#cc4400';
        ctx.lineWidth = 1.5;
        var startX = w - state.seismic.data.length;
        for (var j = 0; j < state.seismic.data.length; j++) {
          var px = startX + j;
          if (j === 0) {
            ctx.moveTo(px, state.seismic.data[j]);
          } else {
            ctx.lineTo(px, state.seismic.data[j]);
          }
        }
        ctx.stroke();
      }

      activeCanvases[index] = requestAnimationFrame(animate);
    }

    activeCanvases[index] = requestAnimationFrame(animate);
  }

  function initResonanceCascade(section, index) {
    var cards = section.querySelectorAll('[data-vs-cascade]');
    var timeouts = [];

    for (var i = 0; i < cards.length; i++) {
      (function(card, cardIndex) {
        card.addEventListener('mouseenter', function() {
          // Clear any existing timeouts
          for (var t = 0; t < timeouts.length; t++) {
            clearTimeout(timeouts[t]);
          }
          timeouts = [];

          // Add cascading to the hovered card immediately
          card.classList.add('is-cascading');
          var selfTimeout = setTimeout(function() {
            card.classList.remove('is-cascading');
          }, 600);
          timeouts.push(selfTimeout);

          // Cascade to other cards
          for (var j = 0; j < cards.length; j++) {
            if (j === cardIndex) continue;
            (function(otherCard, distance) {
              var addTimeout = setTimeout(function() {
                otherCard.classList.add('is-cascading');
                var removeTimeout = setTimeout(function() {
                  otherCard.classList.remove('is-cascading');
                }, 600);
                timeouts.push(removeTimeout);
              }, distance * 150);
              timeouts.push(addTimeout);
            })(cards[j], Math.abs(j - cardIndex));
          }
        });
      })(cards[i], parseInt(cards[i].getAttribute('data-vs-cascade'), 10));
    }

    section._vsCleanup = function() {
      for (var t = 0; t < timeouts.length; t++) {
        clearTimeout(timeouts[t]);
      }
      timeouts = [];
    };

    // No animation frame needed for this section, but store a dummy to track active
    activeCanvases[index] = -1;
  }

  function initMolecular(section, index) {
    var canvas = section.querySelector('[data-vs-type="molecular"]');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    resizeCanvas(canvas);

    // Create particles
    state.molecular.particles = [];
    for (var i = 0; i < 120; i++) {
      state.molecular.particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: 1 + Math.random() * 1.5,
        opacity: 0.2 + Math.random() * 0.3
      });
    }

    var tempFill = document.getElementById('vs-temp-fill');

    function animate() {
      var w = canvas.width;
      var h = canvas.height;
      var scrollPercent = getScrollPercentOfSection(section);
      var temperature = 0.1 + scrollPercent * 2.5;
      state.molecular.temperature = temperature;

      // Update temperature meter
      if (tempFill) {
        tempFill.style.width = (scrollPercent * 100) + '%';
      }

      ctx.clearRect(0, 0, w, h);

      var particles = state.molecular.particles;

      // Update particles - Brownian motion
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];

        // Brownian jitter scaled by temperature
        p.vx += (Math.random() - 0.5) * temperature * 0.5;
        p.vy += (Math.random() - 0.5) * temperature * 0.5;

        // Damping
        p.vx *= 0.95;
        p.vy *= 0.95;

        // Update position
        p.x += p.vx;
        p.y += p.vy;

        // Bounce off edges
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
        if (p.x > w) { p.x = w; p.vx = -Math.abs(p.vx); }
        if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
        if (p.y > h) { p.y = h; p.vy = -Math.abs(p.vy); }
      }

      // Draw bonds between nearby particles
      for (var a = 0; a < particles.length; a++) {
        for (var b = a + 1; b < particles.length; b++) {
          var dx = particles[a].x - particles[b].x;
          var dy = particles[a].y - particles[b].y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 60) {
            var lineOpacity = (1 - dist / 60) * 0.3;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(0, 191, 165, ' + lineOpacity + ')';
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (var j = 0; j < particles.length; j++) {
        var pt = particles[j];
        ctx.beginPath();
        ctx.fillStyle = 'rgba(0, 191, 165, ' + pt.opacity + ')';
        ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      activeCanvases[index] = requestAnimationFrame(animate);
    }

    activeCanvases[index] = requestAnimationFrame(animate);
  }

  function initFrequency(section, index) {
    var canvas = section.querySelector('[data-vs-type="frequency"]');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    resizeCanvas(canvas);

    state.frequency.wavePhase = 0;

    var freqBars = section.querySelectorAll('.vs-freq-bar');
    var vibrateLetters = section.querySelectorAll('.vs-vibrate-letter');

    function animate() {
      var w = canvas.width;
      var h = canvas.height;
      var centerY = h / 2;
      var scrollPercent = getScrollPercentOfSection(section);

      ctx.clearRect(0, 0, w, h);

      // Draw 3 sine waves (teal)
      var waves = [
        { amp: 30 + scrollPercent * 50, freq: 0.01, speed: 0.02, opacity: 0.12 },
        { amp: 20 + scrollPercent * 40, freq: 0.015, speed: 0.018, opacity: 0.25 },
        { amp: 15 + scrollPercent * 35, freq: 0.02, speed: 0.025, opacity: 0.4 }
      ];

      for (var wi = 0; wi < waves.length; wi++) {
        var wave = waves[wi];
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(63, 153, 165, ' + wave.opacity + ')';
        ctx.lineWidth = 2;

        for (var x = 0; x < w; x++) {
          var y = centerY + Math.sin(x * wave.freq + state.frequency.wavePhase * wave.speed) * wave.amp;
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      state.frequency.wavePhase += 2;

      // Update frequency bars
      for (var b = 0; b < freqBars.length; b++) {
        var barHeight = 10 + Math.abs(Math.sin(state.frequency.wavePhase * 0.03 + b * 0.4)) * 80 * (0.3 + scrollPercent * 0.7);
        freqBars[b].style.height = barHeight + 'px';
      }

      // Update vibrate letter intensity
      var vibrateIntensity = 0.5 + scrollPercent * 1.5;
      for (var l = 0; l < vibrateLetters.length; l++) {
        vibrateLetters[l].style.setProperty('--vibrate-intensity', vibrateIntensity);
      }

      activeCanvases[index] = requestAnimationFrame(animate);
    }

    activeCanvases[index] = requestAnimationFrame(animate);
  }

  function initCursorField(section, index) {
    var canvas = section.querySelector('[data-vs-type="cursor-field"]');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    resizeCanvas(canvas);

    // Create particles
    state.cursorField.particles = [];
    for (var i = 0; i < 80; i++) {
      state.cursorField.particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: 1 + Math.random() * 2,
        opacity: 0.2 + Math.random() * 0.4
      });
    }

    state.cursorField.mouseX = canvas.width / 2;
    state.cursorField.mouseY = canvas.height / 2;

    var onMouseMove = function(e) {
      var rect = canvas.getBoundingClientRect();
      state.cursorField.mouseX = e.clientX - rect.left;
      state.cursorField.mouseY = e.clientY - rect.top;
    };
    section.addEventListener('mousemove', onMouseMove);

    // Magnetic title effect
    var magneticTitle = section.querySelector('[data-vs-magnetic]');
    var magneticBaseX = 0;
    var magneticBaseY = 0;
    var magneticCurrentX = 0;
    var magneticCurrentY = 0;

    var onMagneticMove = function(e) {
      if (!magneticTitle) return;
      var rect = magneticTitle.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;
      magneticBaseX = (e.clientX - centerX) * 0.1;
      magneticBaseY = (e.clientY - centerY) * 0.1;
    };
    if (magneticTitle) {
      section.addEventListener('mousemove', onMagneticMove);
    }

    section._vsCleanup = function() {
      section.removeEventListener('mousemove', onMouseMove);
      if (magneticTitle) {
        section.removeEventListener('mousemove', onMagneticMove);
        magneticTitle.style.transform = '';
      }
    };

    function animate() {
      var w = canvas.width;
      var h = canvas.height;
      var mx = state.cursorField.mouseX;
      var my = state.cursorField.mouseY;
      var particles = state.cursorField.particles;

      ctx.clearRect(0, 0, w, h);

      // Update particles
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];

        // Mouse repulsion
        var dx = p.x - mx;
        var dy = p.y - my;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150 && dist > 0) {
          var force = (150 - dist) / 150;
          p.vx += (dx / dist) * force * 0.8;
          p.vy += (dy / dist) * force * 0.8;
        }

        // Damping
        p.vx *= 0.98;
        p.vy *= 0.98;

        // Update position
        p.x += p.vx;
        p.y += p.vy;

        // Bounce off edges
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
        if (p.x > w) { p.x = w; p.vx = -Math.abs(p.vx); }
        if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
        if (p.y > h) { p.y = h; p.vy = -Math.abs(p.vy); }
      }

      // Draw connection lines
      for (var a = 0; a < particles.length; a++) {
        for (var b = a + 1; b < particles.length; b++) {
          var lx = particles[a].x - particles[b].x;
          var ly = particles[a].y - particles[b].y;
          var ld = Math.sqrt(lx * lx + ly * ly);
          if (ld < 100) {
            var lineOpacity = (1 - ld / 100) * 0.3;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(63, 153, 165, ' + lineOpacity + ')';
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (var j = 0; j < particles.length; j++) {
        var pt = particles[j];
        ctx.beginPath();
        ctx.fillStyle = 'rgba(63, 153, 165, ' + pt.opacity + ')';
        ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Magnetic title lerp
      if (magneticTitle) {
        magneticCurrentX += (magneticBaseX - magneticCurrentX) * 0.08;
        magneticCurrentY += (magneticBaseY - magneticCurrentY) * 0.08;
        magneticTitle.style.transform = 'translate(' + magneticCurrentX + 'px, ' + magneticCurrentY + 'px)';
      }

      activeCanvases[index] = requestAnimationFrame(animate);
    }

    activeCanvases[index] = requestAnimationFrame(animate);
  }

  function initCymatics(section, index) {
    var canvas = section.querySelector('[data-vs-type="cymatics"]');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    resizeCanvas(canvas);

    // Init dot grid
    var spacing = 20;
    var cols = Math.floor(canvas.width / spacing);
    var rows = Math.floor(canvas.height / spacing);
    var centerX = canvas.width / 2;
    var centerY = canvas.height / 2;

    state.cymatics.dots = [];
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var bx = (col - cols / 2) * spacing + centerX;
        var by = (row - rows / 2) * spacing + centerY;
        state.cymatics.dots.push({
          baseX: bx,
          baseY: by,
          x: bx,
          y: by
        });
      }
    }

    state.cymatics.phase = 0;

    function animate() {
      var w = canvas.width;
      var h = canvas.height;
      var scrollPercent = getScrollPercentOfSection(section);
      var freq = 0.02 + scrollPercent * 0.04;
      var cx = w / 2;
      var cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      var dots = state.cymatics.dots;
      for (var i = 0; i < dots.length; i++) {
        var dot = dots[i];
        var dx = dot.baseX - cx;
        var dy = dot.baseY - cy;
        var distFromCenter = Math.sqrt(dx * dx + dy * dy);

        var displacement = Math.sin(distFromCenter * freq - state.cymatics.phase * 0.02) * 8;
        var intensity = Math.abs(displacement) / 8;

        dot.x = dot.baseX + (dx / (distFromCenter || 1)) * displacement;
        dot.y = dot.baseY + (dy / (distFromCenter || 1)) * displacement;

        var dotOpacity = 0.1 + intensity * 0.6;
        var dotSize = 1 + intensity * 2;

        ctx.beginPath();
        ctx.fillStyle = 'rgba(232, 220, 200, ' + dotOpacity + ')';
        ctx.arc(dot.x, dot.y, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }

      state.cymatics.phase += 1;

      activeCanvases[index] = requestAnimationFrame(animate);
    }

    activeCanvases[index] = requestAnimationFrame(animate);
  }

  function initStringResonance(section, index) {
    var strings = section.querySelectorAll('.vs-string-svg');

    for (var i = 0; i < strings.length; i++) {
      (function(stringEl) {
        var onEnter = function() {
          stringEl.classList.add('is-plucked');
        };
        var onAnimEnd = function() {
          stringEl.classList.remove('is-plucked');
        };
        stringEl.addEventListener('mouseenter', onEnter);
        stringEl.addEventListener('animationend', onAnimEnd);

        // Store cleanup references
        stringEl._vsOnEnter = onEnter;
        stringEl._vsOnAnimEnd = onAnimEnd;
      })(strings[i]);
    }

    section._vsCleanup = function() {
      for (var j = 0; j < strings.length; j++) {
        strings[j].removeEventListener('mouseenter', strings[j]._vsOnEnter);
        strings[j].removeEventListener('animationend', strings[j]._vsOnAnimEnd);
        strings[j].classList.remove('is-plucked');
      }
    };

    // Track as active (no animation frame needed)
    activeCanvases[index] = -1;
  }

  function initRipple(section, index) {
    var canvas = section.querySelector('[data-vs-type="ripple"]');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    resizeCanvas(canvas);

    state.ripple.sources = [];
    state.ripple.phase = 0;

    var rippleCountEl = document.getElementById('vs-ripple-count');

    var onClick = function(e) {
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      state.ripple.sources.push({ x: x, y: y, time: Date.now() });
      if (rippleCountEl) {
        rippleCountEl.textContent = state.ripple.sources.length;
      }
    };
    section.addEventListener('click', onClick);

    section._vsCleanup = function() {
      section.removeEventListener('click', onClick);
    };

    function animate() {
      var w = canvas.width;
      var h = canvas.height;
      var now = Date.now();
      var sources = state.ripple.sources;

      ctx.clearRect(0, 0, w, h);

      // Remove sources older than 15 seconds
      var filtered = [];
      for (var s = 0; s < sources.length; s++) {
        if (now - sources[s].time < 15000) {
          filtered.push(sources[s]);
        }
      }
      state.ripple.sources = filtered;
      sources = filtered;

      if (rippleCountEl) {
        rippleCountEl.textContent = sources.length;
      }

      // Sample every 4px for performance
      if (sources.length > 0) {
        var step = 4;
        for (var px = 0; px < w; px += step) {
          for (var py = 0; py < h; py += step) {
            var totalWave = 0;

            for (var si = 0; si < sources.length; si++) {
              var src = sources[si];
              var dx = px - src.x;
              var dy = py - src.y;
              var dist = Math.sqrt(dx * dx + dy * dy);
              var age = now - src.time;
              var decay = Math.max(0, 1 - dist / 400);
              var wave = Math.sin(dist / 20 - age * 0.003) * decay;
              totalWave += wave;
            }

            var absWave = Math.abs(totalWave);
            if (absWave > 0.01) {
              var alpha = absWave * 0.4;
              if (alpha > 1) alpha = 1;
              ctx.fillStyle = 'rgba(68, 136, 204, ' + alpha + ')';
              ctx.fillRect(px, py, step, step);
            }
          }
        }
      }

      state.ripple.phase += 1;

      activeCanvases[index] = requestAnimationFrame(animate);
    }

    activeCanvases[index] = requestAnimationFrame(animate);
  }

  function initPendulum(section, index) {
    var canvas = section.querySelector('[data-vs-type="pendulum"]');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    resizeCanvas(canvas);

    var numBobs = 15;
    var maxAngle = 0.5; // radians
    state.pendulum.startTime = Date.now();
    state.pendulum.bobs = [];
    state.pendulum.trails = [];

    var padding = 60;
    var availableWidth = canvas.width - padding * 2;
    var pivotY = canvas.height * 0.15;
    var maxStringLength = canvas.height * 0.6;
    var minStringLength = canvas.height * 0.35;

    for (var i = 0; i < numBobs; i++) {
      var period = 3000 + i * 120;
      var stringLength = minStringLength + (i / (numBobs - 1)) * (maxStringLength - minStringLength);
      var pivotX = padding + (i / (numBobs - 1)) * availableWidth;

      state.pendulum.bobs.push({
        pivotX: pivotX,
        period: period,
        stringLength: stringLength
      });
      state.pendulum.trails.push([]);
    }

    // Reset button
    var resetBtn = document.getElementById('vs-pendulum-reset');
    var onReset = function() {
      state.pendulum.startTime = Date.now();
      // Clear trails
      for (var t = 0; t < state.pendulum.trails.length; t++) {
        state.pendulum.trails[t] = [];
      }
    };
    if (resetBtn) {
      resetBtn.addEventListener('click', onReset);
    }

    section._vsCleanup = function() {
      if (resetBtn) {
        resetBtn.removeEventListener('click', onReset);
      }
    };

    function animate() {
      var w = canvas.width;
      var h = canvas.height;
      var now = Date.now();
      var elapsed = now - state.pendulum.startTime;

      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < state.pendulum.bobs.length; i++) {
        var bob = state.pendulum.bobs[i];
        var angle = maxAngle * Math.cos(2 * Math.PI * elapsed / bob.period);

        var bobX = bob.pivotX + bob.stringLength * Math.sin(angle);
        var bobY = pivotY + bob.stringLength * Math.cos(angle);

        // Store trail position
        var trail = state.pendulum.trails[i];
        trail.push({ x: bobX, y: bobY });
        if (trail.length > 5) {
          trail.shift();
        }

        // Draw faint trail
        for (var t = 0; t < trail.length; t++) {
          var trailOpacity = (t / trail.length) * 0.15;
          var trailRadius = 4 * (t / trail.length);
          ctx.beginPath();
          ctx.fillStyle = 'rgba(85, 204, 136, ' + trailOpacity + ')';
          ctx.arc(trail[t].x, trail[t].y, trailRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw string
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(85, 204, 136, 0.3)';
        ctx.lineWidth = 1;
        ctx.moveTo(bob.pivotX, pivotY);
        ctx.lineTo(bobX, bobY);
        ctx.stroke();

        // Draw pivot point
        ctx.beginPath();
        ctx.fillStyle = 'rgba(85, 204, 136, 0.2)';
        ctx.arc(bob.pivotX, pivotY, 2, 0, Math.PI * 2);
        ctx.fill();

        // Draw bob
        var bobOpacity = 0.7 + 0.3 * Math.abs(Math.cos(angle));
        ctx.beginPath();
        ctx.fillStyle = 'rgba(85, 204, 136, ' + bobOpacity + ')';
        ctx.arc(bobX, bobY, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      activeCanvases[index] = requestAnimationFrame(animate);
    }

    activeCanvases[index] = requestAnimationFrame(animate);
  }

  // ─── Section Lifecycle ───

  function initSection(index) {
    if (activeCanvases[index] !== undefined) return; // already active

    var section = sections[index];
    if (!section) return;

    switch (index) {
      case 0:
        initOscilloscope(section, index);
        break;
      case 1:
        initSeismic(section, index);
        break;
      case 2:
        initResonanceCascade(section, index);
        break;
      case 3:
        initMolecular(section, index);
        break;
      case 4:
        initFrequency(section, index);
        break;
      case 5:
        initCursorField(section, index);
        break;
      case 6:
        initCymatics(section, index);
        break;
      case 7:
        initStringResonance(section, index);
        break;
      case 8:
        initRipple(section, index);
        break;
      case 9:
        initPendulum(section, index);
        break;
    }
  }

  function cleanupSection(index) {
    var section = sections[index];

    // Cancel animation frame if one exists
    if (activeCanvases[index] !== undefined && activeCanvases[index] !== -1) {
      cancelAnimationFrame(activeCanvases[index]);
    }
    delete activeCanvases[index];

    // Call section-specific cleanup if registered
    if (section && section._vsCleanup) {
      section._vsCleanup();
      section._vsCleanup = null;
    }
  }

  // ─── Scroll & Navigation ───

  function updateProgressBar() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var percent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    var bar = document.getElementById('vs-progress-bar');
    if (bar) {
      bar.style.width = percent + '%';
    }
  }

  function updateActiveNavLink() {
    var viewportCenter = window.innerHeight / 2;
    var closestIndex = 0;
    var closestDist = Infinity;

    for (var i = 0; i < sections.length; i++) {
      var rect = sections[i].getBoundingClientRect();
      var sectionCenter = rect.top + rect.height / 2;
      var dist = Math.abs(sectionCenter - viewportCenter);
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    }

    var navLinks = document.querySelectorAll('.vs-nav__link');
    for (var j = 0; j < navLinks.length; j++) {
      if (parseInt(navLinks[j].getAttribute('data-section'), 10) === closestIndex) {
        navLinks[j].classList.add('is-active');
      } else {
        navLinks[j].classList.remove('is-active');
      }
    }
  }

  function setupNavClickHandlers() {
    var navLinks = document.querySelectorAll('.vs-nav__link');
    for (var i = 0; i < navLinks.length; i++) {
      navLinks[i].addEventListener('click', function(e) {
        e.preventDefault();
        var href = this.getAttribute('href');
        var target = document.querySelector(href);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
  }

  // ─── Intersection Observer ───

  function setupIntersectionObserver() {
    var observer = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var idx = parseInt(entry.target.getAttribute('data-vs-idx'), 10);

        if (entry.isIntersecting) {
          initSection(idx);
        } else {
          cleanupSection(idx);
        }
      }
    }, {
      threshold: 0.3
    });

    for (var i = 0; i < sections.length; i++) {
      observer.observe(sections[i]);
    }
  }

  // ─── Resize Handler ───

  function setupResizeHandler() {
    var resizeTimeout;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function() {
        resizeAllVisibleCanvases();
      }, 200);
    });
  }

  // ─── Init Sections Already in Viewport ───

  function initVisibleSections() {
    for (var i = 0; i < sections.length; i++) {
      var rect = sections[i].getBoundingClientRect();
      var inView = rect.top < window.innerHeight && rect.bottom > 0;
      if (inView) {
        initSection(i);
      }
    }
  }

  // ─── Scroll Event (Throttled) ───

  function setupScrollListener() {
    var ticking = false;
    window.addEventListener('scroll', function() {
      if (!ticking) {
        requestAnimationFrame(function() {
          updateProgressBar();
          updateActiveNavLink();
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  // ─── Bootstrap ───

  document.addEventListener('DOMContentLoaded', function() {
    // Collect sections
    var sectionEls = document.querySelectorAll('.vs-section');
    for (var i = 0; i < sectionEls.length; i++) {
      sections.push(sectionEls[i]);
    }

    // Setup systems
    setupIntersectionObserver();
    setupScrollListener();
    setupNavClickHandlers();
    setupResizeHandler();

    // Initial state
    updateProgressBar();
    updateActiveNavLink();
    initVisibleSections();
  });

})();
