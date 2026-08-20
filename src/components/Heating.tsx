import React, { useEffect, useState } from 'react';
import { AppState, HeatingSession } from '../types';
import { addDays, format } from 'date-fns';
import { volumeAdjustedHeatingRate } from '../domain/heating';
import { spaApi, type BestEffortTemperatureDto } from '../lib/spaApi';
import { weatherApi, type WeatherForecastDto } from '../lib/weatherApi';
import { heatingApi } from '../lib/heatingApi';
import { Cloud, Save, Sun, Wind } from 'lucide-react';
import { TemperatureSlider } from './TemperatureSlider';

interface HeatingProps {
  state: AppState;
  updateState: (newState: AppState) => void;
}

function displayTemperature(celsius: number, scale: 'C' | 'F') {
  return scale === 'F' ? Math.round((celsius * 9 / 5) + 32) : Math.round(celsius);
}

function temperatureSourceLabel(estimate: BestEffortTemperatureDto | null) {
  if (!estimate) return 'Reading temperature…';

  switch (estimate.source) {
    case 'live-spa':
      return '';
    case 'recent-telemetry':
      return 'Recent reading';
    case 'last-known-water':
      return 'Last known reading';
    case 'ambient-sensor':
      return estimate.confidence === 'low' ? 'Low-confidence sensor estimate' : 'Sensor estimate';
    case 'weather':
      return estimate.confidence === 'low' ? 'Low-confidence weather estimate' : 'Weather estimate';
    case 'ambient-default':
      return 'Fallback estimate';
    default:
      return '';
  }
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
        setTemperatureLookupError(err?.message || 'Current temperature unavailable.');
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
        setError('Choose a future ready time.');
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

      if (avgAmbientTemp < 15) effectiveHeatingRate -= (15 - avgAmbientTemp) * 0.05 * temperatureInfluence;
      if (avgWindSpeed > 10) effectiveHeatingRate -= ((avgWindSpeed - 10) / 5) * 0.05 * windInfluence;
      if (avgSolarRadiationWm2 > 0) effectiveHeatingRate += Math.min(0.12, (avgSolarRadiationWm2 / 800) * 0.12) * solarInfluence;
      if (avgPrecipitationMm > 0) effectiveHeatingRate -= Math.min(0.08, avgPrecipitationMm * 0.02) * precipitationInfluence;
      effectiveHeatingRate = Math.max(0.5, effectiveHeatingRate);

      const hoursToHeat = tempDiff / effectiveHeatingRate;
      const soakHours = (state.config.heatSoakMinutes || 0) / 60;
      const totalHours = hoursToHeat + soakHours;
      const startTimestamp = targetTimestamp - totalHours * 60 * 60 * 1000;
      if (startTimestamp < Date.now()) setError('Start now - the target may not be reached in time.');

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
      setError('Heating estimate failed.');
    }
  };

  const displayedCurrentTemp = currentTemp ?? minTemp;
  const currentDetail = temperatureLookupError || temperatureSourceLabel(temperatureEstimate) || undefined;

  return (
    <div className="flex flex-col h-full max-w-md mx-auto p-4 space-y-6 pb-8">
      <div className="grid grid-cols-2 gap-4 mt-2">
        <TemperatureSlider
          label="Current"
          value={displayedCurrentTemp}
          min={minTemp}
          max={maxTemp}
          scale={scale}
          disabled={currentTemp === null}
          onChange={setCurrentTemp}
          detail={currentDetail}
        />
        <TemperatureSlider
          label="Target"
          value={targetTemp}
          min={minTemp}
          max={maxTemp}
          scale={scale}
          onChange={setTargetTemp}
        />
      </div>

      {weatherError && (
        <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm font-bold text-amber-950">
          {weatherError} Using neutral weather assumptions.
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Ready by</h2>
        <div className="flex gap-3 items-center bg-white p-2 rounded-2xl border border-slate-200">
          <div className="flex-1 flex bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setReadyDay('today')}
              className={`flex-1 min-h-12 px-2 text-base font-black rounded-lg transition-colors ${readyDay === 'today' ? 'bg-white shadow-sm text-indigo-800' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setReadyDay('tomorrow')}
              className={`flex-1 min-h-12 px-2 text-base font-black rounded-lg transition-colors ${readyDay === 'tomorrow' ? 'bg-white shadow-sm text-indigo-800' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Tomorrow
            </button>
          </div>
          <select
            aria-label="Ready time"
            value={readyHour}
            onChange={event => {
              const hour = Number(event.target.value);
              setReadyHour(hour);
              if (readyDay === 'today' && hour <= new Date().getHours()) setReadyDay('tomorrow');
            }}
            className="w-32 min-h-14 bg-slate-100 text-slate-950 font-black text-xl px-2 rounded-xl text-center appearance-none cursor-pointer"
          >
            {Array.from({ length: 24 }).map((_, hour) => (
              <option key={hour} value={hour}>
                {timeFormat === '12h'
                  ? (hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`)
                  : `${hour.toString().padStart(2, '0')}:00`}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="bg-slate-950 text-white p-5 rounded-3xl border border-slate-800 space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-sm font-black uppercase tracking-widest text-slate-400">Start heating</div>
            <div className="mt-1 text-5xl font-black tracking-tight tabular-nums">
              {calculation ? format(calculation.startTime, timeFormat === '12h' ? 'h:mm a' : 'HH:mm') : '—'}
            </div>
            {calculation && !error && <div className="mt-1 text-base font-bold text-slate-300">{format(calculation.startTime, 'MMM d')}</div>}
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-slate-400">Est. cost</div>
            <div className="mt-1 text-2xl font-black tabular-nums">{calculation ? `£${calculation.costEstimate.toFixed(2)}` : '—'}</div>
          </div>
        </div>

        {error && <div role="status" className="rounded-xl bg-amber-400/15 border border-amber-300/30 px-3 py-2 text-sm font-bold text-amber-100">{error}</div>}

        {calculation && !error && (
          <>
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
              <span className="text-sm font-bold text-slate-300">{autoStartPreferred ? 'Auto-start enabled' : 'Manual start'}</span>
              <span className="text-sm font-bold text-slate-400">{calculation.expectedDurationHours.toFixed(1)} h</span>
            </div>

            <details className="rounded-xl bg-white/5">
              <summary className="min-h-12 cursor-pointer list-none px-3 flex items-center justify-between font-bold text-slate-300">
                Estimate details
                <span aria-hidden="true">+</span>
              </summary>
              <div className="grid grid-cols-2 gap-3 border-t border-white/10 px-3 py-3 text-sm font-bold text-slate-300">
                <div className="flex items-center gap-2"><Cloud className="w-4 h-4" aria-hidden="true" /><span>{Math.round(calculation.ambientTempAvg)}°C avg</span></div>
                <div className="flex items-center gap-2"><Wind className="w-4 h-4" aria-hidden="true" /><span>{Math.round(calculation.avgWindSpeed || 0)} km/h</span></div>
                <div className="flex items-center gap-2"><Sun className="w-4 h-4" aria-hidden="true" /><span>{Math.round(calculation.avgSolarRadiationWm2 || 0)} W/m²</span></div>
                <div className="text-right">{waterVolumeLiters.toLocaleString()} L</div>
              </div>
            </details>

            <button
              type="button"
              onClick={handleScheduleHeating}
              disabled={isSaving || saveSuccess}
              className={`min-h-14 w-full rounded-2xl px-4 font-black flex items-center justify-center gap-2 transition-colors ${saveSuccess ? 'bg-emerald-600 text-white' : 'bg-white text-slate-950 hover:bg-slate-100 disabled:bg-slate-300 disabled:text-slate-600'}`}
            >
              <Save className="w-5 h-5" aria-hidden="true" />
              {saveSuccess ? 'Heating scheduled' : isSaving ? 'Scheduling…' : 'Schedule heating'}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
