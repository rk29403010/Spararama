import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bluetooth, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';
import { bleC600, describeBleError, type BleC600DeviceInfo, type BleC600Sample, type BleC600Support } from '../lib/bleC600';

function ReadingCell({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="min-h-16 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-black tabular-nums text-slate-950">{value}{unit && <span className="ml-1 text-sm text-slate-600">{unit}</span>}</div>
    </div>
  );
}

export function BleC600Settings() {
  const [support, setSupport] = useState<BleC600Support | null>(null);
  const [devices, setDevices] = useState<BleC600DeviceInfo[]>([]);
  const [sample, setSample] = useState<BleC600Sample | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    const nextSupport = await bleC600.support();
    setSupport(nextSupport);
    if (!nextSupport.supported || !nextSupport.secureContext) {
      setDevices([]);
      return;
    }
    try { setDevices(await bleC600.grantedDevices()); }
    catch { setDevices([]); }
  };

  useEffect(() => { void refresh(); }, []);

  const pairAndTest = async () => {
    setBusy(true);
    setMessage('');
    try {
      await bleC600.pairAndConnect();
      const nextSample = await bleC600.read();
      setSample(nextSample);
      setMessage('Meter connected and decoded. Compare these values with the meter display once.');
      await refresh();
    } catch (error) {
      setMessage(describeBleError(error));
    } finally {
      setBusy(false);
    }
  };

  const testMeter = async () => {
    setBusy(true);
    setMessage('');
    try {
      const nextSample = await bleC600.read();
      setSample(nextSample);
      setMessage('Live frame read successfully.');
      await refresh();
    } catch (error) {
      setMessage(describeBleError(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    bleC600.disconnect();
    setMessage('Disconnected. The pairing permission is kept for quick reconnect.');
    await refresh();
  };

  const unpair = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await bleC600.forget();
      setSample(null);
      setMessage(result.browserPermissionRevoked
        ? 'Meter forgotten. The next connection will show the Bluetooth chooser again.'
        : 'Disconnected, but this browser cannot revoke the saved device permission automatically. Clear this site’s Bluetooth-device permission in Chrome if you need a full reset.');
      await refresh();
    } catch (error) {
      setMessage(describeBleError(error));
    } finally {
      setBusy(false);
    }
  };

  const paired = devices.length > 0;
  const connected = devices.some(device => device.connected) || Boolean(sample?.device.connected);

  return (
    <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-4" data-no-tab-swipe>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-11 h-11 shrink-0 rounded-xl bg-indigo-50 text-indigo-800 flex items-center justify-center"><Bluetooth className="w-6 h-6" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h3 className="text-xl font-black text-slate-950">BLE-C600 meter</h3>
            <p className="text-sm font-bold text-slate-600 truncate">{paired ? (devices[0]?.name || 'BLE-C600') : 'Not paired on this device'}</p>
          </div>
        </div>
        {paired && (
          <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-black ${connected ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>
            {connected ? 'Connected' : 'Paired'}
          </span>
        )}
      </div>

      {support && (!support.supported || !support.secureContext) && (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 font-bold">
          <div className="flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" /><span>{!support.supported ? 'This browser does not provide Web Bluetooth. Use Chrome or another Web-Bluetooth-capable browser.' : 'Bluetooth needs HTTPS, localhost or 127.0.0.1. A plain LAN http:// address cannot use the meter.'}</span></div>
        </div>
      )}

      {support?.supported && support.secureContext && support.available === false && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">Bluetooth appears to be off. Pair/Test will normally invoke Android or Chrome’s native Bluetooth UI; if it does not, turn Bluetooth on from Quick Settings.</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {!paired ? (
          <button type="button" disabled={busy || !support?.supported || !support.secureContext} onClick={() => void pairAndTest()} className="col-span-2 min-h-14 rounded-xl bg-indigo-700 disabled:bg-slate-300 text-white font-black">
            {busy ? 'Connecting…' : 'Pair & test meter'}
          </button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => void testMeter()} className="min-h-14 rounded-xl bg-indigo-700 disabled:bg-slate-300 text-white font-black flex items-center justify-center gap-2"><RefreshCw className={`w-5 h-5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />Test meter</button>
            <button type="button" disabled={busy} onClick={() => void disconnect()} className="min-h-14 rounded-xl bg-slate-100 text-slate-800 font-black">Disconnect</button>
            <button type="button" disabled={busy} onClick={() => void unpair()} className="col-span-2 min-h-12 rounded-xl text-rose-800 font-black flex items-center justify-center gap-2"><Trash2 className="w-5 h-5" aria-hidden="true" />Unpair / forget</button>
          </>
        )}
      </div>

      {message && <div role="status" className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">{message}</div>}

      {sample && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-800 font-black"><CheckCircle2 className="w-5 h-5" aria-hidden="true" />Decoded live reading</div>
          <div className="grid grid-cols-2 gap-2">
            <ReadingCell label="pH" value={sample.reading.ph.toFixed(2)} />
            <ReadingCell label="ORP" value={sample.reading.orpMv} unit="mV" />
            <ReadingCell label="Temp" value={sample.reading.temperatureC.toFixed(1)} unit="°C" />
            <ReadingCell label="EC" value={sample.reading.ec} unit="µS/cm" />
            <ReadingCell label="TDS" value={sample.reading.tds} unit="ppm" />
            <ReadingCell label="Salt" value={sample.reading.salinity} unit="ppm" />
            <ReadingCell label="S.G." value={sample.reading.specificGravity.toFixed(3)} />
            <ReadingCell label="Battery" value={sample.reading.batteryPercent} unit="%" />
          </div>
          <details className="rounded-xl border border-slate-200 px-3">
            <summary className="min-h-11 cursor-pointer flex items-center font-black text-slate-700">Protocol diagnostic</summary>
            <div className="pb-3 space-y-2 text-xs font-mono break-all text-slate-600">
              <div>raw: {sample.reading.rawHex}</div>
              <div>decoded: {sample.reading.decodedHex}</div>
              <div className="font-sans font-bold">First live check: compare pH, ORP, temperature, EC/TDS and salinity with the pen display. High-range EC/TDS unit scaling has not yet been validated on this physical meter.</div>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
