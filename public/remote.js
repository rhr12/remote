(() => {
  'use strict';
  const slug = location.pathname.split('/').pop();
  const $ = (id) => document.getElementById(id);
  let tv = null;

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  async function api(path, body) {
    const res = await fetch(`/api/tvs/${encodeURIComponent(slug)}${path}`, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || 'Request failed');
    return data;
  }
  const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* unsupported */ } };

  async function press(key) {
    buzz();
    try { await api('/key', { key }); } catch (e) { toast(e.message); refresh(); }
  }

  function render(info) {
    tv = info;
    $('name').textContent = info.name;
    document.title = info.name + ' Remote';
    $('dot').className = 'dot ' + info.status.state;
    $('state').textContent = { connected: 'Connected', offline: 'TV off', unpaired: 'Not paired', denied: 'Not approved', awaiting_approval: 'Waiting for TV', connecting: 'Connecting', disabled: 'Disabled' }[info.status.state] || 'Problem';
    const b = $('banner');
    const ok = info.status.state === 'connected';
    b.classList.toggle('hidden', ok);
    b.classList.toggle('bad', ['unpaired', 'denied', 'error', 'disabled'].includes(info.status.state));
    b.textContent = info.status.message;
    $('artBtn').classList.toggle('hidden', !info.art);
    $('extended').classList.toggle('hidden', info.level !== 'extended');
  }
  async function refresh() {
    try { render(await api('')); }
    catch (e) { $('name').textContent = 'TV Remote'; $('state').textContent = 'No connection'; $('dot').className = 'dot error'; $('banner').classList.remove('hidden'); $('banner').textContent = e.message === 'Failed to fetch' ? 'Can\'t reach the remote server. Are you on the home Wi-Fi?' : e.message; }
  }

  // Buttons (with press-and-hold repeat for volume)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]'); if (b && !b.hasAttribute('data-repeat')) press(b.dataset.key);
  });
  document.querySelectorAll('[data-repeat]').forEach((b) => {
    let t, iv;
    const stop = () => { clearTimeout(t); clearInterval(iv); };
    b.addEventListener('pointerdown', () => { press(b.dataset.key); t = setTimeout(() => { iv = setInterval(() => press(b.dataset.key), 180); }, 450); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
  });

  // Touchpad: swipe emits direction keys every STEP px; a short tap = OK.
  const pad = $('pad'), STEP = 46;
  let st = null;
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); st = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false }; });
  pad.addEventListener('pointermove', (e) => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < STEP) return;
    st.moved = true;
    const key = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    st.x = e.clientX; st.y = e.clientY; press(key);
  });
  const end = (e) => {
    if (st && !st.moved && Date.now() - st.t < 300 && e.type === 'pointerup') { pad.classList.add('flash'); setTimeout(() => pad.classList.remove('flash'), 120); press('ok'); }
    st = null;
  };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);

  function mode(padMode) {
    $('pad').classList.toggle('hidden', !padMode); $('dpad').classList.toggle('hidden', padMode);
    $('mPad').setAttribute('aria-pressed', padMode); $('mDpad').setAttribute('aria-pressed', !padMode);
    try { localStorage.setItem('mode', padMode ? 'pad' : 'dpad'); } catch { /* private mode */ }
  }
  $('mPad').onclick = () => mode(true); $('mDpad').onclick = () => mode(false);
  try { if (localStorage.getItem('mode') === 'dpad') mode(false); } catch { /* ignore */ }

  // Art Mode
  let art = null;
  $('artBtn').addEventListener('click', async () => {
    buzz();
    try {
      if (art === null) { const s = await api('/art', { action: 'status' }); art = s.artMode === true; }
      const r = await api('/art', { action: art ? 'off' : 'on' }); art = r.artMode; toast(art ? 'Art Mode on' : 'Art Mode off');
    } catch (e) { toast(e.message); }
  });

  // Extended keys
  const extKeys = ['menu', 'source', 'info', 'guide', 'exit', 'chup', 'chdown', ...Array.from({ length: 10 }, (_, i) => 'num' + i)];
  const labels = { menu: 'Menu', source: 'Source', info: 'Info', guide: 'Guide', exit: 'Exit', chup: 'CH+', chdown: 'CH−' };
  extKeys.forEach((k) => { const b = document.createElement('button'); b.className = 'key'; b.dataset.key = k; b.textContent = labels[k] || k.slice(3); $('sheet').appendChild(b); });
  $('moreBtn').onclick = () => { const h = $('sheet').classList.toggle('hidden'); $('moreBtn').setAttribute('aria-expanded', !h); };

  refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
