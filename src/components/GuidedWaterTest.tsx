import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Timer, Volume2, VolumeX, X } from 'lucide-react';
import type { AppState } from '../types';
import type { ChemistryAssessment, MeasurementKey, MeasurementReading } from '../domain/models';
import { assessChemistry } from '../domain/chemistry';
import { logEvent } from '../lib/firebase';
import { spaApi } from '../lib/spaApi';

interface GuidedWaterTestProps {
  state: AppState;
  updateState: (state: AppState) => void;
  onClose: () => void;
}

type Phase = 'choose' | 'guide' | 'readings' | 'result' | 'mixing';

function parseReading(measurement: MeasurementKey, raw: string): MeasurementReading | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const range = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)$/i);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return {
      measurement,
      min: Math.min(a, b),
      max: Math.max(a, b),
      source: 'manual'
    };
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return { measurement, value, source: 'manual' };
}

function actionTitle(assessment: ChemistryAssessment) {
  const action = assessment.nextAction;
  if (action.kind === 'dose') return `Add ${action.amount}${action.unit} ${action.productName}`;
  if (action.kind === 'retest') return 'Retest before dosing';
  return 'No adjustment needed';
}

function actionDetail(assessment: ChemistryAssessment) {
  const action = assessment.nextAction;
  if (action.kind === 'dose') {
    const circulation = action.circulationRequired ? ' Filtration/circulation will be started when you confirm the dose.' : '';
    return `${action.reason} Mix for ${action.mixMinutes} minutes, then retest.${circulation}`;
  }
  return action.reason;
}

function formatCountdown(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function GuidedWaterTest({ state, updateState, onClose }: GuidedWaterTestProps) {
  const [phase, setPhase] = useState<Phase>('choose');
  const [methodId, setMethodId] = useState(state.domain.activeTestMethodId);
  const [stepIndex, setStepIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [assessment, setAssessment] = useState<ChemistryAssessment | null>(null);
  const [entryError, setEntryError] = useState('');
  const [controlError, setControlError] = useState('');
  const [mixEndsAt, setMixEndsAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [savingDose, setSavingDose] = useState(false);

  const method = useMemo(
    () => (state.domain.testMethods.find(item => item.id === methodId) ?? state.domain.testMethods[0])!,
    [state.domain.testMethods, methodId]
  );
  const waterBody = useMemo(
    () => (state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) ?? state.domain.waterBodies[0])!,
    [state.domain.waterBodies, state.domain.activeWaterBodyId]
  );

  const currentStep = method?.instructions[stepIndex];
  const remainingMixSeconds = mixEndsAt ? Math.max(0, Math.ceil((mixEndsAt - clock) / 1000)) : 0;

  useEffect(() => {
    if (phase !== 'guide' || !currentStep) return;
    setSecondsLeft(currentStep.durationSeconds ?? 0);
    if (speechEnabled && currentStep.spokenText && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(currentStep.spokenText));
    }
  }, [phase, stepIndex, currentStep, speechEnabled]);

  useEffect(() => {
    if (phase !== 'guide' || secondsLeft <= 0) return;
    const timer = window.setTimeout(() => {
      setSecondsLeft(previous => {
        const next = Math.max(0, previous - 1);
        if (next === 0) {
          try {
            const ctx = new AudioContext();
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.frequency.value = 880;
            gain.gain.value = 0.08;
            oscillator.start();
            oscillator.stop(ctx.currentTime + 0.16);
          } catch {
            // Audio cues are helpful but never required for the workflow.
          }
        }
        return next;
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [phase, secondsLeft]);

  useEffect(() => {
    if (phase !== 'mixing') return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  if (!method || !waterBody) return null;

  const nextGuideStep = () => {
    if (stepIndex < method.instructions.length - 1) setStepIndex(index => index + 1);
    else setPhase('readings');
  };

  const submitReadings = () => {
    const readings = method.parameters
      .map(parameter => parseReading(parameter.measurement, values[parameter.measurement] || ''))
      .filter((reading): reading is MeasurementReading => Boolean(reading));

    if (readings.length === 0) {
      setEntryError('Enter at least one reading. Use a range such as 80-120 when the colour is ambiguous.');
      return;
    }

    const result = assessChemistry(waterBody, state.domain.products, readings);
    const record = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      waterBodyId: waterBody.id,
      testMethodId: method.id,
      readings
    };

    updateState({
      ...state,
      domain: {
        ...state.domain,
        activeTestMethodId: method.id,
        waterTests: [record, ...state.domain.waterTests]
      }
    });
    void logEvent('water_test', { ...record, assessment: result });

    setAssessment(result);
    setEntryError('');
    setPhase('result');
  };

  const confirmDose = async () => {
    const action = assessment?.nextAction;
    if (!action || action.kind !== 'dose') return;

    setSavingDose(true);
    setControlError('');
    if (action.circulationRequired) {
      try {
        await spaApi.setFilter(true);
      } catch (err: any) {
        setControlError(`${err?.message || 'Could not start filtration automatically.'} Start filtration manually.`);
      }
    }

    const dose = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      waterBodyId: waterBody.id,
      productId: action.productId,
      amount: action.amount,
      unit: action.unit,
      reason: action.reason
    };

    updateState({
      ...state,
      domain: {
        ...state.domain,
        chemicalDoses: [dose, ...state.domain.chemicalDoses]
      }
    });
    void logEvent('chemical_dose', dose);

    setMixEndsAt(Date.now() + action.mixMinutes * 60_000);
    setClock(Date.now());
    setSavingDose(false);
    setPhase('mixing');
  };

  const restartForRetest = () => {
    setValues({});
    setAssessment(null);
    setEntryError('');
    setControlError('');
    setMixEndsAt(null);
    setStepIndex(0);
    setPhase('guide');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[96vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Water test</p>
            <h2 className="text-xl font-extrabold text-slate-900">{waterBody.name}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={speechEnabled ? 'Turn spoken cues off' : 'Turn spoken cues on'} onClick={() => setSpeechEnabled(enabled => !enabled)} className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-700">
              {speechEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <button type="button" aria-label="Close" onClick={onClose} className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-6 h-6" /></button>
          </div>
        </div>

        {phase === 'choose' && (
          <div className="p-5 space-y-5">
            <p className="text-slate-600 text-lg">Which test are you using?</p>
            <div className="space-y-3">
              {state.domain.testMethods.map(item => (
                <button key={item.id} type="button" onClick={() => setMethodId(item.id)} className={`w-full min-h-20 rounded-2xl border-2 p-4 text-left transition ${methodId === item.id ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                  <span className="block text-lg font-extrabold text-slate-900">{item.name}</span>
                  {item.description && <span className="block text-sm text-slate-500 mt-1">{item.description}</span>}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setStepIndex(0); setPhase('guide'); }} className="w-full min-h-16 rounded-2xl bg-indigo-600 text-white text-xl font-extrabold flex items-center justify-center gap-2 shadow-lg">
              Start test <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        )}

        {phase === 'guide' && currentStep && (
          <div className="p-5 min-h-[440px] flex flex-col">
            <div className="text-sm font-bold text-slate-400 mb-3">Step {stepIndex + 1} of {method.instructions.length}</div>
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
              {currentStep.durationSeconds ? (
                <div className="w-40 h-40 rounded-full bg-indigo-50 border-8 border-indigo-100 flex items-center justify-center mb-8"><span className="text-6xl font-black tabular-nums text-indigo-700">{secondsLeft}</span></div>
              ) : (
                <div className="w-28 h-28 rounded-full bg-indigo-50 flex items-center justify-center mb-8"><Timer className="w-14 h-14 text-indigo-600" /></div>
              )}
              <p className="text-3xl leading-tight font-black text-slate-900 max-w-sm">{currentStep.label}</p>
            </div>
            <button type="button" disabled={secondsLeft > 0} onClick={nextGuideStep} className="w-full min-h-16 rounded-2xl bg-indigo-600 disabled:bg-slate-200 disabled:text-slate-500 text-white text-xl font-extrabold">
              {secondsLeft > 0 ? `Wait ${secondsLeft}s` : stepIndex === method.instructions.length - 1 ? 'Enter readings' : 'Next'}
            </button>
          </div>
        )}

        {phase === 'readings' && (
          <div className="p-5 space-y-5">
            <div><h3 className="text-2xl font-black text-slate-900">Enter the colours you can read</h3><p className="text-slate-500 mt-1">Exact value or range - for example <strong>80-120</strong>.</p></div>
            <div className="space-y-4">
              {method.parameters.map(parameter => (
                <label key={parameter.measurement} className="block">
                  <span className="text-sm font-extrabold uppercase tracking-wider text-slate-500">{parameter.label}</span>
                  <input inputMode="decimal" autoComplete="off" value={values[parameter.measurement] || ''} onChange={event => setValues(current => ({ ...current, [parameter.measurement]: event.target.value }))} placeholder="Tap to enter" className="mt-2 w-full h-16 rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 text-2xl font-black text-slate-900 outline-none focus:border-indigo-500 focus:bg-white" />
                </label>
              ))}
            </div>
            {entryError && <div className="rounded-2xl bg-amber-50 text-amber-900 p-4 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /><span>{entryError}</span></div>}
            <button type="button" onClick={submitReadings} className="w-full min-h-16 rounded-2xl bg-indigo-600 text-white text-xl font-extrabold">Save & assess</button>
          </div>
        )}

        {phase === 'result' && assessment && (
          <div className="p-5 space-y-5">
            <div className={`rounded-3xl p-6 ${assessment.nextAction.kind === 'dose' ? 'bg-indigo-600 text-white' : assessment.nextAction.kind === 'retest' ? 'bg-amber-100 text-amber-950' : 'bg-emerald-100 text-emerald-950'}`}>
              <div className="flex items-start gap-3">
                {assessment.nextAction.kind === 'none' ? <CheckCircle2 className="w-8 h-8 shrink-0" /> : <AlertTriangle className="w-8 h-8 shrink-0" />}
                <div><h3 className="text-3xl leading-tight font-black">{actionTitle(assessment)}</h3><p className="mt-3 text-base font-medium opacity-90">{actionDetail(assessment)}</p></div>
              </div>
            </div>
            <div className="space-y-2">
              {assessment.findings.filter(finding => finding.severity !== 'info' || finding.code !== 'in_range').map((finding, index) => <div key={`${finding.code}-${index}`} className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700">{finding.message}</div>)}
            </div>
            <p className="text-sm text-slate-500">This recommendation is generated by the deterministic product/rules engine, not by the image-analysis model.</p>
            {assessment.nextAction.kind === 'dose' ? (
              <div className="space-y-3">
                <button type="button" disabled={savingDose} onClick={() => void confirmDose()} className="w-full min-h-16 rounded-2xl bg-slate-900 disabled:bg-slate-400 text-white text-xl font-extrabold">{savingDose ? 'Recording…' : "I've added it"}</button>
                <button type="button" onClick={onClose} className="w-full min-h-12 rounded-2xl text-slate-500 font-bold">Not now</button>
              </div>
            ) : (
              <button type="button" onClick={onClose} className="w-full min-h-16 rounded-2xl bg-slate-900 text-white text-xl font-extrabold">Done</button>
            )}
          </div>
        )}

        {phase === 'mixing' && assessment?.nextAction.kind === 'dose' && (
          <div className="p-5 min-h-[440px] flex flex-col items-center justify-center text-center space-y-6">
            <div className={`w-52 h-52 rounded-full flex items-center justify-center border-8 ${remainingMixSeconds > 0 ? 'bg-sky-50 border-sky-100 text-sky-700' : 'bg-emerald-50 border-emerald-100 text-emerald-700'}`}>
              {remainingMixSeconds > 0 ? <span className="text-5xl font-black tabular-nums">{formatCountdown(remainingMixSeconds)}</span> : <CheckCircle2 className="w-24 h-24" />}
            </div>
            <div>
              <h3 className="text-3xl font-black text-slate-900">{remainingMixSeconds > 0 ? 'Mixing' : 'Ready to retest'}</h3>
              <p className="mt-2 text-slate-500 text-lg">{remainingMixSeconds > 0 ? 'Filtration should remain on.' : 'Run the test again and the rules will adapt to the new reading.'}</p>
            </div>
            {controlError && <div className="rounded-2xl bg-amber-50 text-amber-900 p-4 flex gap-3 text-left"><AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /><span>{controlError}</span></div>}
            {remainingMixSeconds === 0 && <button type="button" onClick={restartForRetest} className="w-full min-h-16 rounded-2xl bg-indigo-600 text-white text-xl font-extrabold">Retest now</button>}
          </div>
        )}
      </div>
    </div>
  );
}
