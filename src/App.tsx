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
import { ClipboardPlus, Droplets, Flame, Settings, List, LogOut, User as UserIcon, House } from 'lucide-react';
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

  if (!state || !authInitialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-100 text-slate-600">
        <span className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-sm">
          <Droplets className="w-7 h-7" />
        </span>
        <span className="font-bold">Loading Spararama…</span>
      </div>
    );
  }

  const activeWaterBody = state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) ?? state.domain.waterBodies[0];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-950">
      <header className="bg-white/95 backdrop-blur border-b border-slate-200 sticky top-0 z-30 shadow-[0_1px_0_rgba(15,23,42,0.02)]">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center shrink-0 shadow-sm">
              <Droplets className="w-6 h-6 text-sky-200" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl leading-tight font-black text-slate-950 tracking-tight">Spararama</h1>
              <p className="text-xs leading-tight font-semibold text-slate-500 truncate">{activeWaterBody?.name || 'Hot tub care'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!user ? (
              <ErrorBoundary resetKey="header-auth" title="Sign-in control unavailable"><GoogleSignInButton /></ErrorBoundary>
            ) : (
              <span aria-label="Signed in" title="Signed in" className="w-11 h-11 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-800">
                <UserIcon className="w-5 h-5" />
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowManualLog(true)}
              className="min-h-11 px-3.5 rounded-xl bg-indigo-600 text-white flex items-center justify-center gap-2 font-extrabold shadow-sm active:scale-[0.98] transition-transform"
              aria-label="Add manual log"
            >
              <ClipboardPlus className="w-5 h-5" />
              <span className="hidden xs:inline sm:inline">Log</span>
            </button>
          </div>
        </div>
        {!user && <div className="bg-amber-100 border-t border-amber-200 px-4 py-2 text-center text-amber-950 text-xs font-bold">Not signed in - activity logs and history will not be saved.</div>}
      </header>

      <main className="flex-1 pb-24 overflow-y-auto">
        <ErrorBoundary resetKey={activeTab} title={`${activeTab[0].toUpperCase()}${activeTab.slice(1)} page hit a problem`}>
          {activeTab === 'home' && <><Home state={state} /><BathingControls state={state} updateState={updateState} /></>}
          {activeTab === 'heating' && <Heating state={state} updateState={updateState} />}
          {activeTab === 'chemicals' && <Chemicals state={state} updateState={updateState} />}
          {activeTab === 'logs' && <Logs state={state} />}
          {activeTab === 'settings' && (
            <div className="p-4 sm:p-8 text-slate-600 max-w-xl mx-auto space-y-6">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Spararama</p>
                <h2 className="text-3xl font-black tracking-tight text-slate-950 mt-1">Settings</h2>
              </div>
              <ErrorBoundary resetKey="spa-configuration" title="Spa / pool configuration hit a problem"><SpaConfiguration state={state} updateState={updateState} /></ErrorBoundary>
              <ErrorBoundary resetKey="weather-configuration" title="Weather configuration hit a problem"><WeatherConfiguration /></ErrorBoundary>

              <div className="bg-white p-5 sm:p-6 rounded-3xl shadow-sm border border-slate-200 space-y-6">
                <label className="flex items-center justify-between gap-4"><span className="font-bold text-slate-800 text-base sm:text-lg">Account</span>{user ? <button className="min-h-11 px-4 bg-slate-100 text-slate-800 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-200" onClick={signOutUser}><LogOut className="w-4 h-4" /> Sign out</button> : <GoogleSignInButton />}</label>
                <label className="flex items-center justify-between gap-4"><span className="font-bold text-slate-800 text-base sm:text-lg">Temperature scale</span><div className="flex bg-slate-100 p-1 rounded-xl"><button className={`min-h-10 px-4 rounded-lg font-bold ${state.config.temperatureScale === 'C' ? 'bg-white shadow-sm text-slate-950' : 'text-slate-600'}`} onClick={() => updateState({...state, config: {...state.config, temperatureScale: 'C'}})}>°C</button><button className={`min-h-10 px-4 rounded-lg font-bold ${state.config.temperatureScale === 'F' ? 'bg-white shadow-sm text-slate-950' : 'text-slate-600'}`} onClick={() => updateState({...state, config: {...state.config, temperatureScale: 'F'}})}>°F</button></div></label>
                <label className="flex items-center justify-between gap-4"><span className="font-bold text-slate-800 text-base sm:text-lg">Time format</span><div className="flex bg-slate-100 p-1 rounded-xl"><button className={`min-h-10 px-4 rounded-lg font-bold ${state.config.timeFormat === '12h' ? 'bg-white shadow-sm text-slate-950' : 'text-slate-600'}`} onClick={() => updateState({...state, config: {...state.config, timeFormat: '12h'}})}>12h</button><button className={`min-h-10 px-4 rounded-lg font-bold ${state.config.timeFormat === '24h' ? 'bg-white shadow-sm text-slate-950' : 'text-slate-600'}`} onClick={() => updateState({...state, config: {...state.config, timeFormat: '24h'}})}>24h</button></div></label>
                <label className="flex items-center justify-between gap-4"><span className="font-bold text-slate-800 text-base sm:text-lg">Default tub time</span><input type="time" value={state.config.defaultReadyTime} onChange={(e) => updateState({...state, config: {...state.config, defaultReadyTime: e.target.value}})} className="min-h-11 bg-slate-100 text-slate-950 font-bold px-4 py-2 rounded-xl outline-none" /></label>
                <label className="flex items-center justify-between gap-4"><span className="font-bold text-slate-800 text-base sm:text-lg">Default target (°{state.config.temperatureScale})</span><input type="number" value={state.config.defaultHeatingTarget} onChange={(e) => updateState({...state, config: {...state.config, defaultHeatingTarget: Number(e.target.value) || 40}})} className="min-h-11 bg-slate-100 text-slate-950 font-bold px-4 py-2 rounded-xl outline-none w-24 text-center" /></label>
                <label className="flex items-center justify-between gap-4"><div><span className="font-bold text-slate-800 text-base sm:text-lg block">Heat soak time</span><span className="text-xs text-slate-500 block">Extra minutes to hold temperature before getting in</span></div><div className="relative"><input type="number" step="5" min="0" value={state.config.heatSoakMinutes ?? 30} onChange={(e) => updateState({...state, config: {...state.config, heatSoakMinutes: parseInt(e.target.value) || 0}})} className="min-h-11 bg-slate-100 text-slate-950 font-bold pr-8 pl-4 py-2 rounded-xl outline-none w-24 text-center" /><span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">m</span></div></label>
                <label className="flex items-center justify-between gap-4"><span className="font-bold text-slate-800 text-base sm:text-lg">Unit rate (/kWh)</span><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">£</span><input type="number" step="0.0001" min="0" value={state.config.electricityRatePerKwh} onChange={(e) => updateState({...state, config: {...state.config, electricityRatePerKwh: parseFloat(e.target.value) || 0}})} className="min-h-11 bg-slate-100 text-slate-950 font-bold pl-8 pr-4 py-2 rounded-xl outline-none w-32" /></div></label>
              </div>
              <TelemetrySettings />
            </div>
          )}
        </ErrorBoundary>
      </main>

      <footer className="bg-white/95 backdrop-blur border-t border-slate-200 fixed bottom-0 left-0 right-0 z-20 shadow-[0_-8px_24px_rgba(15,23,42,0.05)] pb-[env(safe-area-inset-bottom)]">
        <nav className="max-w-xl mx-auto flex gap-1 px-2 py-2" aria-label="Main navigation">
          <button type="button" aria-current={activeTab === 'home' ? 'page' : undefined} onClick={() => setActiveTab('home')} className={`min-h-14 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'home' ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><House className="w-5 h-5" /><span className="text-xs font-bold">Home</span></button>
          <button type="button" aria-current={activeTab === 'heating' ? 'page' : undefined} onClick={() => setActiveTab('heating')} className={`min-h-14 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'heating' ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Flame className="w-5 h-5" /><span className="text-xs font-bold">Heating</span></button>
          <button type="button" aria-current={activeTab === 'chemicals' ? 'page' : undefined} onClick={() => setActiveTab('chemicals')} className={`min-h-14 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'chemicals' ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Droplets className="w-5 h-5" /><span className="text-xs font-bold">Water</span></button>
          <button type="button" aria-current={activeTab === 'logs' ? 'page' : undefined} onClick={() => setActiveTab('logs')} className={`min-h-14 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'logs' ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><List className="w-5 h-5" /><span className="text-xs font-bold">History</span></button>
          <button type="button" aria-current={activeTab === 'settings' ? 'page' : undefined} onClick={() => setActiveTab('settings')} className={`min-h-14 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'settings' ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Settings className="w-5 h-5" /><span className="text-xs font-bold">Settings</span></button>
        </nav>
      </footer>

      <ErrorBoundary resetKey={showManualLog ? 'manual-open' : 'manual-closed'} title="Manual log form hit a problem">{showManualLog && <ManualLogModal state={state} onClose={() => setShowManualLog(false)} />}</ErrorBoundary>
      <ErrorBoundary resetKey="heating-notifications" title="Heating notification hit a problem"><HeatingNotifications /></ErrorBoundary>
      <ErrorBoundary resetKey="reminders" title="Reminder panel hit a problem"><ReminderModal state={state} updateState={updateState} /></ErrorBoundary>
    </div>
  );
}
