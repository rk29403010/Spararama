# CleverSpa adapter service

This package is the hardware-specific CleverSpa/Gizwits component of Spararama. It is intentionally kept as a separately runnable process even though it lives in the same repository.

- Default bind: `127.0.0.1:8787`
- Spararama talks to it through the stable `SpaAdapter` boundary.
- LAN discovery uses Gizwits UDP port 12414; control uses TCP port 12416.
- The service may be deployed with the main Spararama backend, on another machine on the same LAN, or replaced by another spa/pool adapter.

The implementation was consolidated from `rk29403010/spararama-cleverspa-recovery`. Keep that repository archived as historical reference until all recovery-only tooling (notably the legacy ESPTouch Wi-Fi reprovisioning UI) has been deliberately re-homed or retired.

Run from the repository root with `pnpm cleverspa:start`; test with `pnpm test:cleverspa`.
