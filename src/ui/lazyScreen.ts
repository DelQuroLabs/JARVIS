/**
 * Lazy screen loading that survives a deploy.
 *
 * Vite gives every chunk a content hash. When a new build is published, the old
 * hashed filenames stop existing. A tab that is still running the previous build
 * will ask for a chunk that is gone the moment you navigate to a screen you had
 * not opened yet, and the dynamic import rejects:
 *
 *   Failed to fetch dynamically imported module: /assets/Agent-Mp0UpwBb.js
 *
 * That is not a crash, it is a stale tab. The cure is to reload once so the
 * browser fetches the current index.html and its current hashes.
 *
 * The reload is guarded by sessionStorage so a genuinely missing chunk -- a
 * broken build, a dead network -- cannot put the page in a reload loop. The
 * first failure reloads; a second failure for the same screen is surfaced as a
 * real error.
 */

import { lazy, type ComponentType } from 'react';

const FLAG = 'jarvis.chunkReload.';

/** True for the various ways browsers word a failed dynamic import. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk .* failed|error loading dynamically imported/i.test(
    msg,
  );
}

function safeSession(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Private mode in some browsers throws on access rather than returning null.
    return null;
  }
}

export function lazyScreen<P extends object>(
  name: string,
  load: () => Promise<{ default: ComponentType<P> }>,
) {
  const key = `${FLAG}${name}`;
  return lazy(() =>
    load()
      .then((m) => {
        // Only a SUCCESSFUL load spends the guard. Clearing it on app mount --
        // which is what the first version of this did -- resets the guard before
        // the failing screen is retried, and the page reloads forever.
        safeSession()?.removeItem(key);
        return m;
      })
      .catch((err: unknown) => {
        if (!isChunkLoadError(err)) throw err;
        const s = safeSession();
        if (s && !s.getItem(key)) {
          s.setItem(key, '1');
          globalThis.location.reload();
          // Never settles: the page is on its way out. Resolving or rejecting
          // here would flash an error during the reload.
          return new Promise<{ default: ComponentType<P> }>(() => {});
        }
        throw err;
      }),
  );
}
