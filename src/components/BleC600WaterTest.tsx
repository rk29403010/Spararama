import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bluetooth, CheckCircle2, RefreshCw } from 'lucide-react';
import type { InstrumentSnapshot, MeasurementReading } from '../domain/models';
import { bleC600, describeBleError, type BleC600Sample, type BleC600Support } from '../lib/bleC600';

interface BleC600WaterTestProps {
  onSubmit: (readings: MeasurementReading[], instrument: InstrumentSnapshot) => void;
}

function MeterValue({ label, value, unit, primary = false }: { label: string; value: string | number; unit?: string; primary?: boolean }) {
  return (
    <div className={`rounded-2xl border px-3 py-2 ${primary ? 'col-span-2 border-indigo-200 bg-indigo-50 text-center' : 'border-slate-200 bg-slate-50'}`}>
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`${primary ? 'text-5xl' : 'text-xl'} mt-0.5 font-black tabular-nums text-slate-950`}>{value}{unit && <span className={`${primary ? 'text-xl' : 'text-sm'} ml-1 text-slate-600`}>{unit}</span>}</div>
    </div>
  );
}

function instrumentSnapshot(sample: BleC600Sample): InstrumentSnapshot {
  return {
    kind: 'ble_c600',
    deviceId: sample.device.id,
    deviceName: sample.device.name,
    capturedAt: sample.capturedAt,
    measurements: [
      { key: 'ph', value: sample.reading.ph, unit: 'pH' },
      { key: 'orp', value: sample.reading.orpMv, unit: 'mV' },
      { key: 'temperature', value: sample.reading.temperatureC, unit: '°C' },
      { key: 'ec', value: sample.reading.ec, unit: 'µS/cm' },
      { key: 'tds', value: sample.reading.tds, unit: 'ppm' },
      { key: 'salinity', value: sample.reading.salinity, unit: 'ppm' },
      { key: 'specific_gravity', value: sample.reading.specificGravity },
      { key: 'battery', value: sample.reading.batteryPercent, unit: '%' }
    ],
    raw: {
      frameHex: sample.reading.rawHex,
      decodedHex: sample.reading.decodedHex,
      productCode: sample.reading.productCode,
      batteryRaw: sample.reading.batteryRaw,
      auxiliaryRaw: sample.reading.auxiliaryRaw,
      hold: sample.reading.hold,
      backlight: sample.reading.backlight,
      modeByte: sample.reading.modeByte,
      trailerByte: sample.reading.trailerByte
    }
  };
}

export function BleC600WaterTest({ onSubmit }: BleC600WaterTestProps) {
  const [support, setSupport] = useState<BleC600Support | null>(null);
  const [sample, setSample] = useState<BleC600Sample | null>(null);
  const [needsPairing, setNeedsPairing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const running = useRef(true);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const poll = async () => {
    if (!running.current) return;
    try {
      const next = await bleC600.read();
      if (!running.current) return;
      setSample(next);
      setMessage('');
      setNeedsPairing(false);
      pollTimer.current = window.setTimeout(() => void poll(), 1000);
    } catch (error) {
      if (!running.current) return;
      setMessage(describeBleError(error));
      pollTimer.current = window.setTimeout(() => void poll(), 2500);
    }
  };

  useEffect(() => {
    running.current = true;
    void (async () => {
      const nextSupport = await bleC600.support();
      if (!running.current) return;
      setSupport(nextSupport);
      if (!nextSupport.supported || !nextSupport.secureContext) return;

      try {
        const granted = await bleC600.grantedDevices();
        if (!running.current) return;
        if (granted.length === 0) {
          setNeedsPairing(true);
          return;
        }
        setMessage('Connecting…');
        await bleC600.connect();
        void poll();
      } catch (error) {
        if (!running.current) return;
        setMessage(describeBleError(error));
      }
    })();

    return () => {
      running.current = false;
      stopPolling();
      // Keep browser permission, but release the live GATT link so another client can use the pen.
      bleC600.disconnect();
    };
  }, []);

  const pair = async () => {
    setBusy(true);
    setMessage('');
    stopPolling();
    try {
      await bleC600.pairAndConnect();
      setNeedsPairing(false);
      const next = await bleC600.read();
      setSample(next);
      pollTimer.current = window.setTimeout(() => void poll(), 1000);
    } catch (error) {
      setMessage(describeBleError(error));
    } finally {
      setBusy(false);
    }
  };

  const readNow = async () => {
    setBusy(true);
    setMessage('');
    try {
      const next = await bleC600.read();
      setSample(next);
    } catch (error) {
      setMessage(describeBleError(error));
    } finally {
      setBusy(false);
    }
  };

  const useReading = () => {
    if (!sample || sample.reading.ph < 0 || sample.reading.ph > 14) return;
    onSubmit(
      [{ measurement: 'ph', value: sample.reading.ph, source: 'ble_meter', note: 'Direct BLE-C600 reading' }],
      instrumentSnapshot(sample)
    );
  };

  if (support && (!support.supported || !support.secureContext)) {
    return (
      <div className="space-y-4">
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-950 flex gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span>{!support.supported ? 'This browser cannot talk to Bluetooth LE devices. Open Spararama in Chrome.' : 'Bluetooth needs HTTPS or a localhost/127.0.0.1 Spararama address.'}</span>
        </div>
      </div>
    );
  }

  if (needsPairing) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
          <Bluetooth className="w-7 h-7 text-indigo-700 shrink-0" aria-hidden="true" />
          <div><div className="font-black text-slate-950">Turn the meter Bluetooth on</div><div className="mt-1 font-bold text-slate-600">Hold ON/OFF until the Bluetooth symbol appears, then pair below.</div></div>
        </div>
        <button type="button" disabled={busy} onClick={() => void pair()} className="w-full min-h-16 rounded-2xl bg-indigo-700 disabled:bg-slate-300 text-white text-xl font-black">{busy ? 'Connecting…' : 'Pair BLE-C600'}</button>
        {message && <div role="alert" className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 font-bold text-amber-950">{message}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-black text-slate-950">Dip to the immersion line</div>
          <div className="text-sm font-bold text-slate-600">Wait for the values to settle.</div>
        </div>
        <button type="button" disabled={busy} onClick={() => void readNow()} aria-label="Read meter now" className="w-12 h-12 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center"><RefreshCw className={`w-6 h-6 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
      </div>

      {sample ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <MeterValue label="pH" value={sample.reading.ph.toFixed(2)} primary />
            <MeterValue label="ORP" value={sample.reading.orpMv} unit="mV" />
            <MeterValue label="Temp" value={sample.reading.temperatureC.toFixed(1)} unit="°C" />
            <MeterValue label="EC" value={sample.reading.ec} unit="µS/cm" />
            <MeterValue label="TDS" value={sample.reading.tds} unit="ppm" />
          </div>
          <div className="flex items-center gap-2 text-sm font-black text-emerald-800"><CheckCircle2 className="w-5 h-5" aria-hidden="true" />Live BLE reading</div>
          <button type="button" onClick={useReading} className="w-full min-h-16 rounded-2xl bg-indigo-700 text-white text-xl font-black">Use meter reading</button>
        </>
      ) : (
        <div className="min-h-40 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-center px-5 font-black text-slate-600">Connecting to BLE-C600…</div>
      )}

      {message && <div role="alert" className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 font-bold text-amber-950">{message}</div>}
    </div>
  );
}
