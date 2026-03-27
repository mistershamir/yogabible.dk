// Social AI Helpers — shared utilities for Claude-powered social features
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');

async function claudeRequest(prompt, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: options.model || 'claude-sonnet-4-6',
    max_tokens: options.maxTokens || 2048,
    messages: [{ role: 'user', content: prompt }]
  });

  return msg.content[0].text;
}

function parseJsonResponse(text) {
  // Try to extract JSON from the response (handles markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\[[\s\S]*\])/) || text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1].trim());
  }
  return JSON.parse(text.trim());
}

module.exports = { claudeRequest, parseJsonResponse };
