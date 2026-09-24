/**
 * First-run contents of the project library.
 *
 * JARVIS itself is the first card: the library should demonstrate what a
 * complete record looks like, and the app can describe itself accurately.
 */

import type { Project } from './library.ts';

export function seedProjects(now: number = Date.now()): Project[] {
  return [
    {
      id: 'proj-jarvis',
      name: 'JARVIS',
      tagline: 'Home base for everything I run. Local-first agent workspace.',
      status: 'live',
      tags: ['react', 'vite', 'pwa', 'supabase', 'agent'],
      about: [
        'An installable PWA that acts as the operations desk for every other project.',
        '',
        'It runs entirely in the browser: conversations, memory, workflows, skills, routines',
        'and this library all live in local storage. A model key is optional -- without one it',
        'falls back to an offline reflex core and says so rather than pretending to reason.',
        '',
        '**The rule the whole build follows:** never claim a capability it does not have.',
        'Impossible requests are recognised and refused with the reason, not silently dropped.',
      ].join('\n'),
      spec: [
        '## Stack',
        '- React 18 + Vite, TypeScript strict',
        '- Zero runtime dependencies beyond React; hash router written in-house',
        '- `src/core/` is React-free so the whole domain layer unit-tests in plain Node',
        '',
        '## Architecture',
        '- One `AppProvider` in `src/ui/state.tsx`; all persistence through `src/core/store.ts`',
        '- The agent loop enforces per-mode step and tool budgets; nothing is advisory',
        '- Providers are a ranked fallback chain ending at the offline reflex core',
        '- Tools carry an effect class; B and C tools are approval-gated with visible arguments',
        '',
        '## Hard-won gotchas',
        '- `tools.ts` must never import `store.ts` -- that circular import blanks the app',
        '- Duplicate `@keyframes` names silently override each other across the stylesheet',
        '- A stacking context on the dashboard traps bottom sheets under the tab bar',
        '- `\\uXXXX` escapes render literally in JSX text and in JSX attribute strings',
        '- Any throw at module scope in `main.tsx` blanks the entire app',
        '',
        '## Verification',
        'Typecheck, unit, e2e, iframe boot, honesty gate, contrast, functional and a',
        'click-everything audit. Every gate must be green before a change is called done.',
      ].join('\n'),
      links: [],
      attachments: [],
      colour: '#35e0c0',
      pinned: true,
      created: now,
      updated: now,
    },
    {
      id: 'proj-example',
      name: 'Example project',
      tagline: 'A template card. Edit or delete it.',
      status: 'idea',
      tags: ['template'],
      about: 'Replace this with what the project actually is, who it is for, and its current state.',
      spec: [
        '## Stack',
        '',
        '## Architecture',
        '',
        '## Decisions',
        '',
        '## Gotchas',
        '',
        'Aim for enough detail that a fresh agent session could rebuild it from this text alone.',
      ].join('\n'),
      links: [{ label: 'Live site', url: 'https://example.com' }],
      attachments: [],
      colour: '',
      pinned: false,
      created: now,
      updated: now,
    },
  ];
}
