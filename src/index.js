const fs = require('fs');
const path = require('path');

// Prefer file.env if present, else .env
const envPath = fs.existsSync(path.join(process.cwd(), 'file.env'))
  ? path.join(process.cwd(), 'file.env')
  : path.join(process.cwd(), '.env');

require('dotenv').config({ path: envPath });

const TelegramBot = require('node-telegram-bot-api');
const { chatCompletion } = require('./sarvam');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || ''; // without @
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  'You are a helpful assistant. Keep answers clear and concise unless asked for detail.';

if (!TELEGRAM_BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN. Add it to file.env or .env.');
  process.exit(1);
}

// In-memory per-user history: key = `${chatId}:${userId}`
const history = new Map();
const MAX_TURNS = 6; // keeps last N user-assistant exchanges (≈ 12 messages)

function keyFor(chatId, userId) {
  return `${chatId}:${userId}`;
}

function getHistory(key) {
  return history.get(key) || [];
}

function setHistory(key, msgs) {
  history.set(key, msgs);
}

function resetHistory(key) {
  history.delete(key);
}

function pushMessage(key, role, content) {
  const msgs = getHistory(key);
  msgs.push({ role, content });
  // Trim to last MAX_TURNS exchanges (user+assistant = 2 messages per turn)
  const maxMessages = MAX_TURNS * 2;
  const trimmed = msgs.slice(-maxMessages);
  setHistory(key, trimmed);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

function helpText() {
  return [
    'Here’s what I can do:',
    '',
    '/help — Show this help',
    '/reset — Clear your conversation history with me',
    '/ping — Quick health check',
    '',
    'Just send a message to chat with me.',
    '',
    'Groups:',
    '- By default I reply only in private chats.',
    '- To enable group mentions, set BOT_USERNAME in your env and mention me (e.g., @YourBot) in the message.',
  ].join('\n');
}

// Commands
bot.onText(/^\/start\b/, async (msg) => {
  await bot.sendMessage(msg.chat.id, helpText(), { reply_to_message_id: msg.message_id });
});

bot.onText(/^\/help\b/, async (msg) => {
  await bot.sendMessage(msg.chat.id, helpText(), { reply_to_message_id: msg.message_id });
});

bot.onText(/^\/ping\b/, async (msg) => {
  const now = new Date();
  const text = `pong ✅\n${now.toISOString()}`;
  await bot.sendMessage(msg.chat.id, text, { reply_to_message_id: msg.message_id });
});

bot.onText(/^\/reset\b/, async (msg) => {
  const k = keyFor(msg.chat.id, msg.from.id);
  resetHistory(k);
  await bot.sendMessage(msg.chat.id, 'Your conversation history has been cleared.', {
    reply_to_message_id: msg.message_id
  });
});

// Main message handler
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text;

    // Ignore non-text
    if (typeof text !== 'string') return;

    // Ignore commands (handled above)
    if (text.startsWith('/')) return;

    // Group logic: reply only when mentioned (if BOT_USERNAME set) or when replying to the bot
    const isGroup = ['group', 'supergroup'].includes(msg.chat.type);
    if (isGroup) {
      const replyingToBot = msg.reply_to_message?.from?.is_bot && msg.reply_to_message?.from?.username === BOT_USERNAME;
      const mentionedMe =
        BOT_USERNAME &&
        (text.includes(`@${BOT_USERNAME}`) ||
          (Array.isArray(msg.entities) &&
            msg.entities.some(
              (e) =>
                e.type === 'mention' &&
                text.slice(e.offset, e.offset + e.length).toLowerCase() === `@${BOT_USERNAME.toLowerCase()}`
            )));

      if (!replyingToBot && !mentionedMe) return; // ignore group chatter
    }

    await bot.sendChatAction(chatId, 'typing');

    const k = keyFor(chatId, userId);
    const prior = getHistory(k);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...prior,
      { role: 'user', content: text }
    ];

    const answer = await chatCompletion({ messages, temperature: 0.7, max_tokens: 700 });

    // Update history only on success
    pushMessage(k, 'user', text);
    pushMessage(k, 'assistant', answer);

    await bot.sendMessage(chatId, answer, {
      reply_to_message_id: msg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Error handling message:', err?.response?.data || err.message || err);
    await safeReply(bot, msg.chat.id, msg.message_id, 'Sorry, I ran into an error. Please try again in a moment.');
  }
});

async function safeReply(bot, chatId, replyToMessageId, text) {
  try {
    await bot.sendMessage(chatId, text, { reply_to_message_id: replyToMessageId });
  } catch (e) {
    // noop
  }
}

console.log('Bot is up. Listening for messages…');
