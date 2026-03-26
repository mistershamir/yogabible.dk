/**
 * Bunny Storage Browser API — Yoga Bible
 * Admin-only proxy for Bunny Storage API.
 * Lists folders, lists resources (PDFs/images), and generates upload URLs.
 *
 * GET /.netlify/functions/bunny-browser?action=folders&path=yoga-bible-DK/materials
 * GET /.netlify/functions/bunny-browser?action=resources&path=yoga-bible-DK/materials/shared
 * GET /.netlify/functions/bunny-browser?action=sign_upload&folder=yoga-bible-DK/materials/shared
 */

const https = require('https');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'yogabible';
const BUNNY_STORAGE_KEY  = process.env.BUNNY_STORAGE_API_KEY || '';
const BUNNY_CDN_HOST     = process.env.BUNNY_CDN_HOST || 'yogabible.b-cdn.net';
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const ROOT_PREFIX = 'yoga-bible-DK/materials';

// ── Helper: authenticated request to Bunny Storage API ──
function bunnyRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BUNNY_STORAGE_HOST,
      path: '/' + BUNNY_STORAGE_ZONE + '/' + path + (path.endsWith('/') ? '' : '/'),
      method: method,
      headers: {
        'AccessKey': BUNNY_STORAGE_KEY,
        'Accept': 'application/json'
      }
    };

    if (body) {
      options.headers['Content-Type'] = 'application/octet-stream';
      options.headers['Content-Length'] = body.length;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          // Bunny sometimes returns non-JSON for certain status codes
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Bunny API timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── Action: list subfolders ──
async function listFolders(folderPath) {
  try {
    const result = await bunnyRequest('GET', folderPath);
    if (result.status !== 200) {
      return jsonResponse(result.status, { ok: false, error: 'Bunny Storage error: ' + result.status });
    }

    // Bunny returns an array of objects; filter to directories only
    const items = Array.isArray(result.body) ? result.body : [];
    const folders = items
      .filter(item => item.IsDirectory)
      .map(item => ({
        name: item.ObjectName,
        path: folderPath + '/' + item.ObjectName
      }));

    return jsonResponse(200, { ok: true, folders });
  } catch (err) {
    console.error('[bunny-browser] listFolders error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
}

// ── Action: list resources (files) in a folder ──
async function listResources(folderPath) {
  try {
    const result = await bunnyRequest('GET', folderPath);
    if (result.status !== 200) {
      return jsonResponse(result.status, { ok: false, error: 'Bunny Storage error: ' + result.status });
    }

    const items = Array.isArray(result.body) ? result.body : [];
    const resources = items
      .filter(item => !item.IsDirectory)
      .map(item => {
        const ext = (item.ObjectName.match(/\.(\w+)$/) || ['', ''])[1].toLowerCase();
        const nameNoExt = item.ObjectName.replace(/\.\w+$/, '');
        return {
          public_id: folderPath + '/' + nameNoExt,
          format: ext,
          bytes: item.Length || 0,
          created_at: item.DateCreated || '',
          secure_url: 'https://' + BUNNY_CDN_HOST + '/' + folderPath + '/' + item.ObjectName,
          resource_type: getResourceType(ext),
          display_name: item.ObjectName
        };
      })
      .sort((a, b) => {
        const nameA = a.display_name.toLowerCase();
        const nameB = b.display_name.toLowerCase();
        return nameA.localeCompare(nameB);
      });

    return jsonResponse(200, { ok: true, resources });
  } catch (err) {
    console.error('[bunny-browser] listResources error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
}

// ── Action: generate upload info ──
// Returns the Bunny Storage upload URL + headers the client needs
function signUpload(folder) {
  return jsonResponse(200, {
    ok: true,
    upload_params: {
      upload_url: 'https://' + BUNNY_STORAGE_HOST + '/' + BUNNY_STORAGE_ZONE + '/' + folder + '/',
      headers: {
        'AccessKey': BUNNY_STORAGE_KEY
      },
      cdn_base: 'https://' + BUNNY_CDN_HOST + '/' + folder + '/'
    }
  });
}

// ── Helper: detect resource type from extension ──
function getResourceType(ext) {
  if (['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'avi'].includes(ext)) return 'video';
  return 'raw';
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
