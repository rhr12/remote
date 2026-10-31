# Architecture

```
Phone (Safari/Chrome) ──HTTP──▶ Remote server (MacBook, Node) ──wss:8002──▶ Samsung TV
   NFC tag → /t/<slug>            LAN guard · rate limits · key allow-list      samsung.remote.control
                                  encrypted token store (data/)                 com.samsung.art-app
```

* `server/lan.js` – only private/loopback peers and LAN-style `Host` headers are served (blocks port-forwarding exposure and DNS rebinding). `X-Forwarded-For` is ignored.
* `server/keys.js` – the only key names a client can send. `basic` (guests) vs `extended` (per-TV opt-in, or admin).
* `server/drivers/` – one driver per brand (`start/pair/forget/reconnect/close/sendKey/art/status`). Add a brand by implementing that interface (see `mock.js`) and registering it in `drivers/index.js`.
* `server/tvs.js` – one driver per TV, token persistence on `token` events, guest-safe views (no host/MAC/token/id).
* `server/store.js` – `data/tvs.json` (0600) + AES-256-GCM encrypted tokens; key in `data/secret.key` (0600). `data/` is git-ignored.
* `server/auth.js` – scrypt-hashed admin password (set locally with `npm run set-admin`, never over the network), in-memory sessions, HttpOnly + SameSite=Strict cookie, `X-Remote-CSRF` header on writes, login lockout (8 / 15 min / IP).
* Guests never receive tokens, IPs or MACs and never choose protocol key codes.

## Samsung protocol (2023 The Frame, Tizen)

Based on Samsung's SmartView behaviour as implemented by community clients (`samsung-tv-ws-api`, `samsungtvws`). **Not yet verified against a real TV** — see README.

* Info: `GET http://<tv>:8001/api/v2/` (anonymous) → model, `FrameTVSupport`, Wi-Fi MAC.
* Remote channel: `wss://<tv>:8002/api/v2/channels/samsung.remote.control?name=<base64>[&token=…]`; self-signed cert (verification disabled for that one connection).
* No token → on-TV Allow/Deny prompt → `ms.channel.connect` carries `data.token`; stored and reused silently. Denial/timeouts: `ms.channel.unauthorized` / `ms.channel.timeOut`.
* Keys: `ms.remote.control`, `Cmd: Click`, `DataOfCmd: KEY_*`.
* Art Mode: `com.samsung.art-app` channel (`art_app_request`: `set_artmode_status` / `get_artmode_status`); fallback: hold `KEY_POWER` ~3 s to enter Art Mode, short press to leave.
* Wake from standby: Wake-on-LAN to the TV's MAC (depends on TV network-standby settings).
* SmartThings cannot be relied on to approve the prompt (it is a TV-side confirmation). Fallbacks: the TV's own bezel button/joystick, or the SmartThings phone app's remote screen to press **Allow**. A SmartThings cloud driver is *not* implemented but fits the driver interface.
