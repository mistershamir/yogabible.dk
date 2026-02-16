/**
 * Google Drive API Helper — Yoga Bible
 * DEPRECATED: PDFs will be served from Cloudinary instead.
 * These stubs prevent import errors in functions that haven't been migrated yet.
 */

function looksLikeDriveId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{20,}$/.test(id);
}

function notAvailable(name) {
  return function () {
    throw new Error(`${name}() is no longer available. Google Drive has been removed — use Cloudinary instead.`);
  };
}

module.exports = {
  getDriveApi: notAvailable('getDriveApi'),
  looksLikeDriveId,
  downloadFile: notAvailable('downloadFile')
};
