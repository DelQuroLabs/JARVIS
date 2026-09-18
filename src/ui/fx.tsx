import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

/* ==========================================================================
   Tactile feedback primitives.
   Everything here degrades to nothing when the user asks for reduced motion,
   and nothing here is required for a control to work.
   ========================================================================== */

function motionOff(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.getAttribute('data-motion') === 'reduce';
}

/**
 * A short haptic tick on press. Android fires this; iOS Safari ignores it
 * silently, which is fine - it is a bonus, never a signal the UI depends on.
 */
export function tap(pattern: number | number[] = 8): void {
  if (motionOff()) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* vibration is unavailable or blocked; ignore */
  }
}

export const haptic = {
  light: () => tap(6),
  medium: () => tap(12),
  success: () => tap([8, 40, 14]),
  warn: () => tap([14, 60, 14, 60, 14]),
};

/* -------------------------------------------------------------------------- */

/**
 * Counts a number up when it changes. Purely decorative: the final value is
 * rendered immediately when motion is reduced, so the number is never wrong.
 */
export function Rolling({ value, digits = 0, suffix = '' }: { value: number; digits?: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    if (motionOff() || value === from.current) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const b = value;
    const dur = 620;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      // easeOutExpo - fast start, gentle landing
      const e = k === 1 ? 1 : 1 - 2 ** (-10 * k);
      setShown(a + (b - a) * e);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else from.current = b;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  const text = digits > 0 ? shown.toFixed(digits) : Math.round(shown).toLocaleString();
  return (
    <span className="rolling">
      {text}
      {suffix}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The arc reactor. It is the app's one piece of pure character: a slow-spinning
 * ring that speeds up and brightens while the agent is actually working, so the
 * animation always means something rather than just decorating.
 */
export function Reactor({ size = 28, busy = false, level = 1 }: { size?: number; busy?: boolean; level?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <span className={`reactor${busy ? ' busy' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <linearGradient id="rx-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} className="rx-track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="rx-arc"
          stroke="url(#rx-g)"
          strokeDasharray={`${c * 0.26} ${c}`}
          strokeLinecap="round"
        />
        <circle cx="50" cy="50" r="26" className="rx-ring2" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <line
            key={a}
            x1="50"
            y1="26"
            x2="50"
            y2="34"
            className="rx-spoke"
            transform={`rotate(${a} 50 50)`}
            opacity={level > 0 ? 0.55 : 0.2}
          />
        ))}
        <circle cx="50" cy="50" r="13" className="rx-core" fill="url(#rx-g)" />
      </svg>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/** A progress ring. Used for budgets and quotas where a bar reads as clutter. */
export function Ring({
  value,
  size = 54,
  stroke = 6,
  label,
  tone = 'accent',
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  tone?: 'accent' | 'ok' | 'warn' | 'danger';
}) {
  const pct = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={`ring tone-${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="ring-arc"
        />
      </svg>
      {label !== undefined && <b className="ring-label">{label}</b>}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/** A dependency-free sparkline. Flat input renders a flat line, not a fake wave. */
export function Spark({ data, height = 34, tone = 'accent' }: { data: number[]; height?: number; tone?: string }) {
  const pts = data.length ? data : [0];
  const max = Math.max(...pts, 1);
  const w = 100;
  const step = pts.length > 1 ? w / (pts.length - 1) : w;
  const y = (v: number) => height - 3 - (v / max) * (height - 8);
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <svg className={`spark tone-${tone}`} viewBox={`0 0 ${w} ${height}`} height={height} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spk)" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A one-shot sparkle burst, fired on genuinely good news (a run finishing, a
 * key connecting). Deliberately rare - constant confetti is noise.
 */
export function useSparkle() {
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const n = useRef(0);

  const fire = useCallback((el: HTMLElement | null) => {
    if (motionOff() || !el) return;
    const r = el.getBoundingClientRect();
    const id = ++n.current;
    setBursts((b) => [...b, { id, x: r.left + r.width / 2, y: r.top + r.height / 2 }]);
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 900);
  }, []);

  const node = bursts.length ? (
    <div className="sparkles" aria-hidden="true">
      {bursts.map((b) => (
        <span key={b.id} className="sparkle-origin" style={{ left: b.x, top: b.y }}>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ '--a': `${i * 36}deg`, '--d': `${28 + (i % 3) * 12}px` } as CSSProperties} />
          ))}
        </span>
      ))}
    </div>
  ) : null;

  return { fire, node };
}

/* -------------------------------------------------------------------------- */

/** Adds a class for one animation cycle - used for the shake on a refusal. */
export function useFlash(ms = 460): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>();
  const go = useCallback(() => {
    if (motionOff()) return;
    setOn(true);
    clearTimeout(t.current);
    t.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  useEffect(() => () => clearTimeout(t.current), []);
  return [on, go];
}

/** True once the element has scrolled into view, for stagger-in lists. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(motionOff());
  useEffect(() => {
    if (seen || !ref.current || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '40px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return { ref, seen };
}
