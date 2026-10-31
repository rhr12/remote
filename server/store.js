'use strict';
// JSON file store. Pairing tokens are AES-256-GCM encrypted with a key kept in a separate 0600 file.
// Everything lives in dataDir, which is git-ignored.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const keyFile = path.join(dataDir, 'secret.key');
  const tvFile = path.join(dataDir, 'tvs.json');

  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  if (key.length !== 32) throw new Error('data/secret.key is corrupt; delete it (tokens will need re-pairing).');

  function seal(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  }
  function open(blob) {
    try {
      const [v, iv, tag, ct] = blob.split(':');
      if (v !== 'v1') return null;
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
    } catch { return null; }
  }

  let tvs = [];
  if (fs.existsSync(tvFile)) tvs = JSON.parse(fs.readFileSync(tvFile, 'utf8')).tvs || [];

  function persist() {
    const tmp = tvFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ tvs }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, tvFile);
  }
  const clone = (t) => (t ? { ...t } : null);
  // Public shape never includes the token (encrypted or not).
  const strip = (t) => { if (!t) return null; const { tokenEnc, ...rest } = t; return { ...rest, hasToken: Boolean(tokenEnc) }; };

  return {
    list: () => tvs.map(strip),
    get: (id) => strip(tvs.find((t) => t.id === id)),
    getBySlug: (slug) => strip(tvs.find((t) => t.slug === slug)),
    getToken(id) { const t = tvs.find((x) => x.id === id); return t && t.tokenEnc ? open(t.tokenEnc) : null; },
    create(tv) {
      const rec = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), tokenEnc: null, ...tv };
      tvs.push(rec); persist(); return strip(rec);
    },
    update(id, patch) {
      const t = tvs.find((x) => x.id === id); if (!t) return null;
      Object.assign(t, patch); persist(); return strip(t);
    },
    setToken(id, token) {
      const t = tvs.find((x) => x.id === id); if (!t) return;
      t.tokenEnc = token ? seal(token) : null; persist();
    },
    remove(id) {
      const n = tvs.length; tvs = tvs.filter((t) => t.id !== id); persist(); return tvs.length < n;
    },
    _clone: clone,
  };
}
module.exports = { createStore };
