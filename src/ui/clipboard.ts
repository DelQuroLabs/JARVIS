/**
 * Copying to the clipboard, honestly.
 *
 * `navigator.clipboard.writeText` exists in every modern browser and rejects
 * with NotAllowedError in plenty of ordinary situations: an iframe without
 * `clipboard-write` permission, a page that has not been interacted with, some
 * privacy configurations. The embedded preview this app runs in is exactly such
 * a context.
 *
 * The old code called `.writeText(...)` and reported success regardless, so
 * "Copied" appeared for a copy that never happened. This helper tries the
 * modern API, falls back to the legacy selection trick, and returns what
 * actually occurred so the caller can tell the truth.
 */

export type CopyResult = 'clipboard' | 'fallback' | 'failed';

export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch {
    /* fall through to the legacy path */
  }

  // execCommand('copy') is deprecated but still works where the async API is
  // blocked, because it rides on the user gesture rather than a permission.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // Off-screen but still selectable; display:none would not be.
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return 'fallback';
  } catch {
    /* nothing left to try */
  }
  return 'failed';
}

/** Wording that matches what actually happened. */
export function copyMessage(result: CopyResult, what: string): { text: string; tone: 'ok' | 'err' } {
  if (result === 'failed') {
    return { text: `This browser blocked the copy. ${what} is shown so you can select it by hand.`, tone: 'err' };
  }
  return { text: `${what} copied.`, tone: 'ok' };
}
