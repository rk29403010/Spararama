import React, { useEffect, useState, useMemo } from 'react';
import { getLogs, migrateOldLogs, subscribeToAuthChanges } from '../lib/firebase';
import { telemetryApi, type TelemetryHistoryDto, type TelemetryStatusDto } from '../lib/telemetryApi';
import { Activity, Thermometer, Droplet, Clock, TrendingUp, Download, Radio, Cloud, CloudOff } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatTemperature(value: unknown, digits = 1) {
  return finiteNumber(value) ? `${value.toFixed(digits)}°C` : 'No reading';
}

export function Logs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [telemetry, setTelemetry] = useState<TelemetryHistoryDto>({ samples: [], total: 0 });
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryStatusDto | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(true);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToAuthChanges((u) => {
      setUser(u);
      if (u) {
        setLoading(true);
        getLogs().then(data => {
          setLogs(data);
          setLoading(false);
        });
      } else {
        setLogs([]);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let active = true;
    const loadTelemetry = async () => {
      try {
        const [history, status] = await Promise.all([telemetryApi.history(200), telemetryApi.status()]);
        if (!active) return;
        setTelemetry(history);
        setTelemetryStatus(status);
        setTelemetryError(null);
      } catch (error: any) {
        if (active) setTelemetryError(error?.message || 'Unable to load automatic telemetry.');
      } finally {
        if (active) setTelemetryLoading(false);
      }
    };
    void loadTelemetry();
    const timer = window.setInterval(loadTelemetry, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleMigrate = async () => {
    setMigrating(true);
    setMigrationResult(null);
    const res = await migrateOldLogs();
    setMigrationResult(res.message);
    if (res.success && res.count > 0) {
      const data = await getLogs();
      setLogs(data);
    }
    setMigrating(false);
  };

  const chartData = useMemo(() => {
    return [...logs]
      .map(log => {
        const date = log.data.manualTimestamp
          ? new Date(log.data.manualTimestamp)
          : (log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp || Date.now()));

        let temp = null;
        let cost = null;

        if (log.type === 'heating_calculated') {
          cost = log.data.costEstimate;
          if (log.data.startTemp) temp = log.data.startTemp;
        } else if (log.type === 'manual_log' || log.type === 'heating_action') {
          temp = log.data.temp;
        }

        return {
          timeLabel: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
          fullLabel: date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          temp: temp !== null ? Number(temp) : null,
          cost: cost !== null ? Number(cost) : null,
          timestamp: date.getTime()
        };
      })
      .filter(point => point.temp !== null || point.cost !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [logs]);

  const telemetryChartData = useMemo(() => {
    return [...telemetry.samples].reverse().map(sample => ({
      timestamp: sample.timestamp,
      timeLabel: new Date(sample.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      fullLabel: new Date(sample.timestamp).toLocaleString(),
      water: sample.spa.connected && finiteNumber(sample.spa.waterTemperatureC) ? sample.spa.waterTemperatureC : null,
      target: finiteNumber(sample.spa.targetTemperatureC) ? sample.spa.targetTemperatureC : null
    }));
  }, [telemetry.samples]);

  const latestTelemetry = telemetry.samples[0];
  const lastConnectedTelemetry = telemetry.samples.find(sample => sample.spa.connected && finiteNumber(sample.spa.waterTemperatureC));

  return (
    <div className="p-4 max-w-xl mx-auto space-y-6 pb-8">
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4 px-1">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Automatic Telemetry</h2>
            <p className="text-sm text-slate-500">Always-on spa samples recorded by the local collector.</p>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${telemetryStatus?.firebaseEnabled && telemetryStatus.pendingUploads === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
            {telemetryStatus?.firebaseEnabled ? <Cloud className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
            {telemetryStatus?.firebaseEnabled ? `${telemetryStatus.pendingUploads} pending` : 'Cloud off'}
          </div>
        </div>

        {telemetryLoading ? (
          <div className="p-8 text-center text-slate-500 bg-white rounded-3xl border border-slate-100">Loading telemetry...</div>
        ) : telemetryError ? (
          <div className="p-5 text-sm text-red-700 bg-red-50 rounded-2xl border border-red-100">{telemetryError}</div>
        ) : telemetry.samples.length === 0 ? (
          <div className="p-8 text-center text-slate-500 bg-white rounded-3xl border border-slate-100">No automatic telemetry has been recorded yet.</div>
        ) : (
          <>
            <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Radio className="w-5 h-5" /></div>
                  <div>
                    <p className="font-bold text-slate-900">Water temperature</p>
                    <p className="text-xs text-slate-500">Showing {telemetry.samples.length} of {telemetry.total} archived samples</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-900">
                    {latestTelemetry.spa.connected && finiteNumber(latestTelemetry.spa.waterTemperatureC)
                      ? formatTemperature(latestTelemetry.spa.waterTemperatureC)
                      : 'Unreachable'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {latestTelemetry.spa.connected && finiteNumber(latestTelemetry.spa.targetTemperatureC)
                      ? `Target ${formatTemperature(latestTelemetry.spa.targetTemperatureC)}`
                      : lastConnectedTelemetry
                        ? `Last connected ${new Date(lastConnectedTelemetry.timestamp).toLocaleString()}`
                        : 'No connected reading'}
                  </p>
                </div>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={telemetryChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="timeLabel" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={28} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} domain={['dataMin - 1', 'dataMax + 1']} />
                    <Tooltip labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullLabel || ''} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Line type="monotone" dataKey="water" name="Water °C" stroke="#4f46e5" strokeWidth={3} dot={false} connectNulls={false} />
                    <Line type="stepAfter" dataKey="target" name="Target °C" stroke="#f97316" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-3">
              {telemetry.samples.slice(0, 20).map(sample => {
                const waterLabel = formatTemperature(sample.spa.waterTemperatureC);
                const targetLabel = formatTemperature(sample.spa.targetTemperatureC);
                return (
                  <div key={sample.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${sample.spa.connected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                      <Thermometer className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-slate-900">{waterLabel === 'No reading' ? 'No water-temperature reading' : `${waterLabel} water`}</p>
                        <span className={`text-xs font-semibold ${sample.spa.connected ? 'text-emerald-600' : 'text-slate-500'}`}>{sample.spa.connected ? 'Connected' : 'Unreachable'}</span>
                      </div>
                      <p className="text-sm text-slate-500">Target {targetLabel} · Heater {sample.spa.heaterOn ? 'on' : 'off'} · Filter {sample.spa.filterOn ? 'on' : 'off'}</p>
                      <div className="flex items-center gap-1 mt-1.5 text-xs font-medium text-slate-400"><Clock className="w-3 h-3" />{new Date(sample.timestamp).toLocaleString()}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <h2 className="text-xl font-bold text-slate-900 px-1">Your Activity History</h2>

      {!user ? (
        <div className="p-6 text-center text-slate-500 bg-white rounded-3xl border border-slate-100 space-y-2">
          <p>Sign in to view and save your manual activity logs.</p>
          <p className="text-sm">Automatic telemetry above continues without a browser login.</p>
        </div>
      ) : migrationResult ? (
        <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl text-indigo-800 text-sm">{migrationResult}</div>
      ) : (
        <div className="bg-slate-100 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
          <div className="text-sm text-slate-600"><strong>Have older public logs?</strong><br/>Copy them to your private account securely.</div>
          <button onClick={handleMigrate} disabled={migrating} className="flex items-center gap-2 bg-white text-slate-800 border border-slate-200 shadow-sm px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors disabled:opacity-50">
            <Download className="w-4 h-4" />{migrating ? 'Migrating...' : 'Migrate'}
          </button>
        </div>
      )}

      {user && loading && <div className="p-8 text-center text-slate-500">Loading activity logs...</div>}

      {user && !loading && logs.length === 0 && (
        <div className="p-8 text-center text-slate-500 bg-white rounded-3xl border border-slate-100">No manual activity logs found in your account. Automatic telemetry is shown above.</div>
      )}

      {user && chartData.length > 1 && (
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><TrendingUp className="w-5 h-5" /></div>
            <h2 className="text-lg font-bold text-slate-900">Trends</h2>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="timeLabel" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} dy={10} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(val) => `£${val}`} />
                <Tooltip labelFormatter={(label, payload) => payload?.[0]?.payload?.fullLabel || label} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} itemStyle={{ fontSize: '12px', fontWeight: 'bold' }} labelStyle={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Bar yAxisId="right" dataKey="cost" name="Est. Cost (£)" fill="#fbbf24" radius={[4, 4, 0, 0]} barSize={20} />
                <Line yAxisId="left" type="monotone" dataKey="temp" name="Temperature" stroke="#4f46e5" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {logs.map(log => {
          let icon = <Activity className="w-5 h-5 text-slate-400" />;
          let title = "Unknown Activity";
          let detail = "";

          if (log.type === 'heating_calculated') {
            icon = <Thermometer className="w-5 h-5 text-orange-500" />;
            title = "Heating Calculated";
            detail = `From ${log.data.startTemp}° to ${log.data.targetTemp}°. Est cost: £${log.data.costEstimate?.toFixed(2)}`;
            if (log.data.ambientTempAvg !== undefined) {
              detail += ` (Avg ambient: ${Math.round(log.data.ambientTempAvg)}°C, Wind: ${Math.round(log.data.avgWindSpeed || 0)}km/h)`;
            }
          } else if (log.type === 'chemical_dose') {
            icon = <Droplet className="w-5 h-5 text-indigo-500" />;
            title = "Chemical Test Logged";
            detail = `pH: ${log.data.ph || '-'}, Cl: ${log.data.chlorine || '-'}, Alk: ${log.data.alkalinity || '-'}`;
          } else if (log.type === 'heating_action') {
            icon = <Thermometer className="w-5 h-5 text-red-500" />;
            title = log.data.action === 'started_heating' ? 'Started Heating' : 'Session Started';
            detail = `Temp: ${log.data.temp || 'Unknown'}°`;
          } else if (log.type === 'manual_log') {
            icon = <Activity className="w-5 h-5 text-indigo-400" />;
            const actionMap: Record<string, string> = {
              reading_only: 'Note Temp',
              heater_on: 'Heater On',
              heater_off: 'Heater Off',
              entered_tub: 'Entered Tub',
              exited_tub: 'Exited Tub'
            };
            const actionText = actionMap[log.data.action] || log.data.action;
            title = `Manual Log: ${actionText}`;
            const details = [];
            if (log.data.temp) details.push(`Temp: ${log.data.temp}°`);
            if (log.data.cover && log.data.cover !== 'unknown') details.push(`Cover: ${log.data.cover}`);
            if (log.data.heater && log.data.heater !== 'unknown') details.push(`Heater: ${log.data.heater}`);
            if (log.data.rattle && log.data.rattle !== 'unknown') details.push(`Rattle: ${log.data.rattle}`);
            detail = details.join(' | ');
          }

          const date = log.data.manualTimestamp ? new Date(log.data.manualTimestamp) : (log.timestamp?.toDate ? log.timestamp.toDate() : new Date());

          return (
            <div key={log.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-start gap-4">
              <div className="p-3 bg-slate-50 rounded-xl shrink-0">{icon}</div>
              <div>
                <p className="font-semibold text-slate-900">{title}</p>
                <p className="text-sm text-slate-500">{detail}</p>
                <div className="flex items-center gap-1 mt-2 text-xs font-medium text-slate-400"><Clock className="w-3 h-3" />{date.toLocaleString()}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
