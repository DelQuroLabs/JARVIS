import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { routeLaunch } from '../core/launch.ts';
import { navigate } from './router.tsx';
import { useApp } from './state.tsx';
import { haptic } from './fx.tsx';
import { ROUTES } from './Shell.tsx';
import { MODES } from '../core/modes.ts';
import { TOOLS } from '../core/tools.ts';
import { COMMANDS } from '../core/commands.ts';

interface Action {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  hint?: string;
  run: () => void;
}

/** Subsequence match, so "wfe" finds "Workflow editor". */
function fuzzy(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const n = q.toLowerCase();
  if (t.includes(n)) return 100 - t.indexOf(n);
  let i = 0;
  for (const ch of n) {
    i = t.indexOf(ch, i);
    if (i === -1) return 0;
    i++;
  }
  return 1;
}

/**
 * Command palette. Every screen, every mode and every tool is one keystroke
 * away. Opens with the toolbar button, Cmd/Ctrl+K, or a plain "/" pressed
 * outside a text field.
 */
export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const actions = useMemo<Action[]>(() => {
    const out: Action[] = [];

    for (const r of ROUTES) {
      out.push({
        id: `go:${r.path}`,
        label: r.title,
        group: 'Go to',
        icon: r.icon,
        hint: r.path,
        run: () => navigate(r.path),
      });
    }

    out.push({
      id: 'act:new',
      label: 'New conversation',
      group: 'Do',
      icon: 'plus',
      run: () => {
        app.newConversation();
        navigate('/app/chat');
      },
    });
    out.push({
      id: 'act:theme',
      label: `Switch to ${app.settings.theme === 'dark' ? 'light' : 'dark'} theme`,
      group: 'Do',
      icon: app.settings.theme === 'dark' ? 'sun' : 'moon',
      run: () => app.setSettings({ theme: app.settings.theme === 'dark' ? 'light' : 'dark' }),
    });
    out.push({
      id: 'act:motion',
      label: app.settings.reduceMotion ? 'Turn animation back on' : 'Reduce motion',
      group: 'Do',
      icon: 'activity',
      run: () => app.setSettings({ reduceMotion: !app.settings.reduceMotion }),
    });

    for (const m of MODES) {
      out.push({
        id: `mode:${m.id}`,
        label: `${m.name} mode`,
        group: 'Mode',
        icon: m.icon as IconName,
        hint: `${m.maxSteps} step${m.maxSteps === 1 ? '' : 's'} \u00b7 ${m.toolBudget} tool${m.toolBudget === 1 ? '' : 's'}`,
        run: () => {
          app.setSettings({ mode: m.id });
          if (app.activeId) app.setConversationMode(app.activeId, m.id);
          app.toast(`${m.name} mode`, 'ok');
        },
      });
    }

    for (const c of COMMANDS) {
      out.push({
        id: `cmd:${c.name}`,
        label: `/${c.name}`,
        group: 'Command',
        icon: 'terminal',
        hint: c.desc,
        run: () => {
          app.setPendingPrompt(`/${c.name} `);
          navigate('/app/chat');
        },
      });
    }

    for (const t of TOOLS) {
      out.push({
        id: `tool:${t.name}`,
        label: t.name,
        group: 'Tool',
        icon: 'tools',
        hint: t.desc,
        run: () => navigate('/app/tools'),
      });
    }

    return out;
  }, [app]);

  const hits = useMemo(() => {
    const scored = actions
      .map((a) => ({ a, s: Math.max(fuzzy(q, a.label), fuzzy(q, a.group) * 0.4) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s);
    const list = scored.slice(0, 40).map((x) => x.a);
    if (!q.trim()) return list;
    // Free text is never a dead end: the top row is always "ask this", routed
    // the same way as the dashboard launcher (brief / screen / mode-hinted chat).
    const r = routeLaunch(q);
    const ask: Action = r.kind === 'brief'
      ? { id: 'ask:brief', label: 'Brief me', group: 'Ask', icon: 'mic', hint: 'reads your day', run: () => { app.setPendingPrompt('brief me'); navigate('/app'); } }
      : r.kind === 'navigate'
        ? { id: 'ask:go', label: `Open ${r.label}`, group: 'Ask', icon: 'chevron', hint: r.prompt ? `"${q}"` : r.path, run: () => { if (r.prompt) app.setPendingPrompt(r.prompt); navigate(r.path); } }
        : { id: 'ask:chat', label: `Ask: ${q}`, group: 'Ask', icon: 'spark', hint: r.mode ? r.label : 'Chat', run: () => { if (r.mode && r.mode !== app.settings.mode) app.setSettings({ mode: r.mode }); app.setPendingPrompt(q); navigate('/app/chat'); } };
    const exact = list.some((a) => a.label.toLowerCase() === q.trim().toLowerCase());
    return exact ? [list[0], ask, ...list.slice(1)] : [ask, ...list];
  }, [actions, q, app]);

  useEffect(() => setSel(0), [q]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSel(0);
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const choose = (a: Action) => {
    haptic.medium();
    a.run();
    onClose();
  };

  return (
    <div
      className="palette-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette">
        <input
          ref={inputRef}
          value={q}
          placeholder="Ask anything, or jump to a screen, mode, tool or command…"
          aria-label="Search commands"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter' && hits[sel]) {
              e.preventDefault();
              choose(hits[sel]);
            }
          }}
        />
        <div className="palette-list" ref={listRef} role="listbox" aria-label="Results">
          {hits.length === 0 && (
            <div className="dim" style={{ padding: '20px 14px', textAlign: 'center', fontSize: '0.86rem' }}>
              Nothing matches &ldquo;{q}&rdquo;.
            </div>
          )}
          {hits.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className="palette-row"
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(a)}
            >
              <span className="tile-ic sm">
                <Icon name={a.icon} size={14} />
              </span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t" style={{ display: 'block' }}>
                  {a.label}
                </span>
                {a.hint && (
                  <span className="dim" style={{ display: 'block', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.hint}
                  </span>
                )}
              </span>
              <span className="g">{a.group}</span>
            </button>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <b className="kbd">&uarr;</b> <b className="kbd">&darr;</b> move
          </span>
          <span>
            <b className="kbd">&crarr;</b> open
          </span>
          <span>
            <b className="kbd">esc</b> close
          </span>
          <span className="grow" />
          <span>{hits.length} result{hits.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}

/** Global shortcut wiring: Cmd/Ctrl+K anywhere, or "/" outside a text field. */
export function usePaletteShortcut(setOpen: (v: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.key === '/')) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [setOpen]);
}
