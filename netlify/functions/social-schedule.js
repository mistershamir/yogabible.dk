/**
 * Social Schedule Processor — Yoga Bible
 * Scheduled function that runs every 5 minutes to publish due posts.
 *
 * Configured in netlify.toml:
 *   [functions."social-schedule"]
 *     schedule = "*/5 * * * *"
 */

const { getDb } = require('./shared/firestore');
const { publishPost } = require('./social-publish');

exports.handler = async (event) => {
  const db = getDb();
  const now = new Date();

  try {
    // Query posts that are scheduled and due for publishing
    const snap = await db.collection('social_posts')
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '<=', now)
      .limit(20)
      .get();

    if (snap.empty) {
      console.log('[social-schedule] No due posts');
      return { statusCode: 200, body: JSON.stringify({ ok: true, processed: 0 }) };
    }

    console.log(`[social-schedule] Found ${snap.size} due post(s)`);

    const results = [];

    for (const doc of snap.docs) {
      const postId = doc.id;

      try {
        const result = await publishPost(db, postId, null);
        results.push({ postId, ok: result.ok, status: result.status });
        console.log(`[social-schedule] Published ${postId}: ${result.status}`);
      } catch (err) {
        console.error(`[social-schedule] Failed to publish ${postId}:`, err.message);
        results.push({ postId, ok: false, error: err.message });

        // Mark the post as failed so it doesn't get retried indefinitely
        try {
          await db.collection('social_posts').doc(postId).update({
            status: 'failed',
            publishResults: { _scheduler_error: err.message },
            updatedAt: new Date()
          });
        } catch (updateErr) {
          console.error(`[social-schedule] Failed to update ${postId} status:`, updateErr.message);
        }
      }
    }

    const summary = {
      ok: true,
      processed: results.length,
      succeeded: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results
    };

    console.log('[social-schedule] Summary:', JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('[social-schedule] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
