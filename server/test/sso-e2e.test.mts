// SSO end to end: stub GitHub, run the real router, act as a browser + Traefik ForwardAuth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='production'; process.env.DB_PATH=':memory:'; process.env.JWT_SECRET='e2e-secret';
process.env.APP_URL='https://jarvis.delquro.com'; process.env.GITHUB_CLIENT_ID='x'; process.env.GITHUB_CLIENT_SECRET='y';
process.env.ALLOWED_GITHUB_LOGINS='delquro'; process.env.SSO_COOKIE_DOMAIN='delquro.com';
let who = 'delquro';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url);
  if (u.includes('github.com/login/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'gh' }), { headers: { 'content-type': 'application/json' } });
  if (u.includes('api.github.com/user')) return new Response(JSON.stringify({ id: 7, login: who, name: 'Del', avatar_url: null }), { headers: { 'content-type': 'application/json' } });
  return realFetch(url, init);
}) as any;
const { api } = await import('../src/routes.ts');
const { Hono } = await import('hono');
const app = new Hono(); app.route('/api', api);
const req = (path: string, headers: Record<string,string> = {}) => app.request('https://jarvis.delquro.com' + path, { headers, redirect: 'manual' });
const ok = (label: string, cond: boolean) => assert.ok(cond, label);

test('SSO: proxy bounce, sign-in, cookie, verify, CORS, open-redirect, refusal, logout', async () => {
// 1. Traefik asks on behalf of an anonymous visitor to notes.delquro.com
let r = await req('/api/auth/verify', { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'notes.delquro.com', 'x-forwarded-uri': '/doc/42' });
ok('anonymous via proxy -> 302 to sign-in', r.status === 302);
const loc = r.headers.get('location')!; ok('…with return_to', loc.includes('return_to=https%3A%2F%2Fnotes.delquro.com%2Fdoc%2F42'));

// 2. browser follows to /auth/github -> state cookie -> GitHub
r = await req(loc.replace('https://jarvis.delquro.com',''));
ok('start -> 302 GitHub', r.status === 302 && r.headers.get('location')!.startsWith('https://github.com/'));
const stateCookie = r.headers.get('set-cookie')!.split(';')[0];
const state = new URL(r.headers.get('location')!).searchParams.get('state')!;

// 3. GitHub returns; JARVIS should set the SSO cookie and send the browser straight back to notes
r = await req(`/api/auth/github/callback?code=c&state=${state}`, { cookie: stateCookie });
ok('callback -> 302 back to notes.delquro.com/doc/42', r.status === 302 && r.headers.get('location') === 'https://notes.delquro.com/doc/42');
const setc = r.headers.get('set-cookie') || '';
ok('SSO cookie on .delquro.com, HttpOnly+Secure', /jarvis_sso=.*Domain=\.delquro\.com.*HttpOnly.*Secure/.test(setc));
const sso = setc.split('\n').map(s=>s.split(';')[0]).find(s=>s.startsWith('jarvis_sso='))!;

// 4. Traefik asks again with the cookie -> 200 + X-Auth-User
r = await req('/api/auth/verify', { cookie: sso, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'notes.delquro.com', 'x-forwarded-uri': '/doc/42' });
ok('proxy with cookie -> 200 X-Auth-User=delquro', r.status === 200 && r.headers.get('x-auth-user') === 'delquro');

// 5. front-end fetch with credentials from trusted origin
r = await req('/api/auth/verify?mode=json', { cookie: sso, origin: 'https://notes.delquro.com' });
ok('CORS credentialed 200 for trusted origin', r.status === 200 && r.headers.get('access-control-allow-origin') === 'https://notes.delquro.com' && r.headers.get('access-control-allow-credentials') === 'true');
r = await req('/api/auth/verify?mode=json', { cookie: sso, origin: 'https://evil.com' });
ok('no CORS grant for evil origin', !r.headers.get('access-control-allow-origin'));

// 6. cookie also works for regular API
r = await req('/api/auth/me', { cookie: sso }); ok('cookie works for /auth/me', r.status === 200);

// 7. open-redirect attempt
r = await req('/api/auth/verify', { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.com', 'x-forwarded-uri': '/' });
const l2 = r.headers.get('location')!; r = await req(l2.replace('https://jarvis.delquro.com',''));
const st2 = new URL(r.headers.get('location')!).searchParams.get('state')!; const ck2 = r.headers.get('set-cookie')!.split(';')[0];
r = await req(`/api/auth/github/callback?code=c&state=${st2}`, { cookie: ck2 });
ok('evil return_to ignored -> lands on JARVIS', r.headers.get('location')!.startsWith('https://jarvis.delquro.com/#auth='));

// 8. someone not on the list
who = 'mallory';
r = await req('/api/auth/github?return_to=https%3A%2F%2Fnotes.delquro.com%2F'); const st3 = new URL(r.headers.get('location')!).searchParams.get('state')!; const ck3 = r.headers.get('set-cookie')!.split(';')[0];
r = await req(`/api/auth/github/callback?code=c&state=${st3}`, { cookie: ck3 });
ok('mallory refused, no cookie, message on wall', !(r.headers.get('set-cookie')||'').includes('jarvis_sso=') && r.headers.get('location')!.includes('#auth_error=') && r.headers.get('location')!.includes('private'));

// 9. logout clears everywhere
r = await req('/api/auth/logout?return_to=https%3A%2F%2Fnotes.delquro.com%2F', { cookie: sso });
ok('logout clears cookie + returns to notes', /jarvis_sso=;.*Max-Age=0/.test(r.headers.get('set-cookie')||'') && r.headers.get('location') === 'https://notes.delquro.com/');
r = await req('/api/auth/verify?mode=json', { cookie: 'jarvis_sso=garbage' }); ok('garbage cookie -> 401', r.status === 401);
});
