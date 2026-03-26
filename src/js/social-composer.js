/**
 * Social Media Manager — Composer, Media Browser, AI Panel
 * Depends on social-admin.js (window._ybSocial bridge)
 */
(function () {
  'use strict';

  var S; // bridge to social-admin.js
  function $(id) { return document.getElementById(id); }
  function t(k) { return S ? S.t(k) : k; }

  /* ═══ STATE ═══ */
  var composer = {
    postId: null,
    platforms: [],
    media: [],       // array of CDN URLs
    mediaSelected: [], // temp selection in media browser
    currentPath: 'yoga-bible-DK/social'
  };

  var CHAR_LIMITS = {
    instagram: 2200, facebook: 63206, tiktok: 2200,
    linkedin: 3000, youtube: 5000, pinterest: 500
  };

  /* ═══ OPEN / CLOSE COMPOSER ═══ */
  window.openSocialComposer = function (postId) {
    S = window._ybSocial;
    var modal = $('yb-social-composer');
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    // Reset form
    composer.postId = postId;
    composer.media = [];
    composer.platforms = [];
    $('yb-social-post-id').value = postId || '';
    $('yb-social-caption').value = '';
    $('yb-social-hashtags').value = '';
    $('yb-social-first-comment').value = '';
    $('yb-social-location').value = '';
    $('yb-social-composer-title').textContent = postId ? t('social_composer_edit_title') : t('social_composer_title');

    // Reset platform toggles
    document.querySelectorAll('.yb-social__composer-platforms input').forEach(function (cb) {
      cb.checked = false;
      // Enable only connected platforms
      var p = cb.value;
      cb.disabled = !(S.state.accounts[p]);
    });

    // Reset schedule
    var nowRadio = document.querySelector('input[name="social-schedule"][value="now"]');
    if (nowRadio) nowRadio.checked = true;
    var picker = $('yb-social-schedule-picker');
    if (picker) picker.hidden = true;

    // Reset AI panel
    var aiPanel = $('yb-social-ai-panel');
    if (aiPanel) aiPanel.hidden = true;
    var aiResults = $('yb-social-ai-results');
    if (aiResults) aiResults.innerHTML = '';

    // Reset media preview
    renderMediaPreview();
    updatePreview();
    updateCharCount();
    loadHashtagDropdown();

    // If editing, load post data
    if (postId) loadPostForEdit(postId);

    // Update publish button text
    updatePublishBtn();
  };

  function closeComposer() {
    var modal = $('yb-social-composer');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
  }

  async function loadPostForEdit(id) {
    var data = await S.api('social-posts?action=get&id=' + id);
    if (!data || !data.post) return;
    var p = data.post;

    $('yb-social-caption').value = p.caption || '';
    $('yb-social-hashtags').value = (p.hashtags || []).join(', ');
    $('yb-social-first-comment').value = p.firstComment || '';
    $('yb-social-location').value = p.location || '';
    composer.media = p.media || [];
    composer.platforms = p.platforms || [];

    // Set platform checkboxes
    document.querySelectorAll('.yb-social__composer-platforms input').forEach(function (cb) {
      cb.checked = composer.platforms.indexOf(cb.value) >= 0;
    });

    // Set schedule
    if (p.status === 'scheduled' && p.scheduledAt) {
      var schedRadio = document.querySelector('input[name="social-schedule"][value="schedule"]');
      if (schedRadio) schedRadio.checked = true;
      var picker = $('yb-social-schedule-picker');
      if (picker) picker.hidden = false;
      var dt = p.scheduledAt._seconds ? new Date(p.scheduledAt._seconds * 1000) : new Date(p.scheduledAt);
      $('yb-social-schedule-date').value = dt.toISOString().split('T')[0];
      $('yb-social-schedule-time').value = dt.toTimeString().substring(0, 5);
    }

    renderMediaPreview();
    updatePreview();
    updateCharCount();
    toggleFirstComment();
  }

  /* ═══ CAPTION & PREVIEW ═══ */
  function updateCharCount() {
    var caption = ($('yb-social-caption') || {}).value || '';
    var el = $('yb-social-char-count');
    if (!el) return;

    // Use the lowest limit from selected platforms
    var limit = 2200;
    composer.platforms.forEach(function (p) {
      if (CHAR_LIMITS[p] && CHAR_LIMITS[p] < limit) limit = CHAR_LIMITS[p];
    });

    el.textContent = caption.length + ' / ' + limit;
    el.classList.toggle('is-over', caption.length > limit);
  }

  function updatePreview() {
    var caption = ($('yb-social-caption') || {}).value || '';
    var hashtags = ($('yb-social-hashtags') || {}).value || '';
    var fullCaption = caption + (hashtags ? '\n\n' + hashtags : '');

    var captionEl = $('yb-social-preview-caption');
    if (captionEl) {
      captionEl.innerHTML = '<strong>yogabible</strong> <span>' +
        (fullCaption || 'Your caption will appear here...') + '</span>';
    }

    var mediaEl = $('yb-social-preview-media');
    if (mediaEl) {
      if (composer.media.length > 0) {
        var url = composer.media[0];
        if (url.match(/\.(mp4|mov|webm)$/i)) {
          mediaEl.innerHTML = '<video src="' + url + '" style="width:100%;max-height:300px" controls></video>';
        } else {
          mediaEl.innerHTML = '<img src="' + url + '" alt="Preview">';
        }
      } else {
        mediaEl.innerHTML = '<p class="yb-admin__muted">' + t('social_no_media') + '</p>';
      }
    }
  }

  function toggleFirstComment() {
    var field = $('yb-social-first-comment-field');
    if (!field) return;
    field.hidden = composer.platforms.indexOf('instagram') < 0;
  }

  function updatePublishBtn() {
    var btn = $('yb-social-publish-btn');
    if (!btn) return;
    var isSchedule = document.querySelector('input[name="social-schedule"]:checked');
    if (isSchedule && isSchedule.value === 'schedule') {
      btn.textContent = t('social_schedule_btn');
    } else {
      btn.textContent = t('social_publish');
    }
  }

  /* ═══ MEDIA PREVIEW (in composer) ═══ */
  function renderMediaPreview() {
    var container = $('yb-social-media-preview');
    if (!container) return;

    if (composer.media.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = composer.media.map(function (url, i) {
      var isVideo = url.match(/\.(mp4|mov|webm)$/i);
      return '<div class="yb-social__media-thumb">' +
        (isVideo
          ? '<video src="' + url + '"></video>'
          : '<img src="' + url + '" alt="">') +
        '<button class="yb-social__media-thumb-remove" data-action="social-remove-media" data-index="' + i + '">&times;</button>' +
        '</div>';
    }).join('');
  }

  /* ═══ SAVE / PUBLISH ═══ */
  async function savePost(status) {
    var caption = ($('yb-social-caption') || {}).value || '';
    var hashtagsRaw = ($('yb-social-hashtags') || {}).value || '';
    var hashtags = hashtagsRaw.split(/[,\n]+/).map(function (h) { return h.trim(); }).filter(Boolean);

    // Gather selected platforms
    composer.platforms = [];
    document.querySelectorAll('.yb-social__composer-platforms input:checked').forEach(function (cb) {
      composer.platforms.push(cb.value);
    });

    if (!caption.trim() && composer.media.length === 0) {
      S.toast('Add a caption or media', true);
      return;
    }

    var body = {
      caption: caption,
      platforms: composer.platforms,
      media: composer.media,
      hashtags: hashtags,
      firstComment: ($('yb-social-first-comment') || {}).value || '',
      location: ($('yb-social-location') || {}).value || '',
      status: status
    };

    // Handle scheduling
    if (status === 'scheduled') {
      var dateVal = ($('yb-social-schedule-date') || {}).value;
      var timeVal = ($('yb-social-schedule-time') || {}).value || '10:00';
      if (!dateVal) { S.toast('Pick a date', true); return; }
      body.scheduledAt = new Date(dateVal + 'T' + timeVal + ':00').toISOString();
    }

    var postId = ($('yb-social-post-id') || {}).value;
    var action, method;
    if (postId) {
      action = 'update';
      body.id = postId;
    } else {
      action = 'create';
    }

    var data = await S.api('social-posts?action=' + action, {
      method: 'POST', body: JSON.stringify(body)
    });

    if (!data) return;

    // If "Post Now" and status is not draft — publish immediately
    if (status === 'published') {
      var pid = postId || data.id;
      S.toast(t('social_publishing'));
      var pub = await S.api('social-publish', {
        method: 'POST', body: JSON.stringify({ postId: pid })
      });
      if (pub) S.toast(t('social_published'));
    } else {
      S.toast(t('social_saved'));
    }

    closeComposer();
    S.loadPosts();
  }

  /* ═══ MEDIA BROWSER ═══ */
  function openMediaBrowser() {
    var modal = $('yb-social-media-browser');
    if (!modal) return;
    modal.hidden = false;
    composer.mediaSelected = [];
    composer.currentPath = 'yoga-bible-DK/social';
    loadMediaFolder(composer.currentPath);
  }

  function closeMediaBrowser() {
    var modal = $('yb-social-media-browser');
    if (modal) modal.hidden = true;
  }

  async function loadMediaFolder(path) {
    composer.currentPath = path;
    var grid = $('yb-social-media-grid');
    var breadcrumb = $('yb-social-media-breadcrumb');
    if (!grid) return;
    grid.innerHTML = '<p class="yb-admin__muted">Loading...</p>';

    // Update breadcrumb
    if (breadcrumb) {
      var parts = path.split('/').filter(Boolean);
      var html = '';
      parts.forEach(function (part, i) {
        var subPath = parts.slice(0, i + 1).join('/');
        if (i > 0) html += '<span>/</span>';
        html += '<button data-action="social-media-nav" data-path="' + subPath + '">' + part + '</button>';
      });
      breadcrumb.innerHTML = html;
    }

    var token = await S.getToken();
    if (!token) return;

    // Load folders
    var foldersRes = await fetch('/.netlify/functions/bunny-browser?action=folders&path=' + encodeURIComponent(path), {
      headers: { Authorization: 'Bearer ' + token }
    });
    var foldersData = await foldersRes.json();

    // Load files
    var filesRes = await fetch('/.netlify/functions/bunny-browser?action=resources&path=' + encodeURIComponent(path), {
      headers: { Authorization: 'Bearer ' + token }
    });
    var filesData = await filesRes.json();

    var html = '';

    // Folders
    (foldersData.folders || []).forEach(function (f) {
      html += '<div class="yb-social__media-folder" data-action="social-media-open-folder" data-path="' + f.path + '">' +
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
        '<span>' + f.name + '</span></div>';
    });

    // Files (images/videos)
    (filesData.resources || []).forEach(function (r) {
      var url = r.secure_url || ('https://yogabible.b-cdn.net/' + path + '/' + r.public_id);
      var isSelected = composer.mediaSelected.indexOf(url) >= 0;
      if (r.resource_type === 'image' || r.resource_type === 'video') {
        html += '<div class="yb-social__media-item' + (isSelected ? ' is-selected' : '') + '" data-action="social-media-toggle" data-url="' + url + '">' +
          '<img src="' + url + '?width=200" alt="" loading="lazy">' +
          '</div>';
      }
    });

    if (!html) html = '<p class="yb-admin__muted">No media files here. Upload some first.</p>';
    grid.innerHTML = html;
    updateMediaSelectedCount();
  }

  function toggleMediaSelection(url) {
    var idx = composer.mediaSelected.indexOf(url);
    if (idx >= 0) {
      composer.mediaSelected.splice(idx, 1);
    } else {
      composer.mediaSelected.push(url);
    }
    // Toggle class on item
    document.querySelectorAll('.yb-social__media-item').forEach(function (el) {
      el.classList.toggle('is-selected', composer.mediaSelected.indexOf(el.getAttribute('data-url')) >= 0);
    });
    updateMediaSelectedCount();
  }

  function updateMediaSelectedCount() {
    var el = $('yb-social-media-selected-count');
    if (el) el.textContent = composer.mediaSelected.length + ' ' + t('social_selected');
  }

  function confirmMediaSelection() {
    composer.media = composer.media.concat(composer.mediaSelected);
    composer.mediaSelected = [];
    closeMediaBrowser();
    renderMediaPreview();
    updatePreview();
  }

  /* ═══ FILE UPLOAD ═══ */
  async function uploadFiles(files) {
    if (!files || files.length === 0) return;
    var token = await S.getToken();
    if (!token) return;

    // Get upload URL
    var now = new Date();
    var folder = 'yoga-bible-DK/social/' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var signRes = await fetch('/.netlify/functions/bunny-browser?action=sign_upload&folder=' + encodeURIComponent(folder), {
      headers: { Authorization: 'Bearer ' + token }
    });
    var signData = await signRes.json();
    if (!signData.ok) { S.toast('Upload error', true); return; }

    var params = signData.upload_params;

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      S.toast('Uploading ' + file.name + '...');

      var fileName = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '');
      var uploadUrl = params.upload_url + fileName;

      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { AccessKey: params.headers.AccessKey, 'Content-Type': file.type },
        body: file
      });

      var cdnUrl = params.cdn_base + '/' + folder + '/' + fileName;
      composer.media.push(cdnUrl);
    }

    S.toast('Uploaded ' + files.length + ' file(s)');
    renderMediaPreview();
    updatePreview();
  }

  /* ═══ HASHTAG DROPDOWN ═══ */
  function loadHashtagDropdown() {
    var select = $('yb-social-hashtag-set-select');
    if (!select) return;
    var db = firebase.firestore();
    db.collection('social_hashtag_sets').orderBy('name').get().then(function (snap) {
      var html = '<option value="">' + t('social_load_set') + '</option>';
      snap.forEach(function (doc) {
        var d = doc.data();
        html += '<option value="' + doc.id + '" data-tags="' + (d.hashtags || []).join(', ') + '">' + d.name + '</option>';
      });
      select.innerHTML = html;
    });
  }

  window._ybSocialRefreshHashtagDropdown = loadHashtagDropdown;

  /* ═══ AI PANEL ═══ */
  async function aiAction(action) {
    var topic = ($('yb-social-ai-topic') || {}).value || '';
    var caption = ($('yb-social-caption') || {}).value || '';
    var resultsEl = $('yb-social-ai-results');
    if (!resultsEl) return;

    if (action === 'generate-caption' && !topic) { S.toast('Enter a topic', true); return; }
    if (action === 'improve-caption' && !caption) { S.toast('Write a caption first', true); return; }

    resultsEl.innerHTML = '<p class="yb-admin__muted">Generating...</p>';

    var body = { action: action };
    if (topic) body.topic = topic;
    if (caption) body.caption = caption;
    if (composer.platforms.length) body.platform = composer.platforms[0];

    var data = await S.api('social-ai', { method: 'POST', body: JSON.stringify(body) });
    if (!data) { resultsEl.innerHTML = ''; return; }

    if (action === 'generate-hashtags') {
      var tags = data.hashtags || [];
      resultsEl.innerHTML = '<div class="yb-social__ai-variant">' +
        '<div class="yb-social__ai-variant-label">Suggested Hashtags</div>' +
        '<p>' + tags.join(' ') + '</p>' +
        '<button class="yb-social__ai-use-btn" data-action="social-ai-use-hashtags" data-tags="' +
        tags.join(', ') + '">Use These</button></div>';
      return;
    }

    var variants = data.variants || [];
    resultsEl.innerHTML = variants.map(function (v, i) {
      var labels = ['Variant A', 'Variant B', 'Variant C'];
      return '<div class="yb-social__ai-variant">' +
        '<div class="yb-social__ai-variant-label">' + (labels[i] || 'Variant ' + (i + 1)) + '</div>' +
        '<p>' + (v.caption || v) + '</p>' +
        (v.hashtags ? '<p style="font-size:11px;color:#6F6A66;margin-top:4px">' + v.hashtags.join(' ') + '</p>' : '') +
        '<button class="yb-social__ai-use-btn" data-action="social-ai-use-caption" data-index="' + i + '">Use This</button>' +
        '</div>';
    }).join('');

    // Store variants for selection
    resultsEl._variants = variants;
  }

  function useAiCaption(index) {
    var resultsEl = $('yb-social-ai-results');
    if (!resultsEl || !resultsEl._variants) return;
    var v = resultsEl._variants[index];
    if (!v) return;
    $('yb-social-caption').value = v.caption || v;
    if (v.hashtags) $('yb-social-hashtags').value = v.hashtags.join(', ');
    updateCharCount();
    updatePreview();
    S.toast('Applied');
  }

  /* ═══ DRAG & DROP ═══ */
  function setupDragDrop() {
    var drop = $('yb-social-media-drop');
    if (!drop) return;

    drop.addEventListener('dragover', function (e) {
      e.preventDefault(); drop.classList.add('is-dragover');
    });
    drop.addEventListener('dragleave', function () {
      drop.classList.remove('is-dragover');
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('is-dragover');
      if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });
  }

  /* ═══ EVENT DELEGATION ═══ */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');

    // Composer
    if (action === 'social-composer-close') closeComposer();
    else if (action === 'social-save-draft') savePost('draft');
    else if (action === 'social-publish-post') {
      var isSchedule = document.querySelector('input[name="social-schedule"]:checked');
      savePost(isSchedule && isSchedule.value === 'schedule' ? 'scheduled' : 'published');
    }

    // Media
    else if (action === 'social-browse-media') openMediaBrowser();
    else if (action === 'social-upload-media') {
      var fi = $('yb-social-file-input');
      if (fi) fi.click();
    }
    else if (action === 'social-remove-media') {
      var idx = parseInt(btn.getAttribute('data-index'));
      composer.media.splice(idx, 1);
      renderMediaPreview(); updatePreview();
    }

    // Media browser
    else if (action === 'social-media-browser-close') closeMediaBrowser();
    else if (action === 'social-media-open-folder') loadMediaFolder(btn.getAttribute('data-path'));
    else if (action === 'social-media-nav') loadMediaFolder(btn.getAttribute('data-path'));
    else if (action === 'social-media-toggle') toggleMediaSelection(btn.getAttribute('data-url'));
    else if (action === 'social-media-confirm') confirmMediaSelection();

    // AI
    else if (action === 'social-ai-toggle') {
      var panel = $('yb-social-ai-panel');
      if (panel) panel.hidden = !panel.hidden;
    }
    else if (action === 'social-ai-caption') aiAction('generate-caption');
    else if (action === 'social-ai-hashtags') aiAction('generate-hashtags');
    else if (action === 'social-ai-improve') aiAction('improve-caption');
    else if (action === 'social-ai-use-caption') useAiCaption(parseInt(btn.getAttribute('data-index')));
    else if (action === 'social-ai-use-hashtags') {
      $('yb-social-hashtags').value = btn.getAttribute('data-tags') || '';
      updatePreview(); S.toast('Applied');
    }

    // Best time placeholder
    else if (action === 'social-best-time') {
      S.toast('Best time: 10:00 AM (based on general engagement patterns)');
      $('yb-social-schedule-time').value = '10:00';
    }
  });

  // Input events
  document.addEventListener('input', function (e) {
    if (e.target.id === 'yb-social-caption') { updateCharCount(); updatePreview(); }
    if (e.target.id === 'yb-social-hashtags') updatePreview();
  });

  // Platform toggle changes
  document.addEventListener('change', function (e) {
    if (e.target.name === 'platform') {
      composer.platforms = [];
      document.querySelectorAll('.yb-social__composer-platforms input:checked').forEach(function (cb) {
        composer.platforms.push(cb.value);
      });
      updateCharCount();
      toggleFirstComment();
    }
    if (e.target.name === 'social-schedule') {
      var picker = $('yb-social-schedule-picker');
      if (picker) picker.hidden = (e.target.value !== 'schedule');
      updatePublishBtn();
    }
    if (e.target.id === 'yb-social-hashtag-set-select' && e.target.value) {
      var opt = e.target.options[e.target.selectedIndex];
      var tags = opt.getAttribute('data-tags');
      if (tags) {
        $('yb-social-hashtags').value = tags;
        updatePreview();
      }
    }
    if (e.target.id === 'yb-social-file-input') {
      uploadFiles(e.target.files);
      e.target.value = '';
    }
  });

  /* ═══ INIT ═══ */
  function init() {
    setupDragDrop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
