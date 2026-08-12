import React, { useState } from 'react';
import { CameraCapture } from './CameraCapture';
import { GuidedWaterTest } from './GuidedWaterTest';
import { SpaStatusCard } from './SpaStatusCard';
import { AppState, ChemicalInventory } from '../types';
import type { ChemistryAssessment, MeasurementReading } from '../domain/models';
import { assessChemistry } from '../domain/chemistry';
import { Beaker, ScanBarcode, Loader2, AlertCircle, Camera } from 'lucide-react';
import axios from 'axios';
import { logEvent } from '../lib/firebase';

interface ChemicalsProps {
  state: AppState;
  updateState: (newState: AppState) => void;
}

function actionText(assessment: ChemistryAssessment) {
  const action = assessment.nextAction;
  if (action.kind === 'dose') return `Add ${action.amount}${action.unit} ${action.productName}`;
  if (action.kind === 'retest') return 'Retest before dosing';
  return 'No adjustment needed';
}

function readingText(reading: MeasurementReading) {
  if (typeof reading.value === 'number') return String(reading.value);
  if (typeof reading.min === 'number' && typeof reading.max === 'number') return `${reading.min}-${reading.max}`;
  return '—';
}

const LABELS: Record<string, string> = {
  free_chlorine: 'Free Cl',
  total_chlorine: 'Total Cl',
  bromine: 'Bromine',
  ph: 'pH',
  total_alkalinity: 'TA',
  calcium_hardness: 'Hardness',
  cyanuric_acid: 'CYA'
};

export function Chemicals({ state, updateState }: ChemicalsProps) {
  const [showScanner, setShowScanner] = useState<"barcode" | "test_strip" | null>(null);
  const [showGuidedTest, setShowGuidedTest] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const activeWaterBody = state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) ?? state.domain.waterBodies[0];

  const handleCapture = async (base64: string) => {
    setIsAnalyzing(true);
    setError("");
    const type = showScanner;
    setShowScanner(null);

    try {
      const res = await axios.post("/api/analyze-image", { imageBase64: base64, type });
      const data = res.data;

      if (type === "barcode") {
        if (data.name) {
          const newItem: ChemicalInventory = {
            id: crypto.randomUUID(),
            name: data.name,
            ingredientType: data.ingredientType || 'Unknown',
            quantity: data.quantity || 'Unknown',
            addedAt: Date.now()
          };
          updateState({
            ...state,
            inventory: [...state.inventory, newItem]
          });
        } else {
          setError("Could not identify the chemical from the image.");
        }
      } else if (type === "test_strip") {
        const readings: MeasurementReading[] = [];
        if (typeof data.chlorine === 'number') readings.push({ measurement: 'free_chlorine', value: data.chlorine, source: 'camera', confidence: 0.5 });
        if (typeof data.bromine === 'number') readings.push({ measurement: 'bromine', value: data.bromine, source: 'camera', confidence: 0.5 });
        if (typeof data.ph === 'number') readings.push({ measurement: 'ph', value: data.ph, source: 'camera', confidence: 0.5 });
        if (typeof data.alkalinity === 'number') readings.push({ measurement: 'total_alkalinity', value: data.alkalinity, source: 'camera', confidence: 0.5 });

        if (!activeWaterBody || readings.length === 0) {
          setError('The image did not produce usable readings.');
          return;
        }

        const assessment = assessChemistry(activeWaterBody, state.domain.products, readings);
        const record = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          waterBodyId: activeWaterBody.id,
          testMethodId: 'camera-estimate',
          readings
        };

        updateState({
          ...state,
          domain: {
            ...state.domain,
            waterTests: [record, ...state.domain.waterTests]
          }
        });
        void logEvent('water_test', { ...record, assessment });
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to analyze image");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-6">
      {showGuidedTest && (
        <GuidedWaterTest state={state} updateState={updateState} onClose={() => setShowGuidedTest(false)} />
      )}

      {showScanner && (
        <CameraCapture
          title={showScanner === "barcode" ? "Scan Chemical" : "Camera Estimate"}
          onCancel={() => setShowScanner(null)}
          onCapture={handleCapture}
        />
      )}

      {isAnalyzing && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
            <p className="text-slate-900 font-medium">Reading image…</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <SpaStatusCard />

      <section className="bg-slate-900 rounded-3xl p-5 text-white shadow-lg">
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">By the tub</p>
        <h2 className="text-3xl font-black mt-1">Test the water</h2>
        <p className="text-slate-300 mt-2">Guided timing, range-friendly readings and deterministic dosing advice.</p>
        <div className="grid grid-cols-[1fr_auto] gap-3 mt-5">
          <button
            type="button"
            onClick={() => setShowGuidedTest(true)}
            className="min-h-16 rounded-2xl bg-indigo-500 text-white text-xl font-black flex items-center justify-center gap-2"
          >
            <Beaker className="w-6 h-6" /> Test water
          </button>
          <button
            type="button"
            onClick={() => setShowScanner('test_strip')}
            className="min-h-16 min-w-16 rounded-2xl bg-white/10 text-white flex items-center justify-center"
            aria-label="Estimate strip with camera"
          >
            <Camera className="w-6 h-6" />
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-900">Recent Water Tests</h2>
          <span className="text-xs font-bold text-slate-400">{state.domain.waterTests.length} stored</span>
        </div>

        {state.domain.waterTests.length === 0 ? (
          <div className="text-center p-8 bg-slate-50 rounded-2xl border border-slate-100 text-slate-500">
            No structured water tests yet.
          </div>
        ) : (
          <div className="space-y-3">
            {state.domain.waterTests.slice(0, 6).map(test => {
              const assessment = activeWaterBody && test.waterBodyId === activeWaterBody.id
                ? assessChemistry(activeWaterBody, state.domain.products, test.readings)
                : null;
              return (
                <div key={test.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="text-sm font-bold text-slate-500">{new Date(test.timestamp).toLocaleString()}</span>
                    {assessment && <span className="text-xs font-black text-indigo-700 bg-indigo-50 px-2 py-1 rounded-lg">{actionText(assessment)}</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {test.readings.map(reading => (
                      <span key={reading.measurement} className="bg-slate-100 rounded-xl px-3 py-2 text-sm">
                        <strong>{LABELS[reading.measurement] || reading.measurement}</strong> {readingText(reading)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-900">Chemical Inventory</h2>
          <button
            type="button"
            onClick={() => setShowScanner("barcode")}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium"
          >
            <ScanBarcode className="w-4 h-4" />
            Scan chemical
          </button>
        </div>

        {state.inventory.length === 0 ? (
          <div className="text-center p-8 bg-slate-50 rounded-2xl border border-slate-100 text-slate-500">
            No chemicals in inventory yet.
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {state.inventory.map(item => (
              <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
                <div>
                  <p className="font-semibold text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-500">{item.ingredientType} · {item.quantity}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
