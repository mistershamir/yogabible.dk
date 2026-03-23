#!/usr/bin/env node
/**
 * Migrate all Cloudinary assets → Bunny Storage
 *
 * Downloads originals from Cloudinary Admin API, uploads to Bunny Storage.
 * Maintains the same folder structure (yoga-bible-DK/...).
 *
 * Usage:
 *   node scripts/migrate-cloudinary-to-bunny.js
 *   node scripts/migrate-cloudinary-to-bunny.js --dry-run
 */

const https = require('https');
const http = require('http');

// ── Cloudinary config ──
const CLOUD_NAME = 'ddcynsa30';
const CLD_API_KEY = '617726211878669';
const CLD_API_SECRET = 'n90Ts-IUyUnxwNdtQd9i64d6Gtw';
const CLD_AUTH = Buffer.from(CLD_API_KEY + ':' + CLD_API_SECRET).toString('base64');

// ── Bunny config ──
const BUNNY_STORAGE_ZONE = 'yogabible';
const BUNNY_STORAGE_KEY = '0bdbbefa-32a1-476f-a2d39a5a8b81-37be-4e73';
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';

const DRY_RUN = process.argv.includes('--dry-run');

// ── Helper: HTTPS GET with JSON response ──
function httpsGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: headers || {}
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── Helper: Download binary from URL ──
function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const handler = (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    };

    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const req = mod.get(url, handler);
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Download timeout: ' + url)); });
  });
}

// ── Helper: Upload buffer to Bunny Storage ──
function uploadToBunny(path, buffer) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BUNNY_STORAGE_HOST,
      path: '/' + BUNNY_STORAGE_ZONE + '/' + path,
      method: 'PUT',
      headers: {
        'AccessKey': BUNNY_STORAGE_KEY,
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          resolve(true);
        } else {
          reject(new Error('Bunny upload failed (' + res.statusCode + '): ' + data));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Upload timeout')); });
    req.write(buffer);
    req.end();
  });
}

// ── List all Cloudinary resources (paginated) ──
async function listCloudinaryResources(resourceType) {
  const resources = [];
  let cursor = '';
  let page = 1;

  while (true) {
    const cursorParam = cursor ? '&next_cursor=' + encodeURIComponent(cursor) : '';
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/${resourceType}?max_results=500&type=upload${cursorParam}`;

    const data = await httpsGetJson(url, { 'Authorization': 'Basic ' + CLD_AUTH });

    if (data.resources) {
      resources.push(...data.resources);
    }
    console.log(`  [${resourceType}] Page ${page}: ${(data.resources || []).length} items`);

    cursor = data.next_cursor || '';
    if (!cursor) break;
    page++;
  }

  return resources;
}

// ── Build download URL for a Cloudinary resource ──
function getCloudinaryDownloadUrl(resource) {
  const { resource_type, public_id, format } = resource;
  // Use the secure_url if available (already has the correct format)
  if (resource.secure_url) return resource.secure_url;

  const ext = format ? '.' + format : '';
  return `https://res.cloudinary.com/${CLOUD_NAME}/${resource_type}/upload/${public_id}${ext}`;
}

// ── Build Bunny storage path from Cloudinary resource ──
function getBunnyPath(resource) {
  const { public_id, format } = resource;
  const ext = format ? '.' + format : '';
  // Keep the same path structure
  return public_id + ext;
}

// ── Main ──
async function main() {
  console.log('==========================================');
  console.log('  Cloudinary → Bunny CDN Migration');
  console.log(DRY_RUN ? '  MODE: DRY RUN' : '  MODE: LIVE');
  console.log('==========================================\n');

  // 1. List all resources
  console.log('Fetching Cloudinary inventory...');
  const [images, videos, rawFiles] = await Promise.all([
    listCloudinaryResources('image'),
    listCloudinaryResources('video'),
    listCloudinaryResources('raw')
  ]);

  const allResources = [
    ...images.map(r => ({ ...r, resource_type: 'image' })),
    ...videos.map(r => ({ ...r, resource_type: 'video' })),
    ...rawFiles.map(r => ({ ...r, resource_type: 'raw' }))
  ];

  console.log(`\nTotal: ${images.length} images, ${videos.length} videos, ${rawFiles.length} raw files`);
  console.log(`Total: ${allResources.length} assets to migrate\n`);

  if (DRY_RUN) {
    console.log('── DRY RUN: listing assets ──\n');
    for (const r of allResources) {
      const sizeMB = ((r.bytes || 0) / 1048576).toFixed(2);
      const path = getBunnyPath(r);
      console.log(`  ${sizeMB}MB | ${r.resource_type} | ${path}`);
    }
    console.log('\n── End dry run ──');
    return;
  }

  // 2. Migrate each asset
  let success = 0, failed = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < allResources.length; i++) {
    const resource = allResources[i];
    const bunnyPath = getBunnyPath(resource);
    const sizeMB = ((resource.bytes || 0) / 1048576).toFixed(2);
    const progress = `[${i + 1}/${allResources.length}]`;

    try {
      // Download from Cloudinary
      const downloadUrl = getCloudinaryDownloadUrl(resource);
      process.stdout.write(`${progress} Downloading ${bunnyPath} (${sizeMB}MB)...`);

      const buffer = await downloadBuffer(downloadUrl);

      // Upload to Bunny
      process.stdout.write(' uploading...');
      await uploadToBunny(bunnyPath, buffer);

      console.log(' OK');
      success++;
    } catch (err) {
      console.log(' FAILED: ' + err.message);
      errors.push({ path: bunnyPath, error: err.message });
      failed++;
    }
  }

  // 3. Summary
  console.log('\n==========================================');
  console.log('  Migration Complete');
  console.log(`  Success: ${success}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log('==========================================');

  if (errors.length > 0) {
    console.log('\nFailed assets:');
    for (const e of errors) {
      console.log(`  ${e.path}: ${e.error}`);
    }
  }

  console.log('\nBunny CDN URL: https://yogabible.b-cdn.net/');
  console.log('Test: https://yogabible.b-cdn.net/yoga-bible-DK/brand/logo.png');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
