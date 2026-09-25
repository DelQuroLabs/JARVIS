// Single sign-on for sibling apps ("JARVIS as the front door").
//
// Model: the JARVIS session JWT is also set as an HttpOnly cookie on the
// parent domain (SSO_COOKIE_DOMAIN, e.g. ".delquro.com"). Any app on a
// subdomain can then ask JARVIS `GET /api/auth/verify` - either directly
// with credentials, or via the reverse proxy (Traefik ForwardAuth, which is
// what Coolify runs). A 200 means "signed in and on the allow list"; a 401
// tells the proxy/app to send the browser to JARVIS to sign in, and JARVIS
// returns it to `return_to` afterwards - as long as that URL is on the
// trusted domain. Pure helpers live here so they can be unit-tested.

export const SSO_COOKIE = 'jarvis_sso';

/** ".delquro.com" style parent domain, or "" when SSO is off. */
export function ssoCookieDomain(env: NodeJS.ProcessEnv = process.env): string {
  const d = (env.SSO_COOKIE_DOMAIN || '').trim().toLowerCase();
  if (!d) return '';
  return d.startsWith('.') ? d : `.${d}`;
}

/** Hostname check: exact parent domain or any subdomain of it. */
export function hostOnDomain(host: string, domain: string): boolean {
  if (!domain) return false;
  const h = host.toLowerCase().split(':')[0];
  return h === domain.slice(1) || h.endsWith(domain);
}

/**
 * Where may we send the browser after sign-in? Only absolute http(s) URLs on
 * the SSO domain (or the app itself). Anything else collapses to "" so the
 * caller falls back to APP_URL - never an open redirect.
 */
export function safeReturnTo(raw: string | undefined, appUrl: string, domain: string): string {
  if (!raw) return '';
  let u: URL;
  try { u = new URL(raw); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  let app: URL | null = null;
  try { app = new URL(appUrl); } catch { /* ignore */ }
  if (app && u.host === app.host) return u.toString();
  return hostOnDomain(u.host, domain) ? u.toString() : '';
}

/** Is this Origin header allowed to call /api/auth/verify with credentials? */
export function isTrustedOrigin(origin: string | undefined, appUrl: string, domain: string): boolean {
  if (!origin) return false;
  return safeReturnTo(origin, appUrl, domain) !== '';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

export function ssoSetCookie(token: string, domain: string, secure: boolean, maxAgeSec = 90 * 24 * 3600): string {
  return `${SSO_COOKIE}=${token}; Path=/; Domain=${domain}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function ssoClearCookie(domain: string, secure: boolean): string {
  return `${SSO_COOKIE}=; Path=/; Domain=${domain}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/**
 * Reconstruct the URL the proxy was asked for (Traefik ForwardAuth sends
 * X-Forwarded-Proto/Host/Uri) so an unauthenticated visitor can be returned
 * to exactly where they were going.
 */
export function forwardedUrl(h: (name: string) => string | undefined): string {
  const proto = h('x-forwarded-proto');
  const host = h('x-forwarded-host');
  if (!proto || !host) return '';
  return `${proto}://${host}${h('x-forwarded-uri') || '/'}`;
}
