/**
 * Process Sequences — Scheduled Function
 *
 * Runs every 30 minutes via Netlify Scheduled Functions.
 * Calls the sequences?action=process endpoint to execute due sequence steps.
 */

const FETCH_TIMEOUT = 55000; // 55s timeout (function has 60s)

exports.handler = async (event) => {
  const url = process.env.URL || 'https://yogabible.dk';
  const secret = process.env.AI_INTERNAL_SECRET;

  if (!secret) {
    console.error('[process-sequences] AI_INTERNAL_SECRET not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing secret' }) };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(`${url}/.netlify/functions/sequences?action=process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    const result = await response.json();
    console.log('[process-sequences] Result:', JSON.stringify(result));

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[process-sequences] Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
