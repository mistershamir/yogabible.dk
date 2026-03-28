/**
 * Social Design Studio — Fabric.js Canvas Editor
 * Depends on social-admin.js (window._ybSocial bridge)
 */
(function () {
  'use strict';

  var S; // bridge to social-admin.js
  function $(id) { return document.getElementById(id); }

  /* ═══ STATE ═══ */
  var studio = {
    canvas: null,
    pendingPostId: null,
    preset: '1080x1080',
    activeElement: null,
    clipboard: null,
    templates: [],
    dirty: false
  };

  var PRESETS = {
    '1080x1080': { w: 1080, h: 1080, label: 'Post (1:1)' },
    '1080x1350': { w: 1080, h: 1350, label: 'Feed (4:5)' },
    '1080x1920': { w: 1080, h: 1920, label: 'Story (9:16)' }
  };

  var BRAND_COLORS = ['#f75c03', '#0F0F0F', '#FFFCF9', '#6F6A66', '#F5F3F0', '#d94f02', '#ff9966', '#ffffff'];

  var ANIMATIONS = {
    none:       { label: 'None',       css: '' },
    fadeIn:     { label: 'Fade In',    css: 'yb-fadeIn' },
    slideUp:    { label: 'Slide Up',   css: 'yb-slideUp' },
    slideLeft:  { label: 'Slide Left', css: 'yb-slideLeft' },
    typewriter: { label: 'Typewriter', css: 'yb-typewriter' },
    pulse:      { label: 'Pulse',      css: 'yb-pulse' },
    zoomIn:     { label: 'Zoom In',    css: 'yb-zoomIn' },
    wave:       { label: 'Wave',       css: 'yb-wave' },
    bounce:     { label: 'Bounce',     css: 'yb-bounce' }
  };

  var ANIM_SPEEDS = { slow: 2, normal: 1, fast: 0.5 };
  var ANIM_DELAYS = [0, 0.5, 1, 1.5];

  var ANIM_PRESETS = {
    quoteCard: {
      label: 'Quote Card',
      setup: function () {
        var p = PRESETS[studio.preset];
        setCanvasBg('#f75c03');
        var q = new fabric.IText('"Your quote here"', {
          left: p.w * 0.1, top: p.h * 0.35, width: p.w * 0.8,
          fontFamily: 'Abacaxi, Helvetica Neue, Helvetica, Arial, sans-serif',
          fontSize: 56, fill: '#FFFCF9', fontWeight: 700, textAlign: 'center',
          _yb_anim: 'fadeIn', _yb_anim_speed: 'normal', _yb_anim_delay: 0
        });
        studio.canvas.add(q);
        studio.canvas.setActiveObject(q);
        studio.canvas.renderAll();
      }
    },
    announcement: {
      label: 'Announcement',
      setup: function () {
        var p = PRESETS[studio.preset];
        setCanvasBg('#0F0F0F');
        var title = new fabric.IText('BIG NEWS', {
          left: p.w * 0.1, top: p.h * 0.3,
          fontFamily: 'Abacaxi, Helvetica Neue, Helvetica, Arial, sans-serif',
          fontSize: 72, fill: '#f75c03', fontWeight: 700, textAlign: 'center',
          _yb_anim: 'slideUp', _yb_anim_speed: 'normal', _yb_anim_delay: 0
        });
        var sub = new fabric.IText('Your subtitle here', {
          left: p.w * 0.1, top: p.h * 0.5,
          fontFamily: 'Abacaxi, Helvetica Neue, Helvetica, Arial, sans-serif',
          fontSize: 36, fill: '#FFFCF9', fontWeight: 400, textAlign: 'center',
          _yb_anim: 'fadeIn', _yb_anim_speed: 'normal', _yb_anim_delay: 0.5
        });
        studio.canvas.add(title);
        studio.canvas.add(sub);
        studio.canvas.renderAll();
      }
    },
    storyText: {
      label: 'Story Text',
      setup: function () {
        var p = PRESETS[studio.preset];
        setCanvasBg('#0F0F0F');
        var txt = new fabric.IText('YOUR TEXT', {
          left: p.w * 0.1, top: p.h * 0.4,
          fontFamily: 'Abacaxi, Helvetica Neue, Helvetica, Arial, sans-serif',
          fontSize: 96, fill: '#f75c03', fontWeight: 700, textAlign: 'center',
          _yb_anim: 'pulse', _yb_anim_speed: 'normal', _yb_anim_delay: 0
        });
        studio.canvas.add(txt);
        studio.canvas.setActiveObject(txt);
        studio.canvas.renderAll();
      }
    }
  };

  var SCALE = 0.5; // canvas display scale

  /* ═══ OPEN / CLOSE ═══ */
  function openStudio(postId) {
    S = window._ybSocial;
    if (typeof fabric === 'undefined') {
      alert('Fabric.js is still loading. Please try again in a moment.');
      return;
    }
    studio.pendingPostId = postId || null;
    var modal = $('yb-social-design-modal');
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    // Delay canvas init to allow the modal to lay out first
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        initCanvas();
        loadTemplates();
      });
    });
  }

  function closeStudio() {
    var modal = $('yb-social-design-modal');
    if (!modal) return;
    if (studio.dirty && !confirm('Discard unsaved changes?')) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    if (studio.canvas) {
      studio.canvas.dispose();
      studio.canvas = null;
    }
    studio.dirty = false;
    studio.activeElement = null;
  }

  /* ═══ CANVAS INIT ═══ */
  function initCanvas() {
    var p = PRESETS[studio.preset];
    var canvasEl = $('yb-design-canvas');
    if (!canvasEl) return;

    // Dispose previous canvas first
    if (studio.canvas) {
      studio.canvas.dispose();
      studio.canvas = null;
    }

    // Reset the canvas element — Fabric.dispose() removes the original,
    // so we need to re-create it inside our inner wrapper
    var inner = document.querySelector('.yb-social__design-canvas-inner');
    if (!inner) return;
    inner.innerHTML = '<canvas id="yb-design-canvas"></canvas>';
    canvasEl = $('yb-design-canvas');

    // Calculate scale based on the canvas AREA (the flex:1 center column),
    // not the wrap div which hasn't been sized yet
    var area = document.querySelector('.yb-social__design-canvas-area');
    if (area) {
      var maxW = area.clientWidth - 60;
      var maxH = area.clientHeight - 60;
      SCALE = Math.min(maxW / p.w, maxH / p.h, 0.55);
      if (SCALE <= 0) SCALE = 0.4; // safety fallback
    }

    // Create Fabric canvas
    studio.canvas = new fabric.Canvas('yb-design-canvas', {
      width: p.w,
      height: p.h,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true
    });

    // Fabric wraps the canvas in a .canvas-container div.
    // We scale that container via CSS transform.
    var fabricWrap = canvasEl.parentElement; // .canvas-container created by Fabric
    if (fabricWrap) {
      fabricWrap.style.transform = 'scale(' + SCALE + ')';
      fabricWrap.style.transformOrigin = 'top left';
    }

    // Size the outer wrap to the scaled dimensions so the layout is correct
    var wrap = $('yb-design-canvas-wrap');
    if (wrap) {
      wrap.style.width = Math.round(p.w * SCALE) + 'px';
      wrap.style.height = Math.round(p.h * SCALE) + 'px';
      wrap.style.overflow = 'hidden';
    }

    // Events
    studio.canvas.on('selection:created', onSelect);
    studio.canvas.on('selection:updated', onSelect);
    studio.canvas.on('selection:cleared', onDeselect);
    studio.canvas.on('object:modified', function () { studio.dirty = true; renderLayers(); });
    studio.canvas.on('object:added', function () { studio.dirty = true; renderLayers(); });
    studio.canvas.on('object:removed', function () { studio.dirty = true; renderLayers(); });

    // Keyboard shortcuts — only add once
    if (!studio._keydownBound) {
      document.addEventListener('keydown', onKeydown);
      studio._keydownBound = true;
    }

    updatePresetButtons();
    renderLayers();
    updatePropsPanel();
  }

  function onSelect(e) {
    studio.activeElement = e.selected ? e.selected[0] : null;
    updatePropsPanel();
    renderLayers();
  }

  function onDeselect() {
    studio.activeElement = null;
    updatePropsPanel();
    renderLayers();
  }

  function onKeydown(e) {
    if (!studio.canvas) return;
    var modal = $('yb-social-design-modal');
    if (!modal || modal.hidden) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
      deleteSelected();
      e.preventDefault();
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c') copySelected();
      if (e.key === 'v') pasteClipboard();
      if (e.key === 'z') { studio.canvas.undo && studio.canvas.undo(); }
    }
  }

  /* ═══ PRESET SWITCH ═══ */
  function switchPreset(preset) {
    if (!PRESETS[preset]) return;
    studio.preset = preset;
    initCanvas();
  }

  function updatePresetButtons() {
    var btns = document.querySelectorAll('[data-design-preset]');
    btns.forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-design-preset') === studio.preset);
    });
    var label = $('yb-design-size-label');
    if (label) {
      var p = PRESETS[studio.preset];
      label.textContent = p.w + ' × ' + p.h + 'px';
    }
  }

  /* ═══ ADD ELEMENTS ═══ */
  function addText() {
    var text = new fabric.IText('Your text here', {
      left: 100,
      top: 100,
      fontFamily: 'Abacaxi, Helvetica Neue, Helvetica, Arial, sans-serif',
      fontSize: 48,
      fill: '#0F0F0F',
      fontWeight: 400,
      _yb_anim: 'none',
      _yb_anim_speed: 'normal',
      _yb_anim_delay: 0
    });
    studio.canvas.add(text);
    studio.canvas.setActiveObject(text);
    studio.canvas.renderAll();
  }

  function addShape(type) {
    var obj;
    var p = PRESETS[studio.preset];
    if (type === 'rect') {
      obj = new fabric.Rect({
        left: p.w / 2 - 100,
        top: p.h / 2 - 75,
        width: 200,
        height: 150,
        fill: '#f75c03',
        rx: 8,
        ry: 8
      });
    } else if (type === 'circle') {
      obj = new fabric.Circle({
        left: p.w / 2 - 75,
        top: p.h / 2 - 75,
        radius: 75,
        fill: '#f75c03'
      });
    }
    if (obj) {
      studio.canvas.add(obj);
      studio.canvas.setActiveObject(obj);
      studio.canvas.renderAll();
    }
  }

  function addBrandLogo() {
    var logoUrl = 'https://yogabible.b-cdn.net/yoga-bible-DK/brand/logo.png';
    fabric.Image.fromURL(logoUrl, function (img) {
      if (!img) return;
      img.scaleToWidth(200);
      img.set({ left: 50, top: 50 });
      studio.canvas.add(img);
      studio.canvas.setActiveObject(img);
      studio.canvas.renderAll();
    }, { crossOrigin: 'anonymous' });
  }

  function addImageFromUrl(url) {
    fabric.Image.fromURL(url, function (img) {
      if (!img) return;
      var p = PRESETS[studio.preset];
      // Scale to fit within canvas
      var maxDim = Math.min(p.w, p.h) * 0.6;
      if (img.width > img.height) {
        img.scaleToWidth(maxDim);
      } else {
        img.scaleToHeight(maxDim);
      }
      img.set({
        left: (p.w - img.getScaledWidth()) / 2,
        top: (p.h - img.getScaledHeight()) / 2
      });
      studio.canvas.add(img);
      studio.canvas.setActiveObject(img);
      studio.canvas.renderAll();
    }, { crossOrigin: 'anonymous' });
  }

  /* ═══ ELEMENT ACTIONS ═══ */
  function deleteSelected() {
    var active = studio.canvas.getActiveObject();
    if (!active) return;
    if (active.type === 'activeSelection') {
      active.forEachObject(function (o) { studio.canvas.remove(o); });
      studio.canvas.discardActiveObject();
    } else {
      studio.canvas.remove(active);
    }
    studio.canvas.renderAll();
  }

  function copySelected() {
    var active = studio.canvas.getActiveObject();
    if (!active) return;
    active.clone(function (cloned) {
      studio.clipboard = cloned;
    });
  }

  function pasteClipboard() {
    if (!studio.clipboard) return;
    studio.clipboard.clone(function (cloned) {
      cloned.set({ left: cloned.left + 20, top: cloned.top + 20 });
      studio.canvas.add(cloned);
      studio.canvas.setActiveObject(cloned);
      studio.canvas.renderAll();
    });
  }

  function bringForward() {
    var active = studio.canvas.getActiveObject();
    if (active) { studio.canvas.bringForward(active); renderLayers(); }
  }

  function sendBackward() {
    var active = studio.canvas.getActiveObject();
    if (active) { studio.canvas.sendBackwards(active); renderLayers(); }
  }

  /* ═══ PROPERTIES PANEL ═══ */
  function updatePropsPanel() {
    var panel = $('yb-design-props');
    if (!panel) return;

    var obj = studio.activeElement;
    if (!obj) {
      panel.innerHTML = '<p class="yb-social__design-props-empty">Select an element to edit its properties</p>';
      return;
    }

    var html = '';

    // Common props
    html += '<div class="yb-social__design-prop-group">';
    html += '<label>Opacity</label>';
    html += '<input type="range" min="0" max="100" value="' + Math.round((obj.opacity || 1) * 100) + '" data-design-prop="opacity">';
    html += '</div>';

    // Text-specific
    if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
      html += '<div class="yb-social__design-prop-group">';
      html += '<label>Font Size</label>';
      html += '<input type="number" min="8" max="400" value="' + (obj.fontSize || 48) + '" data-design-prop="fontSize">';
      html += '</div>';

      html += '<div class="yb-social__design-prop-group">';
      html += '<label>Font Weight</label>';
      html += '<select data-design-prop="fontWeight">';
      html += '<option value="400"' + (obj.fontWeight === 400 || obj.fontWeight === '400' ? ' selected' : '') + '>Regular</option>';
      html += '<option value="700"' + (obj.fontWeight === 700 || obj.fontWeight === '700' ? ' selected' : '') + '>Bold</option>';
      html += '</select>';
      html += '</div>';

      html += '<div class="yb-social__design-prop-group">';
      html += '<label>Text Align</label>';
      html += '<div class="yb-social__design-align-btns">';
      ['left', 'center', 'right'].forEach(function (a) {
        html += '<button type="button" data-design-prop="textAlign" data-design-val="' + a + '" class="' + (obj.textAlign === a ? 'is-active' : '') + '">' + a.charAt(0).toUpperCase() + '</button>';
      });
      html += '</div></div>';

      html += '<div class="yb-social__design-prop-group">';
      html += '<label>Text Color</label>';
      html += '<div class="yb-social__design-colors">';
      BRAND_COLORS.forEach(function (c) {
        html += '<button type="button" class="yb-social__design-color-swatch' + (obj.fill === c ? ' is-active' : '') + '" style="background:' + c + '" data-design-prop="fill" data-design-val="' + c + '"></button>';
      });
      html += '</div></div>';

      // Animation picker
      var curAnim = obj._yb_anim || 'none';
      var curSpeed = obj._yb_anim_speed || 'normal';
      var curDelay = obj._yb_anim_delay || 0;

      html += '<div class="yb-social__design-anim-section">';
      html += '<label class="yb-social__design-anim-label">Animation</label>';
      html += '<div class="yb-social__design-anim-grid">';
      Object.keys(ANIMATIONS).forEach(function (key) {
        html += '<button type="button" class="yb-social__design-anim-chip' + (curAnim === key ? ' is-active' : '') + '" data-design-anim="' + key + '">' + ANIMATIONS[key].label + '</button>';
      });
      html += '</div>';

      if (curAnim !== 'none') {
        html += '<div class="yb-social__design-anim-opts">';
        html += '<div class="yb-social__design-prop-group"><label>Speed</label><div class="yb-social__design-anim-grid">';
        Object.keys(ANIM_SPEEDS).forEach(function (s) {
          html += '<button type="button" class="yb-social__design-anim-chip' + (curSpeed === s ? ' is-active' : '') + '" data-design-anim-speed="' + s + '">' + s.charAt(0).toUpperCase() + s.slice(1) + '</button>';
        });
        html += '</div></div>';

        html += '<div class="yb-social__design-prop-group"><label>Delay</label><div class="yb-social__design-anim-grid">';
        ANIM_DELAYS.forEach(function (d) {
          html += '<button type="button" class="yb-social__design-anim-chip' + (curDelay === d ? ' is-active' : '') + '" data-design-anim-delay="' + d + '">' + d + 's</button>';
        });
        html += '</div></div>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Shape fill
    if (obj.type === 'rect' || obj.type === 'circle' || obj.type === 'triangle') {
      html += '<div class="yb-social__design-prop-group">';
      html += '<label>Fill Color</label>';
      html += '<div class="yb-social__design-colors">';
      BRAND_COLORS.forEach(function (c) {
        html += '<button type="button" class="yb-social__design-color-swatch' + (obj.fill === c ? ' is-active' : '') + '" style="background:' + c + '" data-design-prop="fill" data-design-val="' + c + '"></button>';
      });
      html += '</div></div>';
    }

    panel.innerHTML = html;
  }

  function applyProp(prop, val) {
    var obj = studio.canvas.getActiveObject();
    if (!obj) return;

    if (prop === 'opacity') {
      obj.set('opacity', parseInt(val) / 100);
    } else if (prop === 'fontSize') {
      obj.set('fontSize', parseInt(val));
    } else if (prop === 'fontWeight') {
      obj.set('fontWeight', parseInt(val));
    } else {
      obj.set(prop, val);
    }

    studio.canvas.renderAll();
    studio.dirty = true;
  }

  /* ═══ BACKGROUND COLOR ═══ */
  function setCanvasBg(color) {
    if (!studio.canvas) return;
    studio.canvas.setBackgroundColor(color, function () {
      studio.canvas.renderAll();
      studio.dirty = true;
    });
  }

  /* ═══ LAYERS PANEL ═══ */
  function renderLayers() {
    var panel = $('yb-design-layers');
    if (!panel || !studio.canvas) return;

    var objects = studio.canvas.getObjects();
    if (!objects.length) {
      panel.innerHTML = '<p class="yb-social__design-layers-empty">No elements yet</p>';
      return;
    }

    var html = '';
    // Reverse order: top layer first
    for (var i = objects.length - 1; i >= 0; i--) {
      var obj = objects[i];
      var isActive = studio.canvas.getActiveObject() === obj;
      var icon = '■';
      var name = 'Element';
      if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
        icon = 'T';
        name = (obj.text || '').substring(0, 20) || 'Text';
      } else if (obj.type === 'rect') {
        icon = '□'; name = 'Rectangle';
      } else if (obj.type === 'circle') {
        icon = '○'; name = 'Circle';
      } else if (obj.type === 'image') {
        icon = '🖼'; name = 'Image';
      }

      html += '<div class="yb-social__design-layer' + (isActive ? ' is-active' : '') + '" data-design-layer="' + i + '">';
      html += '<span class="yb-social__design-layer-icon">' + icon + '</span>';
      html += '<span class="yb-social__design-layer-name">' + name + '</span>';
      html += '<button type="button" class="yb-social__design-layer-vis" data-design-action="toggle-vis" data-design-idx="' + i + '" title="Toggle visibility">' + (obj.visible !== false ? '👁' : '👁‍🗨') + '</button>';
      html += '<button type="button" class="yb-social__design-layer-del" data-design-action="delete-layer" data-design-idx="' + i + '" title="Delete">×</button>';
      html += '</div>';
    }

    panel.innerHTML = html;
  }

  /* ═══ EXPORT ═══ */
  function exportAsPng() {
    if (!studio.canvas) return;

    // Reset zoom/scale for clean export
    var dataUrl = studio.canvas.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 1
    });

    // If we have a pending post, attach to composer
    if (studio.pendingPostId !== null && S && S.addMediaToComposer) {
      // Upload the dataURL as a blob to Bunny CDN via the existing media upload flow
      uploadDesignImage(dataUrl);
    } else if (S && typeof S.addMediaToComposer === 'function') {
      uploadDesignImage(dataUrl);
    } else {
      // Fallback: download locally
      downloadDataUrl(dataUrl);
    }
  }

  function downloadDataUrl(dataUrl) {
    var link = document.createElement('a');
    link.download = 'design-' + studio.preset + '-' + Date.now() + '.png';
    link.href = dataUrl;
    link.click();
  }

  async function uploadDesignImage(dataUrl) {
    if (!S) return;
    S.toast('Exporting design...');

    try {
      // Convert dataURL to blob
      var res = await fetch(dataUrl);
      var blob = await res.blob();

      // Create file from blob
      var fileName = 'design-' + studio.preset + '-' + Date.now() + '.png';
      var file = new File([blob], fileName, { type: 'image/png' });

      // Upload to Bunny CDN
      var token = await S.getToken();
      var formData = new FormData();
      formData.append('file', file);
      formData.append('path', 'yoga-bible-DK/social/designs');

      var resp = await fetch('/.netlify/functions/bunny-browser', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData
      });

      var data = await resp.json();
      if (data.ok && data.url) {
        // Add to composer media
        if (window._ybSocialComposer && window._ybSocialComposer.addMedia) {
          window._ybSocialComposer.addMedia(data.url);
        }
        S.toast('Design exported and added to post!');
        studio.dirty = false;
        closeStudio();
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      console.error('[design-studio] Export error:', err);
      // Fallback: download locally
      S.toast('Upload failed — downloading instead');
      downloadDataUrl(dataUrl);
    }
  }

  /* ═══ TEMPLATES ═══ */
  async function loadTemplates() {
    if (!S) return;
    try {
      var data = await S.api('social-canva?action=design-templates');
      if (data && data.templates) {
        studio.templates = data.templates;
        renderTemplateList();
      }
    } catch (err) {
      console.error('[design-studio] Load templates error:', err);
    }
  }

  function renderTemplateList() {
    var list = $('yb-design-template-list');
    if (!list) return;

    if (!studio.templates.length) {
      list.innerHTML = '<p class="yb-social__design-templates-empty">No saved templates</p>';
      return;
    }

    var html = '';
    studio.templates.forEach(function (tpl) {
      html += '<div class="yb-social__design-template-card" data-design-action="load-template" data-template-id="' + tpl.id + '">';
      if (tpl.thumbnail) {
        html += '<img src="' + tpl.thumbnail + '" alt="' + (tpl.name || 'Template') + '">';
      } else {
        html += '<div class="yb-social__design-template-placeholder">' + (tpl.preset || '1080×1080') + '</div>';
      }
      html += '<span>' + (tpl.name || 'Untitled') + '</span>';
      html += '<button type="button" class="yb-social__design-template-del" data-design-action="delete-template" data-template-id="' + tpl.id + '" title="Delete">×</button>';
      html += '</div>';
    });

    list.innerHTML = html;
  }

  async function saveAsTemplate() {
    if (!studio.canvas || !S) return;
    var name = prompt('Template name:');
    if (!name) return;

    S.toast('Saving template...');

    var json = studio.canvas.toJSON(['name', '_yb_anim', '_yb_anim_speed', '_yb_anim_delay']);
    var thumbnail = studio.canvas.toDataURL({ format: 'png', quality: 0.3, multiplier: 0.2 });

    try {
      var data = await S.api('social-canva', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save-design-template',
          name: name,
          preset: studio.preset,
          canvasJson: json,
          thumbnail: thumbnail
        })
      });

      if (data && data.ok) {
        S.toast('Template saved!');
        studio.dirty = false;
        loadTemplates();
      }
    } catch (err) {
      console.error('[design-studio] Save template error:', err);
      S.toast('Failed to save template', true);
    }
  }

  async function loadTemplate(templateId) {
    if (!studio.canvas || !S) return;
    if (studio.dirty && !confirm('Discard current changes?')) return;

    var tpl = studio.templates.find(function (t) { return t.id === templateId; });
    if (!tpl || !tpl.canvasJson) return;

    // Switch preset if different
    if (tpl.preset && tpl.preset !== studio.preset) {
      studio.preset = tpl.preset;
      initCanvas();
    }

    studio.canvas.loadFromJSON(tpl.canvasJson, function () {
      studio.canvas.renderAll();
      renderLayers();
      studio.dirty = false;
      S.toast('Template loaded!');
    });
  }

  async function deleteTemplate(templateId) {
    if (!S) return;
    if (!confirm('Delete this template?')) return;

    try {
      await S.api('social-canva', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete-design-template',
          templateId: templateId
        })
      });
      S.toast('Template deleted');
      loadTemplates();
    } catch (err) {
      S.toast('Failed to delete template', true);
    }
  }

  /* ═══ ANIMATION PREVIEW & RECORDING ═══ */

  function getAnimatedTextObjects() {
    if (!studio.canvas) return [];
    return studio.canvas.getObjects().filter(function (obj) {
      return (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') &&
             obj._yb_anim && obj._yb_anim !== 'none';
    });
  }

  function calcTotalAnimDuration() {
    var max = 0;
    getAnimatedTextObjects().forEach(function (obj) {
      var speed = ANIM_SPEEDS[obj._yb_anim_speed || 'normal'] || 1;
      var delay = obj._yb_anim_delay || 0;
      var end = delay + speed;
      if (obj._yb_anim === 'typewriter') {
        end = delay + (obj.text || '').length * 0.06 + 0.2;
      }
      if (end > max) max = end;
    });
    return max;
  }

  function buildAnimOverlay() {
    var p = PRESETS[studio.preset];
    var wrap = $('yb-design-canvas-wrap');
    if (!wrap) return null;

    // Remove any old overlay
    var old = wrap.querySelector('.yb-social__design-anim-overlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.className = 'yb-social__design-anim-overlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:' + p.w + 'px;height:' + p.h + 'px;pointer-events:none;overflow:hidden;';

    var animTexts = getAnimatedTextObjects();
    if (!animTexts.length) return null;

    // Hide animated text on the canvas temporarily
    animTexts.forEach(function (obj) { obj.set('opacity', 0); });
    studio.canvas.renderAll();

    animTexts.forEach(function (obj) {
      var el = document.createElement('div');
      var speed = ANIM_SPEEDS[obj._yb_anim_speed || 'normal'] || 1;
      var delay = obj._yb_anim_delay || 0;
      var animCss = ANIMATIONS[obj._yb_anim] ? ANIMATIONS[obj._yb_anim].css : '';

      // Position and style to match canvas object
      var left = obj.left || 0;
      var top = obj.top || 0;
      el.style.cssText = 'position:absolute;' +
        'left:' + left + 'px;top:' + top + 'px;' +
        'font-family:' + (obj.fontFamily || 'Abacaxi, sans-serif') + ';' +
        'font-size:' + (obj.fontSize || 48) + 'px;' +
        'font-weight:' + (obj.fontWeight || 400) + ';' +
        'color:' + (obj.fill || '#0F0F0F') + ';' +
        'text-align:' + (obj.textAlign || 'left') + ';' +
        'white-space:pre-wrap;line-height:1.2;' +
        'opacity:0;';

      if (obj._yb_anim === 'typewriter') {
        // Typewriter: reveal characters one by one
        el.style.opacity = '1';
        el.style.overflow = 'hidden';
        el.style.borderRight = '2px solid ' + (obj.fill || '#0F0F0F');
        el.style.whiteSpace = 'nowrap';
        el.textContent = '';
        el.setAttribute('data-tw-text', obj.text || '');
        el.setAttribute('data-tw-delay', String(delay));
      } else if (animCss) {
        el.style.animationName = animCss;
        el.style.animationDuration = speed + 's';
        el.style.animationDelay = delay + 's';
        el.style.animationFillMode = 'forwards';
        el.style.animationTimingFunction = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      }

      el.textContent = obj.text || '';
      overlay.appendChild(el);
    });

    // Insert overlay into the Fabric canvas container (same coordinate space)
    var fabricContainer = wrap.querySelector('.canvas-container');
    if (fabricContainer) {
      fabricContainer.style.position = 'relative';
      fabricContainer.appendChild(overlay);
    } else {
      // Fallback: append to inner
      var inner = wrap.querySelector('.yb-social__design-canvas-inner');
      if (inner) {
        inner.style.position = 'relative';
        inner.appendChild(overlay);
      }
    }

    return { overlay: overlay, animTexts: animTexts };
  }

  function runTypewriterEffects(overlay) {
    var twEls = overlay.querySelectorAll('[data-tw-text]');
    twEls.forEach(function (el) {
      var fullText = el.getAttribute('data-tw-text');
      var delay = parseFloat(el.getAttribute('data-tw-delay') || '0') * 1000;
      var charIdx = 0;
      setTimeout(function () {
        var interval = setInterval(function () {
          if (charIdx <= fullText.length) {
            el.textContent = fullText.substring(0, charIdx);
            charIdx++;
          } else {
            el.style.borderRight = 'none';
            clearInterval(interval);
          }
        }, 60);
      }, delay);
    });
  }

  function cleanupAnimOverlay(data) {
    if (!data) return;
    if (data.overlay && data.overlay.parentNode) data.overlay.remove();
    // Restore text opacity
    data.animTexts.forEach(function (obj) { obj.set('opacity', 1); });
    if (studio.canvas) studio.canvas.renderAll();
  }

  function previewAnimations() {
    if (!studio.canvas) return;
    var animTexts = getAnimatedTextObjects();
    if (!animTexts.length) {
      if (S) S.toast('No animated text elements');
      return;
    }

    var data = buildAnimOverlay();
    if (!data) return;

    runTypewriterEffects(data.overlay);

    var duration = calcTotalAnimDuration();
    setTimeout(function () {
      cleanupAnimOverlay(data);
    }, (duration + 1.5) * 1000);
  }

  async function recordAnimation() {
    if (!studio.canvas) return;
    var animTexts = getAnimatedTextObjects();
    if (!animTexts.length) {
      if (S) S.toast('No animated text elements to record');
      return;
    }

    var p = PRESETS[studio.preset];
    var duration = calcTotalAnimDuration() + 1; // extra 1s buffer

    // Show progress
    var progress = $('yb-design-record-progress');
    if (progress) {
      progress.hidden = false;
      progress.textContent = 'Preparing...';
    }

    // Create off-screen recording canvas at full resolution
    var recCanvas = document.createElement('canvas');
    recCanvas.width = p.w;
    recCanvas.height = p.h;
    var recCtx = recCanvas.getContext('2d');

    // Get static canvas snapshot (everything except animated text)
    var data = buildAnimOverlay();
    if (!data) return;

    // Capture the static canvas as an image
    var staticImg = new Image();
    staticImg.src = studio.canvas.toDataURL({ format: 'png', quality: 1, multiplier: 1 });

    await new Promise(function (resolve) { staticImg.onload = resolve; });

    // Set up MediaRecorder
    var stream = recCanvas.captureStream(30);
    var mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' :
                   MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    var recorder = new MediaRecorder(stream, { mimeType: mimeType, videoBitsPerSecond: 5000000 });
    var chunks = [];

    recorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = function () {
      cleanupAnimOverlay(data);
      var blob = new Blob(chunks, { type: mimeType });
      var ext = mimeType.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      var url = URL.createObjectURL(blob);

      // Download
      var link = document.createElement('a');
      link.download = 'design-anim-' + studio.preset + '-' + Date.now() + '.' + ext;
      link.href = url;
      link.click();

      // Also try to upload and attach
      uploadVideoBlob(blob, ext);

      if (progress) {
        progress.textContent = 'Done!';
        setTimeout(function () { progress.hidden = true; }, 2000);
      }
    };

    // Start recording
    recorder.start();
    if (progress) progress.textContent = 'Recording...';

    // Start CSS animations on the overlay
    runTypewriterEffects(data.overlay);

    // Render loop: composite static canvas + animated overlay onto recCanvas
    var startTime = performance.now();
    var totalMs = duration * 1000;

    function renderFrame() {
      var elapsed = performance.now() - startTime;
      if (progress) {
        var pct = Math.min(100, Math.round((elapsed / totalMs) * 100));
        progress.textContent = 'Recording... ' + pct + '%';
      }

      // Draw static canvas
      recCtx.clearRect(0, 0, p.w, p.h);
      recCtx.drawImage(staticImg, 0, 0, p.w, p.h);

      // Draw each animated text element at its current visual state
      var childNodes = data.overlay.children;
      for (var i = 0; i < childNodes.length; i++) {
        var el = childNodes[i];
        var computed = window.getComputedStyle(el);
        var opacity = parseFloat(computed.opacity);
        if (opacity <= 0) continue;

        recCtx.save();
        recCtx.globalAlpha = opacity;
        recCtx.font = computed.fontWeight + ' ' + computed.fontSize + ' ' + computed.fontFamily;
        recCtx.fillStyle = computed.color;
        recCtx.textBaseline = 'top';

        // Parse transform for translate/scale
        var transform = computed.transform;
        if (transform && transform !== 'none') {
          var matrix = new DOMMatrix(transform);
          var elLeft = parseFloat(el.style.left) || 0;
          var elTop = parseFloat(el.style.top) || 0;
          recCtx.translate(elLeft, elTop);
          recCtx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
          recCtx.fillText(el.textContent, 0, 0);
        } else {
          recCtx.fillText(el.textContent, parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0);
        }
        recCtx.restore();
      }

      if (elapsed < totalMs) {
        requestAnimationFrame(renderFrame);
      } else {
        recorder.stop();
      }
    }

    requestAnimationFrame(renderFrame);
  }

  async function uploadVideoBlob(blob, ext) {
    if (!S) return;
    try {
      var fileName = 'design-anim-' + Date.now() + '.' + ext;
      var file = new File([blob], fileName, { type: blob.type });
      var token = await S.getToken();
      var formData = new FormData();
      formData.append('file', file);
      formData.append('path', 'yoga-bible-DK/social/designs');

      var resp = await fetch('/.netlify/functions/bunny-browser', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData
      });

      var result = await resp.json();
      if (result.ok && result.url) {
        if (window._ybSocialComposer && window._ybSocialComposer.addMedia) {
          window._ybSocialComposer.addMedia(result.url);
        }
        S.toast('Video exported and attached!');
      }
    } catch (err) {
      console.error('[design-studio] Video upload error:', err);
    }
  }

  function applyAnimPreset(presetKey) {
    if (!studio.canvas || !ANIM_PRESETS[presetKey]) return;
    if (studio.canvas.getObjects().length > 0) {
      if (!confirm('This will add elements to your canvas. Continue?')) return;
    }
    ANIM_PRESETS[presetKey].setup();
    renderLayers();
    updatePropsPanel();
    studio.dirty = true;
  }

  /* ═══ IMAGE BROWSER (reuse media browser) ═══ */
  function openImageBrowser() {
    // Open Bunny CDN media browser, then add selected image to canvas
    var mediaBrowser = $('yb-social-media-browser');
    if (!mediaBrowser) return;

    // Temporarily override the media confirm action
    window._ybDesignStudioImageCallback = function (urls) {
      if (urls && urls.length) {
        urls.forEach(function (url) {
          if (/\.(jpg|jpeg|png|gif|webp|svg)/i.test(url)) {
            addImageFromUrl(url);
          }
        });
      }
      delete window._ybDesignStudioImageCallback;
    };

    // Open browser
    if (window._ybSocialComposer && window._ybSocialComposer.openMediaBrowser) {
      window._ybSocialComposer.openMediaBrowser();
    }
  }

  /* ═══ EVENT DELEGATION ═══ */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-design-action]');
    if (!btn) {
      // Check props panel interactions
      var propBtn = e.target.closest('[data-design-prop]');
      if (propBtn && propBtn.hasAttribute('data-design-val')) {
        applyProp(propBtn.getAttribute('data-design-prop'), propBtn.getAttribute('data-design-val'));
        updatePropsPanel();
        return;
      }
      // Layer click to select
      var layerEl = e.target.closest('[data-design-layer]');
      if (layerEl && studio.canvas) {
        var idx = parseInt(layerEl.getAttribute('data-design-layer'));
        var objects = studio.canvas.getObjects();
        if (objects[idx]) {
          studio.canvas.setActiveObject(objects[idx]);
          studio.canvas.renderAll();
        }
        return;
      }
      return;
    }

    var action = btn.getAttribute('data-design-action');

    if (action === 'close-studio') closeStudio();
    else if (action === 'add-text') addText();
    else if (action === 'add-rect') addShape('rect');
    else if (action === 'add-circle') addShape('circle');
    else if (action === 'add-logo') addBrandLogo();
    else if (action === 'add-image') openImageBrowser();
    else if (action === 'delete-selected') deleteSelected();
    else if (action === 'bring-forward') bringForward();
    else if (action === 'send-backward') sendBackward();
    else if (action === 'export-png') exportAsPng();
    else if (action === 'save-template') saveAsTemplate();
    else if (action === 'download-png') {
      if (studio.canvas) downloadDataUrl(studio.canvas.toDataURL({ format: 'png', quality: 1, multiplier: 1 }));
    }
    else if (action === 'load-template') {
      var tid = btn.getAttribute('data-template-id');
      if (tid) loadTemplate(tid);
    }
    else if (action === 'delete-template') {
      e.stopPropagation();
      var dtid = btn.getAttribute('data-template-id');
      if (dtid) deleteTemplate(dtid);
    }
    else if (action === 'toggle-vis') {
      var vi = parseInt(btn.getAttribute('data-design-idx'));
      var objs = studio.canvas.getObjects();
      if (objs[vi]) {
        objs[vi].visible = !objs[vi].visible;
        studio.canvas.renderAll();
        renderLayers();
      }
    }
    else if (action === 'delete-layer') {
      e.stopPropagation();
      var di = parseInt(btn.getAttribute('data-design-idx'));
      var dObjs = studio.canvas.getObjects();
      if (dObjs[di]) {
        studio.canvas.remove(dObjs[di]);
        studio.canvas.renderAll();
      }
    }
    else if (action === 'preview-anim') previewAnimations();
    else if (action === 'record-anim') recordAnimation();
    else if (action === 'anim-preset') {
      var pk = btn.getAttribute('data-anim-preset');
      if (pk) applyAnimPreset(pk);
    }
  });

  // Animation chip clicks (anim type, speed, delay)
  document.addEventListener('click', function (e) {
    var animBtn = e.target.closest('[data-design-anim]');
    if (animBtn && studio.canvas) {
      var obj = studio.canvas.getActiveObject();
      if (obj && (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox')) {
        obj._yb_anim = animBtn.getAttribute('data-design-anim');
        studio.dirty = true;
        updatePropsPanel();
      }
      return;
    }
    var speedBtn = e.target.closest('[data-design-anim-speed]');
    if (speedBtn && studio.canvas) {
      var sObj = studio.canvas.getActiveObject();
      if (sObj) {
        sObj._yb_anim_speed = speedBtn.getAttribute('data-design-anim-speed');
        studio.dirty = true;
        updatePropsPanel();
      }
      return;
    }
    var delayBtn = e.target.closest('[data-design-anim-delay]');
    if (delayBtn && studio.canvas) {
      var dObj = studio.canvas.getActiveObject();
      if (dObj) {
        dObj._yb_anim_delay = parseFloat(delayBtn.getAttribute('data-design-anim-delay'));
        studio.dirty = true;
        updatePropsPanel();
      }
      return;
    }
  });

  // Preset buttons
  document.addEventListener('click', function (e) {
    var presetBtn = e.target.closest('[data-design-preset]');
    if (presetBtn) {
      switchPreset(presetBtn.getAttribute('data-design-preset'));
    }
  });

  // Canvas background color
  document.addEventListener('click', function (e) {
    var bgBtn = e.target.closest('[data-design-bg]');
    if (bgBtn) {
      setCanvasBg(bgBtn.getAttribute('data-design-bg'));
    }
  });

  // Property inputs (range, number, select)
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-design-prop')) {
      applyProp(el.getAttribute('data-design-prop'), el.value);
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-design-prop') && el.tagName === 'SELECT') {
      applyProp(el.getAttribute('data-design-prop'), el.value);
    }
  });

  /* ═══ BRIDGE ═══ */
  window._ybSocialDesign = {
    openStudio: openStudio,
    closeStudio: closeStudio,
    getState: function () { return studio; }
  };

})();
