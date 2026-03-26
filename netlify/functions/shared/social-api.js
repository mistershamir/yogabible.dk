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

  if (media.length === 0) {
    return { success: false, error: 'Instagram requires at least one media item' };
  }

  if (media.length > 1) {
    return publishCarouselToInstagram(account, post);
  }

  const mediaUrl = media[0];
  const isVideo = /\.(mp4|mov|avi|wmv)$/i.test(mediaUrl);

  try {
    // Step 1: Create media container
    const containerParams = new URLSearchParams({
      caption,
      access_token: accessToken
    });

    if (isVideo) {
      containerParams.set('media_type', 'REELS');
      containerParams.set('video_url', mediaUrl);
    } else {
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

    // Step 2: Wait for processing (videos need this)
    if (isVideo) {
      const ready = await waitForMediaProcessing(account, containerId, 120000);
      if (!ready) {
        return { success: false, error: 'Media processing timed out after 120s' };
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

    console.log('[social-api] IG published:', publishData.id);
    return { success: true, id: publishData.id };
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
    const url = `${IG_API}/${account.igAccountId}/conversations?fields=id,participants,messages{id,message,from,created_time}&platform=instagram&access_token=${account.accessToken}`;
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
    const url = `${FB_API}/${account.pageId}/conversations?fields=id,participants,messages.limit(10){id,message,from,created_time}&access_token=${account.accessToken}`;
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
  const isVideo = /\.(mp4|mov|avi|wmv)$/i.test(videoUrl);
  if (!isVideo) {
    return { success: false, error: 'TikTok only supports video uploads' };
  }

  try {
    // Step 1: Initialize upload via URL
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
          source: 'PULL_FROM_URL',
          video_url: videoUrl
        }
      })
    });

    const initData = await initRes.json();

    if (initData.error && initData.error.code !== 'ok') {
      console.error('[social-api] TikTok init error:', initData.error);
      return { success: false, error: initData.error.message || 'TikTok init failed' };
    }

    const publishId = initData.data?.publish_id;
    if (!publishId) {
      return { success: false, error: 'No publish_id returned from TikTok' };
    }

    // Step 2: Check publish status (TikTok processes async)
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

  if (!organizationId) {
    return { success: false, error: 'LinkedIn requires organizationId' };
  }

  const author = `urn:li:organization:${organizationId}`;

  try {
    // Text-only post
    if (media.length === 0) {
      return publishLinkedInText(accessToken, author, caption);
    }

    const mediaUrl = media[0];
    const isVideo = /\.(mp4|mov|avi|wmv)$/i.test(mediaUrl);

    if (isVideo) {
      return publishLinkedInVideo(accessToken, author, caption, mediaUrl);
    }

    // Image post
    return publishLinkedInImage(accessToken, author, caption, mediaUrl);
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

module.exports = {
  publishToInstagram,
  publishCarouselToInstagram,
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
  publishToLinkedIn,
  getLinkedInOrgInfo,
  waitForMediaProcessing,
  buildCaption
};
