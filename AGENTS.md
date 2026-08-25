# AGENTS.md

Before architectural, Firebase, telemetry, spa-control, persistence, networking or authentication changes, read [`architecture.md`](./architecture.md).

Before Android/Termux phone-runner, `spar`, phone launcher or phone-local hosting changes, also read [`docs/termux-phone.md`](./docs/termux-phone.md).

Before frontend UI/UX, React/TSX/CSS, interaction-flow, responsive, accessibility or visual-design changes, read [`.agents/skills/spararama-ui-ux/SKILL.md`](./.agents/skills/spararama-ui-ux/SKILL.md) **and** [`docs/ui-design-principles.md`](./docs/ui-design-principles.md). The latter records direct user design feedback and should be treated as project-specific design direction, not optional inspiration.

## Repository workflow

- Active development/integration branch: **`chatgpt-dev`**.
- `main` is intentionally retained for the AI Studio snapshot/integration workflow. Do not use it as the normal local-development base unless explicitly asked.
- Fetch and fast-forward `chatgpt-dev` before local work. Use `node scripts/local.mjs sync`; it refuses to overwrite uncommitted work.
- Routine laptop/headless local lifecycle commands are handled by the cross-platform `scripts/local.mjs` runner (`update`, `sync`, `start`, `stop`, `restart`, `status`). Do not add shell-specific wrappers unless there is a genuine OS-specific requirement.
- **Android/Termux is an intentional OS-specific exception.** `scripts/termux/` contains the supported phone-local development runner/installer; do not fold it into `scripts/local.mjs` merely to remove shell scripts.
- On a phone where the Termux setup is already installed, prefer the `spar` command instead of asking the user to manually repeat `git pull`, `pnpm install` and `pnpm dev`.
- Codex worktrees/feature branches should normally be based on current `chatgpt-dev` and returned there.
- Do not merge `chatgpt-dev` into `main` or change the GitHub default branch incidentally.
- **pnpm** is the repository package manager; respect the pinned version and `pnpm-lock.yaml`.
- Persistent spa history/reference files belong in this repository under `history/` (`spa-events.jsonl`, `spa-reference.md`). Do not append new project history to the old recovery repository.

## Android / Termux phone development

Spararama can run entirely on an Android phone under Termux as a lightweight development/test instance:

```text
Termux checkout (chatgpt-dev)
  -> scripts/termux/spar
  -> SPA_ADAPTER=mock pnpm dev
  -> Express/Vite on 127.0.0.1:3000
  -> Chrome on the same phone
```

Key rules:

- The phone runner defaults to `SPA_ADAPTER=mock`. Keep that safe default unless real home-network reachability is deliberately configured.
- Phone hosting is local to the phone; it does not by itself provide remote access to the physical spa. Real control still needs a route to the home-side adapter/tub (home LAN, VPN or another intentionally configured secure path).
- Normal `spar` behaviour is update -> dependency check -> stop old server -> start detached dev server -> health check -> open browser.
- **Update/install happens before stopping the existing server.** Preserve this ordering so a blocked/offline GitHub connection does not unnecessarily take down a working phone instance.
- The detached phone server should survive Termux handing focus to Chrome. Keep the separate session/process-group launch plus post-start health verification unless there is a tested replacement.
- `$PREFIX/bin/spar` is a tiny installed wrapper. The real runner remains `scripts/termux/spar` in the repo and is executed via a temporary copy, allowing `spar` to pull a newer version of itself safely.
- Phone-specific mutable state belongs outside the repo:
  - config: `~/.config/spararama/phone.conf`
  - PID/log state: `~/.local/state/spararama-phone/`
  - launcher: `~/.shortcuts/Spararama`
- The Android home-screen shortcut invokes `spar`; future support should keep the command-line and launcher paths using the same runner rather than maintaining two implementations.
- `scripts/local.mjs` and `scripts/termux/spar` have different purposes. The former is the general production-style laptop/headless lifecycle path and may start/build the real CleverSpa service; the latter is the phone-local dev/test path.

For setup, recovery commands and launcher details, see [`docs/termux-phone.md`](./docs/termux-phone.md).

## Component boundaries

- This is a **single repository with separately deployable components**.
- The main UI/backend live at repository root; hardware-specific services live under `services/`.
- `services/cleverspa` is the CleverSpa/Gizwits hardware adapter. Do not move its wire protocol into React or the core domain layer.
- Keep hardware integrations behind the `SpaAdapter` boundary so other spa/pool adapters can be added later.
- The old `spararama-cleverspa-recovery` repository is historical/recovery reference only; normal development must not depend on a sibling checkout or write new application/history data there.

## Connectivity/manual operation

- Hardware connectivity is optional, not an error prerequisite.
- Preserve three normal states: manual-only, adapter configured but unreachable, adapter live.
- Manual temperature/equipment observations must remain available in all states.
- Never invent zeroes for unavailable sensor readings; preserve unknown/null/gaps and the observation source/timestamp.
- A partial/unreachable hardware response must not crash a page or the application shell.

## UI/UX verification

- UI work is not complete merely because TypeScript compiles or tests pass.
- For substantial visual or interaction changes, inspect the rendered application at representative phone and desktop widths when browser tooling is available.
- Exercise the primary interaction and relevant non-ideal states such as unknown, stale, offline, loading, interrupted or error states.
- If rendered verification cannot be performed, report that limitation explicitly rather than claiming visual success.

## Firebase/security constraints

- Browser Firebase identity = **human user**.
- Always-on backend Firebase identity = **machine/server**, through Firebase Admin/Application Default Credentials.
- Never make the unattended backend depend on browser Google/Firebase login.
- Never expose service-account/Admin credentials or privileged secrets to browser code or Git.
- Frontend/backend must target the same Firebase project and named Firestore database unless intentionally migrating.
- Do not weaken Firestore client rules to make Admin telemetry writes work.
- Always-on telemetry writes locally first and continues through Firebase/network outages.

For current data flow, deployment shapes, authentication roles and source boundaries, see [`architecture.md`](./architecture.md).
