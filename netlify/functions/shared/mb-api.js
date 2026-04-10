/**
 * Mindbody API v6 - Shared Helper
 * All API calls go through this module to centralize auth and headers.
 */

const MB_BASE = 'https://api.mindbodyonline.com/public/v6';

// In-memory token cache (works when Netlify reuses warm containers)
let cachedToken = null;
let tokenExpiry = 0;

function getBaseHeaders() {
  return {
    'Content-Type': 'application/json',
    'Api-Key': process.env.MB_API_KEY,
    'SiteId': process.env.MB_SITE_ID
  };
}

function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = 0;
}

async function getStaffToken() {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const res = await fetch(`${MB_BASE}/usertoken/issue`, {
    method: 'POST',
    headers: getBaseHeaders(),
    body: JSON.stringify({
      Username: process.env.MB_STAFF_USERNAME,
      Password: process.env.MB_STAFF_PASSWORD
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mindbody auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.AccessToken;
  // Cache for 6 hours (tokens last 7 days, but refresh often)
  tokenExpiry = Date.now() + 6 * 60 * 60 * 1000;
  return cachedToken;
}

/**
 * Make an authenticated request to the Mindbody API.
 * @param {string} path - API path (e.g., '/class/classes')
 * @param {object} options - fetch options (method, body, etc.)
 * @returns {Promise<object>} - parsed JSON response
 */
async function mbFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${MB_BASE}${path}`;

  async function doFetch(token) {
    const headers = {
      ...getBaseHeaders(),
      'Authorization': token,
      ...options.headers
    };
    console.log('[mb-api] ' + (options.method || 'GET') + ' ' + url);
    return fetch(url, { ...options, headers });
  }

  let token = await getStaffToken();
  let res = await doFetch(token);

  // If the cached token was expired/revoked, MB returns 401. Refresh once and retry.
  if (res.status === 401) {
    console.log('[mb-api] Token expired, refreshing...');
    clearTokenCache();
    token = await getStaffToken();
    res = await doFetch(token);
    if (res.status === 401) {
      const text = await res.text();
      console.error('[mb-api] Still 401 after token refresh for ' + url + ':', text.substring(0, 500));
      const error = new Error('Mindbody authentication failed after token refresh for ' + path);
      error.status = 401;
      error.data = { rawResponse: text.substring(0, 200) };
      throw error;
    }
  }

  // Read response as text first, then try to parse as JSON
  // This prevents cryptic "Unexpected token '<'" errors when MB returns HTML
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (parseErr) {
    console.error('[mb-api] Non-JSON response from ' + url + ' (HTTP ' + res.status + '):', text.substring(0, 500));
    const error = new Error('Mindbody returned non-JSON response (HTTP ' + res.status + ') for ' + path + '. Endpoint may not exist.');
    error.status = res.status;
    error.data = { rawResponse: text.substring(0, 200) };
    throw error;
  }

  if (!res.ok) {
    console.error('[mb-api] Error ' + res.status + ' from ' + url + ':', JSON.stringify(data).substring(0, 500));
    const error = new Error(data.Message || `Mindbody API error (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

/**
 * Standard CORS headers for function responses.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

/**
 * Create a JSON response with CORS headers.
 */
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    },
    body: JSON.stringify(body)
  };
}

module.exports = { mbFetch, getStaffToken, clearTokenCache, getBaseHeaders, corsHeaders, jsonResponse, MB_BASE };
