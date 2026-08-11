import React, { useState, useEffect } from 'react';
import { AppState } from '../types';
import { logEvent } from '../lib/firebase';
import { X, Thermometer, Flame, LogIn, LogOut } from 'lucide-react';
import { format, addDays } from 'date-fns';

interface ManualLogModalProps {
  state: AppState;
  onClose: () => void;
}

const CrossedFlame = () => (
  <div className="relative w-6 h-6 mb-1">
    <Flame className="w-6 h-6 absolute" />
    <svg className="w-full h-full absolute text-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="3" x2="21" y2="21"></line></svg>
  </div>
);

export function ManualLogModal({ state, onClose }: ManualLogModalProps) {
  const minTemp = state.config.temperatureScale === 'F' ? 50 : 10;
  const maxTemp = state.config.temperatureScale === 'F' ? 104 : 40;
  
  const [temp, setTemp] = useState<number>(state.config.defaultHeatingTarget || (state.config.temperatureScale === 'F' ? 100 : 38));
  const [action, setAction] = useState<'reading_only' | 'heater_on' | 'heater_off' | 'entered_tub' | 'exited_tub'>('reading_only');
  const [cover, setCover] = useState<'on' | 'off' | 'unknown'>('unknown');
  const [heater, setHeater] = useState<'on' | 'off' | 'unknown'>('unknown');
  const [rattle, setRattle] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Time state
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [isNow, setIsNow] = useState(true);
  
  const initNow = new Date();
  const initMin = Math.floor(initNow.getMinutes() / 5) * 5;
  const [selectedDate, setSelectedDate] = useState<'today' | 'yesterday'>('today');
  const [selectedHour, setSelectedHour] = useState(initNow.getHours());
  const [selectedMinute, setSelectedMinute] = useState(initMin);

  // Update related states automatically based on action selection
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
      logDate = new Date();
      if (selectedDate === 'yesterday') {
        logDate = addDays(logDate, -1);
      }
      logDate.setHours(selectedHour, selectedMinute, 0, 0);
    } else {
      // "Now" rounded to 5 mins
      logDate.setMinutes(Math.floor(logDate.getMinutes() / 5) * 5, 0, 0);
    }

    const logData = {
      action,
      temp: temp !== null ? Number(temp) : null,
      cover: cover !== 'unknown' ? cover : null,
      heater: heater !== 'unknown' ? heater : null,
      rattle: rattle !== 'unknown' ? rattle : null,
      manualTimestamp: logDate.getTime()
    };

    await logEvent('manual_log', logData);
    
    setIsSubmitting(false);
    onClose();
  };

  const getDisplayTime = () => {
    if (isNow) return 'Now';
    const d = selectedDate === 'today' ? 'Today' : 'Yesterday';
    const h = selectedHour.toString().padStart(2, '0');
    const m = selectedMinute.toString().padStart(2, '0');
    return `${d} at ${h}:${m}`;
  };

  const tempPercent = ((temp - minTemp) / (maxTemp - minTemp)) * 100;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex flex-col justify-end sm:justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-md mx-auto p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto pb-8 sm:pb-6">
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 p-2 rounded-full">
          <X className="w-5 h-5" />
        </button>
        
        <div className="space-y-6 mt-10">
          
          {/* When */}
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            {!showTimePicker ? (
              <button 
                onClick={() => setShowTimePicker(true)} 
                className="w-full flex items-center justify-between text-left"
              >
                <span className="text-sm font-bold text-slate-400 uppercase">When</span>
                <span className="font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl">{getDisplayTime()}</span>
              </button>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-400 uppercase">When</span>
                  <button 
                    onClick={() => { setIsNow(true); setShowTimePicker(false); }}
                    className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg"
                  >
                    Reset to Now
                  </button>
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => { setSelectedDate('today'); setIsNow(false); }} 
                    className={`flex-1 py-3 font-bold rounded-xl transition-colors ${selectedDate === 'today' ? 'bg-slate-900 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-700'}`}
                  >Today</button>
                  <button 
                    onClick={() => { setSelectedDate('yesterday'); setIsNow(false); }} 
                    className={`flex-1 py-3 font-bold rounded-xl transition-colors ${selectedDate === 'yesterday' ? 'bg-slate-900 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-700'}`}
                  >Yesterday</button>
                </div>

                <div className="flex gap-2 items-center bg-white border border-slate-200 p-2 rounded-xl">
                  <select 
                    value={selectedHour} 
                    onChange={e => { setSelectedHour(Number(e.target.value)); setIsNow(false); }} 
                    className="flex-1 py-2 text-xl font-bold bg-transparent text-center appearance-none text-slate-900 outline-none"
                  >
                    {Array.from({length: 24}).map((_, i) => <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>)}
                  </select>
                  <span className="text-2xl font-bold text-slate-300">:</span>
                  <select 
                    value={selectedMinute} 
                    onChange={e => { setSelectedMinute(Number(e.target.value)); setIsNow(false); }} 
                    className="flex-1 py-2 text-xl font-bold bg-transparent text-center appearance-none text-slate-900 outline-none"
                  >
                    {Array.from({length: 12}).map((_, i) => <option key={i} value={i*5}>{(i*5).toString().padStart(2, '0')}</option>)}
                  </select>
                </div>
                
                <button 
                  onClick={() => setShowTimePicker(false)} 
                  className="w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-xl"
                >Done</button>
              </div>
            )}
          </div>

          {/* Action Grid */}
          <div>
            <span className="text-sm font-bold text-slate-400 uppercase mb-3 block px-2">Action</span>
            <div className="grid grid-cols-5 gap-2">
              <button 
                onClick={() => setAction('reading_only')} 
                className={`flex flex-col items-center justify-center py-4 rounded-2xl transition-all ${action === 'reading_only' ? 'bg-indigo-600 text-white shadow-md scale-105' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200'}`}
              >
                <Thermometer className="w-6 h-6 mb-1.5" />
                <span className="text-[10px] font-bold text-center leading-tight uppercase tracking-wider">Note<br/>Temp</span>
              </button>
              <button 
                onClick={() => setAction('heater_on')} 
                className={`flex flex-col items-center justify-center py-4 rounded-2xl transition-all ${action === 'heater_on' ? 'bg-rose-500 text-white shadow-md scale-105' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200'}`}
              >
                <Flame className="w-6 h-6 mb-1.5" />
                <span className="text-[10px] font-bold text-center leading-tight uppercase tracking-wider">Heater<br/>On</span>
              </button>
              <button 
                onClick={() => setAction('heater_off')} 
                className={`flex flex-col items-center justify-center py-4 rounded-2xl transition-all ${action === 'heater_off' ? 'bg-slate-900 text-white shadow-md scale-105' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200'}`}
              >
                <CrossedFlame />
                <span className="text-[10px] font-bold text-center leading-tight uppercase tracking-wider">Heater<br/>Off</span>
              </button>
              <button 
                onClick={() => setAction('entered_tub')} 
                className={`flex flex-col items-center justify-center py-4 rounded-2xl transition-all ${action === 'entered_tub' ? 'bg-emerald-500 text-white shadow-md scale-105' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200'}`}
              >
                <LogIn className="w-6 h-6 mb-1.5" />
                <span className="text-[10px] font-bold text-center leading-tight uppercase tracking-wider">Get<br/>In</span>
              </button>
              <button 
                onClick={() => setAction('exited_tub')} 
                className={`flex flex-col items-center justify-center py-4 rounded-2xl transition-all ${action === 'exited_tub' ? 'bg-emerald-700 text-white shadow-md scale-105' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200'}`}
              >
                <LogOut className="w-6 h-6 mb-1.5" />
                <span className="text-[10px] font-bold text-center leading-tight uppercase tracking-wider">Get<br/>Out</span>
              </button>
            </div>
          </div>

          {/* Temperature Slider */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
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
                  <span className="text-2xl font-black text-slate-900 tracking-tighter leading-none">{temp}</span>
                  <span className="text-sm font-bold text-slate-500 ml-0.5">°{state.config.temperatureScale}</span>
                </div>
              </div>

              <input 
                type="range"
                min={minTemp}
                max={maxTemp}
                step={1}
                value={temp}
                onChange={e => setTemp(Number(e.target.value))}
                className="absolute inset-0 w-full h-full appearance-none bg-transparent outline-none slider-thumb-transparent z-20"
              />
            </div>
            <div className="flex justify-between mt-3 px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              <span>{minTemp}°</span>
              <span>{maxTemp}°</span>
            </div>
          </div>

          {/* Optional Toggles */}
          <div className="flex gap-2">
            <label className="flex-1 block">
              <span className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-wider px-1 text-center">Heater</span>
              <div className="flex flex-col bg-slate-50 rounded-xl p-1 border border-slate-100 gap-1">
                <button
                  onClick={() => setHeater('unknown')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all ${heater === 'unknown' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >?</button>
                <button
                  onClick={() => setHeater('on')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all ${heater === 'on' ? 'bg-rose-500 shadow-sm text-white' : 'text-slate-400 hover:text-slate-600'}`}
                >On</button>
                <button
                  onClick={() => setHeater('off')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all ${heater === 'off' ? 'bg-slate-800 shadow-sm text-white' : 'text-slate-400 hover:text-slate-600'}`}
                >Off</button>
              </div>
            </label>
            <label className="flex-1 block">
              <span className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-wider px-1 text-center">Cover</span>
              <div className="flex flex-col bg-slate-50 rounded-xl p-1 border border-slate-100 gap-1">
                <button
                  onClick={() => setCover('unknown')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all ${cover === 'unknown' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >?</button>
                <button
                  onClick={() => setCover('on')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all ${cover === 'on' ? 'bg-indigo-600 shadow-sm text-white' : 'text-slate-400 hover:text-slate-600'}`}
                >On</button>
                <button
                  onClick={() => setCover('off')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all ${cover === 'off' ? 'bg-amber-500 shadow-sm text-white' : 'text-slate-400 hover:text-slate-600'}`}
                >Off</button>
              </div>
            </label>
            <label className="flex-1 block">
              <span className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-wider px-1 text-center">Rattle</span>
              <div className="flex flex-col bg-slate-50 rounded-xl p-1 border border-slate-100 gap-1">
                <button
                  onClick={() => setRattle('unknown')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all ${rattle === 'unknown' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                >?</button>
                <button
                  onClick={() => setRattle('yes')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all ${rattle === 'yes' ? 'bg-rose-500 shadow-sm text-white' : 'text-slate-400 hover:text-slate-600'}`}
                >Yes</button>
                <button
                  onClick={() => setRattle('no')}
                  className={`py-3 text-sm font-bold rounded-lg transition-all ${rattle === 'no' ? 'bg-emerald-500 shadow-sm text-white' : 'text-slate-400 hover:text-slate-600'}`}
                >No</button>
              </div>
            </label>
          </div>

          <button
            onClick={handleSave}
            disabled={isSubmitting || temp === null}
            className="w-full bg-slate-900 text-white font-black text-lg py-5 mt-2 rounded-2xl hover:bg-slate-800 transition-colors disabled:opacity-50 active:scale-[0.98]"
          >
            {isSubmitting ? 'SAVING...' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>
  );
}

