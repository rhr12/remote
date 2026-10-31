'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function load(env = process.env) {
  return {
    root: ROOT,
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    dataDir: env.REMOTE_DATA_DIR || path.join(ROOT, 'data'),
    publicDir: path.join(ROOT, 'public'),
    // Extra CIDRs (comma separated) allowed in addition to private/loopback ranges.
    extraNets: (env.ALLOWED_NETS || '').split(',').map((s) => s.trim()).filter(Boolean),
    // Extra Host header names (comma separated) accepted, e.g. "macbook.local".
    extraHosts: (env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    enableMock: env.ENABLE_MOCK_TV === '1',
    sessionHours: Number(env.ADMIN_SESSION_HOURS) || 12,
  };
}
module.exports = { load };
