/**
 * Social Post Preview — Yoga Bible
 * Generates shareable preview links for posts pending approval.
 * Public endpoint (no auth) — accessed via token in URL.
 *
 * GET  /.netlify/functions/social-preview?id=POST_ID&tok=TOKEN
 * POST /.netlify/functions/social-preview  { action: 'generate-link', postId }  (admin)
 * POST /.netlify/functions/social-preview  { action: 'approve', id, tok }       (public)
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const crypto = require('crypto');

const POSTS_COLLECTION = 'social_posts';
const PREVIEWS_COLLECTION = 'social_post_previews';
const PREVIEW_SECRET = process.env.UNSUBSCRIBE_SECRET || 'preview-secret';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const params = event.queryStringParameters || {};
  const db = getDb();

  // Public GET — render preview page
  if (event.httpMethod === 'GET' && params.id && params.tok) {
    return renderPreview(db, params.id, params.tok);
  }

  // Admin POST actions
  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');

    // Public approve action (no auth, uses token)
    if (body.action === 'approve' && body.id && body.tok) {
      return approveViaPreview(db, body.id, body.tok);
    }

    // Admin actions require auth
    const user = await requireAuth(event, ['admin']);
    if (user.error) return user.error;

    if (body.action === 'generate-link') {
      return generatePreviewLink(db, body.postId, user.email);
    }

    return jsonResponse(400, { ok: false, error: 'Unknown action' });
  }

  return jsonResponse(405, { ok: false, error: 'Method not allowed' });
};


function generateToken(postId) {
  return crypto.createHmac('sha256', PREVIEW_SECRET)
    .update(postId)
    .digest('hex')
    .substring(0, 24);
}

function verifyToken(postId, token) {
  return generateToken(postId) === token;
}


async function generatePreviewLink(db, postId, email) {
  if (!postId) return jsonResponse(400, { ok: false, error: 'Missing postId' });

  const postDoc = await db.collection(POSTS_COLLECTION).doc(postId).get();
  if (!postDoc.exists) return jsonResponse(404, { ok: false, error: 'Post not found' });

  const token = generateToken(postId);
  const previewUrl = `https://yogabible.dk/.netlify/functions/social-preview?id=${postId}&tok=${token}`;

  // Store preview record
  await db.collection(PREVIEWS_COLLECTION).doc(postId).set({
    postId,
    token,
    previewUrl,
    createdAt: serverTimestamp(),
    createdBy: email,
    viewed: false,
    viewCount: 0,
    approvedViaPreview: false
  }, { merge: true });

  return jsonResponse(200, { ok: true, previewUrl, token });
}


async function renderPreview(db, postId, token) {
  if (!verifyToken(postId, token)) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'text/html' },
      body: '<html><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Invalid link</h1><p>This preview link is invalid or expired.</p></body></html>'
    };
  }

  const postDoc = await db.collection(POSTS_COLLECTION).doc(postId).get();
  if (!postDoc.exists) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html' },
      body: '<html><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Post not found</h1></body></html>'
    };
  }

  // Track view
  const previewRef = db.collection(PREVIEWS_COLLECTION).doc(postId);
  await previewRef.set({
    viewed: true,
    viewCount: (await previewRef.get()).data()?.viewCount + 1 || 1,
    lastViewedAt: serverTimestamp()
  }, { merge: true });

  const post = postDoc.data();
  const caption = post.caption || '';
  const hashtags = (post.hashtags || []).map(h => `#${h}`).join(' ');
  const platforms = (post.platforms || []).join(', ');
  const status = post.status || 'draft';
  const scheduled = post.scheduledAt ? new Date(post.scheduledAt._seconds ? post.scheduledAt._seconds * 1000 : post.scheduledAt).toLocaleString('da-DK') : '';
  const media = post.media || [];
  const platformCaptions = post.platformCaptions || {};

  // Build media HTML
  let mediaHtml = '';
  if (media.length) {
    mediaHtml = '<div style="display:flex;gap:8px;overflow-x:auto;padding:8px 0">';
    for (const url of media) {
      const isVideo = /\.(mp4|mov|webm)$/i.test(url);
      mediaHtml += isVideo
        ? `<video src="${url}" style="max-height:300px;border-radius:8px" controls muted></video>`
        : `<img src="${url}" style="max-height:300px;border-radius:8px" alt="">`;
    }
    mediaHtml += '</div>';
  }

  // Build platform-specific captions
  let platformCaptionsHtml = '';
  const pcEntries = Object.entries(platformCaptions);
  if (pcEntries.length) {
    platformCaptionsHtml = '<div style="margin-top:16px"><h3 style="font-size:14px;color:#6F6A66;margin-bottom:8px">Platform-Specific Captions</h3>';
    for (const [p, text] of pcEntries) {
      platformCaptionsHtml += `<div style="margin-bottom:8px"><strong style="text-transform:capitalize">${p}:</strong> <span style="color:#333">${escapeHtml(text)}</span></div>`;
    }
    platformCaptionsHtml += '</div>';
  }

  const canApprove = status === 'draft' || status === 'pending_review';
  const approveBtn = canApprove
    ? `<div style="margin-top:20px;text-align:center">
         <button onclick="approvePost()" id="approve-btn" style="background:#f75c03;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:16px;cursor:pointer;font-weight:600">Approve Post</button>
         <p id="approve-msg" style="margin-top:8px;color:#6F6A66;font-size:13px"></p>
       </div>`
    : `<div style="margin-top:16px;text-align:center;padding:10px;background:#e8f5e9;border-radius:8px"><strong>Status: ${status}</strong></div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Post Preview — Yoga Bible</title>
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #F5F3F0; min-height: 100vh; padding: 20px; }
    .card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: #0F0F0F; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
    .header svg { width: 28px; height: 28px; }
    .header h1 { color: #fff; font-size: 18px; font-weight: 600; }
    .header .badge { background: #f75c03; color: #fff; font-size: 11px; padding: 2px 10px; border-radius: 12px; margin-left: auto; }
    .body { padding: 24px; }
    .meta { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .meta .chip { font-size: 12px; padding: 4px 10px; border-radius: 20px; background: #f5f3f0; color: #6F6A66; }
    .meta .chip--platform { background: #fef3ee; color: #f75c03; }
    .caption { white-space: pre-wrap; line-height: 1.6; font-size: 15px; color: #333; margin-bottom: 12px; }
    .hashtags { color: #f75c03; font-size: 14px; margin-bottom: 16px; }
    .footer { padding: 16px 24px; border-top: 1px solid #E8E4E0; text-align: center; font-size: 12px; color: #6F6A66; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <svg viewBox="0 0 24 24" fill="none" stroke="#f75c03" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>
      <h1>Post Preview</h1>
      <span class="badge">${status.toUpperCase()}</span>
    </div>
    <div class="body">
      <div class="meta">
        ${platforms.split(', ').map(p => `<span class="chip chip--platform">${p}</span>`).join('')}
        ${scheduled ? `<span class="chip">Scheduled: ${scheduled}</span>` : ''}
      </div>
      ${mediaHtml}
      <div class="caption">${escapeHtml(caption)}</div>
      ${hashtags ? `<div class="hashtags">${hashtags}</div>` : ''}
      ${platformCaptionsHtml}
      ${post.firstComment ? `<div style="margin-top:12px;padding:10px;background:#FFFCF9;border-radius:8px;font-size:13px"><strong>First Comment:</strong> ${escapeHtml(post.firstComment)}</div>` : ''}
      ${approveBtn}
    </div>
    <div class="footer">Yoga Bible · Social Media Preview</div>
  </div>
  <script>
    async function approvePost() {
      var btn = document.getElementById('approve-btn');
      var msg = document.getElementById('approve-msg');
      btn.disabled = true;
      btn.textContent = 'Approving...';
      try {
        var res = await fetch('/.netlify/functions/social-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', id: '${postId}', tok: '${token}' })
        });
        var data = await res.json();
        if (data.ok) {
          btn.style.background = '#4caf50';
          btn.textContent = 'Approved ✓';
          msg.textContent = 'Post has been approved and will be published as scheduled.';
          msg.style.color = '#4caf50';
        } else {
          btn.textContent = 'Approve Post';
          btn.disabled = false;
          msg.textContent = data.error || 'Failed to approve';
          msg.style.color = '#e53935';
        }
      } catch (err) {
        btn.textContent = 'Approve Post';
        btn.disabled = false;
        msg.textContent = err.message;
        msg.style.color = '#e53935';
      }
    }
  </script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: html
  };
}


async function approveViaPreview(db, postId, token) {
  if (!verifyToken(postId, token)) {
    return jsonResponse(403, { ok: false, error: 'Invalid token' });
  }

  const postRef = db.collection(POSTS_COLLECTION).doc(postId);
  const postDoc = await postRef.get();
  if (!postDoc.exists) return jsonResponse(404, { ok: false, error: 'Post not found' });

  const post = postDoc.data();
  if (post.status !== 'draft' && post.status !== 'pending_review') {
    return jsonResponse(400, { ok: false, error: `Post already ${post.status}` });
  }

  await postRef.update({
    status: post.scheduledAt ? 'scheduled' : 'approved',
    approvedBy: 'preview-link',
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await db.collection(PREVIEWS_COLLECTION).doc(postId).update({
    approvedViaPreview: true,
    approvedAt: serverTimestamp()
  });

  return jsonResponse(200, { ok: true, newStatus: post.scheduledAt ? 'scheduled' : 'approved' });
}


function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
