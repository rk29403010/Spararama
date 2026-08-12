# AGENTS.md

Before making architectural, Firebase, telemetry, spa-control, persistence, networking, or authentication changes, read [`architecture.md`](./architecture.md).

Key constraints:

- The Spararama browser/frontend Firebase session is a **human user identity**.
- The always-on telemetry backend uses a **separate machine/server identity** through Firebase Admin / Application Default Credentials.
- Never make the unattended backend depend on a browser Google/Firebase login.
- Never expose service-account/Admin credentials or privileged API secrets to browser code or Git.
- The frontend and backend must target the same Firebase project **and the same named Firestore database** unless an intentional migration says otherwise.
- Do not weaken Firestore client rules to make Firebase Admin telemetry writes work.
- Always-on telemetry writes locally first and must continue through Firebase/network outages.
- Keep spa-specific protocols behind the `SpaAdapter` boundary.
- Preserve the distinction between non-networked tubs, network-capable but unreachable tubs, and contactable tubs.

For current component boundaries, data flow, credential roles, Firestore paths, and relevant source files, see [`architecture.md`](./architecture.md).
