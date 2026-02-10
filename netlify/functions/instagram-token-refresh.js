/**
 * Netlify Scheduled Function: instagram-token-refresh
 *
 * Automatically refreshes the long-lived Instagram access token
 * before it expires (60-day lifespan). Runs every 45 days via cron.
 *
 * The refreshed token is logged so you can update it in Netlify env vars.
 * For fully automatic rotation, this would need Netlify API access to
 * update the env var programmatically.
 *
 * Schedule: Every 45 days (cron runs on 1st and 15th of every month)
 */

const { jsonResponse } = require('./shared/instagram-api');

exports.handler = async function (event) {
  const currentToken = process.env.META_ACCESS_TOKEN;

  if (!currentToken) {
    console.error('[ig-token] No META_ACCESS_TOKEN configured');
    return jsonResponse(500, { error: 'No META_ACCESS_TOKEN configured' });
  }

  console.log('[ig-token] Refreshing Instagram access token...');

  try {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`
    );

    const data = await res.json();

    if (!res.ok) {
      console.error('[ig-token] Refresh failed:', res.status, JSON.stringify(data));
      return jsonResponse(res.status, {
        error: 'Token refresh failed',
        details: data.error?.message || 'Unknown error'
      });
    }

    const newToken = data.access_token;
    const expiresIn = data.expires_in; // seconds

    console.log('[ig-token] Token refreshed successfully');
    console.log('[ig-token] New token starts with:', newToken.substring(0, 10) + '...');
    console.log('[ig-token] Expires in:', Math.round(expiresIn / 86400), 'days');

    // Automatically update the Netlify env var if NETLIFY_API_TOKEN is set
    if (process.env.NETLIFY_API_TOKEN && process.env.NETLIFY_SITE_ID) {
      console.log('[ig-token] Updating Netlify env var automatically...');

      try {
        // Get the account ID first
        const siteRes = await fetch(
          `https://api.netlify.com/api/v1/sites/${process.env.NETLIFY_SITE_ID}`,
          { headers: { 'Authorization': `Bearer ${process.env.NETLIFY_API_TOKEN}` } }
        );
        const siteData = await siteRes.json();
        const accountId = siteData.account_id;

        // Delete existing env var
        await fetch(
          `https://api.netlify.com/api/v1/accounts/${accountId}/env/META_ACCESS_TOKEN`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${process.env.NETLIFY_API_TOKEN}` }
          }
        );

        // Create new env var with updated token
        const createRes = await fetch(
          `https://api.netlify.com/api/v1/accounts/${accountId}/env`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.NETLIFY_API_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify([{
              key: 'META_ACCESS_TOKEN',
              scopes: ['builds', 'functions', 'runtime'],
              values: [{
                context: 'all',
                value: newToken
              }]
            }])
          }
        );

        if (createRes.ok) {
          console.log('[ig-token] Netlify env var updated automatically!');
        } else {
          const errText = await createRes.text();
          console.error('[ig-token] Failed to update Netlify env var:', createRes.status, errText);
          console.log('[ig-token] MANUAL UPDATE NEEDED — new token:', newToken);
        }
      } catch (netlifyErr) {
        console.error('[ig-token] Netlify API error:', netlifyErr.message);
        console.log('[ig-token] MANUAL UPDATE NEEDED — new token:', newToken);
      }
    } else {
      console.log('[ig-token] No NETLIFY_API_TOKEN set — automatic update unavailable');
      console.log('[ig-token] MANUAL UPDATE NEEDED — new token:', newToken);
    }

    return jsonResponse(200, {
      success: true,
      expiresInDays: Math.round(expiresIn / 86400),
      tokenPrefix: newToken.substring(0, 10) + '...',
      autoUpdated: !!(process.env.NETLIFY_API_TOKEN && process.env.NETLIFY_SITE_ID)
    });
  } catch (err) {
    console.error('[ig-token] Network error:', err.message);
    return jsonResponse(500, { error: err.message });
  }
};

// Netlify Scheduled Function config
exports.config = {
  schedule: '0 9 1,15 * *' // Run at 9:00 AM on the 1st and 15th of every month
};
