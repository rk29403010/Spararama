import React, { useState, useEffect } from 'react';
import { AppState, HeatingSession } from '../types';
import { format, addDays } from 'date-fns';
import { volumeAdjustedHeatingRate } from '../domain/heating';
import { spaApi, type BestEffortTemperatureDto } from '../lib/spaApi';
import { Save, Cloud, Wind, CloudFog } from 'lucide-react';
import axios from 'axios';

interface HeatingProps {
  state: AppState;
  updateState: (newState: AppState) => void;
}

function displayTemperature(celsius: number, scale: 'C' | 'F') {
  return scale === 'F' ? Math.round((celsius * 9/5) + 32) : Math.round(celsius);
}

function temperatureSourceLabel(estimate: BestEffortTemperatureDto | null) {
  if (!estimate) return 'Finding current temperature…';
  const labels: Record<BestEffortTemperatureDto['source'], string> = {
    'live-spa': 'live spa',
    'recent-telemetry': 'recent reading',
    'last-known-water': 'last known water',
    'ambient-sensor': 'ambient sensor estimate',
    'weather': 'weather estimate',
    'ambient-default': 'ambient fallback'
  };
  const prefix = estimate.estimated ? 'Estimated' : 'Measured';
  return `${prefix} · ${estimate.confidence} confidence · ${labels[estimate.source]}`;
}

export function Heating({ state, updateState }: HeatingProps) {
  const [currentTemp, setCurrentTemp] = useState(20);
  const [temperatureEstimate, setTemperatureEstimate] = useState<BestEffortTemperatureDto | null>(null);
  const [temperatureLookupError, setTemperatureLookupError] = useState('');
  const [targetTemp, setTargetTemp] = useState(state.config.defaultHeatingTarget || 40);
  const [readyDay, setReadyDay] = useState<'today' | 'tomorrow'>('today');
  const [readyHour, setReadyHour] = useState(17);
  const [calculation, setCalculation] = useState<HeatingSession | null>(null);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [weatherData, setWeatherData] = useState<{time: string[], temperature_2m: number[], wind_speed_10m: number[]} | null>(null);

  const scale = state.config.temperatureScale;
  const timeFormat = state.config.timeFormat;
  const activeWaterBody = state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) || state.domain.waterBodies[0];
  const waterVolumeLiters = activeWaterBody?.volumeLiters || state.config.waterCapacityLiters || 800;
  const minC = 10;
  const maxC = 42;
  const minTemp = scale === 'F' ? Math.round((minC * 9/5) + 32) : minC;
  const maxTemp = scale === 'F' ? Math.round((maxC * 9/5) + 32) : maxC;

  useEffect(() => {
    let cancelled = false;
    setTemperatureLookupError('');
    spaApi.currentTemperature()
      .then(estimate => {
        if (cancelled) return;
        setTemperatureEstimate(estimate);
        setCurrentTemp(displayTemperature(estimate.valueC, state.config.temperatureScale));
      })
      .catch((err: any) => {
        if (cancelled) return;
        setTemperatureLookupError(err?.message || 'Could not determine the current temperature.');
      });
    return () => { cancelled = true; };
  }, [activeWaterBody?.id]);

  useEffect(() => {
    axios.get('https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&hourly=temperature_2m,wind_speed_10m&forecast_days=2')
      .then(res => setWeatherData(res.data.hourly)).catch(() => {});
  }, []);

  useEffect(() => {
    if (scale === 'F' && currentTemp < 50) {
      setCurrentTemp(Math.round((currentTemp * 9/5) + 32));
      setTargetTemp(Math.round((targetTemp * 9/5) + 32));
    } else if (scale === 'C' && currentTemp > 45) {
      setCurrentTemp(Math.round((currentTemp - 32) * 5/9));
      setTargetTemp(Math.round((targetTemp - 32) * 5/9));
    }
  }, [scale]);

  useEffect(() => {
    if (state.config.defaultReadyTime) {
      const [h] = state.config.defaultReadyTime.split(':');
      const hour = Number(h);
      setReadyHour(hour);
      setReadyDay(hour <= new Date().getHours() ? 'tomorrow' : 'today');
    }
  }, [state.config.defaultReadyTime]);

  useEffect(() => {
    const timer = setTimeout(() => { calculateHeating(); setSaveSuccess(false); }, 300);
    return () => clearTimeout(timer);
  }, [currentTemp, targetTemp, readyDay, readyHour, scale, weatherData, waterVolumeLiters, state.config.heatingRateReferenceVolumeLiters]);

  const handleSetReminder = async () => {
    if (!calculation) return;
    setIsSaving(true);
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') await Notification.requestPermission();
    const startReminder = { id: Date.now().toString() + '_start', type: 'start_heating' as const, scheduledTime: calculation.startTime, sessionData: calculation };
    const readyReminder = { id: Date.now().toString() + '_ready', type: 'tub_ready' as const, scheduledTime: calculation.targetTime, sessionData: calculation };
    updateState({ ...state, reminders: [...(state.reminders || []), startReminder, readyReminder] });
    setIsSaving(false); setSaveSuccess(true);
  };

  const calculateHeating = () => {
    setError('');
    try {
      let cTemp = currentTemp;
      let tTemp = targetTemp;
      if (scale === 'F') { cTemp = (currentTemp - 32) * 5/9; tTemp = (targetTemp - 32) * 5/9; }
      const tempDiff = tTemp - cTemp;
      if (tempDiff <= 0) { setCalculation(null); return; }

      const baseDate = readyDay === 'today' ? new Date() : addDays(new Date(), 1);
      const targetDate = new Date(baseDate.setHours(readyHour, 0, 0, 0));
      const targetTimestamp = targetDate.getTime();
      if (targetTimestamp <= Date.now()) { setError('Target time is in the past.'); setCalculation(null); return; }

      let avgAmbientTemp = 15;
      let avgWindSpeed = 10;
      if (weatherData) {
        const now = Date.now(); let tempSum = 0; let windSum = 0; let count = 0;
        weatherData.time.forEach((timeStr, i) => {
          const time = new Date(timeStr).getTime();
          if (time >= now && time <= targetTimestamp) { tempSum += weatherData.temperature_2m[i]; windSum += weatherData.wind_speed_10m[i]; count++; }
        });
        if (count > 0) { avgAmbientTemp = tempSum / count; avgWindSpeed = windSum / count; }
      }

      let effectiveHeatingRate = volumeAdjustedHeatingRate(
        state.config.baseHeatingRatePerHour,
        waterVolumeLiters,
        state.config.heatingRateReferenceVolumeLiters || 800
      );
      if (avgAmbientTemp < 15) effectiveHeatingRate -= (15 - avgAmbientTemp) * 0.05;
      if (avgWindSpeed > 10) effectiveHeatingRate -= ((avgWindSpeed - 10) / 5) * 0.05;
      effectiveHeatingRate = Math.max(0.5, effectiveHeatingRate);

      const hoursToHeat = tempDiff / effectiveHeatingRate;
      const soakHours = (state.config.heatSoakMinutes || 0) / 60;
      const totalHours = hoursToHeat + soakHours;
      const startTimestamp = targetTimestamp - (totalHours * 60 * 60 * 1000);
      if (startTimestamp < Date.now()) setError("Start ASAP! Won't reach temp in time.");

      const activeHeatingKwh = (state.config.heaterPowerWatts / 1000) * hoursToHeat;
      const soakKwh = (state.config.heaterPowerWatts / 1000) * soakHours * 0.5;
      const costEstimate = (activeHeatingKwh + soakKwh) * state.config.electricityRatePerKwh;
      setCalculation({ id: Date.now().toString(), targetTemp: tTemp, targetTime: targetTimestamp, startTemp: cTemp, startTime: startTimestamp, ambientTempAvg: avgAmbientTemp, avgWindSpeed, expectedDurationHours: totalHours, costEstimate });
    } catch {
      setError('Failed');
    }
  };

  const getPercent = (val: number) => (val - minTemp) / (maxTemp - minTemp);
  const step = 1;

  return (
    <div className="flex flex-col h-full max-w-md mx-auto p-4 space-y-8 pb-8">
      <div className="flex-1 flex justify-around items-center min-h-[280px] relative mt-2">
        <div className="absolute inset-y-8 left-1/2 -translate-x-1/2 flex flex-col justify-between items-center text-xs font-bold text-slate-300 py-4 pointer-events-none z-0"><span>{scale === 'F' ? 104 : 40}</span><span>{scale === 'F' ? 86 : 30}</span><span>{scale === 'F' ? 68 : 20}</span><span>{scale === 'F' ? 50 : 10}</span><div className="absolute top-8 bottom-8 left-1/2 w-[2px] bg-slate-200 -z-10 -translate-x-1/2" /></div>
        <div className="flex flex-col items-center h-full justify-between z-10"><div className="text-center mb-4"><div className="text-sm font-bold text-slate-400 uppercase tracking-widest">Current</div><div className={`mt-1 text-[10px] font-bold ${temperatureEstimate?.confidence === 'high' ? 'text-emerald-600' : temperatureEstimate?.confidence === 'medium' ? 'text-amber-600' : 'text-slate-500'}`} title={temperatureEstimate?.reason}>{temperatureLookupError || temperatureSourceLabel(temperatureEstimate)}</div></div><div className="relative w-12 h-64 flex items-center justify-center"><input type="range" min={minTemp} max={maxTemp} step={step} value={currentTemp} onChange={e => setCurrentTemp(Number(e.target.value))} className="absolute w-64 h-12 -rotate-90 appearance-none bg-slate-100 rounded-full outline-none slider-thumb-transparent z-10" /><div className="absolute pointer-events-none w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg text-lg z-20" style={{ bottom: `calc(${getPercent(currentTemp)} * (100% - 3rem))` }}>{currentTemp}</div></div></div>
        <div className="flex flex-col items-center h-full justify-between z-10"><div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Target</div><div className="relative w-12 h-64 flex items-center justify-center"><input type="range" min={minTemp} max={maxTemp} step={step} value={targetTemp} onChange={e => setTargetTemp(Number(e.target.value))} className="absolute w-64 h-12 -rotate-90 appearance-none bg-slate-100 rounded-full outline-none slider-thumb-transparent z-10" /><div className="absolute pointer-events-none w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg text-lg z-20" style={{ bottom: `calc(${getPercent(targetTemp)} * (100% - 3rem))` }}>{targetTemp}</div></div></div>
      </div>

      <div className="flex gap-3 items-center bg-white p-2 rounded-3xl shadow-sm border border-slate-200 shrink-0">
        <div className="flex-1 flex bg-slate-100 p-1 rounded-2xl"><button onClick={() => setReadyDay('today')} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${readyDay === 'today' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Today</button><button onClick={() => setReadyDay('tomorrow')} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${readyDay === 'tomorrow' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Tmrw</button></div>
        <select value={readyHour} onChange={e => { const hour = Number(e.target.value); setReadyHour(hour); if (readyDay === 'today' && hour <= new Date().getHours()) setReadyDay('tomorrow'); }} className="w-28 bg-slate-100 text-slate-900 font-bold text-xl py-3 px-2 rounded-2xl outline-none text-center appearance-none cursor-pointer">{Array.from({length: 24}).map((_, i) => <option key={i} value={i}>{timeFormat === '12h' ? (i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i-12} PM`) : `${i.toString().padStart(2, '0')}:00`}</option>)}</select>
      </div>

      <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-lg flex flex-col relative overflow-hidden shrink-0 mb-2 gap-4">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 z-0"></div>
        <div className="flex justify-between items-center z-10"><div><div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Start Heating</div><div className="text-4xl font-extrabold tracking-tight">{calculation ? format(calculation.startTime, timeFormat === '12h' ? 'h:mm a' : 'HH:mm') : '--:--'}</div>{calculation && error && <div className="text-amber-400 text-xs font-bold mt-2 uppercase">{error}</div>}{calculation && !error && <div className="text-slate-300 text-sm font-medium mt-1">{format(calculation.startTime, 'MMM d')}</div>}</div><div className="text-right"><div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Est. Cost</div><div className="text-4xl font-extrabold tracking-tight text-emerald-400">{calculation ? `£${calculation.costEstimate.toFixed(2)}` : '£--'}</div></div></div>
        {calculation && !error && <div className="flex items-center gap-4 text-xs font-bold text-slate-400 border-t border-slate-700/50 pt-4 z-10"><div className="flex items-center gap-1.5"><Cloud className="w-4 h-4 text-slate-300" /><span>{Math.round(calculation.ambientTempAvg)}°C avg</span></div><div className="flex items-center gap-1.5"><Wind className="w-4 h-4 text-slate-300" /><span>{Math.round(calculation.avgWindSpeed || 0)} km/h</span></div><div className="ml-auto flex items-center gap-1 text-indigo-300"><CloudFog className="w-4 h-4" /><span>{waterVolumeLiters.toLocaleString()} L</span></div></div>}
        {calculation && !error && <button onClick={handleSetReminder} disabled={isSaving || saveSuccess} className={`mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold transition-all z-10 w-full ${saveSuccess ? 'bg-emerald-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}><Save className="w-5 h-5" />{saveSuccess ? 'Reminders Set' : isSaving ? 'Saving...' : 'Set Reminder'}</button>}
      </div>
    </div>
  );
}
