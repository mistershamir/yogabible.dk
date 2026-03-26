/**
 * Process Sequences — Scheduled Function
 *
 * Runs every 30 minutes via Netlify Scheduled Functions.
 * Calls handleProcess() directly (no HTTP hop) to avoid Netlify function timeout.
 */

const { handleProcess } = require('./sequences');

exports.handler = async (event) => {
  try {
    const result = await handleProcess();
    console.log('[process-sequences] Result:', result.body);
    return { statusCode: 200, body: result.body };
  } catch (err) {
    console.error('[process-sequences] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
