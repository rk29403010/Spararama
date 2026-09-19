# Reference cloud deployment

This is the operational deployment guide for the Firebase/Cloud Run remote-control reference implementation.

The design deliberately keeps the house private:

```text
Hosted browser
    |
    | HTTPS + Firebase user token
    v
Firebase Hosting
    |
    | /api/** rewrite
    v
Cloud Run: spararama-cloud-control
    |
    | Firestore command/state documents
    v
Firebase / Firestore
    ^
    | outbound listener only
    |
Home Spararama node -> local SpaAdapter -> spa
```

No Spararama port is forwarded through the home router.

## Reference managed services

The checked-in `firebase.json` uses these reference names:

- Cloud Run service: `spararama-cloud-control`
- Cloud Run region: `europe-west2`
- hosted web output: `dist/cloud-web`

They are defaults for the reference deployment, not requirements of the core remote transport.

## 1. Build the public control API container

The API has a dedicated container definition:

```text
services/cloud/Dockerfile
```

Build from the repository root so the Dockerfile can copy the shared server code.

For Cloud Run, use a dedicated runtime service account with only the Firebase/Firestore permissions the control API needs. Do not put a downloaded Firebase Admin JSON credential into the image.

Required runtime configuration:

```env
FIREBASE_PROJECT_ID="<firebase-project>"
FIRESTORE_DATABASE_ID="<named-firestore-database>"
REMOTE_CLOUD_COMMANDS_PER_MINUTE="30"
REMOTE_CLOUD_STALE_AFTER_MS="90000"
REMOTE_CLOUD_OFFLINE_AFTER_MS="300000"
```

The Cloud Run service must accept public HTTPS requests at the platform edge because the application performs Firebase ID-token authentication itself. The control endpoints still require an authenticated installation member.

## 2. Build the hosted browser

The browser build is separate from the local/LAN build:

```bash
pnpm cloud:web:build
```

It writes only static browser files to:

```text
dist/cloud-web
```

The build automatically sets:

```env
VITE_SPARARAMA_RUNTIME="cloud"
```

Provide the browser Firebase values in the build environment:

```env
VITE_FIREBASE_API_KEY="..."
VITE_FIREBASE_PROJECT_ID="..."
VITE_FIREBASE_APP_ID="..."
VITE_FIREBASE_MESSAGING_SENDER_ID="..."
VITE_FIREBASE_AUTH_DOMAIN="..."
VITE_FIRESTORE_DATABASE_ID="..."
VITE_GOOGLE_CLIENT_ID="..."
```

The repository contains backward-compatible defaults for the original development Firebase project, but a fresh deployment should provide its own complete browser configuration.

The browser contains no Firebase Admin/service-account credential.

## 3. Firebase Hosting

The checked-in Hosting configuration:

- serves `dist/cloud-web`;
- rewrites `/api/**` to the Cloud Run service;
- falls back to `index.html` for the React application.

That makes the browser/API path same-origin, so normal deployments do not need a permissive CORS configuration.

Before deploying a new Firebase project, make sure the Hosting site and Google/Firebase authentication configuration use the same project as the Cloud Run service and named Firestore database.

## 4. Firestore indexes/rules

`firebase.json` includes the named-database index and rules configuration.

The browser Firestore rules deliberately deny direct access to `/installations/**`. Remote installation state and command creation go through the authenticated Cloud Run API.

The Cloud Run service and home agent use server credentials, so client Firestore rules are not weakened for them.

## 5. Bootstrap installation membership

On an administration machine with Firebase Admin credentials:

```bash
pnpm remote:membership -- bootstrap home-spa FIREBASE_UID "Home hot tub"
```

Add the other household account if required:

```bash
pnpm remote:membership -- add home-spa SECOND_FIREBASE_UID member
```

Roles:

```text
owner   read + control
member  read + control
viewer  read only
```

## 6. Enable the home node

Only after the cloud API, Firestore configuration and membership exist, set on the always-on home Spararama node:

```env
REMOTE_TRANSPORT="firebase"
REMOTE_INSTALLATION_ID="home-spa"
REMOTE_STATE_DIR="./data/remote"
REMOTE_HEARTBEAT_SECONDS="30"
REMOTE_COMMAND_LEASE_MS="60000"
```

Keep its existing Firebase Admin/Application Default Credential outside the repository.

Restart Spararama and check `/api/health`. The `remote` block should report the Firebase transport started/connected.

## 7. First end-to-end test

Do not begin by switching equipment.

Run the read-only diagnostic from an Admin-capable development machine:

```bash
pnpm remote:diagnose
```

Expected path:

```text
diagnostic command
 -> Firestore
 -> home outbound listener
 -> RemoteCommandExecutor
 -> SpaAdapter readStatus
 -> durable local command ledger
 -> Firestore acknowledgement
```

Only after that succeeds should remote heater/filter/bubble/target controls be exercised.

## 8. Hosted UI behaviour

The cloud build intentionally differs from the LAN build.

It currently provides:

- Google/Firebase sign-in;
- installation selection when an account can access more than one;
- fresh / stale / offline state;
- current/last-known water and target temperatures;
- heater/filter/bubble status;
- current heating plan summary;
- immediate heater/filter/bubble/target controls for owner/member roles;
- ready-by scheduling through the shared backend heating planner;
- controls disabled when the home agent/spa state is not fresh;
- read-only behaviour for viewer roles.

The local build remains the full poolside application, including chemistry workflows and the BLE-C600 meter. The Bluetooth meter does not need to be moved through the cloud control plane: it is a browser-local sensor used beside the spa. The cloud architecture must not discard or reinterpret its raw/derived measurement provenance when those records are later synchronised.

## 9. Google sign-in deployment requirement

The deployed Hosting origin must be authorised for the Google OAuth client/Firebase Auth configuration. If the Google sign-in button renders but authentication fails on the hosted URL, check the Firebase Authentication authorised domains and the OAuth client's authorised JavaScript origins before changing application code.

## 10. Failure interpretation

```text
Hosted UI says Offline
  -> check home node /api/health remote block
  -> check internet/Firebase reachability from home
  -> check REMOTE_TRANSPORT and REMOTE_INSTALLATION_ID

Hosted UI says Last known
  -> state exists but heartbeat is stale
  -> do not treat displayed equipment state as current

Agent online, spa unavailable
  -> cloud path is working
  -> diagnose local SpaAdapter/CleverSpa path

401 from cloud API
  -> browser ID token missing/invalid
  -> sign in again / check Firebase Auth project

403 from cloud API
  -> valid user but no installation membership, or viewer attempted control

Command expires
  -> home agent did not claim/execute in time
  -> no late physical action should occur

Local internet/Firebase outage
  -> local UI, schedules and spa control continue
  -> remote UI becomes stale/offline
```

## Not yet automated here

Actual creation of the user's Cloud Run service account, IAM grants, Cloud Run deployment, Firebase Hosting site, OAuth-origin configuration and production smoke test require authenticated access to the user's Google/Firebase project. Those are deployment operations rather than source-code changes and should be performed from a credentialled Codex/terminal session or manually with the relevant CLIs.


## Alexa migration

The source now contains a stable cloud Alexa path at:

```text
POST /api/integrations/alexa
```

It is disabled by default. Do not enable it until normal browser remote status/control has passed real end-to-end testing.

Cloud Run settings:

```env
ALEXA_CLOUD_ENABLED="true"
ALEXA_CLOUD_INSTALLATION_ID="home-spa"
ALEXA_CLOUD_INTEGRATION_SECRET="<long random secret>"
ALEXA_SKILL_ID="<skill id>"
SPARARAMA_TIME_ZONE="Europe/London"
```

Prefer injecting `ALEXA_CLOUD_INTEGRATION_SECRET` from the managed secret store rather than committing it or baking it into an image.

Lambda settings for the stable path:

```env
SPARARAMA_ALEXA_CLOUD_URL="https://<host>/api/integrations/alexa"
SPARARAMA_ALEXA_INTEGRATION_SECRET="<same secret>"
ALEXA_SKILL_ID="<skill id>"
LWA_CLIENT_ID="<LWA client id>"
```

The Lambda prefers the cloud URL when configured and keeps the temporary `SPARARAMA_ALEXA_URL` tunnel path as a fallback. Ready-by Alexa requests are converted to the typed `scheduleReadyAt` command and use the same provider-neutral heating planner as the hosted UI/local backend.
