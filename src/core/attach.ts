/**
 * "Look at this": on-demand context for one turn.
 *
 * The user attaches an image (paste, file, camera, or one frame of a shared
 * screen). It is downscaled on-device, sent with that single turn to a
 * vision-capable provider, and then dropped from the stored conversation --
 * only a small marker survives, so nothing pixel-shaped sits in localStorage.
 * This mirrors the on-demand capture pattern: one look, used once, discarded.
 */

import type { Conversation, Msg } from './types.ts';

export const ATTACH_LIMIT = 4;
export const ATTACH_MAX_EDGE = 1280;
export const ATTACH_QUALITY = 0.82;

/** Provider ids whose default chat endpoints accept inline images from the browser. */
export const VISION_PROVIDERS = new Set(['openai', 'gemini', 'anthropic', 'openrouter', 'xai', 'mistral', 'ollama', 'lmstudio', 'custom']);
export const canSee = (providerId: string): boolean => VISION_PROVIDERS.has(providerId);

export interface DataUrlParts { mime: string; data: string }

/** Split a data: URL into mime + base64 payload. Returns null for anything else. */
export function splitDataUrl(url: string): DataUrlParts | null {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  return m ? { mime: m[1], data: m[2] } : null;
}

/** Rough byte size of a base64 data URL, for the size pill in the composer. */
export function dataUrlBytes(url: string): number {
  const p = splitDataUrl(url);
  if (!p) return 0;
  const pad = p.data.endsWith('==') ? 2 : p.data.endsWith('=') ? 1 : 0;
  return Math.floor((p.data.length * 3) / 4) - pad;
}

/** Marker kept in place of the pixels once the turn is over. */
export interface AttachMarker { kind: 'image'; bytes: number }

/** Strip image payloads before persistence, keeping a count so the transcript stays honest. */
export function stripImages(m: Msg): Msg {
  if (!m.images?.length) return m;
  const { images, ...rest } = m;
  return { ...rest, attached: images.map((u) => ({ kind: 'image', bytes: dataUrlBytes(u) })) };
}

export function stripConversationImages(c: Conversation): Conversation {
  return c.messages.some((m) => m.images?.length) ? { ...c, messages: c.messages.map(stripImages) } : c;
}

/** Pull image files out of a paste or drop. Ignores everything else. */
export function imageFilesFrom(items: DataTransferItemList | FileList | null | undefined): File[] {
  if (!items) return [];
  const out: File[] = [];
  const list = Array.from(items as ArrayLike<DataTransferItem | File>);
  for (const it of list) {
    const f = it instanceof File ? it : it.kind === 'file' ? it.getAsFile() : null;
    if (f && f.type.startsWith('image/')) out.push(f);
  }
  return out;
}

/**
 * Downscale an image blob to a JPEG data URL. Browser only; falls back to the
 * original bytes when canvas is unavailable (very old engines) so the attach
 * still works, just larger.
 */
export async function downscaleImage(blob: Blob, maxEdge = ATTACH_MAX_EDGE, quality = ATTACH_QUALITY): Promise<string> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return blobToDataUrl(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blobToDataUrl(blob);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/** Is one-frame screen capture available here? Desktop browsers only; never on iOS. */
export function canCaptureScreen(): boolean {
  const md = (globalThis.navigator as Navigator | undefined)?.mediaDevices as MediaDevices | undefined;
  return typeof md?.getDisplayMedia === 'function';
}

/**
 * Ask the browser for a window/tab/screen, grab exactly one frame, stop the
 * stream immediately. Nothing is recorded and no track outlives the call.
 */
export async function captureScreenFrame(): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
  try {
    const track = stream.getVideoTracks()[0];
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 120)); // let the first real frame land
    const canvas = document.createElement('canvas');
    const settings = track.getSettings();
    canvas.width = video.videoWidth || settings.width || 1280;
    canvas.height = video.videoHeight || settings.height || 720;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('capture failed'))), 'image/png'));
    return downscaleImage(blob);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/* ------------------------------------------------------------------ */
/* Share target inbox (PWA)                                            */
/* ------------------------------------------------------------------ */

export const SHARE_CACHE = 'jarvis-share-inbox';
export interface SharePayload { title?: string; text?: string; url?: string; images: string[] }

/**
 * Drain anything the service worker stashed from a Web Share Target POST.
 * Returns null when there is nothing waiting. Always clears the inbox.
 */
export async function drainShareInbox(): Promise<SharePayload | null> {
  if (!('caches' in globalThis)) return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match('/share/meta.json');
    if (!metaRes) return null;
    const meta = (await metaRes.json()) as { title?: string; text?: string; url?: string; files?: number };
    const images: string[] = [];
    for (let i = 0; i < (meta.files ?? 0) && i < ATTACH_LIMIT; i++) {
      const r = await cache.match(`/share/file-${i}`);
      if (r) images.push(await downscaleImage(await r.blob()));
    }
    for (const k of await cache.keys()) await cache.delete(k);
    return { title: meta.title, text: meta.text, url: meta.url, images };
  } catch {
    return null;
  }
}

/** The prompt line for a shared payload: text, then url, then a nudge when only pixels arrived. */
export function sharePrompt(p: SharePayload): string {
  const parts = [p.title, p.text, p.url].filter((s): s is string => !!s && s.trim().length > 0);
  if (parts.length) return parts.join('\n');
  return p.images.length ? 'What is this?' : '';
}
