# Running Spararama continuously on an old Android phone

This guide turns a spare Android phone into a small always-on Spararama home server.

The example below uses a **Samsung Galaxy A17** and names the telemetry host
`spararama-a17`. The same approach works on many recent Android phones; Samsung menu
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

The always-on A71 normally uses `spar production`. This runs the built frontend
and bundled server with `NODE_ENV=production`; it does not leave Vite or `tsx`
running. `spar dev` remains available as a deliberate, persisted development
mode. A changed production build is completed and health-checked only after the
update/dependency work succeeds, before the old running server is stopped.

## 10. HTTPS for browser sign-in and LAN use

The original HTTP address is still supported. It is useful for a simple private
LAN deployment, but a raw LAN IP is not a suitable long-term Google OAuth web
origin. Google/Firebase browser sign-in needs a configured HTTPS origin with an
appropriate hostname; do not work around that by weakening Firebase rules or
placing credentials in the browser.

When HTTPS is enabled, the layout is deliberately:

```text
browser -> https://configured-host:8443 -> Caddy -> 127.0.0.1:3000 -> Spararama
                                                        -> 127.0.0.1:8787 -> CleverSpa
```

`spar https-setup` changes the Spararama backend to loopback-only. Caddy is the
only LAN-facing application listener. The CleverSpa adapter remains loopback-only
and is never exposed by the proxy.

The setup installs Caddy from the normal Termux package repository and runs it as
the `spararama-caddy` runit service, alongside the existing `sshd` supervision.
The generated Caddyfile and logs are phone-local:

```text
~/.config/spararama/phone.conf       host, mode and optional cert paths (mode 600)
~/.config/spararama/Caddyfile        generated proxy configuration (mode 600)
~/.local/state/spararama-phone/caddy.log
~/.local/state/spararama-phone/caddy-service.log
```

No hostname, private key, certificate, or DNS token is committed to the repo.

### Keep HTTP only

Do nothing after `server-setup.sh`; the default remains HTTP and existing LAN
URLs continue to work. To revert a configured proxy safely:

```bash
spar https-off
spar restart
```

This stops/removes the Caddy service definition and restores the backend's normal
LAN HTTP binding. It does not delete externally supplied certificate files.

### A. Private-LAN HTTPS using Caddy's internal CA

Choose a local DNS name that every client resolves to the phone's reserved LAN
address, for example `spararama.home.arpa`. Configure that mapping in your local
DNS service/router, not in the repository. Then run on the phone:

```bash
spar https-setup internal spararama.home.arpa
spar restart
spar status
```

Open `https://spararama.home.arpa:8443`. Caddy creates a local certificate
authority; each browser device must install and trust that CA before Chrome will
consider the site secure. On the phone, Caddy prints the local root location in
its logs. Transfer and install the public root certificate using your normal
trusted-device administration path; do not copy the CA private key.

This is useful for a controlled private LAN, but it is **not** sufficient for
production Google web sign-in: `.home.arpa` is not a publicly registrable domain
and Caddy's private CA is not publicly trusted.

### B. Real-domain HTTPS suitable for Google/Firebase sign-in

Use a real domain you control, such as `spararama.example.co.uk`, and configure
local DNS so that name resolves to the phone's private LAN address. A public DNS
record does not need to reveal the phone or point at a router public IP.

For a publicly trusted certificate without router port forwarding, obtain and
renew the certificate using a DNS-01 ACME workflow with the domain's own DNS
provider. DNS-01 proves domain control through a temporary DNS TXT record, so it
does not require an inbound HTTP connection to the phone.

The standard Termux Caddy package does not include a provider-neutral DNS API
configuration. DNS providers use different credentials/plugins, so Spararama does
not hard-code one or collect a DNS API token. Instead, keep the certificate and
key in a protected phone-local directory readable by Termux, then configure:

```bash
mkdir -p ~/.spararama/tls
chmod 700 ~/.spararama/tls
# Copy the externally provisioned full certificate and private key here.
chmod 600 ~/.spararama/tls/fullchain.pem ~/.spararama/tls/privkey.pem

spar https-setup external spararama.example.co.uk \
  ~/.spararama/tls/fullchain.pem ~/.spararama/tls/privkey.pem
spar restart
```

Set up an external renewal method appropriate to your DNS provider and rerun
`spar https-setup external ...` (or `sv restart spararama-caddy`) after it updates
the files. A successfully issued certificate continues to serve the local app
while the WAN or DNS provider is unavailable, until that certificate expires.

Do not expose Caddy, Spararama, SSH, or the router to the public Internet merely
to complete this. If a DNS provider later supplies a supported Caddy DNS module,
build/deploy that provider-specific Caddy separately and keep its API token in a
mode-600 phone-local secret; this repository intentionally has no generic token
setting.

### Current A71 / Cloudflare setup

The deployed A71 uses:

```text
Hostname:       spa.spararama.uk
LAN address:    192.168.0.126
Browser URL:    https://spa.spararama.uk:8443
Certificate:    Let's Encrypt, DNS-01 through Cloudflare
TLS directory:  ~/.spararama/tls/ (700; certificate and key files 600)
```

The public DNS record is DNS-only and points to the private LAN address. No
router ports are forwarded. Caddy deliberately disables its automatic port-80
redirect listener because unprivileged Termux cannot bind port 80 and the app's
intended origin includes port 8443.

The Cloudflare API token is stored only at
`~/.spararama/cloudflare/dns-token` (mode 600). It has Zone/DNS/Edit and
Zone/Zone/Read for `spararama.uk`. Never print the token or put it in a tracked
file. The first failed issuance was caused by the token value being pasted twice
back-to-back; Cloudflare returned error 6111 (invalid Authorization header),
which acme.sh surfaced only as `invalid domain`.

The deployed certificate paths are:

```text
~/.spararama/tls/fullchain.pem
~/.spararama/tls/privkey.pem
```

acme.sh's scheduled command is installed in the Termux crontab. The `crond`
runit service must remain enabled. acme.sh copies renewed material to the paths
above and its recorded reload command restarts the absolute
`$PREFIX/var/service/spararama-caddy` service. Renewal therefore does not restart
the Spararama backend or require an inbound connection. Check it without forcing
a new certificate order:

```bash
sv status "$PREFIX/var/service/crond"
~/.acme.sh/acme.sh --cron --home ~/.acme.sh
sv status "$PREFIX/var/service/spararama-caddy"
curl -fsS https://spa.spararama.uk:8443/api/health
```

The issued certificate remains usable during a Cloudflare/WAN outage until its
expiry. Local Spararama, telemetry archival and CleverSpa control do not depend
on Cloudflare being reachable.

### Google Cloud and Firebase Console setup

After real-domain HTTPS works in a browser, add the **exact** browser origin in
the Google OAuth client that owns the client ID in `src/lib/firebase.ts`:

```text
https://spa.spararama.uk:8443
```

The scheme, hostname and non-default port are all part of the origin. Do not add
`http://PHONE_IP:3000` as a production substitute.

Also add `spa.spararama.uk` (hostname only; no scheme or port) to Firebase
Authentication's **Authorized domains** list for the same Firebase project and
named Firestore database used by the app. No application-code change or browser
secret is required: the client uses its existing Google client ID and Firebase
configuration, while the server keeps using its independent Admin credential.

For the current deployment, `spa.spararama.uk` is already present in Firebase
Authentication's authorized-domain list. Google Identity Services still requires
the exact `https://spa.spararama.uk:8443` origin on the web OAuth client; the
callback-based sign-in used here does not require an authorized redirect URI.

### Diagnose HTTPS and reboot

On the phone:

```bash
spar status
bash scripts/termux/server-check.sh
sv status "$PREFIX/var/service/spararama-caddy"
tail -n 80 ~/.local/state/spararama-phone/caddy.log
tail -n 80 ~/.local/state/spararama-phone/caddy-service.log
```

`server-check.sh` tests the local Caddy-to-backend path with certificate checking
disabled only for diagnosis. A client trust warning therefore points to the CA or
certificate, while a proxy failure points to Caddy or the backend. If the hostname
opens on one Wi-Fi access point but not another, verify local DNS, router/AP
bridging, client isolation, and the current subnet before changing Spararama.

The existing boot script starts `spar start`; when HTTPS is enabled it brings the
runit Caddy service back up after the app backend passes its local health check.
After reboot, wait 30–60 seconds, run `spar status` over SSH, and open the HTTPS
URL from a client that resolves and trusts the configured hostname.
