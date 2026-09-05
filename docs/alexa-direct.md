# Direct Alexa integration

Spararama supports an additive direct Alexa path while retaining the existing Voice Monkey announcement path.

## Current boundary

```text
Voice commands
You -> Echo/Alexa -> Spararama Alexa Lambda -> /api/alexa/direct -> normal Spararama command/scheduler layer -> SpaAdapter -> spa

Announcements
Spararama -> Voice Monkey -> Echo/Alexa
```

Voice Monkey is deliberately not removed yet. The direct integration must first be tested against the real Alexa account and Echo devices. Once direct proactive Alexa announcements/state events are proven to cover the required cases, Voice Monkey can be retired without changing spa-control code.

## Native Smart Home endpoints

Discovery currently exposes three Alexa endpoints:

- `Hot Tub` - current water temperature and target temperature (`TemperatureSensor` + `ThermostatController`).
- `Hot Tub Bubbles` - on/off (`PowerController`).
- `Hot Tub Filter` - on/off (`PowerController`).

This is intended to support phrases such as:

- "Alexa, what's the temperature of the hot tub?"
- "Alexa, set the hot tub to 38 degrees."
- "Alexa, turn on hot tub bubbles."
- "Alexa, turn off hot tub filter."

Alexa device names can be shortened in the Alexa app after discovery if a phrase such as "Alexa, bubbles on" is preferred.

The capabilities are marked `retrievable` but not yet `proactivelyReported`. That is intentional: state queries and control responses can be validated before adding Alexa Event Gateway/ChangeReport complexity.

## Spararama custom voice model

The Multi-Capability Skill also has a UK custom model with invocation name `spararama`. It adds requests that the Smart Home model does not represent naturally, notably:

- "Alexa, ask Spararama to have the hot tub ready for five p m."
- "Alexa, ask Spararama to have the hot tub at 38 degrees by five p m."
- temperature/bubbles/filter/heater fallback commands.

`ReadyAtIntent` creates a normal Spararama heating schedule. It does not directly switch the spa outside the scheduler. Bubble commands also go through `BubbleSessionManager`, so firmware cooldown and the one-auto-restart policy are not bypassed.

Ready-time estimation now uses the same pure calculation in `src/domain/heating.ts` as the Heating UI. Both paths use the same volume adjustment, heat-soak allowance, temperature/wind/solar/precipitation adjustments and minimum effective heating-rate floor. Alexa obtains forecast data directly from the backend `WeatherService`; if weather is unavailable it deliberately falls back to the same neutral-weather assumptions as the UI.

The browser still owns user-editable app configuration, while Alexa runs without a browser, so Alexa needs server-side physical-profile values. Defaults mirror the current 800 L CleverSpa app profile: 1.5 C/hour at 800 L, 30-minute heat soak and 1800 W heater. They can be overridden with the `ALEXA_*` environment settings in `.env.example`. This is configuration duplication, not calculation duplication; the estimate algorithm itself has one implementation.

## Security and enabling

The public route is disabled by default. Enable it only on an HTTPS-reachable Spararama backend and configure a long random shared secret:

```text
ALEXA_DIRECT_ENABLED=true
ALEXA_DIRECT_PROXY_SECRET=<long random value>
ALEXA_SKILL_ID=<amzn1.ask.skill...>
SPARARAMA_TIME_ZONE=Europe/London
```

The Lambda gets the same secret plus the public route URL:

```text
SPARARAMA_ALEXA_URL=https://<host>/api/alexa/direct
SPARARAMA_ALEXA_PROXY_SECRET=<same long random value>
ALEXA_SKILL_ID=<same skill id>
```

Do not expose the local CleverSpa adapter or its port to the internet. Only the Spararama Alexa route is intended to be internet-facing, through the hosted/tunnel boundary chosen for the application.

Smart Home skills/add-ons require Alexa account linking. For initial private/development testing, configure account linking in the Alexa developer console and bind the Lambda trigger to this skill ID. The Spararama proxy secret is still required independently; account linking is not a substitute for protecting the backend route.

## Alexa developer setup

1. Create an Alexa skill with the Smart Home model and add a Custom model to make it a Multi-Capability Skill.
2. Add the `en-GB` interaction model from `services/alexa/skill-package/interactionModels/custom/en-GB.json`.
3. Create an AWS Lambda using a current Node.js runtime and upload `services/alexa/handler.mjs`; handler name `handler.handler`.
4. Configure the same Lambda ARN for both Smart Home and Custom endpoints.
5. Configure account linking as required by the Smart Home model.
6. Set the Lambda and Spararama environment variables above.
7. Enable `ALEXA_DIRECT_ENABLED` only when the Spararama HTTPS endpoint is ready.
8. Run Alexa discovery, then test state queries before control commands.
9. Test bubble cooldown behaviour through Alexa before considering the direct path validated.
10. Leave Voice Monkey enabled until outbound direct Alexa announcements have separately been proven.

The Amazon-facing Lambda is intentionally a thin proxy so all behaviour remains in the same Spararama command/safety layer used by the UI and scheduler.
