import React, { useEffect, useMemo, useState } from 'react';
import { getLogs, subscribeToAuthChanges } from '../lib/firebase';
import { telemetryApi, type TelemetryChartDto } from '../lib/telemetryApi';
import { fetchSpaHistory, type SpaHistoryEventDto } from '../lib/historyApi';
import type { AppState } from '../types';
import { formatLogDateTime } from '../lib/dateTime';
import { Beaker, Droplets, Flame, Thermometer, UserRound, Wrench } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine
} from 'recharts';

type HeatRange = 'today' | '48h' | '7d' | '30d' | '1y';
type ChemistryRange = '7d' | '30d' | '1y';

const HEAT_RANGES: Array<{ key: HeatRange; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '48h', label: '2 days' },
  { key: '7d', label: 'Week' },
  { key: '30d', label: 'Month' },
  { key: '1y', label: 'Year' }
];

const CHEMISTRY_RANGES: Array<{ key: ChemistryRange; label: string }> = [
  { key: '7d', label: 'Week' },
  { key: '30d', label: 'Month' },
  { key: '1y', label: 'Year' }
];

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function heatRangeStart(range: HeatRange, now = Date.now()) {
  if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  const hours = range === '48h' ? 48 : range === '7d' ? 24 * 7 : range === '30d' ? 24 * 30 : 24 * 365;
  return now - hours * 60 * 60 * 1000;
}

function chemistryRangeStart(range: ChemistryRange, now = Date.now()) {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 365;
  return now - days * 24 * 60 * 60 * 1000;
}

function tickLabel(timestamp: number, range: HeatRange | ChemistryRange) {
  const date = new Date(timestamp);
  if (range === 'today' || range === '48h') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '7d') return date.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
  if (range === '30d') return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return date.toLocaleDateString([], { month: 'short', year: '2-digit' });
}

function logTimestamp(log: any) {
  const manual = Number(log?.data?.manualTimestamp);
  if (Number.isFinite(manual)) return manual;
  const embedded = Number(log?.data?.timestamp);
  if (Number.isFinite(embedded)) return embedded;
  if (log?.timestamp?.toDate) return log.timestamp.toDate().getTime();
  const parsed = new Date(log?.timestamp || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function observationTimestamp(observedAt: unknown): number | null {
  if (typeof observedAt === 'string') {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(observedAt);
    const timestamp = new Date(dateOnly ? `${observedAt}T12:00:00` : observedAt).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (!observedAt || typeof observedAt !== 'object') return null;
  const value = observedAt as Record<string, unknown>;
  const startRaw = value.start ?? value.after;
  const endRaw = value.end ?? value.before;
  const start = typeof startRaw === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? `${startRaw}T12:00:00` : startRaw).getTime() : Number.NaN;
  const end = typeof endRaw === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? `${endRaw}T12:00:00` : endRaw).getTime() : Number.NaN;
  if (Number.isFinite(start) && Number.isFinite(end)) return start + (end - start) / 2;
  if (Number.isFinite(start)) return start;
  if (Number.isFinite(end)) return end;
  return null;
}

function measurementValue(raw: unknown): { value: number | null; label: string | null } {
  if (finiteNumber(raw)) return { value: raw, label: String(raw) };
  if (!raw || typeof raw !== 'object') return { value: null, label: null };
  const value = raw as Record<string, unknown>;
  if (finiteNumber(value.value)) return { value: value.value, label: String(value.value) };
  if (finiteNumber(value.min) && finiteNumber(value.max)) {
    return { value: (value.min + value.max) / 2, label: `${value.min}-${value.max}` };
  }
  if (typeof value.approx === 'string') {
    const numbers = value.approx.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
    if (numbers.length >= 2) return { value: (numbers[0] + numbers[1]) / 2, label: `~${value.approx}` };
    if (numbers.length === 1) return { value: numbers[0], label: `~${value.approx}` };
  }
  return { value: null, label: null };
}

function measurementFromReadings(readings: any[], key: string) {
  const reading = readings?.find(item => item?.measurement === key);
  return measurementValue(reading);
}

function heaterPeriods(samples: TelemetryChartDto['samples']) {
  const periods: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  for (const sample of samples) {
    const heating = sample.spa.connected && sample.spa.heaterOn;
    if (heating && start === null) start = sample.timestamp;
    if (!heating && start !== null) {
      periods.push({ start, end: sample.timestamp });
      start = null;
    }
  }
  if (start !== null && samples.length) periods.push({ start, end: samples[samples.length - 1].timestamp });
  return periods;
}

function usualTubMarkers(since: number, end: number, readyTime: string, enabled: boolean) {
  if (!enabled) return [] as number[];
  const [hourRaw, minuteRaw] = readyTime.split(':').map(Number);
  const hour = Number.isFinite(hourRaw) ? hourRaw : 17;
  const minute = Number.isFinite(minuteRaw) ? minuteRaw : 0;
  const cursor = new Date(since);
  cursor.setHours(0, 0, 0, 0);
  const markers: number[] = [];
  while (cursor.getTime() <= end) {
    const marker = new Date(cursor);
    marker.setHours(hour, minute, 0, 0);
    if (marker.getTime() >= since && marker.getTime() <= end) markers.push(marker.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return markers;
}

function ChemistryTooltip({ active, payload, label, timeFormat = '24h' }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-xl bg-white px-3 py-2 shadow-lg border border-slate-100 text-xs">
      <p className="font-bold text-slate-700 mb-1">{formatLogDateTime(Number(label), timeFormat)}</p>
      {point.chlorineLabel && <p className="text-indigo-700">Free chlorine {point.chlorineLabel} ppm</p>}
      {point.phLabel && <p className="text-emerald-700">pH {point.phLabel}</p>}
    </div>
  );
}

interface LogsProps { state: AppState; }

export function Logs({ state }: LogsProps) {
  const [user, setUser] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [heatRange, setHeatRange] = useState<HeatRange>('48h');
  const [chemistryRange, setChemistryRange] = useState<ChemistryRange>('30d');
  const [telemetry, setTelemetry] = useState<TelemetryChartDto>({ samples: [], rawTotal: 0, rolledUp: false });
  const [historyEvents, setHistoryEvents] = useState<SpaHistoryEventDto[]>([]);
  const [telemetryLoading, setTelemetryLoading] = useState(true);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(userValue => {
      setUser(userValue);
      if (!userValue) {
        setLogs([]);
        return;
      }
      void getLogs(500).then(setLogs).catch(() => setLogs([]));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    void fetchSpaHistory()
      .then(result => { if (active) { setHistoryEvents(result.events); setHistoryError(null); } })
      .catch((error: any) => { if (active) setHistoryError(error?.message || 'Spa history could not be loaded.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await telemetryApi.chart(heatRangeStart(heatRange), 500);
        if (!active) return;
        setTelemetry(result);
        setTelemetryError(null);
      } catch (error: any) {
        if (active) setTelemetryError(error?.message || 'Temperature history could not be loaded.');
      } finally {
        if (active) setTelemetryLoading(false);
      }
    };
    setTelemetryLoading(true);
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [heatRange]);

  const heatWindow = useMemo(() => {
    const now = Date.now();
    const since = heatRangeStart(heatRange, now);
    let end = now;
    if (heatRange === 'today' || heatRange === '48h') {
      const [hourRaw, minuteRaw] = state.config.defaultReadyTime.split(':').map(Number);
      const usual = new Date(now);
      usual.setHours(Number.isFinite(hourRaw) ? hourRaw : 17, Number.isFinite(minuteRaw) ? minuteRaw : 0, 0, 0);
      end = Math.max(end, usual.getTime());
    }
    return { since, end };
  }, [heatRange, state.config.defaultReadyTime, telemetry.samples.length]);

  const heatData = useMemo(() => {
    const points = new Map<number, any>();
    for (const sample of telemetry.samples) {
      const weather = sample.weather?.find(item => finiteNumber(item.temperatureC));
      points.set(sample.timestamp, {
        timestamp: sample.timestamp,
        water: sample.spa.connected && finiteNumber(sample.spa.waterTemperatureC) ? sample.spa.waterTemperatureC : null,
        target: sample.spa.connected && finiteNumber(sample.spa.targetTemperatureC) ? sample.spa.targetTemperatureC : null,
        ambient: weather && finiteNumber(weather.temperatureC) ? weather.temperatureC : null,
        heaterOn: sample.spa.connected && sample.spa.heaterOn,
        connected: sample.spa.connected
      });
    }
    for (const log of logs) {
      if (log?.type !== 'manual_log' && log?.type !== 'heating_action') continue;
      const timestamp = logTimestamp(log);
      const temp = Number(log?.data?.temp);
      if (timestamp < heatWindow.since || timestamp > heatWindow.end || !Number.isFinite(temp)) continue;
      const point = points.get(timestamp) || { timestamp };
      point.manualWater = temp;
      points.set(timestamp, point);
    }
    return Array.from(points.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [telemetry.samples, logs, heatWindow]);

  const heatPeriods = useMemo(() => heaterPeriods(telemetry.samples), [telemetry.samples]);
  const hasWeather = heatData.some(point => finiteNumber(point.ambient));
  const usualMarkers = useMemo(
    () => usualTubMarkers(heatWindow.since, heatWindow.end, state.config.defaultReadyTime, heatRange === 'today' || heatRange === '48h'),
    [heatWindow, state.config.defaultReadyTime, heatRange]
  );

  const bathingMarkers = useMemo(() => logs
    .filter(log => log?.type === 'manual_log' && (log?.data?.action === 'entered_tub' || log?.data?.action === 'exited_tub'))
    .map(log => ({ timestamp: logTimestamp(log), action: log.data.action }))
    .filter(item => item.timestamp >= heatWindow.since && item.timestamp <= heatWindow.end), [logs, heatWindow]);

  const chemistry = useMemo(() => {
    const points: any[] = [];
    const events: Array<{ id: string; timestamp: number; type: 'dose' | 'bath' | 'maintenance' | 'filter'; label: string }> = [];

    for (const event of historyEvents) {
      const timestamp = observationTimestamp(event.observed_at);
      if (timestamp === null) continue;
      if (event.type === 'water_test' && event.water_source !== 'tap') {
        const chlorine = measurementValue(event.values?.free_chlorine_ppm);
        const ph = measurementValue(event.values?.pH);
        if (chlorine.value !== null || ph.value !== null) points.push({ timestamp, chlorine: chlorine.value, chlorineLabel: chlorine.label, ph: ph.value, phLabel: ph.label });
      }
      if (event.type === 'dose') {
        const dose = finiteNumber(event.dose_g) ? `${event.dose_g}g ` : '';
        events.push({ id: event.id, timestamp, type: 'dose', label: `${dose}${event.chemical || 'treatment'}` });
      } else if (event.type === 'maintenance') {
        events.push({ id: event.id, timestamp, type: 'maintenance', label: event.action?.replaceAll('_', ' ') || 'maintenance' });
      } else if (event.type === 'bathing' || event.type === 'use') {
        events.push({ id: event.id, timestamp, type: 'bath', label: 'Bathing' });
      }
    }

    for (const log of logs) {
      const timestamp = logTimestamp(log);
      if (!timestamp) continue;
      if (log.type === 'water_test') {
        const readings = Array.isArray(log.data?.readings) ? log.data.readings : [];
        const chlorine = measurementFromReadings(readings, 'free_chlorine');
        const ph = measurementFromReadings(readings, 'ph');
        if (chlorine.value !== null || ph.value !== null) points.push({ timestamp, chlorine: chlorine.value, chlorineLabel: chlorine.label, ph: ph.value, phLabel: ph.label });
      } else if (log.type === 'chemical_dose') {
        events.push({ id: log.id || `dose-${timestamp}`, timestamp, type: 'dose', label: `${log.data?.amount ?? ''}${log.data?.unit ?? ''} treatment`.trim() });
      } else if (log.type === 'manual_log' && (log.data?.action === 'entered_tub' || log.data?.action === 'exited_tub')) {
        events.push({ id: log.id || `bath-${timestamp}`, timestamp, type: 'bath', label: log.data.action === 'entered_tub' ? 'Got in' : 'Got out' });
      } else if (log.type === 'maintenance') {
        events.push({ id: log.id || `maintenance-${timestamp}`, timestamp, type: 'maintenance', label: log.data?.action || 'Maintenance' });
      }
    }

    points.sort((a, b) => a.timestamp - b.timestamp);
    events.sort((a, b) => a.timestamp - b.timestamp);
    return { points, events };
  }, [historyEvents, logs]);

  const chemistryWindow = useMemo(() => ({ since: chemistryRangeStart(chemistryRange), end: Date.now() }), [chemistryRange, historyEvents.length, logs.length]);
  const chemistryPoints = useMemo(() => chemistry.points.filter(point => point.timestamp >= chemistryWindow.since && point.timestamp <= chemistryWindow.end), [chemistry, chemistryWindow]);
  const chemistryEvents = useMemo(() => chemistry.events.filter(event => event.timestamp >= chemistryWindow.since && event.timestamp <= chemistryWindow.end), [chemistry, chemistryWindow]);

  const eventStyle = (type: string) => type === 'dose'
    ? 'bg-indigo-500'
    : type === 'bath'
      ? 'bg-emerald-500'
      : type === 'filter'
        ? 'bg-sky-500'
        : 'bg-amber-500';

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-8 pb-10">
      <section className="space-y-4">
        <div className="px-1">
          <h2 className="text-2xl font-black text-slate-900">Heating & temperature</h2>
          <p className="text-sm text-slate-500 mt-1">How the water warmed and cooled, and when the heater was doing the work.</p>
        </div>

        <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 overflow-x-auto">
          {HEAT_RANGES.map(option => (
            <button key={option.key} type="button" onClick={() => setHeatRange(option.key)} className={`min-w-fit flex-1 px-3 py-2.5 rounded-xl text-sm font-extrabold ${heatRange === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{option.label}</button>
          ))}
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-3xl shadow-sm border border-slate-100">
          {telemetryLoading && heatData.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-slate-400">Loading temperature history…</div>
          ) : telemetryError && heatData.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-center text-slate-500 px-6">Temperature history is temporarily unavailable.<br/><span className="text-xs">{telemetryError}</span></div>
          ) : heatData.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-slate-400">No temperature readings in this period.</div>
          ) : (
            <>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={heatData} margin={{ top: 12, right: 8, left: -18, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis type="number" dataKey="timestamp" domain={[heatWindow.since, heatWindow.end]} scale="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={28} tickFormatter={value => tickLabel(Number(value), heatRange)} />
                    <YAxis yAxisId="temp" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} domain={['dataMin - 1', 'dataMax + 1']} tickFormatter={value => `${value}°`} />
                    <Tooltip labelFormatter={value => formatLogDateTime(Number(value), state.config.timeFormat)} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 10px rgb(15 23 42 / 0.12)' }} />
                    {heatPeriods.map((period, index) => <ReferenceArea key={`${period.start}-${index}`} yAxisId="temp" x1={period.start} x2={period.end} fill="#f59e0b" fillOpacity={0.10} strokeOpacity={0} />)}
                    {usualMarkers.map((timestamp, index) => <ReferenceLine key={`usual-${timestamp}`} yAxisId="temp" x={timestamp} stroke="#10b981" strokeOpacity={0.45} strokeDasharray="4 4" label={index === usualMarkers.length - 1 ? { value: 'usual tub time', position: 'insideTopRight', fill: '#059669', fontSize: 10 } : undefined} />)}
                    {bathingMarkers.map(marker => <ReferenceLine key={`${marker.timestamp}-${marker.action}`} yAxisId="temp" x={marker.timestamp} stroke="#059669" strokeOpacity={0.8} strokeDasharray="2 3" />)}
                    <Line yAxisId="temp" type="monotone" dataKey="water" name="Water °C" stroke="#4f46e5" strokeWidth={3} dot={false} connectNulls={false} isAnimationActive={false} />
                    <Line yAxisId="temp" type="stepAfter" dataKey="target" name="Target °C" stroke="#f97316" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
                    {hasWeather && <Line yAxisId="temp" type="monotone" dataKey="ambient" name="Outside °C" stroke="#64748b" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />}
                    <Line yAxisId="temp" type="linear" dataKey="manualWater" name="Manual reading" stroke="transparent" strokeWidth={0} dot={{ r: 4, fill: '#a5b4fc', stroke: '#4338ca', strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} legendType="none" isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 pt-3 border-t border-slate-100 text-xs font-semibold text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-5 h-1 rounded bg-indigo-600" />Water</span>
                <span className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-orange-500" />Target</span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-3 rounded bg-amber-100" />Heater on</span>
                {user && <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-indigo-200 border-2 border-indigo-700" />Manual temp</span>}
                {hasWeather && <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-slate-500" />Outside</span>}
              </div>
              {telemetry.rolledUp && <p className="mt-3 text-xs text-slate-400">Simplified for this long view - {telemetry.rawTotal.toLocaleString()} readings remain in the full history.</p>}
              {!user && <p className="mt-2 text-xs text-slate-400">Sign in to add any manual temperature readings to the graph.</p>}
              {telemetryError && <p className="mt-2 text-xs text-amber-700">Live history refresh failed; showing the last graph loaded.</p>}
            </>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="px-1">
          <h2 className="text-2xl font-black text-slate-900">Water balance</h2>
          <p className="text-sm text-slate-500 mt-1">Tests and treatments together, so you can see what changed after a dose, refill or use.</p>
        </div>

        <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
          {CHEMISTRY_RANGES.map(option => (
            <button key={option.key} type="button" onClick={() => setChemistryRange(option.key)} className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-extrabold ${chemistryRange === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{option.label}</button>
          ))}
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-3xl shadow-sm border border-slate-100">
          {chemistryPoints.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-center text-slate-400">No water-test readings in this period.</div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chemistryPoints} margin={{ top: 10, right: 2, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis type="number" dataKey="timestamp" domain={[chemistryWindow.since, chemistryWindow.end]} scale="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={28} tickFormatter={value => tickLabel(Number(value), chemistryRange)} />
                  <YAxis yAxisId="chlorine" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6366f1' }} domain={[0, 'auto']} width={35} label={{ value: 'FC', angle: -90, position: 'insideLeft', fill: '#6366f1', fontSize: 10 }} />
                  <YAxis yAxisId="ph" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#059669' }} domain={[6.5, 8]} width={34} label={{ value: 'pH', angle: 90, position: 'insideRight', fill: '#059669', fontSize: 10 }} />
                  <Tooltip content={<ChemistryTooltip timeFormat={state.config.timeFormat} />} />
                  <ReferenceArea yAxisId="chlorine" x1={chemistryWindow.since} x2={chemistryWindow.end} y1={3} y2={5} fill="#6366f1" fillOpacity={0.06} strokeOpacity={0} />
                  <ReferenceArea yAxisId="ph" x1={chemistryWindow.since} x2={chemistryWindow.end} y1={7.2} y2={7.6} fill="#10b981" fillOpacity={0.06} strokeOpacity={0} />
                  <Line yAxisId="chlorine" type="monotone" dataKey="chlorine" name="Free chlorine" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                  <Line yAxisId="ph" type="monotone" dataKey="ph" name="pH" stroke="#059669" strokeWidth={2.5} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {chemistryEvents.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="relative h-12 rounded-xl bg-slate-50 overflow-hidden">
                {chemistryEvents.slice(-40).map((event, index) => {
                  const left = ((event.timestamp - chemistryWindow.since) / (chemistryWindow.end - chemistryWindow.since)) * 100;
                  return <span key={`${event.id}-${index}`} title={`${formatLogDateTime(event.timestamp, state.config.timeFormat)} - ${event.label}`} className={`absolute w-3 h-3 rounded-full border-2 border-white shadow-sm ${eventStyle(event.type)}`} style={{ left: `calc(${Math.max(0, Math.min(100, left))}% - 6px)`, top: index % 2 === 0 ? 10 : 27 }} />;
                })}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2 text-xs font-semibold text-slate-500">
                <span className="flex items-center gap-1.5"><Droplets className="w-3.5 h-3.5 text-indigo-500" />Treatment</span>
                <span className="flex items-center gap-1.5"><UserRound className="w-3.5 h-3.5 text-emerald-500" />Bathing</span>
                <span className="flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5 text-amber-500" />Maintenance/refill</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs font-semibold text-slate-500">
            <span className="flex items-center gap-1.5"><Beaker className="w-3.5 h-3.5 text-indigo-600" />Free chlorine</span>
            <span className="flex items-center gap-1.5"><Thermometer className="w-3.5 h-3.5 text-emerald-600" />pH</span>
            <span className="text-slate-400">Faint bands show the preferred ranges.</span>
          </div>
          {historyError && <p className="mt-3 text-xs text-amber-700">Older spa history could not be loaded: {historyError}</p>}
        </div>
      </section>

      <section className="rounded-3xl bg-slate-900 text-white p-5">
        <div className="flex items-start gap-3">
          <Flame className="w-6 h-6 text-amber-300 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-extrabold text-lg">What these graphs should help answer</h3>
            <p className="text-sm text-slate-300 mt-1">How quickly does this tub heat? How fast does it cool with the heater off? Did a cover or insulation change help? What happened to the water after a dose or a bathing session?</p>
          </div>
        </div>
      </section>
    </div>
  );
}
