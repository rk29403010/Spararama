# Equipment catalogue and water volume

Spararama models spa/pool selection as catalogue data rather than hardware-specific UI.

Each catalogue model may provide:

- water-body type (`spa` or `pool`)
- manufacturer and model identifiers
- manufacturer-published capacity in litres
- Wi-Fi capability
- a Spararama connector ID when live integration exists
- max temperature, heater power or nominal heating rate when a reliable source is available
- source URLs and a checked date

The versioned fallback catalogue lives in `src/domain/equipmentCatalog.ts`. When backend Firebase Admin is enabled, the backend seeds and reads the same catalogue under `equipmentCatalog/{modelId}` in the configured named Firestore database. The bundled data remains available if Firebase is disabled or unreachable.

## Volume rule

The model's published capacity is the default. A user-entered volume is an explicit override for the actual fill/working volume.

The resolved value is stored in `WaterBodyProfile.volumeLiters` and is the authoritative runtime volume used for calculations.

```text
model capacity -> optional user override -> WaterBodyProfile.volumeLiters
                                             |                 |
                                             v                 v
                                      chemistry dosing    heating estimate
```

Chemical dose models already scale from their product-label reference volume to `WaterBodyProfile.volumeLiters`.

Heating scales the configured/reference heating rate inversely with actual water volume before ambient-temperature and wind adjustments. This is an interim physical approximation until learned heating curves replace the simple model.

## Connectivity rule

`wifi: true` means the manufacturer provides remote connectivity for that model. It does not imply Spararama can control it.

Live controls are enabled only when the catalogue model has a supported `connectorId`. The current implemented connector is `cleverspa`. Wi-Fi models without a Spararama connector are shown as Wi-Fi capable but remain manual within Spararama rather than accidentally using another manufacturer's adapter.
