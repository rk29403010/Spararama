# Direct Alexa integration

Spararama supports an additive direct Alexa path while retaining the existing Voice Monkey announcement path.

## Current boundary

```text
Voice commands
You -> Echo/Alexa -> Spararama Alexa Lambda -> protected HTTPS route -> /api/alexa/direct
    -> normal Spararama command/scheduler layer -> SpaAdapter -> spa

Announcements
Spararama -> Voice Monkey -> Echo/Alexa
```

Voice Monkey is deliberately not removed yet. The direct integration must first be tested against the real Alexa account and Echo devices. Once direct proactive Alexa announcements/state events are proven to cover the required cases, Voice Monkey can be retired without changing spa-control code.

## Native Smart Home endpoints

Discovery currently exposes three Alexa endpoints:

- `Hot Tub` - current water temperature and target temperature (`TemperatureSensor` + `ThermostatController`).
- `Hot Tub Bubbles` - on/off (`PowerController`).
- `Hot Tub Filter` - on/off (`PowerController`).

Intended phrases include:

- "Alexa, what's the temperature of the hot tub?"
- "Alexa, set the hot tub to 38 degrees."
- "Alexa, turn on hot tub bubbles."
- "Alexa, turn off hot tub filter."

The capabilities are `retrievable` but not yet `proactivelyReported`. Do not enable Alexa Event Gateway/Send Alexa Events for the first test; that would also require `AcceptGrant` handling.

## Spararama custom voice model

The Multi-Capability Skill also has a UK custom model with invocation name `spararama`. It adds requests the Smart Home model does not represent naturally, notably:

- "Alexa, ask Spararama to have the hot tub ready for five p m."
- "Alexa, ask Spararama to have the hot tub at 38 degrees by five p m."
- temperature/bubbles/filter/heater fallback commands.

The model is in:

```text
services/alexa/skill-package/interactionModels/custom/en-GB.json
```

`ReadyAtIntent` creates a normal Spararama heating schedule. Bubble commands go through `BubbleSessionManager`, so firmware cooldown and the one-auto-restart policy are not bypassed.

Ready-time estimation uses the same pure calculation in `src/domain/heating.ts` as the Heating UI. Both paths use the same volume adjustment, heat-soak allowance, temperature/wind/solar/precipitation adjustments and minimum effective heating-rate floor. Alexa obtains forecast data directly from the backend `WeatherService`; if weather is unavailable it deliberately falls back to the same neutral-weather assumptions as the UI.

The browser still owns user-editable app configuration, while Alexa runs without a browser, so Alexa needs server-side physical-profile values. Defaults mirror the current 800 L CleverSpa app profile: 1.5 C/hour at 800 L, 30-minute heat soak and 1800 W heater. They can be overridden with the `ALEXA_*` environment settings in `.env.example`. This is configuration duplication, not calculation duplication; the estimate algorithm itself has one implementation.

## Security

There are three separate checks in the first-test path:

1. Alexa invokes the Lambda configured for the specific Skill ID.
2. Lambda validates the linked-account token with Login with Amazon (LWA) and checks that the token belongs to `LWA_CLIENT_ID`.
3. Lambda calls Spararama with a long random `SPARARAMA_ALEXA_PROXY_SECRET`; the local route rejects requests without it.

The LWA access token is removed from the Alexa event before the event is forwarded to the Spararama backend.

The temporary Termux tunnel does **not** expose port 3000 directly. `services/alexa/local-proxy.mjs` binds to loopback and only accepts `POST /api/alexa/direct` (plus a local health check). The SSH tunnel points at that narrow proxy.

## First real Echo test - UK

These steps are deliberately aimed at the quickest private development test rather than publishing a public skill.

### 1. Create the Alexa skill

In the Alexa Developer Console:

1. Create a new skill called `Spararama`.
2. Start with the **Smart Home** model and your own backend resources.
3. Use English (UK) / `en-GB`.
4. Copy the Skill ID (`amzn1.ask.skill...`).
5. Do not enable Send Alexa Events/proactive events yet.

Then on the Termux phone, after pulling the current `chatgpt-dev` branch:

```bash
bash scripts/termux/alexa-test.sh setup amzn1.ask.skill.YOUR-ID-HERE
```

This generates/reuses a 32-byte random proxy secret in the ignored local `.env`, enables the direct Alexa route, restarts Spararama, and prints the values needed by Lambda. Voice Monkey is untouched.

### 2. Create Login with Amazon credentials

Smart Home account linking is mandatory. For the private proof, use Login with Amazon rather than building a separate OAuth service.

In Developer Console -> Apps & Services -> Login with Amazon:

1. Create a Security Profile named `Spararama Alexa`.
2. Description: `Private Spararama hot tub voice control`.
3. A Consent Privacy Notice URL is mandatory. For development-only testing, Amazon's current Smart Home tutorial uses `https://example.com`; replace this with a real Spararama privacy notice before any public distribution.
4. Save and copy the LWA **Client ID** and **Client Secret**.

In the Alexa skill's Account Linking configuration use:

```text
Authorization Grant Type: Auth Code Grant
Web Authorization URI: https://www.amazon.com/ap/oa
Access Token URI: https://api.amazon.com/auth/o2/token
Client ID: <LWA client ID>
Client Secret: <LWA client secret>
Client Authentication Scheme: HTTP Basic
Scope: profile:user_id
```

Copy the Alexa Redirect URLs shown by the skill. In the LWA Security Profile, open Web Settings and add those URLs as Allowed Return URLs.

### 3. Create the AWS Lambda

For an English (UK) Smart Home skill use AWS region **EU (Ireland) / `eu-west-1`**.

Create a Lambda named `spararama-alexa` with a current supported Node.js runtime. Suggested first-test configuration:

```text
Memory: 256 MB
Timeout: 8 seconds
Architecture: default is fine
```

Upload `services/alexa/handler.mjs` as `handler.mjs` and set the Lambda handler to:

```text
handler.handler
```

Set these environment variables:

```text
ALEXA_SKILL_ID=<amzn1.ask.skill...>
SPARARAMA_ALEXA_PROXY_SECRET=<printed by alexa-test.sh setup>
LWA_CLIENT_ID=<Login with Amazon client ID>
SPARARAMA_ALEXA_URL=<filled in after starting the temporary tunnel>
```

Add an **Alexa Smart Home** trigger restricted to the Skill ID. When the Custom model is added below, also configure the normal Alexa Skills Kit/Custom endpoint for the same Lambda and Skill ID.

### 4. Add the Custom model to make the skill Multi-Capability

Back in the Alexa Developer Console:

1. Add a **Custom** model to the same skill.
2. Configure the Custom endpoint to use the same Lambda ARN.
3. In the JSON editor paste `services/alexa/skill-package/interactionModels/custom/en-GB.json`.
4. Save and build the model.
5. Make sure the Smart Home endpoint also uses the `eu-west-1` Lambda ARN.

The same Lambda handles both model types and forwards all actual spa behaviour to Spararama.

### 5. Give Lambda a temporary HTTPS route to the phone

Keep `spar live` running and verify the phone is connected to the real spa. In another Termux session run:

```bash
bash scripts/termux/alexa-test.sh tunnel
```

If necessary the helper installs the Termux SSH client. It starts the Alexa-only loopback proxy, then opens a temporary localhost.run reverse tunnel. localhost.run prints an address similar to:

```text
https://something.localhost.run
```

Set Lambda's environment variable to:

```text
SPARARAMA_ALEXA_URL=https://something.localhost.run/api/alexa/direct
```

Keep the tunnel command running during the test. `Ctrl+C` closes it. This tunnel is for proving the Alexa path, not the permanent hosting architecture.

### 6. Link and discover

Enable the development skill for the same Amazon account used by the Echo/Alexa app and complete the Login with Amazon account-linking consent. Then run Smart Home device discovery.

Expected discovered devices:

```text
Hot Tub
Hot Tub Bubbles
Hot Tub Filter
```

First test only a read:

```text
Alexa, what's the hot tub temperature?
```

Once that returns the real water temperature, test filter/bubbles control and finally the custom `ready for` command.

## Useful phone commands

```bash
# configure/reconfigure the Skill ID and local secret
bash scripts/termux/alexa-test.sh setup <skill-id>

# reprint Lambda values, including the secret
bash scripts/termux/alexa-test.sh lambda-env

# show local state without revealing the secret
bash scripts/termux/alexa-test.sh status

# start the temporary HTTPS tunnel
bash scripts/termux/alexa-test.sh tunnel

# disable direct Alexa; Voice Monkey is left alone
bash scripts/termux/alexa-test.sh disable
```

## Normal backend variables

For a later permanent HTTPS deployment, Spararama itself still uses:

```text
ALEXA_DIRECT_ENABLED=true
ALEXA_DIRECT_PROXY_SECRET=<long random value>
ALEXA_SKILL_ID=<amzn1.ask.skill...>
SPARARAMA_TIME_ZONE=Europe/London
```

The Lambda uses:

```text
SPARARAMA_ALEXA_URL=https://<host>/api/alexa/direct
SPARARAMA_ALEXA_PROXY_SECRET=<same long random value>
ALEXA_SKILL_ID=<same skill id>
LWA_CLIENT_ID=<Login with Amazon client ID>
```

Do not expose the CleverSpa adapter or its port to the internet.
