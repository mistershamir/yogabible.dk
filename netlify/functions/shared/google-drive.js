/**
 * Google Drive API Helper — Yoga Bible
 * Replaces DriveApp/UrlFetchApp from Apps Script
 * Downloads files from Google Drive via service account.
 */

const { drive } = require('@googleapis/drive');
const { getAuth } = require('./google-sheets');

let driveApi = null;

function getDriveApi() {
  if (driveApi) return driveApi;
  const auth = getAuth();
  driveApi = drive({ version: 'v3', auth });
  return driveApi;
}

/**
 * Check if a string looks like a Google Drive file ID.
 */
function looksLikeDriveId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{20,}$/.test(id);
}

/**
 * Download a file from Google Drive as a Buffer.
 * @param {string} fileId - Google Drive file ID
 * @returns {Promise<{ buffer: Buffer, name: string, mimeType: string } | null>}
 */
async function downloadFile(fileId) {
  if (!looksLikeDriveId(fileId)) return null;

  const drive = getDriveApi();

  // Get file metadata
  let name, mimeType;
  try {
    const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
    name = meta.data.name;
    mimeType = meta.data.mimeType;
  } catch (err) {
    console.error(`[google-drive] Could not get metadata for ${fileId}:`, err.message);
    name = `file-${fileId}`;
    mimeType = 'application/octet-stream';
  }

  // Download file content
  try {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(res.data);
    return { buffer, name, mimeType };
  } catch (err) {
    console.error(`[google-drive] Download failed for ${fileId}:`, err.message);
    return null;
  }
}

module.exports = { getDriveApi, looksLikeDriveId, downloadFile };
