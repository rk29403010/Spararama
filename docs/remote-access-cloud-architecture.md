# Spararama remote access and cloud control architecture

Status: **proposed architecture and implementation plan**. This document describes the intended direction; it does not imply that the cloud path has already been implemented.

Spararama must remain useful as a local application even when there is no internet connection, no cloud account, or no remotely controllable spa. Remote access is an additional capability, not a replacement for the local backend, `SpaAdapter`, telemetry archive or hardware services.

Related documents:

- [`../architecture.md`](../architecture.md) - current overall architecture and invariants.
- [`termux-phone.md`](termux-phone.md) - Android/Termux runner.
- [`old-phone-server.md`](old-phone-server.md) - unattended old-phone host, including optional local HTTPS.
- [`alexa-direct.md`](alexa-direct.md) - current Alexa proof-of-concept and temporary tunnel path.

---

## 1. Overview

The long-term remote-access design is **outbound-only from the home installation**.

Nothing on the public internet should need to open a connection directly to the A71/A17, home server, CleverSpa adapter or home router. The local Spararama node establishes an outbound authenticated connection to a small cloud control plane. Browsers and integrations such as Alexa talk to that cloud control plane over normal public HTTPS.

```text
                                   Internet
                                      |
                   +------------------+------------------+
                   |                                     |
             Browser / phone                       Alexa / AWS
             hosted web UI                            Lambda
                   |                                     |
                   +--------------- HTTPS ---------------+
                                      |
                                      v
                         +-------------------------+
                         | Spararama cloud plane   |
                         |                         |
                         | - hosted web assets     |
                         | - human authentication  |
                         | - installation access   |
                         | - command API / queue   |
                         | - current state cache   |
                         | - audit / command state |
                         +------------+------------+
                                      ^
                                      |
                         outbound authenticated TLS
                                      |
                                      v
                        +---------------------------+
                        | local Spararama node      |
                        | A71 / A17 / Pi / PC / NAS |
                        |                           |
                        | backend :3000             |
                        | remote transport agent    |
                        +-------------+-------------+
                                      |
                              local SpaAdapter
                                      |
                                      v
                        +---------------------------+
                        | hardware adapter :8787    |
                        | CleverSpa or future type  |
                        +-------------+-------------+
                                      |
                                      v
                                    spa
```

The important architectural boundary is that the cloud sends **semantic Spararama commands**, not arbitrary HTTP requests and not hardware-protocol messages. The local node remains the authority that executes those commands through the same scheduling, validation and `SpaAdapter` layers used by local control.

This gives Spararama four useful deployment shapes without making any one of them mandatory:

1. **Local only** - no cloud connection at all. The browser talks directly to the local backend and everything that can work locally continues to work.
2. **Firebase reference deployment** - the easiest supported remote setup: hosted HTTPS UI, Firebase Auth, a small cloud command service and a Firestore-backed transport.
3. **Self-hosted remote deployment** - the same transport contract implemented by a user's own publicly reachable server/VPS/service.
4. **Hosted-service deployment** - a future multi-installation Spararama service can use the same boundaries with stronger per-installation device identity and onboarding.

The Firebase implementation is therefore the **reference provider**, not the core domain model.

---

## 2. Why this direction

### 2.1 No inbound home connection

The preferred design does not require:

- router port forwarding;
- a public IPv4 address;
- avoiding CGNAT;
- a stable home public IP;
- DDNS;
- punching a hole through a replacement ISP router;
- exposing Spararama port 3000, Termux SSH port 8022 or CleverSpa port 8787 to the internet.

Changing ISP, changing from the current router to a Sky router, or replacing indoor/outdoor Wi-Fi equipment should not alter the remote-control architecture. The local node only needs normal outbound HTTPS/TLS access and LAN access to the hardware it controls.

### 2.2 Proper HTTPS and browser authentication

A hosted frontend can be served from a normal trusted HTTPS origin such as Firebase Hosting's managed hostname. Google/Firebase sign-in can therefore use a genuine secure browser origin without requiring a certificate, public domain or local CA on every client device.

Optional Caddy HTTPS on the local Termux host remains useful for people who want HTTPS on their LAN. It is no longer a prerequisite for remote access or Google sign-in.

### 2.3 Alexa gets a permanent endpoint

The current Alexa proof uses a temporary reverse tunnel so AWS Lambda can reach an Alexa-only local proxy. That is appropriate for proving the skill, but it should not become the permanent architecture.

The permanent route becomes:

```text
Alexa -> AWS Lambda -> Spararama cloud command API -> outbound-connected local node
                                                        |
                                                        v
                                                normal command layer
                                                        |
                                                        v
                                                    SpaAdapter
```

Lambda never needs the home's IP address and the home router never needs an inbound rule.

### 2.4 Public open-source project

Spararama must not assume one owner's router, Firebase project, domain, phone model or cloud account. Provider-specific code belongs behind explicit boundaries and configuration.

A user should be able to run:

```text
REMOTE_TRANSPORT=none
```

and have a fully useful local installation, or configure the reference Firebase transport, or later choose a compatible self-hosted transport.

---

## 3. Core design principles

### Local operation is authoritative

The local backend owns real-time hardware control. Cloud state is a synchronised representation of the installation, not a substitute for the physical controller.

If the internet fails:

- local browser control continues;
- the CleverSpa adapter continues;
- already-created local schedules continue;
- telemetry continues writing locally;
- remote commands cannot arrive and must not be fabricated;
- cloud clients must show that the installation is stale/offline rather than displaying old state as live.

### Remote control uses the normal command path

Do not build a second set of spa-control rules in Firebase, Lambda or the hosted frontend.

A remote request must enter the same application/domain services as a local request. Existing safeguards such as heating scheduling, bubble cooldown handling, supported-capability checks and future interlocks therefore apply regardless of origin.

### No arbitrary remote execution

The cloud transport must never become a generic remote HTTP proxy or shell channel.

Allowed commands are typed domain operations such as:

```text
readStatus
setTargetTemperature
setHeater
setFilter
setBubbles
scheduleReadyAt
cancelHeatingSchedule
```

The exact initial command set should be derived from the existing command/services layer during implementation. Unsupported or malformed commands are rejected locally even if they somehow reach the queue.

### Delivery is at-least-once; execution is idempotent

Networked message delivery should assume duplicates, retries, delayed acknowledgements and reconnects.

Each command therefore has a unique ID/idempotency key. The local node records the execution result and must not perform the same physical side effect twice merely because a message was redelivered.

### Commands expire

A command to turn the heater on must not sit in a queue during an outage and unexpectedly execute six hours later.

Every remote command has a creation time and expiry time. The local node rejects expired work. The caller receives or observes an explicit `expired`/`offline` result rather than silent execution later.

### Cloud outages do not create local telemetry holes

The existing local-first telemetry invariant remains unchanged. Remote-control work must not turn Firebase into the authoritative telemetry store.

### Provider-specific structures do not become domain objects

Firestore document shapes, Firebase callable functions and AWS Lambda event formats are adapters around Spararama models, not those models themselves.

---

## 4. Main components

## 4.1 Local Spararama node

The local node may be the current Android/Termux phone, a Raspberry Pi, a mini PC, a NAS/container or an ordinary computer.

It continues to run:

```text
Spararama backend
SpaAdapter
hardware adapter(s), where required
telemetry collector/local archive
local scheduling
RemoteTransport agent, when configured
```

The remote agent lives with the backend because the backend already owns the domain services needed to execute commands safely.

The agent must not require a browser session or human Firebase token.

## 4.2 Hosted web UI

The reference deployment serves the browser application from managed HTTPS hosting.

For Firebase this means Firebase Hosting initially. The same React application should be capable of running in two contexts:

```text
Local/direct mode
browser -> local Spararama backend

Remote/hosted mode
browser -> cloud API/state -> local node through RemoteTransport
```

Do not duplicate the UI into a separate "cloud app". Backend access should be abstracted sufficiently that views can consume an installation state/control interface rather than assuming `window.location` always points at the machine controlling the spa.

A later optimisation may allow a browser on the home LAN to prefer a direct local connection while retaining the hosted identity/session, but that is not required for the first remote release.

## 4.3 Cloud command service

The cloud service is deliberately small. It is not a second Spararama backend.

Its responsibilities are:

- authenticate the caller;
- resolve which Spararama installation the caller may access;
- validate command envelope/type at the cloud boundary;
- create commands in the provider transport;
- expose command progress/results;
- expose a current/stale installation snapshot for remote UI and integrations;
- accept Alexa requests through a dedicated authenticated integration boundary;
- maintain audit metadata useful for debugging/security.

It must not contain CleverSpa protocol code or bypass the local application's command/scheduler services.

For the reference Firebase implementation, this can be implemented with Firebase Hosting + Firebase Auth + Firestore + a minimal server-side function/API layer. Cloud Functions or Cloud Run may be used according to what best matches the repository and cost/operational needs at implementation time.

## 4.4 `RemoteTransport`

Introduce a provider-neutral backend boundary, conceptually similar to:

```ts
interface RemoteTransport {
  start(handlers: RemoteTransportHandlers): Promise<void>;
  stop(): Promise<void>;
  publishPresence(presence: InstallationPresence): Promise<void>;
  publishState(state: RemoteInstallationState): Promise<void>;
  acknowledgeCommand(result: RemoteCommandResult): Promise<void>;
}
```

The exact TypeScript surface should be designed from the existing backend rather than copied literally from this example.

Expected implementations:

```text
NoneRemoteTransport
FirebaseRemoteTransport
InMemoryRemoteTransport          # tests/development
future SelfHostedRemoteTransport
future MQTT/WebSocket transport  # only if useful
```

Command delivery should be callback/stream based from the perspective of the application even if a particular provider internally polls.

The rest of Spararama should not import Firestore APIs merely to receive a spa command.

---

## 5. Remote command model

A provider-neutral command envelope should contain enough information to make retries and auditing safe.

Illustrative model:

```json
{
  "version": 1,
  "commandId": "uuid",
  "installationId": "home-spa",
  "type": "setTargetTemperature",
  "payload": {
    "temperatureC": 38
  },
  "createdAt": "2026-09-17T20:00:00Z",
  "expiresAt": "2026-09-17T20:00:30Z",
  "requestedBy": {
    "kind": "user",
    "id": "uid-or-cloud-principal"
  }
}
```

Execution result:

```json
{
  "commandId": "uuid",
  "status": "succeeded",
  "acceptedAt": "...",
  "completedAt": "...",
  "result": {
    "targetTemperatureC": 38
  }
}
```

Suggested lifecycle:

```text
queued
  -> claimed
  -> executing
  -> succeeded
             \-> failed
             \-> expired
             \-> cancelled (where meaningful)
```

The transport should tolerate a node disappearing after `claimed`. Claims/leases must eventually become recoverable so reconnecting does not permanently strand commands.

The executor must maintain a small durable recent-command ledger locally so an Android/process restart does not erase idempotency knowledge immediately.

Do not use cloud timestamps alone to decide physical reality. The command result is an execution record; the subsequently published equipment state remains the source for what the local node currently observes.

---

## 6. Installation state, presence and staleness

Remote browsers and Alexa need a fast way to answer questions without directly opening a connection into the home.

The local node therefore publishes a compact **installation snapshot** whenever meaningful state changes, plus a periodic heartbeat.

A snapshot may contain:

```text
installation ID
timestamp / observedAt
adapter connectivity
water temperature + source/timestamp
target temperature
heater/filter/bubbles state
active heating schedule summary
selected high-value sensor/weather status
capabilities
backend/app version
```

This is not a replacement for raw telemetry history. It is a current-state cache.

Remote consumers must use explicit freshness rules:

```text
fresh     -> recent heartbeat/state, normal remote controls
stale     -> show last known values with age; be cautious with control
offline   -> no recent heartbeat; do not present last state as current
```

The initial thresholds should be configurable and chosen alongside the existing telemetry interval rather than hard-coded in several clients.

A command may still be queued during a very brief reconnect window, but commands with physical side effects must have short expiries by default.

---

## 7. Firebase reference data shape

The exact Firestore layout should be validated against rules/index/cost requirements before implementation. A likely provider mapping is:

```text
/installations/{installationId}
  metadata / owner-facing name / provider schema version

/installations/{installationId}/members/{uid}
  role

/installations/{installationId}/commands/{commandId}
  command envelope + status/result

/installations/{installationId}/runtime/current
  latest state snapshot / heartbeat

/installations/{installationId}/audit/{eventId}
  optional security/control audit events
```

Existing automated telemetry paths do not need to be moved merely to fit this layout. The new control-plane data should coexist with the current local telemetry archive and Firebase telemetry sink.

Old completed commands should be pruned/TTL'd rather than retained forever as an accidental high-volume event store. If long-term control history is valuable, write a deliberate compact audit/event representation instead of keeping every transport detail indefinitely.

---

## 8. Identity and authorisation

There are three deliberately different identities.

### 8.1 Human browser identity

The hosted browser uses Firebase Auth in the reference implementation.

A signed-in user may only see/control installations for which they have membership. Do not assume one UID forever: a household needs at least owner/member-style access so two people can use the same spa without sharing a browser account.

A simple initial role model is:

```text
owner   - configure installation membership and control the spa
member  - normal read/control access
viewer  - read-only, optional later
```

The first implementation does not need a complex enterprise permissions system, but the data model should not hard-code the creator as the only possible user.

### 8.2 Local machine/agent identity

The unattended local backend cannot depend on a browser login.

For a self-hosted Firebase project, the initial reference deployment may continue to use user-provisioned Firebase Admin/Application Default Credentials because the operator controls that Firebase project. Those credentials remain server-side and outside Git.

However, a future shared/managed Spararama service must **not** hand broad project Admin credentials to customer devices. It needs a scoped installation-agent registration flow, for example:

```text
one-time pairing code
      -> register local installation key/device
      -> receive scoped/revocable agent credential
      -> credential authorises only that installation's transport operations
```

Design the `RemoteTransport` boundary so this stronger identity can replace self-hosted Admin credentials without changing spa-control code.

### 8.3 Integration identity (Alexa)

Alexa remains distinct from both the human browser and local machine.

The existing Lambda continues validating the Alexa/LWA side. Instead of forwarding directly to the phone, it authenticates to a dedicated Spararama cloud integration endpoint.

The cloud endpoint maps the linked Alexa account/skill context to an authorised installation and submits the same typed remote command used by the hosted UI.

Never place Firebase Admin credentials in Lambda or frontend code merely to shortcut this mapping when a narrower service credential/API authentication mechanism will do.

---

## 9. Alexa permanent architecture

The temporary localhost.run tunnel remains a useful proof/debug tool, but the target architecture is:

```text
Echo / Alexa
     |
     v
Amazon Alexa service
     |
     v
Spararama AWS Lambda
  - Skill ID validation
  - LWA token validation
     |
     | authenticated HTTPS
     v
Spararama cloud integration API
     |
     +--> read recent installation state
     |
     +--> create typed command
              |
              v
        remote command queue
              |
        outbound listener
              |
              v
         local backend
              |
              v
          SpaAdapter
```

### Read requests

Temperature/status questions should normally use the latest cloud snapshot when it is fresh enough. This avoids a network round trip all the way to the spa for every spoken question and gives a predictable Alexa response time.

If the snapshot is stale/offline, Alexa should say the spa is currently unavailable or that the last reading is old rather than presenting stale data as current.

### Control requests

For immediate control, Lambda/cloud submits a short-lived command and waits only within the external integration's response deadline for acceptance/completion.

If the local node is offline, return an appropriate unavailable/error response instead of silently storing a long-lived physical command.

### Scheduled/ready-at requests

The cloud submits `scheduleReadyAt` (or the final equivalent) to the local node. The local heating scheduler remains authoritative. Weather/model logic stays in the backend/domain layer rather than being cloned into Lambda.

The Alexa docs should be updated after the cloud path is proven, retaining the tunnel instructions as an explicit development fallback rather than the normal permanent setup.

---

## 10. Hosted browser flow

The hosted UI should gradually move from today's LAN assumptions to an installation-oriented API.

A remote session should look like:

```text
1. Browser loads static app from trusted HTTPS hosting.
2. User signs in.
3. Browser fetches installations the user may access.
4. Browser subscribes to latest state/presence for the selected installation.
5. Read-only UI shows freshness/source explicitly.
6. A control action is sent to the cloud command API.
7. Cloud authorises + queues it.
8. Local agent receives and executes it.
9. Result/state update flows back to the browser.
```

Do not make the hosted browser call a private `192.168.x.x` address. That would reintroduce certificate/CORS/local-network complications and fail away from home.

The existing local UI remains supported separately:

```text
http(s)://local-host -> local backend -> spa
```

Both paths should use shared application/domain DTOs where practical so local and remote screens do not drift semantically.

---

## 11. Provider independence and self-hosting

Firebase is chosen as the first reference provider because Spararama already uses Firebase/Auth/Firestore and it supplies the hosted HTTPS/browser identity pieces needed now. It must not become an unavoidable dependency.

The provider boundary should separate at least these concepts:

```text
RemoteTransport          local agent <-> remote command/state channel
RemoteIdentityContext    authenticated human/integration identity
RemoteCommandService     provider-neutral command validation/execution contract
```

A future self-hosted implementation could use, for example:

```text
public Node service / container
Postgres or another durable database
WebSocket/SSE/MQTT/long-poll agent connection
normal OIDC/OAuth identity
```

Those choices are intentionally not fixed in the core design now.

The compatibility requirement is behavioural rather than Firestore-shaped:

- authenticated installation identity;
- authenticated user/integration identity;
- typed expiring command delivery;
- idempotent acknowledgement/result;
- current state/presence publication;
- reconnect recovery;
- clear stale/offline semantics.

Documentation for the open-source project should identify Firebase as the easiest supported reference setup, not describe it as the only possible Spararama server.

---

## 12. Configuration direction

Provider selection belongs in server-side/local configuration, not React source code.

Illustrative values:

```env
REMOTE_TRANSPORT=none
REMOTE_INSTALLATION_ID=
```

For the Firebase adapter there may be additional existing Firebase project/database credential settings rather than duplicating them under new names.

Provider secrets remain outside Git.

The hosted frontend needs public Firebase web configuration as normal, but no service-account/Admin credential and no local hardware secret.

The local-only default should remain safe. Cloning Spararama and running it locally must not silently enrol the machine in a cloud control plane.

---

## 13. Security requirements

Remote control raises the consequence of an authentication or replay bug, so the implementation should treat control commands more strictly than ordinary telemetry upload.

Required properties:

- no public inbound connection to the home node in the reference architecture;
- TLS for all cloud communication;
- explicit user-to-installation authorisation;
- explicit integration-to-installation authorisation;
- machine credentials kept server-side;
- no Admin/service-account credential in browser bundles;
- typed/allow-listed commands only;
- command expiry;
- idempotent/replay-safe execution;
- durable local recent-command ledger;
- auditability of remote command origin and outcome;
- rate limiting/abuse protection at public APIs;
- local validation even after cloud validation;
- a configuration kill switch that disables remote control without disabling local operation;
- CleverSpa adapter remains local/loopback-only by default;
- SSH remains LAN/VPN administration, not a public application interface.

A useful operational kill switch should be possible with a simple local setting such as `REMOTE_TRANSPORT=none` or an explicit remote-control enable flag, followed by a restart.

---

## 14. Failure behaviour

### Home internet outage

The local system continues normally. Cloud presence becomes stale/offline. New remote commands fail/expire. When connectivity returns, state and telemetry resume synchronising.

### Firebase/cloud outage

Same principle: local operation continues. The remote agent reconnects with backoff. It must not busy-loop or prevent the main backend from starting.

### Local node restart

The node restarts through its normal host runner/service mechanism, reconnects the transport, republishes current presence/state and recovers any legitimately claimable unexpired commands. Previously completed commands are not re-executed.

### Spa/hardware unreachable

The local agent may still be online. Cloud presence must distinguish **agent online / spa unavailable** from **home agent offline**. Remote UI should therefore show the same manual-only/unreachable/live distinction used by the local architecture.

### Command result lost after physical execution

If the physical action completed but the acknowledgement was lost, redelivery must be recognised through the command ledger/idempotency key and return the recorded result rather than blindly repeating the action.

### ISP/router replacement

No cloud config should contain the home's LAN or WAN IP. Once the local node regains normal internet and LAN hardware access, the remote path should reconnect automatically.

---

## 15. Observability

The local diagnostic/status surfaces should eventually report:

```text
remote transport: none/firebase/...
installation ID
connected/disconnected
last cloud contact
last state publish
last received command
last completed command
pending/retry count if applicable
credential source description without secret material
```

The cloud side should expose enough metadata to answer:

```text
Is the installation online?
When was state last observed?
Was command X accepted?
Did command X execute, fail or expire?
Which principal requested it?
```

Do not log raw access tokens, service-account JSON, Alexa LWA tokens or other reusable credentials.

---

# Detailed implementation plan

The work should be incremental. At no point should remote development make local spa control depend on cloud availability.

## Phase 0 - freeze the boundaries and inventory current paths

Before code changes:

1. Read `AGENTS.md`, `architecture.md`, this document, `docs/alexa-direct.md` and the relevant Termux docs.
2. Trace every current physical-control entry point: local API routes, heating scheduler, bubbles manager and Alexa direct handler.
3. Identify the lowest shared application service through which remote commands should execute.
4. Inventory the browser's direct Firebase reads/writes and distinguish user activity/history from control-plane data.
5. Record current Firebase project/database configuration and emulator/test support.

Deliverable: a short implementation note/issue confirming the command-execution boundary and proposed source-file locations before introducing provider code.

Acceptance: no behaviour change.

---

## Phase 1 - provider-neutral command and transport domain

Create the domain types for:

- installation identity;
- remote command envelope;
- command expiry;
- requested-by/source metadata;
- command result/status;
- presence/current-state snapshot;
- `RemoteTransport` lifecycle/events.

Add:

- `NoneRemoteTransport` as the production default;
- `InMemoryRemoteTransport` for tests;
- a remote command executor that maps allowed command types into existing backend services;
- local validation for payload/capability/expiry;
- idempotency tracking interface, initially with a simple durable local implementation appropriate to the current storage architecture.

Do **not** add Firebase imports to domain/control services.

Tests should cover:

- valid command execution;
- malformed/unknown command rejection;
- expired command rejection;
- duplicate command replay;
- executor failure result;
- adapter unavailable result;
- schedule commands use the existing scheduler rather than duplicated logic.

Acceptance: `REMOTE_TRANSPORT=none` is behaviourally indistinguishable from the current application.

---

## Phase 2 - Firebase transport for the local agent

Implement `FirebaseRemoteTransport` behind the provider-neutral interface.

Responsibilities:

- authenticate with the machine credential already used server-side in a self-hosted Firebase deployment;
- subscribe/poll for commands belonging only to the configured installation ID;
- claim work safely;
- ignore/reject expired commands;
- pass commands to the provider-neutral executor;
- record result/status;
- publish heartbeat/presence;
- publish compact current-state snapshots;
- reconnect with bounded exponential backoff;
- start even when Firebase is offline;
- never block local backend startup on remote connectivity.

Add focused Firebase Emulator integration tests if the repository can run them reasonably in CI/local development.

Test disconnect/reconnect and duplicate delivery deliberately.

Acceptance:

```text
cloud/emulator creates command
 -> local agent receives once semantically
 -> normal Spararama service executes it
 -> result is written
 -> current state reflects outcome
```

while unplugging/disabling the Firebase side leaves local operation working.

---

## Phase 3 - installation membership and cloud command API

Add the server-side cloud entry point used by browsers and integrations.

It should:

- validate Firebase Auth user identity for human requests;
- check installation membership/role;
- validate command type/payload;
- assign authoritative command ID/timestamps/expiry limits;
- write the command through the cloud provider;
- expose command status/result;
- expose installation state/presence;
- apply rate limits appropriate to physical control.

Do not rely solely on Firestore client security rules for physical command semantics. Rules are still required, but a server-side API gives one place for payload validation, audit metadata and future provider compatibility.

Add an owner/member data model. A minimal setup/onboarding path may initially be administrative/manual, but do not encode one hard-wired UID into application code.

Acceptance: two authorised test users can access the same test installation; an unauthorised user cannot read its state or submit a command.

---

## Phase 4 - hosted web UI, initially read-only

Deploy the existing web frontend through Firebase Hosting (reference setup) and make the build capable of remote mode.

First expose only:

- sign-in;
- installation selection if more than one exists;
- current water/target temperature;
- equipment state;
- connectivity/freshness;
- active schedule summary;
- high-value history that already has an appropriate cloud source.

The UI must visibly distinguish live/fresh, stale and offline state.

Keep the current LAN UI unchanged during this phase.

This phase proves:

- trusted HTTPS origin;
- Google/Firebase sign-in;
- installation membership;
- remote state path;
- router/ISP independence;

without yet putting remote physical control behind a new UI.

Acceptance: a signed-in browser away from the home LAN can correctly see fresh state when the local node is online and an explicit offline/stale state when it is not.

---

## Phase 5 - remote web controls

Enable controls in the hosted UI one capability at a time.

Recommended order:

```text
1. target temperature
2. filter
3. heater / supported heat request semantics
4. bubbles
5. ready-at scheduling
6. schedule cancellation/other higher-level controls
```

For each capability:

- send the provider-neutral command through the cloud API;
- show `sending/accepted/completed/failed/offline` rather than optimistic fiction;
- refresh from observed state after completion;
- respect current hardware capability and stale/offline state;
- verify duplicate/retry behaviour.

Do not make an internet failure disable the same control in the local/LAN UI.

Acceptance: remote controls use the same domain path and safety behaviour as equivalent local controls.

---

## Phase 6 - move Alexa from tunnel to cloud API

Preserve the existing skill/LWA/Lambda work but change the Lambda destination.

Old proof path:

```text
Lambda -> temporary reverse tunnel -> local Alexa proxy -> backend
```

Target:

```text
Lambda -> cloud integration API -> RemoteTransport -> local backend
```

Tasks:

- define a narrow Alexa integration credential/auth mechanism;
- map the linked Alexa principal to an installation;
- use fresh cloud state for status/temperature responses;
- submit immediate controls as expiring typed commands;
- submit ready-at requests to the existing local scheduler;
- return unavailable when state/agent is stale rather than inventing a value;
- keep `alexa-test.sh tunnel` as an explicit development fallback until the permanent path has been exercised thoroughly.

Do not enable additional proactive Alexa event capabilities merely as part of this migration; treat those as a separate feature after the basic permanent path is stable.

Acceptance: Alexa works while the home router has no Spararama port forwards and the temporary tunnel is stopped.

---

## Phase 7 - remote setup and deployment automation

Once the path works manually, make it repeatable for an open-source user.

Provide reference setup documentation/scripts for:

```text
A. local-only install
B. local node + Firebase reference remote service
C. hosted web deployment
D. Alexa optional integration
```

A setup script may generate identifiers/configuration, but it must not print or commit service-account credentials.

Termux, Linux/home-server and generic container/node deployments should use the same backend configuration names wherever possible. Termux-specific scripts should only handle Android-specific lifecycle details.

Add a concise deployment diagram and troubleshooting flow covering:

- agent online but spa offline;
- cloud unavailable;
- authentication/authorisation failure;
- command expires;
- local node not running;
- stale state;
- wrong installation selection.

Acceptance: a second installation can be configured without editing Spararama source code or copying the original household's IDs/secrets.

---

## Phase 8 - self-hosted provider contract

After the Firebase reference path is stable, prove that the abstraction is real by implementing or at minimum specifying a second transport compatible with the same domain contract.

The goal is not to immediately build a large alternative cloud platform. A small reference self-hosted relay is sufficient if it demonstrates:

- local agent outbound connection;
- typed command delivery;
- expiry/idempotency;
- current state/presence;
- user/integration authentication boundary;
- no changes to the underlying SpaAdapter/domain executor.

A VPS/container deployment is a more useful proof than opening a port on a home router because it exercises the intended public/private boundary.

Acceptance: swapping `REMOTE_TRANSPORT` does not require changes to spa-control UI/domain logic.

---

## Phase 9 - hardening and hosted-service readiness

Only after the private/reference deployment has real-world use:

- introduce scoped/revocable installation-agent credentials for a shared hosted service;
- add a pairing/onboarding flow;
- add command/audit retention policies;
- add cloud cost/usage observability;
- add API abuse protection and alerting;
- review Firestore indexes/rules for multi-tenant scale;
- add backup/export expectations for cloud-owned account/config data;
- threat-model account takeover, stolen device credential and replay scenarios;
- consider whether remote telemetry/history storage should remain Firebase or move to a different analytical store.

Do not prematurely redesign the local telemetry archive or hardware adapters merely to prepare for hypothetical SaaS scale.

---

## 16. Validation matrix

Before declaring the remote architecture complete, exercise at least these scenarios:

| Scenario | Expected result |
| --- | --- |
| Internet disconnected at home | Local UI/control/schedules continue; remote shows offline |
| Cloud provider unavailable | Local backend starts and continues normally |
| Local node killed/restarted | Cloud becomes stale, then reconnects and republishes state |
| Duplicate command delivered | Physical action executes semantically once |
| Command arrives after expiry | Rejected as expired; no physical action |
| Result acknowledgement lost | Redelivery returns prior result, not duplicate side effect |
| Spa adapter disconnected | Agent online but spa shown unavailable |
| Unauthorised signed-in user | Cannot read or control installation |
| Second authorised household user | Can access same installation according to role |
| Router replaced / WAN IP changes | Agent reconnects with no remote endpoint reconfiguration |
| Home behind CGNAT | Remote path still works |
| Firebase/remote transport disabled | Pure local deployment still works |
| Alexa tunnel stopped after migration | Alexa still works through cloud control plane |
| Hosted browser on mobile data | Can sign in and use remote path without LAN access |

---

## 17. Decisions intentionally deferred

The architecture does **not** yet require decisions on:

- purchasing a custom domain - managed hosting hostname is sufficient initially;
- Cloud Functions versus Cloud Run for every endpoint;
- the exact second/self-hosted transport technology;
- production SaaS billing/subscriptions;
- proactive Alexa event reporting;
- replacing the local NDJSON telemetry archive;
- forcing local LAN HTTPS;
- a full multi-tenant device-pairing UX before the private/reference deployment works.

These can be chosen when there is evidence they are needed.

---

## 18. Definition of success

The architecture has achieved its purpose when all of the following are true:

```text
- Spararama remains fully useful locally with REMOTE_TRANSPORT=none.
- The home installation accepts no public inbound Spararama connection.
- A hosted HTTPS browser can authenticate and see the correct installation remotely.
- Remote commands are typed, authorised, expiring, idempotent and executed locally.
- Cloud state clearly reports freshness/offline status.
- Alexa uses a stable public cloud endpoint rather than a temporary tunnel to the house.
- Replacing the home router/ISP does not require changing Spararama's public endpoint.
- The CleverSpa adapter remains private to the local installation.
- Firebase is the supported reference provider, not a dependency embedded in the core domain.
- A self-hosted provider can implement the same transport contract without rewriting spa control.
- Secrets and machine credentials remain outside browser bundles and Git.
```

That gives Spararama a secure remote-control foundation while preserving the feature that matters most: if the internet, Firebase, Alexa or a hosted service disappears, the hot tub at home still works.