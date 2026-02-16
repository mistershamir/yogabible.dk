/**
 * Health Check Endpoint — Yoga Bible
 * GET /.netlify/functions/health
 */

const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  return jsonResponse(200, {
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: 'netlify-v1'
  });
};
