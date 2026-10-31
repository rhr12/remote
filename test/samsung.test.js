'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SamsungDriver } = require('../server/drivers/samsung');
const { fakeSamsungTv, waitFor } = require('./helpers');

const mk = (tv, extra = {}) => new SamsungDriver({ host: '127.0.0.1', port: tv.port, name: 'Remote', approvalMs: 600, ...extra });

test('pairing: TV prompt approved -> token captured, connected, key payload correct', async () => {
  const tv = await fakeSamsungTv({ mode: 'allow' });
  const d = mk(tv); const tokens = [];
  d.on('token', (t) => tokens.push(t));
  d.pair();
  assert.equal(d.status.state, 'awaiting_approval');
  await waitFor(() => d.status.state === 'connected');
  assert.equal(tokens.at(-1), 'TESTTOKEN');
  assert.match(tv.urls[0], /^\/api\/v2\/channels\/samsung\.remote\.control\?name=UmVtb3Rl$/); // base64("Remote"), no token on first pair
  await d.sendKey('volup');
  await waitFor(() => tv.received.length === 1);
  assert.deepEqual(tv.received[0], { method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: 'KEY_VOLUP', Option: 'false', TypeOfRemote: 'SendRemoteKey' } });
  d.close(); await tv.close();
});

test('auto-reconnect with stored token sends token, no prompt', async () => {
  const tv = await fakeSamsungTv({ mode: 'ignore' });
  const d = mk(tv, { token: 'TESTTOKEN' });
  d.start();
  await waitFor(() => d.status.state === 'connected');
  assert.ok(tv.urls[0].endsWith('&token=TESTTOKEN'));
  d.close(); await tv.close();
});

test('pairing denied on TV -> denied state', async () => {
  const tv = await fakeSamsungTv({ mode: 'deny' });
  const d = mk(tv); d.pair();
  await waitFor(() => d.status.state === 'denied');
  await assert.rejects(d.sendKey('up'), /not approve/);
  d.close(); await tv.close();
});

test('pairing never answered -> times out to denied', async () => {
  const tv = await fakeSamsungTv({ mode: 'ignore' });
  const d = mk(tv); d.pair();
  await waitFor(() => d.status.state === 'denied', 3000);
  d.close(); await tv.close();
});

test('stale token rejected -> unpaired and token cleared', async () => {
  const tv = await fakeSamsungTv({ mode: 'allow', validToken: 'OTHER' });
  const d = mk(tv, { token: 'OLD' }); const tokens = [];
  d.on('token', (t) => tokens.push(t));
  d.start();
  await waitFor(() => d.status.state === 'unpaired');
  assert.equal(tokens.at(-1), null);
  d.close(); await tv.close();
});

test('TV unreachable -> offline with friendly message', async () => {
  const d = new SamsungDriver({ host: '127.0.0.1', port: 1, token: 'T' });
  d.start();
  await waitFor(() => d.status.state === 'offline');
  assert.match(d.status.message, /off or asleep/);
  d.close();
});

test('rejects unknown keys and unconnected sends', async () => {
  const d = new SamsungDriver({ host: '127.0.0.1', port: 1 });
  await assert.rejects(d.sendKey('__proto__'), /Unsupported key/);
  await assert.rejects(d.sendKey('up'), /not been authorized/);
});

test('art mode request goes over the art channel (fake TV; real Frame behaviour unverified)', async () => {
  const tv = await fakeSamsungTv({ mode: 'allow' });
  const d = mk(tv, { token: 'TESTTOKEN' }); d.start();
  await waitFor(() => d.status.state === 'connected');
  const r = await d.art('on');
  assert.equal(r.method, 'art-api');
  const sent = JSON.parse(tv.artReceived[0].params.data);
  assert.equal(sent.request, 'set_artmode_status'); assert.equal(sent.value, 'on');
  assert.equal(typeof (await d.art('status')).artMode, 'boolean');
  d.close(); await tv.close();
});
