# AGENTS.md

Before architectural, Firebase, telemetry, spa-control, persistence, networking or authentication changes, read [`architecture.md`](./architecture.md).

## Repository workflow

- Active development/integration branch: **`chatgpt-dev`**.
- `main` is intentionally retained for the AI Studio snapshot/integration workflow. Do not use it as the normal local-development base unless explicitly asked.
- Fetch and fast-forward `chatgpt-dev` before local work. Use `node scripts/local.mjs sync`; it refuses to overwrite uncommitted work.
- Routine local lifecycle commands are handled by the cross-platform `scripts/local.mjs` runner (`update`, `sync`, `start`, `stop`, `restart`, `status`). Do not add shell-specific wrappers unless there is a genuine OS-specific requirement.
- Codex worktrees/feature branches should normally be based on current `chatgpt-dev` and returned there.
- Do not merge `chatgpt-dev` into `main` or change the GitHub default branch incidentally.
- **pnpm** is the repository package manager; respect the pinned version and `pnpm-lock.yaml`.

## Component boundaries

- This is a **single repository with separately deployable components**.
- The main UI/backend live at repository root; hardware-specific services live under `services/`.
- `services/cleverspa` is the CleverSpa/Gizwits hardware adapter. Do not move its wire protocol into React or the core domain layer.
- Keep hardware integrations behind the `SpaAdapter` boundary so other spa/pool adapters can be added later.
- The old `spararama-cleverspa-recovery` repository is historical/recovery reference only; normal development must not depend on a sibling checkout.

## Connectivity/manual operation

- Hardware connectivity is optional, not an error prerequisite.
- Preserve three normal states: manual-only, adapter configured but unreachable, adapter live.
- Manual temperature/equipment observations must remain available in all states.
- Never invent zeroes for unavailable sensor readings; preserve unknown/null/gaps and the observation source/timestamp.
- A partial/unreachable hardware response must not crash a page or the application shell.

## Firebase/security constraints

- Browser Firebase identity = **human user**.
- Always-on backend Firebase identity = **machine/server**, through Firebase Admin/Application Default Credentials.
- Never make the unattended backend depend on browser Google/Firebase login.
- Never expose service-account/Admin credentials or privileged secrets to browser code or Git.
- Frontend/backend must target the same Firebase project and named Firestore database unless intentionally migrating.
- Do not weaken Firestore client rules to make Admin telemetry writes work.
- Always-on telemetry writes locally first and continues through Firebase/network outages.

For current data flow, deployment shapes, authentication roles and source boundaries, see [`architecture.md`](./architecture.md).
