export const BLE_C600_SERVICE_UUID = '0000ff01-0000-1000-8000-00805f9b34fb';
export const BLE_C600_CHARACTERISTIC_UUID = '0000ff02-0000-1000-8000-00805f9b34fb';
export const BLE_C600_NAME_PREFIX = 'BLE-C600';

const BATTERY_RAW_EMPTY = 1950;
const BATTERY_RAW_FULL = 3190;
const FRAME_LENGTH = 24;

export interface BleC600Reading {
  protocolByte: number;
  constantByte: number;
  productCode: number;
  ph: number;
  ec: number;
  tds: number;
  salinity: number;
  auxiliaryRaw: number;
  temperatureC: number;
  batteryRaw: number;
  batteryPercent: number;
  hold: boolean;
  backlight: boolean;
  specificGravity: number;
  orpMv: number;
  modeByte: number;
  trailerByte: number;
  rawHex: string;
  decodedHex: string;
}

function asBytes(frame: ArrayLike<number> | DataView): Uint8Array {
  if (frame instanceof DataView) {
    return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  }
  return Uint8Array.from(frame);
}

function toHex(bytes: ArrayLike<number>) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function signedInt16(bytes: ArrayLike<number>, offset: number) {
  const unsigned = ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff);
  return unsigned & 0x8000 ? unsigned - 0x10000 : unsigned;
}

export function decodeBleC600Bytes(frame: ArrayLike<number> | DataView): Uint8Array {
  const input = asBytes(frame);
  if (input.length < FRAME_LENGTH) {
    throw new Error(`BLE-C600 frame is ${input.length} bytes; expected at least ${FRAME_LENGTH}.`);
  }

  const decoded = Array.from(input.slice(0, FRAME_LENGTH));

  // The meter obfuscates adjacent bits in the 24-byte FF02 value. This is the
  // inverse used by the independently reverse-engineered C600/YC01 integrations.
  for (let index = decoded.length - 1; index > 0; index -= 1) {
    const current = decoded[index];
    const currentHi = (current & 0x55) << 1;
    const currentLo = (current & 0xaa) >> 1;
    const previous = decoded[index - 1];
    const previousHi = (previous & 0x55) << 1;
    const previousLo = (previous & 0xaa) >> 1;

    decoded[index] = 0xff - (currentHi | previousLo);
    decoded[index - 1] = 0xff - (previousHi | currentLo);
  }

  return Uint8Array.from(decoded);
}

export function decodeBleC600Frame(frame: ArrayLike<number> | DataView): BleC600Reading {
  const raw = asBytes(frame).slice(0, FRAME_LENGTH);
  const decoded = decodeBleC600Bytes(raw);
  const batteryRaw = signedInt16(decoded, 15);
  const batteryPercent = Math.min(
    100,
    Math.max(0, Math.round(100 * (batteryRaw - BATTERY_RAW_EMPTY) / (BATTERY_RAW_FULL - BATTERY_RAW_EMPTY)))
  );

  return {
    protocolByte: decoded[0],
    constantByte: decoded[1],
    productCode: decoded[2],
    ph: signedInt16(decoded, 3) / 100,
    ec: signedInt16(decoded, 5),
    tds: signedInt16(decoded, 7),
    salinity: signedInt16(decoded, 9),
    auxiliaryRaw: signedInt16(decoded, 11),
    temperatureC: signedInt16(decoded, 13) / 10,
    batteryRaw,
    batteryPercent,
    hold: (decoded[17] >> 4) !== 0,
    backlight: ((decoded[17] & 0x0f) >> 3) !== 0,
    specificGravity: signedInt16(decoded, 18) / 1000,
    orpMv: signedInt16(decoded, 20),
    modeByte: decoded[22],
    trailerByte: decoded[23],
    rawHex: toHex(raw),
    decodedHex: toHex(decoded)
  };
}
