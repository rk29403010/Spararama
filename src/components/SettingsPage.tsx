import React, { useRef } from 'react';
import type { User } from 'firebase/auth';
import {
  Bell,
  CircleUserRound,
  Droplets,
  Settings2,
  TestTube2,
  Users,
  Waves
} from 'lucide-react';
import type { AppState } from '../types';
import { signOutUser } from '../lib/firebase';
import { BleC600Settings } from './BleC600Settings';
import { DeveloperSettings } from './DeveloperSettings';
import { ErrorBoundary } from './ErrorBoundary';
import { GoogleSignInButton } from './GoogleSignInButton';
import { NotificationSettings } from './NotificationSettings';
import { SpaConfiguration } from './SpaConfiguration';
import { TelemetrySettings } from './TelemetrySettings';
import { UserManagement } from './UserManagement';
import { WeatherConfiguration } from './WeatherConfiguration';

export type SettingsTab = 'general' | 'hot-tub' | 'water-testing' | 'notifications' | 'users' | 'advanced';

interface SettingsPageProps {
  state: AppState;
  updateState: (state: AppState) => void;
  user: User | null;
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  canAdmin: boolean;
}

const TABS: Array<{
  id: SettingsTab;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}> = [
  { id: 'general', label: 'General', icon: CircleUserRound },
  { id: 'hot-tub', label: 'Hot tub', icon: Waves },
  { id: 'water-testing', label: 'Water testing', shortLabel: 'Water test', icon: TestTube2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'users', label: 'Users', icon: Users, adminOnly: true },
  { id: 'advanced', label: 'Advanced', icon: Settings2 }
];

function SettingsPanel({ id, children }: { id: SettingsTab; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`settings-panel-${id}`} aria-labelledby={`settings-tab-${id}`} className="space-y-5">
      {children}
    </div>
  );
}

export function SettingsPage({ state, updateState, user, activeTab, onTabChange, canAdmin }: SettingsPageProps) {
  const topRef = useRef<HTMLDivElement>(null);
  const visibleTabs = TABS.filter(tab => !tab.adminOnly || canAdmin);
  const selectedTab = visibleTabs.some(tab => tab.id === activeTab) ? activeTab : 'general';

  const chooseTab = (tab: SettingsTab) => {
    topRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    onTabChange(tab);
  };

  return (
    <div ref={topRef} className="text-slate-700 max-w-3xl mx-auto">
      <div className="px-4 pt-4 sm:px-8 sm:pt-8">
        <h2 className="text-3xl font-black tracking-tight text-slate-950">Settings</h2>
        <p className="mt-1 text-sm sm:text-base font-bold text-slate-600">Choose a section instead of scrolling through every setting.</p>
      </div>

      <div className="sticky top-0 z-20 mt-4 border-y border-slate-200 bg-slate-100/95 backdrop-blur-sm" data-no-tab-swipe>
        <div
          role="tablist"
          aria-label="Settings sections"
          className="max-w-3xl mx-auto flex gap-2 overflow-x-auto px-4 py-3 sm:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleTabs.map(tab => {
            const Icon = tab.icon;
            const selected = selectedTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`settings-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`settings-panel-${tab.id}`}
                onClick={() => chooseTab(tab.id)}
                className={`min-h-12 shrink-0 rounded-2xl px-4 flex items-center gap-2 font-black transition-colors ${
                  selected
                    ? 'bg-slate-950 text-white shadow-sm'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 sm:p-8">
        {selectedTab === 'general' && (
          <SettingsPanel id="general">
            <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-6">
              <div className="flex items-center gap-3">
                <Droplets className="w-6 h-6 text-indigo-700" aria-hidden="true" />
                <h3 className="text-xl font-black text-slate-950">General</h3>
              </div>

              <label className="flex items-center justify-between gap-4">
                <span className="font-black text-slate-800 text-base sm:text-lg">Account</span>
                {user ? (
                  <button type="button" className="min-h-12 px-4 bg-slate-100 text-slate-800 rounded-xl font-black hover:bg-slate-200" onClick={() => void signOutUser()}>
                    Sign out
                  </button>
                ) : <GoogleSignInButton />}
              </label>

              <div className="flex items-center justify-between gap-4">
                <span className="font-black text-slate-800 text-base sm:text-lg">Temperature scale</span>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button type="button" aria-pressed={state.config.temperatureScale === 'C'} className={`min-h-11 px-4 rounded-lg font-black ${state.config.temperatureScale === 'C' ? 'bg-white text-slate-950 border border-slate-200' : 'text-slate-700'}`} onClick={() => updateState({ ...state, config: { ...state.config, temperatureScale: 'C' } })}>°C</button>
                  <button type="button" aria-pressed={state.config.temperatureScale === 'F'} className={`min-h-11 px-4 rounded-lg font-black ${state.config.temperatureScale === 'F' ? 'bg-white text-slate-950 border border-slate-200' : 'text-slate-700'}`} onClick={() => updateState({ ...state, config: { ...state.config, temperatureScale: 'F' } })}>°F</button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="font-black text-slate-800 text-base sm:text-lg">Time format</span>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button type="button" aria-pressed={state.config.timeFormat === '12h'} className={`min-h-11 px-4 rounded-lg font-black ${state.config.timeFormat === '12h' ? 'bg-white text-slate-950 border border-slate-200' : 'text-slate-700'}`} onClick={() => updateState({ ...state, config: { ...state.config, timeFormat: '12h' } })}>12h</button>
                  <button type="button" aria-pressed={state.config.timeFormat === '24h'} className={`min-h-11 px-4 rounded-lg font-black ${state.config.timeFormat === '24h' ? 'bg-white text-slate-950 border border-slate-200' : 'text-slate-700'}`} onClick={() => updateState({ ...state, config: { ...state.config, timeFormat: '24h' } })}>24h</button>
                </div>
              </div>
            </section>
          </SettingsPanel>
        )}

        {selectedTab === 'hot-tub' && (
          <SettingsPanel id="hot-tub">
            <ErrorBoundary resetKey="spa-configuration" title="Spa / pool settings failed"><SpaConfiguration state={state} updateState={updateState} /></ErrorBoundary>

            <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-6">
              <h3 className="text-xl font-black text-slate-950">Heating defaults & cost</h3>

              <label className="flex items-center justify-between gap-4">
                <span className="font-black text-slate-800 text-base sm:text-lg">Usual ready time</span>
                <input name="default-ready-time" autoComplete="off" type="time" value={state.config.defaultReadyTime} onChange={event => updateState({ ...state, config: { ...state.config, defaultReadyTime: event.target.value } })} className="min-h-12 bg-slate-100 text-slate-950 font-black px-4 py-2 rounded-xl" />
              </label>

              <label className="flex items-center justify-between gap-4">
                <span className="font-black text-slate-800 text-base sm:text-lg">Usual water temperature</span>
                <div className="flex items-center gap-2"><input name="default-target" autoComplete="off" inputMode="numeric" type="number" value={state.config.defaultHeatingTarget} onChange={event => updateState({ ...state, config: { ...state.config, defaultHeatingTarget: Number(event.target.value) || 40 } })} className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 py-2 rounded-xl w-24 text-center" /><span className="font-black">°{state.config.temperatureScale}</span></div>
              </label>

              <label className="flex items-center justify-between gap-4">
                <div><span className="font-black text-slate-800 text-base sm:text-lg block">Heat soak</span><span className="text-sm font-bold text-slate-600 block">Extra time at target before bathing</span></div>
                <div className="flex items-center gap-2"><input name="heat-soak-minutes" autoComplete="off" inputMode="numeric" type="number" step="5" min="0" value={state.config.heatSoakMinutes ?? 30} onChange={event => updateState({ ...state, config: { ...state.config, heatSoakMinutes: parseInt(event.target.value) || 0 } })} className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 py-2 rounded-xl w-24 text-center" /><span className="font-black">min</span></div>
              </label>

              <label className="flex items-center justify-between gap-4">
                <span className="font-black text-slate-800 text-base sm:text-lg">Electricity price</span>
                <div className="flex items-center gap-2"><span className="font-black">£</span><input name="electricity-rate" autoComplete="off" inputMode="decimal" type="number" step="0.0001" min="0" value={state.config.electricityRatePerKwh} onChange={event => updateState({ ...state, config: { ...state.config, electricityRatePerKwh: parseFloat(event.target.value) || 0 } })} className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 py-2 rounded-xl w-28 text-center" /><span className="font-black text-sm">/kWh</span></div>
              </label>
            </section>

            <ErrorBoundary resetKey="weather-configuration" title="Weather settings failed"><WeatherConfiguration /></ErrorBoundary>
          </SettingsPanel>
        )}

        {selectedTab === 'water-testing' && (
          <SettingsPanel id="water-testing">
            <ErrorBoundary resetKey="ble-c600-settings" title="Water tester settings failed"><BleC600Settings /></ErrorBoundary>
          </SettingsPanel>
        )}

        {selectedTab === 'notifications' && (
          <SettingsPanel id="notifications">
            <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-5">
              <h3 className="text-xl font-black text-slate-950">Heating alerts</h3>
              <label className="min-h-12 flex items-center justify-between gap-4 cursor-pointer">
                <span className="font-black text-slate-800 text-base sm:text-lg">Alert when target reached</span>
                <input type="checkbox" checked={state.config.alertOnTargetReached !== false} onChange={event => updateState({ ...state, config: { ...state.config, alertOnTargetReached: event.target.checked } })} className="w-6 h-6 accent-indigo-700" />
              </label>
              <label className="min-h-12 flex items-center justify-between gap-4 cursor-pointer">
                <span className="font-black text-slate-800 text-base sm:text-lg">Alert after heat soak</span>
                <input type="checkbox" checked={state.config.alertOnHeatSoakComplete !== false} onChange={event => updateState({ ...state, config: { ...state.config, alertOnHeatSoakComplete: event.target.checked } })} className="w-6 h-6 accent-indigo-700" />
              </label>
            </section>
            <ErrorBoundary resetKey="notification-settings" title="Notification settings failed"><NotificationSettings /></ErrorBoundary>
          </SettingsPanel>
        )}

        {selectedTab === 'users' && canAdmin && (
          <SettingsPanel id="users">
            <ErrorBoundary resetKey="user-management" title="User management failed"><UserManagement /></ErrorBoundary>
          </SettingsPanel>
        )}

        {selectedTab === 'advanced' && (
          <SettingsPanel id="advanced">
            <ErrorBoundary resetKey="telemetry-settings" title="Telemetry settings failed"><TelemetrySettings /></ErrorBoundary>
            <ErrorBoundary resetKey="developer-settings" title="Developer settings failed"><DeveloperSettings /></ErrorBoundary>
          </SettingsPanel>
        )}
      </div>
    </div>
  );
}
