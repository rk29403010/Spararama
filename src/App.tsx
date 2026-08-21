import React, { useEffect, useRef, useState } from 'react';
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

type AppTab = 'home' | 'heating' | 'chemicals' | 'logs' | 'settings';

const TAB_ORDER: AppTab[] = ['home', 'heating', 'chemicals', 'logs', 'settings'];
const ACTIVE_TAB_STORAGE_KEY = 'spararama.activeTab';

function initialTab(): AppTab {
  if (typeof window === 'undefined') return 'home';
  try {
    const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) as AppTab | null;
    return stored && TAB_ORDER.includes(stored) ? stored : 'home';
  } catch {
    return 'home';
  }
}

function blocksTabSwipe(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;

  if (element.closest('button, a, input, select, textarea, summary, [role="button"], [role="slider"], [data-no-tab-swipe]')) {
    return true;
  }

  let node: HTMLElement | null = element instanceof HTMLElement ? element : element.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    const scrollsHorizontally = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth;
    if (scrollsHorizontally) return true;
    node = node.parentElement;
  }

  return false;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(initialTab);
  const [showManualLog, setShowManualLog] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const swipeStart = useRef<{ x: number; y: number; blocked: boolean } | null>(null);

  useEffect(() => {
    loadState().then(s => setState(s));
    const unsubscribe = subscribeToAuthChanges(u => { setUser(u); setAuthInitialized(true); });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // Remembering the current tab is best effort if storage is unavailable.
    }
  }, [activeTab]);

  const updateState = (newState: AppState) => { setState(newState); saveState(newState); };

  const handleSwipeStart = (event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    swipeStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      blocked: blocksTabSwipe(event.target)
    };
  };

  const handleSwipeEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.blocked) return;

    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const horizontalDistance = Math.abs(deltaX);

    if (horizontalDistance < 70 || horizontalDistance < Math.abs(deltaY) * 1.25) return;

    const currentIndex = TAB_ORDER.indexOf(activeTab);
    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const nextTab = TAB_ORDER[nextIndex];
    if (nextTab) setActiveTab(nextTab);
  };

  if (!state || !authInitialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-100 text-slate-700">
        <span className="w-14 h-14 rounded-2xl bg-slate-950 text-white flex items-center justify-center">
          <Droplets className="w-8 h-8" aria-hidden="true" />
        </span>
        <span className="text-lg font-black">Loading Spararama…</span>
      </div>
    );
  }

  const activeWaterBody = state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) ?? state.domain.waterBodies[0];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-950">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-slate-950 rounded-2xl flex items-center justify-center shrink-0">
              <Droplets className="w-6 h-6 text-sky-200" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl leading-tight font-black text-slate-950 tracking-tight">Spararama</h1>
              <p className="text-sm leading-tight font-bold text-slate-600 truncate">{activeWaterBody?.name || 'Hot tub care'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!user ? (
              <ErrorBoundary resetKey="header-auth" title="Sign-in unavailable"><GoogleSignInButton /></ErrorBoundary>
            ) : (
              <span aria-label="Signed in" title="Signed in" className="w-11 h-11 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-800">
                <UserIcon className="w-5 h-5" aria-hidden="true" />
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowManualLog(true)}
              className="min-h-12 px-3.5 rounded-xl bg-indigo-700 text-white flex items-center justify-center gap-2 font-black active:scale-[0.98] transition-transform"
            >
              <ClipboardPlus className="w-5 h-5" aria-hidden="true" />
              <span>Log</span>
            </button>
          </div>
        </div>
        {!user && <div className="bg-amber-100 border-t border-amber-200 px-4 py-2 text-center text-amber-950 text-sm font-black">Not signed in - history will not be saved.</div>}
      </header>

      <main className="flex-1 pb-24 overflow-y-auto" onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
        <ErrorBoundary resetKey={activeTab} title={`${activeTab[0].toUpperCase()}${activeTab.slice(1)} page failed`}>
          {activeTab === 'home' && <><Home state={state} /><BathingControls state={state} updateState={updateState} /></>}
          {activeTab === 'heating' && <Heating state={state} updateState={updateState} />}
          {activeTab === 'chemicals' && <Chemicals state={state} updateState={updateState} />}
          {activeTab === 'logs' && <Logs state={state} />}
          {activeTab === 'settings' && (
            <div className="p-4 sm:p-8 text-slate-700 max-w-xl mx-auto space-y-6">
              <h2 className="text-3xl font-black tracking-tight text-slate-950">Settings</h2>
              <ErrorBoundary resetKey="spa-configuration" title="Spa / pool settings failed"><SpaConfiguration state={state} updateState={updateState} /></ErrorBoundary>
              <ErrorBoundary resetKey="weather-configuration" title="Weather settings failed"><WeatherConfiguration /></ErrorBoundary>

              <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-6">
                <label className="flex items-center justify-between gap-4">
                  <span className="font-black text-slate-800 text-base sm:text-lg">Account</span>
                  {user ? <button type="button" className="min-h-12 px-4 bg-slate-100 text-slate-800 rounded-xl font-black flex items-center gap-2 hover:bg-slate-200" onClick={signOutUser}><LogOut className="w-5 h-5" aria-hidden="true" />Sign out</button> : <GoogleSignInButton />}
                </label>

                <div className="flex items-center justify-between gap-4">
                  <span className="font-black text-slate-800 text-base sm:text-lg">Temperature scale</span>
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button type="button" aria-pressed={state.config.temperatureScale === 'C'} className={`min-h-11 px-4 rounded-lg font-black ${state.config.temperatureScale === 'C' ? 'bg-white text-slate-950 border border-slate-200' : 'text-slate-700'}`} onClick={() => updateState({...state, config: {...state.config, temperatureScale: 'C'}})}>°C</button>
                    <button type="button" aria-pressed={state.config.temperatureScale === 'F'} className={`min-h-11 px-4 rounded-lg font-black ${state.config.temperatureScale === 'F' ? 'bg-white text-slate-950 border border-slate-200' : 'text-slate-700'}`} onClick={() => updateState({...state, config: {...state.config, temperatureScale: 'F'}})}>°F</button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="font-black text-slate-800 text-base sm:text-lg">Time format</span>
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button type="button" aria-pressed={state.config.timeFormat === '12h'} className={`min-h-11 px-4 rounded-lg font-black ${state.config.timeFormat === '12h' ? 'bg-white text-slate-950 border border-slate-200' : 'text-slate-700'}`} onClick={() => updateState({...state, config: {...state.config, timeFormat: '12h'}})}>12h</button>
                    <button type="button" aria-pressed={state.config.timeFormat === '24h'} className={`min-h-11 px-4 rounded-lg font-black ${state.config.timeFormat === '24h' ? 'bg-white text-slate-950 border border-slate-200' : 'text-slate-700'}`} onClick={() => updateState({...state, config: {...state.config, timeFormat: '24h'}})}>24h</button>
                  </div>
                </div>

                <label className="flex items-center justify-between gap-4">
                  <span className="font-black text-slate-800 text-base sm:text-lg">Default tub time</span>
                  <input name="default-ready-time" autoComplete="off" type="time" value={state.config.defaultReadyTime} onChange={event => updateState({...state, config: {...state.config, defaultReadyTime: event.target.value}})} className="min-h-12 bg-slate-100 text-slate-950 font-black px-4 py-2 rounded-xl" />
                </label>

                <label className="flex items-center justify-between gap-4">
                  <span className="font-black text-slate-800 text-base sm:text-lg">Default target</span>
                  <div className="flex items-center gap-2"><input name="default-target" autoComplete="off" inputMode="numeric" type="number" value={state.config.defaultHeatingTarget} onChange={event => updateState({...state, config: {...state.config, defaultHeatingTarget: Number(event.target.value) || 40}})} className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 py-2 rounded-xl w-24 text-center" /><span className="font-black">°{state.config.temperatureScale}</span></div>
                </label>

                <label className="flex items-center justify-between gap-4">
                  <div><span className="font-black text-slate-800 text-base sm:text-lg block">Heat soak</span><span className="text-sm font-bold text-slate-600 block">Extra time at target before bathing</span></div>
                  <div className="flex items-center gap-2"><input name="heat-soak-minutes" autoComplete="off" inputMode="numeric" type="number" step="5" min="0" value={state.config.heatSoakMinutes ?? 30} onChange={event => updateState({...state, config: {...state.config, heatSoakMinutes: parseInt(event.target.value) || 0}})} className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 py-2 rounded-xl w-24 text-center" /><span className="font-black">min</span></div>
                </label>

                <label className="flex items-center justify-between gap-4">
                  <span className="font-black text-slate-800 text-base sm:text-lg">Electricity rate</span>
                  <div className="flex items-center gap-2"><span className="font-black">£</span><input name="electricity-rate" autoComplete="off" inputMode="decimal" type="number" step="0.0001" min="0" value={state.config.electricityRatePerKwh} onChange={event => updateState({...state, config: {...state.config, electricityRatePerKwh: parseFloat(event.target.value) || 0}})} className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 py-2 rounded-xl w-28 text-center" /><span className="font-black text-sm">/kWh</span></div>
                </label>
              </section>

              <TelemetrySettings />
            </div>
          )}
        </ErrorBoundary>
      </main>

      <footer className="bg-white border-t border-slate-200 fixed bottom-0 left-0 right-0 z-20 pb-[env(safe-area-inset-bottom)]">
        <nav className="max-w-xl mx-auto flex gap-1 px-2 py-2" aria-label="Main navigation">
          <button type="button" aria-current={activeTab === 'home' ? 'page' : undefined} onClick={() => setActiveTab('home')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'home' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><House className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">Home</span></button>
          <button type="button" aria-current={activeTab === 'heating' ? 'page' : undefined} onClick={() => setActiveTab('heating')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'heating' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><Flame className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">Heating</span></button>
          <button type="button" aria-current={activeTab === 'chemicals' ? 'page' : undefined} onClick={() => setActiveTab('chemicals')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'chemicals' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><Droplets className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">Water</span></button>
          <button type="button" aria-current={activeTab === 'logs' ? 'page' : undefined} onClick={() => setActiveTab('logs')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'logs' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><List className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">History</span></button>
          <button type="button" aria-current={activeTab === 'settings' ? 'page' : undefined} onClick={() => setActiveTab('settings')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'settings' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><Settings className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">Settings</span></button>
        </nav>
      </footer>

      <ErrorBoundary resetKey={showManualLog ? 'manual-open' : 'manual-closed'} title="Manual log failed">{showManualLog && <ManualLogModal state={state} onClose={() => setShowManualLog(false)} />}</ErrorBoundary>
      <ErrorBoundary resetKey="heating-notifications" title="Heating notification failed"><HeatingNotifications /></ErrorBoundary>
      <ErrorBoundary resetKey="reminders" title="Reminder failed"><ReminderModal state={state} updateState={updateState} /></ErrorBoundary>
    </div>
  );
}
