import React, { useEffect, useState } from 'react';
import { loadState, saveState } from './lib/storage';
import { AppState } from './types';
import { Home } from './components/Home';
import { BathingControls } from './components/BathingControls';
import { Chemicals } from './components/Chemicals';
import { Heating } from './components/Heating';
import { HeatingNotifications } from './components/HeatingNotifications';
import { Logs } from './components/Logs';
import { ReminderModal } from './components/ReminderModal';
import { ManualLogModal } from './components/ManualLogModal';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { TelemetrySettings } from './components/TelemetrySettings';
import { SpaConfiguration } from './components/SpaConfiguration';
import { WeatherConfiguration } from './components/WeatherConfiguration';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Droplets, Flame, Settings, List, Plus, LogOut, User as UserIcon, House } from 'lucide-react';
import { subscribeToAuthChanges, signOutUser } from './lib/firebase';
import type { User } from 'firebase/auth';

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'chemicals' | 'heating' | 'settings' | 'logs'>('home');
  const [showManualLog, setShowManualLog] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    loadState().then(s => setState(s));
    const unsubscribe = subscribeToAuthChanges((u) => { setUser(u); setAuthInitialized(true); });
    return () => unsubscribe();
  }, []);

  const updateState = (newState: AppState) => { setState(newState); saveState(newState); };
  if (!state || !authInitialized) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2"><div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center"><Droplets className="w-5 h-5 text-white" /></div><h1 className="text-xl font-bold text-slate-900 tracking-tight">Spa Monitor</h1></div>
          <div className="flex items-center gap-3">
            {!user ? <ErrorBoundary resetKey="header-auth" title="Sign-in control unavailable"><GoogleSignInButton /></ErrorBoundary> : <div className="flex items-center gap-2"><span className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700"><UserIcon className="w-4 h-4" /></span></div>}
            <button onClick={() => setShowManualLog(true)} className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors"><Plus className="w-6 h-6" /></button>
          </div>
        </div>
        {!user && <div className="bg-amber-100 px-4 py-2 text-center text-amber-800 text-xs font-semibold">You are not signed in. Activity logs and history will not be saved.</div>}
      </header>

      <main className="flex-1 pb-20 overflow-y-auto">
        <ErrorBoundary resetKey={activeTab} title={`${activeTab[0].toUpperCase()}${activeTab.slice(1)} page hit a problem`}>
          {activeTab === 'home' && <><Home state={state} /><BathingControls state={state} updateState={updateState} /></>}
          {activeTab === 'heating' && <Heating state={state} updateState={updateState} />}
          {activeTab === 'chemicals' && <Chemicals state={state} updateState={updateState} />}
          {activeTab === 'logs' && <Logs state={state} />}
          {activeTab === 'settings' && (
            <div className="p-4 sm:p-8 text-slate-500 max-w-md mx-auto space-y-6">
              <h2 className="text-2xl font-semibold text-slate-900 text-center">Settings</h2>
              <ErrorBoundary resetKey="spa-configuration" title="Spa / pool configuration hit a problem"><SpaConfiguration state={state} updateState={updateState} /></ErrorBoundary>
              <ErrorBoundary resetKey="weather-configuration" title="Weather configuration hit a problem"><WeatherConfiguration /></ErrorBoundary>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-6">
                <label className="flex items-center justify-between"><span className="font-medium text-slate-700 text-lg">Account</span>{user ? <button className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-bold flex items-center gap-2 hover:bg-slate-200" onClick={signOutUser}><LogOut className="w-4 h-4" /> Sign Out</button> : <GoogleSignInButton />}</label>
                <label className="flex items-center justify-between"><span className="font-medium text-slate-700 text-lg">Temperature Scale</span><div className="flex bg-slate-100 p-1 rounded-xl"><button className={`px-4 py-2 rounded-lg font-bold ${state.config.temperatureScale === 'C' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`} onClick={() => updateState({...state, config: {...state.config, temperatureScale: 'C'}})}>°C</button><button className={`px-4 py-2 rounded-lg font-bold ${state.config.temperatureScale === 'F' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`} onClick={() => updateState({...state, config: {...state.config, temperatureScale: 'F'}})}>°F</button></div></label>
                <label className="flex items-center justify-between"><span className="font-medium text-slate-700 text-lg">Time Format</span><div className="flex bg-slate-100 p-1 rounded-xl"><button className={`px-4 py-2 rounded-lg font-bold ${state.config.timeFormat === '12h' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`} onClick={() => updateState({...state, config: {...state.config, timeFormat: '12h'}})}>12h</button><button className={`px-4 py-2 rounded-lg font-bold ${state.config.timeFormat === '24h' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`} onClick={() => updateState({...state, config: {...state.config, timeFormat: '24h'}})}>24h</button></div></label>
                <label className="flex items-center justify-between"><span className="font-medium text-slate-700 text-lg">Default Tub Time</span><input type="time" value={state.config.defaultReadyTime} onChange={(e) => updateState({...state, config: {...state.config, defaultReadyTime: e.target.value}})} className="bg-slate-100 text-slate-900 font-bold px-4 py-2 rounded-xl outline-none" /></label>
                <label className="flex items-center justify-between"><span className="font-medium text-slate-700 text-lg">Default Target Temp (°{state.config.temperatureScale})</span><input type="number" value={state.config.defaultHeatingTarget} onChange={(e) => updateState({...state, config: {...state.config, defaultHeatingTarget: Number(e.target.value) || 40}})} className="bg-slate-100 text-slate-900 font-bold px-4 py-2 rounded-xl outline-none w-24 text-center" /></label>
                <label className="flex items-center justify-between"><div><span className="font-medium text-slate-700 text-lg block">Heat Soak Time</span><span className="text-xs text-slate-500 block">Extra mins to hold temp before getting in</span></div><div className="relative"><input type="number" step="5" min="0" value={state.config.heatSoakMinutes ?? 30} onChange={(e) => updateState({...state, config: {...state.config, heatSoakMinutes: parseInt(e.target.value) || 0}})} className="bg-slate-100 text-slate-900 font-bold pr-8 pl-4 py-2 rounded-xl outline-none w-24 text-center" /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">m</span></div></label>
                <label className="flex items-center justify-between"><span className="font-medium text-slate-700 text-lg">Unit Rate (/kWh)</span><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">£</span><input type="number" step="0.0001" min="0" value={state.config.electricityRatePerKwh} onChange={(e) => updateState({...state, config: {...state.config, electricityRatePerKwh: parseFloat(e.target.value) || 0}})} className="bg-slate-100 text-slate-900 font-bold pl-8 pr-4 py-2 rounded-xl outline-none w-32" /></div></label>
              </div>
              <TelemetrySettings />
            </div>
          )}
        </ErrorBoundary>
      </main>

      <footer className="bg-white border-t border-slate-200 fixed bottom-0 left-0 right-0 z-10 pb-safe">
        <div className="max-w-md mx-auto flex">
          <button onClick={() => setActiveTab('home')} className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 ${activeTab === 'home' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}><House className="w-6 h-6" /><span className="text-[10px] font-semibold uppercase tracking-wider">Home</span></button>
          <button onClick={() => setActiveTab('heating')} className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 ${activeTab === 'heating' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}><Flame className="w-6 h-6" /><span className="text-[10px] font-semibold uppercase tracking-wider">Heating</span></button>
          <button onClick={() => setActiveTab('chemicals')} className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 ${activeTab === 'chemicals' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}><Droplets className="w-6 h-6" /><span className="text-[10px] font-semibold uppercase tracking-wider">Chemicals</span></button>
          <button onClick={() => setActiveTab('logs')} className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 ${activeTab === 'logs' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}><List className="w-6 h-6" /><span className="text-[10px] font-semibold uppercase tracking-wider">Logs</span></button>
          <button onClick={() => setActiveTab('settings')} className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 ${activeTab === 'settings' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}><Settings className="w-6 h-6" /><span className="text-[10px] font-semibold uppercase tracking-wider">Config</span></button>
        </div>
      </footer>

      <ErrorBoundary resetKey={showManualLog ? 'manual-open' : 'manual-closed'} title="Manual log form hit a problem">{showManualLog && <ManualLogModal state={state} onClose={() => setShowManualLog(false)} />}</ErrorBoundary>
      <ErrorBoundary resetKey="heating-notifications" title="Heating notification hit a problem"><HeatingNotifications /></ErrorBoundary>
      <ErrorBoundary resetKey="reminders" title="Reminder panel hit a problem"><ReminderModal state={state} updateState={updateState} /></ErrorBoundary>
    </div>
  );
}
