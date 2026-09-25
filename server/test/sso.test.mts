import { test } from 'node:test';
import assert from 'node:assert/strict';
const sso = await import('../src/sso.ts');

const APP = 'https://jarvis.delquro.com';
const DOM = '.delquro.com';

test('cookie domain normalises to a leading dot, empty means off', () => {
  assert.equal(sso.ssoCookieDomain({ SSO_COOKIE_DOMAIN: 'delquro.com' } as NodeJS.ProcessEnv), '.delquro.com');
  assert.equal(sso.ssoCookieDomain({ SSO_COOKIE_DOMAIN: '.delquro.com' } as NodeJS.ProcessEnv), '.delquro.com');
  assert.equal(sso.ssoCookieDomain({} as NodeJS.ProcessEnv), '');
});

test('return_to: only the app host or hosts on the SSO domain survive (no open redirect)', () => {
  assert.equal(sso.safeReturnTo('https://notes.delquro.com/x?y=1', APP, DOM), 'https://notes.delquro.com/x?y=1');
  assert.equal(sso.safeReturnTo('https://delquro.com/', APP, DOM), 'https://delquro.com/');
  assert.equal(sso.safeReturnTo(APP + '/#/chat', APP, DOM), APP + '/#/chat');
  assert.equal(sso.safeReturnTo('https://evil.com/?delquro.com', APP, DOM), '');
  assert.equal(sso.safeReturnTo('https://delquro.com.evil.com/', APP, DOM), '');
  assert.equal(sso.safeReturnTo('javascript:alert(1)', APP, DOM), '');
  assert.equal(sso.safeReturnTo('//evil.com', APP, DOM), '');
  assert.equal(sso.safeReturnTo(undefined, APP, DOM), '');
  // SSO off: only the app itself is trusted
  assert.equal(sso.safeReturnTo('https://notes.delquro.com/', APP, ''), '');
  assert.equal(sso.safeReturnTo(APP + '/', APP, ''), APP + '/');
});

test('trusted origins for credentialed verify calls', () => {
  assert.equal(sso.isTrustedOrigin('https://notes.delquro.com', APP, DOM), true);
  assert.equal(sso.isTrustedOrigin('https://evil.com', APP, DOM), false);
  assert.equal(sso.isTrustedOrigin(undefined, APP, DOM), false);
});

test('cookie helpers', () => {
  assert.deepEqual(sso.parseCookies('a=1; jarvis_sso=tok.en; b='), { a: '1', jarvis_sso: 'tok.en', b: '' });
  const set = sso.ssoSetCookie('T', DOM, true);
  assert.match(set, /^jarvis_sso=T; Path=\/; Domain=\.delquro\.com; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.match(sso.ssoClearCookie(DOM, false), /Max-Age=0$/);
});

test('forwarded URL is rebuilt from Traefik headers', () => {
  const h = (n: string) => ({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'notes.delquro.com', 'x-forwarded-uri': '/a?b=1' } as Record<string, string>)[n];
  assert.equal(sso.forwardedUrl(h), 'https://notes.delquro.com/a?b=1');
  assert.equal(sso.forwardedUrl(() => undefined), '');
});
