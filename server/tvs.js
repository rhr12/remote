'use strict';
// Owns one driver per configured TV, wires token persistence, and exposes safe public views.
const crypto = require('crypto');
const { BRANDS } = require('./drivers');
const { AppError } = require('./errors');

const slugify = (name) => (String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'tv');
const newSlug = (name) => `${slugify(name)}-${crypto.randomBytes(4).toString('hex')}`;

function createManager({ store, enableMock = false }) {
  const drivers = new Map();

  function build(tv) {
    const brand = BRANDS[tv.brand];
    if (!brand || (brand.testing && !enableMock)) return;
    const driver = brand.create(tv, store.getToken(tv.id));
    driver.on('token', (t) => store.setToken(tv.id, t));
    drivers.set(tv.id, driver);
    if (tv.enabled) driver.start();
  }
  const teardown = (id) => { const d = drivers.get(id); if (d) { d.close(); d.removeAllListeners(); drivers.delete(id); } };

  store.list().forEach(build);

  const driverFor = (id) => {
    const d = drivers.get(id);
    if (!d) throw new AppError(503, 'driver_unavailable', 'This TV type is not available on the server.');
    return d;
  };
  const status = (tv) => {
    const d = drivers.get(tv.id);
    if (!tv.enabled) return { state: 'disabled', message: 'This remote has been switched off by the owner.' };
    return d ? d.status : { state: 'error', message: 'TV driver unavailable.' };
  };

  return {
    driverFor, status, newSlug,
    // View for guests: no host, MAC, token or ids.
    publicView(tv, isAdmin) {
      return { name: tv.name, brand: tv.brand, status: status(tv), level: isAdmin || tv.guestLevel === 'extended' ? 'extended' : 'basic', art: Boolean(tv.supportsArt) };
    },
    adminView: (tv) => ({ ...tv, status: status(tv) }),
    add(tv) { const rec = store.create({ ...tv, slug: newSlug(tv.name), enabled: true }); build(rec); return rec; },
    update(id, patch) {
      const rec = store.update(id, patch);
      if (rec && ('host' in patch || 'mac' in patch || 'brand' in patch || 'enabled' in patch)) { teardown(id); build(rec); }
      return rec;
    },
    remove(id) { teardown(id); return store.remove(id); },
    rotateSlug(id) { const tv = store.get(id); return tv ? store.update(id, { slug: newSlug(tv.name) }) : null; },
    shutdown() { for (const id of [...drivers.keys()]) teardown(id); },
  };
}
module.exports = { createManager };
