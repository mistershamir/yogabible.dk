/**
 * Netlify Function: /.netlify/functions/serve-vtt
 *
 * Serves VTT subtitle files stored in Firestore.
 * Used by Mux to ingest Deepgram-generated subtitles.
 *
 * Query params:
 *   ?session=SESSION_ID — Firestore document ID
 *   ?secret=SECRET      — AI_INTERNAL_SECRET for auth
 */

const { getDoc } = require('./shared/firestore');
const COLLECTION = 'live-schedule';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
      body: ''
    };
  }

  var params = event.queryStringParameters || {};
  var sessionId = params.session;
  var secret = params.secret || '';
  var expected = process.env.AI_INTERNAL_SECRET || '';

  if (expected && secret !== expected) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  if (!sessionId) {
    return { statusCode: 400, body: 'session parameter required' };
  }

  try {
    var doc = await getDoc(COLLECTION, sessionId);
    if (!doc || !doc.captionVtt) {
      return { statusCode: 404, body: 'No VTT found for session ' + sessionId };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      },
      body: doc.captionVtt
    };
  } catch (err) {
    console.error('[serve-vtt] Error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};
