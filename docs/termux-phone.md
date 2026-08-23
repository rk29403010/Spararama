# Running Spararama on an Android phone with Termux

This is intended as a lightweight mobile development/test instance of Spararama.
The phone runner defaults to `SPA_ADAPTER=mock`, so it does not try to control the
real spa when the phone is away from home.

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

`bash scripts/termux/install.sh` only needs to be run once. The installed `spar`
wrapper always uses the runner stored in the repo, so future runner improvements
arrive with the normal `git pull` performed by `spar`.

If the installer itself changes to require an additional Termux package, rerun it
once after pulling. It is safe to rerun at any time.

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

## What `spar` does

Running `spar` with no arguments:

1. checks that the checkout has no uncommitted local changes;
2. fetches and fast-forwards `chatgpt-dev`;
3. runs `pnpm install` only when dependencies have changed or are missing;
4. stops the previous phone development server;
5. starts `pnpm dev` with the mock spa adapter in a detached session;
6. waits for `/api/health` to respond, then verifies it remains alive briefly;
7. opens `http://127.0.0.1:3000` on the phone.

The update happens **before** the old server is stopped. If GitHub is unavailable
or the current Wi-Fi blocks it, the already-running version is left alone.

The server is launched with `setsid` and `nohup` so moving from Termux to the
browser does not normally terminate the Node process tree.

## Other commands

```text
spar          update, restart and open Spararama
spar start    start without pulling
spar restart  restart without pulling
spar stop     stop the phone server
spar status   show whether the server is running
spar log      follow the server log; Ctrl+C exits the log view
spar open     open Spararama in the browser
spar help     show command help
```

The server log is stored under:

```text
~/.local/state/spararama-phone/server.log
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
`spar`: it updates, restarts and opens the app.

On Termux variants where home-screen shortcut support is provided by the separate
Termux:Widget add-on, install that add-on first and use the same `Spararama`
shortcut created by the installer.

## If something goes wrong

First try:

```bash
spar status
spar log
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
