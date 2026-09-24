// Telegram bot — long polling, so it works behind Coolify without a public
// webhook. Each chat is linked to a JARVIS user through a one-time code that
// the user generates in the app (Assistant → Telegram).

import { userForChat, redeemLinkCode, clearTgMessages, getSettings } from './db.js';
import { ask } from './assistant.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = `https://api.telegram.org/bot${TOKEN}`;

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
    voice?: { file_id: string };
  };
}

export let botInfo: { username: string } | null = null;

async function tg<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(json.description ?? `Telegram ${method} failed`);
  return json.result;
}

async function send(chatId: number, text: string): Promise<void> {
  // Telegram caps at 4096 chars per message
  for (let i = 0; i < text.length; i += 4000) {
    await tg('sendMessage', { chat_id: chatId, text: text.slice(i, i + 4000) });
  }
}

async function typing(chatId: number): Promise<void> {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

async function handle(u: TgUpdate): Promise<void> {
  const m = u.message;
  if (!m || m.chat.type !== 'private') return;
  const chatId = m.chat.id;
  const username = m.from?.username ?? null;

  if (m.voice) {
    await send(chatId, 'Voice notes are not enabled on this server yet — text only for now.');
    return;
  }
  const text = (m.text ?? '').trim();
  if (!text) return;

  // ---- Commands that work before linking
  if (text.startsWith('/start') || text.startsWith('/link')) {
    const code = text.split(/\s+/)[1];
    if (code) {
      const user = redeemLinkCode(code, chatId, username);
      if (user) {
        await send(chatId, `Linked to ${user.name ?? user.login}. Good to have you, sir. Ask me anything — expenses, contacts, calendar, email, research.`);
      } else {
        await send(chatId, 'That code is invalid or expired. Generate a fresh one in JARVIS → Assistant → Telegram.');
      }
      return;
    }
    const existing = userForChat(chatId);
    if (existing) {
      await send(chatId, `Already linked to ${existing.login}. What can I do for you?`);
    } else {
      await send(chatId, 'Welcome. To link this chat to your JARVIS account, open the app → Assistant → Telegram, copy the code, and send:\n\n/link YOURCODE');
    }
    return;
  }

  const user = userForChat(chatId);
  if (!user) {
    await send(chatId, 'This chat is not linked yet. Open JARVIS → Assistant → Telegram to get a link code, then send /link CODE.');
    return;
  }

  if (text === '/help') {
    await send(chatId, [
      'What I handle:',
      '• Expenses — "log $42 lunch with client", "how much did I spend on software this month?"',
      '• Contacts — "add Sarah Chen, CTO at Acme, sarah@acme.com", "find Sarah\'s number"',
      '• Calendar — "schedule a call with Tom Friday 3pm for 45 min", "what\'s on this week?"',
      '• Email — "email tom@acme.com about the delayed invoice"',
      '• Memory — "remember I prefer morning meetings", "what do you know about Acme?"',
      '• Research — "quick brief on competitor X", "summarise this URL"',
      '• Math — "18% of 2,450", "convert 300 EUR to USD"',
      '',
      '/reset clears our recent conversation. /whoami shows the linked account.',
    ].join('\n'));
    return;
  }
  if (text === '/reset') { clearTgMessages(user.id); await send(chatId, 'Context cleared.'); return; }
  if (text === '/whoami') {
    const s = getSettings(user.id);
    await send(chatId, `Linked to @${user.login}. Persona: ${s.persona}, currency: ${s.currency}, email: ${s.smtp?.host ? 'configured' : 'not set'}.`);
    return;
  }

  await typing(chatId);
  const keepTyping = setInterval(() => void typing(chatId), 4500);
  try {
    const reply = await ask(user.id, text, 'telegram');
    await send(chatId, reply.text);
  } catch (e) {
    await send(chatId, `Something went wrong: ${(e as Error).message}`);
  } finally {
    clearInterval(keepTyping);
  }
}

export async function startTelegram(): Promise<void> {
  if (!TOKEN) { console.log('Telegram: TELEGRAM_BOT_TOKEN not set, bot disabled'); return; }
  try {
    botInfo = await tg<{ username: string }>('getMe', {});
    await tg('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
    await tg('setMyCommands', { commands: [
      { command: 'help', description: 'What Jarvis can do' },
      { command: 'link', description: 'Link this chat: /link CODE' },
      { command: 'reset', description: 'Clear recent context' },
      { command: 'whoami', description: 'Show linked account' },
    ] }).catch(() => {});
    console.log(`Telegram: polling as @${botInfo.username}`);
  } catch (e) {
    console.error('Telegram: failed to start —', (e as Error).message);
    return;
  }

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const updates = await tg<TgUpdate[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        void handle(u).catch((e) => console.error('Telegram handler error:', e));
      }
    } catch (e) {
      console.error('Telegram poll error:', (e as Error).message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
