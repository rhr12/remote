'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { WebSocketServer } = require('ws');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'remote-test-'));

/** Fake Samsung TV: TLS + WebSocket on a random port, behaving per the documented protocol. */
function fakeSamsungTv({ mode = 'allow', validToken = 'TESTTOKEN' } = {}) {
  const dir = tmp();
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=fake-tv'], { stdio: 'ignore' });
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) });
  const wss = new WebSocketServer({ server });
  const tv = { received: [], urls: [], mode, validToken, artReceived: [] };
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'https://x');
    tv.urls.push(req.url);
    const token = url.searchParams.get('token');
    const art = url.pathname.endsWith('com.samsung.art-app');
    const hello = () => { ws.send(JSON.stringify({ event: 'ms.channel.connect', data: { clients: [], id: '1', token: tv.validToken } })); ws.send(JSON.stringify({ event: 'ms.channel.ready' })); };
    if (token) {
      if (token !== tv.validToken) return ws.send(JSON.stringify({ event: 'ms.channel.unauthorized' }));
      hello();
    } else if (tv.mode === 'allow') setTimeout(hello, 60);
    else if (tv.mode === 'deny') setTimeout(() => ws.send(JSON.stringify({ event: 'ms.channel.unauthorized' })), 60);
    // mode 'ignore': never answers (user does not press anything)
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (art) {
        tv.artReceived.push(m);
        const d = JSON.parse(m.params.data);
        ws.send(JSON.stringify({ event: 'd2d_service_message', data: JSON.stringify({ event: d.request === 'get_artmode_status' ? 'artmode_status' : 'art_mode_changed', value: d.value || 'off', status: d.value }) }));
      } else tv.received.push(m);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    tv.port = server.address().port;
    tv.close = () => new Promise((r) => { wss.clients.forEach((c) => c.terminate()); server.close(r); });
    resolve(tv);
  }));
}

const waitFor = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('waitFor timed out');
};
module.exports = { tmp, fakeSamsungTv, waitFor };
