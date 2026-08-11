import React, { useState, useEffect } from 'react';
import { AppState, ActiveReminder } from '../types';
import { logEvent } from '../lib/firebase';
import { Thermometer, Bell, X, Check } from 'lucide-react';

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

  // Check for triggered reminders periodically
  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now();
      const triggered = state.reminders?.find(r => now >= r.scheduledTime);
      if (triggered && !activeReminder) {
        setActiveReminder(triggered);
        if (triggered.type === 'start_heating') {
          setCurrentTemp(triggered.sessionData?.startTemp || minTemp);
        } else {
          setCurrentTemp(triggered.sessionData?.targetTemp || maxTemp);
        }
      }
    };
    checkReminders();
    const interval = setInterval(checkReminders, 10000);
    return () => clearInterval(interval);
  }, [state.reminders, activeReminder, minTemp, maxTemp]);

  if (!activeReminder) return null;

  const isStart = activeReminder.type === 'start_heating';
  const tempPercent = ((currentTemp - minTemp) / (maxTemp - minTemp)) * 100;

  const handleDismiss = () => {
    const newReminders = state.reminders.filter(r => r.id !== activeReminder.id);
    updateState({ ...state, reminders: newReminders });
    setActiveReminder(null);
  };

  const handleSave = async (gettingIn: boolean, additionalMinutes?: number) => {
    setIsSubmitting(true);
    
    // Save standard heating log
    if (isStart) {
      const logData = {
        action: 'started_heating',
        temp: currentTemp,
        scheduledTime: activeReminder.scheduledTime,
        prediction: activeReminder.sessionData
      };
      await logEvent('heating_action', logData);
      await logEvent('heating_calculated', activeReminder.sessionData);
    } else {
      // It's a tub_ready reminder
      // We log a manual log for temperature & cover (if getting in)
      if (gettingIn) {
        await logEvent('manual_log', {
          action: 'entered_tub',
          temp: currentTemp,
          cover: 'off',
          heater: 'unknown',
          manualTimestamp: Date.now()
        });
      } else {
        await logEvent('manual_log', {
          action: 'reading_only',
          temp: currentTemp,
          cover: 'unknown',
          heater: 'unknown',
          manualTimestamp: Date.now()
        });
      }
      
      // If we need to wait another 10 mins, set a new reminder
      if (additionalMinutes) {
        const newReminder: ActiveReminder = {
          id: Date.now().toString(),
          type: 'tub_ready',
          scheduledTime: Date.now() + (additionalMinutes * 60 * 1000),
          sessionData: activeReminder.sessionData
        };
        const updatedReminders = state.reminders.filter(r => r.id !== activeReminder.id);
        updateState({ ...state, reminders: [...updatedReminders, newReminder] });
        setActiveReminder(null);
        setIsSubmitting(false);
        return;
      }
    }

    setIsSubmitting(false);
    handleDismiss();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl relative">
        <button onClick={handleDismiss} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
        
        <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-4">
          <Bell className="w-6 h-6" />
        </div>
        
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          {isStart ? "Time to start heating!" : "Tub should be ready!"}
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          {isStart 
            ? "Your scheduled heating time has arrived. Please confirm to improve future predictions."
            : "Your target time has arrived. Is the tub ready?"}
        </p>

        <div className="space-y-6">
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
            <span className="text-sm font-bold text-slate-700 block mb-4 flex items-center gap-2">
              <Thermometer className="w-4 h-4" /> Actual Temperature
            </span>
            <div className="relative h-14 flex items-center bg-slate-200 rounded-full px-[15px]">
              
              <div className="absolute inset-0 flex items-center justify-between px-[15px] pointer-events-none">
                {state.config.temperatureScale === 'C' ? (
                  <>
                    <div className="absolute flex flex-col items-center" style={{ left: 'calc(15px + (100% - 30px) * 0.3333)' }}>
                      <div className="h-2 w-0.5 bg-slate-400 rounded-full mb-6"></div>
                      <span className="absolute mt-6 text-[10px] font-bold text-slate-400">20</span>
                    </div>
                    <div className="absolute flex flex-col items-center" style={{ left: 'calc(15px + (100% - 30px) * 0.6667)' }}>
                      <div className="h-2 w-0.5 bg-slate-400 rounded-full mb-6"></div>
                      <span className="absolute mt-6 text-[10px] font-bold text-slate-400">30</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="absolute flex flex-col items-center" style={{ left: 'calc(15px + (100% - 30px) * 0.3703)' }}>
                      <div className="h-2 w-0.5 bg-slate-400 rounded-full mb-6"></div>
                      <span className="absolute mt-6 text-[10px] font-bold text-slate-400">70</span>
                    </div>
                    <div className="absolute flex flex-col items-center" style={{ left: 'calc(15px + (100% - 30px) * 0.7407)' }}>
                      <div className="h-2 w-0.5 bg-slate-400 rounded-full mb-6"></div>
                      <span className="absolute mt-6 text-[10px] font-bold text-slate-400">90</span>
                    </div>
                  </>
                )}
              </div>

              <div 
                className="absolute h-full bg-indigo-500 rounded-full pointer-events-none transition-all duration-150 ease-out left-0"
                style={{ width: `calc(15px + (100% - 30px) * ${tempPercent / 100} + 15px)` }}
              />

              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="bg-white shadow-sm px-4 py-1.5 rounded-full flex items-baseline">
                  <span className="text-2xl font-black text-slate-900 tracking-tighter leading-none">{currentTemp}</span>
                  <span className="text-sm font-bold text-slate-500 ml-0.5">°{state.config.temperatureScale}</span>
                </div>
              </div>

              <input 
                type="range"
                min={minTemp}
                max={maxTemp}
                step={1}
                value={currentTemp}
                onChange={e => setCurrentTemp(Number(e.target.value))}
                className="absolute inset-0 w-full h-full appearance-none bg-transparent outline-none slider-thumb-transparent z-20"
              />
            </div>
            <div className="flex justify-between mt-3 px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              <span>{minTemp}°</span>
              <span>{maxTemp}°</span>
            </div>
          </div>

          {isStart ? (
            <button
              onClick={() => handleSave(false)}
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              <Check className="w-5 h-5" /> Switched Heater On
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleSave(true)}
                disabled={isSubmitting}
                className="flex flex-col items-center justify-center gap-1 bg-emerald-500 text-white font-bold py-3 rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                <span className="text-2xl">😁</span>
                <span className="text-sm">Getting In</span>
              </button>
              <button
                onClick={() => handleSave(false, 10)}
                disabled={isSubmitting}
                className="flex flex-col items-center justify-center gap-1 bg-amber-500 text-white font-bold py-3 rounded-xl hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                <span className="text-2xl">🙁</span>
                <span className="text-sm">Another 10m</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
