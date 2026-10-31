'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLimiter } = require('./ratelimit');
const { AppError } = require('./errors');

const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });

function createAuth({ dataDir, sessionHours = 12 }) {
  const file = path.join(dataDir, 'admin.json');
  const sessions = new Map(); // token -> expiry ms
  const loginLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 8 });

  const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

  function setPassword(pw) {
    if (typeof pw !== 'string' || pw.length < 10) throw new Error('Admin password must be at least 10 characters.');
    const salt = crypto.randomBytes(16);
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ salt: salt.toString('hex'), hash: hashPassword(pw, salt).toString('hex') }), { mode: 0o600 });
    sessions.clear();
  }
  function verify(pw) {
    const rec = read();
    if (!rec || typeof pw !== 'string' || pw.length > 256) return false;
    const got = hashPassword(pw, Buffer.from(rec.salt, 'hex'));
    return crypto.timingSafeEqual(got, Buffer.from(rec.hash, 'hex'));
  }
  const parseCookie = (req) => {
    const m = /(?:^|;\s*)rs=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  };
  const isAdmin = (req) => {
    const t = parseCookie(req);
    if (!t) return false;
    const exp = sessions.get(t);
    if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
    return true;
  };

  return {
    configured: () => fs.existsSync(file),
    setPassword,
    isAdmin,
    login(req, res) {
      if (!fs.existsSync(file)) throw new AppError(503, 'admin_not_configured', 'Admin password not set. Run "npm run set-admin" on the server.');
      const rl = loginLimiter.take(req.socket.remoteAddress);
      if (!rl.ok) throw new AppError(429, 'rate_limited', `Too many login attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} min.`);
      if (!verify(req.body && req.body.password)) throw new AppError(401, 'bad_credentials', 'Incorrect password.');
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + sessionHours * 3600 * 1000);
      res.cookie('rs', token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: sessionHours * 3600 * 1000 });
    },
    logout(req, res) { sessions.delete(parseCookie(req)); res.clearCookie('rs', { path: '/' }); },
    // Requires session + a custom header (CSRF defence in depth on top of SameSite=Strict).
    requireAdmin(req, res, next) {
      if (!fs.existsSync(file)) return next(new AppError(503, 'admin_not_configured', 'Admin password not set. Run "npm run set-admin" on the server.'));
      if (!isAdmin(req)) return next(new AppError(401, 'unauthorized', 'Please sign in.'));
      if (req.method !== 'GET' && req.get('x-remote-csrf') !== '1') return next(new AppError(403, 'csrf', 'Missing CSRF header.'));
      next();
    },
  };
}
module.exports = { createAuth };
