import {
  BLE_C600_CHARACTERISTIC_UUID,
  BLE_C600_NAME_PREFIX,
  BLE_C600_SERVICE_UUID,
  decodeBleC600Frame,
  type BleC600Reading
} from '../domain/bleC600Protocol';

const PREFERRED_DEVICE_ID_KEY = 'spararama.bleC600.preferredDeviceId';
const PREFERRED_DEVICE_NAME_KEY = 'spararama.bleC600.preferredDeviceName';

interface BluetoothCharacteristicLike {
  readValue(): Promise<DataView>;
}

interface BluetoothServiceLike {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike>;
}

interface BluetoothGattLike {
  connected: boolean;
  connect(): Promise<BluetoothGattLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothServiceLike>;
}

interface BluetoothDeviceLike extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothGattLike;
  forget?: () => Promise<void>;
}

interface BluetoothApiLike {
  requestDevice(options: {
    filters: Array<{ namePrefix?: string; services?: string[] }>;
    optionalServices?: string[];
  }): Promise<BluetoothDeviceLike>;
  getDevices?: () => Promise<BluetoothDeviceLike[]>;
  getAvailability?: () => Promise<boolean>;
}

export interface BleC600Support {
  supported: boolean;
  secureContext: boolean;
  available?: boolean;
}

export interface BleC600DeviceInfo {
  id: string;
  name: string;
  connected: boolean;
}

export interface BleC600Sample {
  capturedAt: number;
  device: BleC600DeviceInfo;
  reading: BleC600Reading;
}

export interface BleC600ForgetResult {
  forgotten: boolean;
  browserPermissionRevoked: boolean;
}

function bluetoothApi(): BluetoothApiLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { bluetooth?: BluetoothApiLike }).bluetooth;
}

function preferredDeviceId() {
  try { return window.localStorage.getItem(PREFERRED_DEVICE_ID_KEY); }
  catch { return null; }
}

function rememberDevice(device: BluetoothDeviceLike) {
  try {
    window.localStorage.setItem(PREFERRED_DEVICE_ID_KEY, device.id);
    window.localStorage.setItem(PREFERRED_DEVICE_NAME_KEY, device.name || BLE_C600_NAME_PREFIX);
  } catch {
    // Remembering the permission choice is only a convenience; browser permission remains authoritative.
  }
}

function clearRememberedDevice() {
  try {
    window.localStorage.removeItem(PREFERRED_DEVICE_ID_KEY);
    window.localStorage.removeItem(PREFERRED_DEVICE_NAME_KEY);
  } catch {
    // Best effort only.
  }
}

function matchesC600(device: BluetoothDeviceLike) {
  const preferred = preferredDeviceId();
  return device.id === preferred || (device.name || '').startsWith(BLE_C600_NAME_PREFIX);
}

function info(device: BluetoothDeviceLike): BleC600DeviceInfo {
  return {
    id: device.id,
    name: device.name || BLE_C600_NAME_PREFIX,
    connected: Boolean(device.gatt?.connected)
  };
}

class BleC600Manager {
  private device: BluetoothDeviceLike | null = null;
  private characteristic: BluetoothCharacteristicLike | null = null;

  get currentDevice() {
    return this.device ? info(this.device) : null;
  }

  async support(): Promise<BleC600Support> {
    const api = bluetoothApi();
    const supported = Boolean(api);
    const secureContext = typeof window !== 'undefined' ? window.isSecureContext : false;
    if (!api) return { supported, secureContext };

    try {
      const available = api.getAvailability ? await api.getAvailability() : true;
      return { supported, secureContext, available };
    } catch {
      return { supported, secureContext };
    }
  }

  async grantedDevices(): Promise<BleC600DeviceInfo[]> {
    const api = bluetoothApi();
    if (!api?.getDevices) return this.device ? [info(this.device)] : [];
    const devices = (await api.getDevices()).filter(matchesC600);
    return devices.map(info);
  }

  private async grantedDeviceObjects(): Promise<BluetoothDeviceLike[]> {
    const api = bluetoothApi();
    if (!api?.getDevices) return this.device ? [this.device] : [];
    return (await api.getDevices()).filter(matchesC600);
  }

  async pairAndConnect() {
    const api = bluetoothApi();
    if (!api) throw new Error('Web Bluetooth is not available in this browser.');
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new Error('Bluetooth needs HTTPS or a localhost/127.0.0.1 Spararama address.');
    }

    const device = await api.requestDevice({
      filters: [{ namePrefix: BLE_C600_NAME_PREFIX }],
      optionalServices: [BLE_C600_SERVICE_UUID]
    });
    rememberDevice(device);
    await this.connectDevice(device);
    return info(device);
  }

  async connect() {
    if (this.device?.gatt?.connected && this.characteristic) return info(this.device);

    const granted = await this.grantedDeviceObjects();
    const preferred = preferredDeviceId();
    const device = granted.find(candidate => candidate.id === preferred) ?? granted[0];
    if (!device) {
      throw new Error('BLE-C600 has not been paired with Spararama on this device.');
    }

    await this.connectDevice(device);
    return info(device);
  }

  private async connectDevice(device: BluetoothDeviceLike) {
    if (!device.gatt) throw new Error('The selected Bluetooth device does not expose a GATT connection.');

    if (this.device && this.device !== device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }

    this.device = device;
    this.characteristic = null;
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_C600_SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(BLE_C600_CHARACTERISTIC_UUID);
    device.addEventListener('gattserverdisconnected', () => {
      if (this.device === device) this.characteristic = null;
    }, { once: true });
  }

  async read(): Promise<BleC600Sample> {
    if (!this.device?.gatt?.connected || !this.characteristic) await this.connect();
    if (!this.device || !this.characteristic) throw new Error('BLE-C600 is not connected.');

    try {
      const value = await this.characteristic.readValue();
      return { capturedAt: Date.now(), device: info(this.device), reading: decodeBleC600Frame(value) };
    } catch (firstError) {
      // BLE links frequently go stale when a phone sleeps or the pen cycles Bluetooth.
      this.characteristic = null;
      if (this.device.gatt?.connected) this.device.gatt.disconnect();
      try {
        await this.connectDevice(this.device);
        const value = await this.characteristic!.readValue();
        return { capturedAt: Date.now(), device: info(this.device), reading: decodeBleC600Frame(value) };
      } catch {
        throw firstError;
      }
    }
  }

  disconnect() {
    this.characteristic = null;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  async forget(): Promise<BleC600ForgetResult> {
    const devices = this.device ? [this.device] : await this.grantedDeviceObjects();
    const device = devices[0];
    this.disconnect();
    clearRememberedDevice();

    if (!device) {
      this.device = null;
      return { forgotten: true, browserPermissionRevoked: true };
    }

    if (typeof device.forget === 'function') {
      await device.forget();
      this.device = null;
      return { forgotten: true, browserPermissionRevoked: true };
    }

    this.device = null;
    return { forgotten: true, browserPermissionRevoked: false };
  }
}

export const bleC600 = new BleC600Manager();

export function describeBleError(error: unknown) {
  if (!(error instanceof Error)) return 'Bluetooth operation failed.';
  if (error.name === 'NotFoundError') return 'No meter selected. Turn on the BLE-C600 Bluetooth symbol and try again.';
  if (error.name === 'SecurityError') return 'Bluetooth access is blocked for this Spararama page.';
  if (error.name === 'NetworkError') return 'Could not connect to the meter. Make sure no other phone or computer is using it.';
  return error.message || 'Bluetooth operation failed.';
}
