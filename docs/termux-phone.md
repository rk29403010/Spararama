# Running Spararama on an Android phone with Termux

This is intended as a lightweight mobile Spararama host and development/test instance.
The phone runner defaults to `SPA_ADAPTER=mock`, so it does not try to control the
real spa when the phone is away from home. It can also run the bundled CleverSpa
adapter locally on the phone for live LAN control.

## Existing checkout - one-time setup

If Spararama is already cloned on the phone:

```bash
cd ~/Spararama
git pull --ff-only
bash scripts/termux/install.sh
```

After that, the normal command is simply:

```bash
spar
```

`bash scripts/termux/install.sh` normally only needs to be run once. The installed
`spar` wrapper always uses the runner stored in the repo, so future runner improvements
arrive with the normal Git pull.

The installer is safe to rerun. It preserves the selected phone mode and any
phone-local CleverSpa IP/passcode settings rather than resetting the phone to mock mode.

## Fresh phone setup

Install Termux, then run:

```bash
pkg update
pkg install -y git
git clone -b chatgpt-dev https://github.com/rk29403010/Spararama.git
cd Spararama
bash scripts/termux/install.sh
spar
```

The installer takes care of Node.js, curl, process tools, `setsid`, and the repo's
pinned pnpm version.

## Connector modes

### Mock mode

```bash
spar mock
```

This persists `SPAR_ADAPTER=mock`, stops any phone-hosted CleverSpa service, restarts
the main app, and opens it. No commands are sent to the real spa.

### Live CleverSpa mode

```bash
spar live
```

This persists `SPAR_ADAPTER=bridge`, starts the bundled CleverSpa adapter service on
`127.0.0.1:8787`, asks it to discover/connect to the spa, restarts the main Spararama
backend on `127.0.0.1:3000`, then opens the app.

For normal LAN control the phone must be connected to the same home network as the
spa. GitHub access is not required for `spar live` itself, so if the home Wi-Fi blocks
GitHub it is fine to update the checkout over mobile data first, then reconnect to the
home Wi-Fi and run `spar live`.

The live process shape is:

```text
Chrome on phone
    |
    v
Spararama :3000
    |
    v
CleverSpa adapter :8787
    |
    v
Gizwits LAN connection
    |
    v
real spa
```

The adapter defaults to loopback-only, so port 8787 is not exposed to other LAN devices.

If auto-discovery is not enough and the spa's IP/passcode are already known, store them
outside the repo with:

```bash
spar live-setup
```

The passcode prompt does not echo. These settings are written to the mode-600 phone
configuration file, not committed to Git.

Check the current mode and connection state with:

```bash
spar status
```

If the adapter is running but the spa is not connected, inspect:

```bash
spar adapter-log
```

Do not put a CleverSpa passcode, cloud credentials or tokens into tracked repo files.

## What `spar` does

Running `spar` with no arguments keeps the currently selected connector mode and:

1. checks that the checkout has no uncommitted local changes;
2. fetches and fast-forwards `chatgpt-dev`;
3. runs `pnpm install` only when dependencies have changed or are missing;
4. stops the previous phone processes;
5. if live mode is selected, starts the CleverSpa adapter on port 8787;
6. starts `pnpm dev` on port 3000 with the selected adapter mode in a detached session;
7. waits for `/api/health` to respond and verifies it remains alive briefly;
8. opens `http://127.0.0.1:3000` on the phone.

The update happens **before** the old processes are stopped. If GitHub is unavailable
or the current Wi-Fi blocks it, the already-running version is left alone.

The long-running processes are launched with `setsid` and `nohup` so moving from
Termux to the browser does not normally terminate their Node process trees.

## Commands

```text
spar              update, restart current mode and open Spararama
spar live         persistently switch to the real CleverSpa adapter and restart
spar mock         persistently switch to the simulated spa and restart
spar live-setup   optionally store a known spa IP/passcode outside the repo
spar start        start without pulling
spar restart      restart without pulling
spar stop         stop Spararama and the phone CleverSpa adapter
spar status       show mode, server and live-spa connection state
spar log          follow the Spararama server log; Ctrl+C exits
spar adapter-log  follow the CleverSpa adapter log; Ctrl+C exits
spar open         open Spararama in the browser
spar help         show command help
```

Phone runtime state is stored under:

```text
~/.local/state/spararama-phone/
  server.pid
  server.log
  cleverspa.pid
  cleverspa.log
```

Phone-specific configuration is stored in:

```text
~/.config/spararama/phone.conf
```

The installer records the real location of the cloned repo there, so the checkout
does not have to be named `~/Spararama`.

## Android home-screen launcher

The installer creates:

```text
~/.shortcuts/Spararama
```

On the current Google Play Termux build, add a Termux shortcut/widget to the
Android home screen and choose **Spararama**. Tapping it is equivalent to typing
`spar`: it updates, restarts the currently selected mode and opens the app.

On Termux variants where home-screen shortcut support is provided by the separate
Termux:Widget add-on, install that add-on first and use the same `Spararama`
shortcut created by the installer.

## If something goes wrong

First try:

```bash
spar status
spar log
```

For live-spa problems also try:

```bash
spar adapter-log
```

If the browser says the site cannot be reached immediately after `spar`, rerun the
installer once so the detached-session support is present, then restart:

```bash
cd ~/Spararama
git pull --ff-only
bash scripts/termux/install.sh
spar restart
```

If the server runs initially but Android later kills it while Termux is in the
background, allow Termux unrestricted/background battery use in Android settings.
That is an Android process-management issue rather than a Spararama networking
problem.

If `spar` refuses to update because there are local changes, inspect them rather
than discarding them automatically:

```bash
cd ~/Spararama
git status
```

If GitHub connections are repeatedly reset, check whether the current Wi-Fi is
blocking GitHub before changing the Termux setup.
