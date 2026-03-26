/**
 * Social AI API — Yoga Bible
 * AI-powered caption and hashtag generation using Claude.
 *
 * POST /.netlify/functions/social-ai  { action: 'generate-caption', topic, platform? }
 * POST /.netlify/functions/social-ai  { action: 'generate-hashtags', topic }
 * POST /.netlify/functions/social-ai  { action: 'improve-caption', caption, platform? }
 */

const https = require('https');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const SYSTEM_PROMPT = `You are a social media manager for Yoga Bible, a yoga teacher training school in Copenhagen, Denmark. You create engaging, authentic social media content.

Brand voice:
- Warm, knowledgeable, and inspiring
- Personal and genuine — not corporate or generic
- Speaks to aspiring yoga teachers, wellness enthusiasts, and the Copenhagen yoga community
- Uses both Danish and English naturally (primary audience is international)

Content rules:
- NEVER mention the language of instruction (courses are taught in English, but never say this in marketing)
- NEVER mention refund policies
- Focus on transformation, community, personal growth, and the Copenhagen lifestyle
- Reference the yoga teacher training programs: 4-Week Intensive, 8-Week Semi-Intensive, 18-Week Flexible, and 4-Week Vinyasa Plus (July)
- Use "Preparation Phase" (not "deposit") when referring to the initial enrollment payment
- The school is located at Torvegade 66, 1400 Copenhagen K

Hashtag guidelines:
- Mix popular hashtags (#yoga, #yogateacher) with niche ones (#copenhagenYoga, #yogaTeacherTraining)
- Include location hashtags (#copenhagen, #denmark, #scandinavia)
- Use brand hashtags (#yogabible, #yogabibleDK)
- Never exceed 30 hashtags per post

Always respond with valid JSON only — no markdown code fences, no explanation text.`;


/**
 * Call the Claude API via raw HTTPS (matches existing codebase pattern).
 */
function claudeRequest(messages, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var required');

  return new Promise(function (resolve, reject) {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens || 2000,
      system: SYSTEM_PROMPT,
      messages: messages
    });

    const opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(opts, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const raw = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(raw);
          if (json.content && json.content[0]) {
            resolve(json.content[0].text);
          } else {
            reject(new Error('Claude API unexpected response: ' + raw.substring(0, 300)));
          }
        } catch (e) {
          reject(new Error('Claude API parse error: ' + raw.substring(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Parse JSON from Claude response, handling possible markdown fences.
 */
function parseJsonResponse(text) {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    // Try extracting from markdown code block
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
      return JSON.parse(fenceMatch[1].trim());
    }
    // Try finding first { ... } block
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      return JSON.parse(objMatch[0]);
    }
    throw new Error('Failed to parse AI response as JSON');
  }
}


exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonResponse(500, { ok: false, error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    switch (action) {
      case 'generate-caption': return generateCaption(body);
      case 'generate-hashtags': return generateHashtags(body);
      case 'improve-caption': return improveCaption(body);
      case 'generate-bilingual': return generateBilingual(body);
      case 'adapt-tone': return adaptTone(body);
      case 'repurpose-blog': return repurposeBlog(body);
      case 'translate': return translateCaption(body);
      case 'reply-comment': return replyComment(body);
      case 'content-plan': return contentPlan(body);
      case 'ab-variants': return abVariants(body);
      case 'alt-text': return generateAltText(body);
      case 'analytics-insight': return analyticsInsight(body);
      case 'smart-blog-caption': return smartBlogCaption(body);
      default:
        return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[social-ai] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ── Generate caption variants ───────────────────────────────────

async function generateCaption(body) {
  const { topic, platform, tone, language } = body;

  if (!topic) {
    return jsonResponse(400, { ok: false, error: 'Missing topic' });
  }

  const platformHint = platform
    ? `Optimize for ${platform}. ${platform === 'instagram' ? 'Instagram captions can be up to 2200 chars. Use line breaks for readability.' : 'Facebook posts perform best at 40-80 characters but can be longer for storytelling.'}`
    : 'Write captions suitable for both Instagram and Facebook.';

  const toneHint = tone ? `Tone: ${tone}.` : '';
  const langHint = language === 'da' ? 'Write in Danish.' : language === 'en' ? 'Write in English.' : 'Write in English (primary audience is international).';

  const text = await claudeRequest([{
    role: 'user',
    content: `Generate 3 different caption variants for a social media post about: "${topic}"

${platformHint}
${toneHint}
${langHint}

For each variant, also suggest 15-20 relevant hashtags.

Respond with this exact JSON structure:
{
  "variants": [
    {
      "caption": "The caption text with line breaks as \\n",
      "hashtags": ["hashtag1", "hashtag2"],
      "style": "brief description of this variant's style"
    }
  ]
}`
  }], 2000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse caption response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Generate hashtags ───────────────────────────────────────────

async function generateHashtags(body) {
  const { topic, count } = body;

  if (!topic) {
    return jsonResponse(400, { ok: false, error: 'Missing topic' });
  }

  const targetCount = count || 25;

  const text = await claudeRequest([{
    role: 'user',
    content: `Generate ${targetCount} relevant hashtags for a social media post about: "${topic}"

Mix of:
- 5-7 high-volume hashtags (1M+ posts)
- 8-10 medium-volume hashtags (100K-1M posts)
- 5-7 niche/specific hashtags (<100K posts)
- 2-3 brand/location hashtags

Respond with this exact JSON structure:
{
  "hashtags": ["hashtag1", "hashtag2"],
  "categories": {
    "popular": ["hashtag1"],
    "medium": ["hashtag1"],
    "niche": ["hashtag1"],
    "brand": ["hashtag1"]
  }
}`
  }], 1000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse hashtag response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Improve existing caption ────────────────────────────────────

async function improveCaption(body) {
  const { caption, platform, direction } = body;

  if (!caption) {
    return jsonResponse(400, { ok: false, error: 'Missing caption' });
  }

  const platformHint = platform
    ? `Optimize for ${platform}.`
    : 'Suitable for both Instagram and Facebook.';

  const directionHint = direction
    ? `Additional direction: ${direction}.`
    : '';

  const text = await claudeRequest([{
    role: 'user',
    content: `Improve this social media caption. Give me 3 variants:
1. A shorter, punchier version
2. A longer, more storytelling version
3. A more engaging version (with a question or CTA)

Original caption:
"""
${caption}
"""

${platformHint}
${directionHint}

Respond with this exact JSON structure:
{
  "variants": [
    {
      "caption": "The improved caption text",
      "style": "shorter"
    },
    {
      "caption": "The improved caption text",
      "style": "storytelling"
    },
    {
      "caption": "The improved caption text",
      "style": "engaging"
    }
  ]
}`
  }], 2000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse improve response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Generate bilingual (DA + EN) captions ─────────────────────

async function generateBilingual(body) {
  const { topic, platform } = body;
  if (!topic) return jsonResponse(400, { ok: false, error: 'Missing topic' });

  const platformHint = platform
    ? `Optimize for ${platform}.`
    : 'Suitable for Instagram and Facebook.';

  const text = await claudeRequest([{
    role: 'user',
    content: `Generate bilingual social media captions about: "${topic}"

${platformHint}

IMPORTANT: Danish should NOT be a translation of English or vice versa.
- Danish: Practical, local tone. Speak to the Copenhagen yoga community naturally.
- English: Aspirational, international tone. Speak to people dreaming of yoga in Copenhagen.
Both should have the same core message but different angles.

Respond with this exact JSON structure:
{
  "da": {
    "caption": "Danish caption with line breaks as \\n",
    "hashtags": ["#yoga", "#københavn"]
  },
  "en": {
    "caption": "English caption with line breaks as \\n",
    "hashtags": ["#yoga", "#copenhagen"]
  }
}`
  }], 2000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse bilingual response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Adapt tone per platform ────────────────────────────────────

async function adaptTone(body) {
  const { caption, platforms } = body;
  if (!caption) return jsonResponse(400, { ok: false, error: 'Missing caption' });

  const targetPlatforms = platforms || ['instagram', 'facebook', 'linkedin', 'tiktok'];

  const text = await claudeRequest([{
    role: 'user',
    content: `Adapt this caption for each social media platform. Same core message, but tailored to each platform's style and audience:

Original caption:
"""
${caption}
"""

Platforms to adapt for: ${targetPlatforms.join(', ')}

Guidelines:
- Instagram: Visual storytelling, emoji-friendly, 1-3 paragraphs with line breaks, end with CTA question
- Facebook: Conversational, slightly longer OK, can be more informative, include link CTA
- LinkedIn: Professional yet warm, focus on career/growth angle, thought leadership tone
- TikTok: Ultra casual, trendy, short, hook in first line, use trending formats
- YouTube: Description format, include timestamps placeholder, SEO keywords
- Pinterest: Descriptive, keyword-rich, pin-friendly title + description

Respond with this exact JSON structure:
{
  "adaptations": {
    "instagram": { "caption": "...", "note": "brief note on changes" },
    "facebook": { "caption": "...", "note": "..." },
    "linkedin": { "caption": "...", "note": "..." },
    "tiktok": { "caption": "...", "note": "..." }
  }
}`
  }], 3000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse adapt response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Repurpose blog/journal post into social posts ──────────────

async function repurposeBlog(body) {
  const { title, content, count } = body;
  if (!content) return jsonResponse(400, { ok: false, error: 'Missing content' });

  const postCount = count || 5;

  const text = await claudeRequest([{
    role: 'user',
    content: `Turn this blog post into ${postCount} separate social media posts for Instagram/Facebook.

Blog title: ${title || 'Untitled'}
Blog content:
"""
${content.substring(0, 4000)}
"""

Each post should:
- Cover a different key point or angle from the blog
- Stand alone (don't reference the blog post directly)
- Include a CTA or question at the end
- Have its own set of relevant hashtags (15-20 per post)
- Be optimized for Instagram (max 2200 chars)
- Suggest what kind of image/visual would pair well

Respond with this exact JSON structure:
{
  "posts": [
    {
      "caption": "Social post caption",
      "hashtags": ["#tag1", "#tag2"],
      "visual_suggestion": "Description of ideal image/visual for this post",
      "key_topic": "Brief label for this post's angle"
    }
  ]
}`
  }], 4000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse repurpose response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Translate caption between DA and EN ────────────────────────

async function translateCaption(body) {
  const { caption, from, to } = body;
  if (!caption) return jsonResponse(400, { ok: false, error: 'Missing caption' });

  const sourceLang = from || 'en';
  const targetLang = to || (sourceLang === 'en' ? 'da' : 'en');

  const text = await claudeRequest([{
    role: 'user',
    content: `Translate this social media caption from ${sourceLang === 'da' ? 'Danish' : 'English'} to ${targetLang === 'da' ? 'Danish' : 'English'}.

IMPORTANT: Do NOT literally translate. Rewrite naturally for the target audience:
${targetLang === 'da' ? '- Danish: Practical, local, speaks to Copenhagen community' : '- English: Aspirational, international, speaks to people dreaming of Copenhagen yoga'}

Original (${sourceLang}):
"""
${caption}
"""

Respond with this exact JSON structure:
{
  "caption": "The translated/adapted caption",
  "hashtags": ["relevant hashtags for ${targetLang} audience"]
}`
  }], 1500);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse translate response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Draft reply to a comment/DM ────────────────────────────────

async function replyComment(body) {
  const { comment, context, tone, platform } = body;
  if (!comment) return jsonResponse(400, { ok: false, error: 'Missing comment' });

  const contextHint = context ? `\nPost context: "${context}"` : '';
  const toneHint = tone || 'warm and personal, from Shamir';

  const text = await claudeRequest([{
    role: 'user',
    content: `Draft 3 reply options to this ${platform || 'social media'} comment/message.
${contextHint}

Comment to reply to:
"""
${comment}
"""

Tone: ${toneHint}

Rules:
- Reply as Shamir (Course Director at Yoga Bible)
- Keep replies concise and personal
- If asking about pricing, direct to yogabible.dk or suggest booking an info session
- If asking about course language, DO NOT mention it — redirect to program details
- If negative/complaint, be empathetic and offer to continue the conversation privately
- Include emoji sparingly and naturally

Respond with this exact JSON structure:
{
  "replies": [
    {
      "text": "The reply text",
      "style": "brief label (e.g., friendly, professional, detailed)",
      "note": "Why this reply works"
    }
  ],
  "sentiment": "positive|neutral|negative|question",
  "suggestPrivate": false
}`
  }], 1500);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse reply response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Generate content calendar plan ────────────────────────────

async function contentPlan(body) {
  const { days, themes, goals, existingPosts } = body;
  const planDays = days || 14;

  const existingHint = existingPosts && existingPosts.length
    ? `\nAlready scheduled posts:\n${existingPosts.map(p => `- ${p.date}: ${p.caption?.substring(0, 60)}`).join('\n')}`
    : '';

  const themesHint = themes && themes.length
    ? `Focus themes: ${themes.join(', ')}`
    : '';

  const goalsHint = goals ? `Campaign goals: ${goals}` : '';

  const text = await claudeRequest([{
    role: 'user',
    content: `Create a ${planDays}-day social media content plan for Yoga Bible.

${themesHint}
${goalsHint}
${existingHint}

Today's date: ${new Date().toISOString().split('T')[0]}

Content mix guidelines:
- 40% educational (yoga tips, anatomy, philosophy)
- 25% social proof (testimonials, student journeys, community)
- 20% lifestyle (Copenhagen life, studio vibes, behind-the-scenes)
- 15% promotional (programs, Preparation Phase, enrollment CTAs)

For each post suggest:
- Date and optimal posting time (Copenhagen timezone)
- Platform(s) to post on
- Caption idea (2-3 sentences)
- Visual type (photo, video, carousel, reel, story)
- Hashtag theme

Respond with this exact JSON structure:
{
  "plan": [
    {
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "platforms": ["instagram", "facebook"],
      "category": "educational|social_proof|lifestyle|promotional",
      "caption_idea": "Brief caption concept",
      "visual_type": "photo|video|carousel|reel|story",
      "visual_suggestion": "Description of ideal visual",
      "hashtag_theme": "yoga tips|community|copenhagen|training",
      "notes": "Any strategic notes"
    }
  ],
  "strategy_notes": "Overall strategy summary for this period"
}`
  }], 4000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse plan response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Generate A/B test caption variants ─────────────────────────

async function abVariants(body) {
  const { topic, count, platform, angle } = body;
  if (!topic) return jsonResponse(400, { ok: false, error: 'Missing topic' });

  const variantCount = Math.min(count || 3, 5);
  const angleHint = angle ? `Test angle: ${angle}` : 'Test different hooks, tones, and CTAs.';

  const text = await claudeRequest([{
    role: 'user',
    content: `Generate ${variantCount} distinctly different caption variants for A/B testing.

Topic: "${topic}"
Platform: ${platform || 'Instagram'}
${angleHint}

Each variant should test a different approach:
- Variant A: Hook-driven (attention-grabbing first line)
- Variant B: Story-driven (personal narrative)
- Variant C: Question-driven (engagement prompt)
${variantCount > 3 ? '- Variant D: Social proof (testimonial/stat-based)' : ''}
${variantCount > 4 ? '- Variant E: FOMO/urgency (scarcity angle)' : ''}

Respond with this exact JSON structure:
{
  "variants": [
    {
      "name": "Variant A — Hook",
      "caption": "The full caption text",
      "hypothesis": "Why this might win — what it tests",
      "hashtags": ["#tag1", "#tag2"]
    }
  ],
  "test_recommendation": "How long to run the test and what metric to measure"
}`
  }], 3000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse A/B response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Generate alt text for images ──────────────────────────────

async function generateAltText(body) {
  const { imageUrl, context } = body;
  if (!imageUrl) return jsonResponse(400, { ok: false, error: 'Missing imageUrl' });

  const contextHint = context ? `\nPost context: "${context}"` : '';

  const text = await claudeRequest([{
    role: 'user',
    content: `Generate accessible alt text for a social media image.

Image URL: ${imageUrl}
${contextHint}

Since I cannot see the image, use the URL path and context to infer what the image likely shows (e.g., yoga-bible-DK/studio/ → studio interior, yoga-bible-DK/programs/ → yoga training session).

Generate 3 options:
1. Concise (under 125 chars) — for screen readers
2. Descriptive (under 250 chars) — rich description
3. SEO-optimized — includes relevant keywords naturally

Respond with this exact JSON structure:
{
  "altTexts": [
    { "text": "...", "style": "concise", "charCount": 0 },
    { "text": "...", "style": "descriptive", "charCount": 0 },
    { "text": "...", "style": "seo", "charCount": 0 }
  ]
}`
  }], 1000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse alt text response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Natural language analytics insights ────────────────────────

async function analyticsInsight(body) {
  const { metrics, period, question } = body;
  if (!metrics) return jsonResponse(400, { ok: false, error: 'Missing metrics' });

  const questionHint = question
    ? `Specific question: "${question}"`
    : 'Provide general performance insights and actionable recommendations.';

  const text = await claudeRequest([{
    role: 'user',
    content: `Analyze these social media metrics and provide insights.

Period: ${period || 'recent'}

Metrics data:
${JSON.stringify(metrics, null, 2)}

${questionHint}

Provide:
1. Key performance highlights (what's working)
2. Areas of concern (what's not working)
3. Specific, actionable recommendations
4. Content strategy adjustments

Keep insights practical and specific to Yoga Bible's business (yoga teacher training enrollment).

Respond with this exact JSON structure:
{
  "summary": "One-paragraph executive summary",
  "highlights": ["highlight 1", "highlight 2"],
  "concerns": ["concern 1", "concern 2"],
  "recommendations": [
    {
      "action": "What to do",
      "reason": "Why",
      "priority": "high|medium|low"
    }
  ],
  "bestPerforming": {
    "postType": "reels|carousel|image|story",
    "topic": "What content resonated most",
    "bestDay": "day of week",
    "bestTime": "time range"
  }
}`
  }], 2000);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse insight response:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}


// ── Smart blog-to-social caption (for auto-post) ──────────────

async function smartBlogCaption(body) {
  const { title, excerpt, slug, platform, tags } = body;
  if (!title) return jsonResponse(400, { ok: false, error: 'Missing title' });

  const tagsHint = tags && tags.length ? `Blog tags: ${tags.join(', ')}` : '';
  const url = `https://yogabible.dk/yoga-journal/${slug}/`;

  const text = await claudeRequest([{
    role: 'user',
    content: `Write a native social media caption for ${platform || 'Instagram'} to promote this blog post.

Blog title: "${title}"
Blog excerpt: "${excerpt || ''}"
Blog URL: ${url}
${tagsHint}

Do NOT just copy the excerpt. Write a platform-native caption that:
- Opens with a compelling hook (question, bold statement, or surprising fact)
- Teases the blog content without giving everything away
- Ends with a CTA to read the full post (include the URL naturally)
- Feels like a genuine social media post, not a blog announcement

Also provide 15-20 hashtags.

Respond with this exact JSON structure:
{
  "caption": "The caption with \\n line breaks",
  "hashtags": ["#tag1", "#tag2"],
  "hook_type": "question|bold_statement|surprising_fact|story"
}`
  }], 1500);

  try {
    const parsed = parseJsonResponse(text);
    return jsonResponse(200, { ok: true, ...parsed });
  } catch (parseErr) {
    console.error('[social-ai] Failed to parse smart caption:', text.substring(0, 500));
    return jsonResponse(500, { ok: false, error: 'Failed to parse AI response' });
  }
}
