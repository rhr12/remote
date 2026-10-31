'use strict';
// Driver registry. To add a brand: implement the driver interface (see mock.js) and register it here.
const { SamsungDriver, probe: samsungProbe } = require('./samsung');
const { MockDriver } = require('./mock');

const BRANDS = {
  samsung: {
    label: 'Samsung (Tizen)',
    create: (tv, token) => new SamsungDriver({ host: tv.host, name: 'Remote', token, mac: tv.mac }),
    probe: samsungProbe,
  },
  mock: { label: 'Mock TV (testing)', create: (tv, token) => new MockDriver({ token }), probe: async () => ({ name: 'Mock', model: 'MOCK', frame: true, wifiMac: null }), testing: true },
};
const brandList = (enableMock) => Object.entries(BRANDS).filter(([, b]) => enableMock || !b.testing).map(([id, b]) => ({ id, label: b.label }));
module.exports = { BRANDS, brandList };
