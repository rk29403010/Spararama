import React, { useEffect, useState } from 'react';
import { AppState, HeatingSession } from '../types';
import { addDays, format } from 'date-fns';
import { volumeAdjustedHeatingRate } from '../domain/heating';
import { spaApi, type BestEffortTemperatureDto } from '../lib/spaApi';
import { weatherApi, type WeatherForecastDto } from '../lib/weatherApi';
import { heatingApi } from '../lib/heatingApi';
import { Cloud, CloudFog, Save, Sun, Wind } from 'lucide-react';

interface HeatingProps {
  state: AppState;
  updateState: (newState: AppState) => void;
}

function displayTemperature(celsius: number, scale: 'C' | 'F') {
  return scale === 'F' ? Math.round((celsius * 9 / 5) + 32) : Math.round(celsius);
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

function mean(values: Array<number | null | undefined>, fallback: number) {
  const usable = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : fallback;
}

export function Heating({ state, updateState }: HeatingProps) {
  const [currentTemp, setCurrentTemp] = useState<number | null>(null);
  const [temperatureEstimate, setTemperatureEstimate] = useState<BestEffortTemperatureDto | null>(null);
  const [temperatureLookupError, setTemperatureLookupError] = useState('');
  const [targetTemp, setTargetTemp] = useState(state.config.defaultHeatingTarget || 40);
  const [readyDay, setReadyDay] = useState<'today' | 'tomorrow'>('today');
  const [readyHour, setReadyHour] = useState(17);
  const [calculation, setCalculation] = useState<HeatingSession | null>(null);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherForecastDto | null>(null);
  const [weatherError, setWeatherError] = useState('');

  const scale = state.config.temperatureScale;
  const timeFormat = state.config.timeFormat;
  const activeWaterBody = state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) || state.domain.waterBodies[0];
  const waterVolumeLiters = activeWaterBody?.volumeLiters || state.config.waterCapacityLiters || 800;
  const autoStartPreferred = activeWaterBody?.connectivity === 'wifi' && Boolean(activeWaterBody?.connectorId);
  const minC = 10;
  const maxC = 42;
  const minTemp = scale === 'F' ? Math.round((minC * 9 / 5) + 32) : minC;
  const maxTemp = scale === 'F' ? Math.round((maxC * 9 / 5) + 32) : maxC;

  useEffect(() => {
    let cancelled = false;
    setCurrentTemp(null);
    setTemperatureEstimate(null);
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
    let cancelled = false;
    setWeatherData(null);
    setWeatherError('');
    weatherApi.forecast(2)
      .then(forecast => { if (!cancelled) setWeatherData(forecast); })
      .catch((err: any) => { if (!cancelled) setWeatherError(err?.message || 'Weather forecast unavailable.'); });
    return () => { cancelled = true; };
  }, [activeWaterBody?.id]);

  useEffect(() => {
    if (scale === 'F') {
      if (currentTemp !== null && currentTemp < 50) setCurrentTemp(Math.round((currentTemp * 9 / 5) + 32));
      if (targetTemp < 50) setTargetTemp(Math.round((targetTemp * 9 / 5) + 32));
    } else {
      if (currentTemp !== null && currentTemp > 45) setCurrentTemp(Math.round((currentTemp - 32) * 5 / 9));
      if (targetTemp > 45) setTargetTemp(Math.round((targetTemp - 32) * 5 / 9));
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
    if (currentTemp === null) {
      setCalculation(null);
      return;
    }
    const timer = setTimeout(() => { calculateHeating(); setSaveSuccess(false); }, 300);
    return () => clearTimeout(timer);
  }, [currentTemp, targetTemp, readyDay, readyHour, scale, weatherData, waterVolumeLiters, state.config.heatingRateReferenceVolumeLiters]);

  const handleScheduleHeating = async () => {
    if (!calculation) return;
    setIsSaving(true);
    setError('');
    try {
      if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        await Notification.requestPermission();
      }
      await heatingApi.schedule(calculation, autoStartPreferred);
      const readyReminder = { id: `${calculation.id}_ready`, type: 'tub_ready' as const, scheduledTime: calculation.targetTime, sessionData: calculation };
      updateState({
        ...state,
        heatingSessions: [...(state.heatingSessions || []).filter(item => item.id !== calculation.id), calculation],
        reminders: [...(state.reminders || []).filter(item => item.id !== readyReminder.id), readyReminder]
      });
      setSaveSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Could not schedule heating.');
    } finally {
      setIsSaving(false);
    }
  };

  const calculateHeating = () => {
    setError('');
    try {
      if (currentTemp === null) {
        setCalculation(null);
        return;
      }

      let cTemp = currentTemp;
      let tTemp = targetTemp;
      if (scale === 'F') {
        cTemp = (currentTemp - 32) * 5 / 9;
        tTemp = (targetTemp - 32) * 5 / 9;
      }
      const tempDiff = tTemp - cTemp;
      if (tempDiff <= 0) {
        setCalculation(null);
        return;
      }

      const baseDate = readyDay === 'today' ? new Date() : addDays(new Date(), 1);
      const targetDate = new Date(baseDate.setHours(readyHour, 0, 0, 0));
      const targetTimestamp = targetDate.getTime();
      if (targetTimestamp <= Date.now()) {
        setError('Target time is in the past.');
        setCalculation(null);
        return;
      }

      let avgAmbientTemp = 15;
      let avgWindSpeed = 10;
      let avgSolarRadiationWm2 = 0;
      let avgPrecipitationMm = 0;
      let temperatureInfluence = 1;
      let windInfluence = 1;
      let solarInfluence = 0;
      let precipitationInfluence = 0;

      if (weatherData) {
        const now = Date.now();
        const selectedIndexes = weatherData.derived.time
          .map((time, index) => ({ time, index }))
          .filter(item => item.time >= now && item.time <= targetTimestamp)
          .map(item => item.index);

        if (selectedIndexes.length) {
          avgAmbientTemp = mean(selectedIndexes.map(index => weatherData.derived.temperatureC[index]), 15);
          avgWindSpeed = mean(selectedIndexes.map(index => weatherData.derived.windSpeedMps[index]), 10 / 3.6) * 3.6;
          avgSolarRadiationWm2 = mean(selectedIndexes.map(index => weatherData.derived.shortwaveRadiationWm2[index]), 0);
          avgPrecipitationMm = mean(selectedIndexes.map(index => weatherData.derived.precipitationMm[index]), 0);
        }
        temperatureInfluence = weatherData.influence.temperature;
        windInfluence = weatherData.influence.wind;
        solarInfluence = weatherData.influence.solar;
        precipitationInfluence = weatherData.influence.precipitation;
      }

      let effectiveHeatingRate = volumeAdjustedHeatingRate(
        state.config.baseHeatingRatePerHour,
        waterVolumeLiters,
        state.config.heatingRateReferenceVolumeLiters || 800
      );

      // Initial deterministic microclimate heuristics. Raw weather and the applied
      // influence factors are retained so these coefficients can later be calibrated
      // from real heating sessions without losing the original inputs.
      if (avgAmbientTemp < 15) effectiveHeatingRate -= (15 - avgAmbientTemp) * 0.05 * temperatureInfluence;
      if (avgWindSpeed > 10) effectiveHeatingRate -= ((avgWindSpeed - 10) / 5) * 0.05 * windInfluence;
      if (avgSolarRadiationWm2 > 0) effectiveHeatingRate += Math.min(0.12, (avgSolarRadiationWm2 / 800) * 0.12) * solarInfluence;
      if (avgPrecipitationMm > 0) effectiveHeatingRate -= Math.min(0.08, avgPrecipitationMm * 0.02) * precipitationInfluence;
      effectiveHeatingRate = Math.max(0.5, effectiveHeatingRate);

      const hoursToHeat = tempDiff / effectiveHeatingRate;
      const soakHours = (state.config.heatSoakMinutes || 0) / 60;
      const totalHours = hoursToHeat + soakHours;
      const startTimestamp = targetTimestamp - totalHours * 60 * 60 * 1000;
      if (startTimestamp < Date.now()) setError("Start ASAP! Won't reach temp in time.");

      const activeHeatingKwh = (state.config.heaterPowerWatts / 1000) * hoursToHeat;
      const soakKwh = (state.config.heaterPowerWatts / 1000) * soakHours * 0.5;
      const costEstimate = (activeHeatingKwh + soakKwh) * state.config.electricityRatePerKwh;

      setCalculation({
        id: Date.now().toString(),
        targetTemp: tTemp,
        targetTime: targetTimestamp,
        startTemp: cTemp,
        startTime: startTimestamp,
        ambientTempAvg: avgAmbientTemp,
        avgWindSpeed,
        avgSolarRadiationWm2,
        weatherSourceCount: weatherData?.sources.length,
        weatherSamplingMode: weatherData?.settings.samplingMode,
        weatherInfluence: weatherData ? {
          temperature: weatherData.influence.temperature,
          wind: weatherData.influence.wind,
          solar: weatherData.influence.solar,
          precipitation: weatherData.influence.precipitation
        } : undefined,
        expectedDurationHours: totalHours,
        costEstimate
      });
    } catch {
      setError('Failed');
    }
  };

  const getPercent = (value: number) => (value - minTemp) / (maxTemp - minTemp);
  const displayedCurrentTemp = currentTemp ?? minTemp;

  return (
    <div className="flex flex-col h-full max-w-md mx-auto p-4 space-y-8 pb-8">
      <div className="flex-1 flex justify-around items-center min-h-[280px] relative mt-2">
        <div className="absolute inset-y-8 left-1/2 -translate-x-1/2 flex flex-col justify-between items-center text-xs font-bold text-slate-300 py-4 pointer-events-none z-0"><span>{scale === 'F' ? 104 : 40}</span><span>{scale === 'F' ? 86 : 30}</span><span>{scale === 'F' ? 68 : 20}</span><span>{scale === 'F' ? 50 : 10}</span><div className="absolute top-8 bottom-8 left-1/2 w-[2px] bg-slate-200 -z-10 -translate-x-1/2" /></div>
        <div className="flex flex-col items-center h-full justify-between z-10">
          <div className="text-center mb-4"><div className="text-sm font-bold text-slate-400 uppercase tracking-widest">Current</div><div className={`mt-1 text-[10px] font-bold ${temperatureEstimate?.confidence === 'high' ? 'text-emerald-600' : temperatureEstimate?.confidence === 'medium' ? 'text-amber-600' : 'text-slate-500'}`} title={temperatureEstimate?.reason}>{temperatureLookupError || temperatureSourceLabel(temperatureEstimate)}</div></div>
          <div className="relative w-12 h-64 flex items-center justify-center"><input type="range" min={minTemp} max={maxTemp} step="1" value={displayedCurrentTemp} disabled={currentTemp === null} onChange={event => setCurrentTemp(Number(event.target.value))} className="absolute w-64 h-12 -rotate-90 appearance-none bg-slate-100 rounded-full outline-none slider-thumb-transparent z-10 disabled:opacity-50" /><div className="absolute pointer-events-none w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg text-lg z-20" style={{ bottom: `calc(${getPercent(displayedCurrentTemp)} * (100% - 3rem))` }}>{currentTemp === null ? '—' : currentTemp}</div></div>
        </div>
        <div className="flex flex-col items-center h-full justify-between z-10"><div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Target</div><div className="relative w-12 h-64 flex items-center justify-center"><input type="range" min={minTemp} max={maxTemp} step="1" value={targetTemp} onChange={event => setTargetTemp(Number(event.target.value))} className="absolute w-64 h-12 -rotate-90 appearance-none bg-slate-100 rounded-full outline-none slider-thumb-transparent z-10" /><div className="absolute pointer-events-none w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg text-lg z-20" style={{ bottom: `calc(${getPercent(targetTemp)} * (100% - 3rem))` }}>{targetTemp}</div></div></div>
      </div>

      {weatherError && <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs font-semibold text-amber-900">{weatherError} Heating will use neutral weather assumptions until a location is configured or weather returns.</div>}

      <div className="flex gap-3 items-center bg-white p-2 rounded-3xl shadow-sm border border-slate-200 shrink-0">
        <div className="flex-1 flex bg-slate-100 p-1 rounded-2xl"><button onClick={() => setReadyDay('today')} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${readyDay === 'today' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Today</button><button onClick={() => setReadyDay('tomorrow')} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${readyDay === 'tomorrow' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>Tmrw</button></div>
        <select value={readyHour} onChange={event => { const hour = Number(event.target.value); setReadyHour(hour); if (readyDay === 'today' && hour <= new Date().getHours()) setReadyDay('tomorrow'); }} className="w-28 bg-slate-100 text-slate-900 font-bold text-xl py-3 px-2 rounded-2xl outline-none text-center appearance-none cursor-pointer">{Array.from({ length: 24 }).map((_, hour) => <option key={hour} value={hour}>{timeFormat === '12h' ? (hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`) : `${hour.toString().padStart(2, '0')}:00`}</option>)}</select>
      </div>

      <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-lg flex flex-col relative overflow-hidden shrink-0 mb-2 gap-4">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3 z-0" />
        <div className="flex justify-between items-center z-10"><div><div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Start Heating</div><div className="text-4xl font-extrabold tracking-tight">{calculation ? format(calculation.startTime, timeFormat === '12h' ? 'h:mm a' : 'HH:mm') : '--:--'}</div>{calculation && error && <div className="text-amber-400 text-xs font-bold mt-2">{error}</div>}{calculation && !error && <div className="text-slate-300 text-sm font-medium mt-1">{format(calculation.startTime, 'MMM d')}</div>}</div><div className="text-right"><div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Est. Cost</div><div className="text-4xl font-extrabold tracking-tight text-emerald-400">{calculation ? `£${calculation.costEstimate.toFixed(2)}` : '£--'}</div></div></div>
        {calculation && !error && <div className="grid grid-cols-2 gap-3 text-xs font-bold text-slate-400 border-t border-slate-700/50 pt-4 z-10"><div className="flex items-center gap-1.5"><Cloud className="w-4 h-4 text-slate-300" /><span>{Math.round(calculation.ambientTempAvg)}°C avg</span></div><div className="flex items-center gap-1.5"><Wind className="w-4 h-4 text-slate-300" /><span>{Math.round(calculation.avgWindSpeed || 0)} km/h</span></div><div className="flex items-center gap-1.5"><Sun className="w-4 h-4 text-slate-300" /><span>{Math.round(calculation.avgSolarRadiationWm2 || 0)} W/m²</span></div><div className="flex items-center justify-end gap-1 text-indigo-300"><CloudFog className="w-4 h-4" /><span>{calculation.weatherSourceCount ? `${calculation.weatherSourceCount} wx` : `${waterVolumeLiters.toLocaleString()} L`}</span></div></div>}
        {calculation && !error && <p className="text-xs text-slate-300 z-10">{autoStartPreferred ? 'Spararama will try to start the heater automatically. If remote control fails after retries, you will be asked to switch it on manually.' : 'This spa is not remotely controllable, so you will be asked to switch the heater on manually.'}</p>}
        {calculation && !error && <button onClick={handleScheduleHeating} disabled={isSaving || saveSuccess} className={`mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold transition-all z-10 w-full ${saveSuccess ? 'bg-emerald-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}><Save className="w-5 h-5" />{saveSuccess ? 'Heating Scheduled' : isSaving ? 'Scheduling...' : 'Schedule Heating'}</button>}
      </div>
    </div>
  );
}
