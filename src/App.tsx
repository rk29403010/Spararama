import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { loadState, saveState } from './lib/storage';
import { AppState } from './types';
import { Home } from './components/Home';
import { BathingControls } from './components/BathingControls';
import { HeatingNotifications } from './components/HeatingNotifications';
import { NotificationCentreButton } from './components/NotificationCentreButton';
import { ReminderModal } from './components/ReminderModal';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { SettingsTab } from './components/SettingsPage';
import { ClipboardPlus, Droplets, Flame, Settings, List, LogOut, User as UserIcon, House } from 'lucide-react';
import { subscribeToAuthChanges, signOutUser } from './lib/firebase';
import { isCloudRuntime } from './lib/runtime';
import { useAccess } from './lib/access';
import type { User } from 'firebase/auth';

const Heating = lazy(() => import('./components/Heating').then(module => ({ default: module.Heating })));
const Chemicals = lazy(() => import('./components/Chemicals').then(module => ({ default: module.Chemicals })));
const Logs = lazy(() => import('./components/Logs').then(module => ({ default: module.Logs })));
const ManualLogModal = lazy(() => import('./components/ManualLogModal').then(module => ({ default: module.ManualLogModal })));
const RemoteHome = lazy(() => import('./components/RemoteHome').then(module => ({ default: module.RemoteHome })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then(module => ({ default: module.SettingsPage })));

type AppTab = 'home' | 'heating' | 'chemicals' | 'logs' | 'log' | 'settings';

const TAB_ORDER: AppTab[] = ['home', 'heating', 'chemicals', 'logs', 'log', 'settings'];
const SETTINGS_TABS: SettingsTab[] = ['general', 'hot-tub', 'water-testing', 'notifications', 'users', 'advanced'];
const ACTIVE_TAB_STORAGE_KEY = 'spararama.activeTab';
const SETTINGS_TAB_STORAGE_KEY = 'spararama.settingsTab';

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

function initialSettingsTab(): SettingsTab {
  if (typeof window === 'undefined') return 'general';
  try {
    const stored = window.localStorage.getItem(SETTINGS_TAB_STORAGE_KEY) as SettingsTab | null;
    return stored && SETTINGS_TABS.includes(stored) ? stored : 'general';
  } catch {
    return 'general';
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initialSettingsTab);
  const [user, setUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const swipeStart = useRef<{ x: number; y: number; blocked: boolean } | null>(null);
  const { access, loading: accessLoading, error: accessError, invitePending, can } = useAccess();
  const canSpaControl = can('spa_control');
  const canManageHeating = can('heating_manage');
  const canManageWater = can('water_testing');
  const canAdmin = can('user_admin');

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
    try {
      window.localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, settingsTab);
    } catch {
      // Remembering the current settings section is best effort if storage is unavailable.
    }
  }, [settingsTab]);

  useEffect(() => {
    if (accessLoading || isCloudRuntime) return;
    const denied = (activeTab === 'heating' && !canManageHeating)
      || ((activeTab === 'chemicals' || activeTab === 'logs' || activeTab === 'log') && !canManageWater);
    if (denied) setActiveTab('home');
    if (settingsTab === 'users' && !canAdmin) setSettingsTab('general');
  }, [activeTab, settingsTab, accessLoading, canAdmin, canManageHeating, canManageWater]);

  const updateState = (newState: AppState) => { setState(newState); saveState(newState); };
  const openSettings = (tab?: SettingsTab) => {
    if (tab) setSettingsTab(tab);
    setActiveTab('settings');
  };

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
            {user && access?.authorized && (
              <ErrorBoundary resetKey="notification-centre" title="Notifications unavailable">
                <NotificationCentreButton onOpenSettings={() => openSettings('notifications')} />
              </ErrorBoundary>
            )}
            <button
              type="button"
              aria-label="Settings"
              title="Settings"
              aria-current={activeTab === 'settings' ? 'page' : undefined}
              onClick={() => openSettings()}
              className={`w-12 h-12 rounded-xl flex items-center justify-center active:scale-[0.98] transition-colors ${activeTab === 'settings' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}
            >
              <Settings className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {invitePending && !user && <div className="bg-indigo-100 border-t border-indigo-200 px-4 py-2 text-center text-indigo-950 text-sm font-black">You have a Spararama invite. Sign in with the Google account you want to use.</div>}
        {!user && !invitePending && <div className="bg-amber-100 border-t border-amber-200 px-4 py-2 text-center text-amber-950 text-sm font-black">Not signed in - status is view only and personal activity won't sync.</div>}
        {user && accessLoading && <div className="bg-slate-100 border-t border-slate-200 px-4 py-2 text-center text-slate-700 text-sm font-black">Checking Spararama permissions…</div>}
        {user && !accessLoading && !accessError && !access?.authorized && !canSpaControl && <div className="bg-amber-100 border-t border-amber-200 px-4 py-2 text-center text-amber-950 text-sm font-black">View only - this Google account has not been authorised for controls.</div>}
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
              <SettingsPage
                state={state}
                updateState={updateState}
                user={user}
                activeTab={settingsTab}
                onTabChange={setSettingsTab}
                canAdmin={canAdmin}
              />
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
