'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isLanAddress, isAllowedHostHeader } = require('../server/lan');
const { createLimiter } = require('../server/ratelimit');
const { createStore } = require('../server/store');
const { magicPacket } = require('../server/wol');
const { tmp } = require('./helpers');

test('LAN filter', () => {
  for (const a of ['192.168.1.20', '10.1.2.3', '172.16.5.5', '172.31.255.1', '127.0.0.1', '::1', '::ffff:192.168.0.9', 'fe80::1', 'fd12::1']) assert.ok(isLanAddress(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.64.0.1', '2001:4860::1', '::ffff:8.8.8.8', '', undefined, 'garbage']) assert.ok(!isLanAddress(a), String(a));
  assert.ok(isLanAddress('203.0.113.7', ['203.0.113.0/24']));
});
test('Host header allow-list blocks DNS rebinding names', () => {
  for (const h of ['192.168.1.5:3000', 'localhost:3000', 'macbook.local', '[::1]:3000']) assert.ok(isAllowedHostHeader(h), h);
  for (const h of ['evil.com', 'evil.com:3000', '8.8.8.8', 'a.local.evil.com', '', undefined]) assert.ok(!isAllowedHostHeader(h), String(h));
  assert.ok(isAllowedHostHeader('my.example.org', ['my.example.org']));
});
test('rate limiter', () => {
  const l = createLimiter({ windowMs: 1000, max: 3 });
  assert.ok(l.take('a').ok && l.take('a').ok && l.take('a').ok);
  assert.equal(l.take('a').ok, false); assert.ok(l.take('b').ok);
});
test('store encrypts tokens, hides them from views, uses 0600 files', () => {
  const dir = tmp(); const s = createStore(dir);
  const tv = s.create({ name: 'T', slug: 'abc-123', brand: 'samsung', host: '192.168.1.5' });
  s.setToken(tv.id, 'SECRET-TOKEN-123');
  assert.equal(s.getToken(tv.id), 'SECRET-TOKEN-123');
  assert.equal(JSON.stringify(s.list()).includes('SECRET-TOKEN-123'), false);
  assert.equal(fs.readFileSync(path.join(dir, 'tvs.json'), 'utf8').includes('SECRET-TOKEN-123'), false);
  assert.equal(fs.statSync(path.join(dir, 'tvs.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(dir, 'secret.key')).mode & 0o777, 0o600);
  assert.equal(createStore(dir).getToken(tv.id), 'SECRET-TOKEN-123'); // survives restart
  fs.writeFileSync(path.join(dir, 'secret.key'), '00'.repeat(32));
  assert.equal(createStore(dir).getToken(tv.id), null); // wrong key can't decrypt
});
test('wake-on-lan packet', () => {
  const p = magicPacket('aa:bb:cc:dd:ee:ff');
  assert.equal(p.length, 102); assert.deepEqual([...p.subarray(0, 6)], Array(6).fill(255));
  assert.throws(() => magicPacket('nope'));
});
