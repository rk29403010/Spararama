import React, { useState } from 'react';
import { CameraCapture } from './CameraCapture';
import { AppState, ChemicalInventory, TestReading } from '../types';
import { Beaker, ScanBarcode, Plus, Loader2, AlertCircle } from 'lucide-react';
import axios from 'axios';
import { logEvent } from '../lib/firebase';

interface ChemicalsProps {
  state: AppState;
  updateState: (newState: AppState) => void;
}

export function Chemicals({ state, updateState }: ChemicalsProps) {
  const [showScanner, setShowScanner] = useState<"barcode" | "test_strip" | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");

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
            id: Date.now().toString(),
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
          setError("Could not identify the chemical from the barcode.");
        }
      } else if (type === "test_strip") {
         let rec = "Levels are looking okay, but please verify with chart.";
         if (data.chlorine < 1.0) rec = "Add Chlorine.";
         if (data.ph && data.ph < 7.2) rec = "Add pH Plus.";
         if (data.ph && data.ph > 7.6) rec = "Add pH Minus.";

         const newReading: TestReading = {
           id: Date.now().toString(),
           timestamp: Date.now(),
           chlorine: data.chlorine ?? null,
           bromine: data.bromine ?? null,
           ph: data.ph ?? null,
           alkalinity: data.alkalinity ?? null,
           recommendation: rec
         };
         updateState({
           ...state,
           readings: [newReading, ...state.readings]
         });
         logEvent('chemical_dose', {
           chlorine: data.chlorine,
           bromine: data.bromine,
           ph: data.ph,
           alkalinity: data.alkalinity,
           recommendation: rec
         });
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to analyze image");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-8">
      {showScanner && (
        <CameraCapture 
          title={showScanner === "barcode" ? "Scan Barcode" : "Scan Test Strip"}
          onCancel={() => setShowScanner(null)}
          onCapture={handleCapture}
        />
      )}

      {isAnalyzing && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
            <p className="text-slate-900 font-medium">Analyzing Image...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-current" />
          <p>{error}</p>
        </div>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Chemical Inventory</h2>
          <button 
            onClick={() => setShowScanner("barcode")}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium transition-colors"
          >
            <ScanBarcode className="w-4 h-4 text-current" />
            Scan Chemical
          </button>
        </div>

        {state.inventory.length === 0 ? (
          <div className="text-center p-8 bg-slate-50 rounded-2xl border border-slate-100 text-slate-500">
            No chemicals in inventory. Scan a barcode to add.
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {state.inventory.map(item => (
              <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
                <div>
                  <p className="font-semibold text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-500">{item.ingredientType} &bull; {item.quantity}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
         <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Recent Readings</h2>
          <button 
            onClick={() => setShowScanner("test_strip")}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg font-medium shadow-sm transition-colors"
          >
            <Beaker className="w-4 h-4 text-current" />
            Scan Strip
          </button>
        </div>

         {state.readings.length === 0 ? (
          <div className="text-center p-8 bg-slate-50 rounded-2xl border border-slate-100 text-slate-500">
            No readings yet. Dip a strip and scan it!
          </div>
        ) : (
          <div className="space-y-4">
            {state.readings.map(reading => (
              <div key={reading.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-sm text-slate-500">
                    {new Date(reading.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-slate-50 p-3 rounded-lg text-center">
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Cl / Br</p>
                    <p className="font-semibold text-slate-900 text-lg">{reading.chlorine ?? reading.bromine ?? '-'}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg text-center">
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">pH</p>
                    <p className="font-semibold text-slate-900 text-lg">{reading.ph ?? '-'}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg text-center">
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Alk</p>
                    <p className="font-semibold text-slate-900 text-lg">{reading.alkalinity ?? '-'}</p>
                  </div>
                </div>
                {reading.recommendation && (
                  <div className="bg-amber-50 p-3 rounded-lg border border-amber-100">
                    <p className="text-sm font-medium text-amber-900">Suggestion:</p>
                    <p className="text-sm text-amber-800">{reading.recommendation}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
