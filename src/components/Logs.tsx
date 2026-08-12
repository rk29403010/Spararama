import React, { useEffect, useState, useMemo } from 'react';
import { getLogs, migrateOldLogs, subscribeToAuthChanges } from '../lib/firebase';
import { Activity, Thermometer, Droplet, Clock, TrendingUp, Download } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

export function Logs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

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

  const handleMigrate = async () => {
    setMigrating(true);
    setMigrationResult(null);
    const res = await migrateOldLogs();
    setMigrationResult(res.message);
    if (res.success && res.count > 0) {
      // Refresh logs
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

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading logs...</div>;
  }

  if (!user) {
    return (
      <div className="p-8 text-center text-slate-500 space-y-4">
        <p>You must sign in to view and save activity logs.</p>
        <p className="text-sm">Go to the Settings tab to authenticate with Google.</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-xl mx-auto space-y-6 pb-8">
      
      {migrationResult ? (
        <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl text-indigo-800 text-sm">
          {migrationResult}
        </div>
      ) : (
        <div className="bg-slate-100 border border-slate-200 p-4 rounded-xl flex items-center justify-between">
          <div className="text-sm text-slate-600">
            <strong>Have older public logs?</strong><br/>
            Copy them to your private account securely.
          </div>
          <button 
            onClick={handleMigrate} 
            disabled={migrating}
            className="flex items-center gap-2 bg-white text-slate-800 border border-slate-200 shadow-sm px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {migrating ? 'Migrating...' : 'Migrate'}
          </button>
        </div>
      )}

      {logs.length === 0 && (
        <div className="p-8 text-center text-slate-500 bg-white rounded-3xl border border-slate-100">
          No logs found in your account. Calculate heating or scan chemicals to generate new logs.
        </div>
      )}
      
      {chartData.length > 1 && (
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Trends</h2>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="timeLabel" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#94a3b8' }} 
                  dy={10}
                />
                <YAxis 
                  yAxisId="left" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#94a3b8' }} 
                />
                <YAxis 
                  yAxisId="right" 
                  orientation="right" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#94a3b8' }} 
                  tickFormatter={(val) => `£${val}`}
                />
                <Tooltip 
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.fullLabel || label}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                  labelStyle={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Bar 
                  yAxisId="right" 
                  dataKey="cost" 
                  name="Est. Cost (£)" 
                  fill="#fbbf24" 
                  radius={[4, 4, 0, 0]} 
                  barSize={20}
                />
                <Line 
                  yAxisId="left" 
                  type="monotone" 
                  dataKey="temp" 
                  name="Temperature" 
                  stroke="#4f46e5" 
                  strokeWidth={3}
                  dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} 
                  activeDot={{ r: 6 }} 
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <h2 className="text-xl font-bold text-slate-900 mb-4 px-1">Activity History</h2>
      
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
            <div className="p-3 bg-slate-50 rounded-xl shrink-0">
              {icon}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{title}</p>
              <p className="text-sm text-slate-500">{detail}</p>
              <div className="flex items-center gap-1 mt-2 text-xs font-medium text-slate-400">
                <Clock className="w-3 h-3" />
                {date.toLocaleString()}
              </div>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
