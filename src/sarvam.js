const axios = require('axios');

const SARVAM_BASE_URL = process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai';
const SARVAM_CHAT_PATH = process.env.SARVAM_CHAT_PATH || '/v1/chat/completions';
const SARVAM_MODEL = process.env.SARVAM_MODEL || 'sarvam-m';
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

async function chatCompletion({ messages, temperature = 0.7, max_tokens = 512 }) {
  if (!SARVAM_API_KEY) {
    throw new Error('Missing SARVAM_API_KEY');
  }

  const url = `${SARVAM_BASE_URL}${SARVAM_CHAT_PATH}`;

  const payload = {
    model: SARVAM_MODEL,
    messages,
    temperature,
    max_tokens,
    stream: false
  };

  const headers = {
    Authorization: `Bearer ${SARVAM_API_KEY}`,
    'Content-Type': 'application/json'
  };

  const { data } = await axios.post(url, payload, { headers, timeout: 60_000 });

  // Assuming OpenAI-compatible response shape
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('No content returned from Sarvam API');
  }
  return content;
}

module.exports = { chatCompletion };
