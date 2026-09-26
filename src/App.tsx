import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { loadState, saveState } from './lib/storage';
import { AppState } from './types';
import { Home } from './components/Home';
import { BathingControls } from './components/BathingControls';
import { HeatingNotifications } from './components/HeatingNotifications';
import { ReminderModal } from './components/ReminderModal';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ClipboardPlus, Droplets, Flame, Settings, List, LogOut, User as UserIcon, House } from 'lucide-react';
import { subscribeToAuthChanges, signOutUser } from './lib/firebase';
import { isCloudRuntime } from './lib/runtime';
import { useAccess } from './lib/access';
import type { User } from 'firebase/auth';

const Heating = lazy(() => import('./components/Heating').then(module => ({ default: module.Heating })));
const Chemicals = lazy(() => import('./components/Chemicals').then(module => ({ default: module.Chemicals })));
const Logs = lazy(() => import('./components/Logs').then(module => ({ default: module.Logs })));
const ManualLogModal = lazy(() => import('./components/ManualLogModal').then(module => ({ default: module.ManualLogModal })));
const TelemetrySettings = lazy(() => import('./components/TelemetrySettings').then(module => ({ default: module.TelemetrySettings })));
const DeveloperSettings = lazy(() => import('./components/DeveloperSettings').then(module => ({ default: module.DeveloperSettings })));
const SpaConfiguration = lazy(() => import('./components/SpaConfiguration').then(module => ({ default: module.SpaConfiguration })));
const WeatherConfiguration = lazy(() => import('./components/WeatherConfiguration').then(module => ({ default: module.WeatherConfiguration })));
const BleC600Settings = lazy(() => import('./components/BleC600Settings').then(module => ({ default: module.BleC600Settings })));
const RemoteHome = lazy(() => import('./components/RemoteHome').then(module => ({ default: module.RemoteHome })));
const UserManagement = lazy(() => import('./components/UserManagement').then(module => ({ default: module.UserManagement })));

type AppTab = 'home' | 'heating' | 'chemicals' | 'logs' | 'log' | 'settings';

const TAB_ORDER: AppTab[] = ['home', 'heating', 'chemicals', 'logs', 'log', 'settings'];
const ACTIVE_TAB_STORAGE_KEY = 'spararama.activeTab';

function RouteFallback() {
  return (
    <div className="p-6 max-w-xl mx-auto text-center text-slate-600 font-bold" role="status">
      Loading…
    </div>
  );
}

function PermissionNotice({ title }: { title: string }) {
  return (
    <div className="p-4 sm:p-8 max-w-xl mx-auto">
      <section className="rounded-3xl border border-slate-200 bg-white p-6">
        <h2 className="text-2xl font-black text-slate-950">{title}</h2>
        <p className="mt-2 font-bold text-slate-600">Your Spararama account does not have permission to use this area.</p>
      </section>
    </div>
  );
}

function initialTab(): AppTab {
  if (typeof window === 'undefined') return 'home';
  try {
    const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) as AppTab | null;
    return stored && TAB_ORDER.includes(stored) ? stored : 'home';
  } catch {
    return 'home';
  }
}

function UserMenu({ user }: { user: User }) {
  return (
    <details className="relative">
      <summary
        aria-label="Account menu"
        title="Account"
        className="w-11 h-11 list-none cursor-pointer bg-emerald-100 rounded-full flex items-center justify-center text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden"
      >
        <UserIcon className="w-5 h-5" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-lg z-50">
        <p className="font-black text-slate-950 truncate">{user.displayName || 'Signed in user'}</p>
        <p className="mt-0.5 text-sm font-bold text-slate-600 break-all">{user.email || 'Email unavailable'}</p>
        <button
          type="button"
          className="mt-4 min-h-11 w-full px-4 rounded-xl bg-slate-100 text-slate-800 font-black flex items-center justify-center gap-2 hover:bg-slate-200"
          onClick={() => void signOutUser()}
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
          Log out
        </button>
      </div>
    </details>
  );
}

function CloudApp({ user }: { user: User | null }) {
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-950">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-slate-950 rounded-2xl flex items-center justify-center shrink-0">
              <Droplets className="w-6 h-6 text-sky-200" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl leading-tight font-black text-slate-950 tracking-tight">Spararama</h1>
              <p className="text-sm leading-tight font-bold text-slate-600">Remote access</p>
            </div>
          </div>
          {user && <UserMenu user={user} />}
        </div>
      </header>

      <main className="flex-1">
        {!user ? (
          <div className="p-4 max-w-xl mx-auto">
            <section className="mt-6 rounded-3xl bg-white border border-slate-200 p-6">
              <h2 className="text-2xl font-black text-slate-950">Sign in to your hot tub</h2>
              <p className="mt-2 mb-5 font-bold text-slate-600">Remote status and controls are available only to accounts linked to the installation.</p>
              <ErrorBoundary resetKey="cloud-auth" title="Sign-in unavailable"><GoogleSignInButton /></ErrorBoundary>
            </section>
          </div>
        ) : (
          <ErrorBoundary resetKey={user.uid} title="Remote hot tub failed">
            <Suspense fallback={<RouteFallback />}><RemoteHome user={user} /></Suspense>
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
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
  const [user, setUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const swipeStart = useRef<{ x: number; y: number; blocked: boolean } | null>(null);
  const { access, loading: accessLoading, error: accessError, invitePending, can } = useAccess();
  const canSpaControl = can('spa_control');
  const canManageHeating = can('heating_manage');
  const canManageWater = can('water_testing');

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

  useEffect(() => {
    if (accessLoading || isCloudRuntime) return;
    const denied = (activeTab === 'heating' && !canManageHeating)
      || ((activeTab === 'chemicals' || activeTab === 'logs' || activeTab === 'log') && !canManageWater);
    if (denied) setActiveTab('home');
  }, [activeTab, accessLoading, canManageHeating, canManageWater]);

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

    const allowedTabs = TAB_ORDER.filter(tab => tab === 'home'
      || tab === 'settings'
      || (tab === 'heating' && canManageHeating)
      || ((tab === 'chemicals' || tab === 'logs' || tab === 'log') && canManageWater));
    const currentIndex = allowedTabs.indexOf(activeTab);
    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    const nextTab = allowedTabs[nextIndex];
    if (nextTab) setActiveTab(nextTab);
  };

  if (!authInitialized || (!isCloudRuntime && !state)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-100 text-slate-700">
        <span className="w-14 h-14 rounded-2xl bg-slate-950 text-white flex items-center justify-center">
          <Droplets className="w-8 h-8" aria-hidden="true" />
        </span>
        <span className="text-lg font-black">Loading Spararama…</span>
      </div>
    );
  }

  if (isCloudRuntime) return <CloudApp user={user} />;
  if (!state) return null;

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
              <UserMenu user={user} />
            )}
            <button
              type="button"
              aria-label="Settings"
              title="Settings"
              aria-current={activeTab === 'settings' ? 'page' : undefined}
              onClick={() => setActiveTab('settings')}
              className={`w-12 h-12 rounded-xl flex items-center justify-center active:scale-[0.98] transition-colors ${activeTab === 'settings' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}
            >
              <Settings className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {invitePending && !user && <div className="bg-indigo-100 border-t border-indigo-200 px-4 py-2 text-center text-indigo-950 text-sm font-black">You have a Spararama invite. Sign in with the Google account you want to use.</div>}
        {!user && !invitePending && <div className="bg-amber-100 border-t border-amber-200 px-4 py-2 text-center text-amber-950 text-sm font-black">Not signed in - status is view only and personal activity won't sync.</div>}
        {user && accessLoading && <div className="bg-slate-100 border-t border-slate-200 px-4 py-2 text-center text-slate-700 text-sm font-black">Checking Spararama permissions…</div>}
        {user && !accessLoading && !access?.authorized && !canSpaControl && <div className="bg-amber-100 border-t border-amber-200 px-4 py-2 text-center text-amber-950 text-sm font-black">View only - this Google account has not been authorised for controls.</div>}
        {user && accessError && <div className="bg-rose-100 border-t border-rose-200 px-4 py-2 text-center text-rose-950 text-sm font-black">{accessError}</div>}
      </header>

      <main className="flex-1 pb-24 overflow-y-auto" onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
        <ErrorBoundary resetKey={activeTab} title={`${activeTab[0].toUpperCase()}${activeTab.slice(1)} page failed`}>
          <Suspense fallback={<RouteFallback />}>
            {activeTab === 'home' && <><Home state={state} canControl={canSpaControl} canLog={canManageWater} />{canManageWater && <BathingControls state={state} updateState={updateState} />}</>}
            {activeTab === 'heating' && (canManageHeating ? <Heating state={state} updateState={updateState} /> : <PermissionNotice title="Heating" />)}
            {activeTab === 'chemicals' && (canManageWater ? <Chemicals state={state} updateState={updateState} /> : <PermissionNotice title="Water" />)}
            {activeTab === 'logs' && (canManageWater ? <Logs state={state} /> : <PermissionNotice title="History" />)}
            {activeTab === 'log' && (canManageWater ? <ManualLogModal state={state} onClose={() => setActiveTab('logs')} /> : <PermissionNotice title="Log" />)}
            {activeTab === 'settings' && (
              <div className="p-4 sm:p-8 text-slate-700 max-w-2xl mx-auto space-y-5">
                <h2 className="text-3xl font-black tracking-tight text-slate-950">Settings</h2>
                <ErrorBoundary resetKey="spa-configuration" title="Spa / pool settings failed"><SpaConfiguration state={state} updateState={updateState} /></ErrorBoundary>
                <ErrorBoundary resetKey="weather-configuration" title="Weather settings failed"><WeatherConfiguration /></ErrorBoundary>
                <ErrorBoundary resetKey="ble-c600-settings" title="BLE-C600 settings failed"><BleC600Settings /></ErrorBoundary>

                <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-6">
                  <h3 className="text-xl font-black text-slate-950">Preferences</h3>
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
                    <span className="font-black text-slate-800 text-base sm:text-lg">Usual ready time</span>
                    <input name="default-ready-time" autoComplete="off" type="time" value={state.config.defaultReadyTime} onChange={event => updateState({...state, config: {...state.config, defaultReadyTime: event.target.value}})} className="min-h-12 bg-slate-100 text-slate-950 font-black px-4 py-2 rounded-xl" />
                  </label>

                  <label className="flex items-center justify-between gap-4">
                    <span className="font-black text-slate-800 text-base sm:text-lg">Usual water temperature</span>
                    <div className="flex items-center gap-2"><input name="default-target" autoComplete="off" inputMode="numeric" type="number" value={state.config.defaultHeatingTarget} onChange={event => updateState({...state, config: {...state.config, defaultHeatingTarget: Number(event.target.value) || 40}})} className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 py-2 rounded-xl w-24 text-center" /><span className="font-black">°{state.config.temperatureScale}</span></div>
                  </label>

                  <label className="flex items-center justify-between gap-4">
                    <div><span className="font-black text-slate-800 text-base sm:text-lg block">Heat soak</span><span className="text-sm font-bold text-slate-600 block">Extra time at target before bathing</span></div>
                    <div className="flex items-center gap-2"><input name="heat-soak-minutes" autoComplete="off" inputMode="numeric" type="number" step="5" min="0" value={state.config.heatSoakMinutes ?? 30} onChange={event => updateState({...state, config: {...state.config, heatSoakMinutes: parseInt(event.target.value) || 0}})} className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 py-2 rounded-xl w-24 text-center" /><span className="font-black">min</span></div>
                  </label>

                  <label className="min-h-12 flex items-center justify-between gap-4 cursor-pointer">
                    <span className="font-black text-slate-800 text-base sm:text-lg">Alert when target reached</span>
                    <input type="checkbox" checked={state.config.alertOnTargetReached !== false} onChange={event => updateState({...state, config: {...state.config, alertOnTargetReached: event.target.checked}})} className="w-6 h-6 accent-indigo-700" />
                  </label>

                  <label className="min-h-12 flex items-center justify-between gap-4 cursor-pointer">
                    <span className="font-black text-slate-800 text-base sm:text-lg">Alert after heat soak</span>
                    <input type="checkbox" checked={state.config.alertOnHeatSoakComplete !== false} onChange={event => updateState({...state, config: {...state.config, alertOnHeatSoakComplete: event.target.checked}})} className="w-6 h-6 accent-indigo-700" />
                  </label>

                  <label className="flex items-center justify-between gap-4">
                    <span className="font-black text-slate-800 text-base sm:text-lg">Electricity price</span>
                    <div className="flex items-center gap-2"><span className="font-black">£</span><input name="electricity-rate" autoComplete="off" inputMode="decimal" type="number" step="0.0001" min="0" value={state.config.electricityRatePerKwh} onChange={event => updateState({...state, config: {...state.config, electricityRatePerKwh: parseFloat(event.target.value) || 0}})} className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 py-2 rounded-xl w-28 text-center" /><span className="font-black text-sm">/kWh</span></div>
                  </label>
                </section>

                <ErrorBoundary resetKey="user-management" title="User management failed"><UserManagement /></ErrorBoundary>
                <TelemetrySettings />
                <ErrorBoundary resetKey="developer-settings" title="Developer settings failed"><DeveloperSettings /></ErrorBoundary>
              </div>
            )}
          </Suspense>
        </ErrorBoundary>
      </main>

      <footer className="bg-white border-t border-slate-200 fixed bottom-0 left-0 right-0 z-20 pb-[env(safe-area-inset-bottom)]">
        <nav className="max-w-xl mx-auto flex gap-1 px-2 py-2" aria-label="Main navigation">
          <button type="button" aria-current={activeTab === 'home' ? 'page' : undefined} onClick={() => setActiveTab('home')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'home' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><House className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">Home</span></button>
          {canManageHeating && <button type="button" aria-current={activeTab === 'heating' ? 'page' : undefined} onClick={() => setActiveTab('heating')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'heating' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><Flame className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">Heating</span></button>}
          {canManageWater && <button type="button" aria-current={activeTab === 'chemicals' ? 'page' : undefined} onClick={() => setActiveTab('chemicals')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'chemicals' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><Droplets className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">Water</span></button>}
          {canManageWater && <button type="button" aria-current={activeTab === 'logs' ? 'page' : undefined} onClick={() => setActiveTab('logs')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'logs' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><List className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">History</span></button>}
          {canManageWater && <button type="button" aria-current={activeTab === 'log' ? 'page' : undefined} onClick={() => setActiveTab('log')} className={`min-h-16 flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${activeTab === 'log' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'}`}><ClipboardPlus className="w-6 h-6" aria-hidden="true" /><span className="text-sm font-black">Log</span></button>}
        </nav>
      </footer>

      <ErrorBoundary resetKey="heating-notifications" title="Heating notification failed"><HeatingNotifications /></ErrorBoundary>
      <ErrorBoundary resetKey="reminders" title="Reminder failed"><ReminderModal state={state} updateState={updateState} /></ErrorBoundary>
    </div>
  );
}