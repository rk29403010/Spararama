import React, { useEffect, useMemo, useState } from 'react';
import { Database, Link2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { AppState } from '../types';
import type { WaterBodyKind } from '../domain/models';
import type { EquipmentCatalogModel } from '../domain/equipmentCatalog';
import { fetchEquipmentCatalog } from '../lib/catalogApi';
import { spaApi } from '../lib/spaApi';

interface Props {
  state: AppState;
  updateState: (state: AppState) => void;
}

export function SpaConfiguration({ state, updateState }: Props) {
  const [models, setModels] = useState<EquipmentCatalogModel[]>([]);
  const [catalogSource, setCatalogSource] = useState<'firestore' | 'seed'>('seed');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [connecting, setConnecting] = useState(false);

  const activeWaterBody = state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId)
    || state.domain.waterBodies[0];
  const kind = state.config.waterBodyKind || activeWaterBody?.kind || 'spa';

  const loadCatalog = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchEquipmentCatalog();
      setModels(response.models);
      setCatalogSource(response.source);
    } catch (err: any) {
      setError(err?.message || 'Equipment catalogue is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCatalog(); }, []);

  const kindModels = useMemo(() => models.filter(model => model.kind === kind), [models, kind]);
  const manufacturers = useMemo(() => {
    const byId = new Map<string, string>();
    kindModels.forEach(model => byId.set(model.manufacturerId, model.manufacturer));
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [kindModels]);
  const manufacturerModels = kindModels.filter(model => model.manufacturerId === state.config.manufacturerId);
  const selectedModel = models.find(model => model.id === state.config.modelId);

  const updateActiveWaterBody = (patch: Partial<typeof activeWaterBody>) => {
    if (!activeWaterBody) return state.domain;
    return {
      ...state.domain,
      waterBodies: state.domain.waterBodies.map(item => item.id === activeWaterBody.id ? { ...item, ...patch } : item)
    };
  };

  const selectKind = (nextKind: WaterBodyKind) => {
    setConnectionMessage('');
    updateState({
      ...state,
      config: {
        ...state.config,
        waterBodyKind: nextKind,
        manufacturerId: undefined,
        modelId: undefined,
        model: nextKind === 'spa' ? 'Unspecified spa' : 'Unspecified pool',
        wifiSupported: false,
        connectorId: undefined,
        capacityOverrideLiters: state.config.waterCapacityLiters
      },
      domain: updateActiveWaterBody({
        kind: nextKind,
        name: nextKind === 'spa' ? 'Unspecified spa' : 'Unspecified pool',
        manufacturerId: undefined,
        manufacturer: undefined,
        modelId: undefined,
        model: undefined,
        modelCapacityLiters: undefined,
        connectivity: 'none',
        connectorId: undefined
      })
    });
  };

  const selectManufacturer = (manufacturerId: string) => {
    const manufacturer = manufacturers.find(([id]) => id === manufacturerId)?.[1];
    setConnectionMessage('');
    updateState({
      ...state,
      config: { ...state.config, manufacturerId: manufacturerId || undefined, modelId: undefined, connectorId: undefined, wifiSupported: false },
      domain: updateActiveWaterBody({ manufacturerId: manufacturerId || undefined, manufacturer, modelId: undefined, model: undefined, connectorId: undefined, connectivity: 'none' })
    });
  };

  const selectModel = (modelId: string) => {
    const model = models.find(item => item.id === modelId);
    if (!model) return;
    const volume = model.capacityLiters || state.config.waterCapacityLiters;
    const nextBaseRate = model.nominalHeatingRateCPerHour || state.config.baseHeatingRatePerHour;
    const nextReferenceVolume = model.nominalHeatingRateCPerHour && model.capacityLiters
      ? model.capacityLiters
      : state.config.heatingRateReferenceVolumeLiters;

    setConnectionMessage('');
    updateState({
      ...state,
      config: {
        ...state.config,
        waterBodyKind: model.kind,
        manufacturerId: model.manufacturerId,
        modelId: model.id,
        model: model.model,
        waterCapacityLiters: volume,
        capacityOverrideLiters: undefined,
        wifiSupported: model.wifi,
        connectorId: model.connectorId,
        maxTemp: model.maxTempC || state.config.maxTemp,
        heaterPowerWatts: model.heaterPowerWatts || state.config.heaterPowerWatts,
        baseHeatingRatePerHour: nextBaseRate,
        heatingRateReferenceVolumeLiters: nextReferenceVolume
      },
      domain: updateActiveWaterBody({
        name: `${model.manufacturer} ${model.model}`,
        kind: model.kind,
        volumeLiters: volume,
        manufacturerId: model.manufacturerId,
        manufacturer: model.manufacturer,
        modelId: model.id,
        model: model.model,
        modelCapacityLiters: model.capacityLiters,
        connectivity: model.wifi ? 'wifi' : 'none',
        connectorId: model.connectorId
      })
    });
  };

  const setVolume = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    updateState({
      ...state,
      config: { ...state.config, waterCapacityLiters: value, capacityOverrideLiters: value },
      domain: updateActiveWaterBody({ volumeLiters: value })
    });
  };

  const resetVolume = () => {
    if (!selectedModel?.capacityLiters) return;
    updateState({
      ...state,
      config: { ...state.config, waterCapacityLiters: selectedModel.capacityLiters, capacityOverrideLiters: undefined },
      domain: updateActiveWaterBody({ volumeLiters: selectedModel.capacityLiters })
    });
  };

  const connect = async () => {
    setConnecting(true);
    setConnectionMessage('');
    try {
      const result = await spaApi.connect();
      setConnectionMessage(result.connected ? 'Connected to the spa.' : 'Connector ran, but the spa was not found.');
    } catch (err: any) {
      setConnectionMessage(err?.message || 'Unable to connect to the spa.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">Spa / pool</h3>
          <p className="text-xs text-slate-500 mt-1">Model data supplies capacity and connectivity where the manufacturer publishes it.</p>
        </div>
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1"><Database className="w-3.5 h-3.5" />{catalogSource}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => selectKind('spa')} className={`py-3 rounded-xl font-bold ${kind === 'spa' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Hot tub / spa</button>
        <button type="button" onClick={() => selectKind('pool')} className={`py-3 rounded-xl font-bold ${kind === 'pool' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Pool</button>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading model catalogue…</p> : <>
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Manufacturer</span>
          <select value={state.config.manufacturerId || ''} onChange={e => selectManufacturer(e.target.value)} className="mt-1 w-full bg-slate-100 rounded-xl px-3 py-3 font-semibold">
            <option value="">Choose manufacturer</option>
            {manufacturers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-bold text-slate-700">Model</span>
          <select value={state.config.modelId || ''} onChange={e => selectModel(e.target.value)} disabled={!state.config.manufacturerId} className="mt-1 w-full bg-slate-100 rounded-xl px-3 py-3 font-semibold disabled:opacity-50">
            <option value="">Choose model</option>
            {manufacturerModels.map(model => <option key={model.id} value={model.id}>{model.model}</option>)}
          </select>
        </label>
      </>}

      {error && <div className="bg-amber-50 text-amber-900 rounded-xl p-3 text-sm flex items-center justify-between gap-2"><span>{error}</span><button onClick={() => void loadCatalog()} aria-label="Retry"><RefreshCw className="w-4 h-4" /></button></div>}

      <label className="block">
        <span className="text-sm font-bold text-slate-700">Water volume</span>
        <div className="mt-1 flex items-center gap-2">
          <input type="number" min="1" step="1" value={state.config.waterCapacityLiters} onChange={e => setVolume(Number(e.target.value))} className="w-full bg-slate-100 rounded-xl px-3 py-3 font-bold" />
          <span className="font-bold text-slate-500">L</span>
        </div>
        {selectedModel?.capacityLiters && <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500"><span>Model capacity: {selectedModel.capacityLiters.toLocaleString()} L{state.config.capacityOverrideLiters ? ' - overridden' : ''}</span>{state.config.capacityOverrideLiters && <button type="button" onClick={resetVolume} className="font-bold text-indigo-600">Use model capacity</button>}</div>}
      </label>

      {selectedModel && <div className="rounded-xl bg-slate-50 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-bold">{selectedModel.wifi ? <Wifi className="w-4 h-4 text-emerald-600" /> : <WifiOff className="w-4 h-4 text-slate-400" />}{selectedModel.wifi ? 'Wi-Fi capable' : 'No Wi-Fi option recorded'}</div>
        {selectedModel.wifi && selectedModel.connectorId === 'cleverspa' && <button type="button" disabled={connecting} onClick={() => void connect()} className="w-full py-3 rounded-xl bg-slate-900 text-white font-extrabold flex items-center justify-center gap-2 disabled:opacity-50"><Link2 className="w-4 h-4" />{connecting ? 'Connecting…' : 'Connect to spa'}</button>}
        {selectedModel.wifi && !selectedModel.connectorId && <p className="text-xs text-slate-600">This model has manufacturer Wi-Fi support, but Spararama does not yet have a connector for it.</p>}
        {connectionMessage && <p className="text-xs font-semibold text-slate-700">{connectionMessage}</p>}
        <div className="pt-1 space-y-1">{selectedModel.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block text-xs text-indigo-600 underline">{source.label}</a>)}</div>
      </div>}
    </section>
  );
}
