# Running Spararama continuously on an old Android phone

This guide turns a spare Android phone into a small always-on Spararama home server.

The example below uses a **Samsung Galaxy A17** and names the telemetry host
`sparorama-a17`. The same approach works on many recent Android phones; Samsung menu
names vary slightly by One UI version.

The resulting layout is:

```text
Samsung A17 on home Wi-Fi
  Termux
    Spararama backend :3000
    CleverSpa adapter :8787 (loopback only)
    telemetry collector -> local archive -> Firebase Admin
    sshd :8022

Laptop / phones on the same home LAN
  browser -> http://PHONE_IP:3000
  ssh     -> PHONE_IP:8022
```

The phone does not need a SIM. It does need reliable Wi-Fi, permanent power and
Android settings that do not aggressively suspend Termux.

## 1. Network first

A phone-server is much easier to manage if its LAN address is stable.

For the A17 example, assume:

```text
Phone name:       Spararama A17
Reserved IP:      192.168.0.126
Spararama URL:    http://192.168.0.126:3000
SSH port:         8022
Telemetry host:   spararama-a17
```

Reserve the phone's address in the router using a DHCP reservation rather than
trying to set a static IP on Android.

If the house has several Wi-Fi access points using the same SSID, make sure they
are genuinely on the same bridged LAN:

- only one router should provide DHCP/NAT;
- secondary Wi-Fi units should normally be access-point/bridge mode;
- AP/client isolation should be off;
- roaming from one access point to another should keep the phone on the same
  subnet and gateway.

A useful warning sign is several local-network features failing at once after
moving around the house - for example SSH, the Spararama page and Link to Windows.
That often indicates roaming onto a differently configured access point rather
than Spararama itself failing.

On newer Android releases Termux may not be allowed to inspect network interfaces
with `ip addr`; it can fail with:

```text
cannot bind netlink socket: permission denied
```

That is an Android permission restriction, not proof that Wi-Fi is down. Read the
phone's IP address and gateway from **Android Settings -> Wi-Fi -> current network**.

## 2. Install Termux

For the current Google Play Termux build, Termux:Boot and Termux:Widget functionality
is integrated into the main app. The separate add-ons are not required.

Official status:
<https://github.com/termux-play-store>

For F-Droid builds, use the matching Termux add-ons from the same installation
source; do not mix Termux/add-on signing sources. The traditional Termux:Boot
instructions are here:
<https://github.com/termux/termux-boot>

Open Termux and run:

```bash
pkg update
pkg install -y git
git clone -b chatgpt-dev https://github.com/rk29403010/Spararama.git
cd Spararama
bash scripts/termux/server-setup.sh --host-id spararama-a17
```

The server setup script performs most of the repetitive work:

- installs the normal Spararama Termux runner;
- installs OpenSSH and `termux-services`;
- enables `sshd` under the Termux runit service manager;
- prepares `~/.ssh/authorized_keys`;
- requests a Termux wake lock;
- installs `~/.termux/boot/10-spararama`;
- starts Spararama in the currently configured connector mode;
- if `.env` already exists, sets the requested `TELEMETRY_HOST_ID` and fixes the
  Firebase Admin credential path when the standard credential file is present.

Use `--live` only when the phone is already on the spa's home network and you want
setup to switch immediately to the real CleverSpa connector:

```bash
bash scripts/termux/server-setup.sh --host-id spararama-a17 --live
```

Otherwise switch later with:

```bash
spar live
```

The normal runner commands are:

```text
spar              update chatgpt-dev, restart and open the app
spar live         persistently use the real CleverSpa adapter
spar mock         persistently use the simulated spa
spar start        start without pulling from GitHub
spar restart      restart without pulling
spar stop         stop Spararama and the CleverSpa adapter
spar status       show app and live-spa status
spar log          follow the main server log
spar adapter-log  follow the CleverSpa adapter log
```

`docs/termux-phone.md` documents the phone runner itself in more detail.

## 3. Samsung/Android battery settings

This part cannot be automated from Termux and matters just as much as the shell
setup.

For a Samsung phone, use the strongest background exemptions available.

### App battery mode

Go to:

**Settings -> Apps -> Termux -> Battery -> Unrestricted**

Do not leave Termux on Restricted.

### Never auto sleeping apps

On One UI versions that expose it:

**Settings -> Battery / Battery and device care -> Background usage limits -> Never auto sleeping apps**

Add Termux.

Samsung may hide an app from the picker while it is already set to Unrestricted.
If Termux is missing from the list:

1. temporarily set **Settings -> Apps -> Termux -> Battery -> Optimised**;
2. add Termux to **Never auto sleeping apps**;
3. set Termux back to **Unrestricted**.

While proving the server setup, it is also reasonable to turn off **Put unused apps
to sleep**. At minimum, Termux should not appear under Sleeping apps or Deep
sleeping apps.

### Power saving

Do not leave Android Power saving mode enabled on a phone that is expected to act
as an always-on server. It can restrict background activity and networking.

### Keep open

If Samsung's Recent apps screen offers **Keep open** for the Termux task, enable it.
This is an additional defence, not a substitute for Unrestricted battery mode.

### Wake lock

The setup script and boot script both request:

```bash
termux-wake-lock
```

A wake lock helps keep the CPU available, but it does not override every Android
process-management policy. That is why the Samsung battery exemptions above are
still required.

## 4. SSH access from a laptop

Termux OpenSSH normally listens on port `8022`.

First find the Termux username on the phone:

```bash
whoami
```

It will look something like:

```text
u0_a756
```

Set a temporary Termux password if required for the first SSH login:

```bash
passwd
```

Check the service:

```bash
sv status sshd
```

If necessary:

```bash
source "$PREFIX/etc/profile.d/start-services.sh"
sv up sshd
```

From the laptop, the first connection is then:

```bash
ssh -p 8022 u0_a756@192.168.0.126
```

### Dedicated SSH key

On the laptop, create a dedicated key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/spararama_a17
```

If `ssh-copy-id` is available:

```bash
ssh-copy-id -i ~/.ssh/spararama_a17.pub -p 8022 u0_a756@192.168.0.126
```

A portable alternative from Git Bash is:

```bash
cat ~/.ssh/spararama_a17.pub | ssh -p 8022 u0_a756@192.168.0.126 \
  'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Then add a laptop SSH config entry:

```text
Host spararama
    HostName 192.168.0.126
    User u0_a756
    Port 8022
    IdentityFile ~/.ssh/spararama_a17
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

Now the normal laptop command is simply:

```bash
ssh spararama
```

Use key-based SSH for normal operation. Do not expose port 8022 to the public
internet.

## 5. Copy the machine configuration and Firebase Admin credential

The unattended backend has a different Firebase identity from the browser user.
The browser may use Google/Firebase sign-in; the always-on backend uses a machine
Firebase Admin credential.

If an existing development machine already has the correct `.env`, copy it rather
than retyping secrets.

From the laptop, for example:

```bash
scp -P 8022 .env u0_a756@192.168.0.126:~/Spararama/.env
```

Create the credential directory on the phone:

```bash
mkdir -p ~/.spararama/credentials
chmod 700 ~/.spararama ~/.spararama/credentials
```

Then from the laptop:

```bash
scp -P 8022 ~/.spararama/credentials/firebase-admin.json \
  u0_a756@192.168.0.126:~/.spararama/credentials/firebase-admin.json
```

On the phone:

```bash
chmod 600 ~/Spararama/.env
chmod 600 ~/.spararama/credentials/firebase-admin.json
```

The phone-specific `.env` values should include:

```env
TELEMETRY_HOST_ID="spararama-a17"
GOOGLE_APPLICATION_CREDENTIALS="/data/data/com.termux/files/home/.spararama/credentials/firebase-admin.json"
```

Do not commit `.env` or the Admin JSON credential.

If `server-setup.sh --host-id spararama-a17` is run after these files exist, it
will set those two machine-specific paths automatically without displaying or
changing the credential contents.

Verify Firebase from Termux:

```bash
cd ~/Spararama
pnpm firebase:diagnose
```

A healthy result ends with a successful diagnostic write/read/delete.

Then verify the running collector:

```bash
curl -s http://127.0.0.1:3000/api/telemetry/status | python -m json.tool
```

Important fields should look like:

```text
"collectorHostId": "spararama-a17"
"firebaseEnabled": true
"firebaseCredentialSource": "GOOGLE_APPLICATION_CREDENTIALS (file present)"
"pendingUploads": 0
```

## 6. Live CleverSpa mode

Switch the phone to the real spa connector while it is on the spa's home LAN:

```bash
spar live
```

Check it:

```bash
spar status
```

A healthy result is similar to:

```text
Mode: bridge
Spararama: running at http://127.0.0.1:3000
Termux wake lock: requested
CleverSpa: connected to live spa
```

The live architecture remains deliberately split:

```text
browser -> Spararama :3000 -> CleverSpa adapter :8787 -> Gizwits LAN -> spa
```

The CleverSpa adapter is bound to loopback on the phone; port 8787 does not need
to be exposed to the LAN.

## 7. Automatic startup after a phone reboot

`scripts/termux/server-setup.sh` installs:

```text
~/.termux/boot/10-spararama
```

The boot script:

1. requests a wake lock;
2. starts `termux-services`;
3. brings up the enabled `sshd` service;
4. waits 15 seconds for Android/Wi-Fi to settle;
5. runs `spar start` using the last persisted connector mode;
6. writes status to a boot log.

The fixed delay is intentional. Some current Android builds block Termux's netlink
interface queries, so testing `ip route`/`wlan0` can incorrectly wait forever even
when Wi-Fi is fine.

Test the boot script manually first:

```bash
~/.termux/boot/10-spararama
```

Then inspect:

```bash
tail -n 50 ~/.local/state/spararama-phone/boot.log
```

A successful end looks roughly like:

```text
Starting Spararama...
Spararama is already running: http://127.0.0.1:3000
CleverSpa: connected to live spa

Final status:
Mode: bridge
Spararama: running at http://127.0.0.1:3000
Termux wake lock: requested
CleverSpa: connected to live spa
Boot startup complete: ...
```

Then do the real test:

1. reboot the phone;
2. do not manually open Termux;
3. wait around 30-60 seconds;
4. from the laptop run `ssh spararama`;
5. run `spar status`;
6. open `http://192.168.0.126:3000`.

On the Google Play Termux build, boot functionality is integrated into Termux.
On traditional F-Droid installations, install/open the matching Termux:Boot add-on
once so Android grants it boot-start behaviour.

## 8. Quick diagnostics

The repository includes:

```bash
bash scripts/termux/server-check.sh
```

It reports:

- Termux user/version and Android model;
- whether the boot script exists;
- `sshd` service state;
- `spar status`;
- local HTTP health;
- telemetry API availability;
- recent boot-log lines.

### SSH says `Connection refused`

The address is usually reachable, but nothing is listening on port 8022.

On the phone:

```bash
sv status sshd
sv up sshd
```

Test locally on the phone:

```bash
ssh -p 8022 localhost
```

If local SSH works, investigate LAN addressing/access-point configuration next.

### SSH says `Connection timed out`

First verify the phone still has the reserved LAN address in Android Wi-Fi settings.
A timeout is more suggestive of a network path problem than an sshd process problem.

If the phone moved near another access point with the same SSID, confirm it did not
roam onto a separate subnet/router and that AP isolation is not enabled.

### Spararama page does not open

On the phone:

```bash
spar status
curl -fsS http://127.0.0.1:3000/api/health
```

If needed:

```bash
spar restart
```

Logs:

```bash
spar log
spar adapter-log
```

### `spar stop` / restart behaviour

The Termux runner tracks the detached process group and also cleans up repo-owned
Node descendants, because pnpm/tsx can re-parent child processes on Android. It also
allows a slower Android phone roughly a minute to become healthy before declaring a
startup failure.

### Firebase telemetry check

```bash
pnpm firebase:diagnose
curl -s http://127.0.0.1:3000/api/telemetry/status | python -m json.tool
```

The always-on telemetry collector does not require a browser user to be signed in.
Browser account sign-in is a separate identity used for personal UI activity logs.

## 9. Security and maintenance

- Do not port-forward Spararama port 3000 or SSH port 8022 directly to the internet.
- Prefer SSH keys rather than a reusable password.
- Keep Firebase Admin credentials outside Git and mode `600`.
- Keep the CleverSpa adapter loopback-only unless there is a deliberate reason to
  change the architecture.
- Keep the phone on a charger, but avoid burying it somewhere hot; an old phone
  continuously charging and running a Node service still needs ventilation.
- Periodically update Termux packages and Spararama, but normal `spar start` at boot
  deliberately does not depend on GitHub being reachable.

To update Spararama manually:

```bash
cd ~/Spararama
spar
```

The normal bare `spar` path updates `chatgpt-dev` before restarting. If GitHub is
unavailable, the update is attempted before the working server is stopped, so an
existing instance is not needlessly taken down.
