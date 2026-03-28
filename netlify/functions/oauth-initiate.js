/**
 * OAuth Initiate — Yoga Bible
 * Redirects admin users to platform OAuth authorization pages.
 *
 * GET /.netlify/functions/oauth-initiate?platform=instagram
 * GET /.netlify/functions/oauth-initiate?platform=facebook
 * GET /.netlify/functions/oauth-initiate?platform=tiktok
 * GET /.netlify/functions/oauth-initiate?platform=linkedin
 */

const crypto = require('crypto');
const { getDb, serverTimestamp } = require('./shared/firestore');

const STATES_COLLECTION = 'oauth_states';

// Platform OAuth configs — client IDs from env vars
const PLATFORMS = {
  instagram: {
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    scope: 'instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_messages,pages_show_list,pages_read_engagement,pages_manage_posts',
    getClientId: () => process.env.META_OAUTH_APP_ID || process.env.META_APP_ID || ''
  },
  facebook: {
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    scope: 'pages_manage_posts,pages_read_engagement,pages_show_list,pages_manage_metadata',
    getClientId: () => process.env.META_OAUTH_APP_ID || process.env.META_APP_ID || ''
  },
  tiktok: {
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    scope: 'user.info.basic,video.publish,video.upload',
    getClientId: () => process.env.TIKTOK_OAUTH_CLIENT_KEY || ''
  },
  linkedin: {
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    scope: 'w_member_social w_organization_social r_organization_social openid profile',
    getClientId: () => process.env.LINKEDIN_OAUTH_CLIENT_ID || ''
  }
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const params = event.queryStringParameters || {};
  const platform = params.platform;

  if (!platform || !PLATFORMS[platform]) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Invalid platform. Supported: ${Object.keys(PLATFORMS).join(', ')}` })
    };
  }

  const config = PLATFORMS[platform];
  const clientId = config.getClientId();

  if (!clientId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `OAuth not configured for ${platform}. Set the client ID env var.` })
    };
  }

  // Generate CSRF state token
  const state = crypto.randomBytes(32).toString('hex');
  const db = getDb();

  // Store state in Firestore with 10-minute TTL
  await db.collection(STATES_COLLECTION).doc(state).set({
    platform,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    used: false
  });

  // Build redirect URI
  const siteUrl = process.env.URL || 'https://yogabible.dk';
  const redirectUri = `${siteUrl}/.netlify/functions/oauth-callback`;

  // Build authorization URL
  let authUrl;

  if (platform === 'instagram' || platform === 'facebook') {
    authUrl = `${config.authorizeUrl}?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(config.scope)}` +
      `&state=${encodeURIComponent(platform + ':' + state)}` +
      `&response_type=code`;
  } else if (platform === 'tiktok') {
    authUrl = `${config.authorizeUrl}?client_key=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(config.scope)}` +
      `&state=${encodeURIComponent(platform + ':' + state)}` +
      `&response_type=code`;
  } else if (platform === 'linkedin') {
    authUrl = `${config.authorizeUrl}?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(config.scope)}` +
      `&state=${encodeURIComponent(platform + ':' + state)}` +
      `&response_type=code`;
  }

  console.log(`[oauth-initiate] Redirecting to ${platform} OAuth`);

  return {
    statusCode: 302,
    headers: { Location: authUrl }
  };
};
