'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('../server/config');
const { createStore } = require('../server/store');
const { createAuth } = require('../server/auth');
const { createManager } = require('../server/tvs');
const { createApp } = require('../server/app');
const { tmp } = require('./helpers');

async function boot() {
  const config = { ...load({ ENABLE_MOCK_TV: '1' }), dataDir: tmp() };
  const store = createStore(config.dataDir);
  const auth = createAuth({ dataDir: config.dataDir });
  const manager = createManager({ store, enableMock: true });
  const server = createApp({ config, store, manager, auth }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { config, store, auth, manager, base, close: () => { manager.shutdown(); server.close(); } };
}
const J = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('admin flow, guest control, and secrecy', async (t) => {
  const ctx = await boot(); t.after(ctx.close);
  const { base } = ctx;

  // admin not configured
  let r = await fetch(base + '/api/admin/login', J({ password: 'x' }));
  assert.equal(r.status, 503);
  // no password set: admin is open to the LAN, but guests do NOT get extended keys
  assert.equal((await fetch(base + '/api/admin/tvs')).status, 200);
  assert.equal((await fetch(base + '/api/admin/tvs', J({ name: 'Z', brand: 'mock', host: '192.168.1.9' }))).status, 403); // still needs CSRF header
  const open = await (await fetch(base + '/api/admin/session')).json();
  assert.equal(open.admin, true); assert.equal(open.configured, false);
  ctx.auth.setPassword('correct horse battery');

  // unauthenticated admin access
  assert.equal((await fetch(base + '/api/admin/tvs')).status, 401);
  r = await fetch(base + '/api/admin/login', J({ password: 'wrong-password' }));
  assert.equal(r.status, 401);
  r = await fetch(base + '/api/admin/login', J({ password: 'correct horse battery' }));
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i);
  const adm = { Cookie: cookie.split(';')[0], 'X-Remote-CSRF': '1' };

  // CSRF header required for writes
  r = await fetch(base + '/api/admin/tvs', J({ name: 'Den', brand: 'mock', host: '192.168.1.9' }, { Cookie: adm.Cookie }));
  assert.equal(r.status, 403);

  // input validation
  for (const bad of [{ name: '', brand: 'mock', host: '192.168.1.9' }, { name: 'x', brand: 'nope', host: '192.168.1.9' }, { name: 'x', brand: 'mock', host: '8.8.8.8' }, { name: 'x', brand: 'mock', host: 'evil.com' }, { name: 'x', brand: 'mock', host: '192.168.1.9', mac: 'zz' }, { name: '<b>', brand: 'mock', host: '192.168.1.9' }]) {
    r = await fetch(base + '/api/admin/tvs', J(bad, adm)); assert.equal(r.status, 400, JSON.stringify(bad));
  }

  r = await fetch(base + '/api/admin/tvs', J({ name: 'Den', brand: 'mock', host: '192.168.1.9', supportsArt: true }, adm));
  assert.equal(r.status, 201);
  const { tv } = await r.json();
  const slug = tv.slug;

  // pair via mock
  assert.equal((await fetch(`${base}/api/admin/tvs/${tv.id}/pair`, J({}, adm))).status, 200);
  await new Promise((rr) => setTimeout(rr, 1000));

  // guest view: no host/token/id leaks
  r = await fetch(`${base}/api/tvs/${slug}`); const pub = await r.json();
  assert.equal(pub.status.state, 'connected'); assert.equal(pub.level, 'basic');
  const text = JSON.stringify(pub);
  for (const secret of ['192.168.1.9', 'mock-token', tv.id, 'host', 'token']) assert.equal(text.includes(secret), false, secret);

  // guest keys
  r = await fetch(`${base}/api/tvs/${slug}/key`, J({ key: 'volup' })); assert.equal(r.status, 200);
  r = await fetch(`${base}/api/tvs/${slug}/key`, J({ key: 'source' })); assert.equal(r.status, 403);
  for (const k of ['KEY_POWER', '../../etc/passwd', '__proto__', 'constructor', 5, null, undefined]) {
    r = await fetch(`${base}/api/tvs/${slug}/key`, J({ key: k })); assert.equal(r.status, 400, String(k));
  }
  // cross-site style form post is refused (needs JSON)
  r = await fetch(`${base}/api/tvs/${slug}/key`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"key":"up"}' });
  assert.equal(r.status, 415);
  assert.deepEqual(ctx.manager.driverFor(tv.id).sent, ['volup']);

  // admin gets extended keys; guestLevel patch also does
  r = await fetch(`${base}/api/tvs/${slug}/key`, J({ key: 'source' }, adm)); assert.equal(r.status, 200);
  await fetch(`${base}/api/admin/tvs/${tv.id}`, { method: 'PATCH', headers: { ...adm, 'Content-Type': 'application/json' }, body: JSON.stringify({ guestLevel: 'extended' }) });
  r = await fetch(`${base}/api/tvs/${slug}/key`, J({ key: 'menu' })); assert.equal(r.status, 200);

  // art mode
  r = await fetch(`${base}/api/tvs/${slug}/art`, J({ action: 'on' })); assert.equal((await r.json()).artMode, true);
  r = await fetch(`${base}/api/tvs/${slug}/art`, J({ action: 'rm -rf' })); assert.equal(r.status, 400);

  // admin list never exposes token
  r = await fetch(`${base}/api/admin/tvs`, { headers: adm }); const list = JSON.stringify(await r.json());
  assert.equal(list.includes('mock-token'), false); assert.equal(list.includes('tokenEnc'), false);

  // disabled TV refuses
  await fetch(`${base}/api/admin/tvs/${tv.id}`, { method: 'PATCH', headers: { ...adm, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
  r = await fetch(`${base}/api/tvs/${slug}/key`, J({ key: 'up' })); assert.equal(r.status, 403);

  // rotate url invalidates old
  r = await fetch(`${base}/api/admin/tvs/${tv.id}/rotate-url`, J({}, adm)); const rot = (await r.json()).tv.slug;
  assert.notEqual(rot, slug);
  assert.equal((await fetch(`${base}/api/tvs/${slug}`)).status, 404);
  assert.equal((await fetch(`${base}/t/${slug}`)).status, 404);
  assert.equal((await fetch(`${base}/t/${rot}`)).status, 200);

  // logout invalidates session
  await fetch(`${base}/api/admin/logout`, J({}, adm));
  assert.equal((await fetch(`${base}/api/admin/tvs`, { headers: adm })).status, 401);
});

test('static serving cannot escape public dir or leak data', async (t) => {
  const ctx = await boot(); t.after(ctx.close);
  const get = (p) => new Promise((resolve) => {
    require('http').get({ host: '127.0.0.1', port: new URL(ctx.base).port, path: p }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  });
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/server/store.js', '/data/tvs.json', '/server/app.js', '/.env', '/admin.json']) {
    const r = await get(p); assert.ok(r.status === 404 || r.status === 403 || r.status === 400, `${p} -> ${r.status}`);
    assert.ok(!r.body.includes('createStore') && !r.body.includes('"name": "remote"'));
  }
  assert.equal((await get('/')).status, 200);
  const h = await fetch(ctx.base + '/'); assert.match(h.headers.get('content-security-policy'), /default-src 'self'/);
});

test('login rate limiting and bad Host header', async (t) => {
  const ctx = await boot(); t.after(ctx.close);
  ctx.auth.setPassword('correct horse battery');
  let last;
  for (let i = 0; i < 10; i++) last = (await fetch(ctx.base + '/api/admin/login', J({ password: 'bad-password-' + i }))).status;
  assert.equal(last, 429);
  // correct password is also locked out now
  assert.equal((await fetch(ctx.base + '/api/admin/login', J({ password: 'correct horse battery' }))).status, 429);
  const res = await new Promise((resolve) => require('http').get({ host: '127.0.0.1', port: new URL(ctx.base).port, path: '/', headers: { Host: 'evil.example.com' } }, resolve));
  assert.equal(res.statusCode, 421);
});

test('guest button rate limit', async (t) => {
  const ctx = await boot(); t.after(ctx.close);
  const tv = ctx.manager.add({ name: 'A', brand: 'mock', host: '192.168.1.2', guestLevel: 'basic' });
  ctx.manager.driverFor(tv.id).pair(); await new Promise((r) => setTimeout(r, 1000));
  const codes = [];
  for (let i = 0; i < 60; i++) codes.push((await fetch(`${ctx.base}/api/tvs/${tv.slug}/key`, J({ key: 'up' }))).status);
  assert.ok(codes.includes(429)); assert.equal(codes[0], 200);
});
