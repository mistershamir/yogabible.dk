/**
 * OAuth Callback — Yoga Bible
 * Handles OAuth redirects from Instagram/Facebook, TikTok, and LinkedIn.
 * Exchanges authorization codes for access tokens and stores them.
 *
 * GET /.netlify/functions/oauth-callback?code=...&state=platform:token
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const {
  getInstagramAccountInfo,
  getFacebookPageInfo,
  getTikTokAccountInfo,
  getLinkedInOrgInfo
} = require('./shared/social-api');

const STATES_COLLECTION = 'oauth_states';
const ACCOUNTS_COLLECTION = 'social_accounts';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const params = event.queryStringParameters || {};
  const { code, state, error, error_description } = params;

  // Handle OAuth errors
  if (error) {
    console.error('[oauth-callback] OAuth error:', error, error_description);
    return buildRedirect('error', error_description || error);
  }

  if (!code || !state) {
    return buildRedirect('error', 'Missing code or state parameter');
  }

  // Parse state: "platform:random_token"
  const colonIdx = state.indexOf(':');
  if (colonIdx < 0) {
    return buildRedirect('error', 'Invalid state format');
  }
  const platform = state.substring(0, colonIdx);
  const stateToken = state.substring(colonIdx + 1);

  // Validate state token
  const db = getDb();
  const stateDoc = await db.collection(STATES_COLLECTION).doc(stateToken).get();

  if (!stateDoc.exists) {
    return buildRedirect('error', 'Invalid or expired state token');
  }

  const stateData = stateDoc.data();
  if (stateData.used) {
    return buildRedirect('error', 'State token already used');
  }
  if (stateData.platform !== platform) {
    return buildRedirect('error', 'State token platform mismatch');
  }
  const expiresAt = stateData.expiresAt?.toDate ? stateData.expiresAt.toDate() : new Date(stateData.expiresAt);
  if (expiresAt < new Date()) {
    return buildRedirect('error', 'State token expired');
  }

  // Mark state as used
  await db.collection(STATES_COLLECTION).doc(stateToken).update({ used: true });

  try {
    let result;

    if (platform === 'instagram' || platform === 'facebook') {
      result = await handleMetaCallback(db, platform, code);
    } else if (platform === 'tiktok') {
      result = await handleTikTokCallback(db, code);
    } else if (platform === 'linkedin') {
      result = await handleLinkedInCallback(db, code);
    } else {
      return buildRedirect('error', `Unknown platform: ${platform}`);
    }

    if (result.success) {
      return buildRedirect('success', platform);
    } else {
      return buildRedirect('error', result.error || 'Token exchange failed');
    }
  } catch (err) {
    console.error('[oauth-callback] Exception:', err);
    return buildRedirect('error', err.message);
  }
};


// ── Meta (Instagram / Facebook) ───────────────────────────────────

async function handleMetaCallback(db, platform, code) {
  const appId = process.env.META_OAUTH_APP_ID || process.env.META_APP_ID;
  const appSecret = process.env.META_OAUTH_APP_SECRET || process.env.META_APP_SECRET;
  const siteUrl = process.env.URL || 'https://yogabible.dk';
  const redirectUri = `${siteUrl}/.netlify/functions/oauth-callback`;

  if (!appId || !appSecret) {
    return { success: false, error: 'Meta OAuth not configured (missing app ID or secret)' };
  }

  // Step 1: Exchange code for short-lived user token
  const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token` +
    `?client_id=${appId}&client_secret=${appSecret}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;

  const tokenRes = await fetch(tokenUrl);
  const tokenData = await tokenRes.json();

  if (tokenData.error) {
    console.error('[oauth-callback] Meta token error:', tokenData.error);
    return { success: false, error: tokenData.error.message };
  }

  const shortToken = tokenData.access_token;

  // Step 2: Exchange for long-lived token
  const longTokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token` +
    `?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}` +
    `&fb_exchange_token=${encodeURIComponent(shortToken)}`;

  const longRes = await fetch(longTokenUrl);
  const longData = await longRes.json();
  const longToken = longData.access_token || shortToken;

  // Step 3: Get user's pages
  const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${longToken}`);
  const pagesData = await pagesRes.json();

  if (!pagesData.data || pagesData.data.length === 0) {
    return { success: false, error: 'No Facebook Pages found for this account' };
  }

  // Use the first page (or the one matching known IDs)
  const page = pagesData.data[0];
  const pageAccessToken = page.access_token;
  const pageId = page.id;
  const pageName = page.name;

  if (platform === 'instagram') {
    // Step 4: Get Instagram Business Account ID from the page
    const igRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`);
    const igData = await igRes.json();

    if (!igData.instagram_business_account) {
      return { success: false, error: 'No Instagram Business Account connected to this Page. Connect it in Meta Business Suite first.' };
    }

    const igAccountId = igData.instagram_business_account.id;

    // Save Instagram account
    const accountData = {
      platform: 'instagram',
      accessToken: pageAccessToken,
      refreshToken: null,
      pageId,
      pageName,
      igAccountId,
      organizationId: null,
      connectedAt: serverTimestamp(),
      connectedBy: 'oauth',
      lastSynced: null,
      followerCount: 0,
      name: '',
      handle: '',
      username: '',
      profilePicture: null
    };

    // Fetch account info
    const info = await getInstagramAccountInfo({ accessToken: pageAccessToken, igAccountId });
    if (info.success) {
      accountData.name = info.info.name || '';
      accountData.handle = info.info.username || '';
      accountData.username = info.info.username || '';
      accountData.followerCount = info.info.followers || 0;
      accountData.profilePicture = info.info.profilePicture || null;
      accountData.lastSynced = serverTimestamp();
    }

    await db.collection(ACCOUNTS_COLLECTION).doc('instagram').set(accountData);
    console.log('[oauth-callback] Instagram connected via OAuth');
    return { success: true };

  } else {
    // Facebook
    const accountData = {
      platform: 'facebook',
      accessToken: pageAccessToken,
      refreshToken: null,
      pageId,
      pageName,
      igAccountId: null,
      organizationId: null,
      connectedAt: serverTimestamp(),
      connectedBy: 'oauth',
      lastSynced: null,
      followerCount: 0,
      name: pageName || '',
      handle: '',
      username: '',
      profilePicture: null
    };

    const info = await getFacebookPageInfo({ accessToken: pageAccessToken, pageId });
    if (info.success) {
      accountData.name = info.info.name || pageName || '';
      accountData.handle = info.info.username || '';
      accountData.username = info.info.username || '';
      accountData.followerCount = info.info.followers || 0;
      accountData.profilePicture = info.info.picture || null;
      accountData.lastSynced = serverTimestamp();
    }

    await db.collection(ACCOUNTS_COLLECTION).doc('facebook').set(accountData);
    console.log('[oauth-callback] Facebook connected via OAuth');
    return { success: true };
  }
}


// ── TikTok ────────────────────────────────────────────────────────

async function handleTikTokCallback(db, code) {
  const clientKey = process.env.TIKTOK_OAUTH_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_OAUTH_CLIENT_SECRET;
  const siteUrl = process.env.URL || 'https://yogabible.dk';
  const redirectUri = `${siteUrl}/.netlify/functions/oauth-callback`;

  if (!clientKey || !clientSecret) {
    return { success: false, error: 'TikTok OAuth not configured' };
  }

  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    }).toString()
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error || !tokenData.access_token) {
    console.error('[oauth-callback] TikTok token error:', tokenData);
    return { success: false, error: tokenData.error_description || tokenData.error || 'Token exchange failed' };
  }

  const accountData = {
    platform: 'tiktok',
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    pageId: null,
    pageName: null,
    igAccountId: null,
    organizationId: null,
    tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
    refreshExpiresAt: tokenData.refresh_expires_in ? new Date(Date.now() + tokenData.refresh_expires_in * 1000) : null,
    connectedAt: serverTimestamp(),
    connectedBy: 'oauth',
    lastSynced: null,
    followerCount: 0,
    name: '',
    handle: '',
    username: '',
    profilePicture: null
  };

  const info = await getTikTokAccountInfo({ accessToken: tokenData.access_token });
  if (info.success) {
    accountData.name = info.info.displayName || '';
    accountData.handle = info.info.username || '';
    accountData.username = info.info.username || '';
    accountData.followerCount = info.info.followers || 0;
    accountData.profilePicture = info.info.avatarUrl || null;
    accountData.lastSynced = serverTimestamp();
  }

  await db.collection(ACCOUNTS_COLLECTION).doc('tiktok').set(accountData);
  console.log('[oauth-callback] TikTok connected via OAuth');
  return { success: true };
}


// ── LinkedIn ──────────────────────────────────────────────────────

async function handleLinkedInCallback(db, code) {
  const clientId = process.env.LINKEDIN_OAUTH_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_OAUTH_CLIENT_SECRET;
  const siteUrl = process.env.URL || 'https://yogabible.dk';
  const redirectUri = `${siteUrl}/.netlify/functions/oauth-callback`;

  if (!clientId || !clientSecret) {
    return { success: false, error: 'LinkedIn OAuth not configured' };
  }

  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    }).toString()
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error || !tokenData.access_token) {
    console.error('[oauth-callback] LinkedIn token error:', tokenData);
    return { success: false, error: tokenData.error_description || tokenData.error || 'Token exchange failed' };
  }

  // Get the user's organization memberships to find the org ID
  let organizationId = null;
  try {
    const orgRes = await fetch('https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organizationalTarget~(id,localizedName,vanityName)))', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const orgData = await orgRes.json();
    if (orgData.elements && orgData.elements.length > 0) {
      const firstOrg = orgData.elements[0]['organizationalTarget~'];
      if (firstOrg) organizationId = String(firstOrg.id);
    }
  } catch (err) {
    console.warn('[oauth-callback] Could not fetch LinkedIn orgs:', err.message);
  }

  const accountData = {
    platform: 'linkedin',
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    pageId: null,
    pageName: null,
    igAccountId: null,
    organizationId,
    tokenExpiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
    connectedAt: serverTimestamp(),
    connectedBy: 'oauth',
    lastSynced: null,
    followerCount: 0,
    name: '',
    handle: '',
    username: '',
    profilePicture: null
  };

  if (organizationId) {
    const info = await getLinkedInOrgInfo({ accessToken: tokenData.access_token, organizationId });
    if (info.success) {
      accountData.name = info.info.name || '';
      accountData.handle = info.info.vanityName || '';
      accountData.username = info.info.vanityName || '';
      accountData.followerCount = info.info.followers || 0;
      accountData.lastSynced = serverTimestamp();
    }
  }

  await db.collection(ACCOUNTS_COLLECTION).doc('linkedin').set(accountData);
  console.log('[oauth-callback] LinkedIn connected via OAuth');
  return { success: true };
}


// ── Redirect helper ───────────────────────────────────────────────

function buildRedirect(status, detail) {
  const siteUrl = process.env.URL || 'https://yogabible.dk';
  // Redirect back to admin panel with result in hash
  const redirectUrl = `${siteUrl}/admin/#social-oauth-${status}`;

  // Return a small HTML page that posts a message to the opener window
  const html = `<!DOCTYPE html>
<html><head><title>Connecting...</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage({
      type: 'social-oauth-result',
      status: '${status}',
      detail: ${JSON.stringify(detail || '')}
    }, '*');
    window.close();
  } else {
    window.location.href = '${redirectUrl}';
  }
</script>
<p>Redirecting... <a href="${redirectUrl}">Click here</a> if not redirected.</p>
</body></html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: html
  };
}
