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
  const token = await getStaffToken();
  const headers = {
    ...getBaseHeaders(),
    'Authorization': token,
    ...options.headers
  };

  const url = path.startsWith('http') ? path : `${MB_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers
  });

  const data = await res.json();

  if (!res.ok) {
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
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

module.exports = { mbFetch, getStaffToken, getBaseHeaders, corsHeaders, jsonResponse, MB_BASE };
