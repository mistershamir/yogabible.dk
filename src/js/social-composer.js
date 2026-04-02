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
    uploadPlatform: 'general',  // tracks active platform for upload folder
    videoThumbnails: {},  // { videoUrl: thumbnailUrl }
    platformCaptions: {},  // { instagram: "...", facebook: "...", ... }
    captions: null,         // { utterances[], language, vtt, srt }
    captionStyle: { fontSize: 'medium', position: 'bottom', background: 'black-bar' },
    captionBurnActive: false
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

    // Hide nav and other views — composer is full-page
    var nav = document.querySelector('.yb-social__nav');
    if (nav) nav.style.display = 'none';
    var views = document.querySelectorAll('[id^="yb-social-v-"]');
    views.forEach(function (v) { if (!v.id.includes('composer')) v.style.display = 'none'; });

    // Reset form
    composer.postId = postId;
    composer.media = [];
    composer.mediaType = 'image';
    composer.videoUrl = '';
    composer.importedPermalink = '';
    composer.platforms = [];
    composer.platformCaptions = {};
    $('yb-social-post-id').value = postId || '';
    $('yb-social-caption').value = '';
    $('yb-social-hashtags').value = '';
    $('yb-social-first-comment').value = '';
    $('yb-social-location').value = '';
    if ($('yb-social-pillar')) $('yb-social-pillar').value = '';
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

    // Reset platform captions panel
    var pcPanel = $('yb-social-platform-captions');
    if (pcPanel) pcPanel.hidden = true;

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
    renderHashtagSuggestions();

    // If editing, load post data
    if (postId) loadPostForEdit(postId);

    // Update publish button text
    updatePublishBtn();
  };

  function closeComposer() {
    var modal = $('yb-social-composer');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    // Re-show the social panel content
    var panel = document.querySelector('.yb-social__nav');
    if (panel) panel.style.display = '';
    var views = document.querySelectorAll('[id^="yb-social-v-"]');
    views.forEach(function (v) { v.style.display = ''; });
  }

  async function loadPostForEdit(id) {
    var data = await S.api('social-posts?action=get&id=' + id);
    if (!data || !data.post) return;
    var p = data.post;

    $('yb-social-caption').value = p.caption || '';
    $('yb-social-hashtags').value = (p.hashtags || []).join(', ');
    $('yb-social-first-comment').value = p.firstComment || '';
    $('yb-social-location').value = p.location || '';
    if ($('yb-social-pillar')) $('yb-social-pillar').value = p.contentPillar || '';
    composer.media = p.media || [];
    composer.mediaType = p.mediaType || 'image';
    composer.videoUrl = p.videoUrl || '';
    composer.importedPermalink = p.importedPermalink || '';
    composer.platforms = p.platforms || [];
    composer.platformCaptions = p.platformCaptions || {};

    // Render platform captions if any exist
    renderPlatformCaptionTabs();

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
        var isVideoFile = url.match(/\.(mp4|mov|webm)$/i);
        var isVideoPost = composer.mediaType === 'video';
        if (isVideoFile) {
          mediaEl.innerHTML = '<video src="' + url + '" style="width:100%;max-height:300px" controls></video>';
        } else if (isVideoPost && composer.videoUrl) {
          // Reel/video with separate video URL — show video player with thumbnail poster
          mediaEl.innerHTML = '<video src="' + composer.videoUrl + '" poster="' + url + '" style="width:100%;max-height:300px" controls></video>';
        } else if (isVideoPost && composer.importedPermalink) {
          // Reel without playable URL — show thumbnail + link to view on platform
          mediaEl.innerHTML = '<div style="position:relative"><img src="' + url + '" alt="Preview" onerror="this.outerHTML=\'<p class=yb-admin__muted style=padding:40px;text-align:center>Image expired</p>\'">' +
            '<a href="' + composer.importedPermalink + '" target="_blank" style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;text-decoration:none">▶ View on platform</a></div>';
        } else {
          mediaEl.innerHTML = '<img src="' + url + '" alt="Preview" onerror="this.outerHTML=\'<p class=yb-admin__muted style=padding:40px;text-align:center>Image expired — re-upload media</p>\'">';
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

  /* ═══ MEDIA PREVIEW (in composer) — with carousel reorder + video thumbnails ═══ */
  function renderMediaPreview() {
    var container = $('yb-social-media-preview');
    if (!container) return;

    if (composer.media.length === 0) {
      container.innerHTML = '';
      toggleCarouselHint();
      toggleCaptionButton();
      return;
    }

    container.innerHTML = composer.media.map(function (url, i) {
      var isVideoFile = url.match(/\.(mp4|mov|webm)$/i);
      var isVideoPost = composer.mediaType === 'video';
      var thumbUrl = (composer.videoThumbnails && composer.videoThumbnails[url]) || '';
      return '<div class="yb-social__media-thumb' + (isVideoFile || isVideoPost ? ' is-video' : '') + '" draggable="true" data-media-index="' + i + '">' +
        (isVideoFile
          ? '<video src="' + url + '"></video>' +
            (thumbUrl ? '<img class="yb-social__video-thumb-overlay" src="' + thumbUrl + '" alt="Thumbnail">' : '') +
            '<button class="yb-social__video-thumb-btn" data-action="social-video-thumbnail" data-index="' + i + '" title="' + t('social_select_thumbnail') + '">🖼</button>'
          : '<img src="' + url + '" alt="" onerror="this.outerHTML=\'<span style=font-size:20px>📝</span>\'">' +
            (isVideoPost ? '<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:20px;background:rgba(0,0,0,0.5);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#fff">▶</span>' : '')) +
        '<span class="yb-social__media-thumb-index">' + (i + 1) + '</span>' +
        '<button class="yb-social__media-thumb-remove" data-action="social-remove-media" data-index="' + i + '">&times;</button>' +
        '</div>';
    }).join('');
    toggleMediaTypeRow();
    toggleCarouselHint();
    toggleCaptionButton();
    initDragReorder(container);
  }

  function toggleCarouselHint() {
    var hint = $('yb-social-carousel-hint');
    if (hint) hint.hidden = composer.media.length < 2;
  }

  // Drag-and-drop reorder for carousel slides
  function initDragReorder(container) {
    var thumbs = container.querySelectorAll('.yb-social__media-thumb');
    thumbs.forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', el.getAttribute('data-media-index'));
        el.classList.add('is-dragging');
      });
      el.addEventListener('dragend', function () { el.classList.remove('is-dragging'); });
      el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('is-drag-over'); });
      el.addEventListener('dragleave', function () { el.classList.remove('is-drag-over'); });
      el.addEventListener('drop', function (e) {
        e.preventDefault();
        el.classList.remove('is-drag-over');
        var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        var toIdx = parseInt(el.getAttribute('data-media-index'));
        if (fromIdx !== toIdx && !isNaN(fromIdx) && !isNaN(toIdx)) {
          var item = composer.media.splice(fromIdx, 1)[0];
          composer.media.splice(toIdx, 0, item);
          renderMediaPreview();
          updatePreview();
        }
      });
    });
  }

  // Video thumbnail — capture frame from video or upload custom
  function openVideoThumbnailPicker(index) {
    var url = composer.media[index];
    if (!url) return;

    // Create a temp video to extract frames
    var vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.src = url;

    vid.addEventListener('loadeddata', function () {
      var duration = vid.duration || 10;
      var frames = [];
      var times = [0, duration * 0.25, duration * 0.5, duration * 0.75];
      var captured = 0;

      times.forEach(function (time, fi) {
        vid.currentTime = time;
        vid.addEventListener('seeked', function onSeek() {
          var canvas = document.createElement('canvas');
          canvas.width = 320; canvas.height = 180;
          canvas.getContext('2d').drawImage(vid, 0, 0, 320, 180);
          frames.push({ time: Math.round(time), dataUrl: canvas.toDataURL('image/jpeg', 0.8) });
          captured++;
          if (captured === times.length) showThumbnailPicker(index, url, frames);
        }, { once: true });
      });
    });

    vid.addEventListener('error', function () {
      // Fallback: just offer upload
      showThumbnailPicker(index, url, []);
    });

    vid.load();
  }

  function showThumbnailPicker(mediaIndex, videoUrl, frames) {
    // Build modal
    var existing = $('yb-social-thumb-picker');
    if (existing) existing.remove();

    var html = '<div class="yb-social__thumb-picker" id="yb-social-thumb-picker">' +
      '<div class="yb-social__thumb-picker-overlay" data-action="social-thumb-picker-close"></div>' +
      '<div class="yb-social__thumb-picker-box">' +
      '<h4>' + t('social_select_thumbnail') + '</h4>';

    if (frames.length > 0) {
      html += '<p class="yb-admin__muted">' + t('social_thumb_pick_frame') + '</p>' +
        '<div class="yb-social__thumb-picker-frames">';
      frames.forEach(function (f, i) {
        html += '<img src="' + f.dataUrl + '" class="yb-social__thumb-picker-frame" data-action="social-thumb-pick-frame" data-index="' + mediaIndex + '" data-frame="' + i + '" alt="' + f.time + 's">';
      });
      html += '</div>';
    }

    html += '<div class="yb-social__thumb-picker-upload">' +
      '<p class="yb-admin__muted">' + t('social_thumb_or_upload') + '</p>' +
      '<input type="file" id="yb-social-thumb-file" accept="image/*" data-media-index="' + mediaIndex + '">' +
      '</div>' +
      '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-thumb-picker-close">' + t('social_cancel') + '</button>' +
      '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);

    // Listen for file upload
    var fileInput = $('yb-social-thumb-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          var reader = new FileReader();
          reader.onload = function (e) {
            setVideoThumbnail(mediaIndex, videoUrl, e.target.result);
            closeThumbnailPicker();
          };
          reader.readAsDataURL(fileInput.files[0]);
        }
      });
    }

    // Store frames data for pick action
    window._ybThumbFrames = frames;
  }

  function closeThumbnailPicker() {
    var el = $('yb-social-thumb-picker');
    if (el) el.remove();
    window._ybThumbFrames = null;
  }

  function pickThumbnailFrame(mediaIndex, frameIndex) {
    var frames = window._ybThumbFrames;
    if (!frames || !frames[frameIndex]) return;
    var videoUrl = composer.media[mediaIndex];
    setVideoThumbnail(mediaIndex, videoUrl, frames[frameIndex].dataUrl);
    closeThumbnailPicker();
  }

  function setVideoThumbnail(mediaIndex, videoUrl, dataUrl) {
    if (!composer.videoThumbnails) composer.videoThumbnails = {};
    composer.videoThumbnails[videoUrl] = dataUrl;
    renderMediaPreview();
    updatePreview();
    S.toast(t('social_thumb_set') || 'Thumbnail set');
  }

  /* ═══ HASHTAG PLATFORM LIMITS ═══ */
  var HASHTAG_LIMITS = {
    instagram: 5,
    tiktok: 5,
    facebook: 10,
    linkedin: 5,
    youtube: 15,
    pinterest: 20
  };

  function filterHashtagsForPlatforms(hashtags, platforms) {
    if (!hashtags.length || !platforms.length) return hashtags;
    // Find the strictest limit among selected platforms
    var minLimit = Infinity;
    platforms.forEach(function (p) {
      if (HASHTAG_LIMITS[p] && HASHTAG_LIMITS[p] < minLimit) minLimit = HASHTAG_LIMITS[p];
    });
    if (minLimit === Infinity || hashtags.length <= minLimit) return hashtags;
    // Keep only the first N hashtags (most relevant ones are usually first)
    return hashtags.slice(0, minLimit);
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

    // Auto-filter hashtags to platform limits
    if (hashtags.length > 0 && composer.platforms.length > 0) {
      var filtered = filterHashtagsForPlatforms(hashtags, composer.platforms);
      if (filtered.length < hashtags.length) {
        var minPlat = composer.platforms.reduce(function (best, p) {
          return (HASHTAG_LIMITS[p] || 999) < (HASHTAG_LIMITS[best] || 999) ? p : best;
        }, composer.platforms[0]);
        S.toast('Trimmed to ' + filtered.length + ' hashtags (' + minPlat + ' limit)');
        hashtags = filtered;
        // Update the field so user can see the change
        $('yb-social-hashtags').value = hashtags.join(', ');
      }
    }

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
      videoThumbnails: composer.videoThumbnails || {},
      contentPillar: ($('yb-social-pillar') || {}).value || '',
      platformCaptions: composer.platformCaptions || {},
      status: status === 'published' ? 'pending' : status
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
      S.toast('Publishing to ' + composer.platforms.join(', ') + '...');
      try {
        var pub = await S.api('social-publish', {
          method: 'POST', body: JSON.stringify({ postId: pid })
        });
        if (pub && pub.results) {
          // Check each platform result
          var failures = [];
          var successes = [];
          Object.keys(pub.results).forEach(function (platform) {
            if (pub.results[platform].success) {
              successes.push(platform);
            } else {
              failures.push(platform + ': ' + (pub.results[platform].error || 'unknown error'));
            }
          });
          if (successes.length > 0) S.toast('Published to ' + successes.join(', '));
          if (failures.length > 0) {
            failures.forEach(function (f) { S.toast('Failed — ' + f, true); });
          }
        } else if (pub && pub.error) {
          S.toast('Publish failed: ' + pub.error, true);
        } else {
          S.toast('Publish request sent');
        }
      } catch (e) {
        S.toast('Publish error: ' + e.message, true);
      }
    } else {
      S.toast(t('social_saved'));
    }

    closeComposer();
    S.loadPosts();
  }

  /* ═══ MEDIA BROWSER ═══ */
  var mediaBrowser = {
    tab: 'storage',       // 'storage' | 'videos'
    filter: 'all',        // 'all' | 'image' | 'video'
    streamVideos: null     // cached Bunny Stream video list
  };

  function openMediaBrowser() {
    var modal = $('yb-social-media-browser');
    if (!modal) return;
    modal.hidden = false;
    composer.mediaSelected = [];
    mediaBrowser.tab = 'storage';
    mediaBrowser.filter = 'all';
    switchMediaTab('storage');
    composer.currentPath = 'yoga-bible-DK';
    loadMediaFolder(composer.currentPath);
    // Wire storage upload input — use addEventListener to avoid overwrite issues
    var uploadInput = $('yb-social-media-upload-input');
    if (uploadInput) {
      // Clone and replace to remove any old listeners
      var newInput = uploadInput.cloneNode(true);
      uploadInput.parentNode.replaceChild(newInput, uploadInput);
      newInput.addEventListener('change', function () {
        console.log('[MediaBrowser] Upload input changed, files:', newInput.files.length);
        if (newInput.files.length > 0) uploadFromBrowser(newInput.files);
        newInput.value = '';
      });
    }
    // Wire video upload input (Bunny Stream via TUS)
    var videoUploadInput = $('yb-social-media-video-upload-input');
    if (videoUploadInput) {
      videoUploadInput.onchange = function () {
        if (videoUploadInput.files.length > 0) uploadVideoToStream(videoUploadInput.files[0]);
        videoUploadInput.value = '';
      };
    }
  }

  function closeMediaBrowser() {
    var modal = $('yb-social-media-browser');
    if (modal) modal.hidden = true;
  }

  function switchMediaTab(tab) {
    mediaBrowser.tab = tab;
    document.querySelectorAll('.yb-social__media-modal-tabs button').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tab);
    });
    var storageToolbar = $('yb-social-media-toolbar');
    var videosToolbar = $('yb-social-media-videos-toolbar');
    if (storageToolbar) storageToolbar.hidden = (tab !== 'storage');
    if (videosToolbar) videosToolbar.hidden = (tab !== 'videos');
    if (tab === 'storage') {
      loadMediaFolder(composer.currentPath || 'yoga-bible-DK');
    } else {
      loadStreamVideos();
    }
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
        if (i > 0) html += '<span style="margin:0 2px;color:#ccc;">/</span>';
        var isLast = i === parts.length - 1;
        html += '<button data-action="social-media-nav" data-path="' + subPath + '" style="' + (isLast ? 'color:#0F0F0F;' : '') + '">' + part + '</button>';
      });
      breadcrumb.innerHTML = html;
    }

    var token = await S.getToken();
    if (!token) return;

    try {
      var results = await Promise.all([
        fetch('/.netlify/functions/bunny-browser?action=folders&path=' + encodeURIComponent(path), {
          headers: { Authorization: 'Bearer ' + token }
        }).then(function (r) { return r.json(); }).catch(function (e) { return { ok: false, folders: [], error: e.message }; }),
        fetch('/.netlify/functions/bunny-browser?action=resources&path=' + encodeURIComponent(path), {
          headers: { Authorization: 'Bearer ' + token }
        }).then(function (r) { return r.json(); }).catch(function (e) { return { ok: false, resources: [], error: e.message }; })
      ]);
    } catch (err) {
      grid.innerHTML = '<p class="yb-admin__muted">Error loading folder: ' + err.message + '</p>';
      return;
    }

    var foldersData = results[0];
    var filesData = results[1];

    // Debug: log API responses
    console.log('[MediaBrowser] Path:', path, 'Folders:', foldersData, 'Files:', filesData);
    var filterType = mediaBrowser.filter;
    var html = '';
    var folderIcon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

    // Folders
    (foldersData.folders || []).forEach(function (f) {
      html += '<div class="yb-social__media-folder" data-action="social-media-open-folder" data-path="' + f.path + '">' +
        folderIcon + '<span>' + f.name + '</span></div>';
    });

    // Files (images/videos)
    (filesData.resources || []).forEach(function (r) {
      if (filterType !== 'all' && r.resource_type !== filterType) return;
      var url = r.secure_url || ('https://yogabible.b-cdn.net/' + path + '/' + r.display_name);
      var isSelected = composer.mediaSelected.indexOf(url) >= 0;
      if (r.resource_type === 'image') {
        html += '<div class="yb-social__media-item' + (isSelected ? ' is-selected' : '') + '" data-action="social-media-toggle" data-url="' + url + '">' +
          '<img src="' + url + '?width=200" alt="" loading="lazy">' +
          '<span class="yb-social__media-item-label">' + (r.display_name || '') + '</span>' +
          '</div>';
      } else if (r.resource_type === 'video') {
        // Video thumbnail: use first frame or poster
        html += '<div class="yb-social__media-item' + (isSelected ? ' is-selected' : '') + '" data-action="social-media-toggle" data-url="' + url + '">' +
          '<video src="' + url + '" muted preload="metadata" style="width:100%;height:100%;object-fit:cover;"></video>' +
          '<span class="yb-social__media-item-badge yb-social__media-item-badge--video">MP4</span>' +
          '<span class="yb-social__media-item-label">' + (r.display_name || '') + '</span>' +
          '</div>';
      }
    });

    if (!html) html = '<p class="yb-admin__muted">No files in this folder.</p>';
    grid.innerHTML = html;
    updateMediaSelectedCount();
  }

  // Load Bunny Stream transcoded videos
  async function loadStreamVideos() {
    var grid = $('yb-social-media-grid');
    if (!grid) return;
    grid.innerHTML = '<p class="yb-admin__muted">Loading videos...</p>';

    var token = await S.getToken();
    if (!token) return;

    try {
      var res = await fetch('/.netlify/functions/social-media-upload?action=list', {
        headers: { Authorization: 'Bearer ' + token }
      });
      var data = await res.json();
      mediaBrowser.streamVideos = data.videos || [];
    } catch (err) {
      grid.innerHTML = '<p class="yb-admin__muted">Error loading videos.</p>';
      return;
    }

    var html = '';
    var CDN = 'https://vz-4f2e2677-3b6.b-cdn.net';

    console.log('[MediaBrowser] Stream videos:', mediaBrowser.streamVideos);

    mediaBrowser.streamVideos.forEach(function (v) {
      var thumbUrl = v.thumbnailUrl || (CDN + '/' + v.videoId + '/thumbnail.jpg');
      var videoUrl = v.mp4Url || (CDN + '/' + v.videoId + '/play_720p.mp4');
      var isSelected = composer.mediaSelected.indexOf(videoUrl) >= 0;
      var statusBadge = v.status === 'ready' ? 'Ready' : (v.status || 'unknown');
      var badgeClass = v.status === 'ready' ? 'yb-social__media-item-badge--stream' : 'yb-social__media-item-badge--video';
      html += '<div class="yb-social__media-item' + (isSelected ? ' is-selected' : '') + (v.status !== 'ready' ? ' style="opacity:0.5;"' : '') + '" ' +
        (v.status === 'ready' ? 'data-action="social-media-toggle" data-url="' + videoUrl + '"' : '') + '>' +
        '<img src="' + thumbUrl + '" alt="" loading="lazy" onerror="this.style.display=\'none\'" style="width:100%;height:100%;object-fit:cover;">' +
        '<span class="yb-social__media-item-badge ' + badgeClass + '">' + statusBadge + '</span>' +
        '<span class="yb-social__media-item-label">' + (v.title || 'Untitled') + '</span>' +
        '</div>';
    });

    if (!html) html = '<p class="yb-admin__muted">No videos found. Upload videos in the Library tab first.</p>';
    grid.innerHTML = html;
    updateMediaSelectedCount();
  }

  // Upload files via Netlify proxy (avoids CORS issues with direct Bunny PUT)
  async function uploadFromBrowser(files) {
    if (!files || files.length === 0) return;
    var folder = composer.currentPath;
    var token = await S.getToken();
    if (!token) { S.toast('Auth failed', true); return; }

    var success = 0;
    var total = files.length;

    for (var i = 0; i < total; i++) {
      var file = files[i];
      // For large files (>4MB), use Videos tab TUS upload
      if (file.size > 4 * 1024 * 1024) {
        S.toast(file.name + ' is too large for Storage upload (' + Math.round(file.size/1024/1024) + ' MB). Use Videos tab for large files.', true);
        continue;
      }

      S.toast('Uploading ' + (i + 1) + '/' + total + ': ' + file.name + '...');
      var ts = Date.now();
      var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var fileName = ts + '-' + safeName;

      try {
        // Read file as ArrayBuffer and send as raw binary
        var arrayBuffer = await file.arrayBuffer();
        var uploadRes = await fetch(
          '/.netlify/functions/bunny-browser?action=upload&folder=' + encodeURIComponent(folder) +
          '&fileName=' + encodeURIComponent(fileName) +
          '&contentType=' + encodeURIComponent(file.type || 'application/octet-stream'),
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/octet-stream'
            },
            body: arrayBuffer
          }
        );
        var result = await uploadRes.json();
        console.log('[MediaBrowser] Upload result:', result);
        if (result.ok) {
          success++;
          S.toast('Uploaded ' + file.name);
        } else {
          console.error('[MediaBrowser] Upload failed:', result.error);
          S.toast('Failed: ' + (result.error || 'unknown'), true);
        }
      } catch (e) {
        console.error('[MediaBrowser] Upload error:', e.message);
        S.toast('Upload error: ' + e.message, true);
      }
    }

    if (success > 0) S.toast(success + '/' + total + ' uploaded');
    loadMediaFolder(composer.currentPath);
  }

  // Upload video to Bunny Stream via TUS (for large video files)
  async function uploadVideoToStream(file) {
    if (!file) return;
    S.toast('Creating video entry...');

    var token = await S.getToken();
    if (!token) { S.toast('Auth failed', true); return; }

    // 1. Create video entry in Bunny Stream
    try {
      var createRes = await fetch('/.netlify/functions/social-media-upload', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'create-video', title: file.name.replace(/\.[^.]+$/, '') })
      });
      var creds = await createRes.json();
      if (!creds.ok) {
        S.toast('Failed to create video: ' + (creds.error || 'unknown'), true);
        return;
      }
    } catch (e) {
      S.toast('Create video error: ' + e.message, true);
      return;
    }

    // 2. Upload via TUS
    if (typeof tus === 'undefined') {
      S.toast('TUS library not loaded. Refresh page.', true);
      return;
    }

    S.toast('Uploading video via TUS...');
    var grid = $('yb-social-media-grid');
    if (grid) grid.innerHTML = '<p class="yb-admin__muted">Uploading: 0%...</p>';

    var upload = new tus.Upload(file, {
      endpoint: creds.tusUploadUrl,
      retryDelays: [0, 1000, 3000, 5000],
      chunkSize: 5 * 1024 * 1024,
      headers: {
        AuthorizationSignature: creds.authSignature,
        AuthorizationExpire: creds.authExpiration.toString(),
        VideoId: creds.videoId,
        LibraryId: creds.libraryId
      },
      metadata: { filetype: file.type, title: file.name.replace(/\.[^.]+$/, '') },
      onError: function (error) {
        S.toast('Upload failed: ' + (error.message || error), true);
        loadStreamVideos();
      },
      onProgress: function (bytesUploaded, bytesTotal) {
        var pct = Math.round((bytesUploaded / bytesTotal) * 100);
        if (grid) grid.innerHTML = '<p class="yb-admin__muted">Uploading: ' + pct + '%...</p>';
      },
      onSuccess: function () {
        S.toast('Video uploaded! Transcoding in progress...');
        // Poll until video is ready
        setTimeout(function () { loadStreamVideos(); }, 3000);
      }
    });

    upload.findPreviousUploads().then(function (prev) {
      if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  }

  function toggleMediaSelection(url) {
    var idx = composer.mediaSelected.indexOf(url);
    if (idx >= 0) {
      composer.mediaSelected.splice(idx, 1);
    } else {
      composer.mediaSelected.push(url);
    }
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
    S.toast('Uploading ' + files.length + ' file(s)...');
    var token = await S.getToken();
    if (!token) { S.toast('Auth failed — please log in again', true); return; }

    // Determine upload folder based on selected platform(s)
    var now = new Date();
    var yearMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var platformFolder = composer.platforms.length === 1 ? composer.platforms[0] : 'general';
    var folder = 'yoga-bible-DK/social/' + platformFolder + '/' + yearMonth;
    var signRes;
    try {
      signRes = await fetch('/.netlify/functions/bunny-browser?action=sign_upload&folder=' + encodeURIComponent(folder), {
        headers: { Authorization: 'Bearer ' + token }
      });
    } catch (fetchErr) {
      S.toast('Upload sign request failed: ' + fetchErr.message, true);
      return;
    }
    if (!signRes.ok) {
      S.toast('Upload sign error (' + signRes.status + ')', true);
      return;
    }
    var signData;
    try {
      signData = await signRes.json();
    } catch (jsonErr) {
      S.toast('Upload sign response invalid', true);
      return;
    }
    if (!signData.ok) { S.toast('Upload error: ' + (signData.error || 'unknown'), true); return; }

    var params = signData.upload_params;

    // Show upload preview with progress
    var previewContainer = $('yb-social-upload-preview');
    if (!previewContainer) {
      var drop = $('yb-social-media-drop');
      if (drop) {
        drop.insertAdjacentHTML('afterend', '<div class="yb-social__upload-preview" id="yb-social-upload-preview"></div>');
        previewContainer = $('yb-social-upload-preview');
      }
    }

    // Build preview items
    if (previewContainer) {
      var previewHtml = '';
      for (var p = 0; p < files.length; p++) {
        var f = files[p];
        var isVid = f.type.startsWith('video/');
        previewHtml += '<div class="yb-social__upload-item" id="yb-upload-item-' + p + '">' +
          (isVid ? '<video src="' + URL.createObjectURL(f) + '" muted></video>'
                 : '<img src="' + URL.createObjectURL(f) + '" alt="">') +
          '<div class="yb-social__upload-item-bar"><div class="yb-social__upload-item-fill" id="yb-upload-fill-' + p + '" style="width:0%"></div></div>' +
          '<span class="yb-social__upload-item-pct" id="yb-upload-pct-' + p + '">0%</span>' +
          '</div>';
      }
      previewContainer.innerHTML = previewHtml;
    }

    for (var i = 0; i < files.length; i++) {
      var file = files[i];

      var fileName = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '');
      var uploadUrl = params.upload_url + fileName;

      // Upload with XHR to track progress
      await new Promise(function (resolve) {
        var idx = i;
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('AccessKey', params.headers.AccessKey);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.addEventListener('progress', function (e) {
          if (e.lengthComputable) {
            var pct = Math.round((e.loaded / e.total) * 100);
            var fillEl = $('yb-upload-fill-' + idx);
            var pctEl = $('yb-upload-pct-' + idx);
            if (fillEl) fillEl.style.width = pct + '%';
            if (pctEl) pctEl.textContent = pct + '%';
          }
        });
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            var pctEl = $('yb-upload-pct-' + idx);
            if (pctEl) pctEl.textContent = '✓';
          } else {
            S.toast('Upload failed (' + xhr.status + '): ' + file.name, true);
            var pctEl2 = $('yb-upload-pct-' + idx);
            if (pctEl2) pctEl2.textContent = '✗';
            // Mark this file as failed so we skip adding its URL
            file._uploadFailed = true;
          }
          resolve();
        };
        xhr.onerror = function () {
          S.toast('Upload failed: ' + file.name, true);
          var pctEl3 = $('yb-upload-pct-' + idx);
          if (pctEl3) pctEl3.textContent = '✗';
          file._uploadFailed = true;
          resolve();
        };
        xhr.send(file);
      });

      // Only add to media list if upload actually succeeded
      if (!file._uploadFailed) {
        var cdnUrl = params.cdn_base + fileName;
        composer.media.push(cdnUrl);
      }
    }

    // Count successful uploads
    var successCount = 0;
    var failCount = 0;
    for (var j = 0; j < files.length; j++) {
      if (files[j]._uploadFailed) failCount++;
      else successCount++;
    }

    // Clean up progress preview after a delay
    if (previewContainer) {
      setTimeout(function () { previewContainer.remove(); }, failCount > 0 ? 4000 : 1500);
    }

    if (successCount > 0) {
      S.toast('Uploaded ' + successCount + ' file(s)' + (failCount > 0 ? ', ' + failCount + ' failed' : ''));
    } else if (failCount > 0) {
      S.toast('All ' + failCount + ' upload(s) failed — check Bunny CDN connection', true);
    }
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

  // Auto-suggest top-performing hashtags below the hashtag field
  function renderHashtagSuggestions() {
    var container = $('yb-social-hashtag-suggest');
    if (!container) return;
    var topTags = window._ybTopHashtags;
    if (!topTags || topTags.length === 0) { container.hidden = true; return; }
    container.hidden = false;
    container.innerHTML = '<span class="yb-social__suggest-label">🔥 ' + t('social_top_hashtags') + ':</span> ' +
      topTags.slice(0, 8).map(function (tag) {
        return '<button type="button" class="yb-social__suggest-tag" data-action="social-insert-hashtag" data-tag="' + tag + '">' + tag + '</button>';
      }).join('');
  }

  function insertHashtag(tag) {
    var field = $('yb-social-hashtags');
    if (!field) return;
    var current = field.value.trim();
    if (current && current.indexOf(tag) >= 0) return; // Already there
    field.value = current ? current + ', ' + tag : tag;
    updatePreview();
  }

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

  /* ═══ VIDEO CAPTIONS ═══ */

  function hasVideoMedia() {
    return composer.media.some(function (url) { return /\.(mp4|mov|webm)$/i.test(url); });
  }

  function getFirstVideoUrl() {
    return composer.media.find(function (url) { return /\.(mp4|mov|webm)$/i.test(url); }) || '';
  }

  function toggleCaptionButton() {
    var btn = $('yb-social-caption-btn');
    if (btn) btn.hidden = !hasVideoMedia();
  }

  async function transcribeVideo() {
    var videoUrl = getFirstVideoUrl();
    if (!videoUrl) return;
    if (!S) return;

    var panel = $('yb-social-caption-panel');
    var loader = $('yb-social-caption-loader');
    var editor = $('yb-social-caption-editor');
    if (panel) panel.hidden = false;
    if (loader) loader.hidden = false;
    if (editor) editor.hidden = true;

    try {
      var data = await S.api('social-captions', {
        method: 'POST',
        body: JSON.stringify({ action: 'transcribe', videoUrl: videoUrl })
      });

      if (loader) loader.hidden = true;

      if (data && data.ok) {
        composer.captions = {
          utterances: data.utterances || [],
          language: data.language || 'unknown',
          vtt: data.vtt || '',
          srt: data.srt || ''
        };
        renderCaptionEditor();
      } else {
        throw new Error((data && data.error) || 'Transcription failed');
      }
    } catch (err) {
      if (loader) loader.hidden = true;
      S.toast('Caption error: ' + err.message, true);
      console.error('[composer] transcribe error:', err);
    }
  }

  function renderCaptionEditor() {
    var editor = $('yb-social-caption-editor');
    if (!editor || !composer.captions) return;
    editor.hidden = false;

    var c = composer.captions;
    var html = '';

    // Language badge
    html += '<div class="yb-social__caption-header">';
    html += '<span class="yb-social__caption-lang-badge">' + (c.language || 'auto').toUpperCase() + '</span>';
    html += '<span class="yb-social__caption-count">' + c.utterances.length + ' segments</span>';
    html += '</div>';

    // Utterance list (editable)
    html += '<div class="yb-social__caption-utterances" id="yb-social-caption-utterances">';
    c.utterances.forEach(function (u, i) {
      var startFmt = formatTimestamp(u.start);
      var endFmt = formatTimestamp(u.end);
      html += '<div class="yb-social__caption-utterance">';
      html += '<span class="yb-social__caption-time">' + startFmt + ' → ' + endFmt + '</span>';
      html += '<textarea class="yb-social__caption-text" data-caption-idx="' + i + '" rows="2">' + escapeHtml(u.text) + '</textarea>';
      html += '</div>';
    });
    html += '</div>';

    // Controls row
    html += '<div class="yb-social__caption-controls">';

    // Translate dropdown
    html += '<div class="yb-social__caption-translate">';
    html += '<select id="yb-social-caption-translate-lang">';
    html += '<option value="">Translate to...</option>';
    html += '<option value="da">Danish</option>';
    html += '<option value="en">English</option>';
    html += '<option value="de">German</option>';
    html += '<option value="sv">Swedish</option>';
    html += '<option value="no">Norwegian</option>';
    html += '</select>';
    html += '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-caption-translate">Translate</button>';
    html += '</div>';

    // Style options
    html += '<div class="yb-social__caption-style">';
    html += '<select id="yb-social-caption-fontsize" data-caption-style="fontSize">';
    html += '<option value="small"' + (composer.captionStyle.fontSize === 'small' ? ' selected' : '') + '>Small</option>';
    html += '<option value="medium"' + (composer.captionStyle.fontSize === 'medium' ? ' selected' : '') + '>Medium</option>';
    html += '<option value="large"' + (composer.captionStyle.fontSize === 'large' ? ' selected' : '') + '>Large</option>';
    html += '</select>';

    html += '<select id="yb-social-caption-position" data-caption-style="position">';
    html += '<option value="top"' + (composer.captionStyle.position === 'top' ? ' selected' : '') + '>Top</option>';
    html += '<option value="center"' + (composer.captionStyle.position === 'center' ? ' selected' : '') + '>Center</option>';
    html += '<option value="bottom"' + (composer.captionStyle.position === 'bottom' ? ' selected' : '') + '>Bottom</option>';
    html += '</select>';

    html += '<select id="yb-social-caption-bg" data-caption-style="background">';
    html += '<option value="none"' + (composer.captionStyle.background === 'none' ? ' selected' : '') + '>No BG</option>';
    html += '<option value="black-bar"' + (composer.captionStyle.background === 'black-bar' ? ' selected' : '') + '>Black Bar</option>';
    html += '<option value="blur"' + (composer.captionStyle.background === 'blur' ? ' selected' : '') + '>Blur</option>';
    html += '</select>';
    html += '</div>';

    html += '</div>';

    // Action buttons
    html += '<div class="yb-social__caption-actions">';
    html += '<label class="yb-social__caption-burn-toggle"><input type="checkbox" id="yb-social-caption-burn"' + (composer.captionBurnActive ? ' checked' : '') + '> Burn into preview</label>';
    html += '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-caption-download-srt">Download SRT</button>';
    html += '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-caption-download-vtt">Download VTT</button>';
    html += '</div>';

    editor.innerHTML = html;
  }

  function formatTimestamp(seconds) {
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    var ms = Math.round((seconds % 1) * 10);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + ms;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function updateUtteranceText(idx, text) {
    if (!composer.captions || !composer.captions.utterances[idx]) return;
    composer.captions.utterances[idx].text = text;
    // Regenerate VTT/SRT
    regenerateCaptionFormats();
  }

  function regenerateCaptionFormats() {
    if (!composer.captions) return;
    var utts = composer.captions.utterances;
    var vtt = 'WEBVTT\n\n';
    var srt = '';
    utts.forEach(function (u, i) {
      var s = fmtVttTime(u.start);
      var e = fmtVttTime(u.end);
      vtt += (i + 1) + '\n' + s + ' --> ' + e + '\n' + u.text + '\n\n';
      srt += (i + 1) + '\n' + s.replace('.', ',') + ' --> ' + e.replace('.', ',') + '\n' + u.text + '\n\n';
    });
    composer.captions.vtt = vtt;
    composer.captions.srt = srt;
  }

  function fmtVttTime(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    var ms = Math.round((sec % 1) * 1000);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  }

  async function translateCaptions() {
    var langSelect = $('yb-social-caption-translate-lang');
    if (!langSelect || !langSelect.value) { S.toast('Select a language'); return; }
    if (!composer.captions) return;

    var targetLang = langSelect.value;
    var allText = composer.captions.utterances.map(function (u) { return u.text; }).join('\n---\n');

    S.toast('Translating...');

    try {
      var data = await S.api('social-captions', {
        method: 'POST',
        body: JSON.stringify({ action: 'translate', text: allText, targetLang: targetLang })
      });

      if (data && data.ok && data.translated) {
        var parts = data.translated.split(/\n---\n/);
        composer.captions.utterances.forEach(function (u, i) {
          if (parts[i]) u.text = parts[i].trim();
        });
        composer.captions.language = targetLang;
        regenerateCaptionFormats();
        renderCaptionEditor();
        S.toast('Translated to ' + targetLang.toUpperCase());
      }
    } catch (err) {
      S.toast('Translation failed: ' + err.message, true);
    }
  }

  function downloadCaptionFile(format) {
    if (!composer.captions) return;
    var content = format === 'srt' ? composer.captions.srt : composer.captions.vtt;
    var ext = format === 'srt' ? 'srt' : 'vtt';
    var blob = new Blob([content], { type: 'text/plain' });
    var link = document.createElement('a');
    link.download = 'captions-' + Date.now() + '.' + ext;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // Caption burn overlay on preview video
  function toggleCaptionBurn(active) {
    composer.captionBurnActive = active;
    if (active) {
      setupCaptionOverlay();
    } else {
      removeCaptionOverlay();
    }
  }

  function setupCaptionOverlay() {
    var mediaEl = $('yb-social-preview-media');
    if (!mediaEl) return;
    var video = mediaEl.querySelector('video');
    if (!video || !composer.captions) return;

    // Remove old overlay
    removeCaptionOverlay();

    // Create overlay container
    var overlay = document.createElement('div');
    overlay.id = 'yb-social-caption-overlay';
    overlay.className = 'yb-social__caption-overlay';

    var sub = document.createElement('div');
    sub.id = 'yb-social-caption-sub';
    sub.className = 'yb-social__caption-sub';

    // Apply style
    var sty = composer.captionStyle;
    sub.classList.add('yb-social__caption-sub--' + sty.position);
    sub.classList.add('yb-social__caption-sub--' + sty.background);
    sub.classList.add('yb-social__caption-sub--' + sty.fontSize);

    overlay.appendChild(sub);

    // Wrap video in a relative container if not already
    var wrapper = mediaEl.querySelector('.yb-social__caption-video-wrap');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'yb-social__caption-video-wrap';
      video.parentNode.insertBefore(wrapper, video);
      wrapper.appendChild(video);
    }
    wrapper.appendChild(overlay);

    // Sync captions to video timeupdate
    video._captionHandler = function () {
      var t = video.currentTime;
      var utt = composer.captions.utterances.find(function (u) {
        return t >= u.start && t <= u.end;
      });
      sub.textContent = utt ? utt.text : '';
      sub.style.opacity = utt ? '1' : '0';
    };
    video.addEventListener('timeupdate', video._captionHandler);
  }

  function removeCaptionOverlay() {
    var overlay = document.getElementById('yb-social-caption-overlay');
    if (overlay) overlay.remove();

    // Clean up event listener
    var mediaEl = $('yb-social-preview-media');
    if (mediaEl) {
      var video = mediaEl.querySelector('video');
      if (video && video._captionHandler) {
        video.removeEventListener('timeupdate', video._captionHandler);
        delete video._captionHandler;
      }
    }
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

    // Canva Design Studio
    else if (action === 'social-canva-composer') {
      if (window._ybSocialCanva) {
        window._ybSocialCanva.openStudio(composer.postId);
      }
    }

    // Fabric.js Design Studio
    else if (action === 'social-design-studio') {
      if (window._ybSocialDesign) {
        window._ybSocialDesign.openStudio(composer.postId);
      }
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

    // Video thumbnail picker
    else if (action === 'social-video-thumbnail') openVideoThumbnailPicker(parseInt(btn.getAttribute('data-index')));
    else if (action === 'social-thumb-picker-close') closeThumbnailPicker();
    else if (action === 'social-thumb-pick-frame') {
      pickThumbnailFrame(parseInt(btn.getAttribute('data-index')), parseInt(btn.getAttribute('data-frame')));
    }

    // Video captions
    else if (action === 'social-caption-transcribe') transcribeVideo();
    else if (action === 'social-caption-translate') translateCaptions();
    else if (action === 'social-caption-download-srt') downloadCaptionFile('srt');
    else if (action === 'social-caption-download-vtt') downloadCaptionFile('vtt');
    else if (action === 'social-caption-close') {
      var cp = $('yb-social-caption-panel');
      if (cp) cp.hidden = true;
      removeCaptionOverlay();
    }

    // Media browser
    else if (action === 'social-media-browser-close') closeMediaBrowser();
    else if (action === 'social-media-open-folder') loadMediaFolder(btn.getAttribute('data-path'));
    else if (action === 'social-media-nav') loadMediaFolder(btn.getAttribute('data-path'));
    else if (action === 'social-media-nav-root') loadMediaFolder('yoga-bible-DK');
    else if (action === 'social-media-toggle') toggleMediaSelection(btn.getAttribute('data-url'));
    else if (action === 'social-media-confirm') confirmMediaSelection();
    else if (action === 'social-media-tab') switchMediaTab(btn.getAttribute('data-tab'));
    else if (action === 'social-media-filter-change') {
      mediaBrowser.filter = btn.value || 'all';
      loadMediaFolder(composer.currentPath);
    }

    // AI
    // Hashtag auto-suggest
    else if (action === 'social-insert-hashtag') insertHashtag(btn.getAttribute('data-tag'));

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

    // Platform captions
    else if (action === 'social-platform-captions-toggle') togglePlatformCaptions();
    else if (action === 'social-platform-cap-tab') switchPlatformCaptionTab(btn.getAttribute('data-platform'));
    else if (action === 'social-platform-cap-copy-main') {
      var textarea = $('yb-social-platform-caption-text');
      if (textarea) {
        textarea.value = ($('yb-social-caption') || {}).value || '';
        textarea.dispatchEvent(new Event('input'));
      }
    }
    else if (action === 'social-platform-cap-ai') aiAdaptPlatformCaption();
    else if (action === 'social-platform-cap-ai-all') aiAdaptAllPlatforms();
    else if (action === 'social-platform-cap-clear') {
      delete composer.platformCaptions[activePlatformTab];
      renderPlatformCaptionTabs();
      S.toast('Cleared');
    }

    // Smart Queue
    else if (action === 'social-smart-schedule') smartSchedulePost();

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

    // Caption utterance editing
    if (e.target.hasAttribute('data-caption-idx')) {
      updateUtteranceText(parseInt(e.target.getAttribute('data-caption-idx')), e.target.value);
    }

    // UTM builder auto-generate
    if (e.target.id === 'yb-social-utm-url' || e.target.id === 'yb-social-utm-source' ||
        e.target.id === 'yb-social-utm-medium' || e.target.id === 'yb-social-utm-campaign') {
      buildUtmUrl();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'yb-social-utm-source') buildUtmUrl();
    if (e.target.id === 'yb-social-media-filter') {
      mediaBrowser.filter = e.target.value || 'all';
      loadMediaFolder(composer.currentPath);
    }
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
      // Refresh platform caption tabs if panel is open
      var pcPanel = $('yb-social-platform-captions');
      if (pcPanel && !pcPanel.hidden) renderPlatformCaptionTabs();
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
    // Caption style selects
    if (e.target.hasAttribute('data-caption-style')) {
      composer.captionStyle[e.target.getAttribute('data-caption-style')] = e.target.value;
      if (composer.captionBurnActive) { removeCaptionOverlay(); setupCaptionOverlay(); }
    }
    // Caption burn toggle
    if (e.target.id === 'yb-social-caption-burn') {
      toggleCaptionBurn(e.target.checked);
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

  /* ═══ PLATFORM-SPECIFIC CAPTIONS ═══ */
  var activePlatformTab = null;

  function togglePlatformCaptions() {
    var panel = $('yb-social-platform-captions');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderPlatformCaptionTabs();
  }

  function renderPlatformCaptionTabs() {
    var container = $('yb-social-platform-caption-tabs');
    var body = $('yb-social-platform-caption-body');
    if (!container || !body) return;

    if (composer.platforms.length === 0) {
      container.innerHTML = '<p class="yb-admin__muted">Select platforms first</p>';
      body.innerHTML = '';
      return;
    }

    var icons = { instagram: '📸 IG', facebook: '👤 FB', tiktok: '🎵 TT', linkedin: '💼 LI', youtube: '▶️ YT', pinterest: '📌 PIN' };

    container.innerHTML = composer.platforms.map(function (p) {
      var has = composer.platformCaptions[p] ? ' has-caption' : '';
      var active = activePlatformTab === p ? ' is-active' : '';
      return '<button type="button" class="yb-social__platform-cap-tab' + has + active + '" data-action="social-platform-cap-tab" data-platform="' + p + '">' +
        (icons[p] || p) +
        (composer.platformCaptions[p] ? ' ✓' : '') +
        '</button>';
    }).join('');

    if (!activePlatformTab || composer.platforms.indexOf(activePlatformTab) < 0) {
      activePlatformTab = composer.platforms[0];
    }

    // Highlight active tab
    container.querySelectorAll('.yb-social__platform-cap-tab').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.getAttribute('data-platform') === activePlatformTab);
    });

    // Show textarea for active platform
    var currentCaption = composer.platformCaptions[activePlatformTab] || '';
    var mainCaption = ($('yb-social-caption') || {}).value || '';
    var limit = CHAR_LIMITS[activePlatformTab] || 2200;

    body.innerHTML =
      '<div class="yb-social__platform-cap-editor">' +
        '<div class="yb-social__platform-cap-info">' +
          '<span class="yb-admin__muted">Override caption for ' + activePlatformTab + ' (leave blank to use main caption)</span>' +
          '<span id="yb-social-platform-char-count" style="font-size:11px;color:#6F6A66">' + (currentCaption || mainCaption).length + ' / ' + limit + '</span>' +
        '</div>' +
        '<textarea id="yb-social-platform-caption-text" rows="4" placeholder="Platform-specific caption...">' + escapeHtml(currentCaption) + '</textarea>' +
        '<div class="yb-social__platform-cap-actions">' +
          '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-platform-cap-copy-main">Copy Main Caption</button>' +
          '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-platform-cap-ai">AI Adapt</button>' +
          '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="social-platform-cap-clear">Clear</button>' +
        '</div>' +
      '</div>';

    // Listen for changes
    var textarea = $('yb-social-platform-caption-text');
    if (textarea) {
      textarea.addEventListener('input', function () {
        composer.platformCaptions[activePlatformTab] = textarea.value.trim() || undefined;
        if (!textarea.value.trim()) delete composer.platformCaptions[activePlatformTab];
        var countEl = $('yb-social-platform-char-count');
        if (countEl) countEl.textContent = (textarea.value || mainCaption).length + ' / ' + limit;
        // Update tab indicator
        renderPlatformCaptionTabs();
      });
    }
  }

  function switchPlatformCaptionTab(platform) {
    activePlatformTab = platform;
    renderPlatformCaptionTabs();
  }

  async function aiAdaptPlatformCaption() {
    var caption = ($('yb-social-caption') || {}).value || '';
    if (!caption) { S.toast('Write a main caption first', true); return; }

    S.toast('Adapting for ' + activePlatformTab + '...');

    var data = await S.api('social-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'platform-captions',
        caption: caption,
        platforms: [activePlatformTab]
      })
    });

    if (data && data.captions && data.captions[activePlatformTab]) {
      var adapted = data.captions[activePlatformTab];
      composer.platformCaptions[activePlatformTab] = adapted.caption || '';
      renderPlatformCaptionTabs();
      S.toast('Adapted for ' + activePlatformTab);
    }
  }

  async function aiAdaptAllPlatforms() {
    var caption = ($('yb-social-caption') || {}).value || '';
    if (!caption) { S.toast('Write a main caption first', true); return; }
    if (composer.platforms.length === 0) { S.toast('Select platforms first', true); return; }

    S.toast('Adapting for all platforms...');

    var data = await S.api('social-ai', {
      method: 'POST',
      body: JSON.stringify({
        action: 'platform-captions',
        caption: caption,
        platforms: composer.platforms
      })
    });

    if (data && data.captions) {
      Object.keys(data.captions).forEach(function (plat) {
        var adapted = data.captions[plat];
        if (adapted && adapted.caption) {
          composer.platformCaptions[plat] = adapted.caption;
        }
      });
      renderPlatformCaptionTabs();
      S.toast('All platforms adapted');
    }
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ═══ SMART QUEUE ═══ */
  async function smartSchedulePost() {
    S.toast('Finding optimal time slot...');
    try {
      var data = await S.api('social-smart-queue?action=suggest-slots&count=1');
      if (data && data.slots && data.slots.length > 0) {
        var slot = data.slots[0];
        var dt = new Date(slot.datetime);
        $('yb-social-schedule-date').value = dt.toISOString().split('T')[0];
        $('yb-social-schedule-time').value = slot.time;

        var picker = $('yb-social-schedule-picker');
        if (picker) picker.hidden = false;

        var schedRadio = document.querySelector('input[name="social-schedule"][value="schedule"]');
        if (schedRadio) schedRadio.checked = true;

        S.toast('Smart scheduled: ' + slot.dayLabel + ' at ' + slot.time + ' — ' + slot.reason);
        updatePublishBtn();
      } else {
        S.toast('No optimal slots found — defaulting to tomorrow 10:00');
        var tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        $('yb-social-schedule-date').value = tomorrow.toISOString().split('T')[0];
        $('yb-social-schedule-time').value = '10:00';
      }
    } catch (err) {
      S.toast('Error finding slot', true);
    }
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
