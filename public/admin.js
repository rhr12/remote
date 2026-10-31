(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let detected = { frame: false };

  async function api(path, method = 'GET', body) {
    const opt = { method, headers: { 'X-Remote-CSRF': '1' } };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch('/api/admin' + path, opt);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error((data.error && data.error.message) || 'Request failed'); e.status = res.status; throw e; }
    return data;
  }
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); kids.flat().forEach((k) => n.append(k)); return n; };
  const btn = (label, cls, fn) => el('button', { className: 'btn ' + cls, textContent: label, onclick: fn });

  async function boot() {
    const s = await api('/session');
    $('login').classList.toggle('hidden', s.admin); $('app').classList.toggle('hidden', !s.admin); $('logout').classList.toggle('hidden', !s.admin);
    $('notConfigured').classList.toggle('hidden', s.configured);
    if (s.admin) load();
  }
  let timer;
  async function load() {
    try {
      const { tvs, brands } = await api('/tvs');
      if (!$('aBrand').options.length) brands.forEach((b) => $('aBrand').append(new Option(b.label, b.id)));
      const box = $('list'); box.replaceChildren();
      tvs.forEach((tv) => box.append(card(tv)));
      if (!tvs.length) box.append(el('p', { className: 'muted', textContent: 'No TVs yet — add one below.' }));
    } catch (e) { if (e.status === 401) boot(); }
    clearTimeout(timer); timer = setTimeout(() => { if (!document.hidden && !document.querySelector('input:focus')) load(); }, 4000);
  }

  function card(tv) {
    const url = `${location.origin}/t/${tv.slug}`;
    const act = (fn) => async () => { try { await fn(); } catch (e) { alert(e.message); } load(); };
    const pairHelp = el('details', {}, el('summary', { textContent: 'Pairing help (no physical remote?)' }),
      el('ol', {},
        el('li', { textContent: 'Make sure the TV is on and on Wi-Fi, then press "Pair / re-pair". An Allow/Deny prompt appears on the TV for about 30 seconds.' }),
        el('li', { textContent: 'No remote? Use the TV\'s own control: the small button/joystick on the underside or back of the TV (Frame: bottom-right of the bezel) — move to Allow and press it.' }),
        el('li', { textContent: 'Or open the SmartThings phone app, choose the TV, and open its remote/D-pad (this uses Samsung\'s own pairing) to press OK on the prompt.' }),
        el('li', { textContent: 'Prompt never appears? TV: Settings › General › External Device Manager › Device Connection Manager › Access Notification — set it to "First Time Only" or "Every time", and check the Device List for blocked entries named "Remote".' }),
        el('li', { textContent: 'SmartThings cannot approve this prompt remotely — physical or SmartThings-app remote input on the TV is required once.' })));
    return el('article', { className: 'card tv' },
      el('header', {}, el('h2', { textContent: tv.name }), el('span', { className: 'pill' }, el('span', { className: 'dot ' + tv.status.state }), tv.status.state.replace('_', ' '))),
      el('div', { className: 'muted', textContent: `${tv.brand} · ${tv.host} · ${tv.hasToken ? 'authorized' : 'not authorized'} · guests: ${tv.guestLevel}` }),
      el('div', { className: 'muted', textContent: tv.status.message }),
      el('div', {}, 'NFC URL: ', el('code', { textContent: url })),
      el('div', { className: 'row' },
        btn(tv.hasToken ? 'Re-pair' : 'Pair', '', act(() => api(`/tvs/${tv.id}/pair`, 'POST', {}))),
        btn('Reconnect', 'sec', act(() => api(`/tvs/${tv.id}/reconnect`, 'POST', {}))),
        el('a', { className: 'btn sec', href: url, target: '_blank', rel: 'noopener', textContent: 'Open remote' }),
        btn('Copy URL', 'sec', act(() => navigator.clipboard.writeText(url))),
        btn(tv.enabled ? 'Disable' : 'Enable', 'sec', act(() => api(`/tvs/${tv.id}`, 'PATCH', { enabled: !tv.enabled }))),
        btn(tv.guestLevel === 'basic' ? 'Guests: extended' : 'Guests: basic', 'sec', act(() => api(`/tvs/${tv.id}`, 'PATCH', { guestLevel: tv.guestLevel === 'basic' ? 'extended' : 'basic' }))),
        btn('New URL', 'sec', act(async () => { if (confirm('Old NFC tags for this TV will stop working. Continue?')) await api(`/tvs/${tv.id}/rotate-url`, 'POST', {}); })),
        btn('Forget pairing', 'sec', act(() => api(`/tvs/${tv.id}/forget`, 'POST', {}))),
        btn('Delete', 'danger', act(async () => { if (confirm(`Delete ${tv.name}?`)) await api(`/tvs/${tv.id}`, 'DELETE'); }))),
      pairHelp);
  }

  const form = () => ({ name: $('aName').value, brand: $('aBrand').value, host: $('aHost').value, mac: $('aMac').value, guestLevel: $('aLevel').value, supportsArt: detected.frame });
  $('detect').onclick = async () => {
    $('addErr').textContent = ''; $('addInfo').textContent = 'Looking…';
    try {
      const { info } = await api('/probe', 'POST', { brand: $('aBrand').value, host: $('aHost').value });
      detected = info; if (info.wifiMac && !$('aMac').value) $('aMac').value = info.wifiMac.toLowerCase();
      if (info.name && !$('aName').value) $('aName').value = info.name.replace(/^\[TV\]\s*/, '');
      $('addInfo').textContent = `Found ${info.model || 'TV'}${info.frame ? ' (The Frame — Art Mode controls will be enabled)' : ''}.`;
    } catch (e) { $('addInfo').textContent = ''; $('addErr').textContent = e.message; }
  };
  $('add').onsubmit = async (e) => {
    e.preventDefault(); $('addErr').textContent = '';
    try { await api('/tvs', 'POST', form()); e.target.reset(); detected = { frame: false }; $('addInfo').textContent = 'Added. Now press "Pair" on its card.'; load(); }
    catch (err) { $('addErr').textContent = err.message; }
  };
  $('login').onsubmit = async (e) => {
    e.preventDefault(); $('loginErr').textContent = '';
    try { await api('/login', 'POST', { password: $('pw').value }); $('pw').value = ''; boot(); } catch (err) { $('loginErr').textContent = err.message; }
  };
  $('logout').onclick = async () => { await api('/logout', 'POST', {}); boot(); };
  boot();
})();
