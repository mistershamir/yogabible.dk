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
const ALLOWED_PREFIXES = ['yoga-bible-DK/'];

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

// ── Action: proxy upload to Bunny Storage (avoids CORS) ──
async function proxyUpload(folder, fileName, bodyBuffer, contentType) {
  return new Promise((resolve, reject) => {
    const uploadPath = '/' + BUNNY_STORAGE_ZONE + '/' + folder + '/' + fileName;
    const options = {
      hostname: BUNNY_STORAGE_HOST,
      path: uploadPath,
      method: 'PUT',
      headers: {
        'AccessKey': BUNNY_STORAGE_KEY,
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': bodyBuffer.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cdnUrl = 'https://' + BUNNY_CDN_HOST + '/' + folder + '/' + fileName;
          resolve(jsonResponse(200, { ok: true, url: cdnUrl }));
        } else {
          resolve(jsonResponse(res.statusCode, { ok: false, error: 'Bunny upload failed: ' + res.statusCode + ' ' + data }));
        }
      });
    });

    req.on('error', (err) => resolve(jsonResponse(500, { ok: false, error: err.message })));
    req.setTimeout(120000, () => { req.destroy(); resolve(jsonResponse(504, { ok: false, error: 'Upload timeout' })); });
    req.write(bodyBuffer);
    req.end();
  });
}

// ── Helper: detect resource type from extension ──
function getResourceType(ext) {
  if (['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'avi'].includes(ext)) return 'video';
  return 'raw';
}

// ── Handler ──
// ── Action: create social media platform folders ──
const SOCIAL_FOLDERS = [
  'yoga-bible-DK/social/instagram',
  'yoga-bible-DK/social/facebook',
  'yoga-bible-DK/social/tiktok',
  'yoga-bible-DK/social/linkedin',
  'yoga-bible-DK/social/general',
  'yoga-bible-DK/social/stories',
  'yoga-bible-DK/social/reels'
];

async function initSocialFolders() {
  const results = [];
  for (const folder of SOCIAL_FOLDERS) {
    try {
      // Upload a zero-byte .keep file to create the folder
      const keepPath = folder + '/.keep';
      await new Promise((resolve, reject) => {
        const options = {
          hostname: BUNNY_STORAGE_HOST,
          path: '/' + BUNNY_STORAGE_ZONE + '/' + keepPath,
          method: 'PUT',
          headers: {
            'AccessKey': BUNNY_STORAGE_KEY,
            'Content-Type': 'application/octet-stream',
            'Content-Length': 0
          }
        };
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', reject);
        req.end();
      });
      results.push({ folder, status: 'created' });
    } catch (err) {
      results.push({ folder, status: 'error', error: err.message });
    }
  }
  return jsonResponse(200, { ok: true, folders: results });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // Admin-only access
  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const action = params.action || '';
  const path = params.path || ROOT_PREFIX;
  const folder = params.folder || ROOT_PREFIX;

  // Security: ensure path/folder starts with an allowed prefix
  const pathOk = ALLOWED_PREFIXES.some(p => path.startsWith(p) || path === p.replace(/\/$/, ''));
  if (!pathOk) {
    return jsonResponse(403, { ok: false, error: 'Access denied: outside allowed folders' });
  }
  const folderOk = ALLOWED_PREFIXES.some(p => folder.startsWith(p) || folder === p.replace(/\/$/, ''));
  if (!folderOk) {
    return jsonResponse(403, { ok: false, error: 'Access denied: outside allowed folders' });
  }

  switch (action) {
    case 'folders':
      return listFolders(path);
    case 'resources':
      return listResources(path);
    case 'sign_upload':
      return signUpload(folder);
    case 'upload': {
      // Proxy upload: client sends binary file in POST body
      if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'POST required for upload' });
      const fileName = params.fileName;
      const contentType = params.contentType || 'application/octet-stream';
      if (!fileName) return jsonResponse(400, { ok: false, error: 'Missing fileName param' });
      if (!event.body) return jsonResponse(400, { ok: false, error: 'Empty body' });
      // Netlify always base64-encodes binary request bodies
      const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
      console.log(`[bunny-browser] upload: ${fileName} to ${folder}, bodySize=${bodyBuffer.length}, isBase64=${event.isBase64Encoded}, rawLen=${event.body.length}`);
      if (bodyBuffer.length === 0) return jsonResponse(400, { ok: false, error: 'Empty file body after decode' });
      return proxyUpload(folder, fileName, bodyBuffer, contentType);
    }
    case 'init-social-folders':
      return initSocialFolders();
    default:
      return jsonResponse(400, { ok: false, error: 'Invalid action. Use: folders, resources, sign_upload, upload, init-social-folders' });
  }
};
