# Remote control Phase 0 inventory

Status: **complete for the Phase 1 boundary freeze**.

This note records the concrete execution boundary chosen before provider-specific remote-control code is introduced. It is subordinate to [remote-access-cloud-architecture.md](remote-access-cloud-architecture.md) and [../architecture.md](../architecture.md).

## Current physical-control entry points

The current backend has several entry points, but they converge on a small set of application services:

- `server/spa/routes.ts`
  - direct local HTTP status/control
  - target temperature and heater/filter commands call `SpaAdapter`
  - bubbles use `BubbleSessionManager` when available so cooldown/auto-restart policy is preserved
- `server/heating/routes.ts`
  - creates heating schedules through `HeatingScheduler`
- `server/alexa/direct.ts`
  - wraps `SpaAdapter`, `BubbleSessionManager` and `HeatingScheduler`
  - ready-at planning uses the shared heating model and then creates a normal local schedule
- `HeatingScheduler`
  - remains authoritative for later automatic heater starts/retries/manual fallback
- `BubbleSessionManager`
  - remains authoritative for bubble run/cooldown/one-restart behaviour
- `SpaAdapter`
  - remains the hardware-neutral equipment boundary

The Express route handlers are **not** the remote execution boundary. Remote control must not proxy arbitrary local HTTP routes.

## Phase 1 execution boundary

The first provider-neutral remote executor will call the same backend services directly:

```text
RemoteTransport
      |
      v
RemoteCommandExecutor
      |
      +--> SpaAdapter
      +--> BubbleSessionManager
      +--> HeatingScheduler
```

This is intentionally below Alexa/HTTP protocol handling and above hardware-specific protocols.

The initial allow-listed command set is:

```text
readStatus
setTargetTemperature
setHeater
setFilter
setBubbles
createHeatingSchedule
```

`createHeatingSchedule` exists in Phase 1 specifically to prove that remote scheduling uses the existing `HeatingScheduler`; it does not duplicate scheduler logic. A higher-level `scheduleReadyAt` command can be added once the existing Alexa-specific ready-at planning is factored into a provider-neutral application service.

## Firebase inventory

Current browser Firebase use and machine Firebase use remain separate:

- browser/human identity:
  - `src/lib/firebase.ts`
  - Google/Firebase Auth
  - user activity under `/users/{uid}/logs`
- always-on backend/machine identity:
  - Firebase Admin/Application Default Credentials
  - telemetry collector upload/read-through
  - must not depend on browser sign-in

The remote control plane will be a third concern layered onto the machine identity, but Firestore document shapes must remain inside the Firebase transport adapter rather than becoming core command-domain types.

## Phase 1 constraints

- `REMOTE_TRANSPORT=none` is the production default.
- No Firebase import is allowed in `server/remote` domain/executor code except the future Firebase adapter itself.
- Remote commands are typed, expiring and idempotent.
- Completed/rejected/expired results are recorded in a durable local ledger before acknowledgement where practical.
- Remote bubbles must pass through `BubbleSessionManager`.
- Remote heating schedules must pass through `HeatingScheduler`.
- A disconnected/manual adapter is a normal unavailable result for immediate physical controls.
- Local HTTP, local scheduling, telemetry and Alexa proof behaviour must not depend on a remote provider being available.

## Deferred refactor

Local HTTP and Alexa currently each have small wrappers around the same backend services. Phase 1 does **not** perform a broad control-layer rewrite merely to make every caller share one class.

After the remote executor is proven, duplicated command validation can be consolidated into a provider-neutral application command service if doing so reduces drift without destabilising existing local control.
