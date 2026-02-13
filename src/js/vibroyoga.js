(function () {
  'use strict';

  /* ══════════════════════════════════════════════════
     GLOBAL STATE
     ══════════════════════════════════════════════════ */
  var currentDesign = 1;
  var animationFrames = {
    d6Wave: null,
    d6Freq: null,
    d7Particles: null,
    d1Parallax: null,
    d1Progress: null,
    d2Scope: null,
    d3Seismo: null,
    d5Molecules: null,
    d8Cymatics: null
  };
  var observers = {
    reveal: null
  };
  var d6State = {
    wavePhase: 0,
    isActive: false
  };
  var d7State = {
    particles: [],
    mouseX: 0,
    mouseY: 0,
    isActive: false
  };
  var d2State = { mouseY: 0.5, isActive: false };
  var d3State = { scrollX: 0, isActive: false };
  var d5State = { particles: [], temperature: 0.1, isActive: false };
  var d8State = { dots: [], phase: 0, isActive: false };

  /* ══════════════════════════════════════════════════
     DESIGN SWITCHER
     ══════════════════════════════════════════════════ */
  var designBackgrounds = {
    1: '#0a0a0a',
    2: '#0d0a1a',
    3: '#0f0806',
    4: '#080810',
    5: '#061515',
    6: '#050508',
    7: '#030306',
    8: '#060608'
  };

  function switchDesign(designNumber) {
    if (designNumber < 1 || designNumber > 8) return;

    currentDesign = designNumber;

    // Hide all panels
    var allPanels = document.querySelectorAll('.vyd-panel');
    for (var i = 0; i < allPanels.length; i++) {
      allPanels[i].classList.remove('is-active');
      allPanels[i].setAttribute('aria-hidden', 'true');
    }

    // Show selected panel
    var activePanel = document.querySelector('.vyd-panel[data-panel="' + designNumber + '"]');
    if (activePanel) {
      activePanel.classList.add('is-active');
      activePanel.setAttribute('aria-hidden', 'false');
    }

    // Update button states
    var allButtons = document.querySelectorAll('.vyd-btn');
    for (var j = 0; j < allButtons.length; j++) {
      allButtons[j].classList.remove('is-active');
      allButtons[j].setAttribute('aria-pressed', 'false');
    }
    var activeButton = document.querySelector('.vyd-btn[data-design="' + designNumber + '"]');
    if (activeButton) {
      activeButton.classList.add('is-active');
      activeButton.setAttribute('aria-pressed', 'true');
    }

    // Update body background
    document.body.style.backgroundColor = designBackgrounds[designNumber];

    // Cleanup previous design animations
    cleanupAnimations();

    // Initialize design-specific features
    if (designNumber === 1) {
      initDesign1();
    } else if (designNumber === 2) {
      initDesign2();
    } else if (designNumber === 3) {
      initDesign3();
    } else if (designNumber === 4) {
      initDesign4();
    } else if (designNumber === 5) {
      initDesign5();
    } else if (designNumber === 6) {
      initDesign6();
    } else if (designNumber === 7) {
      initDesign7();
    } else if (designNumber === 8) {
      initDesign8();
    }

    // Re-initialize scroll reveals for visible panel
    if (activePanel) {
      initScrollReveals(activePanel);
      initStaggerChildren(activePanel);
    }

    // Update URL hash
    window.location.hash = 'design-' + designNumber;

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cleanupAnimations() {
    // Cancel all animation frames
    if (animationFrames.d6Wave) {
      cancelAnimationFrame(animationFrames.d6Wave);
      animationFrames.d6Wave = null;
    }
    if (animationFrames.d6Freq) {
      cancelAnimationFrame(animationFrames.d6Freq);
      animationFrames.d6Freq = null;
    }
    if (animationFrames.d7Particles) {
      cancelAnimationFrame(animationFrames.d7Particles);
      animationFrames.d7Particles = null;
    }
    if (animationFrames.d1Parallax) {
      cancelAnimationFrame(animationFrames.d1Parallax);
      animationFrames.d1Parallax = null;
    }
    if (animationFrames.d1Progress) {
      cancelAnimationFrame(animationFrames.d1Progress);
      animationFrames.d1Progress = null;
    }
    if (animationFrames.d2Scope) {
      cancelAnimationFrame(animationFrames.d2Scope);
      animationFrames.d2Scope = null;
    }
    if (animationFrames.d3Seismo) {
      cancelAnimationFrame(animationFrames.d3Seismo);
      animationFrames.d3Seismo = null;
    }
    if (animationFrames.d5Molecules) {
      cancelAnimationFrame(animationFrames.d5Molecules);
      animationFrames.d5Molecules = null;
    }
    if (animationFrames.d8Cymatics) {
      cancelAnimationFrame(animationFrames.d8Cymatics);
      animationFrames.d8Cymatics = null;
    }

    // Reset states
    d6State.isActive = false;
    d7State.isActive = false;
    d2State.isActive = false;
    d3State.isActive = false;
    d5State.isActive = false;
    d8State.isActive = false;
  }

  /* ══════════════════════════════════════════════════
     SHARED: Scroll-triggered reveals
     ══════════════════════════════════════════════════ */
  function initScrollReveals(container) {
    // Clean up existing observer
    if (observers.reveal) {
      observers.reveal.disconnect();
    }

    var revealClasses = [
      '.vy-reveal', '.vy-reveal-left', '.vy-reveal-right', '.vy-reveal-scale',
      '.vy2-reveal', '.vy3-reveal', '.vy4-reveal', '.vy5-reveal', '.vy6-reveal', '.vy7-reveal'
    ];

    var elements = container.querySelectorAll(revealClasses.join(', '));

    if (elements.length === 0) return;

    var observerOptions = {
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px'
    };

    observers.reveal = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observers.reveal.unobserve(entry.target);
        }
      });
    }, observerOptions);

    for (var i = 0; i < elements.length; i++) {
      observers.reveal.observe(elements[i]);
    }
  }

  /* ══════════════════════════════════════════════════
     SHARED: Stagger children
     ══════════════════════════════════════════════════ */
  function initStaggerChildren(container) {
    var staggerClasses = [
      '.vy-stagger', '.vy2-stagger', '.vy3-stagger',
      '.vy4-stagger', '.vy5-stagger', '.vy6-stagger', '.vy7-stagger'
    ];

    var staggerContainers = container.querySelectorAll(staggerClasses.join(', '));

    for (var i = 0; i < staggerContainers.length; i++) {
      var children = staggerContainers[i].children;
      for (var j = 0; j < children.length; j++) {
        children[j].style.setProperty('--i', j);
      }
    }
  }

  /* ══════════════════════════════════════════════════
     DESIGN 1: Dark Cinematic interactions
     ══════════════════════════════════════════════════ */
  function initDesign1() {
    var panel = document.querySelector('.vyd-panel[data-panel="1"]');
    if (!panel) return;

    // Navbar scroll state
    var navbar = panel.querySelector('.vy-nav');
    if (navbar) {
      var handleScroll = function() {
        if (window.scrollY > 100) {
          navbar.classList.add('is-scrolled');
        } else {
          navbar.classList.remove('is-scrolled');
        }
      };
      window.addEventListener('scroll', handleScroll, { passive: true });
      handleScroll();
    }

    // Mobile nav
    var mobileToggle = panel.querySelector('.vy-nav__toggle');
    var mobileNav = panel.querySelector('.vy-mobile-nav');
    var mobileClose = panel.querySelector('.vy-mobile-nav__close');
    var mobileOverlay = panel.querySelector('.vy-mobile-nav__overlay');

    if (mobileToggle && mobileNav) {
      mobileToggle.addEventListener('click', function() {
        mobileNav.classList.add('is-open');
        document.body.style.overflow = 'hidden';
      });

      if (mobileClose) {
        mobileClose.addEventListener('click', function() {
          mobileNav.classList.remove('is-open');
          document.body.style.overflow = '';
        });
      }

      if (mobileOverlay) {
        mobileOverlay.addEventListener('click', function() {
          mobileNav.classList.remove('is-open');
          document.body.style.overflow = '';
        });
      }
    }

    // Counter animation
    var counters = panel.querySelectorAll('[data-vy-count]');
    if (counters.length > 0) {
      var counterObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.5 });

      for (var i = 0; i < counters.length; i++) {
        counterObserver.observe(counters[i]);
      }
    }

    // Smooth scroll for anchor links
    var anchorLinks = panel.querySelectorAll('a[href^="#"]');
    for (var j = 0; j < anchorLinks.length; j++) {
      anchorLinks[j].addEventListener('click', function(e) {
        var href = this.getAttribute('href');
        if (href === '#') return;

        var target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    // Parallax hero background
    var heroImg = panel.querySelector('.vy-hero__bg img');
    if (heroImg) {
      var handleParallax = function() {
        animationFrames.d1Parallax = requestAnimationFrame(function() {
          var scrollY = window.scrollY;
          heroImg.style.transform = 'translateY(' + (scrollY * 0.25) + 'px)';
        });
      };
      window.addEventListener('scroll', handleParallax, { passive: true });
    }

    // Horizontal scroll drag
    var scrollContainer = panel.querySelector('.vy-classes-scroll');
    if (scrollContainer) {
      initHorizontalDrag(scrollContainer);
    }

    // Progress bar
    var progressBar = panel.querySelector('.vy-progress-bar');
    if (progressBar) {
      var updateProgress = function() {
        animationFrames.d1Progress = requestAnimationFrame(function() {
          var winScroll = window.scrollY;
          var height = document.documentElement.scrollHeight - window.innerHeight;
          var scrolled = (winScroll / height) * 100;
          progressBar.style.width = scrolled + '%';
        });
      };
      window.addEventListener('scroll', updateProgress, { passive: true });
      updateProgress();
    }
  }

  function animateCounter(element) {
    var target = parseInt(element.getAttribute('data-vy-count'), 10);
    var suffix = element.getAttribute('data-vy-suffix') || '';
    var prefix = element.getAttribute('data-vy-prefix') || '';
    var duration = 1800;
    var start = null;

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function step(timestamp) {
      if (!start) start = timestamp;
      var progress = timestamp - start;
      var percent = Math.min(progress / duration, 1);
      var current = Math.floor(easeOutCubic(percent) * target);

      element.textContent = prefix + current + suffix;

      if (progress < duration) {
        requestAnimationFrame(step);
      } else {
        element.textContent = prefix + target + suffix;
      }
    }

    requestAnimationFrame(step);
  }

  function initHorizontalDrag(container) {
    var isDown = false;
    var startX;
    var scrollLeft;

    container.addEventListener('mousedown', function(e) {
      isDown = true;
      container.style.cursor = 'grabbing';
      startX = e.pageX - container.offsetLeft;
      scrollLeft = container.scrollLeft;
    });

    container.addEventListener('mouseleave', function() {
      isDown = false;
      container.style.cursor = 'grab';
    });

    container.addEventListener('mouseup', function() {
      isDown = false;
      container.style.cursor = 'grab';
    });

    container.addEventListener('mousemove', function(e) {
      if (!isDown) return;
      e.preventDefault();
      var x = e.pageX - container.offsetLeft;
      var walk = (x - startX) * 2;
      container.scrollLeft = scrollLeft - walk;
    });
  }

  /* ══════════════════════════════════════════════════
     DESIGN 6: Scroll Frequency — Wave Canvas + Frequency Bars
     ══════════════════════════════════════════════════ */
  function initDesign6() {
    d6State.isActive = true;
    d6State.wavePhase = 0;

    // 6A: Wave canvas
    var waveCanvas = document.querySelector('.vy6-wave-canvas');
    if (waveCanvas) {
      initWaveCanvas(waveCanvas);
    }

    // 6B: Frequency bars
    var freqBars = document.querySelectorAll('.vy6-freq-bar');
    if (freqBars.length > 0) {
      initFrequencyBars(freqBars);
    }

    // 6C: Letter vibration (handled by CSS, intensity changes on scroll)
    var vibrateLetters = document.querySelectorAll('.vy6-vibrate-letter');
    if (vibrateLetters.length > 0) {
      var updateVibration = function() {
        var scrollPercent = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
        var intensity = 0.5 + (scrollPercent * 1.5); // 0.5 to 2

        for (var i = 0; i < vibrateLetters.length; i++) {
          vibrateLetters[i].style.setProperty('--vibrate-intensity', intensity);
        }
      };
      window.addEventListener('scroll', updateVibration, { passive: true });
      updateVibration();
    }
  }

  function initWaveCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    var parent = canvas.parentElement;

    function resize() {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    var waves = [
      { amplitude: 30, frequency: 0.02, speed: 0.015, opacity: 0.15 },
      { amplitude: 50, frequency: 0.015, speed: 0.01, opacity: 0.25 },
      { amplitude: 20, frequency: 0.03, speed: 0.02, opacity: 0.4 }
    ];

    function animate() {
      if (!d6State.isActive) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      var centerY = canvas.height / 2;

      waves.forEach(function(wave) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(63, 153, 165, ' + wave.opacity + ')';
        ctx.lineWidth = 1.5;

        for (var x = 0; x < canvas.width; x++) {
          var y = centerY + Math.sin(x * wave.frequency + d6State.wavePhase * wave.speed) * wave.amplitude;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      });

      d6State.wavePhase += 2;
      animationFrames.d6Wave = requestAnimationFrame(animate);
    }

    animate();
  }

  function initFrequencyBars(bars) {
    var barsArray = Array.prototype.slice.call(bars);
    var container = bars[0].parentElement;

    function updateBars() {
      if (!d6State.isActive) return;

      var rect = container.getBoundingClientRect();
      var scrollProgress = 1 - (rect.top / window.innerHeight);
      scrollProgress = Math.max(0, Math.min(1, scrollProgress));

      barsArray.forEach(function(bar, index) {
        var baseHeight = 8;
        var maxHeight = 100;
        var amplitude = (maxHeight - baseHeight) / 2;
        var frequency = 0.3;
        var scrollOffset = scrollProgress * Math.PI * 4;

        var height = baseHeight + amplitude + amplitude * Math.sin(index * frequency + scrollOffset);
        bar.style.height = height + 'px';
      });

      animationFrames.d6Freq = requestAnimationFrame(updateBars);
    }

    window.addEventListener('scroll', function() {
      if (d6State.isActive && !animationFrames.d6Freq) {
        updateBars();
      }
    }, { passive: true });

    updateBars();
  }

  /* ══════════════════════════════════════════════════
     DESIGN 7: Cursor Field — Particles + Proximity + Ripples
     ══════════════════════════════════════════════════ */
  function initDesign7() {
    d7State.isActive = true;

    // 7A: Particle canvas
    var particleCanvas = document.querySelector('.vy7-particle-canvas');
    if (particleCanvas) {
      initParticleCanvas(particleCanvas);
    }

    // 7B: Magnetic title
    var magneticTitle = document.querySelector('[data-vy7-magnetic]');
    if (magneticTitle) {
      initMagneticTitle(magneticTitle);
    }

    // 7C: Proximity vibration on cards
    var proximityCards = document.querySelectorAll('.vy7-proximity-card');
    if (proximityCards.length > 0) {
      initProximityCards(proximityCards);
    }

    // 7D: Ripple zone
    var rippleZone = document.querySelector('.vy7-ripple-zone');
    if (rippleZone) {
      initRippleZone(rippleZone);
    }

    // 7E: String vibration
    var strings = document.querySelectorAll('.vy7-string');
    for (var i = 0; i < strings.length; i++) {
      (function(string) {
        string.addEventListener('mouseenter', function() {
          string.classList.add('is-plucked');
        });
        string.addEventListener('animationend', function() {
          string.classList.remove('is-plucked');
        });
      })(strings[i]);
    }
  }

  function initParticleCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    var parent = canvas.parentElement;

    function resize() {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      initParticles();
    }
    resize();
    window.addEventListener('resize', resize);

    function initParticles() {
      d7State.particles = [];
      for (var i = 0; i < 80; i++) {
        d7State.particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          radius: 1 + Math.random() * 2,
          opacity: 0.1 + Math.random() * 0.4
        });
      }
    }

    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      d7State.mouseX = e.clientX - rect.left;
      d7State.mouseY = e.clientY - rect.top;
    });

    function animate() {
      if (!d7State.isActive) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Update and draw particles
      d7State.particles.forEach(function(p) {
        // Mouse repulsion
        var dx = p.x - d7State.mouseX;
        var dy = p.y - d7State.mouseY;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 150) {
          var force = (150 - dist) / 150;
          p.vx += (dx / dist) * force * 0.2;
          p.vy += (dy / dist) * force * 0.2;
        }

        // Update position
        p.x += p.vx;
        p.y += p.vy;

        // Damping
        p.vx *= 0.98;
        p.vy *= 0.98;

        // Bounce off edges
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        p.x = Math.max(0, Math.min(canvas.width, p.x));
        p.y = Math.max(0, Math.min(canvas.height, p.y));

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(63, 153, 165, ' + p.opacity + ')';
        ctx.fill();
      });

      // Draw connections
      for (var i = 0; i < d7State.particles.length; i++) {
        for (var j = i + 1; j < d7State.particles.length; j++) {
          var p1 = d7State.particles[i];
          var p2 = d7State.particles[j];
          var dx = p1.x - p2.x;
          var dy = p1.y - p2.y;
          var dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 100) {
            var opacity = (1 - dist / 100) * 0.3;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = 'rgba(63, 153, 165, ' + opacity + ')';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animationFrames.d7Particles = requestAnimationFrame(animate);
    }

    animate();
  }

  function initMagneticTitle(title) {
    var heroArea = title.closest('.vy7-hero') || title.parentElement;
    var currentX = 0;
    var currentY = 0;
    var targetX = 0;
    var targetY = 0;

    function lerp(start, end, factor) {
      return start + (end - start) * factor;
    }

    heroArea.addEventListener('mousemove', function(e) {
      var rect = title.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;

      var deltaX = e.clientX - centerX;
      var deltaY = e.clientY - centerY;

      targetX = Math.max(-15, Math.min(15, deltaX * 0.1));
      targetY = Math.max(-15, Math.min(15, deltaY * 0.1));
    });

    heroArea.addEventListener('mouseleave', function() {
      targetX = 0;
      targetY = 0;
    });

    function animate() {
      currentX = lerp(currentX, targetX, 0.1);
      currentY = lerp(currentY, targetY, 0.1);

      title.style.transform = 'translate(' + currentX + 'px, ' + currentY + 'px)';

      if (d7State.isActive) {
        requestAnimationFrame(animate);
      }
    }

    animate();
  }

  function initProximityCards(cards) {
    var cardsArray = Array.prototype.slice.call(cards);

    document.addEventListener('mousemove', function(e) {
      if (!d7State.isActive) return;

      cardsArray.forEach(function(card) {
        var rect = card.getBoundingClientRect();
        var centerX = rect.left + rect.width / 2;
        var centerY = rect.top + rect.height / 2;

        var dx = e.clientX - centerX;
        var dy = e.clientY - centerY;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 200) {
          card.classList.add('is-vibrating');
        } else {
          card.classList.remove('is-vibrating');
        }
      });
    }, { passive: true });
  }

  function initRippleZone(zone) {
    zone.addEventListener('click', function(e) {
      var rect = zone.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;

      var ripple = document.createElement('div');
      ripple.className = 'vy7-ripple';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';

      zone.appendChild(ripple);

      setTimeout(function() {
        if (ripple.parentElement) {
          ripple.parentElement.removeChild(ripple);
        }
      }, 1500);
    });
  }

  /* ══════════════════════════════════════════════════
     DESIGN 2: Oscilloscope — Wave Canvas + Spectrum + Sound Burst
     ══════════════════════════════════════════════════ */
  function initDesign2() {
    d2State.isActive = true;
    var panel = document.querySelector('.vyd-panel[data-panel="2"]');
    if (!panel) return;

    // Create spectrum bars if not exist
    var spectrum = panel.querySelector('.vy2-spectrum');
    if (spectrum && spectrum.children.length === 0) {
      for (var i = 0; i < 60; i++) {
        var bar = document.createElement('div');
        bar.className = 'vy2-spectrum__bar';
        spectrum.appendChild(bar);
      }
    }

    // Canvas oscilloscope
    var canvas = panel.querySelector('.vy2-scope-canvas');
    if (canvas) {
      var ctx = canvas.getContext('2d');
      var parent = canvas.parentElement;
      function resize() {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
      resize();
      window.addEventListener('resize', resize);

      // Track mouse Y position
      parent.addEventListener('mousemove', function(e) {
        d2State.mouseY = e.clientY / window.innerHeight;
      });

      var phase = 0;
      function animate() {
        if (!d2State.isActive) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var centerY = canvas.height / 2;

        // Draw 3 waves with different params affected by mouseY
        var waves = [
          { amp: 20 + d2State.mouseY * 60, freq: 0.015, speed: 0.02, opacity: 0.15, color: '124, 92, 255' },
          { amp: 30 + d2State.mouseY * 40, freq: 0.02, speed: 0.015, opacity: 0.3, color: '124, 92, 255' },
          { amp: 15 + d2State.mouseY * 30, freq: 0.025, speed: 0.025, opacity: 0.5, color: '150, 120, 255' }
        ];

        waves.forEach(function(w) {
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(' + w.color + ', ' + w.opacity + ')';
          ctx.lineWidth = 1.5;
          for (var x = 0; x < canvas.width; x++) {
            var y = centerY + Math.sin(x * w.freq + phase * w.speed) * w.amp;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });

        phase += 2;
        animationFrames.d2Scope = requestAnimationFrame(animate);
      }
      animate();
    }

    // Spectrum bars on scroll
    var spectrumBars = panel.querySelectorAll('.vy2-spectrum__bar');
    if (spectrumBars.length > 0) {
      var barsArr = Array.prototype.slice.call(spectrumBars);
      var updateSpectrum = function() {
        if (!d2State.isActive) return;
        var scrollPercent = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
        barsArr.forEach(function(bar, i) {
          var height = 8 + 80 * Math.abs(Math.sin(i * 0.25 + scrollPercent * Math.PI * 6));
          bar.style.height = height + 'px';
        });
      };
      window.addEventListener('scroll', updateSpectrum, { passive: true });
      updateSpectrum();
    }

    // Sound burst on click in sound zone
    var soundZone = panel.querySelector('.vy2-sound-zone');
    if (soundZone) {
      soundZone.addEventListener('click', function(e) {
        var rect = soundZone.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var burst = document.createElement('div');
        burst.className = 'vy2-sound-burst';
        burst.style.left = x + 'px';
        burst.style.top = y + 'px';
        soundZone.appendChild(burst);
        setTimeout(function() {
          if (burst.parentElement) burst.parentElement.removeChild(burst);
        }, 1000);
      });
    }
  }

  /* ══════════════════════════════════════════════════
     DESIGN 3: Seismic — Seismograph Canvas + Shake Cards
     ══════════════════════════════════════════════════ */
  function initDesign3() {
    d3State.isActive = true;
    d3State.scrollX = 0;
    var panel = document.querySelector('.vyd-panel[data-panel="3"]');
    if (!panel) return;

    // Seismograph canvas
    var canvas = panel.querySelector('.vy3-seismo-canvas');
    if (canvas) {
      var ctx = canvas.getContext('2d');
      canvas.width = canvas.parentElement.clientWidth;
      var height = 120;
      canvas.height = height;
      var data = [];
      var maxPoints = canvas.width;

      function addPoint() {
        if (!d3State.isActive) return;
        var scrollPercent = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
        var intensity = scrollPercent * 3;
        var value = (Math.random() - 0.5) * intensity * 40;
        data.push(height / 2 + value);
        if (data.length > maxPoints) data.shift();

        ctx.clearRect(0, 0, canvas.width, height);
        ctx.beginPath();
        ctx.strokeStyle = '#cc4400';
        ctx.lineWidth = 1.5;
        for (var i = 0; i < data.length; i++) {
          if (i === 0) ctx.moveTo(i, data[i]);
          else ctx.lineTo(i, data[i]);
        }
        ctx.stroke();

        // Draw center baseline
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(204, 68, 0, 0.15)';
        ctx.lineWidth = 0.5;
        ctx.moveTo(0, height / 2);
        ctx.lineTo(canvas.width, height / 2);
        ctx.stroke();

        animationFrames.d3Seismo = requestAnimationFrame(addPoint);
      }
      addPoint();
    }

    // Shake cards on hover
    var shakeCards = panel.querySelectorAll('[data-vy3-shake]');
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
  }

  /* ══════════════════════════════════════════════════
     DESIGN 4: Resonance Cascade — Card Cascade Effect
     ══════════════════════════════════════════════════ */
  function initDesign4() {
    var panel = document.querySelector('.vyd-panel[data-panel="4"]');
    if (!panel) return;

    var cards = panel.querySelectorAll('.vy4-cascade-card');
    var cardsArr = Array.prototype.slice.call(cards);

    cardsArr.forEach(function(card) {
      card.addEventListener('mouseenter', function() {
        var index = parseInt(card.getAttribute('data-vy4-cascade'), 10);
        // Cascade: trigger nearby cards with increasing delay
        cardsArr.forEach(function(otherCard) {
          var otherIndex = parseInt(otherCard.getAttribute('data-vy4-cascade'), 10);
          var distance = Math.abs(otherIndex - index);
          if (distance === 0) return;

          setTimeout(function() {
            otherCard.classList.add('is-cascading');
            setTimeout(function() {
              otherCard.classList.remove('is-cascading');
            }, 600);
          }, distance * 150);
        });

        // Also trigger self
        card.classList.add('is-cascading');
        setTimeout(function() {
          card.classList.remove('is-cascading');
        }, 600);
      });
    });
  }

  /* ══════════════════════════════════════════════════
     DESIGN 5: Molecular — Brownian Particles + Temperature
     ══════════════════════════════════════════════════ */
  function initDesign5() {
    d5State.isActive = true;
    d5State.temperature = 0.1;
    var panel = document.querySelector('.vyd-panel[data-panel="5"]');
    if (!panel) return;

    var canvas = panel.querySelector('.vy5-molecule-canvas');
    if (canvas) {
      var ctx = canvas.getContext('2d');
      var parent = canvas.parentElement;

      function resize() {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        initParticles();
      }

      function initParticles() {
        d5State.particles = [];
        for (var i = 0; i < 120; i++) {
          d5State.particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            radius: 1 + Math.random() * 1.5,
            opacity: 0.2 + Math.random() * 0.3
          });
        }
      }

      resize();
      window.addEventListener('resize', resize);

      // Temperature from scroll
      var updateTemp = function() {
        var scrollPercent = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
        d5State.temperature = 0.1 + scrollPercent * 2.5;

        // Update temp meter fill
        var fill = panel.querySelector('.vy5-temp__fill');
        if (fill) {
          fill.style.width = Math.min(100, (scrollPercent * 100)) + '%';
        }
      };
      window.addEventListener('scroll', updateTemp, { passive: true });
      updateTemp();

      function animate() {
        if (!d5State.isActive) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var speed = d5State.temperature;

        d5State.particles.forEach(function(p) {
          // Random Brownian jitter scaled by temperature
          p.vx += (Math.random() - 0.5) * speed * 0.5;
          p.vy += (Math.random() - 0.5) * speed * 0.5;

          // Damping
          p.vx *= 0.95;
          p.vy *= 0.95;

          p.x += p.vx;
          p.y += p.vy;

          // Bounce
          if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
          if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
          p.x = Math.max(0, Math.min(canvas.width, p.x));
          p.y = Math.max(0, Math.min(canvas.height, p.y));

          // Draw particle
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 191, 165, ' + p.opacity + ')';
          ctx.fill();
        });

        // Draw bonds between close particles
        for (var i = 0; i < d5State.particles.length; i++) {
          for (var j = i + 1; j < d5State.particles.length; j++) {
            var p1 = d5State.particles[i];
            var p2 = d5State.particles[j];
            var dx = p1.x - p2.x;
            var dy = p1.y - p2.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 60) {
              var opacity = (1 - dist / 60) * 0.2;
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = 'rgba(0, 191, 165, ' + opacity + ')';
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }

        animationFrames.d5Molecules = requestAnimationFrame(animate);
      }
      animate();
    }
  }

  /* ══════════════════════════════════════════════════
     DESIGN 8: Cymatics — Dot Grid + Wave Displacement
     ══════════════════════════════════════════════════ */
  function initDesign8() {
    d8State.isActive = true;
    d8State.phase = 0;
    var panel = document.querySelector('.vyd-panel[data-panel="8"]');
    if (!panel) return;

    var canvas = panel.querySelector('.vy8-cymatics-canvas');
    if (canvas) {
      var ctx = canvas.getContext('2d');
      var parent = canvas.parentElement;

      function resize() {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
      resize();
      window.addEventListener('resize', resize);

      // Initialize dots in a grid
      d8State.dots = [];
      var spacing = 20;
      var cols = Math.ceil(800 / spacing);
      var rows = Math.ceil(800 / spacing);
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          d8State.dots.push({
            baseX: c * spacing - 400 + spacing / 2,
            baseY: r * spacing - 400 + spacing / 2,
            x: 0, y: 0
          });
        }
      }

      function animate() {
        if (!d8State.isActive) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        var centerX = canvas.width / 2;
        var centerY = canvas.height / 2;
        var scrollPercent = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
        var freq = 0.02 + scrollPercent * 0.04;

        d8State.dots.forEach(function(dot) {
          var dist = Math.sqrt(dot.baseX * dot.baseX + dot.baseY * dot.baseY);
          var displacement = Math.sin(dist * freq - d8State.phase * 0.02) * 8;
          var angle = Math.atan2(dot.baseY, dot.baseX);

          dot.x = centerX + dot.baseX + Math.cos(angle) * displacement;
          dot.y = centerY + dot.baseY + Math.sin(angle) * displacement;

          var intensity = Math.abs(Math.sin(dist * freq - d8State.phase * 0.02));
          var opacity = 0.05 + intensity * 0.3;
          var size = 0.5 + intensity * 1.5;

          ctx.beginPath();
          ctx.arc(dot.x, dot.y, size, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(232, 220, 200, ' + opacity + ')';
          ctx.fill();
        });

        d8State.phase++;
        animationFrames.d8Cymatics = requestAnimationFrame(animate);
      }
      animate();
    }
  }

  /* ══════════════════════════════════════════════════
     INITIALIZATION
     ══════════════════════════════════════════════════ */
  function init() {
    // Set up design switcher buttons
    var designButtons = document.querySelectorAll('.vyd-btn');
    for (var i = 0; i < designButtons.length; i++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var designNum = parseInt(btn.getAttribute('data-design'), 10);
          switchDesign(designNum);
        });
      })(designButtons[i]);
    }

    // Read URL hash for initial design
    var hash = window.location.hash;
    var initialDesign = 1;
    if (hash && hash.indexOf('design-') === 1) {
      var num = parseInt(hash.replace('#design-', ''), 10);
      if (num >= 1 && num <= 8) {
        initialDesign = num;
      }
    }

    // Switch to initial design
    switchDesign(initialDesign);

    // Handle browser back/forward
    window.addEventListener('hashchange', function() {
      var hash = window.location.hash;
      if (hash && hash.indexOf('design-') === 1) {
        var num = parseInt(hash.replace('#design-', ''), 10);
        if (num >= 1 && num <= 8 && num !== currentDesign) {
          switchDesign(num);
        }
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
