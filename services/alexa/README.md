# Spararama Alexa Lambda proxy

This tiny AWS Lambda component is the Amazon-facing endpoint for Spararama's direct Alexa integration. It deliberately contains no spa logic. Alexa requests are forwarded to the main Spararama backend, where the normal adapter, bubble safety manager and heating scheduler execute them.

Use a current Node.js Lambda runtime and upload `handler.mjs`. Set the Lambda handler to `handler.handler`.

Environment variables:

- `SPARARAMA_ALEXA_URL` - public HTTPS URL ending `/api/alexa/direct`.
- `SPARARAMA_ALEXA_PROXY_SECRET` - long random secret matching `ALEXA_DIRECT_PROXY_SECRET` on the Spararama backend.
- `ALEXA_SKILL_ID` - the Alexa skill ID. Recommended for custom-skill request validation and also sent to Spararama for all requests.

For a Multi-Capability Skill, the same Lambda ARN can be configured as both the Smart Home and Custom model endpoint. The matching UK custom interaction model is in `skill-package/interactionModels/custom/en-GB.json`.

The direct integration is intentionally independent of Voice Monkey. Voice Monkey remains the current outbound-announcement transport until direct proactive Alexa speech/state reporting has been proven on the real account/devices.
