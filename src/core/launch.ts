/**
 * The launcher router: turns one typed line on the dashboard into the right
 * destination, with zero model calls. "Say the word, watch it happen."
 *
 * Order matters: exact app actions first (brief, open <screen>), then
 * screen-specific asks (weather, calendar, expenses), then mode hints for
 * chat, then plain chat in the current mode. Everything here is a heuristic
 * that saves taps; nothing is hidden behind it, every destination is still
 * reachable by hand.
 */

export type Launch =
  | { kind: 'brief' }
  | { kind: 'navigate'; path: string; label: string; prompt?: string }
  | { kind: 'chat'; prompt: string; mode?: string; label: string };

/** Screens that can be opened by name. Keep in sync with ROUTES in Shell. */
const SCREENS: Array<{ re: RegExp; path: string; label: string }> = [
  { re: /\b(settings?|preferences)\b/i, path: '/app/settings', label: 'Settings' },
  { re: /\b(keys?|providers?|api key|model key)\b/i, path: '/app/providers', label: 'Providers & keys' },
  { re: /\b(memory|memories|what (?:do )?you (?:know|remember) about me)\b/i, path: '/app/memory', label: 'Memory' },
  { re: /\b(skills?)\b/i, path: '/app/skills', label: 'Skills' },
  { re: /\b(workflows?|flows?)\b/i, path: '/app/workflows', label: 'Workflows' },
  { re: /\b(routines?|schedules?)\b/i, path: '/app/routines', label: 'Routines' },
  { re: /\b(crew|team|specialists?)\b/i, path: '/app/crew', label: 'Crew' },
  { re: /\b(tools?)\b/i, path: '/app/tools', label: 'Tools' },
  { re: /\b(ideas?|backlog)\b/i, path: '/app/ideas', label: 'Ideas' },
  { re: /\b(activity|traces?|history|log)\b/i, path: '/app/traces', label: 'Activity' },
  { re: /\b(modes?)\b/i, path: '/app/modes', label: 'Modes' },
  { re: /\b(cloud|sync)\b/i, path: '/app/cloud', label: 'Cloud sync' },
  { re: /\b(diagnostics?|checks?|health)\b/i, path: '/app/diagnostics', label: 'Diagnostics' },
  { re: /\b(help|guide|docs?)\b/i, path: '/app/help', label: 'Help' },
  { re: /\b(library|projects?|files?)\b/i, path: '/app/library', label: 'Library' },
  { re: /\b(assistant|telegram|email setup|smtp)\b/i, path: '/app/assistant', label: 'Assistant' },
  { re: /\b(agent console|console)\b/i, path: '/app/agent', label: 'Agent console' },
  { re: /\b(weather|forecast|radar)\b/i, path: '/app/weather', label: 'Weather' },
  { re: /\b(calendar|agenda|events?)\b/i, path: '/app/calendar', label: 'Calendar' },
  { re: /\b(chat|conversation)\b/i, path: '/app/chat', label: 'Chat' },
];

/** Modes suggested from the shape of the request. First match wins. */
const MODE_HINTS: Array<{ re: RegExp; mode: string; label: string }> = [
  { re: /\b(research|sources?|cite|citations?|find out|look up|latest news|what happened)\b/i, mode: 'research', label: 'Research mode' },
  { re: /\b(write|draft|rewrite|compose|blog|essay|caption|subject lines?|tone)\b/i, mode: 'writer', label: 'Writer mode' },
  { re: /\b(code|function|bug|regex|refactor|typescript|python|javascript|sql|stack ?trace|unit tests?)\b/i, mode: 'build', label: 'Build mode' },
  { re: /\b(analy[sz]e|analysis|numbers|statistics|csv|spreadsheet|average|median|percent(?:age)?|trend)\b/i, mode: 'analyst', label: 'Analyst mode' },
  { re: /\b(think (?:hard|deeply)|deep dive|thorough|plan (?:out|a) (?:the )?whole|architecture)\b/i, mode: 'deep', label: 'Deep work' },
  { re: /\b(quick(?:ly)?|tl;?dr|one[- ]liner|in a sentence|briefly)\b/i, mode: 'brief', label: 'Brief mode' },
];

const BRIEF = /^\s*(?:brief me|(?:morning|daily|evening) brief(?:ing)?|(?:what(?:'s| is) (?:my|the) (?:day|plan)(?: look(?:ing)? like)?)|catch me up|status report|how(?:'s| is) (?:my|the) day)\b/i;
const OPEN = /^\s*(?:open|go to|goto|show(?: me)?|take me to|launch)\s+(?:the\s+|my\s+)?(.+?)\s*[.!?]*$/i;
const WEATHER_ASK = /\b(weather|forecast|rain|umbrella|snow|temperature|how (?:hot|cold|warm)|what should i wear)\b/i;
const CALENDAR_ASK = /\b(what(?:'s| is) (?:next|on today|on my (?:calendar|schedule|agenda))|next (?:meeting|event)|my (?:schedule|agenda|calendar) (?:today|tomorrow|this week)|when is my next)\b/i;
const LEDGER_ASK = /\b(?:add|log|record|track)\s+(?:an?\s+)?expense\b|\b(?:i\s+)?(?:spent|paid)\s+\$?\d|\breceipt\b|\badd (?:a )?contact\b|\bhow much (?:have i|did i) spen[dt]\b|\bexpenses? (?:this|last) (?:week|month)\b/i;

/** Route one typed line. Never throws; empty input routes to chat with an empty prompt. */
export function routeLaunch(raw: string): Launch {
  const text = raw.trim();
  if (!text) return { kind: 'chat', prompt: '', label: 'Chat' };

  if (BRIEF.test(text)) return { kind: 'brief' };

  const open = text.match(OPEN);
  if (open) {
    const target = open[1];
    const hit = SCREENS.find((s) => s.re.test(target));
    if (hit) return { kind: 'navigate', path: hit.path, label: hit.label };
  }

  if (WEATHER_ASK.test(text)) return { kind: 'navigate', path: '/app/weather', label: 'Weather', prompt: text };
  if (CALENDAR_ASK.test(text)) return { kind: 'navigate', path: '/app/calendar', label: 'Calendar', prompt: text };
  // Expenses and contacts live on the server-side assistant (also reachable from Telegram).
  if (LEDGER_ASK.test(text)) return { kind: 'navigate', path: '/app/assistant', label: 'Assistant', prompt: text };

  // A bare screen name ("settings", "memory") opens it. Two words or fewer so
  // a real question containing the word "tools" still goes to chat.
  if (text.split(/\s+/).length <= 2) {
    const hit = SCREENS.find((s) => s.re.test(text));
    if (hit) return { kind: 'navigate', path: hit.path, label: hit.label };
  }

  const hint = MODE_HINTS.find((h) => h.re.test(text));
  if (hint) return { kind: 'chat', prompt: text, mode: hint.mode, label: hint.label };
  return { kind: 'chat', prompt: text, label: 'Chat' };
}

/** Chips shown under the launcher. Deterministic per day so they do not shuffle mid-session. */
export function launchChips(opts: { weatherOn: boolean; hasEvents: boolean; daySeed: number; sparks: readonly string[] }): string[] {
  const out: string[] = ['Brief me'];
  if (opts.hasEvents) out.push("What's next?");
  if (opts.weatherOn) out.push('What should I wear today?');
  out.push(opts.sparks[opts.daySeed % opts.sparks.length]);
  out.push('What do you know about me?');
  return out.slice(0, 5);
}
