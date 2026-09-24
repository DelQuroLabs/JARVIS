// A ~60-line hash router. Hash routing means the app can be served from any
// static host (or opened from a file) with no rewrite rules.

import { useCallback, useEffect, useState } from 'react';

const current = (): string => {
  const h = globalThis.location?.hash ?? '';
  const p = h.replace(/^#/, '');
  return p.startsWith('/') ? p : `/${p}`;
};

export function navigate(path: string, replace = false): void {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (replace) globalThis.history.replaceState(null, '', target);
  else globalThis.location.hash = target;
  if (replace) globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): string {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const on = () => setPath(current());
    globalThis.addEventListener('hashchange', on);
    return () => globalThis.removeEventListener('hashchange', on);
  }, []);
  return path;
}

/** Scroll to the top on every route change, the way a native push does. */
export function useScrollReset(path: string, ref?: { current: HTMLElement | null }): void {
  useEffect(() => {
    (ref?.current ?? globalThis.document?.scrollingElement)?.scrollTo?.({ top: 0 });
  }, [path, ref]);
}

/** Match '/app/workflows/:id' against a pattern; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean);
  const cp = path.split('?')[0].split('/').filter(Boolean);
  if (pattern.endsWith('/*')) {
    if (cp.length < pp.length - 1) return null;
  } else if (pp.length !== cp.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '*') return params;
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(cp[i] ?? '');
    else if (pp[i] !== cp[i]) return null;
  }
  return params;
}

export function Link({ to, className, children, onClick }: { to: string; className?: string; children: React.ReactNode; onClick?: () => void }) {
  const go = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onClick?.();
      navigate(to);
    },
    [to, onClick],
  );
  return (
    <a href={`#${to}`} className={className} onClick={go}>
      {children}
    </a>
  );
}
