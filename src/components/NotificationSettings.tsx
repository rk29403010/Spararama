import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Send, Smartphone, TriangleAlert, Volume2 } from 'lucide-react';
import { useAccess } from '../lib/access';
import {
  getPersonalNotificationPreferences,
  getSharedNotificationPreferences,
  updatePersonalNotificationPreferences,
  updateSharedNotificationPreferences,
  type NotificationGroup,
  type NotificationGroupPreferences
} from '../lib/notificationsApi';
import {
  currentPushDeviceId,
  currentPushRegistrationId,
  disablePushNotifications,
  listPushRegistrations,
  syncPushRegistration,
  testPushRegistration,
  type PushRegistrationDto
} from '../lib/pushNotifications';

const GROUPS: Array<{ id: NotificationGroup; label: string; detail: string }> = [
  { id: 'heating.action_required', label: 'Heating - action required', detail: 'Failed starts and anything that needs you to intervene' },
  { id: 'heating.progress', label: 'Heating - progress', detail: 'Heating started, target reached and spa ready' },
  { id: 'heating.schedule', label: 'Heating - schedule', detail: 'Ready-time changes and schedule warnings' },
  { id: 'equipment', label: 'Equipment', detail: 'Spa offline, connection and equipment problems' },
  { id: 'water_care', label: 'Water care', detail: 'Testing, chemical and filter-care notifications' },
  { id: 'system', label: 'System', detail: 'Spararama, integration and security problems' }
];

function timeText(timestamp: number | undefined) {
  return timestamp ? new Date(timestamp).toLocaleString() : 'Never';
}

function PreferenceRows({
  values,
  route,
  saving,
  onChange
}: {
  values: NotificationGroupPreferences;
  route: 'push' | 'alexa';
  saving: string | null;
  onChange: (group: NotificationGroup, enabled: boolean) => void;
}) {
  return (
    <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 overflow-hidden">
      {GROUPS.map(group => {
        const key = `${route}:${group.id}`;
        return (
          <label key={group.id} className="min-h-16 flex items-center justify-between gap-4 px-4 py-3 bg-white cursor-pointer">
            <span className="min-w-0">
              <span className="block font-black text-slate-900">{group.label}</span>
              <span className="block text-sm font-bold text-slate-600">{group.detail}</span>
            </span>
            <input
              type="checkbox"
              checked={values[group.id]}
              disabled={saving === key}
              onChange={event => onChange(group.id, event.target.checked)}
              className="w-6 h-6 accent-indigo-700 shrink-0"
            />
          </label>
        );
      })}
    </div>
  );
}

export function NotificationSettings() {
  const { user, access, can } = useAccess();
  const isAdmin = can('user_admin');
  const [personal, setPersonal] = useState<NotificationGroupPreferences | null>(null);
  const [sharedAlexa, setSharedAlexa] = useState<NotificationGroupPreferences | null>(null);
  const [devices, setDevices] = useState<PushRegistrationDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !access?.authorized) return;
    setLoading(true);
    setError(null);
    try {
      const [mine, pushDevices] = await Promise.all([
        getPersonalNotificationPreferences(),
        listPushRegistrations()
      ]);
      setPersonal(mine.push);
      setDevices(pushDevices.registrations);
      if (isAdmin) {
        const shared = await getSharedNotificationPreferences();
        setSharedAlexa(shared.alexa);
      } else {
        setSharedAlexa(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load notification settings.');
    } finally {
      setLoading(false);
    }
  }, [user, access?.authorized, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const currentDevice = useMemo(() => {
    const registrationId = currentPushRegistrationId();
    const deviceId = currentPushDeviceId();
    return devices.find(device => device.id === registrationId)
      || devices.find(device => device.deviceId === deviceId)
      || null;
  }, [devices]);

  const enablePush = async () => {
    setSaving('device');
    setMessage(null);
    setError(null);
    try {
      const result = await syncPushRegistration({ requestPermission: true });
      if (result.status !== 'enabled') {
        setError(result.message);
      } else {
        setMessage('Push notifications are enabled on this device.');
        await load();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not enable push notifications.');
    } finally {
      setSaving(null);
    }
  };

  const disablePush = async () => {
    setSaving('device');
    setMessage(null);
    setError(null);
    try {
      await disablePushNotifications();
      setMessage('Push notifications are disabled on this device.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not disable push notifications.');
    } finally {
      setSaving(null);
    }
  };

  const testPush = async () => {
    if (!currentDevice) return;
    setSaving('test-device');
    setMessage(null);
    setError(null);
    try {
      const result = await testPushRegistration(currentDevice.id);
      const target = result.targets[0];
      if (target?.success) setMessage('Firebase accepted a test notification for this device.');
      else setError(target?.errorCode
        ? `${target.errorCode}${target.errorMessage ? ` - ${target.errorMessage}` : ''}`
        : result.error || 'Push test failed.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Push test failed.');
    } finally {
      setSaving(null);
    }
  };

  const setPersonalGroup = async (group: NotificationGroup, enabled: boolean) => {
    if (!personal) return;
    const key = `push:${group}`;
    setSaving(key);
    setError(null);
    try {
      const result = await updatePersonalNotificationPreferences({ [group]: enabled });
      setPersonal(result.push);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save push preferences.');
    } finally {
      setSaving(null);
    }
  };

  const setAlexaGroup = async (group: NotificationGroup, enabled: boolean) => {
    if (!sharedAlexa) return;
    const key = `alexa:${group}`;
    setSaving(key);
    setError(null);
    try {
      const result = await updateSharedNotificationPreferences({ [group]: enabled });
      setSharedAlexa(result.alexa);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save Alexa preferences.');
    } finally {
      setSaving(null);
    }
  };

  if (!user || !access?.authorized) {
    return (
      <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-indigo-700" aria-hidden="true" />
          <div>
            <h3 className="text-xl font-black text-slate-950">Notifications</h3>
            <p className="text-sm font-bold text-slate-600">Sign in as an authorised Spararama user to manage notification routes.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-6">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-900 flex items-center justify-center"><Bell className="w-6 h-6" aria-hidden="true" /></span>
        <div>
          <h3 className="text-xl font-black text-slate-950">Notifications</h3>
          <p className="text-sm font-bold text-slate-600">Choose what reaches you and the household</p>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-50 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Smartphone className="w-6 h-6 text-indigo-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="font-black text-slate-950">This device</div>
            {currentDevice ? (
              <>
                <div className="text-sm font-bold text-slate-600 mt-1">{currentDevice.deviceName || currentDevice.label || 'Browser device'}</div>
                <div className="text-xs font-bold text-slate-500 mt-1">Last registered: {timeText(currentDevice.lastRegisteredAt || currentDevice.updatedAt)}</div>
                <div className="text-xs font-bold text-slate-500">Last accepted by Firebase: {timeText(currentDevice.lastProviderAcceptedAt)}</div>
                {currentDevice.lastDeliveryErrorCode && <div className="text-xs font-bold text-rose-800 mt-1 break-words">{currentDevice.lastDeliveryErrorCode}{currentDevice.lastDeliveryErrorMessage ? ` - ${currentDevice.lastDeliveryErrorMessage}` : ''}</div>}
              </>
            ) : (
              <div className="text-sm font-bold text-amber-800 mt-1">This browser is not currently registered for background push.</div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={saving === 'device'} onClick={() => void enablePush()} className="min-h-11 px-4 rounded-xl bg-indigo-700 text-white font-black disabled:opacity-50">
            {saving === 'device' ? 'Working…' : currentDevice ? 'Repair / refresh' : 'Enable push'}
          </button>
          {currentDevice && <button type="button" disabled={saving === 'test-device'} onClick={() => void testPush()} className="min-h-11 px-4 rounded-xl bg-slate-950 text-white font-black disabled:opacity-50 flex items-center gap-2"><Send className="w-4 h-4" aria-hidden="true" />{saving === 'test-device' ? 'Testing…' : 'Send test'}</button>}
          {currentDevice && <button type="button" disabled={saving === 'device'} onClick={() => void disablePush()} className="min-h-11 px-4 rounded-xl bg-white border border-slate-300 text-slate-800 font-black disabled:opacity-50">Disable on this device</button>}
        </div>
      </div>

      {personal && (
        <div className="space-y-3">
          <div>
            <h4 className="font-black text-slate-950">Your push notifications</h4>
            <p className="text-sm font-bold text-slate-600">These choices apply to your registered devices.</p>
          </div>
          <PreferenceRows values={personal} route="push" saving={saving} onChange={(group, enabled) => void setPersonalGroup(group, enabled)} />
        </div>
      )}

      {isAdmin && sharedAlexa && (
        <div className="space-y-3 border-t border-slate-200 pt-5">
          <div className="flex items-start gap-3">
            <Volume2 className="w-6 h-6 text-indigo-700 shrink-0" aria-hidden="true" />
            <div>
              <h4 className="font-black text-slate-950">Household Alexa announcements</h4>
              <p className="text-sm font-bold text-slate-600">Shared route - configured once for the whole Spararama installation.</p>
            </div>
          </div>
          <PreferenceRows values={sharedAlexa} route="alexa" saving={saving} onChange={(group, enabled) => void setAlexaGroup(group, enabled)} />
        </div>
      )}

      {loading && <p role="status" className="text-sm font-bold text-slate-600">Loading notification settings…</p>}
      {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900">{message}</p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900 flex gap-2"><TriangleAlert className="w-5 h-5 shrink-0" aria-hidden="true" />{error}</p>}
    </section>
  );
}
