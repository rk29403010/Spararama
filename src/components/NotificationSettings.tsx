import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Check, Clock3, History, Pencil, Send, Smartphone, Trash2, TriangleAlert, Volume2, X } from 'lucide-react';
import { useAccess } from '../lib/access';
import {
  getPersonalNotificationPreferences,
  getSharedNotificationPreferences,
  getSpaHealthSettings,
  listRecentNotifications,
  updatePersonalNotificationPreferences,
  updateSharedNotificationPreferences,
  updateSpaHealthSettings,
  type NotificationGroup,
  type NotificationGroupPreferences,
  type SpaHealthSettingsDto,
  type SpararamaNotificationDto
} from '../lib/notificationsApi';
import {
  currentPushDeviceId,
  currentPushRegistrationId,
  disablePushNotifications,
  listPushRegistrations,
  removePushRegistration,
  renamePushRegistration,
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

function notificationState(item: SpararamaNotificationDto) {
  if (item.resolvedAt) return `Resolved ${timeText(item.resolvedAt)}`;
  if (item.deliverySuppressed) return 'Active · alerts paused';
  if (item.expiresAt && item.expiresAt <= Date.now()) return 'Expired';
  return 'Active';
}

function tomorrowMorning() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(8, 0, 0, 0);
  return date.getTime();
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
  const canControlSpa = can('spa_control');
  const [personal, setPersonal] = useState<NotificationGroupPreferences | null>(null);
  const [sharedAlexa, setSharedAlexa] = useState<NotificationGroupPreferences | null>(null);
  const [healthSettings, setHealthSettings] = useState<SpaHealthSettingsDto | null>(null);
  const [recent, setRecent] = useState<SpararamaNotificationDto[]>([]);
  const [devices, setDevices] = useState<PushRegistrationDto[]>([]);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editingDeviceName, setEditingDeviceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !access?.authorized) return;
    setLoading(true);
    setError(null);
    try {
      const [mine, pushDevices, health, history] = await Promise.all([
        getPersonalNotificationPreferences(),
        listPushRegistrations(),
        getSpaHealthSettings(),
        listRecentNotifications(10)
      ]);
      setPersonal(mine.push);
      setDevices(pushDevices.registrations);
      setHealthSettings(health);
      setRecent(history.notifications);
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

  const testDevice = async (device: PushRegistrationDto) => {
    setSaving(`test:${device.id}`);
    setMessage(null);
    setError(null);
    try {
      const result = await testPushRegistration(device.id);
      const target = result.targets[0];
      if (target?.success) setMessage(`Firebase accepted a test notification for ${device.deviceName || device.label || 'this device'}.`);
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

  const startRename = (device: PushRegistrationDto) => {
    setEditingDeviceId(device.id);
    setEditingDeviceName(device.deviceName || device.label || '');
    setMessage(null);
    setError(null);
  };

  const saveRename = async () => {
    if (!editingDeviceId || !editingDeviceName.trim()) return;
    const id = editingDeviceId;
    setSaving(`rename:${id}`);
    setError(null);
    try {
      await renamePushRegistration(id, editingDeviceName.trim());
      setEditingDeviceId(null);
      setEditingDeviceName('');
      setMessage('Device name updated.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename this push device.');
    } finally {
      setSaving(null);
    }
  };

  const removeDevice = async (device: PushRegistrationDto) => {
    if (device.id === currentDevice?.id) {
      await disablePush();
      return;
    }
    setSaving(`remove:${device.id}`);
    setMessage(null);
    setError(null);
    try {
      await removePushRegistration(device.id);
      setMessage(`${device.deviceName || device.label || 'Push device'} removed.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove this push device.');
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

  const pauseOfflineAlerts = async (until?: number) => {
    setSaving('spa-health');
    setMessage(null);
    setError(null);
    try {
      const next = await updateSpaHealthSettings(true, until);
      setHealthSettings(next);
      setMessage(until ? `Spa-offline alerts paused until ${timeText(until)}.` : 'Spa-offline alerts paused until you turn them back on.');
      const history = await listRecentNotifications(10);
      setRecent(history.notifications);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not pause spa-offline alerts.');
    } finally {
      setSaving(null);
    }
  };

  const resumeOfflineAlerts = async () => {
    setSaving('spa-health');
    setMessage(null);
    setError(null);
    try {
      const next = await updateSpaHealthSettings(false);
      setHealthSettings(next);
      setMessage('Spa-offline alerts are active again.');
      const history = await listRecentNotifications(10);
      setRecent(history.notifications);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not resume spa-offline alerts.');
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
          {currentDevice && <button type="button" disabled={saving === `test:${currentDevice.id}`} onClick={() => void testDevice(currentDevice)} className="min-h-11 px-4 rounded-xl bg-slate-950 text-white font-black disabled:opacity-50 flex items-center gap-2"><Send className="w-4 h-4" aria-hidden="true" />{saving === `test:${currentDevice.id}` ? 'Testing…' : 'Send test'}</button>}
          {currentDevice && <button type="button" disabled={saving === 'device'} onClick={() => void disablePush()} className="min-h-11 px-4 rounded-xl bg-white border border-slate-300 text-slate-800 font-black disabled:opacity-50">Disable on this device</button>}
        </div>
      </div>

      {devices.length > 0 && (
        <div className="space-y-3">
          <div>
            <h4 className="font-black text-slate-950">Your registered devices</h4>
            <p className="text-sm font-bold text-slate-600">Each browser or phone is an independent Push destination.</p>
          </div>
          <div className="space-y-2">
            {devices.map(device => {
              const isCurrent = device.id === currentDevice?.id;
              const editing = editingDeviceId === device.id;
              return (
                <div key={device.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start gap-3">
                    <Smartphone className="w-5 h-5 text-slate-500 shrink-0 mt-1" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      {editing ? (
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            value={editingDeviceName}
                            onChange={event => setEditingDeviceName(event.target.value)}
                            maxLength={120}
                            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 font-bold text-slate-950"
                            aria-label="Device name"
                          />
                          <button type="button" disabled={!editingDeviceName.trim() || saving === `rename:${device.id}`} onClick={() => void saveRename()} className="w-11 h-11 rounded-xl bg-indigo-700 text-white flex items-center justify-center disabled:opacity-50" aria-label="Save device name"><Check className="w-5 h-5" aria-hidden="true" /></button>
                          <button type="button" onClick={() => { setEditingDeviceId(null); setEditingDeviceName(''); }} className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center" aria-label="Cancel rename"><X className="w-5 h-5" aria-hidden="true" /></button>
                        </div>
                      ) : (
                        <>
                          <div className="font-black text-slate-900 truncate">{device.deviceName || device.label || 'Browser device'}{isCurrent ? <span className="ml-2 text-xs text-indigo-700">This device</span> : null}</div>
                          <div className="text-xs font-bold text-slate-500 mt-1">Registered {timeText(device.lastRegisteredAt || device.updatedAt)} · Last accepted {timeText(device.lastProviderAcceptedAt)}</div>
                          {device.lastDeliveryErrorCode && <div className="text-xs font-bold text-rose-800 mt-1 break-words">{device.lastDeliveryErrorCode}{device.lastDeliveryErrorMessage ? ` - ${device.lastDeliveryErrorMessage}` : ''}</div>}
                        </>
                      )}
                    </div>
                  </div>
                  {!editing && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => startRename(device)} className="min-h-10 px-3 rounded-xl bg-slate-100 text-slate-800 font-black flex items-center gap-1.5"><Pencil className="w-4 h-4" aria-hidden="true" />Rename</button>
                      <button type="button" disabled={saving === `test:${device.id}`} onClick={() => void testDevice(device)} className="min-h-10 px-3 rounded-xl bg-slate-100 text-slate-800 font-black flex items-center gap-1.5"><Send className="w-4 h-4" aria-hidden="true" />{saving === `test:${device.id}` ? 'Testing…' : 'Test'}</button>
                      <button type="button" disabled={saving === `remove:${device.id}` || saving === 'device'} onClick={() => void removeDevice(device)} className="min-h-10 px-3 rounded-xl bg-rose-50 text-rose-800 font-black flex items-center gap-1.5"><Trash2 className="w-4 h-4" aria-hidden="true" />{isCurrent ? 'Disable' : saving === `remove:${device.id}` ? 'Removing…' : 'Remove'}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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

      <div className="space-y-3 border-t border-slate-200 pt-5">
        <div className="flex items-start gap-3">
          <Clock3 className="w-6 h-6 text-indigo-700 shrink-0" aria-hidden="true" />
          <div>
            <h4 className="font-black text-slate-950">Planned shutdown / maintenance</h4>
            <p className="text-sm font-bold text-slate-600">Pause only spa-offline alerts. Spararama still records the outage and other notification groups keep working.</p>
          </div>
        </div>
        {healthSettings?.offlineAlertsPaused ? (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
            <div className="font-black text-amber-950">Spa-offline alerts are paused</div>
            <div className="text-sm font-bold text-amber-900 mt-1">
              {healthSettings.offlineAlertsPausedUntil
                ? `Until ${timeText(healthSettings.offlineAlertsPausedUntil)}`
                : 'Until someone turns them back on'}
            </div>
            {canControlSpa && <button type="button" disabled={saving === 'spa-health'} onClick={() => void resumeOfflineAlerts()} className="mt-3 min-h-11 px-4 rounded-xl bg-amber-900 text-white font-black disabled:opacity-50">Resume offline alerts</button>}
          </div>
        ) : canControlSpa ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={saving === 'spa-health'} onClick={() => void pauseOfflineAlerts(Date.now() + 60 * 60_000)} className="min-h-11 px-4 rounded-xl bg-slate-100 text-slate-900 font-black disabled:opacity-50">1 hour</button>
            <button type="button" disabled={saving === 'spa-health'} onClick={() => void pauseOfflineAlerts(Date.now() + 4 * 60 * 60_000)} className="min-h-11 px-4 rounded-xl bg-slate-100 text-slate-900 font-black disabled:opacity-50">4 hours</button>
            <button type="button" disabled={saving === 'spa-health'} onClick={() => void pauseOfflineAlerts(tomorrowMorning())} className="min-h-11 px-4 rounded-xl bg-slate-100 text-slate-900 font-black disabled:opacity-50">Until tomorrow</button>
            <button type="button" disabled={saving === 'spa-health'} onClick={() => void pauseOfflineAlerts()} className="min-h-11 px-4 rounded-xl bg-slate-100 text-slate-900 font-black disabled:opacity-50">Until turned back on</button>
          </div>
        ) : (
          <p className="text-sm font-bold text-slate-600">A user with spa-control permission can pause these alerts for planned maintenance.</p>
        )}
      </div>

      <div className="space-y-3 border-t border-slate-200 pt-5">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-indigo-700" aria-hidden="true" />
          <h4 className="font-black text-slate-950">Recent notification history</h4>
        </div>
        {recent.length ? (
          <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 overflow-hidden">
            {recent.map(item => (
              <div key={item.id} className="p-3 bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-black text-slate-900">{item.title}</div>
                  <div className={`text-xs font-black shrink-0 ${item.severity === 'urgent' ? 'text-rose-800' : item.severity === 'warning' ? 'text-amber-800' : 'text-slate-500'}`}>{item.severity}</div>
                </div>
                {item.message && <div className="text-sm font-bold text-slate-600 mt-1">{item.message}</div>}
                <div className="text-xs font-bold text-slate-500 mt-1">{timeText(item.createdAt)} · {notificationState(item)}</div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm font-bold text-slate-600">No notification history yet.</p>}
      </div>

      {loading && <p role="status" className="text-sm font-bold text-slate-600">Loading notification settings…</p>}
      {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900">{message}</p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900 flex gap-2"><TriangleAlert className="w-5 h-5 shrink-0" aria-hidden="true" />{error}</p>}
    </section>
  );
}
