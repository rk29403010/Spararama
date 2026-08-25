# Spararama architecture

Spararama is intended to work for different spas and pools, from fully manual water bodies to remotely controllable equipment. Hardware connectivity is optional: chemistry, maintenance, history and manual observations must remain useful when no controller exists or when a controller is temporarily unreachable.

## Repository layout

Spararama is a single repository containing separately deployable components:

```text
Spararama/
  src/                       React browser UI
  server/                    main Spararama API + telemetry collector
    spa/                     stable SpaAdapter boundary
    telemetry/               local archive, queue and cloud sinks
  services/
    cleverspa/               standalone CleverSpa/Gizwits adapter service
  scripts/                   local lifecycle/dev helpers
    termux/                  Android/Termux phone runner + installer
  docs/
    termux-phone.md          phone setup/operations guide
  test/                      main app tests
```

Keeping components in one repository is a source-control/developer-experience decision. It does **not** require them to run in one process or on one computer.

The former `spararama-cleverspa-recovery` repository supplied the CleverSpa/Gizwits implementation. Its live status/control core now lives under `services/cleverspa`. Keep the old repository archived as historical reference until the remaining recovery-only Wi-Fi reprovisioning tooling is deliberately re-homed or retired.

## System overview

```text
                         optional hardware adapter
                       +---------------------------+
                       | services/cleverspa :8787 |
                       | or another SpaAdapter     |
                       +-------------+-------------+
                                     |
                          local/LAN/API connection
                                     |
+--------------------+       +-------v--------------------------------+
| spa / pool hardware|<----->| Spararama always-on backend :3000      |
| (when supported)   |       |                                        |
+--------------------+       | - stable /api/spa interface            |
                             | - telemetry collector                   |
                             | - local durable archive + retry queue   |
                             | - Firebase Admin upload                 |
                             | - future weather/sensor adapters        |
                             +----------+------------------+-----------+
                                        |                  |
                                  local files        Firebase Admin
                                        |                  |
                                        v                  v
                                  local archive       Firestore
                                                           ^
                                                           |
                                                 Firebase client SDK
                                                           |
                             +-----------------------------+-----------+
                             | React frontend / phone / PC browser     |
                             | - live status/control when available    |
                             | - manual observations always available  |
                             | - chemistry, maintenance, history       |
                             | - human Google/Firebase login           |
                             +-----------------------------------------+
```

## A hardware connection is optional

Do not model "no controller" as an application error. There are three normal states:

1. **Manual-only water body** - no remote hardware integration exists. Users enter temperature/equipment observations themselves.
2. **Adapter configured but unreachable** - the spa/pool is normally connected but cannot currently be contacted. Live controls are disabled; manual observations remain available.
3. **Adapter live** - current sensor values and supported controls are available.

A fourth condition is also possible: an adapter is live but returns only a subset of fields. Missing measurements are `unknown`, not zero and not a reason to crash the UI.

Manual observations and automated telemetry are both observations of the same physical water body, but they must retain their source and timestamp. A manual reading must never be presented as if it were a current live sensor value.

The Home UI therefore always has a route to manual reporting. When remote control is unavailable, manual monitoring becomes the primary interaction rather than an error dead-end.

## SpaAdapter boundary

The main backend talks to hardware through `server/spa/types.ts`. Hardware-specific protocols stay outside the application/domain layer.

Current adapter modes include:

- `bridge` / `cleverspa` - HTTP adapter to `services/cleverspa`
- `manual` / `none` - no remote hardware; manual observations only
- `mock` - development/test simulation

Future adapters can represent another spa brand, pool controller, Home Assistant, MQTT, a vendor cloud API, Modbus, etc. The frontend should not need to know those protocols.

The current CleverSpa path is:

```text
Browser -> Spararama API -> SpaAdapter -> CleverSpa service -> Gizwits LAN -> tub
```

The CleverSpa service remains a separate process by design. It can later run:

- on the same laptop/headless box as Spararama;
- on another machine on the user's home LAN;
- as a small local agent while the main Spararama service is hosted elsewhere.

This separation is useful if Spararama is ever offered as a hosted service: internet-facing application code does not need direct access to a customer's private LAN or spa protocol.

## Deployment shapes

### Personal/local installation

```text
one machine
  Spararama backend :3000
  CleverSpa adapter :8787 (if required)
  browser(s) over LAN
  local telemetry archive
  optional Firebase sync
```

### Android phone / Termux development instance

A modern Android phone can run the normal Spararama Node/Vite development stack locally under Termux. This is a supported lightweight development/test deployment, particularly useful for phone UI work when a laptop is inconvenient.

```text
Android phone
  Termux
    ~/Spararama checkout (chatgpt-dev)
    pnpm dev / server.ts :3000
    SPA_ADAPTER=mock by default
    scripts/termux/spar lifecycle runner
           |
           +--> ~/.config/spararama/phone.conf
           +--> ~/.local/state/spararama-phone/server.pid
           +--> ~/.local/state/spararama-phone/server.log

  Chrome
    http://127.0.0.1:3000

  Android home-screen shortcut
    ~/.shortcuts/Spararama -> spar
```

This mode hosts both the React/Vite UI and Spararama Express API **on the phone itself**. Chrome connects over loopback; no laptop or LAN web server is required.

The installed command `$PREFIX/bin/spar` is intentionally a small stable wrapper. It loads the phone config and executes the current `scripts/termux/spar` from the checkout via a temporary copy. Consequently, improvements to the repo-owned runner arrive with the next normal Git pull without repeatedly reinstalling the command.

Normal `spar` behaviour is:

1. verify the checkout is clean;
2. fetch and fast-forward `chatgpt-dev`;
3. install dependencies only when the lock/package metadata changed or `node_modules` is missing;
4. **only after the update succeeds**, stop the previous phone server;
5. start `SPA_ADAPTER=mock pnpm dev` in a detached process session/group;
6. wait for `/api/health`, then re-check after a settling delay;
7. open `http://127.0.0.1:3000` in the Android browser.

The pull-before-stop ordering is deliberate: if GitHub is unavailable or the current network blocks it, the already-running version remains available.

The phone runner is separate from `scripts/local.mjs` on purpose. `scripts/local.mjs` is the general laptop/headless production-style lifecycle runner and may start the real CleverSpa service/build. `scripts/termux/spar` is the Android-specific development runner and defaults to `mock` for safety and portability.

Phone hosting does **not** magically provide remote access to the physical spa. Real spa control still requires the phone/backend to have network reachability to the home-side adapter/tub (for example by being on the home LAN or through a deliberately configured VPN/secure route). Away from home, the default phone setup should remain `SPA_ADAPTER=mock` unless that network path is intentionally configured.

Detailed installation, launcher and troubleshooting notes are in [`docs/termux-phone.md`](./docs/termux-phone.md).

### Split home installation

```text
always-on home node
  hardware adapter(s)
  local collector
        |
        +----> main Spararama backend/UI elsewhere on LAN
```

### Possible hosted service

```text
customer LAN                       hosted Spararama
local agent/adapter  <secure sync> backend + account + UI
      |
      +--> spa/pool
```

A hosted design must preserve local operation and avoid exposing spa control ports directly to the internet.

## Always-on telemetry collector

The collector is independent of any browser session. It polls the selected `SpaAdapter` at a backend-owned configurable interval and records samples locally before cloud upload.

Typical automated fields:

- water temperature
- target temperature
- heater/filter/bubbles state
- adapter connection/transport state
- runtime counters
- timestamp and host ID
- later local environmental sensors/weather observations

Disconnected/partial samples are legitimate data. Missing values remain missing so graphs show gaps rather than invented readings.

```text
sample
  +--> data/telemetry/telemetry.ndjson   append-only local archive
  +--> data/telemetry/pending.ndjson     retry queue
                     |
                     +--> Firebase when available
```

A network/Firebase outage must not create a telemetry hole. Successful cloud upload clears the queued copy, never the local archive. Sample UUIDs are used as document IDs so retries are idempotent.

Manual observations are event records rather than synthetic polling samples. Heating models may use them, but must account for their age/source/precision.

## Firebase identities are deliberately separate

### Browser / human identity

The browser uses Firebase's JavaScript client SDK and Google/Firebase Auth. It currently targets:

- project `microprojects-481213`
- named Firestore database `ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65`

User-owned application data lives under paths such as `/users/{uid}/logs/{logId}` and is subject to Firestore client security rules.

### Always-on backend / machine identity

The telemetry backend uses Firebase Admin / Application Default Credentials. It must continue working with no browser open and must never depend on the user's browser token.

Telemetry is written under:

```text
/telemetryCollectors/{hostId}/samples/{sampleId}
```

Frontend and backend must target both the same Firebase project **and the same named Firestore database**. Do not weaken browser rules to fix an Admin credential problem.

## Local and cloud data roles

Current development hierarchy:

```text
local NDJSON archive + retry queue
              |
              +--> Firebase working/off-machine dataset
```

Longer term:

```text
local SQLite/Postgres authoritative store
              |
              +--> optional cloud sync / hosted UI
```

Do not make Firestore-specific structures the core domain model.

## AI Studio / branches

`chatgpt-dev` is the active development/integration branch used by local development, ChatGPT and Codex.

`main` is retained as an AI-Studio-friendly integration/snapshot branch. AI Studio compatibility is a nice-to-have and must not force the runtime architecture or split the project into separate repositories.

## Design rules

- One repository, separately deployable components.
- Hardware connectivity is optional.
- Manual observations are first-class and always available.
- Distinguish manual-only, unreachable and live hardware states in UI and data.
- Missing data is unknown/null, never silently converted to zero.
- Hardware protocols stay behind `SpaAdapter`.
- The frontend talks to the Spararama API, not hardware adapters directly.
- The unattended backend does not depend on human browser authentication.
- Local telemetry survives cloud/network failure.
- Keep adapter and telemetry sinks replaceable so the project can support other spas/pools and different deployment models.
- The Android/Termux runner is a supported dev/test deployment and should remain safe-by-default (`mock`) unless real spa network reachability is deliberately configured.
