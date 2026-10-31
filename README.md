# Remote

A web-based universal TV remote for guests. Tap an NFC tag on a TV → a remote opens in the phone's browser → control the TV. No app, account, SmartThings or pairing on the guest's phone. Runs on a Mac on your home Wi-Fi. First supported TV: **Samsung 2023 The Frame** (Tizen). Other brands plug in via `server/drivers/`.

Features: Apple-style responsive UI (dark/light), swipe touchpad and D-pad, volume/mute/power/Home/Back/playback, Frame Art Mode, multiple TVs with one NFC URL each, guest levels (basic/extended), password-protected admin UI, automatic reconnect, clear status and error messages. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What is and isn't verified

| Area | Status |
|---|---|
| Server, API, validation, rate limits, LAN/Host guard, admin auth, encrypted token store | **Automated tests pass** (`npm test`, 17 tests) |
| Samsung protocol code (pairing, token reuse, key payloads, denied/timeout/stale token/offline) | Tested **against a fake TV** that I wrote from the documented protocol — **not against a real Frame** |
| Art Mode (art channel + long-press fallback), Wake-on-LAN, `:8001` detect | **Untested on hardware.** Depend on TV firmware/settings |
| UI | Rendered and exercised in headless Chromium (mock TV); **not tested on real phones or touch gestures**, NFC not tested |
| macOS launchd service | Written, **not run on macOS** |

Hardware-dependent limitations: the first pairing needs someone to press **Allow** on the TV (see below); power-on from standby needs Wake-on-LAN support enabled on the TV and may not work over Wi-Fi; Art Mode behaviour varies by firmware; Samsung may change the protocol; some TVs can't be woken at all when fully off.

## Setup on macOS (2018 MacBook Air)

1. Install Node 20+ (`brew install node`, or from nodejs.org).
2. `git clone https://github.com/rhr12/remote.git && cd remote && npm ci --omit=dev`
3. Set the admin password (stored hashed in `data/`, never in git): `npm run set-admin`
4. Test run: `npm start` → open the printed `http://<mac-ip>:3000/admin`.
5. Run permanently: `./scripts/install-launchd.sh`. It starts at login, restarts on crash (`KeepAlive`), and uses `caffeinate -s` to prevent sleep on AC power. Also: System Settings → Lock Screen / Battery → avoid sleeping on power adapter, enable auto-login for the user, and keep the Mac plugged in. Logs: `data/server.log`.
6. Give the Mac **and the TV** DHCP reservations in your router so addresses never change.
7. Allow incoming connections for `node` if macOS prompts. **Do not port-forward** this to the internet; the server also refuses non-LAN clients.

Optional env vars: `PORT`, `HOST`, `ALLOWED_NETS` (extra CIDRs), `ALLOWED_HOSTS` (extra Host names, e.g. `macbook.local`), `REMOTE_DATA_DIR`.

## Pairing the Samsung Frame (no physical remote)

1. TV on, on the same Wi-Fi. TV Settings → General → Network → Expert Settings → *Power On with Mobile* **on** (for wake-up).
2. Admin → *Add a TV*: enter its IP, press **Detect TV** (reads model/MAC; enables Art controls on a Frame), then **Add TV**.
3. Press **Pair** on the TV's card. An **Allow / Deny** prompt appears on the TV for ~30–45 s.
4. Approve it **on the TV**. SmartThings can't approve this prompt remotely. Without a Samsung remote you can:
   * use the TV's own button/joystick (underside or back of the bezel) to select **Allow**; or
   * open the **SmartThings phone app** → the TV → its remote/D-pad (this is a separate, already-trusted controller) and press OK on the prompt.
5. If no prompt appears: TV → Settings → General → External Device Manager → Device Connection Manager → *Access Notification* → "First Time Only"/"Every Time"; remove stale "Remote" entries in the Device List; retry **Pair**.
6. Status turns **Connected**; the token is saved encrypted and reused automatically (including after restarts). **Forget pairing** removes it.

## NFC tags

1. Admin card → **Copy URL** (`http://<mac>:3000/t/<slug>`). Prefer the Mac's reserved IP; `http://<name>.local:3000` works on iOS, usually on modern Android.
2. Write it as a **URL/URI record** with any NFC writer app (e.g. NFC Tools) onto an NTAG213/215 sticker. Stick it on/near the TV.
3. iPhones (XS+) and Android read tags in the background. Guests must be on your Wi-Fi.
4. Lost or leaked tag? **New URL** on the card invalidates the old one. (The slug is a locator, not a secret; real protection is the LAN restriction.)

## Adding more TVs

Admin → *Add a TV* again (each gets its own URL, token and guest level). For a new brand, implement the driver interface (`server/drivers/mock.js` shows the shape), register it in `server/drivers/index.js`, and add a protocol test like `test/samsung.test.js`.

## Security notes

* LAN only: private/loopback peers and LAN `Host` names only; plain HTTP (no TLS) is used on the home network, so the admin password travels unencrypted on your Wi-Fi — use a strong unique password and a trusted network.
* Guests: fixed key whitelist, JSON-only, rate limited; no tokens/IPs/MACs exposed. Admin: scrypt password, lockout, HttpOnly SameSite=Strict cookie + CSRF header. Static serving only from `public/`.
* `data/` (tokens, key, admin hash) is git-ignored. Never commit it.
* Guests on your Wi-Fi who are determined can still send many allowed button presses within rate limits; use *Disable* on a TV to switch it off.

## Development

`npm test` · `npm run dev` (adds a *Mock TV* brand, no hardware needed).
