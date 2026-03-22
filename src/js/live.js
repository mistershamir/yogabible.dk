/**
 * Live Page — Student-facing live stream viewer + interactive mode.
 *
 * TWO MODES:
 * 1. Viewer mode (default): One-way stream from teacher via LiveKit/Mux
 * 2. Interactive mode: Zoom-style group call with camera/mic, chat, raise hand
 *
 * Interactive mode is activated when the session has `interactive: true`.
 * Students must be logged in to join interactive sessions.
 */
(function () {
  var container = document.getElementById('yb-live');
  if (!container) return;

  var playerSection = document.getElementById('yb-live-player-section');
  var offlineSection = document.getElementById('yb-live-offline');
  var checkingOverlay = document.getElementById('yb-live-checking');
  var badge = document.getElementById('yb-live-badge');
  var retryBtn = document.getElementById('yb-live-retry');
  var mountEl = document.getElementById('yb-live-player-mount');
  var elapsedEl = document.getElementById('yb-live-elapsed');
  var elapsedTimeEl = document.getElementById('yb-live-elapsed-time');
  var scheduleSection = document.getElementById('yb-live-schedule');
  var scheduleList = document.getElementById('yb-live-schedule-list');
  var viewerCountEl = document.getElementById('yb-live-viewer-count');

  // Interactive elements
  var joinSection = document.getElementById('yb-live-join');
  var joinTitle = document.getElementById('yb-live-join-title');
  var joinText = document.getElementById('yb-live-join-text');
  var joinBtn = document.getElementById('yb-live-join-btn');
  var interactiveSection = document.getElementById('yb-live-interactive');
  var gridEl = document.getElementById('yb-live-grid');
  var participantsEl = document.getElementById('yb-live-participants');
  var chatPanel = document.getElementById('yb-live-chat');
  var chatMessages = document.getElementById('yb-live-chat-messages');
  var chatInput = document.getElementById('yb-live-chat-input');
  var chatSendBtn = document.getElementById('yb-live-chat-send');
  var chatCloseBtn = document.getElementById('yb-live-chat-close');
  var chatBadge = document.getElementById('yb-live-chat-badge');
  var btnCam = document.getElementById('yb-live-btn-cam');
  var btnMic = document.getElementById('yb-live-btn-mic');
  var btnHand = document.getElementById('yb-live-btn-hand');
  var btnChat = document.getElementById('yb-live-btn-chat');
  var btnLeave = document.getElementById('yb-live-btn-leave');

  var pollTimer = null;
  var isCheckingStream = false; // guard against overlapping poll fetches
  var elapsedTimer = null;
  var liveStartTime = null;
  var sessionLiveStartTime = null;  // Server-side start time for persistent timer
  var POLL_INTERVAL = 15000;
  var isStreamLive = false;
  var livekitRoom = null;
  var currentRoomName = null;

  // Interactive state
  var isInteractive = false;
  var isJoined = false;
  var localVideoTrack = null;
  var localAudioTrack = null;
  var cameraEnabled = true;
  var micEnabled = true;
  var handRaised = false;
  var chatOpen = false;
  var unreadChat = 0;
  var currentSession = null;
  var participantTiles = {}; // identity → tile element
  var recBadge = document.getElementById('yb-live-rec');
  var recBadgeInteractive = document.getElementById('yb-live-rec-interactive');

  // i18n
  var isDa = (container.dataset.lang || 'da') === 'da';
  var T = {
    today: container.dataset.tToday || 'I dag',
    tomorrow: container.dataset.tTomorrow || 'I morgen',
    liveNow: container.dataset.tLiveNow || 'LIVE NU',
    empty: container.dataset.tEmpty || '',
    join: container.dataset.tJoin || 'Join',
    joining: container.dataset.tJoining || 'Joining…',
    camOn: container.dataset.tCamOn || 'Camera on',
    camOff: container.dataset.tCamOff || 'Camera off',
    micOn: container.dataset.tMicOn || 'Mic on',
    micOff: container.dataset.tMicOff || 'Mic off',
    raise: container.dataset.tRaise || 'Raise hand',
    lower: container.dataset.tLower || 'Lower hand',
    chat: container.dataset.tChat || 'Chat',
    leave: container.dataset.tLeave || 'Leave',
    leaveConfirm: container.dataset.tLeaveConfirm || 'Leave this session?',
    chatPlaceholder: container.dataset.tChatPlaceholder || 'Type a message…',
    you: container.dataset.tYou || 'You',
    loginRequired: container.dataset.tLoginRequired || 'Log in to join this interactive session.',
    permDenied: container.dataset.tPermDenied || 'Camera/mic permission denied.',
    participants: container.dataset.tParticipants || 'Participants'
  };

  // SVG icons for muted mic indicator
  var MIC_MUTED_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff453a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .28-.02.55-.05.82"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  var CAM_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"/></svg>';
  var MIC_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .28-.02.55-.05.82"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

  function formatTime(totalSeconds) {
    var s = Math.floor(totalSeconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var mm = m < 10 ? '0' + m : m;
    var ss = sec < 10 ? '0' + sec : sec;
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function startElapsedTimer() {
    if (elapsedTimer) return;
    // Use server-side start time if available (survives refresh)
    liveStartTime = sessionLiveStartTime || Date.now();
    if (elapsedEl) elapsedEl.classList.add('yb-live-elapsed--visible');
    elapsedTimer = setInterval(function () {
      if (elapsedTimeEl && liveStartTime) {
        var t = (Date.now() - liveStartTime) / 1000;
        elapsedTimeEl.textContent = formatTime(t);
      }
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    liveStartTime = null;
    if (elapsedEl) elapsedEl.classList.remove('yb-live-elapsed--visible');
    if (elapsedTimeEl) elapsedTimeEl.textContent = '00:00';
  }

  function showRecording(session, mode) {
    // Show REC badge only when egress recording is actually active
    var isRecording = session && session.muxLiveStreamId;
    var el = mode === 'interactive' ? recBadgeInteractive : recBadge;
    if (el) {
      if (isRecording) {
        el.classList.add('yb-live-rec--visible');
      } else {
        el.classList.remove('yb-live-rec--visible');
      }
    }
  }

  function hideRecording() {
    if (recBadge) recBadge.classList.remove('yb-live-rec--visible');
    if (recBadgeInteractive) recBadgeInteractive.classList.remove('yb-live-rec--visible');
  }

  function detectOrientation(videoEl, tile) {
    // When video metadata loads, check if portrait and adjust tile
    function check() {
      var w = videoEl.videoWidth;
      var h = videoEl.videoHeight;
      if (w && h) {
        if (h > w) {
          tile.classList.add('yb-live-tile--portrait');
        } else {
          tile.classList.remove('yb-live-tile--portrait');
        }
      }
    }
    // Remove previous listeners if reattaching (prevents accumulation on camera toggle)
    if (videoEl._orientCheck) {
      videoEl.removeEventListener('loadedmetadata', videoEl._orientCheck);
      videoEl.removeEventListener('resize', videoEl._orientCheck);
    }
    videoEl._orientCheck = check;
    videoEl.addEventListener('loadedmetadata', check);
    videoEl.addEventListener('resize', check); // fires when resolution changes (orientation flip)
    check(); // in case already loaded
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ═══════════════════════════════════════════════════════
  // VIEWER MODE — subscribe to teacher's tracks (one-way)
  // ═══════════════════════════════════════════════════════

  function connectToRoom(roomName) {
    if (typeof LivekitClient === 'undefined') {
      console.error('[live] LiveKit SDK not loaded');
      showOffline();
      return;
    }

    if (livekitRoom && currentRoomName === roomName) {
      showLive();
      return;
    }

    if (livekitRoom) {
      livekitRoom.disconnect();
      livekitRoom = null;
    }

    currentRoomName = roomName;

    var tokenUrl = '/.netlify/functions/livekit-token?action=viewer-token&room=' + encodeURIComponent(roomName);
    var opts = { headers: {} };

    getAuthToken().then(function (authToken) {
      if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
      return fetch(tokenUrl, opts);
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Failed to get viewer token');
      return joinRoom(data.wsUrl, data.token);
    })
    .catch(function (err) {
      console.error('[live] LiveKit connection error:', err);
      showOffline();
    });
  }

  function joinRoom(wsUrl, token) {
    var room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true
    });

    livekitRoom = room;

    room.on(LivekitClient.RoomEvent.TrackSubscribed, function (track, publication, participant) {
      console.log('[live] Track subscribed:', track.kind, 'from', participant.identity);
      attachTrack(track);
      showLive();
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, function (track) {
      console.log('[live] Track unsubscribed:', track.kind);
      detachTrack(track);
    });

    room.on(LivekitClient.RoomEvent.Disconnected, function () {
      console.log('[live] Disconnected from LiveKit room');
      cleanupMount();
      livekitRoom = null;
      currentRoomName = null;
      showOffline();
    });

    room.on(LivekitClient.RoomEvent.Reconnecting, function () {
      console.log('[live] Reconnecting…');
    });

    room.on(LivekitClient.RoomEvent.Reconnected, function () {
      console.log('[live] Reconnected');
    });

    // Track viewer count in broadcast mode
    room.on(LivekitClient.RoomEvent.ParticipantConnected, function () {
      updateViewerCount(room);
    });
    room.on(LivekitClient.RoomEvent.ParticipantDisconnected, function () {
      updateViewerCount(room);
    });

    return room.connect(wsUrl, token).then(function () {
      console.log('[live] Connected to room:', room.name, 'participants:', room.remoteParticipants.size);

      room.remoteParticipants.forEach(function (participant) {
        participant.trackPublications.forEach(function (publication) {
          if (publication.track && publication.isSubscribed) {
            attachTrack(publication.track);
          }
        });
      });

      updateViewerCount(room);

      if (room.remoteParticipants.size > 0) {
        showLive();
      }
    });
  }

  function attachTrack(track) {
    if (!mountEl) return;

    // Prevent duplicate tracks
    var existing = document.getElementById('yb-live-track-' + track.sid);
    if (existing) return;

    var el = track.attach();
    el.id = 'yb-live-track-' + track.sid;

    if (track.kind === 'video') {
      el.style.width = '100%';
      el.style.aspectRatio = '16 / 9';
      el.style.objectFit = 'contain';
      el.style.background = '#000';
      el.style.display = 'block';
    } else if (track.kind === 'audio') {
      // Audio element: hidden but must not be display:none on some browsers
      el.style.position = 'absolute';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.overflow = 'hidden';
      el.style.opacity = '0';
      // Attempt autoplay — handle blocked autoplay
      var playPromise = el.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () {
          console.log('[live] Audio autoplay blocked, will play on user interaction');
          // Play on first user interaction
          function resumeAudio() {
            el.play().catch(function () {});
            document.removeEventListener('click', resumeAudio);
            document.removeEventListener('touchstart', resumeAudio);
          }
          document.addEventListener('click', resumeAudio);
          document.addEventListener('touchstart', resumeAudio);
        });
      }
    }

    mountEl.appendChild(el);
  }

  function detachTrack(track) {
    var elements = track.detach();
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].parentNode) {
        elements[i].parentNode.removeChild(elements[i]);
      }
    }
  }

  function updateViewerCount(room) {
    if (!viewerCountEl) return;
    // Count all participants in the room (including self)
    var count = (room ? room.remoteParticipants.size : 0) + 1;
    var icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    viewerCountEl.innerHTML = icon + ' ' + count + ' ' + (isDa ? 'seere' : 'viewers');
    viewerCountEl.style.display = 'flex';
  }

  function cleanupMount() {
    if (!mountEl) return;
    while (mountEl.firstChild) {
      mountEl.removeChild(mountEl.firstChild);
    }
  }

  // ═══════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════
  // GOOGLE MEET MODE — embedded external meeting
  // ═══════════════════════════════════════════════════════

  var meetSection = document.getElementById('yb-live-meet');
  var meetIframe = document.getElementById('yb-live-meet-iframe');
  var meetTitle = document.getElementById('yb-live-meet-title');
  var meetInstructor = document.getElementById('yb-live-meet-instructor');
  var meetExternal = document.getElementById('yb-live-meet-external');
  var meetFallback = document.getElementById('yb-live-meet-fallback');
  var meetFallbackTitle = document.getElementById('yb-live-meet-fallback-title');
  var meetLink = document.getElementById('yb-live-meet-link');

  function showMeetSession(session) {
    currentSession = session;
    var title = isDa ? (session.title_da || session.title_en || '') : (session.title_en || session.title_da || '');
    var url = session.meetingUrl;

    // Hide other sections
    playerSection.style.display = 'none';
    offlineSection.style.display = 'none';
    joinSection.style.display = 'none';
    interactiveSection.classList.remove('yb-live-interactive--active');

    // Show badge + recording indicator
    badge.classList.add('yb-live-badge--visible');
    showRecording(session, 'player');
    checkingOverlay.classList.add('yb-live-player__checking--hidden');

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    // Set header info
    if (meetTitle) meetTitle.textContent = title;
    if (meetInstructor) meetInstructor.textContent = session.instructor || '';
    if (meetExternal) meetExternal.href = url;
    if (meetLink) meetLink.href = url;
    if (meetFallbackTitle) meetFallbackTitle.textContent = title;

    // Try to embed the meeting in an iframe
    if (meetIframe) {
      meetIframe.src = url;
      // Detect if iframe is blocked (Google may block embedding)
      meetIframe.onerror = function () {
        showMeetFallback();
      };
      // Also check after a timeout — if iframe loads but shows X-Frame-Options error,
      // the onerror won't fire, but we can't detect that easily.
      // Show the "open in new window" link prominently as backup.
    }

    if (meetSection) meetSection.style.display = 'block';

    // Start elapsed timer
    startElapsedTimer();
  }

  function showMeetFallback() {
    if (meetIframe) meetIframe.parentElement.style.display = 'none';
    if (meetFallback) meetFallback.style.display = 'block';
  }

  // ═══════════════════════════════════════════════════════
  // INTERACTIVE MODE — Zoom-style group call
  // ═══════════════════════════════════════════════════════

  function showInteractiveJoin(session) {
    currentSession = session;
    var title = isDa ? (session.title_da || session.title_en || '') : (session.title_en || session.title_da || '');
    joinTitle.textContent = title;
    joinText.textContent = isDa
      ? 'Denne session er interaktiv. Du kan tænde dit kamera og din mikrofon efter du er tilsluttet.'
      : 'This session is interactive. You can turn on your camera and microphone after joining.';
    joinBtn.textContent = isDa ? 'Deltag' : 'Join';
    joinBtn.disabled = false;

    playerSection.style.display = 'none';
    offlineSection.style.display = 'none';
    joinSection.style.display = 'block';
    interactiveSection.classList.remove('yb-live-interactive--active');
    badge.classList.add('yb-live-badge--visible');
    showRecording(session, 'interactive');
    checkingOverlay.classList.add('yb-live-player__checking--hidden');

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function joinInteractive() {
    // Require auth
    if (typeof firebase === 'undefined' || !firebase.auth || !firebase.auth().currentUser) {
      alert(T.loginRequired);
      // Try opening login modal if available
      if (typeof window.openLoginModal === 'function') window.openLoginModal();
      return;
    }

    joinBtn.disabled = true;
    joinBtn.textContent = T.joining;

    var roomName = currentSession.livekitRoom;
    var tokenUrl = '/.netlify/functions/livekit-token?action=viewer-token&room=' + encodeURIComponent(roomName);

    // Get auth token, fetch participant token, then connect (no camera/mic required upfront)
    getAuthToken().then(function (authToken) {
      return fetch(tokenUrl, {
        headers: authToken ? { 'Authorization': 'Bearer ' + authToken } : {}
      });
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Token error');
      // Join without media — student enables cam/mic via controls after joining
      cameraEnabled = false;
      micEnabled = false;
      return connectInteractive(data.wsUrl, data.token, roomName);
    })
    .catch(function (err) {
      console.error('[live] Interactive join error:', err);
      joinBtn.disabled = false;
      joinBtn.textContent = isDa ? 'Deltag' : 'Join';
      alert(err.message);
    });
  }

  function connectInteractive(wsUrl, token, roomName) {
    var room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true
    });

    livekitRoom = room;
    currentRoomName = roomName;

    // Track subscribed — remote participant's track
    room.on(LivekitClient.RoomEvent.TrackSubscribed, function (track, publication, participant) {
      console.log('[live-i] Track subscribed:', track.kind, participant.identity);
      if (isEgressParticipant(participant)) return;
      ensureParticipantTile(participant);
      attachTrackToTile(track, participant);
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, function (track, publication, participant) {
      console.log('[live-i] Track unsubscribed:', track.kind, participant.identity);
      detachTrackFromTile(track, participant);
    });

    // Track muted/unmuted
    room.on(LivekitClient.RoomEvent.TrackMuted, function (publication, participant) {
      updateTileMuteState(participant);
    });

    room.on(LivekitClient.RoomEvent.TrackUnmuted, function (publication, participant) {
      updateTileMuteState(participant);
    });

    // Active speaker detection — highlight who's talking
    room.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, function (speakers) {
      // Clear all speaking highlights
      Object.keys(participantTiles).forEach(function (id) {
        var t = participantTiles[id];
        if (t) t.classList.remove('yb-live-tile--speaking');
      });
      // Highlight active speakers
      for (var si = 0; si < speakers.length; si++) {
        var t = participantTiles[speakers[si].identity];
        if (t) t.classList.add('yb-live-tile--speaking');
      }
    });

    // Participant connected/disconnected
    room.on(LivekitClient.RoomEvent.ParticipantConnected, function (participant) {
      console.log('[live-i] Participant connected:', participant.identity);
      if (isEgressParticipant(participant)) return;
      ensureParticipantTile(participant);
      updateParticipantCount();
      addChatSystemMessage(getParticipantName(participant) + (isDa ? ' deltager' : ' joined'));
    });

    room.on(LivekitClient.RoomEvent.ParticipantDisconnected, function (participant) {
      console.log('[live-i] Participant disconnected:', participant.identity);
      removeParticipantTile(participant);
      updateParticipantCount();
      addChatSystemMessage(getParticipantName(participant) + (isDa ? ' forlod' : ' left'));
    });

    // Data messages (chat + raise hand)
    room.on(LivekitClient.RoomEvent.DataReceived, function (payload, participant) {
      try {
        var msg = JSON.parse(new TextDecoder().decode(payload));
        handleDataMessage(msg, participant);
      } catch (e) {
        console.warn('[live-i] DataReceived error:', e);
      }
    });

    room.on(LivekitClient.RoomEvent.Disconnected, function () {
      console.log('[live-i] Disconnected');
      leaveInteractive(true);
    });

    return room.connect(wsUrl, token).then(function () {
      console.log('[live-i] Connected, participants:', room.remoteParticipants.size);

      isJoined = true;

      // Show interactive UI
      joinSection.style.display = 'none';
      playerSection.style.display = 'none';
      offlineSection.style.display = 'none';
      interactiveSection.classList.add('yb-live-interactive--active');

      // Create local participant tile (no video initially — cam/mic off)
      createLocalTile(room.localParticipant);

      // Create tiles for existing participants
      room.remoteParticipants.forEach(function (participant) {
        if (isEgressParticipant(participant)) return;
        ensureParticipantTile(participant);
        participant.trackPublications.forEach(function (pub) {
          if (pub.track && pub.isSubscribed) {
            attachTrackToTile(pub.track, participant);
          }
        });
      });

      updateParticipantCount();
      startElapsedTimer();
      updateControlStates();
    });
  }

  // ── Participant tile management ──

  /**
   * Filter out LiveKit egress bots (recording participants) from the grid.
   * These are server-side participants used for recording, not real people.
   */
  function isEgressParticipant(participant) {
    var id = participant.identity || '';
    return id.indexOf('EG_') !== -1 || id.indexOf('egress') === 0;
  }

  function getParticipantName(participant) {
    if (!participant) return 'Unknown';
    var meta = {};
    try { meta = JSON.parse(participant.metadata || '{}'); } catch (e) {}
    return meta.name || participant.name || participant.identity.split('-')[0] || 'Participant';
  }

  function getParticipantRole(participant) {
    if (!participant) return 'viewer';
    var meta = {};
    try { meta = JSON.parse(participant.metadata || '{}'); } catch (e) {}
    return meta.role || (participant.identity.indexOf('teacher-') === 0 ? 'teacher' : 'viewer');
  }

  function createTileElement(identity, name, isLocal, role) {
    var tile = document.createElement('div');
    tile.className = 'yb-live-tile' + (isLocal ? ' yb-live-tile--local yb-live-tile--no-video' : ' yb-live-tile--no-video');
    if (role === 'teacher') tile.className += ' yb-live-tile--teacher';
    tile.id = 'yb-live-tile-' + identity;
    tile.dataset.identity = identity;
    tile.dataset.role = role || 'viewer';

    // Avatar (shown when no video)
    var avatar = document.createElement('div');
    avatar.className = 'yb-live-tile__avatar';
    avatar.textContent = (name || '?').charAt(0).toUpperCase();
    tile.appendChild(avatar);

    // Name label with role badge
    var nameEl = document.createElement('div');
    nameEl.className = 'yb-live-tile__name';
    if (role === 'teacher') {
      nameEl.innerHTML = '<span class="yb-live-tile__role-badge">' + (isDa ? 'UNDERVISER' : 'TEACHER') + '</span> ' + esc(isLocal ? T.you : name);
    } else {
      nameEl.textContent = isLocal ? T.you : name;
    }
    tile.appendChild(nameEl);

    // Hand raised icon
    var hand = document.createElement('div');
    hand.className = 'yb-live-tile__hand';
    hand.textContent = '✋';
    tile.appendChild(hand);

    // Muted indicator
    var muted = document.createElement('div');
    muted.className = 'yb-live-tile__muted';
    muted.innerHTML = MIC_MUTED_SVG;
    tile.appendChild(muted);

    return tile;
  }

  function createLocalTile(localParticipant) {
    var name = getParticipantName(localParticipant);
    var role = getParticipantRole(localParticipant);
    var tile = createTileElement(localParticipant.identity, name, true, role);

    // Attach local video preview
    if (localVideoTrack) {
      var videoEl = localVideoTrack.attach();
      videoEl.style.width = '100%';
      videoEl.style.height = '100%';
      videoEl.muted = true;
      tile.insertBefore(videoEl, tile.firstChild);
      tile.classList.remove('yb-live-tile--no-video');
      detectOrientation(videoEl, tile);
    }

    participantTiles[localParticipant.identity] = tile;
    gridEl.appendChild(tile);
    updateGridLayout();
  }

  function ensureParticipantTile(participant) {
    if (participantTiles[participant.identity]) return;
    var name = getParticipantName(participant);
    var role = getParticipantRole(participant);
    var tile = createTileElement(participant.identity, name, false, role);
    participantTiles[participant.identity] = tile;
    gridEl.appendChild(tile);
    updateGridLayout();
  }

  function removeParticipantTile(participant) {
    var tile = participantTiles[participant.identity];
    if (tile && tile.parentNode) {
      tile.parentNode.removeChild(tile);
    }
    delete participantTiles[participant.identity];
    updateGridLayout();
  }

  function attachTrackToTile(track, participant) {
    var tile = participantTiles[participant.identity];
    if (!tile) return;

    if (track.kind === 'video') {
      // Remove existing video if any
      var existingVideo = tile.querySelector('video');
      if (existingVideo) existingVideo.remove();

      var el = track.attach();
      el.style.width = '100%';
      el.style.height = '100%';
      tile.insertBefore(el, tile.firstChild);
      tile.classList.remove('yb-live-tile--no-video');
      detectOrientation(el, tile);
    } else if (track.kind === 'audio') {
      var audioEl = track.attach();
      audioEl.id = 'yb-live-audio-' + participant.identity;
      // Use absolute positioning instead of display:none — some mobile browsers
      // block audio playback on elements with display:none
      audioEl.style.position = 'absolute';
      audioEl.style.width = '1px';
      audioEl.style.height = '1px';
      audioEl.style.overflow = 'hidden';
      audioEl.style.opacity = '0';
      tile.appendChild(audioEl);
      // Handle autoplay policy
      var playPromise = audioEl.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () {
          console.log('[live-i] Audio autoplay blocked for', participant.identity);
          function resumeAudio() {
            audioEl.play().catch(function () {});
            document.removeEventListener('click', resumeAudio);
            document.removeEventListener('touchstart', resumeAudio);
          }
          document.addEventListener('click', resumeAudio);
          document.addEventListener('touchstart', resumeAudio);
        });
      }
    }
  }

  function detachTrackFromTile(track, participant) {
    if (track.kind === 'video') {
      var tile = participantTiles[participant.identity];
      var elements = track.detach();
      for (var i = 0; i < elements.length; i++) {
        if (elements[i].parentNode) elements[i].parentNode.removeChild(elements[i]);
      }
      if (tile) tile.classList.add('yb-live-tile--no-video');
    } else if (track.kind === 'audio') {
      var audioElements = track.detach();
      for (var j = 0; j < audioElements.length; j++) {
        if (audioElements[j].parentNode) audioElements[j].parentNode.removeChild(audioElements[j]);
      }
    }
  }

  function updateTileMuteState(participant) {
    var tile = participantTiles[participant.identity];
    if (!tile) return;

    var isMicMuted = true;
    participant.audioTrackPublications.forEach(function (pub) {
      if (pub.track && !pub.isMuted) isMicMuted = false;
    });

    var mutedEl = tile.querySelector('.yb-live-tile__muted');
    if (mutedEl) {
      if (isMicMuted) {
        mutedEl.classList.add('yb-live-tile__muted--visible');
      } else {
        mutedEl.classList.remove('yb-live-tile__muted--visible');
      }
    }
  }

  function updateGridLayout() {
    var count = Object.keys(participantTiles).length;
    gridEl.setAttribute('data-count', String(Math.min(count, 9)));
  }

  function updateParticipantCount() {
    if (!participantsEl || !livekitRoom) return;
    var count = livekitRoom.remoteParticipants.size + 1; // +1 for self
    participantsEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> '
      + count + ' ' + T.participants;
  }

  // ── Controls ──

  function toggleCamera() {
    if (!livekitRoom || !isJoined) return;

    if (cameraEnabled) {
      livekitRoom.localParticipant.setCameraEnabled(false);
      cameraEnabled = false;
      var localTile = participantTiles[livekitRoom.localParticipant.identity];
      if (localTile) {
        var vid = localTile.querySelector('video');
        if (vid) vid.style.display = 'none';
        localTile.classList.add('yb-live-tile--no-video');
      }
    } else {
      // setCameraEnabled(true) will request getUserMedia if no track exists yet
      livekitRoom.localParticipant.setCameraEnabled(true).then(function () {
        cameraEnabled = true;
        // Attach the new video track to the local tile
        var localTile = participantTiles[livekitRoom.localParticipant.identity];
        if (localTile) {
          var existingVid = localTile.querySelector('video');
          if (!existingVid) {
            // LiveKit creates the track — find it and attach
            var camPub = livekitRoom.localParticipant.getTrackPublication(LivekitClient.Track.Source.Camera);
            if (camPub && camPub.track) {
              var videoEl = camPub.track.attach();
              videoEl.style.width = '100%';
              videoEl.style.height = '100%';
              videoEl.muted = true;
              localTile.insertBefore(videoEl, localTile.firstChild);
              detectOrientation(videoEl, localTile);
            }
          } else {
            existingVid.style.display = '';
          }
          localTile.classList.remove('yb-live-tile--no-video');
        }
        updateControlStates();
      }).catch(function (err) {
        console.error('[live-i] Camera enable failed:', err);
        alert(T.permDenied);
      });
      return; // updateControlStates called in .then()
    }
    updateControlStates();
  }

  function toggleMic() {
    if (!livekitRoom || !isJoined) return;

    if (micEnabled) {
      livekitRoom.localParticipant.setMicrophoneEnabled(false);
      micEnabled = false;
    } else {
      // setMicrophoneEnabled(true) will request getUserMedia if no track exists yet
      livekitRoom.localParticipant.setMicrophoneEnabled(true).then(function () {
        micEnabled = true;
        updateControlStates();
      }).catch(function (err) {
        console.error('[live-i] Mic enable failed:', err);
        alert(T.permDenied);
      });
      return;
    }
    updateControlStates();
  }

  function toggleHand() {
    handRaised = !handRaised;
    updateControlStates();

    // Update local tile hand icon
    if (livekitRoom) {
      var localTile = participantTiles[livekitRoom.localParticipant.identity];
      if (localTile) {
        var handEl = localTile.querySelector('.yb-live-tile__hand');
        if (handEl) {
          if (handRaised) handEl.classList.add('yb-live-tile__hand--visible');
          else handEl.classList.remove('yb-live-tile__hand--visible');
        }
      }

      // Broadcast hand state
      sendDataMessage({ type: 'hand', raised: handRaised });
    }
  }

  function toggleChat() {
    chatOpen = !chatOpen;
    if (chatOpen) {
      chatPanel.classList.add('yb-live-chat--open');
      unreadChat = 0;
      updateChatBadge();
      if (chatInput) chatInput.focus();
    } else {
      chatPanel.classList.remove('yb-live-chat--open');
    }
    updateControlStates();
  }

  function updateControlStates() {
    if (btnCam) {
      btnCam.className = 'yb-live-controls__btn' + (cameraEnabled ? ' yb-live-controls__btn--active' : ' yb-live-controls__btn--off');
      btnCam.title = cameraEnabled ? T.camOn : T.camOff;
      if (!cameraEnabled) {
        btnCam.innerHTML = CAM_OFF_SVG;
      } else {
        btnCam.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
      }
    }
    if (btnMic) {
      btnMic.className = 'yb-live-controls__btn' + (micEnabled ? ' yb-live-controls__btn--active' : ' yb-live-controls__btn--off');
      btnMic.title = micEnabled ? T.micOn : T.micOff;
      if (!micEnabled) {
        btnMic.innerHTML = MIC_OFF_SVG;
      } else {
        btnMic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
      }
    }
    if (btnHand) {
      btnHand.className = 'yb-live-controls__btn' + (handRaised ? ' yb-live-controls__btn--active' : '');
      btnHand.title = handRaised ? T.lower : T.raise;
    }
    if (btnChat) {
      btnChat.className = 'yb-live-controls__btn' + (chatOpen ? ' yb-live-controls__btn--active' : '');
    }
  }

  function updateChatBadge() {
    if (!chatBadge) return;
    if (unreadChat > 0 && !chatOpen) {
      chatBadge.textContent = unreadChat > 9 ? '9+' : String(unreadChat);
      chatBadge.classList.add('yb-live-controls__badge--visible');
    } else {
      chatBadge.classList.remove('yb-live-controls__badge--visible');
    }
  }

  // ── Chat + data messages ──

  function sendDataMessage(msg) {
    if (!livekitRoom || !isJoined) return;
    var data = new TextEncoder().encode(JSON.stringify(msg));
    try {
      livekitRoom.localParticipant.publishData(data, { reliable: true });
    } catch (err) {
      console.warn('[live-i] Failed to send data message:', err);
      // Revert hand raise state if send failed
      if (msg.type === 'hand') {
        handRaised = !handRaised;
        updateControlStates();
        var localTile = livekitRoom ? participantTiles[livekitRoom.localParticipant.identity] : null;
        if (localTile) {
          var handEl = localTile.querySelector('.yb-live-tile__hand');
          if (handEl) {
            if (handRaised) handEl.classList.add('yb-live-tile__hand--visible');
            else handEl.classList.remove('yb-live-tile__hand--visible');
          }
        }
      }
    }
  }

  function sendChat() {
    var text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';

    sendDataMessage({ type: 'chat', text: text });

    // Show own message locally
    addChatMessage(T.you, text, true);
  }

  function handleDataMessage(msg, participant) {
    if (msg.type === 'chat') {
      var name = getParticipantName(participant);
      addChatMessage(name, msg.text, false);
      if (!chatOpen) {
        unreadChat++;
        updateChatBadge();
      }
    } else if (msg.type === 'hand') {
      var tile = participant ? participantTiles[participant.identity] : null;
      if (tile) {
        var handEl = tile.querySelector('.yb-live-tile__hand');
        if (handEl) {
          if (msg.raised) handEl.classList.add('yb-live-tile__hand--visible');
          else handEl.classList.remove('yb-live-tile__hand--visible');
        }
        // Add/remove orange stroke for raised hand
        if (msg.raised) {
          tile.classList.add('yb-live-tile--hand-raised');
        } else {
          tile.classList.remove('yb-live-tile--hand-raised');
        }
      }
    } else if (msg.type === 'lower-hand') {
      // Teacher dismissed our raised hand
      if (handRaised) {
        handRaised = false;
        updateControlStates();
        if (livekitRoom) {
          var localTile = participantTiles[livekitRoom.localParticipant.identity];
          if (localTile) {
            var handEl = localTile.querySelector('.yb-live-tile__hand');
            if (handEl) handEl.classList.remove('yb-live-tile__hand--visible');
            localTile.classList.remove('yb-live-tile--hand-raised');
          }
        }
      }
    }
  }

  function addChatMessage(name, text, isSelf) {
    if (!chatMessages) return;
    var div = document.createElement('div');
    div.className = 'yb-live-chat__msg';
    div.innerHTML = '<span class="yb-live-chat__msg-name" style="' + (isSelf ? 'color:#FFFCF9' : '') + '">' + esc(name) + '</span><span class="yb-live-chat__msg-text">' + esc(text) + '</span>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addChatSystemMessage(text) {
    if (!chatMessages) return;
    var div = document.createElement('div');
    div.className = 'yb-live-chat__msg yb-live-chat__msg--system';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ── Leave ──

  function leaveInteractive(wasDisconnected) {
    if (!wasDisconnected && !confirm(T.leaveConfirm)) return;

    isJoined = false;
    handRaised = false;
    chatOpen = false;
    unreadChat = 0;

    // Stop local tracks
    if (localVideoTrack) {
      localVideoTrack.stop();
      localVideoTrack = null;
    }
    if (localAudioTrack) {
      localAudioTrack.stop();
      localAudioTrack = null;
    }
    cameraEnabled = false;
    micEnabled = false;

    // Disconnect room
    if (livekitRoom) {
      livekitRoom.disconnect();
      livekitRoom = null;
      currentRoomName = null;
    }

    // Clear tiles
    Object.keys(participantTiles).forEach(function (key) {
      var tile = participantTiles[key];
      if (tile && tile.parentNode) tile.parentNode.removeChild(tile);
    });
    participantTiles = {};

    // Clear chat
    if (chatMessages) chatMessages.innerHTML = '';
    if (chatPanel) chatPanel.classList.remove('yb-live-chat--open');

    // Reset UI
    interactiveSection.classList.remove('yb-live-interactive--active');
    stopElapsedTimer();

    // Show rejoin prompt if session is still live (instead of going to offline)
    if (currentSession && !wasDisconnected) {
      // Intentional leave — show rejoin prompt
      isInteractive = true;
      showInteractiveJoin(currentSession);
    } else if (currentSession && wasDisconnected) {
      // Unexpected disconnect — auto-rejoin prompt
      isInteractive = true;
      showInteractiveJoin(currentSession);
      // Update text to indicate reconnection
      if (joinText) {
        joinText.textContent = isDa
          ? 'Forbindelsen blev afbrudt. Klik for at tilslutte igen.'
          : 'Connection was lost. Click to rejoin.';
      }
    } else {
      isInteractive = false;
      joinSection.style.display = 'none';
      showOffline();
    }
  }

  // ── Control event listeners ──

  if (btnCam) btnCam.addEventListener('click', toggleCamera);
  if (btnMic) btnMic.addEventListener('click', toggleMic);
  if (btnHand) btnHand.addEventListener('click', toggleHand);
  if (btnChat) btnChat.addEventListener('click', toggleChat);
  if (btnLeave) btnLeave.addEventListener('click', function () { leaveInteractive(false); });
  if (chatCloseBtn) chatCloseBtn.addEventListener('click', toggleChat);
  if (chatSendBtn) chatSendBtn.addEventListener('click', sendChat);
  if (chatInput) chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendChat();
  });
  if (joinBtn) joinBtn.addEventListener('click', joinInteractive);

  // ═══════════════════════════════════════════════════════
  // SHOW LIVE / OFFLINE
  // ═══════════════════════════════════════════════════════

  function showLive() {
    isStreamLive = true;
    playerSection.style.display = 'block';
    offlineSection.style.display = 'none';
    joinSection.style.display = 'none';
    checkingOverlay.classList.add('yb-live-player__checking--hidden');
    badge.classList.add('yb-live-badge--visible');
    startElapsedTimer();
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showOffline() {
    isStreamLive = false;
    playerSection.style.display = 'none';
    offlineSection.style.display = 'block';
    joinSection.style.display = 'none';
    interactiveSection.classList.remove('yb-live-interactive--active');
    if (meetSection) { meetSection.style.display = 'none'; if (meetIframe) meetIframe.src = ''; }
    badge.classList.remove('yb-live-badge--visible');
    hideRecording();
    checkingOverlay.classList.add('yb-live-player__checking--hidden');
    if (viewerCountEl) viewerCountEl.style.display = 'none';
    cleanupMount();
    stopElapsedTimer();

    if (livekitRoom && !isJoined) {
      livekitRoom.disconnect();
      livekitRoom = null;
      currentRoomName = null;
    }

    startPolling();
  }

  // ═══════════════════════════════════════════════════════
  // STREAM CHECK — poll schedule for active rooms
  // ═══════════════════════════════════════════════════════

  function showMuxPlayer(playbackId) {
    if (!mountEl) return;
    cleanupMount();

    var envKey = container.dataset.envKey || '';
    var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    var el;
    if (isSafari || isIOS) {
      el = document.createElement('iframe');
      el.src = 'https://player.mux.com/' + playbackId;
      el.style.cssText = 'width:100%;aspect-ratio:16/9;border:none;display:block';
      el.setAttribute('allow', 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;');
      el.setAttribute('allowfullscreen', '');
    } else {
      el = document.createElement('mux-player');
      el.setAttribute('stream-type', 'll-live');
      el.setAttribute('playback-id', playbackId);
      if (envKey) el.setAttribute('env-key', envKey);
      el.setAttribute('accent-color', '#f75c03');
      el.setAttribute('primary-color', '#FFFCF9');
      el.setAttribute('secondary-color', '#0F0F0F');
      el.setAttribute('default-hidden-captions', '');
      el.setAttribute('playsinline', '');
    }

    mountEl.appendChild(el);
    showLive();
  }

  function getAuthToken() {
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      return firebase.auth().currentUser.getIdToken();
    }
    return Promise.resolve(null);
  }

  function checkStream() {
    if (isJoined) return; // Don't poll while in interactive session
    if (isCheckingStream) return; // prevent overlapping poll fetches

    // If we're already connected via LiveKit and streaming, don't disrupt
    if (livekitRoom && isStreamLive && !isJoined) {
      // Still fetch schedule for sidebar, but don't touch player
      isCheckingStream = true;
      var opts2 = { headers: {} };
      getAuthToken().then(function (token) {
        if (token) opts2.headers['Authorization'] = 'Bearer ' + token;
        return fetch('/.netlify/functions/live-admin?action=schedule', opts2);
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok && data.items) {
          renderSchedule(data.items);
          // Check if session actually ended (no live session found)
          var stillLive = false;
          for (var i = 0; i < data.items.length; i++) {
            if (data.items[i].status === 'live' && (data.items[i].livekitRoom || data.items[i].muxPlaybackId)) {
              stillLive = true;
              break;
            }
          }
          if (!stillLive) {
            // Session ended server-side but LiveKit still connected — clean up
            if (livekitRoom) {
              livekitRoom.disconnect();
              livekitRoom = null;
              currentRoomName = null;
            }
            showOffline();
          }
        }
      })
      .catch(function () {})
      .finally(function () { isCheckingStream = false; });
      return;
    }

    isCheckingStream = true;
    var opts = { headers: {} };

    getAuthToken().then(function (token) {
      if (token) opts.headers['Authorization'] = 'Bearer ' + token;
      return fetch('/.netlify/functions/live-admin?action=schedule', opts);
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok || !data.items) {
        showOffline();
        return;
      }

      // Priority 1: LiveKit room
      // Priority 1: Find any live session (LiveKit or Meet)
      var liveSession = null;
      for (var i = 0; i < data.items.length; i++) {
        var s = data.items[i];
        if (s.status === 'live' && (s.livekitRoom || s.streamType === 'meet')) {
          liveSession = s;
          break;
        }
      }

      if (liveSession) {
        var sType = liveSession.streamType || (liveSession.interactive ? 'interactive' : 'broadcast');
        console.log('[live] Found live session:', liveSession.id, 'streamType:', sType);

        // Store session start time for persistent elapsed timer
        if (liveSession.liveStartedAt) {
          sessionLiveStartTime = new Date(liveSession.liveStartedAt).getTime();
        } else if (liveSession.startDateTime) {
          sessionLiveStartTime = new Date(liveSession.startDateTime).getTime();
        }

        // Google Meet session → show embedded meeting
        if (sType === 'meet' && liveSession.meetingUrl) {
          showMeetSession(liveSession);
          renderSchedule(data.items);
          return;
        }

        // Interactive or panel session → show join prompt
        if (sType === 'interactive' || sType === 'panel') {
          isInteractive = true;
          showInteractiveJoin(liveSession);
          renderSchedule(data.items);
          return;
        }

        // Normal viewer mode
        showRecording(liveSession, 'player');
        connectToRoom(liveSession.livekitRoom);
        renderSchedule(data.items);
        return;
      }

      // Priority 2: Mux HLS (hardware encoder fallback)
      var muxLive = null;
      for (var j = 0; j < data.items.length; j++) {
        if (data.items[j].status === 'live' && data.items[j].muxPlaybackId) {
          muxLive = data.items[j];
          break;
        }
      }

      if (muxLive) {
        if (muxLive.liveStartedAt) {
          sessionLiveStartTime = new Date(muxLive.liveStartedAt).getTime();
        }
        showRecording(muxLive, 'player');
        showMuxPlayer(muxLive.muxPlaybackId);
      } else {
        showOffline();
      }

      renderSchedule(data.items);
    })
    .catch(function () {
      showOffline();
    })
    .finally(function () { isCheckingStream = false; });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(checkStream, POLL_INTERVAL);
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      playerSection.style.display = 'block';
      offlineSection.style.display = 'none';
      checkingOverlay.classList.remove('yb-live-player__checking--hidden');
      checkStream();
    });
  }

  // Initial check
  checkStream();

  // ═══════════════════════════════════════════════════════
  // SCHEDULE RENDERING
  // ═══════════════════════════════════════════════════════
  function isToday(d) {
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function isTomorrow(d) {
    var tom = new Date();
    tom.setDate(tom.getDate() + 1);
    return d.getFullYear() === tom.getFullYear() && d.getMonth() === tom.getMonth() && d.getDate() === tom.getDate();
  }

  var MONTHS_DA = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function renderSchedule(items) {
    if (!scheduleSection || !scheduleList) return;
    if (!items || !items.length) {
      scheduleSection.hidden = true;
      return;
    }

    scheduleSection.hidden = false;
    var html = '';

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var d = new Date(item.startDateTime);
      var day = d.getDate();
      var months = isDa ? MONTHS_DA : MONTHS_EN;
      var monthLabel = months[d.getMonth()];
      var hours = String(d.getHours()).padStart(2, '0');
      var mins = String(d.getMinutes()).padStart(2, '0');
      var startTime = hours + ':' + mins;
      var endTime = '';
      if (item.endDateTime) {
        var de = new Date(item.endDateTime);
        endTime = String(de.getHours()).padStart(2, '0') + ':' + String(de.getMinutes()).padStart(2, '0');
      }
      var timeRange = endTime ? (startTime + ' – ' + endTime) : startTime;
      var title = isDa ? (item.title_da || item.title_en || '') : (item.title_en || item.title_da || '');
      var isLive = item.status === 'live';

      var dayLabel = '';
      if (isToday(d)) dayLabel = T.today;
      else if (isTomorrow(d)) dayLabel = T.tomorrow;

      var tag = '';
      if (isLive) {
        tag = '<span class="yb-live-schedule__tag yb-live-schedule__tag--live"><span class="yb-live-badge__dot"></span>' + T.liveNow + '</span>';
      } else {
        tag = '<span class="yb-live-schedule__tag yb-live-schedule__tag--upcoming">' + timeRange + '</span>';
      }

      html += '<div class="yb-live-schedule__card' + (isLive ? ' yb-live-schedule__card--live' : '') + '">';
      html += '<div class="yb-live-schedule__item">';
      html += '<div class="yb-live-schedule__date">';
      if (dayLabel) {
        html += '<div class="yb-live-schedule__day-label">' + esc(dayLabel) + '</div>';
      }
      html += '<div class="yb-live-schedule__day">' + day + '. ' + esc(monthLabel) + ' ' + d.getFullYear() + '</div>';
      html += '</div>';
      html += '<div class="yb-live-schedule__info">';
      html += '<p class="yb-live-schedule__name">' + esc(title) + '</p>';
      html += '<span class="yb-live-schedule__meta">' + esc(item.instructor || '') + '</span>';
      html += '</div>';
      html += tag;
      html += '</div>';
      html += '</div>';
    }

    scheduleList.innerHTML = html;
  }

  // Expose for member.js to trigger re-fetch
  window._liveScheduleFetch = checkStream;

  // Re-fetch once auth is ready
  if (typeof firebase !== 'undefined' && firebase.auth) {
    var authUnsub = firebase.auth().onAuthStateChanged(function (u) {
      if (u) {
        checkStream();
        authUnsub();
      }
    });
  }
})();
