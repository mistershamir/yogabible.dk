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

  var SCALE = 0.5; // canvas display scale

  /* ═══ OPEN / CLOSE ═══ */
  function openStudio(postId) {
    S = window._ybSocial;
    studio.pendingPostId = postId || null;
    var modal = $('yb-social-design-modal');
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    initCanvas();
    loadTemplates();
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

    // Calculate scale to fit container
    var container = $('yb-design-canvas-wrap');
    if (container) {
      var maxW = container.clientWidth - 20;
      var maxH = container.clientHeight - 20;
      SCALE = Math.min(maxW / p.w, maxH / p.h, 0.6);
    }

    canvasEl.width = p.w;
    canvasEl.height = p.h;

    if (studio.canvas) studio.canvas.dispose();

    studio.canvas = new fabric.Canvas('yb-design-canvas', {
      width: p.w,
      height: p.h,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true
    });

    // Apply scale via CSS
    var wrapInner = canvasEl.parentElement;
    if (wrapInner) {
      wrapInner.style.transform = 'scale(' + SCALE + ')';
      wrapInner.style.transformOrigin = 'top left';
      wrapInner.style.width = p.w + 'px';
      wrapInner.style.height = p.h + 'px';
    }

    // Set container size
    if (container) {
      container.style.width = Math.round(p.w * SCALE) + 'px';
      container.style.height = Math.round(p.h * SCALE) + 'px';
    }

    // Events
    studio.canvas.on('selection:created', onSelect);
    studio.canvas.on('selection:updated', onSelect);
    studio.canvas.on('selection:cleared', onDeselect);
    studio.canvas.on('object:modified', function () { studio.dirty = true; renderLayers(); });
    studio.canvas.on('object:added', function () { studio.dirty = true; renderLayers(); });
    studio.canvas.on('object:removed', function () { studio.dirty = true; renderLayers(); });

    // Keyboard shortcuts
    document.addEventListener('keydown', onKeydown);

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
      fontWeight: 400
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

    var json = studio.canvas.toJSON(['name']);
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
