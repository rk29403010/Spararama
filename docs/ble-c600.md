# YINMIK BLE-C600 integration

Spararama supports the YINMIK BLE-C600 handheld Bluetooth water-quality meter as a user-present test accessory.

## Meter capability

The BLE-C600 reports:

- pH
- electrical conductivity (EC)
- total dissolved solids (TDS)
- salinity
- specific gravity (S.G.)
- oxidation-reduction potential (ORP)
- water temperature
- a raw battery-voltage value from which the current integration estimates battery percentage

It does **not** directly measure free chlorine. Spararama therefore must not infer that a BLE-C600-only test proves the sanitizer level is safe. For a chlorine spa, a BLE-C600 test that otherwise needs no chemistry adjustment continues to a free-chlorine test.

## Connection model

The meter is deliberately connected by the browser with Web Bluetooth rather than by the always-on backend.

This is a narrow exception to the normal spa-hardware rule in `architecture.md`:

- spa controllers and unattended sensors remain backend/API hardware integrations;
- the BLE-C600 is a handheld, user-present test instrument whose Bluetooth permission and native device chooser belong to the phone/laptop currently performing the test;
- its protocol code is isolated in `src/domain/bleC600Protocol.ts` and `src/lib/bleC600.ts` rather than being embedded in UI components;
- the browser releases the live GATT connection when the test screen is left;
- captured values enter the ordinary `WaterTestRecord` model with a source and an instrument snapshot.

There is no background BLE-C600 telemetry and the meter is not used to control the spa.

## Pair / test / forget

Settings contains a **BLE-C600 meter** section.

First use:

1. Turn the meter on.
2. Long-press `ON/OFF` until the Bluetooth symbol appears on the meter.
3. Tap **Pair & test meter**.
4. The browser/operating system Bluetooth chooser opens. Select the BLE-C600.
5. Spararama connects, reads a frame and displays the decoded values.
6. Compare the first live values against the meter display before relying on them.

The user does not need to pre-pair the meter in Android Bluetooth Settings. Web Bluetooth deliberately uses its own native permission/device chooser.

After permission has been granted, Spararama uses `navigator.bluetooth.getDevices()` where available to reconnect to the previously authorised meter without showing the chooser every time.

**Disconnect** releases the live GATT connection but keeps browser permission for easy reuse.

**Unpair / forget** disconnects and calls `BluetoothDevice.forget()` when the browser implements it. If that API is unavailable, Spararama clears its own preferred-device record and explains that the browser/site Bluetooth permission may still need to be cleared manually.

A normal web page cannot reliably launch a specific Android Settings activity across browsers/Android versions, so Spararama does not use a brittle `intent:` deep link. If Bluetooth itself is switched off and the native chooser does not offer to enable it, the UI directs the user to Android Quick Settings.

## Secure-context requirement

Web Bluetooth is a secure-context API.

Supported examples:

- `https://...`
- `http://localhost:...`
- `http://127.0.0.1:3000`

An ordinary plain-HTTP LAN address such as `http://192.168.x.x:3000` is not a secure context and cannot directly use Web Bluetooth.

The supported Termux phone runner opens the local phone instance at `http://127.0.0.1:3000`, which is suitable for the phone-local meter workflow.

## Water-test workflow

`Water -> Start test -> BLE-C600` uses the previously authorised meter if available. If it is not yet authorised on that browser/device, the flow presents a Pair button.

While the screen is open Spararama polls the meter about once per second and displays the current values. **Use meter reading** records:

- pH as a normal chemistry `MeasurementReading` with source `ble_meter`;
- the complete instrument snapshot containing pH, ORP, temperature, EC, TDS, salinity, S.G., battery estimate, raw BLE frame and decoded frame.

Only pH currently participates directly in dosing decisions. ORP, EC, TDS, salinity and S.G. are retained for history/analysis until their behaviour on this physical unit and this spa has been characterised. Do not derive chlorine dosing from ORP alone.

## BLE protocol

Observed BLE local name prefix:

```text
BLE-C600
```

Primary service:

```text
0000ff01-0000-1000-8000-00805f9b34fb
```

Reading characteristic:

```text
0000ff02-0000-1000-8000-00805f9b34fb
```

The characteristic returns a 24-byte obfuscated frame. `src/domain/bleC600Protocol.ts` implements the independently reverse-engineered decoder.

Decoded positions currently used:

| Bytes | Meaning | Scaling |
| --- | --- | --- |
| 3-4 | pH | / 100 |
| 5-6 | EC | raw displayed integer at normal range |
| 7-8 | TDS | raw displayed integer at normal range |
| 9-10 | salinity | raw displayed integer at normal range |
| 11-12 | auxiliary/variant field | retained raw; **not chlorine on this model** |
| 13-14 | temperature | / 10 °C |
| 15-16 | battery raw | estimate uses 1950-3190 raw endpoints |
| 17 | hold/backlight flags | bit fields |
| 18-19 | specific gravity | / 1000 |
| 20-21 | ORP | mV |
| 22-23 | mode/trailer | retained raw |

The decoder regression test uses a published BLE-C600 frame whose simultaneously displayed values were pH 8.56, EC 110, TDS 55, salinity 55, S.G. 0.999, ORP 141 mV and 26.0 °C.

### Still to validate on the physical meter

- exact EC/TDS/salinity unit/multiplier behaviour at higher ranges;
- usefulness of the battery-percentage estimate with three LR44 cells;
- practical BLE range;
- whether this firmware permits more than one simultaneous GATT central connection.

Assume a single live client until tested. Browser permission may be granted separately on both phone and laptop; whichever device is not actively connected can still retain permission for later use.

## Sources used during reverse engineering

- YINMIK BLE-C600 supplied instruction manual
- `Dutch-Al/BLE-C600` Home Assistant integration
- related open-source BLE-YC01 integrations using the same frame obfuscation
- published BLE-C600 GATT/Wireshark frame and matching display values
- Web Bluetooth API documentation for `requestDevice()`, `getDevices()` and `BluetoothDevice.forget()`
