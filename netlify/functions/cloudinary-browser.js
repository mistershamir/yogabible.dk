/**
 * Cloudinary Browser API — Yoga Bible
 * Admin-only proxy for Cloudinary Admin API.
 * Lists folders, lists resources (PDFs), and signs direct uploads.
 *
 * GET /.netlify/functions/cloudinary-browser?action=folders&path=yoga-bible-DK/materials
 * GET /.netlify/functions/cloudinary-browser?action=resources&path=yoga-bible-DK/materials/shared
 * GET /.netlify/functions/cloudinary-browser?action=sign_upload&folder=yoga-bible-DK/materials/shared
 */

const crypto = require('crypto');
const https = require('https');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'ddcynsa30';
const API_KEY    = process.env.CLOUDINARY_API_KEY    || '617726211878669';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || 'n90Ts-IUyUnxwNdtQd9i64d6Gtw';
const ROOT_PREFIX = 'yoga-bible-DK/materials';

// ── Helper: authenticated GET to Cloudinary Admin API ──
function cloudinaryGet(path) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(API_KEY + ':' + API_SECRET).toString('base64');
    const url = new URL('https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/' + path);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error('Invalid JSON from Cloudinary: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Cloudinary API timeout')); });
    req.end();
  });
}

// ── Action: list subfolders ──
async function listFolders(folderPath) {
  try {
    const result = await cloudinaryGet('folders/' + encodeURIComponent(folderPath).replace(/%2F/g, '/'));
    if (result.status !== 200) {
      return jsonResponse(result.status, { ok: false, error: result.body.error || 'Cloudinary error' });
    }
    const folders = (result.body.folders || []).map(f => ({
      name: f.name,
      path: f.path
    }));
    return jsonResponse(200, { ok: true, folders });
  } catch (err) {
    console.error('[cloudinary-browser] listFolders error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
}

// ── Action: list resources (PDFs) in a folder ──
// Queries both resource_type=image and resource_type=raw, merges results
async function listResources(folderPath) {
  try {
    const fetchType = async (resourceType) => {
      const qPath = 'resources/' + resourceType + '/upload?prefix=' +
        encodeURIComponent(folderPath) + '&type=upload&max_results=500';
      const result = await cloudinaryGet(qPath);
      if (result.status !== 200) return [];
      return (result.body.resources || []).map(r => ({
        public_id: r.public_id,
        format: r.format || '',
        bytes: r.bytes || 0,
        created_at: r.created_at || '',
        secure_url: r.secure_url || '',
        resource_type: r.resource_type || resourceType,
        display_name: r.display_name || ''
      }));
    };

    const [imageRes, rawRes] = await Promise.all([
      fetchType('image'),
      fetchType('raw')
    ]);

    // Merge and filter to only files directly in this folder (not subfolders)
    const allResources = imageRes.concat(rawRes).filter(r => {
      // public_id should be folderPath/filename (no additional slashes)
      const relative = r.public_id.replace(folderPath + '/', '');
      return relative.indexOf('/') === -1 && relative.length > 0;
    });

    // Sort by name
    allResources.sort((a, b) => {
      const nameA = a.public_id.split('/').pop().toLowerCase();
      const nameB = b.public_id.split('/').pop().toLowerCase();
      return nameA.localeCompare(nameB);
    });

    return jsonResponse(200, { ok: true, resources: allResources });
  } catch (err) {
    console.error('[cloudinary-browser] listResources error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
}

// ── Action: sign an upload ──
function signUpload(folder) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder: folder,
    resource_type: 'raw',
    timestamp: String(timestamp)
  };

  // Build signature string: sorted params joined by &, then append API secret
  const sortedStr = Object.keys(params).sort()
    .map(k => k + '=' + params[k])
    .join('&');
  const signature = crypto.createHash('sha1').update(sortedStr + API_SECRET).digest('hex');

  return jsonResponse(200, {
    ok: true,
    upload_params: {
      timestamp: timestamp,
      signature: signature,
      api_key: API_KEY,
      cloud_name: CLOUD_NAME,
      folder: folder,
      resource_type: 'raw'
    }
  });
}

// ── Handler ──
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // Admin-only access
  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const action = params.action || '';
  const path = params.path || ROOT_PREFIX;
  const folder = params.folder || ROOT_PREFIX;

  // Security: ensure path/folder starts with ROOT_PREFIX
  if (!path.startsWith(ROOT_PREFIX)) {
    return jsonResponse(403, { ok: false, error: 'Access denied: outside materials folder' });
  }
  if (!folder.startsWith(ROOT_PREFIX)) {
    return jsonResponse(403, { ok: false, error: 'Access denied: outside materials folder' });
  }

  switch (action) {
    case 'folders':
      return listFolders(path);
    case 'resources':
      return listResources(path);
    case 'sign_upload':
      return signUpload(folder);
    default:
      return jsonResponse(400, { ok: false, error: 'Invalid action. Use: folders, resources, sign_upload' });
  }
};
