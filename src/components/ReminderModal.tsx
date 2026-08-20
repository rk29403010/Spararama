import React, { useEffect, useState } from 'react';
import { AppState, ActiveReminder } from '../types';
import { logEvent } from '../lib/firebase';
import { Bell, Check, Minus, Plus, X } from 'lucide-react';

interface ReminderModalProps {
  state: AppState;
  updateState: (newState: AppState) => void;
}

export function ReminderModal({ state, updateState }: ReminderModalProps) {
  const [activeReminder, setActiveReminder] = useState<ActiveReminder | null>(null);
  const minTemp = state.config.temperatureScale === 'F' ? 50 : 10;
  const maxTemp = state.config.temperatureScale === 'F' ? 104 : 40;
  const [currentTemp, setCurrentTemp] = useState<number>(state.config.defaultHeatingTarget || (state.config.temperatureScale === 'F' ? 100 : 38));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now();
      const triggered = state.reminders?.find(reminder => now >= reminder.scheduledTime);
      if (!triggered || activeReminder) return;
      setActiveReminder(triggered);
      setCurrentTemp(triggered.type === 'start_heating'
        ? (triggered.sessionData?.startTemp || minTemp)
        : (triggered.sessionData?.targetTemp || maxTemp));
    };
    checkReminders();
    const interval = setInterval(checkReminders, 10000);
    return () => clearInterval(interval);
  }, [state.reminders, activeReminder, minTemp, maxTemp]);

  if (!activeReminder) return null;

  const isStart = activeReminder.type === 'start_heating';
  const marks = state.config.temperatureScale === 'C' ? [10, 20, 30, 40] : [50, 70, 90, 100];

  const handleDismiss = () => {
    updateState({ ...state, reminders: state.reminders.filter(reminder => reminder.id !== activeReminder.id) });
    setActiveReminder(null);
  };

  const handleSave = async (gettingIn: boolean, additionalMinutes?: number) => {
    setIsSubmitting(true);

    if (isStart) {
      await logEvent('heating_action', {
        action: 'started_heating',
        temp: currentTemp,
        scheduledTime: activeReminder.scheduledTime,
        prediction: activeReminder.sessionData
      });
      await logEvent('heating_calculated', activeReminder.sessionData);
    } else {
      await logEvent('manual_log', gettingIn ? {
        action: 'entered_tub',
        temp: currentTemp,
        cover: 'off',
        heater: 'unknown',
        manualTimestamp: Date.now()
      } : {
        action: 'reading_only',
        temp: currentTemp,
        cover: 'unknown',
        heater: 'unknown',
        manualTimestamp: Date.now()
      });

      if (additionalMinutes) {
        const newReminder: ActiveReminder = {
          id: Date.now().toString(),
          type: 'tub_ready',
          scheduledTime: Date.now() + (additionalMinutes * 60 * 1000),
          sessionData: activeReminder.sessionData
        };
        updateState({
          ...state,
          reminders: [...state.reminders.filter(reminder => reminder.id !== activeReminder.id), newReminder]
        });
        setActiveReminder(null);
        setIsSubmitting(false);
        return;
      }
    }

    setIsSubmitting(false);
    handleDismiss();
  };

  const nudge = (amount: number) => setCurrentTemp(value => Math.min(maxTemp, Math.max(minTemp, value + amount)));

  return (
    <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overscroll-contain">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-5 sm:p-6 shadow-2xl relative">
        <button type="button" aria-label="Dismiss reminder" onClick={handleDismiss} className="absolute top-4 right-4 w-12 h-12 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center hover:bg-slate-200">
          <X className="w-6 h-6" aria-hidden="true" />
        </button>

        <div className="w-12 h-12 bg-indigo-100 text-indigo-800 rounded-2xl flex items-center justify-center mb-4">
          <Bell className="w-6 h-6" aria-hidden="true" />
        </div>

        <h2 className="text-3xl font-black text-slate-950 pr-12">
          {isStart ? 'Start heating' : 'Spa ready?'}
        </h2>

        <div className="mt-6 space-y-6">
          <section>
            <div className="flex items-center justify-between gap-3">
              <span className="text-base font-black text-slate-700">Actual temperature</span>
              <span className="rounded-2xl border-2 border-slate-300 bg-slate-950 px-4 py-2 text-3xl font-black text-white tabular-nums">{currentTemp}°{state.config.temperatureScale}</span>
            </div>

            <input
              type="range"
              aria-label="Actual temperature"
              min={minTemp}
              max={maxTemp}
              step={1}
              value={currentTemp}
              onChange={event => setCurrentTemp(Number(event.target.value))}
              className="w-full mt-5 accent-indigo-700"
            />
            <div className="flex justify-between px-1 text-sm font-bold text-slate-500 tabular-nums" aria-hidden="true">
              {marks.map(mark => <span key={mark}>{mark}</span>)}
            </div>

            <div className="mt-4 grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-3">
              <button type="button" aria-label="Lower temperature" onClick={() => nudge(-1)} className="h-14 rounded-xl bg-slate-100 text-slate-900 flex items-center justify-center"><Minus className="w-6 h-6" aria-hidden="true" /></button>
              <div className="text-center text-lg font-black text-slate-600">1° steps</div>
              <button type="button" aria-label="Raise temperature" onClick={() => nudge(1)} className="h-14 rounded-xl bg-slate-100 text-slate-900 flex items-center justify-center"><Plus className="w-6 h-6" aria-hidden="true" /></button>
            </div>
          </section>

          {isStart ? (
            <button type="button" onClick={() => void handleSave(false)} disabled={isSubmitting} className="w-full min-h-16 flex items-center justify-center gap-2 bg-indigo-700 text-white text-lg font-black rounded-2xl hover:bg-indigo-800 disabled:opacity-50">
              <Check className="w-6 h-6" aria-hidden="true" />Heater on
            </button>
          ) : (
            <div className="space-y-3">
              <button type="button" onClick={() => void handleSave(true)} disabled={isSubmitting} className="w-full min-h-16 bg-emerald-700 text-white text-xl font-black rounded-2xl hover:bg-emerald-800 disabled:opacity-50">
                Getting in
              </button>
              <button type="button" onClick={() => void handleSave(false, 10)} disabled={isSubmitting} className="w-full min-h-14 bg-slate-100 text-slate-900 text-lg font-black rounded-2xl hover:bg-slate-200 disabled:opacity-50">
                Not ready - 10 min
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
