'use strict';
const os = require('os');
const { load } = require('./config');
const { createStore } = require('./store');
const { createAuth } = require('./auth');
const { createManager } = require('./tvs');
const { createApp } = require('./app');

const config = load();
const store = createStore(config.dataDir);
const auth = createAuth({ dataDir: config.dataDir, sessionHours: config.sessionHours });
const manager = createManager({ store, enableMock: config.enableMock });
const server = createApp({ config, store, manager, auth }).listen(config.port, config.host, () => {
  console.log(`Remote listening on port ${config.port}`);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  http://${i.address}:${config.port}/admin`);
  if (!auth.configured()) console.log('Admin password not set. Run: npm run set-admin');
});
const stop = () => { manager.shutdown(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
// Keep running (launchd restarts us on crash), but log instead of dying silently on stray errors.
process.on('uncaughtException', (e) => { console.error('uncaughtException', e); process.exit(1); });
