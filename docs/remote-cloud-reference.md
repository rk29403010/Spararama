# Firebase reference remote control plane

Status: **Managed cloud deployment is live and the A71 outbound agent/read-only round trip are verified. Physical remote-control, mobile-data and viewer-role validation remain.**

This is the reference remote-access implementation described by
[remote-access-cloud-architecture.md](remote-access-cloud-architecture.md). It is intentionally optional. A normal local Spararama installation still defaults to:

```env
REMOTE_TRANSPORT="none"
```

and has no cloud-control dependency.

## What exists now

### Local agent

The always-on Spararama backend can be configured with:

```env
REMOTE_TRANSPORT="firebase"
REMOTE_INSTALLATION_ID="home-spa"
```

It then uses the existing Firebase Admin/Application Default Credential to establish an **outbound-only** Firestore control channel.

No inbound home port, DDNS hostname or public home IP is required.

The local path is:

```text
Firestore command
    |
    v
FirebaseRemoteTransport
    |
    v
RemoteCommandExecutor
    |
    +--> SpaAdapter
    +--> BubbleSessionManager
    +--> HeatingScheduler
```

The local executor understands this compatibility allowlist:

```text
readStatus
setTargetTemperature
setHeater
setFilter
setBubbles
scheduleReadyAt
createHeatingSchedule
```

The **public cloud API advertises/accepts only the first six high-level operations through `scheduleReadyAt`**. `createHeatingSchedule` remains an internal compatibility command so cloud clients cannot supply scheduler-internal start temperatures, start times or auto-start policy.

Commands have server-assigned IDs/timestamps and short expiries. The local executor also maintains a durable recent-command ledger under `REMOTE_STATE_DIR` so redelivery after a network/process interruption does not blindly repeat an already-recorded side effect.

Ready-by requests use the provider-neutral `HeatingPlanner.scheduleReadyAt` path rather than asking a cloud/browser client to calculate heater start time. Remote ready-at schedules use a deterministic command-derived schedule ID as an additional replay safeguard.

### Presence/current-state publication

The local agent periodically publishes:

```text
/installations/{installationId}/runtime/current
```

with heartbeat/presence and a compact current-state snapshot.

This is deliberately not the telemetry archive. Raw/historical telemetry remains in the existing local-first telemetry path.

### Cloud control service

A separately deployable Node/Express service now lives at:

```text
services/cloud/server.ts
```

It exposes:

```text
GET  /health
GET  /api/installations
GET  /api/installations/:installationId/state
POST /api/installations/:installationId/commands
GET  /api/installations/:installationId/commands/:commandId
```

Human API requests use:

```text
Authorization: Bearer <Firebase ID token>
```

The service verifies the token with Firebase Admin, checks installation membership, validates the command allowlist/payload, assigns the authoritative command ID/creation/expiry values and writes the command to Firestore.

The public browser does **not** need or receive Firebase Admin credentials.

### Roles

Membership documents live at:

```text
/installations/{installationId}/members/{uid}
```

with one of:

```text
owner   read + control
member  read + control
viewer  read only
```

A collection-group index on `members.uid` supports installation discovery for a signed-in user.

Direct browser access to `/installations/**` remains denied by the Firestore client rules. The public control API is the authorization/validation boundary.

## Firestore shape

Current reference documents:

```text
/installations/{installationId}
  schemaVersion
  name
  createdAt / updatedAt

/installations/{installationId}/members/{uid}
  uid
  role
  addedAt / updatedAt

/installations/{installationId}/commands/{commandId}
  version
  commandId
  installationId
  type
  payload
  createdAt
  expiresAt
  requestedBy
  status
  claim/lease fields while executing
  terminal result/status

/installations/{installationId}/runtime/current
  heartbeat/presence
  latest compact state snapshot
```

The home agent listens outbound for commands. Claim leases are recoverable after an interrupted worker. The command executor's local ledger is the second line of replay protection.

## Configuration

### Home/local node

Uses the same Firebase Admin target already used by telemetry:

```env
FIREBASE_PROJECT_ID="..."
FIRESTORE_DATABASE_ID="..."
GOOGLE_APPLICATION_CREDENTIALS="/safe/path/firebase-admin.json"

REMOTE_TRANSPORT="firebase"
REMOTE_INSTALLATION_ID="home-spa"
REMOTE_STATE_DIR="./data/remote"
REMOTE_HEARTBEAT_SECONDS="30"
REMOTE_COMMAND_LEASE_MS="60000"
```

If `REMOTE_TRANSPORT=firebase` is set without an installation ID, Spararama deliberately falls back to remote-disabled mode and logs a warning.

### Public cloud service

The cloud service uses the same project/database selection mechanism, but its production credential should come from its cloud runtime/service identity rather than a JSON file copied into an image.

Optional settings:

```env
REMOTE_CLOUD_COMMANDS_PER_MINUTE="30"
REMOTE_CLOUD_STALE_AFTER_MS="90000"
REMOTE_CLOUD_OFFLINE_AFTER_MS="300000"
SPARARAMA_CLOUD_ALLOWED_ORIGINS=""
```

Same-origin hosting/proxying is preferred. `SPARARAMA_CLOUD_ALLOWED_ORIGINS` exists for deliberate cross-origin development/deployment.

The current in-process rate limiter is defence-in-depth suitable for the private/reference deployment. A future multi-instance hosted service should use shared rate limiting/API abuse controls.

## Create the first installation membership

With Firebase Admin credentials available on an administration/development machine:

```bash
pnpm remote:membership -- bootstrap home-spa FIREBASE_UID "Home hot tub"
```

Add a second household member:

```bash
pnpm remote:membership -- add home-spa SECOND_UID member
```

Read-only:

```bash
pnpm remote:membership -- add home-spa UID viewer
```

Remove:

```bash
pnpm remote:membership -- remove home-spa UID
```

These commands manipulate membership using Admin credentials. They never place a UID or household identity in application source.

## Local-agent diagnostic

After the always-on node has the Firebase transport enabled, an Admin-capable machine can queue a safe read-only round trip:

```bash
pnpm remote:diagnose
```

It creates a short-lived `readStatus` command, waits for the local agent's result, prints the result and removes the diagnostic command.

This is the preferred first end-to-end test because it proves:

```text
Firestore -> outbound home agent -> local command executor -> SpaAdapter status
          -> command acknowledgement -> Firestore
```

without switching any equipment.

## Cloud service local development

With Firebase Admin credentials configured:

```bash
pnpm cloud:dev
```

Default:

```text
http://0.0.0.0:8080
```

Build:

```bash
pnpm cloud:build
```

Run built artifact:

```bash
pnpm cloud:start
```

The normal repository `pnpm build` also builds the cloud service so CI checks that the deployable entry point continues to compile.

## Security boundary

The reference design deliberately does **not**:

- expose the home backend or CleverSpa adapter to the public internet;
- accept arbitrary URLs, HTTP proxy instructions or shell commands from Firestore;
- let the browser create Firestore control documents directly;
- put service-account credentials in the browser;
- use Alexa's temporary tunnel as the permanent path;
- make local spa control depend on Firebase being reachable.

Both cloud and local boundaries validate command data. The local node remains the final authority for hardware reachability and safety/application rules.

## Hosted browser

The source now includes a dedicated hosted-browser runtime and build:

```bash
pnpm cloud:web:build
```

The hosted shell uses Firebase human sign-in, lists only installations the user can access, and reads current state through the authenticated control API. It explicitly distinguishes fresh, stale and offline state.

For `owner` and `member` roles, target-temperature and heater/filter/bubble controls are enabled only while the home agent and spa are fresh/live. `viewer` remains read-only. Commands use the same expiring/idempotent cloud queue and local executor as every other remote caller.

The local/LAN build remains the full poolside application. In particular the BLE-C600 meter stays browser-local beside the spa; it is not proxied through the cloud control plane.

## Verified deployment state

The reference deployment is live:

- Firebase Hosting is serving the hosted Spararama UI.
- Cloud Run is serving the authenticated control API.
- Firestore rules/indexes are deployed to the named database.
- Google sign-in and installation membership are working.
- The A71 is running `REMOTE_TRANSPORT=firebase` for installation `home-spa`.
- The home agent has published live state and reconnected after a deliberate backend stop/restart.
- The read-only `remote:diagnose` round trip has completed successfully.
- Local live spa operation, telemetry, and phone-local `http://localhost:3000` remain healthy.
- BLE-C600 decoder tests continue to pass.

## Still to validate

The remaining sequence is:

1. verify the hosted signed-in UI shows the live A71 state and the stale/offline transitions honestly;
2. issue owner/member physical commands through the hosted UI one at a time and verify cloud result, local status and actual spa state agree;
3. validate `scheduleReadyAt`, deterministic replay/idempotency, and cancellation/cleanup of a test schedule;
4. verify the hosted path over mobile data;
5. verify viewer-role server-side and UI read-only enforcement;
6. migrate Alexa Lambda from the temporary tunnel to the cloud control path;
7. add further deployment automation only where the real deployment showed value;
8. prove the provider boundary with a small self-hosted alternative after the Firebase path is stable.

See [cloud-deployment.md](cloud-deployment.md) for the deployment/operations path.
