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
    currentPath: 'yoga-bible-DK/social',
    uploadPlatform: 'general'  // tracks active platform for upload folder
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

    // Reset media type
    var autoRadio = document.querySelector('input[name="social-media-type"][value="auto"]');
    if (autoRadio) autoRadio.checked = true;

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

  var previewPlatform = 'instagram';

  function switchPreviewPlatform(platform) {
    previewPlatform = platform;
    document.querySelectorAll('.yb-social__preview-tab').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.getAttribute('data-platform') === platform);
    });
    var device = $('yb-social-preview-device');
    if (device) device.setAttribute('data-preview-platform', platform);
    updatePreview();
  }

  var PLATFORM_LAYOUTS = {
    instagram: { username: 'yogabible', avatar: 'YB', showMedia: true, captionStyle: 'inline', charLimit: 2200 },
    facebook: { username: 'Yoga Bible', avatar: 'YB', showMedia: true, captionStyle: 'above', charLimit: 63206 },
    tiktok: { username: '@yogabible', avatar: 'YB', showMedia: true, captionStyle: 'overlay', charLimit: 2200 },
    linkedin: { username: 'Yoga Bible', avatar: 'YB', showMedia: true, captionStyle: 'above', charLimit: 3000 }
  };

  function updatePreview() {
    var caption = ($('yb-social-caption') || {}).value || '';
    var hashtags = ($('yb-social-hashtags') || {}).value || '';
    var fullCaption = caption + (hashtags ? '\n\n' + hashtags : '');
    var layout = PLATFORM_LAYOUTS[previewPlatform] || PLATFORM_LAYOUTS.instagram;

    // Header
    var headerEl = $('yb-social-preview-header');
    if (headerEl) {
      headerEl.innerHTML = '<span class="yb-social__preview-avatar">' + layout.avatar + '</span>' +
        '<span class="yb-social__preview-username">' + layout.username + '</span>';
    }

    // Caption
    var captionEl = $('yb-social-preview-caption');
    if (captionEl) {
      var captionHtml = fullCaption || 'Your caption will appear here...';
      if (layout.captionStyle === 'inline') {
        captionEl.innerHTML = '<strong>' + layout.username + '</strong> <span>' + captionHtml + '</span>';
      } else if (layout.captionStyle === 'overlay') {
        captionEl.innerHTML = '<span class="yb-social__preview-caption--overlay">' + captionHtml + '</span>';
      } else {
        captionEl.innerHTML = '<span>' + captionHtml + '</span>';
      }
    }

    // Media
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

    // Char info
    var charInfoEl = $('yb-social-preview-char-info');
    if (charInfoEl) {
      var len = fullCaption.length;
      var over = len > layout.charLimit;
      charInfoEl.textContent = len + ' / ' + layout.charLimit;
      charInfoEl.style.color = over ? '#dc2626' : '#6F6A66';
    }

    // Reorder elements based on caption style (above vs below media)
    var device = $('yb-social-preview-device');
    if (device && captionEl && mediaEl) {
      if (layout.captionStyle === 'above') {
        device.insertBefore(captionEl, mediaEl);
      } else {
        device.insertBefore(mediaEl, captionEl);
      }
    }
  }

  function toggleFirstComment() {
    var field = $('yb-social-first-comment-field');
    if (!field) return;
    field.hidden = composer.platforms.indexOf('instagram') < 0;
  }

  function toggleMediaTypeRow() {
    var row = $('yb-social-media-type-row');
    if (!row) return;
    var hasIG = composer.platforms.indexOf('instagram') >= 0;
    var hasMedia = composer.media.length > 0;
    row.hidden = !(hasIG && hasMedia);
  }

  function updatePublishBtn() {
    var btn = $('yb-social-publish-btn');
    if (!btn) return;
    var schedMode = document.querySelector('input[name="social-schedule"]:checked');
    var mode = schedMode ? schedMode.value : 'now';
    if (mode === 'schedule') {
      btn.textContent = t('social_schedule_btn');
    } else if (mode === 'queue') {
      btn.textContent = t('social_queue_btn');
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
    toggleMediaTypeRow();
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

    var mediaTypeRadio = document.querySelector('input[name="social-media-type"]:checked');
    var mediaType = mediaTypeRadio ? mediaTypeRadio.value : 'auto';

    var body = {
      caption: caption,
      platforms: composer.platforms,
      media: composer.media,
      hashtags: hashtags,
      firstComment: ($('yb-social-first-comment') || {}).value || '',
      location: ($('yb-social-location') || {}).value || '',
      mediaType: mediaType,
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
    // Start in the social folder by default, or the full CDN if browsing all
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

    // Determine upload folder based on selected platform(s)
    var now = new Date();
    var yearMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var platformFolder = composer.platforms.length === 1 ? composer.platforms[0] : 'general';
    var folder = 'yoga-bible-DK/social/' + platformFolder + '/' + yearMonth;
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

    // Validation
    if (action === 'generate-caption' && !topic) { S.toast('Enter a topic', true); return; }
    if (action === 'generate-bilingual' && !topic) { S.toast('Enter a topic', true); return; }
    if (action === 'improve-caption' && !caption) { S.toast('Write a caption first', true); return; }
    if (action === 'adapt-tone' && !caption) { S.toast('Write a caption first', true); return; }
    if (action === 'translate' && !caption) { S.toast('Write a caption first', true); return; }

    resultsEl.innerHTML = '<p class="yb-admin__muted">Generating...</p>';

    // Build request body
    var body = { action: action };
    if (topic) body.topic = topic;
    if (caption) body.caption = caption;
    if (composer.platforms.length) body.platform = composer.platforms[0];

    if (action === 'adapt-tone') {
      body.platforms = composer.platforms.length ? composer.platforms : ['instagram', 'facebook'];
    }
    if (action === 'repurpose-blog') {
      var blogContent = ($('yb-social-ai-blog-content') || {}).value || '';
      if (!blogContent) { S.toast('Paste or select blog content first', true); resultsEl.innerHTML = ''; return; }
      body.content = blogContent;
      body.topic = topic || 'blog repurpose';
    }

    var data = await S.api('social-ai', { method: 'POST', body: JSON.stringify(body) });
    if (!data) { resultsEl.innerHTML = ''; return; }

    // Render based on action type
    if (action === 'generate-hashtags') {
      renderHashtagResults(resultsEl, data);
    } else if (action === 'generate-bilingual') {
      renderBilingualResults(resultsEl, data);
    } else if (action === 'adapt-tone') {
      renderAdaptResults(resultsEl, data);
    } else if (action === 'translate') {
      renderTranslateResults(resultsEl, data);
    } else if (action === 'repurpose-blog') {
      renderRepurposeResults(resultsEl, data);
    } else {
      renderVariantResults(resultsEl, data);
    }
  }

  function renderHashtagResults(el, data) {
    var tags = data.hashtags || [];
    el.innerHTML = '<div class="yb-social__ai-variant">' +
      '<div class="yb-social__ai-variant-label">Suggested Hashtags</div>' +
      '<p>' + tags.join(' ') + '</p>' +
      '<button class="yb-social__ai-use-btn" data-action="social-ai-use-hashtags" data-tags="' +
      tags.join(', ') + '">Use These</button></div>';
  }

  function renderVariantResults(el, data) {
    var variants = data.variants || [];
    el.innerHTML = variants.map(function (v, i) {
      var labels = ['Variant A', 'Variant B', 'Variant C'];
      return '<div class="yb-social__ai-variant">' +
        '<div class="yb-social__ai-variant-label">' + (labels[i] || 'Variant ' + (i + 1)) +
        (v.style ? ' <span style="font-weight:400;color:#6F6A66">(' + v.style + ')</span>' : '') + '</div>' +
        '<p>' + (v.caption || v) + '</p>' +
        (v.hashtags ? '<p style="font-size:11px;color:#6F6A66;margin-top:4px">' + v.hashtags.join(' ') + '</p>' : '') +
        '<button class="yb-social__ai-use-btn" data-action="social-ai-use-caption" data-index="' + i + '">Use This</button>' +
        '</div>';
    }).join('');
    el._variants = variants;
  }

  function renderBilingualResults(el, data) {
    var da = data.da || {};
    var en = data.en || {};
    el._bilingual = { da: da, en: en };
    el.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div class="yb-social__ai-variant">' +
          '<div class="yb-social__ai-variant-label">🇩🇰 Dansk</div>' +
          '<p>' + (da.caption || '') + '</p>' +
          (da.hashtags ? '<p style="font-size:11px;color:#6F6A66;margin-top:4px">' + da.hashtags.join(' ') + '</p>' : '') +
          '<button class="yb-social__ai-use-btn" data-action="social-ai-use-bilingual" data-lang="da">Use Danish</button>' +
        '</div>' +
        '<div class="yb-social__ai-variant">' +
          '<div class="yb-social__ai-variant-label">🇬🇧 English</div>' +
          '<p>' + (en.caption || '') + '</p>' +
          (en.hashtags ? '<p style="font-size:11px;color:#6F6A66;margin-top:4px">' + en.hashtags.join(' ') + '</p>' : '') +
          '<button class="yb-social__ai-use-btn" data-action="social-ai-use-bilingual" data-lang="en">Use English</button>' +
        '</div>' +
      '</div>';
  }

  function renderAdaptResults(el, data) {
    var adaptations = data.adaptations || {};
    el._adaptations = adaptations;
    var platformIcons = { instagram: '📸', facebook: '👤', linkedin: '💼', tiktok: '🎵', youtube: '▶️', pinterest: '📌' };
    var html = '';
    Object.keys(adaptations).forEach(function (plat) {
      var a = adaptations[plat];
      html += '<div class="yb-social__ai-variant">' +
        '<div class="yb-social__ai-variant-label">' + (platformIcons[plat] || '') + ' ' + plat.charAt(0).toUpperCase() + plat.slice(1) + '</div>' +
        '<p>' + (a.caption || '') + '</p>' +
        (a.note ? '<p style="font-size:11px;color:#6F6A66;margin-top:4px;font-style:italic">' + a.note + '</p>' : '') +
        '<button class="yb-social__ai-use-btn" data-action="social-ai-use-adaptation" data-platform="' + plat + '">Use This</button>' +
        '</div>';
    });
    el.innerHTML = html;
  }

  function renderTranslateResults(el, data) {
    el._translated = data;
    el.innerHTML = '<div class="yb-social__ai-variant">' +
      '<div class="yb-social__ai-variant-label">Translation</div>' +
      '<p>' + (data.caption || '') + '</p>' +
      (data.hashtags ? '<p style="font-size:11px;color:#6F6A66;margin-top:4px">' + data.hashtags.join(' ') + '</p>' : '') +
      '<button class="yb-social__ai-use-btn" data-action="social-ai-use-translated">Use This</button>' +
      '</div>';
  }

  function renderRepurposeResults(el, data) {
    var posts = data.posts || [];
    el._repurposed = posts;
    el.innerHTML = posts.map(function (p, i) {
      return '<div class="yb-social__ai-variant">' +
        '<div class="yb-social__ai-variant-label">Post ' + (i + 1) +
        (p.key_topic ? ' <span style="font-weight:400;color:#6F6A66">(' + p.key_topic + ')</span>' : '') + '</div>' +
        '<p>' + (p.caption || '') + '</p>' +
        (p.hashtags ? '<p style="font-size:11px;color:#6F6A66;margin-top:4px">' + p.hashtags.join(' ') + '</p>' : '') +
        (p.visual_suggestion ? '<p style="font-size:11px;color:#f75c03;margin-top:4px">📷 ' + p.visual_suggestion + '</p>' : '') +
        '<button class="yb-social__ai-use-btn" data-action="social-ai-use-repurposed" data-index="' + i + '">Use This</button>' +
        '</div>';
    }).join('');
  }

  function loadBlogEntries() {
    // Blog entries are loaded from _data at build time, not served publicly.
    // User pastes content directly into the textarea.
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
    else if (action === 'social-preview-tab') switchPreviewPlatform(btn.getAttribute('data-platform'));
    else if (action === 'social-save-draft') savePost('draft');
    else if (action === 'social-publish-post') {
      var schedMode = document.querySelector('input[name="social-schedule"]:checked');
      var mode = schedMode ? schedMode.value : 'now';
      if (mode === 'schedule' || mode === 'queue') savePost('scheduled');
      else savePost('published');
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
    else if (action === 'social-ai-bilingual') aiAction('generate-bilingual');
    else if (action === 'social-ai-adapt-tone') aiAction('adapt-tone');
    else if (action === 'social-ai-translate') aiAction('translate');
    else if (action === 'social-ai-repurpose') {
      var blogField = $('yb-social-ai-blog-field');
      if (blogField) { blogField.hidden = !blogField.hidden; loadBlogEntries(); }
    }
    else if (action === 'social-ai-repurpose-go') aiAction('repurpose-blog');
    else if (action === 'social-ai-use-bilingual') {
      var lang = btn.getAttribute('data-lang');
      var resultsEl = $('yb-social-ai-results');
      if (resultsEl && resultsEl._bilingual) {
        var d = resultsEl._bilingual[lang];
        if (d) {
          $('yb-social-caption').value = d.caption || '';
          if (d.hashtags) $('yb-social-hashtags').value = d.hashtags.join(', ');
          updateCharCount(); updatePreview(); S.toast('Applied ' + lang.toUpperCase());
        }
      }
    }
    else if (action === 'social-ai-use-adaptation') {
      var plat = btn.getAttribute('data-platform');
      var resultsEl = $('yb-social-ai-results');
      if (resultsEl && resultsEl._adaptations && resultsEl._adaptations[plat]) {
        $('yb-social-caption').value = resultsEl._adaptations[plat].caption || '';
        updateCharCount(); updatePreview(); S.toast('Applied ' + plat);
      }
    }
    else if (action === 'social-ai-use-translated') {
      var resultsEl = $('yb-social-ai-results');
      if (resultsEl && resultsEl._translated) {
        $('yb-social-caption').value = resultsEl._translated.caption || '';
        if (resultsEl._translated.hashtags) $('yb-social-hashtags').value = resultsEl._translated.hashtags.join(', ');
        updateCharCount(); updatePreview(); S.toast('Applied');
      }
    }
    else if (action === 'social-ai-use-repurposed') {
      var idx = parseInt(btn.getAttribute('data-index'));
      var resultsEl = $('yb-social-ai-results');
      if (resultsEl && resultsEl._repurposed && resultsEl._repurposed[idx]) {
        var p = resultsEl._repurposed[idx];
        $('yb-social-caption').value = p.caption || '';
        if (p.hashtags) $('yb-social-hashtags').value = p.hashtags.join(', ');
        updateCharCount(); updatePreview(); S.toast('Applied post ' + (idx + 1));
      }
    }

    // Best time — fetch from analytics
    else if (action === 'social-best-time') {
      fetchBestTime();
    }

    // UTM builder
    else if (action === 'social-utm-copy') {
      var utmResult = $('yb-social-utm-result');
      if (utmResult && utmResult.value) {
        navigator.clipboard.writeText(utmResult.value).then(function () { S.toast('Copied'); });
      }
    }
    else if (action === 'social-utm-insert') {
      var utmResult = $('yb-social-utm-result');
      var captionEl = $('yb-social-caption');
      if (utmResult && utmResult.value && captionEl) {
        captionEl.value = captionEl.value.replace(/https?:\/\/yogabible\.dk\S*/g, utmResult.value) || captionEl.value + '\n\n' + utmResult.value;
        updateCharCount(); updatePreview();
        S.toast('URL inserted');
      }
    }
  });

  // Input events
  document.addEventListener('input', function (e) {
    if (e.target.id === 'yb-social-caption') { updateCharCount(); updatePreview(); }
    if (e.target.id === 'yb-social-hashtags') updatePreview();

    // UTM builder auto-generate
    if (e.target.id === 'yb-social-utm-url' || e.target.id === 'yb-social-utm-source' ||
        e.target.id === 'yb-social-utm-medium' || e.target.id === 'yb-social-utm-campaign') {
      buildUtmUrl();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'yb-social-utm-source') buildUtmUrl();
  });

  function buildUtmUrl() {
    var base = ($('yb-social-utm-url') || {}).value || '';
    var source = ($('yb-social-utm-source') || {}).value || '';
    var medium = ($('yb-social-utm-medium') || {}).value || '';
    var campaign = ($('yb-social-utm-campaign') || {}).value || '';
    var resultEl = $('yb-social-utm-result');
    if (!resultEl || !base) return;

    try {
      var url = new URL(base);
      if (source) url.searchParams.set('utm_source', source);
      if (medium) url.searchParams.set('utm_medium', medium);
      if (campaign) url.searchParams.set('utm_campaign', campaign);
      resultEl.value = url.toString();
    } catch (e) {
      resultEl.value = base;
    }
  }

  // Platform toggle changes
  document.addEventListener('change', function (e) {
    if (e.target.name === 'platform') {
      composer.platforms = [];
      document.querySelectorAll('.yb-social__composer-platforms input:checked').forEach(function (cb) {
        composer.platforms.push(cb.value);
      });
      updateCharCount();
      toggleFirstComment();
      toggleMediaTypeRow();
    }
    if (e.target.name === 'social-schedule') {
      var picker = $('yb-social-schedule-picker');
      if (picker) picker.hidden = (e.target.value !== 'schedule');
      if (e.target.value === 'queue') autoScheduleQueue();
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

  /* ═══ BEST TIME / QUEUE ═══ */
  var cachedBestTime = null;

  async function fetchBestTime() {
    S.toast('Analyzing best times...');
    try {
      var data = await S.api('social-analytics?action=best-times&days=90');
      if (data && data.bestHour !== undefined) {
        var hour = data.bestHour;
        var time = String(hour).padStart(2, '0') + ':00';
        $('yb-social-schedule-time').value = time;
        cachedBestTime = { hour: hour, day: data.bestDay };
        var dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][data.bestDay] || '';
        S.toast('Best time: ' + time + (dayName ? ' on ' + dayName : '') + ' (based on your engagement data)');
      } else {
        // Fallback
        $('yb-social-schedule-time').value = '10:00';
        S.toast('No engagement data yet — defaulting to 10:00');
      }
    } catch (err) {
      $('yb-social-schedule-time').value = '10:00';
      S.toast('Could not fetch best times — defaulting to 10:00');
    }
  }

  async function autoScheduleQueue() {
    // Find the next available best-time slot
    if (!cachedBestTime) {
      try {
        var data = await S.api('social-analytics?action=best-times&days=90');
        if (data && data.bestHour !== undefined) {
          cachedBestTime = { hour: data.bestHour, day: data.bestDay };
        }
      } catch (e) {}
    }

    var bestHour = cachedBestTime ? cachedBestTime.hour : 10;
    var bestDay = cachedBestTime ? cachedBestTime.day : null; // 0=Sun, 1=Mon...

    // Find next slot: start from tomorrow, find the next matching best day (or next day if no day preference)
    var now = new Date();
    var candidate = new Date(now);
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(bestHour, 0, 0, 0);

    // If we have a best day, find the next occurrence
    if (bestDay !== null) {
      while (candidate.getDay() !== bestDay) {
        candidate.setDate(candidate.getDate() + 1);
      }
    }

    // Check against existing scheduled posts to avoid collision
    if (S.state && S.state.posts) {
      var maxAttempts = 14;
      while (maxAttempts-- > 0) {
        var candidateISO = candidate.toISOString().split('T')[0];
        var collision = S.state.posts.some(function (p) {
          if (p.status !== 'scheduled' || !p.scheduledAt) return false;
          var pDate = p.scheduledAt._seconds ? new Date(p.scheduledAt._seconds * 1000) : new Date(p.scheduledAt);
          return pDate.toISOString().split('T')[0] === candidateISO;
        });
        if (!collision) break;
        candidate.setDate(candidate.getDate() + (bestDay !== null ? 7 : 1));
      }
    }

    // Set the date/time in the picker
    var dateStr = candidate.toISOString().split('T')[0];
    var timeStr = String(bestHour).padStart(2, '0') + ':00';
    $('yb-social-schedule-date').value = dateStr;
    $('yb-social-schedule-time').value = timeStr;

    // Show the picker briefly so user can see/adjust
    var picker = $('yb-social-schedule-picker');
    if (picker) picker.hidden = false;

    var dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    S.toast('Queued for ' + dayNames[candidate.getDay()] + ' ' + dateStr + ' at ' + timeStr);
  }

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
