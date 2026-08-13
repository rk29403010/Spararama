# Spararama Architecture

Spararama is split into separate local-control, backend telemetry, frontend, and Firebase concerns. Do not treat the browser Firebase session as the identity for the unattended backend collector.

## System overview

```text
                           +-------------------------------+
                           |        CleverSpa tub          |
                           |  real spa on local network    |
                           +---------------+---------------+
                                           |
                                           | LAN
                                           |
                    +----------------------v----------------------+
                    |     CleverSpa recovery bridge / API         |
                    |       localhost service (127.0.0.1:8787)    |
                    | exposes spa status + control endpoints      |
                    +----------------------+----------------------+
                                           |
                                           | localhost HTTP
                                           |
        +----------------------------------v----------------------------------+
        |                 Spararama always-on backend/logger                 |
        |                                                                     |
| - polls spa status at a backend-owned configurable interval       |
        | - appends local telemetry archive                                  |
        | - maintains pending Firebase upload queue                          |
        | - exposes API used by the frontend                                 |
        | - uploads telemetry with Firebase Admin credentials when enabled   |
        +----------------+-------------------------------+--------------------+
                         |                               |
                         | local files                   | Firebase Admin SDK
                         |                               |
                         v                               v
         +---------------------------+      +--------------------------------+
         | local telemetry archive   |      | Firestore / Firebase project   |
         | NDJSON + pending queue    |      | telemetry + user-facing data   |
         +---------------------------+      +---------------+----------------+
                                                            |
                                                            | Firebase client SDK
                                                            |
                                  +-------------------------v------------------------+
                                  |          Spararama frontend (browser)            |
                                  |                                                  |
                                  | - runs from Spararama local web server           |
                                  | - reachable from phone over the home LAN          |
                                  | - signs a human user in with Google/Firebase Auth|
                                  | - calls local Spararama API for live spa control |
                                  | - reads/writes user-owned Firestore data          |
                                  +-------------------------+------------------------+
                                                            |
                                                            | LAN
                                                            |
                                                 +----------v----------+
                                                 |  phone / PC browser |
                                                 +---------------------+
```

## Spa control path

The current real-spa path is:

```text
Browser -> Spararama API -> Recovery bridge -> CleverSpa LAN protocol -> Tub
```

The frontend must not talk directly to the recovery bridge. The recovery bridge can remain localhost-only. Spararama exposes the stable application-facing `/api/spa/...` interface.

The current adapter model also supports a mock adapter for development. Future tubs may have no network control at all, so vessel configuration distinguishes Wi-Fi-capable from non-networked tubs. A Wi-Fi-capable tub may also be temporarily unreachable; the UI must distinguish this from a tub that has no network capability.

## Always-on telemetry collector

The backend collector runs independently of any browser session. It polls whichever `SpaAdapter` is active, currently normally the recovery bridge, and records frequent samples.

The sampling interval is a backend-owned setting, defaults to five minutes, and is persisted locally so it remains effective with no browser open.

Typical spa fields include:

- water temperature
- target temperature
- heater state
- filter state
- bubbles state
- connection/transport state
- runtime counters
- changed fields
- timestamp, host ID, collector version

The telemetry schema also has room for later local sensor and weather observations.

Each sample is written locally before cloud upload:

```text
sample
  |
  +--> data/telemetry/telemetry.ndjson   (append-only archive)
  |
  +--> data/telemetry/pending.ndjson     (upload queue)
                     |
                     +--> Firebase when available
```

A Firebase/network outage must not create a telemetry hole. Successful cloud upload clears the pending copy but does not delete the local archive.

Firebase telemetry documents use the sample UUID as their document ID, so retrying an upload is idempotent.

## Firebase: two separate authentication models

### Frontend / human user

The browser uses the Firebase JavaScript client SDK.

Current client configuration is in `src/lib/firebase.ts` and targets:

- Firebase project: `microprojects-481213`
- Firestore database: `ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65`
- browser API key: `VITE_FIREBASE_API_KEY`
- human authentication: Google identity -> Firebase Auth

User-owned application logs are stored below paths such as:

```text
/users/{uid}/logs/{logId}
```

Firestore security rules apply to these browser/client requests. The authenticated Firebase user's UID determines which user-owned paths may be accessed.

The browser Firebase API key is normal Firebase web configuration. It is not an Admin credential and must not be used as backend authentication.

### Always-on backend / machine identity

The telemetry collector uses the Firebase Admin SDK in `server/telemetry/firebase-sink.ts`.

It is deliberately independent of the browser's Google/Firebase user session. The logger must continue running when:

- no browser is open
- the human user is signed out
- the phone is switched off
- the frontend auth token is refreshed or expires

The current backend configuration uses:

```text
FIREBASE_TELEMETRY_ENABLED=true
FIREBASE_PROJECT_ID=microprojects-481213
FIRESTORE_DATABASE_ID=ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65
```

`FirebaseTelemetrySink` initializes Firebase Admin with `applicationDefault()` and then explicitly opens the named Firestore database with:

```text
getFirestore(app, FIRESTORE_DATABASE_ID)
```

Therefore the local process needs valid Google Application Default Credentials. For a local unattended installation this will normally be provided by a service-account credential or another supported ADC mechanism. A browser `VITE_FIREBASE_API_KEY` is not sufficient.

The Admin SDK writes telemetry under:

```text
/telemetryCollectors/{hostId}/samples/{sampleId}
```

Admin SDK access is a privileged server path and is separate from the browser Firestore rules used for human-user data. Do not weaken browser Firestore rules to make backend telemetry work.

## Credential lifetime

Frontend Firebase Auth uses short-lived user tokens which the client SDK refreshes as part of the signed-in browser session. It is appropriate for interactive user access but is not suitable as the credential source for an always-on daemon.

The backend uses a machine/service identity. The Admin SDK obtains short-lived access tokens from its configured application credentials automatically. The underlying service-account credential remains usable until revoked/rotated or otherwise invalidated, so it is suitable for unattended operation. It must be kept outside Git and browser-delivered code.

## Critical Firebase consistency rule

The frontend and backend must agree on both:

1. Firebase project ID
2. Firestore database ID

Using the correct project but accidentally connecting the backend to `(default)` while the frontend uses the named database will appear superficially successful but put data in different databases.

When debugging Firebase, always print/verify the resolved project ID and database ID on both client and server sides.

## Local and cloud data roles

During development, Firebase is useful as a durable off-machine working dataset while the collector host may move between the laptop and a future headless box.

Current intended hierarchy:

```text
NOW
local NDJSON archive + retry queue
              |
              +--> Firebase working dataset

LATER
local SQLite/Postgres authoritative store
              |
              +--> optional Firebase sync / remote UI
```

The data model should therefore avoid making Firestore the core domain abstraction.

## Relevant source files

- `server.ts` - local Spararama server startup and APIs
- `server/spa/types.ts` - stable spa adapter interface
- `server/spa/recovery-bridge.ts` - adapter to the localhost CleverSpa recovery app
- `server/spa/mock.ts` - development mock
- `server/telemetry/collector.ts` - always-on polling/logger
- `server/telemetry/local-store.ts` - local archive and pending queue
- `server/telemetry/firebase-sink.ts` - Firebase Admin telemetry upload
- `src/lib/spaApi.ts` - frontend API client for live spa control
- `src/lib/firebase.ts` - browser Firebase/Auth client
- `firestore.rules` - browser/client Firestore authorization rules

## Design rules for future work

- The always-on backend must not depend on a human browser login.
- Never put service-account credentials, Admin credentials, or Gemini/API secrets in browser code or Git.
- Do not weaken Firestore client rules to fix Admin SDK authentication.
- Local telemetry must continue during cloud outages.
- UI state should distinguish: no remote capability, remote-capable but unreachable, and live/contactable.
- Keep spa hardware protocols behind `SpaAdapter`.
- Keep telemetry sinks replaceable so Firebase can later become optional sync rather than primary storage.
