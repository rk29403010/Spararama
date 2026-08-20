import React, { useEffect, useMemo, useState } from 'react';
import { Link2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
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

  const activeWaterBody = state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) || state.domain.waterBodies[0];
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
    const nextReferenceVolume = model.nominalHeatingRateCPerHour && model.capacityLiters ? model.capacityLiters : state.config.heatingRateReferenceVolumeLiters;

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
      setConnectionMessage(result.connected ? 'Connected' : 'Spa not found');
    } catch (err: any) {
      setConnectionMessage(err?.message || 'Unable to connect');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-5">
      <h3 className="text-xl font-black text-slate-950">Spa / pool</h3>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" aria-pressed={kind === 'spa'} onClick={() => selectKind('spa')} className={`min-h-14 rounded-xl text-base font-black ${kind === 'spa' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>Hot tub / spa</button>
        <button type="button" aria-pressed={kind === 'pool'} onClick={() => selectKind('pool')} className={`min-h-14 rounded-xl text-base font-black ${kind === 'pool' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>Pool</button>
      </div>

      {loading ? (
        <p role="status" className="text-base font-bold text-slate-600">Loading models…</p>
      ) : (
        <>
          <label className="block">
            <span className="text-base font-black text-slate-800">Manufacturer</span>
            <select value={state.config.manufacturerId || ''} onChange={event => selectManufacturer(event.target.value)} className="mt-1 w-full min-h-14 bg-slate-100 text-slate-950 rounded-xl px-3 font-bold">
              <option value="">Choose manufacturer</option>
              {manufacturers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-base font-black text-slate-800">Model</span>
            <select value={state.config.modelId || ''} onChange={event => selectModel(event.target.value)} disabled={!state.config.manufacturerId} className="mt-1 w-full min-h-14 bg-slate-100 text-slate-950 rounded-xl px-3 font-bold disabled:opacity-50">
              <option value="">Choose model</option>
              {manufacturerModels.map(model => <option key={model.id} value={model.id}>{model.model}</option>)}
            </select>
          </label>
        </>
      )}

      {error && (
        <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-950 rounded-xl p-3 font-bold flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => void loadCatalog()} aria-label="Retry model catalogue" className="w-12 h-12 shrink-0 rounded-xl bg-amber-100 flex items-center justify-center"><RefreshCw className="w-5 h-5" aria-hidden="true" /></button>
        </div>
      )}

      <label className="block">
        <span className="text-base font-black text-slate-800">Water volume</span>
        <div className="mt-1 flex items-center gap-2">
          <input type="number" inputMode="numeric" min="1" step="1" value={state.config.waterCapacityLiters} onChange={event => setVolume(Number(event.target.value))} className="w-full min-h-14 bg-slate-100 text-slate-950 rounded-xl px-3 font-black text-lg" />
          <span className="font-black text-slate-600">L</span>
        </div>
        {selectedModel?.capacityLiters && (
          <div className="mt-2 flex items-center justify-between gap-3 text-sm font-bold text-slate-600">
            <span>{selectedModel.capacityLiters.toLocaleString()} L model capacity{state.config.capacityOverrideLiters ? ' - overridden' : ''}</span>
            {state.config.capacityOverrideLiters && <button type="button" onClick={resetVolume} className="min-h-11 px-2 font-black text-indigo-800">Reset</button>}
          </div>
        )}
      </label>

      {selectedModel && (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-2 text-base font-black text-slate-800">
            {selectedModel.wifi ? <Wifi className="w-5 h-5 text-emerald-700" aria-hidden="true" /> : <WifiOff className="w-5 h-5 text-slate-500" aria-hidden="true" />}
            {selectedModel.wifi ? 'Wi-Fi capable' : 'No Wi-Fi recorded'}
          </div>

          {selectedModel.wifi && selectedModel.connectorId === 'cleverspa' && (
            <button type="button" disabled={connecting} onClick={() => void connect()} className="w-full min-h-14 rounded-xl bg-slate-950 text-white text-base font-black flex items-center justify-center gap-2 disabled:opacity-50">
              <Link2 className="w-5 h-5" aria-hidden="true" />{connecting ? 'Connecting…' : 'Connect to spa'}
            </button>
          )}

          {selectedModel.wifi && !selectedModel.connectorId && <p className="text-sm font-bold text-slate-600">Wi-Fi supported; Spararama connector not available yet.</p>}
          {connectionMessage && <p role="status" className="text-sm font-black text-slate-800">{connectionMessage}</p>}

          {selectedModel.sources.length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer text-sm font-bold text-slate-600">Model data sources</summary>
              <div className="space-y-2 pt-2">
                {selectedModel.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block min-h-11 py-2 text-sm font-bold text-indigo-800 underline">{source.label}</a>)}
                <p className="text-xs text-slate-500">Catalogue: {catalogSource}</p>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
