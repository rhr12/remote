'use strict';
// Home-network-only access control. Uses the TCP peer address only; X-Forwarded-For is never trusted.
const net = require('net');

function v4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function normalize(addr) {
  if (!addr) return '';
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  return m ? m[1] : addr.replace(/%.*$/, '');
}
function inCidr4(ip, cidr) {
  const [base, bitsStr] = cidr.split('/');
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (net.isIPv4(base) === false || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((v4ToInt(ip) & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
}
const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16'];

function isPrivateV4(ip) {
  return net.isIPv4(ip) && PRIVATE_V4.some((c) => inCidr4(ip, c));
}
function isLanAddress(addr, extraNets = []) {
  const ip = normalize(addr);
  if (net.isIPv4(ip)) return isPrivateV4(ip) || extraNets.some((c) => inCidr4(ip, c));
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || /^fe[89ab][0-9a-f]:/.test(l) || /^f[cd][0-9a-f]{2}:/.test(l);
  }
  return false;
}

// Blocks DNS-rebinding: the Host header must be a LAN IP, localhost, *.local/.lan/.home.arpa, or allow-listed.
function isAllowedHostHeader(hostHeader, extraHosts = [], extraNets = []) {
  if (!hostHeader || hostHeader.length > 255) return false;
  let host = hostHeader.toLowerCase();
  if (host.startsWith('[')) host = host.slice(1, host.indexOf(']'));
  else host = host.replace(/:\d+$/, '');
  if (extraHosts.includes(host)) return true;
  if (net.isIP(host)) return isLanAddress(host, extraNets);
  return host === 'localhost' || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(local|lan|home\.arpa)$/.test(host);
}

function lanOnly(config) {
  return (req, res, next) => {
    if (!isLanAddress(req.socket.remoteAddress, config.extraNets)) {
      return res.status(403).type('text').send('This remote only works on the home network.');
    }
    if (!isAllowedHostHeader(req.headers.host, config.extraHosts, config.extraNets)) {
      return res.status(421).type('text').send('Unexpected host name. Use the address printed by the server.');
    }
    next();
  };
}
module.exports = { isLanAddress, isPrivateV4, isAllowedHostHeader, lanOnly, normalize };
