import React, { useEffect, useState } from 'react';
import { AppState } from '../types';
import { logEvent } from '../lib/firebase';
import { Cloud, Droplets, Filter, Flame, LogIn, LogOut, Minus, Plus, Thermometer, Volume2 } from 'lucide-react';
import { addDays } from 'date-fns';

interface ManualLogModalProps {
  state: AppState;
  onClose: () => void;
}

type Action =
  | 'heater_on'
  | 'heater_off'
  | 'entered_tub'
  | 'exited_tub'
  | 'part_refill'
  | 'full_refill'
  | 'filter_noisy'
  | 'filter_changed'
  | 'water_cloudy'
  | 'reading_only';
type ThreeState = 'on' | 'off' | 'unknown';

const ACTIONS: Array<{ value: Action; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'heater_on', label: 'Heater on', icon: Flame },
  { value: 'heater_off', label: 'Heater off', icon: Flame },
  { value: 'entered_tub', label: 'Getting in', icon: LogIn },
  { value: 'exited_tub', label: 'Getting out', icon: LogOut },
  { value: 'part_refill', label: 'Part Refill', icon: Droplets },
  { value: 'full_refill', label: 'Full Refill', icon: Droplets },
  { value: 'filter_noisy', label: 'Filter Noisy', icon: Volume2 },
  { value: 'filter_changed', label: 'Filter Changed', icon: Filter },
  { value: 'water_cloudy', label: 'Water Cloudy', icon: Cloud },
  { value: 'reading_only', label: 'Temperature', icon: Thermometer }
];

export function ManualLogModal({ state, onClose }: ManualLogModalProps) {
  const minTemp = state.config.temperatureScale === 'F' ? 50 : 10;
  const maxTemp = state.config.temperatureScale === 'F' ? 104 : 40;
  const [temp, setTemp] = useState<number>(state.config.defaultHeatingTarget || (state.config.temperatureScale === 'F' ? 100 : 38));
  const [action, setAction] = useState<Action>('reading_only');
  const [cover, setCover] = useState<ThreeState>('unknown');
  const [heater, setHeater] = useState<ThreeState>('unknown');
  const [filter, setFilter] = useState<ThreeState>('unknown');
  const [bubbles, setBubbles] = useState<ThreeState>('unknown');
  const [rattle, setRattle] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [isNow, setIsNow] = useState(true);

  const initNow = new Date();
  const initMin = Math.floor(initNow.getMinutes() / 5) * 5;
  const [selectedDate, setSelectedDate] = useState<'today' | 'yesterday'>('today');
  const [selectedHour, setSelectedHour] = useState(initNow.getHours());
  const [selectedMinute, setSelectedMinute] = useState(initMin);

  useEffect(() => {
    if (action === 'heater_on') setHeater('on');
    if (action === 'heater_off') setHeater('off');
    if (action === 'entered_tub') setCover('off');
    if (action === 'exited_tub') setCover('on');
  }, [action]);

  const handleSave = async () => {
    setIsSubmitting(true);

    let logDate = new Date();
    if (!isNow) {
      if (selectedDate === 'yesterday') logDate = addDays(logDate, -1);
      logDate.setHours(selectedHour, selectedMinute, 0, 0);
    } else {
      logDate.setMinutes(Math.floor(logDate.getMinutes() / 5) * 5, 0, 0);
    }

    await logEvent('manual_log', {
      action,
      temp: Number(temp),
      cover: cover !== 'unknown' ? cover : null,
      heater: heater !== 'unknown' ? heater : null,
      filter: filter !== 'unknown' ? filter : null,
      bubbles: bubbles !== 'unknown' ? bubbles : null,
      rattle: rattle !== 'unknown' ? rattle : null,
      manualTimestamp: logDate.getTime()
    });

    setIsSubmitting(false);
    onClose();
  };

  const getDisplayTime = () => {
    if (isNow) return 'Now';
    const day = selectedDate === 'today' ? 'Today' : 'Yesterday';
    return `${day} ${selectedHour.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
  };

  const nudgeTemp = (amount: number) => setTemp(value => Math.min(maxTemp, Math.max(minTemp, value + amount)));
  const tempMarks = state.config.temperatureScale === 'C' ? [10, 20, 30, 40] : [50, 70, 90, 100];

  const threeWay = <T extends string>(
    label: string,
    value: T,
    values: Array<{ value: NoInfer<T>; label: string }>,
    setValue: (next: NoInfer<T>) => void
  ) => (
    <div>
      <div className="mb-2 text-base font-black text-slate-800">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {values.map(option => (
          <button
            type="button"
            key={option.value}
            aria-pressed={value === option.value}
            onClick={() => setValue(option.value)}
            className={`min-h-12 rounded-xl font-black ${value === option.value ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );

  const equipmentChoices = [
    { value: 'unknown' as const, label: 'Unknown' }, { value: 'on' as const, label: 'On' }, { value: 'off' as const, label: 'Off' }
  ];

  return (
    <div className="p-4 sm:p-8 text-slate-700 max-w-md mx-auto pb-10">
      <h2 className="text-3xl font-black tracking-tight text-slate-950">Add log</h2>

      <div className="space-y-6 mt-5">
        <section>
          {!showTimePicker ? (
            <button type="button" onClick={() => setShowTimePicker(true)} className="w-full min-h-14 rounded-2xl bg-white border border-slate-200 px-4 flex items-center justify-between gap-3 text-left">
              <span className="font-black text-slate-700">When</span>
              <span className="font-black text-indigo-800">{getDisplayTime()}</span>
            </button>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-lg font-black text-slate-900">When</span>
                <button type="button" onClick={() => { setIsNow(true); setShowTimePicker(false); }} className="min-h-11 px-3 rounded-xl bg-slate-100 font-black text-indigo-800">Now</button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" aria-pressed={selectedDate === 'today'} onClick={() => { setSelectedDate('today'); setIsNow(false); }} className={`min-h-12 rounded-xl font-black ${selectedDate === 'today' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700'}`}>Today</button>
                <button type="button" aria-pressed={selectedDate === 'yesterday'} onClick={() => { setSelectedDate('yesterday'); setIsNow(false); }} className={`min-h-12 rounded-xl font-black ${selectedDate === 'yesterday' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700'}`}>Yesterday</button>
              </div>

              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <select aria-label="Hour" value={selectedHour} onChange={event => { setSelectedHour(Number(event.target.value)); setIsNow(false); }} className="min-h-14 bg-slate-100 border border-slate-200 rounded-xl text-xl font-black text-center text-slate-950">
                  {Array.from({ length: 24 }).map((_, hour) => <option key={hour} value={hour}>{hour.toString().padStart(2, '0')}</option>)}
                </select>
                <span className="text-2xl font-black text-slate-500">:</span>
                <select aria-label="Minute" value={selectedMinute} onChange={event => { setSelectedMinute(Number(event.target.value)); setIsNow(false); }} className="min-h-14 bg-slate-100 border border-slate-200 rounded-xl text-xl font-black text-center text-slate-950">
                  {Array.from({ length: 12 }).map((_, index) => <option key={index} value={index * 5}>{(index * 5).toString().padStart(2, '0')}</option>)}
                </select>
              </div>

              <button type="button" onClick={() => setShowTimePicker(false)} className="w-full min-h-12 bg-slate-200 text-slate-900 font-black rounded-xl">Done</button>
            </div>
          )}
        </section>

        <section>
          <h3 className="text-lg font-black text-slate-900 mb-3">What happened?</h3>
          <div className="grid grid-cols-2 gap-2">
            {ACTIONS.map(option => {
              const Icon = option.icon;
              const selected = action === option.value;
              return (
                <button
                  type="button"
                  key={option.value}
                  aria-pressed={selected}
                  onClick={() => setAction(option.value)}
                  className={`min-h-16 rounded-2xl px-3 flex items-center gap-3 text-left font-black ${selected ? 'bg-indigo-700 text-white' : 'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50'}`}
                >
                  <Icon className="w-6 h-6 shrink-0" aria-hidden="true" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-lg font-black text-slate-900">Temperature</span>
            <span className="rounded-2xl bg-slate-950 px-4 py-2 text-3xl font-black text-white tabular-nums">{temp}°{state.config.temperatureScale}</span>
          </div>

          <input type="range" aria-label="Temperature" min={minTemp} max={maxTemp} step={1} value={temp} onChange={event => setTemp(Number(event.target.value))} className="w-full mt-5 accent-indigo-700" />
          <div className="flex justify-between px-1 text-sm font-bold text-slate-500 tabular-nums" aria-hidden="true">
            {tempMarks.map(mark => <span key={mark}>{mark}</span>)}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <button type="button" aria-label="Lower temperature" onClick={() => nudgeTemp(-1)} className="h-14 rounded-xl bg-slate-100 text-slate-900 flex items-center justify-center"><Minus className="w-6 h-6" aria-hidden="true" /></button>
            <button type="button" aria-label="Raise temperature" onClick={() => nudgeTemp(1)} className="h-14 rounded-xl bg-slate-100 text-slate-900 flex items-center justify-center"><Plus className="w-6 h-6" aria-hidden="true" /></button>
          </div>
        </section>

        <details className="rounded-2xl border border-slate-200 bg-white px-4">
          <summary className="min-h-14 cursor-pointer flex items-center text-lg font-black text-slate-800">Equipment / details</summary>
          <div className="space-y-5 pb-4">
            {threeWay('Heater', heater, equipmentChoices, setHeater)}
            {threeWay('Filter', filter, equipmentChoices, setFilter)}
            {threeWay('Bubbles', bubbles, equipmentChoices, setBubbles)}
            {threeWay('Cover', cover, equipmentChoices, setCover)}
            {threeWay('Rattle', rattle, [
              { value: 'unknown', label: 'Unknown' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }
            ], setRattle)}
          </div>
        </details>

        <button type="button" onClick={() => void handleSave()} disabled={isSubmitting} className="w-full min-h-16 bg-slate-950 text-white font-black text-xl rounded-2xl hover:bg-slate-800 disabled:opacity-50">
          {isSubmitting ? 'Saving…' : 'Save log'}
        </button>
      </div>
    </div>
  );
}
