/**
 * Social Media API Helpers — Yoga Bible
 * Shared helpers for publishing to and reading from social media platforms.
 */

const FB_API = 'https://graph.facebook.com/v21.0';
const IG_API = 'https://graph.facebook.com/v21.0'; // IG uses FB Graph API

// ── Instagram Publishing ─────────────────────────────────────────

/**
 * Publish a single image or reel to Instagram.
 */
async function publishToInstagram(account, post) {
  const { accessToken, igAccountId } = account;
  const caption = buildCaption(post);
  const media = post.media || [];
  const requestedType = (post.mediaType || 'auto').toUpperCase();

  if (media.length === 0) {
    return { success: false, error: 'Instagram requires at least one media item' };
  }

  // Stories and Reels only support single media
  if (requestedType === 'STORIES' && media.length > 1) {
    return { success: false, error: 'Stories only support a single image or video' };
  }

  if (media.length > 1 && requestedType !== 'STORIES') {
    return publishCarouselToInstagram(account, post);
  }

  const mediaUrl = media[0];
  const mediaUrlPath = mediaUrl.split('?')[0]; // strip query params (signed CDN URLs)
  const explicitMediaType = (post.mediaType || '').toUpperCase();
  const isVideo = ['VIDEO', 'REEL', 'REELS', 'STORY', 'STORIES'].includes(explicitMediaType)
    || /\.(mp4|mov|avi|wmv|webm|m4v|mkv)$/i.test(mediaUrlPath)
    || /\/play_\d+p\.mp4/i.test(mediaUrl);

  // Pre-check: verify the media URL is publicly accessible
  try {
    const checkRes = await fetch(mediaUrl, { method: 'HEAD' });
    if (!checkRes.ok) {
      console.error('[social-api] Media URL not accessible:', mediaUrl, 'status:', checkRes.status);
      return { success: false, error: `Media URL returned ${checkRes.status}. The video may not be publicly accessible. Check Bunny CDN token authentication settings.` };
    }
    console.log('[social-api] Media URL accessible:', mediaUrl, 'content-type:', checkRes.headers.get('content-type'), 'size:', checkRes.headers.get('content-length'));
  } catch (err) {
    console.error('[social-api] Media URL check failed:', err.message);
    return { success: false, error: `Cannot reach media URL: ${err.message}` };
  }

  // Determine media type
  let mediaType;
  if (requestedType === 'STORIES') {
    mediaType = 'STORIES';
  } else if (requestedType === 'REELS') {
    mediaType = 'REELS';
  } else {
    // AUTO: videos default to REELS, images to feed post (no media_type needed)
    mediaType = isVideo ? 'REELS' : null;
  }

  try {
    // Step 1: Create media container
    const containerParams = new URLSearchParams({
      access_token: accessToken
    });

    // Stories don't support captions in the container — caption goes via first comment instead
    if (mediaType !== 'STORIES') {
      containerParams.set('caption', caption);
    }

    if (mediaType) {
      containerParams.set('media_type', mediaType);
    }

    if (isVideo || mediaType === 'REELS' || mediaType === 'STORIES') {
      containerParams.set('video_url', mediaUrl);
    } else {
      containerParams.set('image_url', mediaUrl);
    }
    // Stories can also use image_url for static images
    if (mediaType === 'STORIES' && !isVideo) {
      containerParams.delete('video_url');
      containerParams.set('image_url', mediaUrl);
    }

    if (post.location) {
      containerParams.set('location_id', post.location);
    }

    const containerRes = await fetch(`${IG_API}/${igAccountId}/media`, {
      method: 'POST',
      body: containerParams
    });
    const containerData = await containerRes.json();

    if (containerData.error) {
      console.error('[social-api] IG container error:', containerData.error);
      return { success: false, error: containerData.error.message };
    }

    const containerId = containerData.id;

    // Step 2: Wait for processing (videos and stories need this)
    if (isVideo || mediaType === 'REELS' || mediaType === 'STORIES') {
      const ready = await waitForMediaProcessing(account, containerId, 300000);
      if (!ready) {
        return { success: false, error: 'Media processing timed out after 300s. Video may be too large or in an unsupported format.' };
      }
    }

    // Step 3: Publish
    const publishRes = await fetch(`${IG_API}/${igAccountId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: containerId,
        access_token: accessToken
      })
    });
    const publishData = await publishRes.json();

    if (publishData.error) {
      console.error('[social-api] IG publish error:', publishData.error);
      return { success: false, error: publishData.error.message };
    }

    // Step 4: Post first comment if provided
    if (post.firstComment && publishData.id) {
      await postInstagramComment(account, publishData.id, post.firstComment);
    }

    console.log('[social-api] IG published:', publishData.id, 'type:', mediaType || 'IMAGE');
    return { success: true, id: publishData.id, mediaType: mediaType || 'IMAGE' };
  } catch (err) {
    console.error('[social-api] IG publish exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Publish a carousel (multiple images) to Instagram.
 */
async function publishCarouselToInstagram(account, post) {
  const { accessToken, igAccountId } = account;
  const caption = buildCaption(post);
  const media = post.media || [];

  try {
    // Step 1: Create item containers for each media
    const childIds = [];
    for (const mediaUrl of media) {
      const isVideo = /\.(mp4|mov|avi|wmv)$/i.test(mediaUrl);
      const params = new URLSearchParams({
        is_carousel_item: 'true',
        access_token: accessToken
      });

      if (isVideo) {
        params.set('media_type', 'VIDEO');
        params.set('video_url', mediaUrl);
      } else {
        params.set('image_url', mediaUrl);
      }

      const res = await fetch(`${IG_API}/${igAccountId}/media`, {
        method: 'POST',
        body: params
      });
      const data = await res.json();

      if (data.error) {
        console.error('[social-api] IG carousel item error:', data.error);
        return { success: false, error: `Carousel item failed: ${data.error.message}` };
      }

      // Wait for video items to process
      if (isVideo) {
        await waitForMediaProcessing(account, data.id, 120000);
      }

      childIds.push(data.id);
    }

    // Step 2: Create carousel container
    const carouselParams = new URLSearchParams({
      media_type: 'CAROUSEL',
      caption,
      access_token: accessToken
    });
    childIds.forEach(id => carouselParams.append('children', id));

    if (post.location) {
      carouselParams.set('location_id', post.location);
    }

    const carouselRes = await fetch(`${IG_API}/${igAccountId}/media`, {
      method: 'POST',
      body: carouselParams
    });
    const carouselData = await carouselRes.json();

    if (carouselData.error) {
      console.error('[social-api] IG carousel container error:', carouselData.error);
      return { success: false, error: carouselData.error.message };
    }

    // Step 3: Publish carousel
    const publishRes = await fetch(`${IG_API}/${igAccountId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: carouselData.id,
        access_token: accessToken
      })
    });
    const publishData = await publishRes.json();

    if (publishData.error) {
      console.error('[social-api] IG carousel publish error:', publishData.error);
      return { success: false, error: publishData.error.message };
    }

    // Post first comment if provided
    if (post.firstComment && publishData.id) {
      await postInstagramComment(account, publishData.id, post.firstComment);
    }

    console.log('[social-api] IG carousel published:', publishData.id);
    return { success: true, id: publishData.id };
  } catch (err) {
    console.error('[social-api] IG carousel exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Post a comment on an Instagram media item (used for "first comment" feature).
 */
async function postInstagramComment(account, mediaId, text) {
  try {
    const res = await fetch(`${IG_API}/${mediaId}/comments`, {
      method: 'POST',
      body: new URLSearchParams({
        message: text,
        access_token: account.accessToken
      })
    });
    const data = await res.json();
    if (data.error) {
      console.error('[social-api] IG comment error:', data.error);
    }
    return data;
  } catch (err) {
    console.error('[social-api] IG comment exception:', err);
  }
}

/**
 * Get metrics for an Instagram media item.
 */
async function getInstagramMetrics(account, mediaId) {
  try {
    const metrics = 'impressions,reach,engagement,likes,comments,shares,saved,plays';
    const url = `${IG_API}/${mediaId}/insights?metric=${metrics}&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      // Try basic fields if insights fail (e.g., for carousel items)
      const fallbackUrl = `${IG_API}/${mediaId}?fields=like_count,comments_count,timestamp&access_token=${account.accessToken}`;
      const fallbackRes = await fetch(fallbackUrl);
      const fallbackData = await fallbackRes.json();
      if (fallbackData.error) {
        return { success: false, error: fallbackData.error.message };
      }
      return {
        success: true,
        metrics: {
          likes: fallbackData.like_count || 0,
          comments: fallbackData.comments_count || 0,
          timestamp: fallbackData.timestamp
        }
      };
    }

    const result = {};
    (data.data || []).forEach(item => {
      result[item.name] = item.values?.[0]?.value || 0;
    });

    return { success: true, metrics: result };
  } catch (err) {
    console.error('[social-api] IG metrics exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Get Instagram account info (followers, media count, etc.).
 */
async function getInstagramAccountInfo(account) {
  try {
    const url = `${IG_API}/${account.igAccountId}?fields=followers_count,media_count,username,name,profile_picture_url&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    return {
      success: true,
      info: {
        followers: data.followers_count,
        mediaCount: data.media_count,
        username: data.username,
        name: data.name,
        profilePicture: data.profile_picture_url
      }
    };
  } catch (err) {
    console.error('[social-api] IG account info exception:', err);
    return { success: false, error: err.message };
  }
}

// ── Facebook Publishing ──────────────────────────────────────────

/**
 * Publish to a Facebook page.
 */
async function publishToFacebook(account, post) {
  const { accessToken, pageId } = account;
  const caption = buildCaption(post);
  const media = post.media || [];

  try {
    // Text-only post
    if (media.length === 0) {
      const res = await fetch(`${FB_API}/${pageId}/feed`, {
        method: 'POST',
        body: new URLSearchParams({
          message: caption,
          access_token: accessToken
        })
      });
      const data = await res.json();
      if (data.error) {
        console.error('[social-api] FB text post error:', data.error);
        return { success: false, error: data.error.message };
      }
      console.log('[social-api] FB text published:', data.id);
      return { success: true, id: data.id };
    }

    const firstMedia = media[0];
    const isVideo = /\.(mp4|mov|avi|wmv)$/i.test(firstMedia);

    if (isVideo) {
      // Pre-check: verify the video URL is publicly accessible
      try {
        const checkRes = await fetch(firstMedia, { method: 'HEAD' });
        if (!checkRes.ok) {
          return { success: false, error: `Video URL returned ${checkRes.status}. Check Bunny CDN token auth settings.` };
        }
      } catch (err) {
        return { success: false, error: `Cannot reach video URL: ${err.message}` };
      }

      // Video post
      const res = await fetch(`${FB_API}/${pageId}/videos`, {
        method: 'POST',
        body: new URLSearchParams({
          file_url: firstMedia,
          description: caption,
          access_token: accessToken
        })
      });
      const data = await res.json();
      if (data.error) {
        console.error('[social-api] FB video error:', data.error);
        return { success: false, error: data.error.message };
      }
      console.log('[social-api] FB video published:', data.id);
      return { success: true, id: data.id };
    }

    if (media.length === 1) {
      // Single photo post
      const res = await fetch(`${FB_API}/${pageId}/photos`, {
        method: 'POST',
        body: new URLSearchParams({
          url: firstMedia,
          caption,
          access_token: accessToken
        })
      });
      const data = await res.json();
      if (data.error) {
        console.error('[social-api] FB photo error:', data.error);
        return { success: false, error: data.error.message };
      }
      console.log('[social-api] FB photo published:', data.id);
      return { success: true, id: data.id };
    }

    // Multiple photos — upload unpublished, then create multi-photo post
    const photoIds = [];
    for (const url of media) {
      const res = await fetch(`${FB_API}/${pageId}/photos`, {
        method: 'POST',
        body: new URLSearchParams({
          url,
          published: 'false',
          access_token: accessToken
        })
      });
      const data = await res.json();
      if (data.error) {
        console.error('[social-api] FB multi-photo upload error:', data.error);
        return { success: false, error: `Photo upload failed: ${data.error.message}` };
      }
      photoIds.push(data.id);
    }

    // Create post with attached photos
    const postParams = new URLSearchParams({
      message: caption,
      access_token: accessToken
    });
    photoIds.forEach((id, i) => {
      postParams.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id }));
    });

    const postRes = await fetch(`${FB_API}/${pageId}/feed`, {
      method: 'POST',
      body: postParams
    });
    const postData = await postRes.json();
    if (postData.error) {
      console.error('[social-api] FB multi-photo post error:', postData.error);
      return { success: false, error: postData.error.message };
    }
    console.log('[social-api] FB multi-photo published:', postData.id);
    return { success: true, id: postData.id };
  } catch (err) {
    console.error('[social-api] FB publish exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Get metrics for a Facebook post.
 */
async function getFacebookMetrics(account, postId) {
  try {
    const url = `${FB_API}/${postId}?fields=likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_reach,post_engaged_users)&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    const insights = {};
    (data.insights?.data || []).forEach(item => {
      insights[item.name] = item.values?.[0]?.value || 0;
    });

    return {
      success: true,
      metrics: {
        likes: data.likes?.summary?.total_count || 0,
        comments: data.comments?.summary?.total_count || 0,
        shares: data.shares?.count || 0,
        impressions: insights.post_impressions || 0,
        reach: insights.post_reach || 0,
        engagement: insights.post_engaged_users || 0
      }
    };
  } catch (err) {
    console.error('[social-api] FB metrics exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Get Facebook page info (followers, name, etc.).
 */
async function getFacebookPageInfo(account) {
  try {
    const url = `${FB_API}/${account.pageId}?fields=name,fan_count,followers_count,picture&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    return {
      success: true,
      info: {
        name: data.name,
        followers: data.followers_count || data.fan_count || 0,
        picture: data.picture?.data?.url
      }
    };
  } catch (err) {
    console.error('[social-api] FB page info exception:', err);
    return { success: false, error: err.message };
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Wait for an Instagram media container to finish processing (videos/reels).
 */
async function waitForMediaProcessing(account, containerId, maxWait = 120000) {
  const start = Date.now();
  const interval = 3000;

  while (Date.now() - start < maxWait) {
    try {
      const url = `${IG_API}/${containerId}?fields=status_code&access_token=${account.accessToken}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.status_code === 'FINISHED') {
        return true;
      }

      if (data.status_code === 'ERROR') {
        console.error('[social-api] Media processing failed:', data);
        return false;
      }

      // Still IN_PROGRESS — wait and retry
      await new Promise(resolve => setTimeout(resolve, interval));
    } catch (err) {
      console.error('[social-api] Processing check error:', err);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  return false;
}

/**
 * Build the full caption with hashtags appended.
 */
function buildCaption(post) {
  let caption = post.caption || '';
  const hashtags = post.hashtags || [];

  if (hashtags.length > 0) {
    const hashtagStr = hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
    caption = caption.trim() + '\n\n' + hashtagStr;
  }

  return caption;
}

// ── Instagram & Facebook Comments / Conversations ────────────────

/**
 * Fetch comments on an Instagram media post.
 */
async function getInstagramComments(account, mediaId) {
  try {
    const url = `${IG_API}/${mediaId}/comments?fields=id,text,username,timestamp,replies{id,text,username,timestamp}&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error('[social-api] IG comments error:', data.error);
      return { success: false, error: data.error.message };
    }

    return { success: true, comments: data.data || [] };
  } catch (err) {
    console.error('[social-api] IG comments exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Reply to an Instagram comment.
 */
async function replyToInstagramComment(account, commentId, text) {
  try {
    const res = await fetch(`${IG_API}/${commentId}/replies`, {
      method: 'POST',
      body: new URLSearchParams({
        message: text,
        access_token: account.accessToken
      })
    });
    const data = await res.json();

    if (data.error) {
      console.error('[social-api] IG reply error:', data.error);
      return { success: false, error: data.error.message };
    }

    return { success: true, id: data.id };
  } catch (err) {
    console.error('[social-api] IG reply exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch comments on a Facebook post.
 */
async function getFacebookComments(account, postId) {
  try {
    const url = `${FB_API}/${postId}/comments?fields=id,message,from,created_time,comments{id,message,from,created_time}&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error('[social-api] FB comments error:', data.error);
      return { success: false, error: data.error.message };
    }

    return { success: true, comments: data.data || [] };
  } catch (err) {
    console.error('[social-api] FB comments exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Reply to a Facebook comment.
 */
async function replyToFacebookComment(account, commentId, text) {
  try {
    const res = await fetch(`${FB_API}/${commentId}/comments`, {
      method: 'POST',
      body: new URLSearchParams({
        message: text,
        access_token: account.accessToken
      })
    });
    const data = await res.json();

    if (data.error) {
      console.error('[social-api] FB reply error:', data.error);
      return { success: false, error: data.error.message };
    }

    return { success: true, id: data.id };
  } catch (err) {
    console.error('[social-api] FB reply exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch Instagram DM conversations (via Page-connected IG account).
 */
async function getInstagramConversations(account) {
  try {
    const url = `${IG_API}/${account.igAccountId}/conversations?fields=id,participants,messages.limit(100){id,message,from,created_time}&platform=instagram&limit=100&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error('[social-api] IG conversations error:', data.error);
      return { success: false, error: data.error.message };
    }

    return { success: true, conversations: data.data || [] };
  } catch (err) {
    console.error('[social-api] IG conversations exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch Facebook Page conversations.
 */
async function getFacebookConversations(account) {
  try {
    const url = `${FB_API}/${account.pageId}/conversations?fields=id,participants,messages.limit(100){id,message,from,created_time}&limit=100&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error('[social-api] FB conversations error:', data.error);
      return { success: false, error: data.error.message };
    }

    return { success: true, conversations: data.data || [] };
  } catch (err) {
    console.error('[social-api] FB conversations exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send a message in a Facebook conversation.
 */
async function sendFacebookMessage(account, conversationId, text) {
  try {
    const res = await fetch(`${FB_API}/${conversationId}/messages`, {
      method: 'POST',
      body: new URLSearchParams({
        message: text,
        access_token: account.accessToken
      })
    });
    const data = await res.json();

    if (data.error) {
      console.error('[social-api] FB send message error:', data.error);
      return { success: false, error: data.error.message };
    }

    return { success: true, id: data.id };
  } catch (err) {
    console.error('[social-api] FB send message exception:', err);
    return { success: false, error: err.message };
  }
}

// ── TikTok Publishing ───────────────────────────────────────────

const TT_API = 'https://open.tiktokapis.com/v2';
const TT_CLIENT_KEY = 'aw0ak2eupqflz21x';
const TT_CLIENT_SECRET = 'dxz3xIbgqPEw980FWUaGDeuRh15LxTfb';

/**
 * Refresh TikTok access token using refresh token.
 * Returns { accessToken, refreshToken } or null on failure.
 */
async function refreshTikTokToken(refreshToken) {
  try {
    const res = await fetch(`${TT_API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: TT_CLIENT_KEY,
        client_secret: TT_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString()
    });
    const data = await res.json();
    if (data.access_token) {
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken
      };
    }
    console.error('[social-api] TikTok refresh failed:', data);
    return null;
  } catch (err) {
    console.error('[social-api] TikTok refresh exception:', err);
    return null;
  }
}

/**
 * Publish a video to TikTok via Content Posting API.
 * Requires: account.accessToken, post.media[0] (video URL)
 */
async function publishToTikTok(account, post) {
  const { accessToken } = account;
  const caption = buildCaption(post);
  const media = post.media || [];

  if (media.length === 0) {
    return { success: false, error: 'TikTok requires a video' };
  }

  const videoUrl = media[0];

  // Detect video from multiple signals:
  // 1. Explicit mediaType from the composer (reel/video/story all imply video)
  // 2. URL path extension (strip query params first — signed CDN URLs have ?token=&expires=)
  // 3. Content-type HEAD check as last resort
  const explicitType = (post.mediaType || '').toLowerCase();
  const isExplicitVideo = ['video', 'reel', 'reels', 'story', 'stories'].includes(explicitType);
  const urlPath = videoUrl.split('?')[0]; // strip query params before checking extension
  const hasVideoExt = /\.(mp4|mov|avi|wmv|webm|m4v|mkv)$/i.test(urlPath);
  // Bunny Stream URLs contain recognizable path patterns (play_720p, playlist.m3u8)
  const isBunnyStream = /\/play_\d+p\.mp4/i.test(videoUrl) || videoUrl.includes('playlist.m3u8');

  if (!isExplicitVideo && !hasVideoExt && !isBunnyStream) {
    // Last resort: check content-type via HEAD request
    let isVideoByContentType = false;
    try {
      const headRes = await fetch(videoUrl, { method: 'HEAD' });
      const ct = (headRes.headers.get('content-type') || '').toLowerCase();
      isVideoByContentType = ct.startsWith('video/');
    } catch (e) { /* ignore */ }

    if (!isVideoByContentType) {
      return { success: false, error: 'TikTok only supports video uploads' };
    }
  }

  try {
    // Step 1: Download video to memory buffer
    console.log('[social-api] TikTok: downloading video from', videoUrl.substring(0, 80));
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      return { success: false, error: `Failed to download video: HTTP ${videoRes.status}` };
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const videoSize = videoBuffer.length;
    console.log('[social-api] TikTok: downloaded', videoSize, 'bytes');

    if (videoSize < 1000) {
      return { success: false, error: 'Video file too small — likely a download error' };
    }

    // Step 2: Initialize FILE_UPLOAD with TikTok
    // Chunk size: 10 MB (must be >= 5 MB, <= 64 MB; final chunk can be up to 128 MB)
    const CHUNK_SIZE = 10 * 1024 * 1024;
    const totalChunkCount = Math.ceil(videoSize / CHUNK_SIZE);

    const initRes = await fetch(`${TT_API}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify({
        post_info: {
          title: caption.substring(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: CHUNK_SIZE,
          total_chunk_count: totalChunkCount
        }
      })
    });

    const initData = await initRes.json();

    if (initData.error && initData.error.code !== 'ok') {
      console.error('[social-api] TikTok init error:', initData.error);
      return { success: false, error: initData.error.message || 'TikTok init failed' };
    }

    const publishId = initData.data?.publish_id;
    const uploadUrl = initData.data?.upload_url;
    if (!publishId || !uploadUrl) {
      return { success: false, error: 'TikTok init did not return publish_id or upload_url' };
    }

    // Step 3: Upload video in chunks via PUT to the upload_url
    for (let chunkIdx = 0; chunkIdx < totalChunkCount; chunkIdx++) {
      const start = chunkIdx * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, videoSize);
      const chunk = videoBuffer.subarray(start, end);

      const contentRange = `bytes ${start}-${end - 1}/${videoSize}`;
      console.log(`[social-api] TikTok: uploading chunk ${chunkIdx + 1}/${totalChunkCount} (${contentRange})`);

      const chunkRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(chunk.length),
          'Content-Range': contentRange
        },
        body: chunk
      });

      if (!chunkRes.ok && chunkRes.status !== 201) {
        const errBody = await chunkRes.text().catch(() => '');
        console.error(`[social-api] TikTok chunk ${chunkIdx + 1} failed:`, chunkRes.status, errBody.substring(0, 200));
        return { success: false, error: `TikTok chunk upload failed: HTTP ${chunkRes.status}` };
      }
    }

    console.log('[social-api] TikTok: all chunks uploaded, waiting for processing');

    // Step 4: Poll for publish status (TikTok processes async)
    const statusResult = await waitForTikTokPublish(accessToken, publishId, 180000);
    if (statusResult.success) {
      console.log('[social-api] TikTok published:', statusResult.id);
      return { success: true, id: statusResult.id || publishId };
    }

    return statusResult;
  } catch (err) {
    console.error('[social-api] TikTok publish exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Wait for TikTok video to finish processing.
 */
async function waitForTikTokPublish(accessToken, publishId, maxWait = 180000) {
  const start = Date.now();
  const interval = 5000;

  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${TT_API}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify({ publish_id: publishId })
      });
      const data = await res.json();
      const status = data.data?.status;

      if (status === 'PUBLISH_COMPLETE') {
        return { success: true, id: data.data?.publicaly_available_post_id?.[0] || publishId };
      }
      if (status === 'FAILED') {
        return { success: false, error: data.data?.fail_reason || 'TikTok publish failed' };
      }

      // Still processing
      await new Promise(resolve => setTimeout(resolve, interval));
    } catch (err) {
      console.error('[social-api] TikTok status check error:', err);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  return { success: false, error: 'TikTok processing timed out' };
}

/**
 * Get TikTok user info.
 */
async function getTikTokAccountInfo(account) {
  try {
    const res = await fetch(`${TT_API}/user/info/?fields=display_name,avatar_url,follower_count,username`, {
      headers: { 'Authorization': `Bearer ${account.accessToken}` }
    });
    const data = await res.json();

    if (data.error && data.error.code !== 'ok') {
      return { success: false, error: data.error.message };
    }

    const user = data.data?.user || {};
    return {
      success: true,
      info: {
        name: user.display_name || '',
        username: user.username || '',
        followers: user.follower_count || 0,
        profilePicture: user.avatar_url || null
      }
    };
  } catch (err) {
    console.error('[social-api] TikTok account info exception:', err);
    return { success: false, error: err.message };
  }
}


// ── LinkedIn Publishing ─────────────────────────────────────────

const LI_API = 'https://api.linkedin.com/v2';
const LI_REST_API = 'https://api.linkedin.com/rest';

/**
 * Publish to a LinkedIn organization page.
 * Supports text-only, single image, or single video.
 */
async function publishToLinkedIn(account, post) {
  const { accessToken, organizationId } = account;
  const caption = buildCaption(post);
  const media = post.media || [];
  const mediaType = (post.mediaType || 'auto').toLowerCase();

  // LinkedIn does not support Stories (deprecated 2021)
  if (mediaType === 'story') {
    return { success: false, error: 'LinkedIn does not support Stories' };
  }

  // Determine author: try organization first, fall back to member profile
  let author;
  if (organizationId) {
    author = `urn:li:organization:${organizationId}`;
  }

  // Also get the person ID as a fallback
  let personId = account.personId;
  if (!personId) {
    try {
      const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (meRes.ok) {
        const meData = await meRes.json();
        personId = meData.sub;
        console.log('[social-api] LinkedIn person ID:', personId);
      }
    } catch (e) {
      console.warn('[social-api] Failed to get LinkedIn person ID:', e.message);
    }
  }

  if (!author && !personId) {
    return { success: false, error: 'LinkedIn requires organizationId or valid access token with profile scope' };
  }

  try {
    // Publish function that tries org first, falls back to person
    async function tryPublish(publishFn) {
      if (author) {
        const result = await publishFn(author);
        // If org posting fails (likely due to missing org scope), try as person
        if (!result.success && personId && result.error &&
            (result.error.includes('author') || result.error.includes('permission') ||
             result.error.includes('Data Processing') || result.error.includes('ACCESS_DENIED'))) {
          console.log('[social-api] LinkedIn org post failed, retrying as person:', personId);
          return publishFn(`urn:li:person:${personId}`);
        }
        return result;
      }
      return publishFn(`urn:li:person:${personId}`);
    }

    if (media.length === 0) {
      return tryPublish(a => publishLinkedInText(accessToken, a, caption));
    }

    const mediaUrl = media[0];
    const isVideo = /\.(mp4|mov|avi|wmv)$/i.test(mediaUrl);

    if (isVideo) {
      return tryPublish(a => publishLinkedInVideo(accessToken, a, caption, mediaUrl));
    }

    return tryPublish(a => publishLinkedInImage(accessToken, a, caption, mediaUrl));
  } catch (err) {
    console.error('[social-api] LinkedIn publish exception:', err);
    return { success: false, error: err.message };
  }
}

async function publishLinkedInText(accessToken, author, caption) {
  const res = await fetch(`${LI_API}/ugcPosts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: caption },
          shareMediaCategory: 'NONE'
        }
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    })
  });

  const data = await res.json();
  if (data.id) {
    console.log('[social-api] LinkedIn text published:', data.id);
    return { success: true, id: data.id };
  }
  console.error('[social-api] LinkedIn text error:', data);
  return { success: false, error: data.message || 'LinkedIn post failed' };
}

async function publishLinkedInImage(accessToken, author, caption, imageUrl) {
  // Step 1: Register upload
  const registerRes = await fetch(`${LI_API}/assets?action=registerUpload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: author,
        serviceRelationships: [{
          relationshipType: 'OWNER',
          identifier: 'urn:li:userGeneratedContent'
        }]
      }
    })
  });

  const registerData = await registerRes.json();
  const uploadUrl = registerData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  const asset = registerData.value?.asset;

  if (!uploadUrl || !asset) {
    return { success: false, error: 'LinkedIn image upload registration failed' };
  }

  // Step 2: Download image and upload to LinkedIn
  const imgRes = await fetch(imageUrl);
  const imgBuffer = await imgRes.arrayBuffer();

  await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'image/jpeg'
    },
    body: Buffer.from(imgBuffer)
  });

  // Step 3: Create post with image
  const postRes = await fetch(`${LI_API}/ugcPosts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: caption },
          shareMediaCategory: 'IMAGE',
          media: [{
            status: 'READY',
            media: asset,
            title: { text: caption.substring(0, 100) }
          }]
        }
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    })
  });

  const postData = await postRes.json();
  if (postData.id) {
    console.log('[social-api] LinkedIn image published:', postData.id);
    return { success: true, id: postData.id };
  }
  return { success: false, error: postData.message || 'LinkedIn image post failed' };
}

async function publishLinkedInVideo(accessToken, author, caption, videoUrl) {
  // LinkedIn video upload is complex — use a simpler article share with video link
  const res = await fetch(`${LI_API}/ugcPosts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: caption },
          shareMediaCategory: 'ARTICLE',
          media: [{
            status: 'READY',
            originalUrl: videoUrl,
            title: { text: caption.substring(0, 100) }
          }]
        }
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    })
  });

  const data = await res.json();
  if (data.id) {
    console.log('[social-api] LinkedIn video published:', data.id);
    return { success: true, id: data.id };
  }
  return { success: false, error: data.message || 'LinkedIn video post failed' };
}

/**
 * Get LinkedIn organization info.
 */
async function getLinkedInOrgInfo(account) {
  try {
    const res = await fetch(`${LI_API}/organizations/${account.organizationId}?projection=(id,localizedName,vanityName,logoV2(original~:playableStreams))`, {
      headers: { 'Authorization': `Bearer ${account.accessToken}` }
    });
    const data = await res.json();

    if (data.status && data.status >= 400) {
      return { success: false, error: data.message || 'LinkedIn API error' };
    }

    // Get follower count
    let followers = 0;
    try {
      const followRes = await fetch(`${LI_API}/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn:li:organization:${account.organizationId}`, {
        headers: { 'Authorization': `Bearer ${account.accessToken}` }
      });
      const followData = await followRes.json();
      const elements = followData.elements || [];
      if (elements.length > 0) {
        followers = elements[0].followerCounts?.organicFollowerCount || 0;
      }
    } catch (e) {
      // Follower count is optional
    }

    return {
      success: true,
      info: {
        name: data.localizedName || '',
        username: data.vanityName || '',
        followers,
        profilePicture: null
      }
    };
  } catch (err) {
    console.error('[social-api] LinkedIn org info exception:', err);
    return { success: false, error: err.message };
  }
}

// ── YouTube Publishing ──────────────────────────────────────────

const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3/videos';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CLIENT_ID = '969617587598-u23upn58qi3l3i1dgqm4en1th9kel602.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

/**
 * Refresh a Google/YouTube access token using the refresh token.
 */
async function refreshGoogleToken(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  }
  return data.access_token;
}

/**
 * Publish a video to YouTube via resumable upload.
 * YouTube only supports video — image posts are not supported.
 * Caption is split into title (first line, max 100 chars) and description (rest).
 */
async function publishToYouTube(account, post) {
  let { accessToken, refreshToken } = account;
  const caption = buildCaption(post);
  const media = post.media || [];

  if (media.length === 0) {
    return { success: false, error: 'YouTube requires a video' };
  }

  const videoUrl = media[0];
  const ytUrlPath = videoUrl.split('?')[0];
  const ytExplicitType = (post.mediaType || '').toLowerCase();
  const isVideo = ['video', 'reel', 'reels'].includes(ytExplicitType)
    || /\.(mp4|mov|avi|wmv|webm|m4v|mkv)$/i.test(ytUrlPath)
    || /\/play_\d+p\.mp4/i.test(videoUrl);
  if (!isVideo) {
    return { success: false, error: 'YouTube only supports video uploads' };
  }

  // Split caption into title + description
  const lines = caption.split('\n').filter(l => l.trim());
  const title = (lines[0] || 'Yoga Bible').substring(0, 100);
  const description = lines.length > 1 ? lines.slice(1).join('\n') : caption;

  try {
    // Refresh token if we have a refresh token
    if (refreshToken) {
      try {
        accessToken = await refreshGoogleToken(refreshToken);
      } catch (e) {
        console.warn('[social-api] YouTube token refresh failed, using existing token:', e.message);
      }
    }

    // Step 1: Download the video
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      return { success: false, error: `Failed to download video: ${videoRes.status}` };
    }
    const videoBuffer = await videoRes.arrayBuffer();

    // Step 2: Initiate resumable upload
    const initRes = await fetch(`${YT_UPLOAD_API}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': videoBuffer.byteLength.toString(),
        'X-Upload-Content-Type': 'video/mp4'
      },
      body: JSON.stringify({
        snippet: {
          title,
          description,
          tags: (post.hashtags || []).map(h => h.replace('#', '')).slice(0, 30),
          categoryId: '17' // Sports category
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false
        }
      })
    });

    if (!initRes.ok) {
      const errBody = await initRes.text();
      console.error('[social-api] YouTube upload init error:', errBody);
      return { success: false, error: `YouTube upload init failed: ${initRes.status}` };
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      return { success: false, error: 'No resumable upload URL returned' };
    }

    // Step 3: Upload video data
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoBuffer.byteLength.toString()
      },
      body: Buffer.from(videoBuffer)
    });

    const uploadData = await uploadRes.json();

    if (uploadData.error) {
      console.error('[social-api] YouTube upload error:', uploadData.error);
      return { success: false, error: uploadData.error.message || 'YouTube upload failed' };
    }

    console.log('[social-api] YouTube published:', uploadData.id);
    return { success: true, id: uploadData.id, refreshedToken: refreshToken ? accessToken : null };
  } catch (err) {
    console.error('[social-api] YouTube publish exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Get YouTube channel info (name, subscribers, picture).
 */
async function getYouTubeChannelInfo(account) {
  let { accessToken, refreshToken } = account;

  try {
    if (refreshToken) {
      try { accessToken = await refreshGoogleToken(refreshToken); } catch (e) { /* use existing */ }
    }

    const res = await fetch(`${YT_API}/channels?part=snippet,statistics&mine=true`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (data.error) {
      return { success: false, error: data.error.message || 'YouTube API error' };
    }

    const channel = (data.items || [])[0];
    if (!channel) {
      return { success: false, error: 'No YouTube channel found for this account' };
    }

    return {
      success: true,
      info: {
        name: channel.snippet?.title || '',
        username: channel.snippet?.customUrl || '',
        channelId: channel.id,
        followers: parseInt(channel.statistics?.subscriberCount || '0', 10),
        profilePicture: channel.snippet?.thumbnails?.default?.url || null
      },
      refreshedToken: refreshToken ? accessToken : null
    };
  } catch (err) {
    console.error('[social-api] YouTube channel info exception:', err);
    return { success: false, error: err.message };
  }
}


// ── Pinterest Publishing ────────────────────────────────────────

const PIN_API = 'https://api.pinterest.com/v5';

/**
 * Create a pin on Pinterest.
 * Supports images and video. Caption → title + description.
 */
async function publishToPinterest(account, post) {
  const { accessToken, boardId } = account;
  const caption = buildCaption(post);
  const media = post.media || [];

  if (media.length === 0) {
    return { success: false, error: 'Pinterest requires at least one image or video' };
  }

  // Split caption into title + description
  const lines = caption.split('\n').filter(l => l.trim());
  const title = (lines[0] || '').substring(0, 100);
  const description = lines.length > 1 ? lines.slice(1).join('\n').substring(0, 500) : caption.substring(0, 500);

  const mediaUrl = media[0];
  const isVideo = /\.(mp4|mov|avi|wmv|webm)$/i.test(mediaUrl);

  try {
    if (isVideo) {
      // Video pin — register media first
      const registerRes = await fetch(`${PIN_API}/media`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ media_type: 'video' })
      });
      const registerData = await registerRes.json();

      if (!registerData.media_id) {
        return { success: false, error: 'Pinterest video registration failed' };
      }

      // Upload video via the upload URL
      const uploadUrl = registerData.upload_url;
      if (uploadUrl) {
        const videoRes = await fetch(mediaUrl);
        const videoBuffer = await videoRes.arrayBuffer();
        await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'video/mp4' },
          body: Buffer.from(videoBuffer)
        });
      }

      // Wait for processing then create pin
      const mediaId = registerData.media_id;
      await new Promise(resolve => setTimeout(resolve, 5000));

      const pinRes = await fetch(`${PIN_API}/pins`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          description,
          board_id: boardId || undefined,
          media_source: {
            source_type: 'video_id',
            media_id: mediaId,
            cover_image_url: media[1] || mediaUrl // Use second media as cover if available
          },
          alt_text: (post.altTexts && post.altTexts['0']) || title
        })
      });

      const pinData = await pinRes.json();
      if (pinData.id) {
        console.log('[social-api] Pinterest video pin published:', pinData.id);
        return { success: true, id: pinData.id };
      }
      console.error('[social-api] Pinterest video pin error:', pinData);
      return { success: false, error: pinData.message || 'Pinterest video pin failed' };
    }

    // Image pin
    const pinRes = await fetch(`${PIN_API}/pins`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title,
        description,
        board_id: boardId || undefined,
        media_source: {
          source_type: 'image_url',
          url: mediaUrl
        },
        alt_text: (post.altTexts && post.altTexts['0']) || title
      })
    });

    const pinData = await pinRes.json();
    if (pinData.id) {
      console.log('[social-api] Pinterest pin published:', pinData.id);
      return { success: true, id: pinData.id };
    }
    console.error('[social-api] Pinterest pin error:', pinData);
    return { success: false, error: pinData.message || 'Pinterest pin creation failed' };
  } catch (err) {
    console.error('[social-api] Pinterest publish exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Get Pinterest account info (username, followers, profile picture).
 */
async function getPinterestAccountInfo(account) {
  try {
    const res = await fetch(`${PIN_API}/user_account`, {
      headers: { 'Authorization': `Bearer ${account.accessToken}` }
    });
    const data = await res.json();

    if (data.code) {
      return { success: false, error: data.message || 'Pinterest API error' };
    }

    return {
      success: true,
      info: {
        name: data.business_name || data.username || '',
        username: data.username || '',
        followers: data.follower_count || 0,
        profilePicture: data.profile_image || null
      }
    };
  } catch (err) {
    console.error('[social-api] Pinterest account info exception:', err);
    return { success: false, error: err.message };
  }
}


// ── Story Publishing ──────────────────────────────────────────────

/**
 * Publish a story to Instagram.
 * Wraps publishToInstagram with STORIES media type + link sticker support.
 */
async function publishStoryToInstagram(account, story) {
  const { accessToken, igAccountId } = account;
  const mediaUrl = story.media;
  if (!mediaUrl) return { success: false, error: 'Story requires a media URL' };

  const isVideo = /\.(mp4|mov|avi|wmv|webm)$/i.test(mediaUrl);

  try {
    const containerParams = new URLSearchParams({
      media_type: 'STORIES',
      access_token: accessToken
    });

    if (isVideo) {
      containerParams.set('video_url', mediaUrl);
    } else {
      containerParams.set('image_url', mediaUrl);
    }

    // Link sticker (Instagram API supports link stickers on stories)
    if (story.linkUrl) {
      containerParams.set('link', story.linkUrl);
    }

    // Create media container
    const containerRes = await fetch(`${IG_API}/${igAccountId}/media`, {
      method: 'POST',
      body: containerParams
    });
    const containerData = await containerRes.json();

    if (containerData.error) {
      console.error('[social-api] IG story container error:', containerData.error);
      return { success: false, error: containerData.error.message };
    }

    // Wait for processing
    const ready = await waitForMediaProcessing(account, containerData.id, 120000);
    if (!ready) {
      return { success: false, error: 'Story media processing timed out after 120s' };
    }

    // Publish
    const publishRes = await fetch(`${IG_API}/${igAccountId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: containerData.id,
        access_token: accessToken
      })
    });
    const publishData = await publishRes.json();

    if (publishData.error) {
      console.error('[social-api] IG story publish error:', publishData.error);
      return { success: false, error: publishData.error.message };
    }

    console.log('[social-api] IG story published:', publishData.id);
    return { success: true, id: publishData.id };
  } catch (err) {
    console.error('[social-api] IG story exception:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Publish a story to Facebook Page.
 * Uses the /PAGE_ID/photo_stories or /PAGE_ID/video_stories endpoint.
 */
async function publishStoryToFacebook(account, story) {
  const { accessToken, pageId } = account;
  const mediaUrl = story.media;
  if (!mediaUrl) return { success: false, error: 'Story requires a media URL' };

  const isVideo = /\.(mp4|mov|avi|wmv|webm)$/i.test(mediaUrl);

  try {
    if (isVideo) {
      // Video story — upload to video_stories endpoint
      const res = await fetch(`${FB_API}/${pageId}/video_stories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'start',
          access_token: accessToken
        })
      });
      const startData = await res.json();

      if (startData.error) {
        console.error('[social-api] FB video story start error:', startData.error);
        return { success: false, error: startData.error.message };
      }

      // Upload the video
      const uploadRes = await fetch(`${FB_API}/${startData.video_id}`, {
        method: 'POST',
        body: new URLSearchParams({
          file_url: mediaUrl,
          upload_phase: 'finish',
          access_token: accessToken
        })
      });
      const uploadData = await uploadRes.json();

      if (uploadData.error) {
        console.error('[social-api] FB video story upload error:', uploadData.error);
        return { success: false, error: uploadData.error.message };
      }

      console.log('[social-api] FB video story published:', startData.video_id);
      return { success: true, id: startData.video_id };
    }

    // Photo story
    const res = await fetch(`${FB_API}/${pageId}/photo_stories`, {
      method: 'POST',
      body: new URLSearchParams({
        photo_id: '', // Will use url instead
        url: mediaUrl,
        access_token: accessToken
      })
    });

    // Facebook photo_stories requires uploading a photo first, then using its ID
    // Alternative: upload unpublished photo first, then create story
    const uploadRes = await fetch(`${FB_API}/${pageId}/photos`, {
      method: 'POST',
      body: new URLSearchParams({
        url: mediaUrl,
        published: 'false',
        access_token: accessToken
      })
    });
    const uploadData = await uploadRes.json();

    if (uploadData.error) {
      console.error('[social-api] FB story photo upload error:', uploadData.error);
      return { success: false, error: uploadData.error.message };
    }

    const storyRes = await fetch(`${FB_API}/${pageId}/photo_stories`, {
      method: 'POST',
      body: new URLSearchParams({
        photo_id: uploadData.id,
        access_token: accessToken
      })
    });
    const storyData = await storyRes.json();

    if (storyData.error) {
      console.error('[social-api] FB photo story error:', storyData.error);
      return { success: false, error: storyData.error.message };
    }

    console.log('[social-api] FB photo story published:', storyData.post_id || storyData.id);
    return { success: true, id: storyData.post_id || storyData.id };
  } catch (err) {
    console.error('[social-api] FB story exception:', err);
    return { success: false, error: err.message };
  }
}


module.exports = {
  publishToInstagram,
  publishCarouselToInstagram,
  publishStoryToInstagram,
  publishStoryToFacebook,
  getInstagramMetrics,
  getInstagramAccountInfo,
  getInstagramComments,
  replyToInstagramComment,
  getInstagramConversations,
  publishToFacebook,
  getFacebookMetrics,
  getFacebookPageInfo,
  getFacebookComments,
  replyToFacebookComment,
  getFacebookConversations,
  sendFacebookMessage,
  publishToTikTok,
  getTikTokAccountInfo,
  refreshTikTokToken,
  publishToLinkedIn,
  getLinkedInOrgInfo,
  publishToYouTube,
  getYouTubeChannelInfo,
  refreshGoogleToken,
  publishToPinterest,
  getPinterestAccountInfo,
  waitForMediaProcessing,
  buildCaption
};
