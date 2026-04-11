# Live Streaming System — Complete Audit

_Audit date: 2026-04-11_

## Part 1: File Inventory

After grepping for `live|stream|mux|livekit|rtmp|ATEM|broadcast|hls|webrtc`, 224 files matched, but most are noise (e.g. "stream" in "event stream", "broadcast nurture" for email sequences). Below are the files actually related to video live streaming:

### Core backend (Netlify Functions)
| File | Purpose |
|---|---|
| `netlify/functions/live-admin.js` | Session CRUD + MindBody import + schedule API |
| `netlify/functions/livekit-token.js` | LiveKit room create/close, JWT tokens, egress control |
| `netlify/functions/mux-stream.js` | Mux live stream create/complete/disable, teacher-sessions list |
| `netlify/functions/mux-webhook.js` | Mux webhook: live_stream.active/idle, asset.ready → triggers AI |
| `netlify/functions/live-room-cleanup.js` | Cron every 5 min — closes zombie LiveKit rooms |
| `netlify/functions/ai-process-recording-background.js` | MP4 → Deepgram → VTT → Mux subtitles → Claude summary/quiz |
| `netlify/functions/ai-backfill.js` | Admin tool: retranscribe, debug, MP4 status |
| `netlify/functions/deepgram-webhook.js` | Async Deepgram callback (separate path from in-process call) |
| `netlify/functions/serve-vtt.js` | Serves VTT from Firestore so Mux can ingest it |

### Frontend (JS + templates)
| File | Purpose |
|---|---|
| `src/js/live.js` | Viewer page: polls schedule, connects to LiveKit, shows Mux player |
| `src/js/live-admin.js` | Admin Live tab: CRUD, MB import, AI content editing |
| `src/js/teacher-studio.js` | Browser-based streaming UI: camera preview, device select, go-live/end |
| `src/live.njk` / `src/en/live.njk` | Route wrappers (DA/EN) |
| `src/_includes/pages/live.njk` | Viewer page template (public) |
| `src/teacher-studio.njk` / `src/en/teacher-studio.njk` | Route wrappers |
| `src/_includes/pages/teacher-studio.njk` | Teacher studio HTML (auth-gated) |
| `src/_includes/partials/admin-live-panel.njk` | Admin Live tab HTML |
| `src/_data/i18n/live.json` | Viewer translations |
| `src/_data/i18n/teacher-studio.json` | Teacher studio translations |
| `src/css/teacher-studio.css` | Teacher studio styles (`.yts-`) |
| `src/css/admin-panel.css` | Admin panel styles incl. status badges |
| `src/css/main.css` | Live badge + viewer page styles |

### Config
| File | Purpose |
|---|---|
| `netlify.toml` | Scheduled function `live-room-cleanup` every 5 min; CSP allows `*.livekit.cloud` + `*.mux.com` |

**Not present:** No ATEM/RTMP-specific files. No dedicated live-stream Firestore helpers. No viewer analytics module.

---

## Part 2: Architecture

### Stack
- **Mux** — Recording backend. Live streams pushed via WHIP (indirectly through LiveKit egress), recordings processed into MP4 + HLS. No signed playback (public playback IDs).
- **LiveKit Cloud** — Real-time video transport. All 4 stream types run through it. Room composite egress pushes to Mux RTMP for recording.
- **Deepgram** — Transcription (Nova-2). Called both in-process (from `ai-process-recording-background.js`) and via separate webhook (`deepgram-webhook.js`) — two parallel paths exist.
- **Claude (Anthropic)** — Summary + bilingual quiz generation.
- **ATEM Mini Pro** — 🔴 **Referenced in comments only**. No actual integration: no IP/stream-key config, no device detection, no ATEM-specific flow. It could theoretically push RTMP to Mux, but nothing in code handles this.
- **Google Meet** — `streamType: 'meet'` renders an iframe from `meetingUrl` field; no LiveKit.

### Stream lifecycle
1. **Create** — Admin fills form in `admin-live-panel.njk` → `live-admin.js:176-236` POSTs to Firestore `live-schedule` with `status: 'scheduled'`.
2. **Go live** — Teacher opens `/teacher-studio/` → picks session → `teacher-studio.js:723` POSTs to `livekit-token.js?action=create-room`. That endpoint (livekit-token.js:250) creates LiveKit room, then `livekit-token.js:313` creates Mux live stream, then `livekit-token.js:327` starts room-composite egress from LiveKit → Mux RTMP. Session doc updated with `livekitRoom`, `muxLiveStreamId`, `muxPlaybackId`, `status:'live'`.
3. **View** — `/live/` page polls `live-admin.js?action=schedule` every 5–15s. For each live session, `live.js` either: (broadcast) requests viewer-token from `livekit-token.js`, joins LiveKit subscribe-only, attaches Mux player; (interactive/panel) requests publish-token, joins with camera/mic.
4. **End** — Teacher clicks End Stream → `livekit-token.js:514-593` stops egress, completes Mux stream, deletes LiveKit room. Session → `status:'ended'`.
5. **Recording** — Mux fires `video.asset.ready` → `mux-webhook.js:405` calls `triggerAiProcessing` → `ai-process-recording-background.js` resolves MP4, sends to Deepgram, writes VTT to Firestore, uploads subtitle track to Mux via `serve-vtt.js`, generates bilingual summary+quiz with Claude, saves to session doc.
6. **Cleanup** — Cron `live-room-cleanup.js` every 5 min scans LiveKit rooms with no participants, marks `_zombieDetectedAt`, closes after 2nd pass.

### Admin vs Viewer experience
- **Viewer page** (`src/_includes/pages/live.njk`) is **PUBLIC**, not auth-gated at the template level. Client-side JS filters which sessions are visible by permission. Interactive sessions reject unauthenticated users client-side.
- **Teacher studio** (`src/_includes/pages/teacher-studio.njk:21-32`) has a CSS-only auth gate; JS enforces `teacher/admin` role. If JS fails to load, the gate still hides controls but is not a hard security boundary.

---

## Part 3: Feature Inventory

| Feature | State | Evidence |
|---|---|---|
| Stream creation & config | ✅ | `live-admin.js:176-236` |
| Go live / end stream | ✅ | `livekit-token.js:211-374`, `514-593` |
| Broadcast one-way | ✅ | `live.js`, LiveKit subscribe-only token |
| Interactive sessions | ✅ | `teacher-studio.js:1008-1089`, chat + hand raise |
| Panel sessions (multi-host) | ⚠️ | Email whitelist in `coTeachers`; works but no dynamic add/remove mid-stream |
| Google Meet embed | ✅ | Iframe from `meetingUrl` field |
| ATEM Mini Pro / RTMP push | ❌ | Not implemented. Comments only (`mux-webhook.js:11`) |
| Multi-camera switching | ⚠️ | `teacher-studio.js:425-506` allows device swap, republishes track. No multi-source mixing. |
| Auto-record to Mux | ✅ | `livekit-token.js:327` room composite egress |
| Recording → VOD | ✅ | `recordingPlaybackId` stored, shown on `/live/` |
| Deepgram transcription | ✅ | `ai-process-recording-background.js` |
| VTT subtitles on Mux | ✅ | Fallback for empty utterances handled |
| AI summary + quiz (bilingual) | ✅ | Claude called with DA+EN prompt |
| Viewer count | ⚠️ | `live.js:347-354` counts LiveKit participants; no persistence, no historical peak |
| Stream health monitoring | ❌ | No bitrate/dropped-frames dashboard |
| Scheduled streams | ✅ | `startDateTime` field, recurrence options |
| Pre-stream notifications | ❌ | No email/SMS sent before scheduled sessions |
| Countdown / waiting room | ❌ | Offline state shown until stream active |
| Chat during stream | ⚠️ | Interactive only; `teacher-studio.js:1059` has HTML injection risk |
| Screen sharing | ❌ | LiveKit supports it, no UI button |
| Access control (roles + cohorts) | ✅ | `live-admin.js:305-340`, bulk permission UI |
| Replay / VOD | ✅ | Mux player on `/live/` |
| Adaptive bitrate / quality selector | ⚠️ | Teacher has 480/720/1080p presets (`teacher-studio.js:323-348`); viewer has no selector; Mux HLS handles ABR automatically |
| Mobile viewing | ✅ | Responsive CSS + Mux player |
| Kick / mute / ban viewers | ❌ | No moderation UI |
| Stream analytics (watch time, peak) | ❌ | No data captured |
| Live captions during broadcast | ❌ | VTT only post-recording |
| Live polls / reactions / Q&A | ❌ | None |
| Custom RTMP to YouTube/FB | ❌ | Mux only |

---

## Part 4: Bugs & Issues

### 🔴 Critical

**1. Duplicate Deepgram transcription via concurrent webhook firings**
`mux-webhook.js:405-411` checks `aiStatus` then calls `triggerAiProcessing` as fire-and-forget. There's no Firestore transaction between the read and the trigger. Mux webhook retries or multiple `asset.ready` events can fire parallel transcriptions. Deepgram is billed per minute — a 4h recording processed twice costs ~$2.40 instead of $1.20, plus conflicting transcripts overwrite each other.

**2. Duplicate LiveKit egress creation**
`livekit-token.js:293-307` wraps `ListEgress` in try/catch; if it fails, `hasActiveEgress` stays `false` and the code creates a **second** egress on the same room. Both record the same session to Mux → duplicate recordings, duplicate asset IDs, confused Firestore.

**3. Race condition in room auto-close**
`livekit-token.js:172-177` stops old egresses + deletes room for a stale session but does **not await** completion before creating the new room. A new `StartRoomCompositeEgress` call can race the cleanup and hit a room that's about to be deleted.

**4. Webhook signature verification bypass when secret is empty**
`mux-webhook.js:39-62`: `if (!secret) return true;` — if `MUX_WEBHOOK_SECRET` env var is empty/unset in any environment, ANY unsigned POST is trusted. An attacker could post fake `live_stream.active` events to mark arbitrary sessions live.

**5. `serve-vtt.js` auth bypass when secret unset**
`serve-vtt.js:27-30`: `if (expected && secret !== expected)` — when `AI_INTERNAL_SECRET` is empty, the `expected &&` short-circuits and auth is skipped entirely. VTT content for any session becomes public. Firestore doc IDs are guessable from the `/live/` page.

**6. `deepgram-webhook.js:30` same empty-secret bypass pattern**
Same flaw as #5 — empty `AI_INTERNAL_SECRET` allows anyone to POST arbitrary transcripts into Firestore, overwriting real transcripts.

**7. `handleSetLive` missing auth guard**
`live-admin.js:59` dispatches `action=set-live` **before** any `requireAuth` call (the admin auth block comes later at line 66+). Any authenticated user (including trainees) can call `POST /.netlify/functions/live-admin?action=set-live&sessionId=...` and flip a session to live.

**8. Chat XSS in interactive/panel mode**
`teacher-studio.js:1059` renders incoming chat `msg.text` from LiveKit DataChannel without HTML escaping. Any participant can send `<script>` tags; the teacher studio evaluates them in the teacher's browser context.

### 🟡 Medium

**9. `handleStartEgress` has no idempotency lock**
`livekit-token.js:600-640` validates session + room but not that another egress is already running. Running it twice = two egresses, two recordings.

**10. MP4 rendition has no timeout**
`ai-process-recording-background.js` calls `ensureMp4Rendition` with no wall-clock timeout. If Mux stalls the MP4 generation, the Netlify background function runs until its 15-min limit expires and the session gets stuck in `aiStatus: 'preparing_audio'`.

**11. VTT truncation silently drops subtitles**
`ai-process-recording-background.js:129-135` truncates VTT to 900KB without warning. On a 4-5h recording the last 30-60 min have no subtitles, and no flag is stored on the session doc so admins don't know.

**12. Deepgram-webhook has hardcoded domain**
`deepgram-webhook.js:139-143` calls `https://yogabible.dk/.netlify/functions/ai-backfill` with hardcoded hostname. Breaks on preview deployments, branch deploys, and any domain change.

**13. `_zombieDetectedAt` marker never cleared if room never recovers**
`live-room-cleanup.js:172-177` sets the marker but only clears it when the room fills up again. If the room empties permanently, the marker persists indefinitely, polluting the doc with an internal field.

**14. Viewer page is public by default**
`src/_includes/pages/live.njk` renders without template-level auth. All gating is client-side in `live.js`. Anyone who can read the page source sees all session titles and playback IDs. Mux playback is public (no signed playback policy), so a leaked `recordingPlaybackId` is streamable forever.

**15. `mux-webhook.js:156` 12-hour backward match window**
Sessions started near midnight can be matched to the wrong calendar day. Comment says "same day" but code actually matches ±12h.

**16. No rate limiting on `livekit-token.js`**
`netlify.toml` has no rate-limit config. A loop can create hundreds of LiveKit rooms; since room creation provisions Mux streams too, this burns money fast.

**17. Parallel Deepgram code paths**
Both `ai-process-recording-background.js` (synchronous Deepgram call) and `deepgram-webhook.js` (async webhook callback) exist. Unclear which is canonical — risk of both firing for the same asset.

### 🟢 Minor

**18. `live.js:221-229` swallows all LiveKit errors as "offline"** — network glitch looks identical to "stream not live".

**19. `teacher-studio.njk:208` loads LiveKit SDK from `unpkg.com`** — no SRI hash, no fallback, single point of failure.

**20. Quality selector constraints don't validate against camera capabilities** — `teacher-studio.js:323-348` requests 1080p without checking `getCapabilities()`; falls back silently.

**21. `teacher-studio.js:1011, 1022` references `isEgressOrDuplicate()`** — verify it's defined; may be a dead reference.

**22. `mux-stream.js` and `livekit-token.js` both create Mux live streams** — two paths for stream creation exist. Unclear which is the current canonical flow; `mux-stream.js` looks like the older direct-to-Mux path, `livekit-token.js:313` is the newer LiveKit-egress path.

---

## Part 5: Admin Panel Capabilities

From `admin-live-panel.njk` + `live-admin.js`:
- ✅ CRUD sessions (bilingual title/description, instructor, teacherEmail, datetime, duration)
- ✅ Stream type selector: broadcast / interactive / panel / meet
- ✅ Source selector: manual / mindbody (MB import fetches classes, manual mapping)
- ✅ Recurrence: weekly / biweekly / every3weeks / every4weeks
- ✅ Access control: role + permission checkboxes (live-streaming, recordings, gated-content, materials tiers, methods, courses, mentorship)
- ✅ Cohort restrictions (freeform text — no validation)
- ✅ Bulk operations (set access, delete)
- ✅ Mux playback ID + recording asset ID editable
- ✅ Co-teachers email whitelist (for panel mode)
- ✅ Google Meet URL field
- ✅ AI content editing (summary DA/EN, quiz DA/EN) once session is ended
- ❌ No viewer moderation (kick/mute/ban)
- ❌ No analytics dashboard (peak viewers, watch time, engagement)
- ❌ No stream health metrics
- ❌ No live preview of ongoing stream from admin panel

---

## Part 6: External Services — Actually Used vs Referenced

| Service | Status | Evidence |
|---|---|---|
| **Mux** | ✅ Heavily used | Live streams (`livekit-token.js:313`, `mux-stream.js:117`), webhook (`mux-webhook.js`), subtitle upload, asset lifecycle |
| **LiveKit Cloud** | ✅ Primary transport | Every stream type runs through it; `livekit-token.js` uses CreateRoom, ListEgress, StartRoomCompositeEgress, StopEgress, DeleteRoom, ListParticipants, ListRooms |
| **ATEM Mini Pro** | ❌ Not integrated | Only mentioned in `mux-webhook.js:11` comment. No code path for ATEM-as-source |
| **Deepgram** | ✅ Used | Nova-2 for transcription; two call paths (in-process + webhook) |
| **Claude (Anthropic)** | ✅ Used | Summary + bilingual quiz |
| **Google Meet** | ✅ Iframe only | No API integration, just embed |
| **No signed playback** | ⚠️ | Mux playback policies set to `public` — URLs freely shareable |

---

## Part 7: Data Model

### Collections

**`live-schedule`** — single source of truth
```
id, source ('manual'|'mindbody'), status ('scheduled'|'live'|'ended'|'cancelled'),
title_da, title_en, description_da, description_en,
startDateTime, endDateTime, duration, instructor, teacherEmail,
streamType ('broadcast'|'interactive'|'panel'|'meet'),
streamSource ('remote'|'studio'|'atem'),
meetingUrl, coTeachers[],
livekitRoom, liveStartedAt, liveEndedAt,
muxLiveStreamId, muxPlaybackId, muxStreamKey,
recordingPlaybackId, recordingAssetId,
access { roles[], permissions[] }, cohorts[],
mbClassId, mbClassName, mbProgramId, mbSessionTypeId,
recurrence { type, endDate },
aiStatus, aiTranscript, aiSummary_da, aiSummary_en, aiQuiz_da, aiQuiz_en,
aiCaptionTrackId, captionVtt, captionLang, aiError, aiProcessedAt,
_zombieDetectedAt, _autoClosedByCleanup
```

**`live-unmatched-recordings`** — orphan recordings (stream couldn't be matched to a session)

### Document lifecycle
```
scheduled → live (go-live) → ended (idle webhook)
                            → asset.ready → aiStatus: processing
                            → preparing_audio → transcribing
                            → uploading_subtitles → generating_summary
                            → translating → complete
                            → (or) error / no_transcript
```

### Recording storage
Recordings live in Mux (asset ID + public playback ID). VTT content lives in Firestore (`captionVtt` field, ≤900KB). VTT subtitle track ID stored as `aiCaptionTrackId`. Mux ingests VTT by fetching `serve-vtt.js` URL.

---

## Part 8: Performance & Scalability

- **Concurrent viewers**: LiveKit Cloud scales, Mux CDN handles HLS fan-out. Realistic ceiling: 1000s.
- **Latency**: Mux `latency_mode: 'low'` hardcoded → ~3-5s glass-to-glass.
- **Cost exposure**: No rate limiting + no Deepgram/Claude usage caps + duplicate transcription bug = billing risk.
- **CDN**: Mux global + LiveKit edge.
- **Cleanup cron**: Max 5 min latency on zombie-room closure (acceptable).

---

## Part 9: What's Missing for a Professional Setup

- ❌ Countdown / waiting-room before stream goes live
- ❌ Pre-stream email/SMS notifications to registered viewers
- ❌ Live captions during broadcast (VTT only on recording)
- ❌ Screen sharing button in teacher studio UI
- ❌ Multi-host add/remove mid-stream (panel mode is static)
- ❌ Audience reactions / polls / live Q&A
- ❌ Viewer analytics dashboard (peak, watch time, retention, drop-off)
- ❌ Stream health dashboard (bitrate, dropped frames, reconnect rate)
- ❌ Moderation tools (kick, mute, ban)
- ❌ Calendar integration (Google/Outlook sync, .ics download)
- ❌ Custom RTMP destinations (simulcast to YouTube/FB)
- ❌ DVR / rewind during live stream
- ❌ Watermark / logo overlay
- ❌ Signed playback policies (recordings are public by default)
- ❌ Billing usage alerts on Deepgram + Claude + Mux

---

## Prioritized Punch List (Top 10)

| # | Severity | Issue | File:Line |
|---|---|---|---|
| 1 | 🔴 | `handleSetLive` runs before auth check — any authed user can mark sessions live | `live-admin.js:59` |
| 2 | 🔴 | Webhook signature verification bypassed when secret empty | `mux-webhook.js:39-62` |
| 3 | 🔴 | `serve-vtt.js` + `deepgram-webhook.js` auth bypassed when secret empty | `serve-vtt.js:27-30`, `deepgram-webhook.js:30` |
| 4 | 🔴 | Duplicate Deepgram transcription via concurrent webhooks | `mux-webhook.js:405-411` + `ai-process-recording-background.js:57-64` |
| 5 | 🔴 | Duplicate LiveKit egress when `ListEgress` fails | `livekit-token.js:293-307` |
| 6 | 🔴 | Chat XSS in teacher studio interactive mode | `teacher-studio.js:1059` |
| 7 | 🔴 | Room auto-close race condition (no await) | `livekit-token.js:172-177` |
| 8 | 🟡 | Viewer page is public with client-side-only gating; Mux playback unsigned | `src/_includes/pages/live.njk`, Mux config |
| 9 | 🟡 | VTT truncation silently drops last hour of subtitles | `ai-process-recording-background.js:129-135` |
| 10 | 🟡 | Two parallel Deepgram code paths (in-process + webhook) — unclear canonical | `ai-process-recording-background.js` + `deepgram-webhook.js` |

**Bottom line:** The system is **functionally complete for broadcast + recording + transcription**, but has serious auth/race/cost bugs (items 1-7 are all exploitable), is missing everything viewer-facing a pro setup needs (countdown, notifications, moderation, analytics), and the ATEM Mini Pro "integration" is vapor — there is no code for it.

---

## Addendum: Fixes Applied (2026-04-11)

Seven critical bugs (items 1–7 in the punch list above) were fixed in commit `97f4ca76`:

| # | File | Fix |
|---|---|---|
| 1 | `live-admin.js` | Dispatcher verifies `teacher\|admin` auth before calling `handleSetLive`; duplicate inner check removed |
| 2 | `mux-webhook.js` | `verifySignature` returns `false` (not `true`) when `MUX_WEBHOOK_SECRET` unset; caller no longer short-circuits |
| 3 | `serve-vtt.js` + `deepgram-webhook.js` | Both reject with 401 when `AI_INTERNAL_SECRET` unset |
| 4 | `mux-webhook.js` | New `claimAiProcessingSlot()` uses `db.runTransaction` to atomically lock `aiStatus='processing'`; used by both `handleAssetReady` and `reconcileUnmatchedRecordings` |
| 5 | `livekit-token.js` | On `ListEgress` failure, assume egress exists and skip creation |
| 6 | `teacher-studio.js` + `live.js` | Chat renders via `document.createElement` + `textContent` per span — no more `innerHTML` with string interpolation |
| 7 | `livekit-token.js` | Each `StopEgress` awaited with per-op logging, `DeleteRoom` awaited, plus 500ms settle before new room creation |

Medium and minor items (8–22) remain open.
