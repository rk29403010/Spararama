# AGENTS.md

Before making architectural, Firebase, telemetry, spa-control, persistence, networking, or authentication changes, read [`architecture.md`](./architecture.md).

## Repository workflow

- The active Spararama development/integration branch is **`chatgpt-dev`**.
- GitHub's default branch, **`main`**, is intentionally retained for the AI Studio snapshot/integration workflow. Do not use `main` as the normal base for local Spararama development unless explicitly asked.
- Before starting local work, fetch and fast-forward `chatgpt-dev`. `scripts/sync-dev.ps1` provides a safe local helper that refuses to overwrite uncommitted work.
- Codex worktrees/feature branches should normally be based on the current `chatgpt-dev` head and merged/ported back there.
- Do not merge `chatgpt-dev` into `main`, or change the GitHub default branch, as an incidental development task.
- Codex desktop project actions are versioned in `.codex/environments/environment.toml`. Keep routine local operations exposed there so the user does not need to remember script/CLI commands.

## Key constraints

- The Spararama browser/frontend Firebase session is a **human user identity**.
- The always-on telemetry backend uses a **separate machine/server identity** through Firebase Admin / Application Default Credentials.
- Never make the unattended backend depend on a browser Google/Firebase login.
- Never expose service-account/Admin credentials or privileged API secrets to browser code or Git.
- The frontend and backend must target the same Firebase project **and the same named Firestore database** unless an intentional migration says otherwise.
- Do not weaken Firestore client rules to make Firebase Admin telemetry writes work.
- Always-on telemetry writes locally first and must continue through Firebase/network outages.
- Keep spa-specific protocols behind the `SpaAdapter` boundary.
- Preserve the distinction between non-networked tubs, network-capable but unreachable tubs, and contactable tubs.
- **pnpm is the repository package manager.** Respect the pinned `packageManager` version in `package.json`, use `pnpm-lock.yaml` as the authoritative dependency lockfile, and do not reintroduce npm or Bun lockfiles/package-manager commands unless explicitly migrating away from pnpm.

For current component boundaries, data flow, credential roles, Firestore paths, and relevant source files, see [`architecture.md`](./architecture.md).
