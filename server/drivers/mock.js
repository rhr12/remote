'use strict';
// In-memory TV for tests and demos (enable with ENABLE_MOCK_TV=1). Never talks to the network.
const EventEmitter = require('events');
const { AppError } = require('../errors');

class MockDriver extends EventEmitter {
  constructor({ token = null } = {}) {
    super(); this.token = token; this.sent = []; this.artMode = false;
    this.state = token ? 'connected' : 'unpaired';
  }
  get status() { return { state: this.state, message: this.state === 'connected' ? 'Connected' : this.state === 'unpaired' ? 'This TV has not been authorized yet. Ask the owner to pair it.' : 'Mock TV ' + this.state }; }
  _set(s) { this.state = s; this.emit('status', this.status); }
  start() { if (this.token) this._set('connected'); }
  pair() { this._set('awaiting_approval'); setTimeout(() => { this.token = 'mock-token'; this.emit('token', this.token); this._set('connected'); }, 800).unref(); }
  forget() { this.token = null; this.emit('token', null); this._set('unpaired'); }
  reconnect() { this.start(); }
  close() {}
  async sendKey(key) { if (this.state !== 'connected') throw new AppError(409, 'tv_' + this.state, this.status.message); this.sent.push(key); return { action: 'key' }; }
  async art(action) {
    if (this.state !== 'connected') throw new AppError(409, 'tv_' + this.state, this.status.message);
    if (action !== 'status') this.artMode = action === 'on';
    return { artMode: this.artMode, method: 'mock' };
  }
  capabilities() { return { wake: false }; }
}
module.exports = { MockDriver };
