/**
 * Per-screen explainers.
 *
 * Every section of the app answers three questions in the same shape: what it
 * is, when you would reach for it, and what it will not do. Keeping the copy in
 * one registry rather than scattered through the screens means a new screen
 * without an explainer is obvious, and the honesty rules are enforced in one
 * place: the `limit` line is required, because every feature here has an edge.
 */

export interface Explainer {
  /** What this screen is, in one sentence. */
  what: string;
  /** When you would actually use it. */
  when: string;
  /** The honest edge. Never omitted. */
  limit: string;
  /** One concrete next action to try */
  next?: { label: string; path: string };
  /** Related screens */
  related?: { label: string; path: string }[];
}

export const EXPLAINERS: Record<string, Explainer> = {
  '/app': {
    next: { label: 'Start a chat', path: '/app/chat' },
    related: [{ label: 'Chat', path: '/app/chat' }, { label: 'Agent', path: '/app/agent' }, { label: 'Memory', path: '/app/memory' }],
    what: 'The front door. Type one line and it goes to the right place with no model call: "brief me" reads your day, "open memory" jumps there, "add expense 12 coffee" goes to the assistant, and anything else opens chat in the best-fit mode. Every destination is also a button below.',
    when: 'It is the first screen on open. Start typing, or tap a chip. Tap Rearrange to drag tiles into the order you actually use, or hide the ones you do not.',
    limit: 'Counts cover the last 24 hours of activity on this device only. Nothing is synced unless you connect your own server.',
  },
  '/app/chat': {
    next: { label: 'Check what was remembered', path: '/app/memory' },
    related: [{ label: 'Agent console', path: '/app/agent' }, { label: 'Memory', path: '/app/memory' }, { label: 'Modes', path: '/app/modes' }],
    what: 'A conversation with the agent. It can call tools mid-answer, and every call is shown with its arguments and result. Paste, drop or attach an image, take a photo, or on desktop grab one frame of a window so it can look at what you see; images ride along for that turn only and are dropped from storage afterwards.',
    when: 'Anything conversational, or when you want a tool run but do not want to find it by hand. Slash commands run instantly with no model.',
    limit: 'Without a model key it falls back to the offline reflex core, which handles arithmetic, memory and canned answers and says so rather than pretending to reason. Images need a vision-capable provider (OpenAI, Gemini, Anthropic, OpenRouter); other providers get the text alone and the composer says so.',
  },
  '/app/agent': {
    what: 'The agent loop with its working shown: plan, tool calls, observations and the final answer, step by step.',
    when: 'A task with several steps where you want to watch what it actually did, not just read the conclusion.',
    limit: 'It stops when the mode budget runs out and tells you, rather than silently truncating. Budgets come from the Modes screen.',
  },
  '/app/library': {
    what: 'The catalogue of everything you run. Each card holds a tagline, status, links, an about section and a rebuild spec.',
    when: 'Whenever a project needs a home: where it lives, why it exists, and enough detail to reconstruct it from the card alone.',
    limit: 'Attachments live in browser storage against a visible size budget, so it suits screenshots and notes rather than large files.',
  },
  '/app/weather': {
    what: 'Three independent forecasts merged into one reading, plus radar, a precipitation timeline, government alerts and air quality.',
    when: 'When the answer matters enough that you want to see whether the forecasts actually agree.',
    limit: 'Radar history is the two hours the free feed publishes. The forecast strip is a point forecast for your location, not radar imagery.',
  },
  '/app/calendar': {
    what: 'Your calendar, imported from an .ics export. Events appear here, on the dashboard and in the spoken briefing.',
    when: 'Export from Google or Apple and drop the file in. Re-import whenever you want to refresh it.',
    limit: 'It is a snapshot, not a live subscription: Google and Apple serve their feeds without cross-origin headers, so a browser cannot fetch them at all.',
  },
  '/app/tools': {
    what: 'Every capability the agent can call, and that you can run by hand. Each states its effect class and whether it needs the network.',
    when: 'To run something directly, or to check what the agent is actually able to do before you ask for it.',
    limit: 'Tools marked as approval-gated stop and show you their exact arguments first. Network tools are blocked entirely under STRICT privacy.',
  },
  '/app/skills': {
    what: 'Saved chains of tool calls that run in a fixed order with no model involved.',
    when: 'A sequence you repeat. Give it a trigger and typing /trigger in chat runs it. Same input, same output, no tokens spent.',
    limit: 'A skill cannot make decisions. If the work needs judgement between steps, that is a workflow or an agent task.',
  },
  '/app/workflows': {
    what: 'Visual graphs of steps wired together, with branching and per-node status.',
    when: 'Multi-step work with structure: fetch, transform, branch, write. Cycles are detected before anything runs.',
    limit: 'Nodes that were never reached report as skipped rather than failed, because those are different outcomes.',
  },
  '/app/crew': {
    what: 'Several roles reviewing the same material in sequence, each seeing what the previous one said.',
    when: 'When one pass is not enough and you want a critique, a rebuttal and a synthesis rather than a single opinion.',
    limit: 'If a role fails or falls back to the offline core, the rest are marked skipped instead of pretending to have reviewed.',
  },
  '/app/routines': {
    what: 'Scheduled runs of a skill, workflow or prompt.',
    when: 'Recurring work: a morning briefing, a tidy-up, a check you would otherwise forget.',
    limit: 'A browser tab cannot wake itself. Routines only fire while this app is open, which is why the schedule says "while open".',
  },
  '/app/memory': {
    next: { label: 'Test recall in Chat', path: '/app/chat' },
    related: [{ label: 'Chat', path: '/app/chat' }, { label: 'Assistant', path: '/app/assistant' }, { label: 'Settings', path: '/app/settings' }],
    what: 'Everything JARVIS remembers about you: what you saved by hand, what it learned from chats (tagged learned), and, when signed in, what the Telegram assistant learned. Every reply sees the relevant part of this automatically.',
    when: 'Review, pin, correct or delete. Pinned items and preferences go into every prompt; the rest is recalled by relevance to what you ask.',
    limit: 'Recall is capped at about 1,800 characters per turn so it never crowds out your question. Private mode neither recalls nor learns.',
  },
  '/app/ideas': {
    what: 'A scratchpad for prompts and patterns that worked, so they are not rewritten from scratch later.',
    when: 'Whenever something works well enough to be worth keeping.',
    limit: 'Ideas are notes, not automations. Turn one into a skill or a workflow to make it run.',
  },
  '/app/traces': {
    what: 'A log of every run: what was asked, which provider answered, how long it took and what it cost.',
    when: 'Working out why something was slow, which provider is actually being used, or what happened earlier.',
    limit: 'Costs are estimates from published token prices, not billed amounts. Treat them as a rough guide.',
  },
  '/app/modes': {
    what: 'The postures the agent can take. A mode sets its instructions, its creativity, how many steps it may take and how many tool calls it may spend.',
    when: 'Change it when the shape of the work changes: a quick answer, a long build, a private question that must not touch the network.',
    limit: 'Budgets are enforced, not advisory. When one runs out the loop stops and says so.',
  },
  '/app/providers': {
    what: 'The model providers and the fallback chain. Add a key, test it, and order which ones are tried.',
    when: 'Setting up a model, or when one provider is down and you want another tried first.',
    limit: 'Keys are stored in this browser. They are sent only to that provider and are redacted from anything else the app transmits.',
  },
  '/app/cloud': {
    what: 'Optional sync to your own JARVIS server, authenticated with your GitHub account.',
    when: 'When you want the same data on more than one device. Everything works without it.',
    limit: 'Sync runs only while this tab is open. Your data is protected by your GitHub account.',
  },
  '/app/assistant': {
    next: { label: 'Review server memory', path: '/app/memory' },
    related: [{ label: 'Memory', path: '/app/memory' }, { label: 'Cloud sync', path: '/app/cloud' }, { label: 'Chat', path: '/app/chat' }],
    what: 'The executive-assistant layer: talk to JARVIS from Telegram, and manage expenses, contacts, email sending and its personality.',
    when: 'When you want JARVIS reachable from your phone without opening the app, or to log spending and people on the go.',
    limit: 'Needs your sync server signed in. The Telegram brain runs on the server with its own model key; the in-app chat still runs in this browser.',
  },
  '/app/diagnostics': {
    what: 'Live checks against the build you are actually running: registries, storage, sandboxing and real tool execution.',
    when: 'When something feels wrong, or after changing settings, to confirm the app is behaving.',
    limit: 'A check that cannot execute reports blocked with the reason. It is never upgraded to a pass.',
  },
  '/app/settings': {
    what: 'Appearance, privacy level, units, weather location and your data.',
    when: 'Changing how the app looks or behaves, or exporting and erasing what it holds.',
    limit: 'Erasing removes everything on this device, then restores the built-in examples. Cloud copies are not touched.',
  },
  '/app/help': {
    what: 'A guided tour of the whole app, written against the live registries.',
    when: 'Learning what exists, or checking what the app deliberately refuses to do.',
    limit: 'Every number on it is counted at render time, so it stays true as features change.',
  },
  '/app/build': {
    next: { label: 'Create a Skill', path: '/app/skills' },
    related: [{ label: 'Workflows', path: '/app/workflows' }, { label: 'Skills', path: '/app/skills' }, { label: 'Tools', path: '/app/tools' }],
    what: 'The automation hub: skills, workflows, routines, crew and tools in one place.',
    when: 'When you want to build something that runs repeatedly rather than ask a one-off question.',
    limit: 'These are the pieces. The dashboard is where you launch them day to day.',
  },
  '/app/more': {
    what: 'Everything that is not chat or automation: knowledge, system settings and diagnostics.',
    when: 'Configuration, review and the occasional deep dive.',
    limit: 'Nothing here changes the agent behaviour except Modes, Providers and Settings.',
    next: { label: 'Open Memory', path: '/app/memory' },
    related: [{ label: 'Settings', path: '/app/settings' }, { label: 'Assistant', path: '/app/assistant' }],
  },
  '/app/not-found': {
    what: 'The page you tried to open does not exist in this build.',
    when: 'You followed an old link, typed a wrong path, or a feature moved.',
    limit: 'It will not silently send you to the dashboard anymore — you get a search action instead.',
    next: { label: 'Go to Overview', path: '/app' },
    related: [{ label: 'Help', path: '/app/help' }, { label: 'Chat', path: '/app/chat' }],
  },
};

export const explainerFor = (route: string): Explainer | undefined => EXPLAINERS[route.replace(/\/$/, '')];
