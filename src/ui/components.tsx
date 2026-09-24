// Shared presentational primitives. Everything here is inert unless wired up -
// no decorative control that does nothing (POL-NOFAKE-010).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copyText } from './clipboard.ts';
import { Icon, type IconName } from './icons.tsx';
import { haptic } from './fx.tsx';

/* ---------------- buttons ---------------- */

export function Btn({
  children, onClick, variant = 'default', size = 'md', icon, iconRight, disabled, type = 'button', title, block, className = '', badge,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'quiet';
  size?: 'md' | 'sm' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  block?: boolean;
  className?: string;
  badge?: ReactNode;
}) {
  const cls = [
    'btn',
    variant !== 'default' ? variant : '',
    size !== 'md' ? size : '',
    block ? 'block' : '',
    !children ? 'icon' : '',
    className,
  ].filter(Boolean).join(' ');

  const px = size === 'sm' ? 15 : size === 'lg' ? 19 : 17;
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled}
      title={title}
      aria-label={!children ? title : undefined}
      // Haptics fire on pointerdown, not click, so the tick lands with the
      // press rather than after it.
      onPointerDown={() => {
        if (!disabled) (variant === 'primary' || variant === 'danger' ? haptic.medium : haptic.light)();
      }}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={px} />}
      {children}
      {badge}
      {iconRight && <Icon name={iconRight} size={px} />}
    </button>
  );
}

export function IconBtn({ name, onClick, title, active, size = 20, className = '' }: {
  name: IconName; onClick?: () => void; title: string; active?: boolean; size?: number; className?: string;
}) {
  return (
    <button
      type="button"
      className={`iconbtn${active ? ' on' : ''} ${className}`.trim()}
      onPointerDown={() => haptic.light()}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      <Icon name={name} size={size} />
    </button>
  );
}

/**
 * A big pressable tile. This is the app's default way to offer a choice -
 * a real button with an icon, not a text link.
 */
export function TapCard({ icon, tone = 'accent', title, sub, onClick, on, right, className = '', big }: {
  icon: IconName;
  tone?: 'accent' | 'violet' | 'amber' | 'rose' | 'ok' | 'sky';
  title: string;
  sub?: string;
  onClick?: () => void;
  on?: boolean;
  right?: ReactNode;
  className?: string;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tap-card${on ? ' on' : ''} ${className}`.trim()}
      onPointerDown={() => haptic.light()}
      onClick={onClick}
      aria-pressed={on}
    >
      <div className="row" style={{ gap: 11, alignItems: 'center' }}>
        <span className={`tile-ic ${tone === 'accent' ? '' : tone}${big ? ' lg' : ''}`.trim()}>
          <Icon name={icon} size={big ? 22 : 19} />
        </span>
        <span className="grow">
          <span className="t">{title}</span>
          {sub && <span className="s">{sub}</span>}
        </span>
        {right}
      </div>
    </button>
  );
}

/**
 * Opens an external URL as a *button*, and copes with the case that made this
 * necessary: inside a sandboxed preview iframe `window.open` is blocked and a
 * `target="_blank"` link does nothing at all, silently. When the open is
 * refused we say so and hand over a copyable URL instead of failing quietly.
 */
export function OpenLink({ url, children, icon = 'link', variant = 'default', size = 'md', block, onNote }: {
  url: string;
  children: ReactNode;
  icon?: IconName;
  variant?: 'default' | 'primary' | 'ghost' | 'quiet';
  size?: 'md' | 'sm' | 'lg';
  block?: boolean;
  onNote?: (msg: string, tone: 'info' | 'ok' | 'err') => void;
}) {
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);

  const open = () => {
    let win: Window | null = null;
    try {
      win = globalThis.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      win = null;
    }
    if (win) {
      onNote?.('Opened in a new tab.', 'ok');
      return;
    }
    // Blocked by the sandbox or a popup blocker. Copy it so the click still
    // accomplishes something.
    setBlocked(true);
    void copyText(url).then((r) => {
      if (r === 'failed') {
        onNote?.('This preview cannot open new tabs, and the copy was blocked. The address is shown below.', 'info');
        return;
      }
      setCopied(true);
      onNote?.('This preview cannot open new tabs. Link copied instead.', 'info');
    });
  };

  return (
    <>
      <Btn icon={icon} variant={variant} size={size} block={block} onClick={open}>
        {children}
      </Btn>
      {blocked && (
        <div className="callout" style={{ marginTop: 9 }}>
          <p style={{ fontSize: '0.79rem', margin: 0, lineHeight: 1.5 }}>
            This preview runs in a sandboxed frame, so it is not allowed to open new tabs.{' '}
            {copied ? 'The address is on your clipboard.' : 'Select the address below to copy it.'}
          </p>
          <code className="urlbox">{url}</code>
          <Btn
            size="sm"
            icon={copied ? 'check' : 'copy'}
            onClick={() => {
              void copyText(url).then((r) => setCopied(r !== 'failed'));
            }}
          >
            {copied ? 'Copied' : 'Copy address'}
          </Btn>
        </div>
      )}
    </>
  );
}

/* ---------------- surfaces ---------------- */

export function Card({ children, title, icon, action, tight, className = '' }: {
  children: ReactNode; title?: string; icon?: IconName; action?: ReactNode; tight?: boolean; className?: string;
}) {
  return (
    <section className={`card${tight ? ' tight' : ''} ${className}`}>
      {(title || action) && (
        <header className="card-h">
          {icon && <Icon name={icon} size={17} />}
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="section-title">{children}</div>;
}

export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico">
        <Icon name={icon} size={24} />
      </div>
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Pill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'ok' | 'warn' | 'bad' | 'info' | 'accent' }) {
  return <span className={`pill${tone === 'default' ? '' : ` ${tone}`}`}>{children}</span>;
}

export function Stat({ value, label, detail }: { value: ReactNode; label: string; detail?: string }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
      {detail && <div className="d">{detail}</div>}
    </div>
  );
}

export function Bars({ data, max }: { data: number[]; max?: number }) {
  const hi = max ?? Math.max(1, ...data);
  return (
    <div className="bars" role="img" aria-label={`Bar chart, ${data.length} buckets, peak ${hi}`}>
      {data.map((v, i) => (
        <i key={i} className={v === 0 ? 'z' : ''} style={{ height: `${Math.max(3, (v / hi) * 100)}%` }} />
      ))}
    </div>
  );
}

export function Meter({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------------- form ---------------- */

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ''}`} />;
}

export function Select({ value, onChange, options, id }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; id?: string }) {
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="switchrow">
      <div className="t">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
    </div>
  );
}

export function Chips({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="chiprow" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={`chip${value === o.value ? ' on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- sheet ---------------- */

export function Sheet({ open, onClose, title, sub, children }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose is almost always an inline arrow, so its identity changes on every
  // parent render. Depending on it here re-ran this effect on every keystroke
  // and the focus() call yanked the caret out of whatever field you were
  // typing in -- one character per click. Keep it in a ref and depend on `open`
  // alone, so focus moves exactly once, when the sheet opens.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    globalThis.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      globalThis.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  // Portalled to <body>. A sheet rendered inside an ancestor with a transform,
  // filter or backdrop-filter would have that ancestor as the containing block
  // for its position:fixed scrim -- which is exactly what happened to the
  // quick-action sheet inside the blurred tab bar: its scrim collapsed to the
  // tab bar's 63px box and dimmed nothing.
  // Target #root rather than <body>: it escapes the blurred tab bar just the
  // same, but keeps every sheet inside the application tree, where anything
  // scoped to #root (screenshots, text scrapes, the audit) can still see it.
  const host = document.getElementById('root') ?? document.body;
  return createPortal(
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 4 }}>
          <h2>{title}</h2>
          <IconBtn name="close" title="Close" onClick={onClose} />
        </div>
        {sub && <div className="sheet-sub">{sub}</div>}
        {children}
      </div>
    </div>,
    host,
  );
}

export function useConfirm(): [ReactNode, (opts: { title: string; body: string; danger?: boolean; onYes: () => void }) => void] {
  const [state, setState] = useState<{ title: string; body: string; danger?: boolean; onYes: () => void } | null>(null);
  const node = (
    <Sheet open={!!state} onClose={() => setState(null)} title={state?.title ?? ''}>
      <p className="muted" style={{ marginBottom: 18 }}>{state?.body}</p>
      <div className="row" style={{ gap: 8 }}>
        <Btn block onClick={() => setState(null)}>Cancel</Btn>
        <Btn
          block
          variant={state?.danger ? 'danger' : 'primary'}
          onClick={() => {
            state?.onYes();
            setState(null);
          }}
        >
          Confirm
        </Btn>
      </div>
    </Sheet>
  );
  return [node, setState];
}

/* ---------------- markdown ---------------- */

/**
 * Minimal, XSS-safe markdown. Never uses dangerouslySetInnerHTML - every node is
 * a real React element, so untrusted model output cannot inject markup.
 *
 * The inline regex guards are load-bearing: `\*\*[^*]+\*\*` breaks on content that
 * contains an asterisk (e.g. "**847 * 23**"), and widening to `.+?` then swallows
 * bare multiplication signs. The \S lookarounds are the fix. Do not simplify.
 */
const INLINE = /(`[^`]+`)|(\*\*(?=\S)[\s\S]+?(?<=\S)\*\*)|(\*(?=\S)[^*\n]+?(?<=\S)\*)|(\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE.source, 'g');
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('`')) out.push(<code key={key} className="inline">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('*')) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    else {
      const mm = tok.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
      const href = mm?.[2] ?? '';
      out.push(
        /^https?:\/\//.test(href)
          ? <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">{mm?.[1]}</a>
          : <span key={key}>{mm?.[1]}</span>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) buf.push(lines[i++]);
      i++;
      blocks.push(<code key={k++} className="md-code">{buf.join('\n')}</code>);
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={k++} style={{ margin: '6px 0 10px', paddingLeft: 20 }}>
          {items.map((it, n) => (
            <li key={n} style={{ marginBottom: 3 }}>{inline(it, `${k}-${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const Tag = (['h2', 'h3', 'h4', 'h4'] as const)[h[1].length - 1];
      blocks.push(<Tag key={k++} style={{ margin: '12px 0 6px' }}>{inline(h[2], `h${k}`)}</Tag>);
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]) && !lines[i].trimStart().startsWith('```') && !/^#{1,4}\s/.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={k++}>{inline(para.join(' '), `p${k}`)}</p>);
  }
  return <>{blocks}</>;
}

/* ---------------- misc ---------------- */

export function CopyBtn({ text, title = 'Copy' }: { text: string; title?: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconBtn
      name={done ? 'check' : 'copy'}
      title={done ? 'Copied' : title}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          },
          () => setDone(false),
        );
      }}
    />
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Working" role="status" />;
}

export function Dots() {
  return (
    <span className="dots" aria-label="Thinking" role="status">
      <i /><i /><i />
    </span>
  );
}

/**
 * The line the user typed on the dashboard launcher, carried onto a screen
 * that shows the answer visually (weather, calendar). It is consumed on mount
 * so it never leaks into the chat composer later, and offers a one-tap way to
 * ask the same thing in chat instead.
 */
export function AskedStrip({ pending, consume, onAsk }: { pending: string; consume: () => void; onAsk: (q: string) => void }) {
  const [asked, setAsked] = useState('');
  useEffect(() => {
    if (!pending) return;
    setAsked(pending);
    consume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  if (!asked) return null;
  return (
    <div className="row" style={{ gap: 10, alignItems: 'center', padding: '9px 12px', marginBottom: 12, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--panel)' }}>
      <Icon name="spark" size={15} />
      <span className="grow" style={{ fontSize: '0.84rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span className="dim">You asked:</span> {asked}
      </span>
      <button type="button" className="chip" onClick={() => onAsk(asked)}>Ask in chat</button>
      <button type="button" className="iconbtn" style={{ width: 28, height: 28 }} aria-label="Dismiss" onClick={() => setAsked('')}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
