# Spararama TODO

Outstanding ideas and follow-up work discussed but not yet implemented or completed.

## Near-term priorities

- [ ] **Keep real telemetry running continuously and accumulate data.** This is the foundation for heating/cooling modelling and equipment-health analysis.
- [ ] **Implement bottle-specific test-strip swatches.** Let the user select a legend colour, a range swatch, or “between” adjacent swatches rather than forcing fake numeric precision.

## Chemistry and testing

- [ ] **Bottle-specific strip swatch profiles**
  - Store the actual printed legend for each test-strip bottle/test method.
  - Support exact-value swatches, range swatches, and “between swatch N and N+1”.
  - Use screen colours only as guidance, not calibrated truth.

- [ ] **Camera-assisted strip reading**
  - Add reference-card/calibration support.
  - Treat camera output as a low-confidence observation requiring human confirmation.
  - Never allow a camera-only reading to drive dosing directly.

- [ ] **Persistent chemistry workflow timers**
  - Move mixing/retest timers and workflow state into the always-on backend so they survive browser closure/restart.

## Heating and prediction

- [ ] **Complete “ready at <time>” automation**
  - Calculate required heat-start time.
  - Recalculate as conditions change.
  - Start heating automatically.
  - Hold the requested target temperature.

- [ ] **Learn real heating/cooling behaviour from telemetry**
  - Replace fixed assumptions with observed rates.
  - Model effects from ambient temperature, cover state, wind, solar load, bubbles and other relevant inputs.
  - Use accumulated real-world telemetry before over-engineering the model.

- [ ] **Weather ingestion**
  - Add current conditions and forecast adapters.
  - Retain multiple nearby weather sources where useful because no single station reliably represents the local microclimate.
  - Prefer local sensor observations over external weather for current conditions when available.

## History and actionable analytics

The Logs page now has visual Today / 2-day / week / month / year temperature views, a shape-preserving chart roll-up, heater-on shading, typical-use markers, manual-temperature points, and an initial water-balance chart. The following are the next questions rather than reasons to add more decoration immediately.

- [ ] **Detect explicit heating episodes and calculate useful outcomes**
  - Start temperature and target.
  - Time to target and °C/hour while actively heating.
  - Heater runtime and estimated/actual energy per degree gained.
  - Cooling rate after heater-off and overnight.
  - Water-to-air temperature difference during the episode.
  - Flag interruptions/outages rather than treating them as real flat temperature data.

- [ ] **Event-centred comparison views**
  - Compare heating runs aligned at heater-on or target-reached rather than only by calendar date.
  - Compare bathing sessions aligned at “got in”, especially temperature drop/recovery and chlorine demand.
  - Suggested questions: “Is it heating faster?”, “Did it retain heat better?”, “How long did recovery after bathing take?”.

- [ ] **Make interventions first-class experiment markers**
  - Record when a solar cover, insulation, different main cover, pump/filter change or other physical change starts being used.
  - Allow optional notes/tags such as `solar-cover`, `cover-off-sunny`, `new-filter`.
  - Compare before/after only against reasonably similar starting temperature/weather conditions.

- [ ] **Answer cover/solar questions with matched comparisons**
  - “Did the new solar cover reduce overnight heat loss?”
  - “On sunny days, is leaving the cover off a net heat gain or loss?”
  - Match or normalise for water-air temperature difference, wind, sunshine/solar radiation and starting water temperature instead of comparing arbitrary days.

- [ ] **Persist long-term telemetry roll-ups when the archive becomes large**
  - Current long charts roll raw telemetry up on demand while keeping the raw archive intact.
  - If the archive becomes expensive to scan, create derived hourly/daily summaries rather than deleting raw history.
  - Preserve state transitions plus first/min/max/last temperature; do not replace behaviour with a simple daily average.

- [ ] **Weather data and long-view roll-ups**
  - Collect historical ambient temperature, wind and ideally solar radiation/sunshine alongside spa telemetry.
  - For longer views, preserve temperature min/max plus a representative central value; retain meaningful wind peaks as well as typical wind; sum rainfall and solar energy over the bucket.
  - For heating analysis, derive water-minus-air temperature difference and solar input because they are more actionable than generic “weather”.
  - The Logs graph already renders outside temperature automatically if telemetry weather observations become available.

- [ ] **Expand the water-balance graph once more event data exists**
  - Add TA as a separate/selectable view rather than forcing it onto the pH/chlorine scales.
  - Show filtration periods, confirmed bathing periods, refills/dilution and flushes on the event strip.
  - Measure response to dosing: nearest valid test before dose → first valid post-mix/retest result.
  - Estimate chlorine decay between undosed tests and compare decay after bathing vs quiet periods.
  - Look for pH/TA drift and whether repeated corrections indicate a systematic setup issue.

- [ ] **Define the minimum event logging needed for useful comparisons**
  - Confirmed bathing start/end, not merely planned use.
  - Cover on/off where it materially affects heating/cooling.
  - Filtration state/duration around chemistry treatment.
  - Refill/dilution amount where known.
  - Exact completed chemical dose and time.
  - Physical changes/interventions with a start date.

## Sensors and microclimate

- [ ] **Generic local sensor ingestion**
  - Add adapters/endpoints for arbitrary patio/garden/greenhouse sensors.
  - Likely inputs: temperature, humidity, light, wind, motion, cover state, noise, soil data.
  - Preserve source metadata, timestamps and quality/confidence.

- [ ] **Cover-state sensing**
  - Investigate a cheap reed, tilt, light or equivalent sensor.
  - Feed cover state into heat-loss modelling.

- [ ] **Garden / greenhouse microclimate network** *(side project / deferred)*
  - Cheap Wi-Fi sensor nodes around the garden and greenhouses.
  - Outdoor AP should make this more practical than before.

## Equipment health and maintenance

- [ ] **Acoustic pump/filter diagnostics**
  - Foreground microphone test only.
  - Establish clean baseline signatures.
  - Detect rattle/abnormal spectral features locally.
  - Store derived numeric features rather than raw audio by default.

- [ ] **Persistent equipment runtime and maintenance model**
  - Track filter, heater and pump runtime across restarts.
  - Track time/hours since filter cleaning/replacement and other maintenance events.
  - Use this for maintenance reminders and eventual equipment-health analysis.

## Spa connectivity and backend

- [ ] **Consider merging the CleverSpa LAN implementation directly into Spararama** *(not urgent)*
  - Current architecture uses the existing recovery bridge on localhost.
  - Eventually a direct `CleverSpaAdapter` could remove the extra process while preserving the same generic adapter interface.
  - Do not prioritise this while the bridge is stable and useful.

- [ ] **Automatic machine startup**
  - Once manual start/stop/update flows are considered stable, choose and implement Windows Task Scheduler, Windows service or equivalent so the logger restarts automatically after reboot/login as appropriate.

- [ ] **Move always-on backend to a headless machine** *(future)*
  - Laptop is fine during development.
  - Later deploy the logger/API to a small always-on box once hardware/location is settled.

## Data and Firebase

- [ ] **Local authoritative database** *(longer term)*
  - Move from NDJSON/Firebase-as-working-store toward SQLite or Postgres as the authoritative local store.
  - Keep Firebase optional for offsite sync/user-facing data where useful.

- [ ] **Confirm Firebase legacy-log migration cleanup**
  - Ensure old global `/logs` data has been safely migrated.
  - Remove any temporary broad migration access rule once no longer needed.
  - Ensure migration cannot duplicate entries if rerun.

## Frontend authentication and developer workflow

- [ ] **Codex embedded-browser Google sign-in workaround** *(optional)*
  - Normal Chrome sign-in works; embedded Codex browser appears constrained by WebView/FedCM behaviour.
  - Possible future workaround: external-browser sign-in plus short-lived local pairing/session handoff.
  - Do not distort production authentication solely for this developer convenience unless it proves worthwhile.

## Voice control

- [ ] **Alexa integration** *(later)*
  - Custom skill / voice command for requests such as “ask Hot Tub to be ready at five”.
  - Translate voice time into the existing `readyAt` scheduling model.

## Deferred design principle

When deciding what to build next, prefer features that either:

1. make the current spa materially easier/safer to use now, or
2. start accumulating data that becomes more valuable with time.

Avoid diverting the main development line into garden-sensor or infrastructure side projects until the core spa telemetry, chemistry workflow and heating automation are solid.
