# Spararama

Spararama is a local-first spa/pool manager for water chemistry, heating, maintenance, telemetry and optional equipment control.

It started with a CleverSpa, but hardware integration is optional. A pool or spa can be:

- manually monitored with no network controller;
- configured for remote control but temporarily unreachable;
- live and remotely controllable through a hardware adapter.

Manual temperature/equipment observations remain available in every mode.

## Repository layout

```text
src/                 React browser UI
server/              Spararama API, SpaAdapter layer and telemetry collector
services/cleverspa/  separately runnable CleverSpa/Gizwits adapter service
scripts/              local lifecycle/development helpers
```

This is one Git repository but not one mandatory process. Hardware adapters are separately deployable so a personal installation can run everything on one machine while a future hosted deployment can keep device-facing code on the customer's LAN.

Read `architecture.md` before changing component boundaries, hardware integration, persistence, Firebase or authentication.

## Local development

Package manager: pnpm 11.21.0.

Useful Codex project actions are defined in `.codex/environments/environment.toml`. The same operations are available under `scripts/` for normal PowerShell use.

Normal development branch: `chatgpt-dev`. `main` is retained as an AI Studio integration/snapshot branch.

## Phone access on the private LAN

Run `pnpm local:start`, then run `scripts/enable-private-lan-phone-access.ps1` from an elevated PowerShell once. It creates one Windows Firewall rule for the running frontend/API: TCP port 3000, only on the active private Wi-Fi/Ethernet interface, only from that interface's IPv4 subnet, and only for `node.exe`. It disables the generic all-port/all-network inbound Node.js rules that Windows' firewall prompt may have created, because those would otherwise bypass this boundary; they are disabled rather than deleted and are recoverable with `Enable-NetFirewallRule`. It never opens the CleverSpa adapter port (8787), enables Public-profile access, or changes router settings.

The script refuses to make a rule if more than one private IPv4 LAN is active, rather than widening access. After DHCP/network changes, run it again to replace its own named rule with the new safe scope. Use `pnpm local:status` for the phone URL.

## CleverSpa service

The core CleverSpa/Gizwits status and control implementation is now in `services/cleverspa` and defaults to loopback port 8787. The main Spararama API talks to it through the generic `SpaAdapter` boundary.

The old `spararama-cleverspa-recovery` repository should be archived, not deleted yet: it remains the historical reference for recovery-only tooling such as legacy ESPTouch Wi-Fi reprovisioning that has not been moved into the main repository.
