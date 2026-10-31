'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { lanOnly, isPrivateV4 } = require('./lan');
const { createLimiter, middleware } = require('./ratelimit');
const { keyTier, ART_ACTIONS } = require('./keys');
const { AppError } = require('./errors');
const { BRANDS, brandList } = require('./drivers');
const { MAC_RE } = require('./wol');

const SLUG_RE = /^[a-z0-9-]{3,48}$/;
const ip = (req) => req.socket.remoteAddress;

function validateTvInput(body, { partial = false, enableMock = false } = {}) {
  const out = {};
  const bad = (m) => { throw new AppError(400, 'invalid_input', m); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('Expected a JSON object.');
  if (!partial || 'name' in body) {
    if (typeof body.name !== 'string' || !/^[^\u0000-\u001f<>]{1,40}$/.test(body.name.trim())) bad('Name must be 1–40 characters.');
    out.name = body.name.trim();
  }
  if (!partial || 'brand' in body) {
    const ids = brandList(enableMock).map((b) => b.id);
    if (!ids.includes(body.brand)) bad('Unknown TV brand.');
    out.brand = body.brand;
  }
  if (!partial || 'host' in body) {
    if (typeof body.host !== 'string' || !isPrivateV4(body.host.trim())) bad('Host must be the TV\'s private IPv4 address on your home network (e.g. 192.168.1.50).');
    out.host = body.host.trim();
  }
  if ('mac' in body) {
    if (body.mac === '' || body.mac === null) out.mac = null;
    else if (typeof body.mac === 'string' && MAC_RE.test(body.mac.trim())) out.mac = body.mac.trim().toLowerCase().replace(/-/g, ':');
    else bad('MAC address must look like aa:bb:cc:dd:ee:ff.');
  }
  if ('guestLevel' in body) {
    if (!['basic', 'extended'].includes(body.guestLevel)) bad('guestLevel must be "basic" or "extended".');
    out.guestLevel = body.guestLevel;
  }
  if ('enabled' in body) { if (typeof body.enabled !== 'boolean') bad('enabled must be true or false.'); out.enabled = body.enabled; }
  if ('supportsArt' in body) { if (typeof body.supportsArt !== 'boolean') bad('supportsArt must be true or false.'); out.supportsArt = body.supportsArt; }
  return out;
}

function createApp({ config, store, manager, auth }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(lanOnly(config));
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(middleware(createLimiter({ windowMs: 60000, max: 600 }), ip));
  app.use(express.json({ limit: '2kb' }));

  const requireJson = (req, res, next) => (req.method === 'GET' || req.is('json') ? next() : next(new AppError(415, 'bad_content_type', 'Use application/json.')));
  app.use('/api', requireJson);

  // ---- Guest API -------------------------------------------------------------------------
  const controlLimit = middleware(createLimiter({ windowMs: 5000, max: 40 }), ip, 'Easy there — too many button presses.');
  const statusLimit = middleware(createLimiter({ windowMs: 10000, max: 30 }), ip);

  function tvFromSlug(req) {
    const slug = req.params.slug;
    const tv = SLUG_RE.test(slug) ? store.getBySlug(slug) : null;
    if (!tv) throw new AppError(404, 'not_found', 'TV not found. Scan the tag again.');
    return tv;
  }
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  app.get('/api/tvs/:slug', statusLimit, wrap(async (req, res) => {
    const tv = tvFromSlug(req);
    res.json(manager.publicView(tv, auth.isAdmin(req)));
  }));

  app.post('/api/tvs/:slug/key', controlLimit, wrap(async (req, res) => {
    const tv = tvFromSlug(req);
    const key = req.body && req.body.key;
    const tier = keyTier(key);
    if (!tier) throw new AppError(400, 'bad_key', 'Unsupported button.');
    if (!tv.enabled) throw new AppError(403, 'disabled', 'This remote is switched off.');
    const level = auth.isAdmin(req) || tv.guestLevel === 'extended' ? 'extended' : 'basic';
    if (tier === 'extended' && level !== 'extended') throw new AppError(403, 'guest_restricted', 'That button is not available to guests.');
    res.json({ ok: true, ...(await manager.driverFor(tv.id).sendKey(key)) });
  }));

  app.post('/api/tvs/:slug/art', controlLimit, wrap(async (req, res) => {
    const tv = tvFromSlug(req);
    const action = req.body && req.body.action;
    if (!ART_ACTIONS.has(action)) throw new AppError(400, 'bad_action', 'Unsupported Art Mode action.');
    if (!tv.enabled) throw new AppError(403, 'disabled', 'This remote is switched off.');
    if (!tv.supportsArt) throw new AppError(404, 'no_art', 'This TV does not support Art Mode.');
    res.json({ ok: true, ...(await manager.driverFor(tv.id).art(action)) });
  }));

  // ---- Admin API -------------------------------------------------------------------------
  const admin = express.Router();
  app.use('/api/admin', middleware(createLimiter({ windowMs: 60000, max: 120 }), ip), admin);

  admin.post('/login', wrap(async (req, res) => { auth.login(req, res); res.json({ ok: true }); }));
  admin.get('/session', (req, res) => res.json({ admin: auth.isAdmin(req), configured: auth.configured() }));
  admin.post('/logout', (req, res) => { auth.logout(req, res); res.json({ ok: true }); });

  admin.use(auth.requireAdmin);
  const tvById = (req) => {
    const tv = /^[0-9a-f-]{36}$/.test(req.params.id) ? store.get(req.params.id) : null;
    if (!tv) throw new AppError(404, 'not_found', 'TV not found.');
    return tv;
  };

  admin.get('/tvs', (req, res) => res.json({ tvs: store.list().map(manager.adminView), brands: brandList(config.enableMock) }));

  admin.post('/probe', wrap(async (req, res) => {
    const { host, brand } = validateTvInput({ name: 'x', ...req.body }, { enableMock: config.enableMock });
    try { res.json({ ok: true, info: await BRANDS[brand].probe(host) }); }
    catch { throw new AppError(502, 'unreachable', 'Could not reach a TV at that address. Check it is powered on (not in deep standby) and on the same Wi-Fi.'); }
  }));

  admin.post('/tvs', wrap(async (req, res) => {
    const input = validateTvInput(req.body, { enableMock: config.enableMock });
    const rec = manager.add({ guestLevel: 'basic', supportsArt: false, mac: null, ...input });
    res.status(201).json({ tv: manager.adminView(rec) });
  }));

  admin.patch('/tvs/:id', wrap(async (req, res) => {
    tvById(req);
    const patch = validateTvInput(req.body, { partial: true, enableMock: config.enableMock });
    res.json({ tv: manager.adminView(manager.update(req.params.id, patch)) });
  }));

  admin.delete('/tvs/:id', wrap(async (req, res) => { tvById(req); manager.remove(req.params.id); res.json({ ok: true }); }));
  admin.post('/tvs/:id/pair', wrap(async (req, res) => { tvById(req); manager.driverFor(req.params.id).pair(); res.json({ ok: true }); }));
  admin.post('/tvs/:id/forget', wrap(async (req, res) => { tvById(req); manager.driverFor(req.params.id).forget(); res.json({ ok: true }); }));
  admin.post('/tvs/:id/reconnect', wrap(async (req, res) => { tvById(req); manager.driverFor(req.params.id).reconnect(); res.json({ ok: true }); }));
  admin.post('/tvs/:id/rotate-url', wrap(async (req, res) => { tvById(req); res.json({ tv: manager.adminView(manager.rotateSlug(req.params.id)) }); }));
  admin.use((req, res, next) => next(new AppError(404, 'not_found', 'Not found.')));

  // ---- Pages & static ---------------------------------------------------------------------
  const page = (file) => (req, res) => res.sendFile(path.join(config.publicDir, file));
  app.get('/t/:slug', (req, res, next) => {
    if (!SLUG_RE.test(req.params.slug) || !store.getBySlug(req.params.slug)) return res.status(404).sendFile(path.join(config.publicDir, 'notfound.html'));
    page('remote.html')(req, res, next);
  });
  app.get('/admin', page('admin.html'));
  app.use(express.static(config.publicDir, { dotfiles: 'ignore', index: 'index.html', extensions: false, maxAge: 0 }));

  app.use((req, res, next) => (req.path.startsWith('/api/') ? next(new AppError(404, 'not_found', 'Not found.')) : res.status(404).sendFile(path.join(config.publicDir, 'notfound.html'))));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: { code: 'bad_json', message: 'Invalid request body.' } });
    console.error('Unhandled error:', err);
    res.status(500).json({ error: { code: 'internal', message: 'Unexpected server error.' } });
  });
  return app;
}
module.exports = { createApp, validateTvInput };
