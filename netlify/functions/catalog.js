/**
 * Course Catalog Endpoint — Yoga Bible
 * Replaces handleCatalogRequest from Apps Script
 *
 * GET /.netlify/functions/catalog
 */

const { getSheetData } = require('./shared/google-sheets');
const { jsonResponse, optionsResponse, normalizeToEnglish } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'GET') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  const callback = (event.queryStringParameters || {}).callback || '';

  try {
    const data = await getSheetData('Course Catalog');
    if (!data || data.length < 2) {
      return wrapCallback(callback, jsonResponse(200, { ok: true, catalog: [] }));
    }

    const headers = data[0];
    const catalog = [];

    for (let i = 1; i < data.length; i++) {
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = (data[i] && data[i][j]) || '';
      }
      if (String(row.active || '').toLowerCase() !== 'true') continue;
      row.category = normalizeToEnglish(row.category);
      row.open_status = normalizeToEnglish(row.open_status);
      catalog.push(row);
    }

    return wrapCallback(callback, jsonResponse(200, { ok: true, catalog }));
  } catch (error) {
    console.error('Catalog error:', error);
    return wrapCallback(callback, jsonResponse(500, { ok: false, error: 'Failed to load catalog' }));
  }
};

function wrapCallback(callback, response) {
  if (!callback) return response;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/javascript' },
    body: `${callback}(${response.body});`
  };
}
