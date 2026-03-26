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
