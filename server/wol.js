'use strict';
const dgram = require('dgram');
const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

function magicPacket(mac) {
  if (!MAC_RE.test(mac)) throw new Error('Invalid MAC address');
  const bytes = Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(bytes)]);
}
function wake(mac, { address = '255.255.255.255', port = 9 } = {}) {
  const pkt = magicPacket(mac);
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', (e) => { s.close(); reject(e); });
    s.bind(() => {
      s.setBroadcast(true);
      s.send(pkt, port, address, (e) => { s.close(); e ? reject(e) : resolve(); });
    });
  });
}
module.exports = { wake, magicPacket, MAC_RE };
