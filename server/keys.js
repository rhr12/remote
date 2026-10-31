'use strict';
// Brand-neutral key vocabulary. Anything not listed here is rejected before reaching a driver,
// so clients can never inject arbitrary key codes or commands.
const KEYS = new Map();
const add = (tier, ...names) => names.forEach((n) => KEYS.set(n, tier));
add('basic', 'up', 'down', 'left', 'right', 'ok', 'back', 'home', 'power',
  'volup', 'voldown', 'mute', 'play', 'pause', 'stop', 'rewind', 'ffwd');
add('extended', 'menu', 'source', 'info', 'guide', 'exit', 'chup', 'chdown',
  'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9');

const ART_ACTIONS = new Set(['on', 'off', 'status']);
const keyTier = (name) => (typeof name === 'string' && KEYS.has(name) ? KEYS.get(name) : null);
module.exports = { KEYS, ART_ACTIONS, keyTier };
