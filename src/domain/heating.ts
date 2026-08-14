export const DEFAULT_HEATING_REFERENCE_VOLUME_LITERS = 800;

export function volumeAdjustedHeatingRate(
  baseRateCPerHour: number,
  actualVolumeLiters: number,
  referenceVolumeLiters = DEFAULT_HEATING_REFERENCE_VOLUME_LITERS
) {
  const baseRate = Number.isFinite(baseRateCPerHour) && baseRateCPerHour > 0 ? baseRateCPerHour : 1.5;
  const actualVolume = Number.isFinite(actualVolumeLiters) && actualVolumeLiters > 0
    ? actualVolumeLiters
    : DEFAULT_HEATING_REFERENCE_VOLUME_LITERS;
  const referenceVolume = Number.isFinite(referenceVolumeLiters) && referenceVolumeLiters > 0
    ? referenceVolumeLiters
    : DEFAULT_HEATING_REFERENCE_VOLUME_LITERS;

  return baseRate * (referenceVolume / actualVolume);
}
