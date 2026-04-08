/**
 * Social Accounts API — Yoga Bible
 * Manages social media account connections in Firestore.
 *
 * GET  /.netlify/functions/social-accounts?action=list
 * GET  /.netlify/functions/social-accounts?action=connect&platform=instagram
 * POST /.netlify/functions/social-accounts  { action: 'save-token', platform, accessToken, ... }
 * POST /.netlify/functions/social-accounts  { action: 'disconnect', platform }
 * POST /.netlify/functions/social-accounts  { action: 'refresh' }
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const {
  getInstagramAccountInfo,
  getFacebookPageInfo,
  getTikTokAccountInfo,
  getLinkedInOrgInfo,
  getYouTubeChannelInfo,
  getPinterestAccountInfo
} = require('./shared/social-api');

const COLLECTION = 'social_accounts';
const VALID_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'pinterest'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    if (event.httpMethod === 'GET') {
      const action = params.action || 'list';
      if (action === 'list') return listAccounts(db);
      if (action === 'connect') return connectGuide(params.platform);
      return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action || params.action;

      switch (action) {
        case 'save-token': return saveToken(db, body, user);
        case 'disconnect': return disconnect(db, body);
        case 'refresh': return refreshAccounts(db);
        default:
          return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
      }
    }

    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[social-accounts] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── List all connected accounts (tokens stripped) ───────────────

async function listAccounts(db) {
  const snap = await db.collection(COLLECTION).get();
  const accounts = [];

  snap.forEach(doc => {
    const data = doc.data();
    accounts.push({
      id: doc.id,
      platform: data.platform || doc.id,
      name: data.name || data.pageName || '',
      handle: data.handle || data.username || '',
      followerCount: data.followerCount || 0,
      connectedAt: data.connectedAt?.toDate?.() || data.connectedAt || null,
      lastSynced: data.lastSynced?.toDate?.() || data.lastSynced || null,
      pageId: data.pageId || null,
      igAccountId: data.igAccountId || null,
      channelId: data.channelId || null,
      boardId: data.boardId || null,
      profilePicture: data.profilePicture || null,
      hasRefreshToken: !!data.refreshToken,
      refreshToken: !!data.refreshToken,
      lastError: data.lastError || null,
      lastTokenRefresh: data.lastTokenRefresh?.toDate?.() || data.lastTokenRefresh || null
    });
  });

  return jsonResponse(200, { ok: true, accounts });
}


// ── Connect guide (OAuth not yet implemented) ───────────────────

function connectGuide(platform) {
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return jsonResponse(400, {
      ok: false,
      error: `Invalid platform. Supported: ${VALID_PLATFORMS.join(', ')}`
    });
  }

  const guides = {
    instagram: {
      platform: 'instagram',
      steps: [
        '1. Go to Meta Business Suite → Settings → Business Assets → Pages',
        '2. Connect your Instagram Professional account to your Facebook Page',
        '3. Go to developers.facebook.com → Your App → Tools → Graph API Explorer',
        '4. Select your app, then request permissions: instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement',
        '5. Generate a long-lived page access token',
        '6. Find your Instagram Business Account ID via: GET /{page-id}?fields=instagram_business_account',
        '7. Use the "save-token" action to store: accessToken, igAccountId'
      ]
    },
    facebook: {
      platform: 'facebook',
      steps: [
        '1. Go to developers.facebook.com → Your App → Tools → Graph API Explorer',
        '2. Select your app, then request permissions: pages_manage_posts, pages_read_engagement, pages_show_list',
        '3. Generate a User Access Token, then exchange it for a Page Access Token',
        '4. Convert to a long-lived token via: GET /oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-lived-token}',
        '5. Get your Page ID via: GET /me/accounts',
        '6. Use the "save-token" action to store: accessToken, pageId, pageName'
      ]
    },
    tiktok: {
      platform: 'tiktok',
      steps: [
        '1. Go to developers.tiktok.com → Manage Apps → Create or select your app',
        '2. Add the "Content Posting API" and "TikTok Account" products',
        '3. Submit your app for review (required for content posting)',
        '4. Once approved, go to Authorization → generate an access token with scopes: video.publish, video.upload, user.info.basic',
        '5. Use the "save-token" action to store: accessToken'
      ]
    },
    linkedin: {
      platform: 'linkedin',
      steps: [
        '1. Go to linkedin.com/developers → Create or select your app',
        '2. Under Products, request access to "Share on LinkedIn" and "Sign In with LinkedIn"',
        '3. Under Auth, note your Client ID and Client Secret',
        '4. Generate an access token with scopes: w_member_social, w_organization_social, r_organization_social',
        '5. Get your Organization ID from your LinkedIn Company Page URL (e.g., linkedin.com/company/12345)',
        '6. Use the "save-token" action to store: accessToken, organizationId'
      ]
    },
    youtube: {
      platform: 'youtube',
      steps: [
        '1. Go to console.cloud.google.com → APIs & Services → Credentials',
        '2. The OAuth 2.0 client "YogaBibleNetlifyProject" is already configured',
        '3. Go to OAuth consent screen → ensure youtube.upload and youtube.readonly scopes are added',
        '4. Use the OAuth playground or your app to get an authorization code',
        '5. Exchange the code for access_token + refresh_token',
        '6. Use the "save-token" action to store: accessToken, refreshToken, channelId (optional)'
      ]
    },
    pinterest: {
      platform: 'pinterest',
      steps: [
        '1. Go to developers.pinterest.com → Create or select your app',
        '2. Request access to scopes: pins:read, pins:write, boards:read, user_accounts:read',
        '3. Set redirect URI to: https://yogabible.dk/admin/',
        '4. Generate an access token via the OAuth 2.0 flow',
        '5. Optionally note a Board ID to pin to a specific board',
        '6. Use the "save-token" action to store: accessToken, boardId (optional)'
      ]
    }
  };

  return jsonResponse(200, { ok: true, guide: guides[platform] });
}


// ── Save access token for a platform ────────────────────────────

async function saveToken(db, body, user) {
  const { platform, accessToken, refreshToken, pageId, pageName, igAccountId, organizationId, channelId, boardId } = body;

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return jsonResponse(400, { ok: false, error: `Invalid platform. Supported: ${VALID_PLATFORMS.join(', ')}` });
  }

  if (!accessToken) {
    return jsonResponse(400, { ok: false, error: 'Missing accessToken' });
  }

  if (platform === 'instagram' && !igAccountId) {
    return jsonResponse(400, { ok: false, error: 'Instagram requires igAccountId' });
  }

  if (platform === 'facebook' && !pageId) {
    return jsonResponse(400, { ok: false, error: 'Facebook requires pageId' });
  }

  if (platform === 'linkedin' && !organizationId) {
    return jsonResponse(400, { ok: false, error: 'LinkedIn requires organizationId' });
  }

  // Build account document
  // TODO: Tokens should be encrypted at rest using a key management strategy
  // (e.g., AES-256-GCM with a KMS-managed key). Currently stored as plaintext
  // in Firestore. listAccounts() correctly strips tokens from API responses,
  // but the raw Firestore documents contain them. Ensure Firestore security
  // rules prevent non-admin reads of the social_accounts collection.
  const accountData = {
    platform,
    accessToken,
    refreshToken: refreshToken || null,
    pageId: pageId || null,
    pageName: pageName || null,
    igAccountId: igAccountId || null,
    organizationId: organizationId || null,
    channelId: channelId || null,
    boardId: boardId || null,
    connectedAt: serverTimestamp(),
    connectedBy: user.email,
    lastSynced: null,
    followerCount: 0,
    name: '',
    handle: '',
    username: '',
    profilePicture: null
  };

  // Try to fetch account info immediately
  try {
    if (platform === 'instagram') {
      const info = await getInstagramAccountInfo({ accessToken, igAccountId });
      if (info.success) {
        accountData.name = info.info.name || '';
        accountData.handle = info.info.username || '';
        accountData.username = info.info.username || '';
        accountData.followerCount = info.info.followers || 0;
        accountData.profilePicture = info.info.profilePicture || null;
        accountData.lastSynced = serverTimestamp();
      }
    } else if (platform === 'facebook') {
      const info = await getFacebookPageInfo({ accessToken, pageId });
      if (info.success) {
        accountData.name = info.info.name || pageName || '';
        accountData.handle = info.info.username || '';
        accountData.username = info.info.username || '';
        accountData.followerCount = info.info.followers || 0;
        accountData.profilePicture = info.info.picture || null;
        accountData.lastSynced = serverTimestamp();
      }
    } else if (platform === 'tiktok') {
      const info = await getTikTokAccountInfo({ accessToken });
      if (info.success) {
        accountData.name = info.info.displayName || '';
        accountData.handle = info.info.username || '';
        accountData.username = info.info.username || '';
        accountData.followerCount = info.info.followers || 0;
        accountData.profilePicture = info.info.avatarUrl || null;
        accountData.lastSynced = serverTimestamp();
      }
    } else if (platform === 'linkedin') {
      const info = await getLinkedInOrgInfo({ accessToken, organizationId });
      if (info.success) {
        accountData.name = info.info.name || '';
        accountData.handle = info.info.vanityName || '';
        accountData.username = info.info.vanityName || '';
        accountData.followerCount = info.info.followers || 0;
        accountData.lastSynced = serverTimestamp();
      }
    } else if (platform === 'youtube') {
      const info = await getYouTubeChannelInfo({ accessToken, refreshToken });
      if (info.success) {
        accountData.name = info.info.name || '';
        accountData.handle = info.info.username || '';
        accountData.username = info.info.username || '';
        accountData.channelId = info.info.channelId || channelId || null;
        accountData.followerCount = info.info.followers || 0;
        accountData.profilePicture = info.info.profilePicture || null;
        accountData.lastSynced = serverTimestamp();
        // Store refreshed access token if applicable
        if (info.refreshedToken) {
          accountData.accessToken = info.refreshedToken;
        }
      }
    } else if (platform === 'pinterest') {
      const info = await getPinterestAccountInfo({ accessToken });
      if (info.success) {
        accountData.name = info.info.name || '';
        accountData.handle = info.info.username || '';
        accountData.username = info.info.username || '';
        accountData.followerCount = info.info.followers || 0;
        accountData.profilePicture = info.info.profilePicture || null;
        accountData.lastSynced = serverTimestamp();
      }
    }
  } catch (err) {
    console.warn('[social-accounts] Could not fetch account info on connect:', err.message);
  }

  // Store using platform as document ID (one account per platform)
  await db.collection(COLLECTION).doc(platform).set(accountData);

  console.log('[social-accounts] Saved token for', platform, 'by', user.email);

  return jsonResponse(200, {
    ok: true,
    platform,
    name: accountData.name,
    handle: accountData.handle,
    followerCount: accountData.followerCount
  });
}


// ── Disconnect account ──────────────────────────────────────────

async function disconnect(db, body) {
  const { platform } = body;

  if (!platform) {
    return jsonResponse(400, { ok: false, error: 'Missing platform' });
  }

  const docRef = db.collection(COLLECTION).doc(platform);
  const doc = await docRef.get();

  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: `No connected ${platform} account` });
  }

  await docRef.delete();
  console.log('[social-accounts] Disconnected:', platform);

  return jsonResponse(200, { ok: true, disconnected: platform });
}


// ── Refresh account metrics ─────────────────────────────────────

async function refreshAccounts(db) {
  const snap = await db.collection(COLLECTION).get();

  if (snap.empty) {
    return jsonResponse(200, { ok: true, message: 'No connected accounts', refreshed: [] });
  }

  const refreshed = [];
  const errors = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const platform = data.platform || doc.id;

    try {
      let update = { lastSynced: serverTimestamp() };

      if (platform === 'instagram' && data.accessToken && data.igAccountId) {
        const info = await getInstagramAccountInfo({
          accessToken: data.accessToken,
          igAccountId: data.igAccountId
        });

        if (info.success) {
          update.followerCount = info.info.followers || 0;
          update.name = info.info.name || data.name;
          update.handle = info.info.username || data.handle;
          update.username = info.info.username || data.username;
          update.profilePicture = info.info.profilePicture || data.profilePicture;
        } else {
          errors.push({ platform, error: info.error });
          continue;
        }
      } else if (platform === 'facebook' && data.accessToken && data.pageId) {
        const info = await getFacebookPageInfo({
          accessToken: data.accessToken,
          pageId: data.pageId
        });

        if (info.success) {
          update.followerCount = info.info.followers || 0;
          update.name = info.info.name || data.name;
          update.handle = info.info.username || data.handle;
          update.username = info.info.username || data.username;
          update.profilePicture = info.info.picture || data.profilePicture;
        } else {
          errors.push({ platform, error: info.error });
          continue;
        }
      } else if (platform === 'tiktok' && data.accessToken) {
        const info = await getTikTokAccountInfo({
          accessToken: data.accessToken
        });

        if (info.success) {
          update.followerCount = info.info.followers || 0;
          update.name = info.info.displayName || data.name;
          update.handle = info.info.username || data.handle;
          update.username = info.info.username || data.username;
          update.profilePicture = info.info.avatarUrl || data.profilePicture;
        } else {
          errors.push({ platform, error: info.error });
          continue;
        }
      } else if (platform === 'linkedin' && data.accessToken && data.organizationId) {
        const info = await getLinkedInOrgInfo({
          accessToken: data.accessToken,
          organizationId: data.organizationId
        });

        if (info.success) {
          update.followerCount = info.info.followers || 0;
          update.name = info.info.name || data.name;
          update.handle = info.info.vanityName || data.handle;
          update.username = info.info.vanityName || data.username;
        } else {
          errors.push({ platform, error: info.error });
          continue;
        }
      } else if (platform === 'youtube' && data.accessToken) {
        const info = await getYouTubeChannelInfo({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken
        });

        if (info.success) {
          update.followerCount = info.info.followers || 0;
          update.name = info.info.name || data.name;
          update.handle = info.info.username || data.handle;
          update.username = info.info.username || data.username;
          update.profilePicture = info.info.profilePicture || data.profilePicture;
          if (info.refreshedToken) {
            update.accessToken = info.refreshedToken;
          }
        } else {
          errors.push({ platform, error: info.error });
          continue;
        }
      } else if (platform === 'pinterest' && data.accessToken) {
        const info = await getPinterestAccountInfo({
          accessToken: data.accessToken
        });

        if (info.success) {
          update.followerCount = info.info.followers || 0;
          update.name = info.info.name || data.name;
          update.handle = info.info.username || data.handle;
          update.username = info.info.username || data.username;
          update.profilePicture = info.info.profilePicture || data.profilePicture;
        } else {
          errors.push({ platform, error: info.error });
          continue;
        }
      } else {
        errors.push({ platform, error: 'Missing credentials' });
        continue;
      }

      await doc.ref.update(update);
      refreshed.push({ platform, followerCount: update.followerCount });
    } catch (err) {
      console.error(`[social-accounts] Refresh error for ${platform}:`, err.message);
      errors.push({ platform, error: err.message });
    }
  }

  console.log('[social-accounts] Refreshed:', refreshed.length, 'errors:', errors.length);
  return jsonResponse(200, { ok: true, refreshed, errors });
}
