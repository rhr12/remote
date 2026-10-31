'use strict';
/*
 * Samsung Tizen (2016+; this project targets the 2023 The Frame) "SmartView" remote channel.
 *
 *   wss://<tv>:8002/api/v2/channels/samsung.remote.control?name=<base64 app name>[&token=<token>]
 *
 * - The TV uses a self-signed certificate, so certificate verification is disabled for this one
 *   connection to the configured TV address only.
 * - Without a token the TV shows an "Allow / Deny" prompt ON THE TV. After "Allow" it sends an
 *   `ms.channel.connect` event containing `data.token`. We store that token (encrypted) and send it
 *   on every later connection, so the prompt is not shown again.
 * - Keys: {"method":"ms.remote.control","params":{"Cmd":"Click","DataOfCmd":"KEY_VOLUP",
 *          "Option":"false","TypeOfRemote":"SendRemoteKey"}}
 * - Art Mode (The Frame): via a second channel `com.samsung.art-app` (art_app_request) with a fallback
 *   to a long-press of KEY_POWER, which toggles Art Mode on Frame TVs.
 */
const EventEmitter = require('events');
const crypto = require('crypto');
const WebSocket = require('ws');
const { AppError } = require('../errors');
const { wake } = require('../wol');

const KEY_MAP = {
  up: 'KEY_UP', down: 'KEY_DOWN', left: 'KEY_LEFT', right: 'KEY_RIGHT', ok: 'KEY_ENTER',
  back: 'KEY_RETURN', home: 'KEY_HOME', power: 'KEY_POWER', volup: 'KEY_VOLUP', voldown: 'KEY_VOLDOWN',
  mute: 'KEY_MUTE', play: 'KEY_PLAY', pause: 'KEY_PAUSE', stop: 'KEY_STOP', rewind: 'KEY_REWIND', ffwd: 'KEY_FF',
  menu: 'KEY_MENU', source: 'KEY_SOURCE', info: 'KEY_INFO', guide: 'KEY_GUIDE', exit: 'KEY_EXIT',
  chup: 'KEY_CHUP', chdown: 'KEY_CHDOWN',
  ...Object.fromEntries([...Array(10).keys()].map((n) => [`num${n}`, `KEY_${n}`])),
};

const STATE_MESSAGES = {
  unpaired: 'This TV has not been authorized yet. Ask the owner to pair it.',
  offline: 'The TV looks off or asleep. Tap power to try waking it.',
  connecting: 'Connecting to the TV…',
  awaiting_approval: 'Waiting for approval on the TV screen…',
  connected: 'Connected',
  denied: 'The TV did not approve the connection (denied or timed out).',
  error: 'Something went wrong talking to the TV.',
};
const BACKOFF = [2000, 5000, 10000, 20000, 30000, 60000];

class SamsungDriver extends EventEmitter {
  constructor({ host, port = 8002, name = 'Remote', token = null, mac = null, approvalMs = 45000 }) {
    super();
    Object.assign(this, { host, port, appName: name, token, mac, approvalMs });
    this.state = token ? 'offline' : 'unpaired';
    this.detail = null;
    this.ws = null; this.pairing = false; this.attempt = 0; this.stopped = true;
    this.timers = new Set();
  }
  get status() { return { state: this.state, message: this.detail || STATE_MESSAGES[this.state] }; }

  _set(state, detail = null) {
    if (this.state === state && this.detail === detail) return;
    this.state = state; this.detail = detail; this.emit('status', this.status);
  }
  _timer(fn, ms) { const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms); this.timers.add(t); return t; }
  _clearTimers() { this.timers.forEach(clearTimeout); this.timers.clear(); }
  _url(channel, withToken = true) {
    const name = Buffer.from(this.appName).toString('base64');
    const tok = withToken && this.token ? `&token=${encodeURIComponent(this.token)}` : '';
    return `wss://${this.host}:${this.port}/api/v2/channels/${channel}?name=${encodeURIComponent(name)}${tok}`;
  }

  /** Start the persistent connection (only if already authorized). */
  start() {
    this.stopped = false;
    if (!this.token) return this._set('unpaired');
    this._open(false);
  }
  /** Begin pairing: connects with no token so the TV shows its Allow/Deny prompt. */
  pair() {
    this.stopped = false; this.token = null; this.emit('token', null);
    this._open(true);
  }
  forget() { this.close(); this.token = null; this.emit('token', null); this._set('unpaired'); }
  reconnect() { if (this.token) { this.stopped = false; this.attempt = 0; this._open(false); } }
  close() {
    this.stopped = true; this._clearTimers();
    if (this.ws) { this.ws.removeAllListeners(); this.ws.on('error', () => {}); try { this.ws.terminate(); } catch { /* ignore */ } this.ws = null; }
  }

  _open(pairing) {
    this._clearTimers();
    if (this.ws) { this.ws.removeAllListeners(); this.ws.on('error', () => {}); try { this.ws.terminate(); } catch { /* ignore */ } }
    this.pairing = pairing;
    this._set(pairing ? 'awaiting_approval' : 'connecting');
    const ws = new WebSocket(this._url('samsung.remote.control'), { rejectUnauthorized: false, handshakeTimeout: 8000 });
    this.ws = ws;
    let settled = false;

    ws.on('open', () => {
      if (this.pairing) this._timer(() => { if (!settled) { settled = true; this.pairing = false; this._set('denied'); ws.terminate(); } }, this.approvalMs);
      const ka = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 25000);
      ka.unref(); ws.once('close', () => clearInterval(ka));
    });
    ws.on('message', (raw) => {
      let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
      switch (ev.event) {
        case 'ms.channel.connect':
        case 'ms.channel.ready': {
          const tok = ev.data && ev.data.token;
          if (tok && tok !== this.token) { this.token = String(tok); this.emit('token', this.token); }
          settled = true; this.pairing = false; this.attempt = 0; this._clearTimers();
          this._set('connected');
          break;
        }
        case 'ms.channel.unauthorized':
          settled = true; this._clearTimers();
          if (this.pairing) { this.pairing = false; this._set('denied'); }
          else { this.token = null; this.emit('token', null); this._set('unpaired', 'The TV no longer accepts the saved authorization. Pair it again.'); }
          ws.terminate(); break;
        case 'ms.channel.timeOut':
          settled = true; this.pairing = false; this._clearTimers(); this._set('denied'); ws.terminate(); break;
        case 'ms.error':
          this._set('error', ev.data && ev.data.message ? `TV error: ${ev.data.message}` : null); break;
        default:
      }
    });
    ws.on('error', (err) => {
      if (this.ws !== ws) return;
      const code = err && err.code;
      if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'].includes(code) || /timeout|handshake/i.test(String(err && err.message))) {
        if (!this.pairing) this._set('offline'); else this._set('error', 'Could not reach the TV. Is it on and on the same Wi-Fi?');
      } else this._set('error', 'Connection error: ' + (err && err.message));
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null; this._clearTimers();
      if (this.state === 'connected' || this.state === 'connecting') this._set('offline');
      else if (this.state === 'awaiting_approval') this._set('denied');
      if (!this.stopped && this.token && !['unpaired', 'denied'].includes(this.state)) {
        const delay = BACKOFF[Math.min(this.attempt++, BACKOFF.length - 1)];
        this._timer(() => this._open(false), delay);
      }
    });
  }

  _send(obj) { this.ws.send(JSON.stringify(obj)); }
  _requireConnected() {
    if (this.state === 'connected' && this.ws && this.ws.readyState === WebSocket.OPEN) return;
    throw new AppError(409, 'tv_' + this.state, this.status.message);
  }

  async sendKey(key) {
    const code = KEY_MAP[key];
    if (!Object.hasOwn(KEY_MAP, key)) throw new AppError(400, 'bad_key', 'Unsupported key.');
    if (this.state !== 'connected' && key === 'power' && this.mac && this.token) {
      await wake(this.mac).catch(() => {});
      this.reconnect();
      return { action: 'wake' };
    }
    this._requireConnected();
    this._send({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: code, Option: 'false', TypeOfRemote: 'SendRemoteKey' } });
    return { action: 'key' };
  }

  async _hold(code, ms) {
    this._requireConnected();
    const p = (Cmd) => ({ method: 'ms.remote.control', params: { Cmd, DataOfCmd: code, Option: 'false', TypeOfRemote: 'SendRemoteKey' } });
    this._send(p('Press'));
    await new Promise((r) => setTimeout(r, ms));
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this._send(p('Release'));
  }

  _artRequest(request, extra = {}, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const ws = new WebSocket(this._url('com.samsung.art-app'), { rejectUnauthorized: false, handshakeTimeout: 5000 });
      const done = (err, val) => { clearTimeout(t); ws.removeAllListeners(); ws.on('error', () => {}); try { ws.terminate(); } catch { /* ignore */ } err ? reject(err) : resolve(val); };
      const t = setTimeout(() => done(new Error('Art Mode request timed out')), timeoutMs);
      ws.on('error', (e) => done(e));
      ws.on('close', () => done(new Error('Art channel closed')));
      ws.on('message', (raw) => {
        let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
        if (ev.event === 'ms.channel.ready') {
          ws.send(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'art_app_request', to: 'host', data: JSON.stringify({ request, id, ...extra }) } }));
        } else if (ev.event === 'd2d_service_message') {
          let inner; try { inner = JSON.parse(ev.data); } catch { return; }
          if (inner.event === 'error') return done(new Error('TV rejected Art Mode request'));
          if (['artmode_status', 'art_mode_changed'].includes(inner.event)) done(null, inner);
        } else if (ev.event === 'ms.channel.unauthorized') done(new Error('unauthorized'));
      });
    });
  }

  /** action: 'on' | 'off' | 'status' */
  async art(action) {
    if (this.state !== 'connected') this._requireConnected();
    if (action === 'status') {
      try { const r = await this._artRequest('get_artmode_status'); return { artMode: r.value === 'on' || r.status === 'on' }; }
      catch { return { artMode: null }; }
    }
    try {
      await this._artRequest('set_artmode_status', { value: action });
      return { artMode: action === 'on', method: 'art-api' };
    } catch {
      // Fallback documented by the community: long-press power enters Art Mode; a short press leaves it.
      if (action === 'on') await this._hold('KEY_POWER', 3000); else await this.sendKey('power');
      return { artMode: action === 'on', method: 'power-key' };
    }
  }

  capabilities() { return { wake: Boolean(this.mac) }; }
}

/** Anonymous info endpoint on :8001 — reveals model, Frame support and MAC; no pairing needed. */
async function probe(host, { port = 8001, timeoutMs = 4000 } = {}) {
  const res = await fetch(`http://${host}:${port}/api/v2/`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error('Unexpected response from device');
  const j = await res.json();
  const d = j.device || {};
  return {
    name: j.name || d.name || null,
    model: d.modelName || null,
    frame: d.FrameTVSupport === 'true' || d.FrameTVSupport === true,
    wifiMac: d.wifiMac || null,
    powerState: d.PowerState || null,
    tokenAuth: d.TokenAuthSupport === 'true' || d.TokenAuthSupport === true,
    os: d.OS || null,
  };
}

module.exports = { SamsungDriver, probe, KEY_MAP };
