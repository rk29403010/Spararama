import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Volume2, VolumeX, X } from 'lucide-react';
import type { AppState } from '../types';
import type { ChemistryAssessment, MeasurementReading, TestMethodProfile } from '../domain/models';
import { assessChemistry } from '../domain/chemistry';
import { logEvent } from '../lib/firebase';
import { spaApi } from '../lib/spaApi';
import { WaterTestReadingEntry } from './WaterTestReadingEntry';

interface GuidedWaterTestProps {
  state: AppState;
  updateState: (state: AppState) => void;
  onClose: () => void;
}

type Phase = 'choose' | 'prepare' | 'guide' | 'readings' | 'result' | 'mixing';
type GuideVisual = 'ready' | 'quick-dip' | 'enter' | 'move' | 'remove' | 'hold';

interface GuideStep {
  id: string;
  label: string;
  detail?: string;
  durationMs: number;
  visual: GuideVisual;
  spokenText?: string;
  showCountdown?: boolean;
  cueAtEnd?: boolean;
}

const ELECTRONIC_METHOD: TestMethodProfile = {
  id: 'electronic',
  name: 'Electronic tester',
  description: 'Digital tester, probe or photometer.',
  instructions: [],
  parameters: [
    { measurement: 'free_chlorine', label: 'Free chlorine' },
    { measurement: 'total_chlorine', label: 'Total chlorine' },
    { measurement: 'ph', label: 'pH' },
    { measurement: 'total_alkalinity', label: 'Total alkalinity' },
    { measurement: 'calcium_hardness', label: 'Total hardness' },
    { measurement: 'cyanuric_acid', label: 'Cyanuric acid' }
  ],
  notes: 'Enter only the measurements reported by the electronic tester. Follow that tester’s own sampling, reagent and calibration instructions.'
};

const PAD_CLASSES = [
  'bg-fuchsia-300',
  'bg-amber-300',
  'bg-lime-300',
  'bg-cyan-300',
  'bg-violet-300',
  'bg-rose-300',
  'bg-emerald-300'
];

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

function isElectronic(methodId: string) {
  return methodId === ELECTRONIC_METHOD.id;
}

function padCountForMethod(methodId: string) {
  return methodId === 'current-3-way' ? 3 : methodId === 'current-7-way' ? 7 : 0;
}

function displayNameForMethod(methodId: string, fallback: string) {
  if (methodId === 'current-3-way') return '3-in-1';
  if (methodId === 'current-7-way') return '7-in-1';
  if (methodId === ELECTRONIC_METHOD.id) return 'Electronic';
  return fallback;
}

function guideStepsForMethod(method: TestMethodProfile): GuideStep[] {
  const waitSeconds = method.readAfterSeconds ?? (method.id === 'current-7-way' ? 15 : 5);

  if (method.id === 'current-3-way') {
    return [
      {
        id: 'ready',
        label: 'Put the phone down',
        detail: 'Strip in hand. Get ready to dip.',
        durationMs: 2600,
        visual: 'ready',
        spokenText: 'Get ready.'
      },
      {
        id: 'dip',
        label: 'DIP NOW',
        detail: 'Straight in and straight out.',
        durationMs: 2200,
        visual: 'quick-dip',
        spokenText: 'Dip now.',
        cueAtEnd: true
      },
      {
        id: 'hold',
        label: 'Hold it level',
        detail: 'Pads facing up.',
        durationMs: waitSeconds * 1000,
        visual: 'hold',
        spokenText: 'Hold the strip level.',
        showCountdown: true,
        cueAtEnd: true
      }
    ];
  }

  if (method.id === 'current-7-way') {
    return [
      {
        id: 'ready',
        label: 'Put the phone down',
        detail: 'Strip in hand. Get ready to dip.',
        durationMs: 2600,
        visual: 'ready',
        spokenText: 'Get ready.'
      },
      {
        id: 'dip',
        label: 'DIP NOW',
        detail: 'Put the pads under the water.',
        durationMs: 650,
        visual: 'enter',
        spokenText: 'Dip now.'
      },
      {
        id: 'move',
        label: 'MOVE IT AROUND',
        detail: 'Keep the strip moving in the water.',
        durationMs: 1200,
        visual: 'move',
        spokenText: 'Keep moving.'
      },
      {
        id: 'remove',
        label: 'REMOVE STRIP',
        detail: 'Bring it straight out and keep it level.',
        durationMs: 650,
        visual: 'remove',
        spokenText: 'Remove strip.',
        cueAtEnd: true
      },
      {
        id: 'hold',
        label: 'Hold it level',
        detail: 'Pads facing up.',
        durationMs: waitSeconds * 1000,
        visual: 'hold',
        spokenText: 'Hold the strip level.',
        showCountdown: true,
        cueAtEnd: true
      }
    ];
  }

  return [];
}

function StripBody({ padCount, horizontal = false }: { padCount: number; horizontal?: boolean }) {
  return (
    <div className={horizontal ? 'rotate-90' : ''}>
      <div className="relative w-12 h-40 rounded-lg border-2 border-slate-300 bg-white shadow-lg flex flex-col items-center pt-4 gap-1.5">
        {Array.from({ length: padCount }).map((_, index) => (
          <span
            key={index}
            className={`block w-7 rounded-sm border border-white/80 ${padCount > 5 ? 'h-3.5' : 'h-5'} ${PAD_CLASSES[index % PAD_CLASSES.length]}`}
          />
        ))}
        <span className="absolute bottom-3 w-5 h-1 rounded-full bg-slate-200" />
      </div>
    </div>
  );
}

function WaterStage({ padCount, visual }: { padCount: number; visual: GuideVisual }) {
  const horizontal = visual === 'hold';
  const animationClass =
    visual === 'quick-dip' ? 'spa-strip-quick-dip' :
    visual === 'enter' ? 'spa-strip-enter' :
    visual === 'move' ? 'spa-strip-move' :
    visual === 'remove' ? 'spa-strip-remove' :
    '';

  if (visual === 'ready') {
    return (
      <div className="relative h-56 w-full max-w-sm flex items-center justify-center overflow-hidden">
        <div className="absolute inset-x-7 bottom-4 h-24 rounded-[50%] border-8 border-slate-300 bg-sky-100 shadow-inner" />
        <div className="absolute left-8 top-12 w-20 h-12 rounded-xl border-4 border-slate-500 bg-slate-800 shadow-lg -rotate-6">
          <div className="absolute inset-1.5 rounded-md bg-slate-200" />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-3xl font-black text-indigo-500">↓</span>
        </div>
        <div className="absolute right-16 top-7 scale-75">
          <StripBody padCount={padCount} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-64 w-full max-w-sm overflow-hidden rounded-[2rem] bg-gradient-to-b from-sky-50 to-white border border-sky-100">
      <div className="absolute left-1/2 top-3 -translate-x-1/2 z-20">
        <div className={horizontal ? '' : animationClass}>
          <StripBody padCount={padCount} horizontal={horizontal} />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-28 bg-sky-200/80 border-t-4 border-sky-300/80">
        <div className="spa-water-wave absolute -top-3 -left-8 w-[125%] h-7 rounded-[50%] bg-sky-200/90" />
        <div className="absolute inset-x-0 top-6 text-center text-xs font-black uppercase tracking-[0.3em] text-sky-700/60">SPA WATER</div>
      </div>
    </div>
  );
}

function StripChoiceGraphic({ padCount }: { padCount: number }) {
  return (
    <div className="h-32 flex items-center justify-center">
      <div className="scale-75 origin-center">
        <StripBody padCount={padCount} />
      </div>
    </div>
  );
}

function ElectronicTesterGraphic({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`relative flex items-center justify-center ${compact ? 'h-32' : 'h-56'}`}>
      <div className={`${compact ? 'w-24 h-28' : 'w-36 h-44'} rounded-[1.6rem] border-4 border-slate-700 bg-slate-800 shadow-xl p-3 flex flex-col items-center`}>
        <div className="w-full rounded-lg bg-emerald-100 border-2 border-emerald-300 px-2 py-2 text-center font-mono font-black text-emerald-950 tracking-wider">
          {compact ? '7.4' : '7.40'}
        </div>
        <div className="mt-4 w-9 h-9 rounded-full border-4 border-slate-500 bg-slate-700" />
        <div className="mt-3 w-12 h-2 rounded-full bg-slate-600" />
        <div className="mt-2 w-12 h-2 rounded-full bg-slate-600" />
      </div>
      {!compact && <div className="absolute top-[10.5rem] w-3 h-16 rounded-b-full bg-slate-500 border-x-2 border-slate-600" />}
    </div>
  );
}

function TestChoiceGraphic({ methodId }: { methodId: string }) {
  const padCount = padCountForMethod(methodId);
  if (padCount) return <StripChoiceGraphic padCount={padCount} />;
  return <ElectronicTesterGraphic compact />;
}

function SpaOpenGraphic() {
  return (
    <div className="relative w-20 h-16 mx-auto">
      <div className="absolute inset-x-0 bottom-0 h-10 rounded-[50%] border-4 border-slate-300 bg-sky-200" />
      <div className="absolute left-2 right-2 top-0 h-6 rounded-t-full border-4 border-b-0 border-slate-300 bg-white -rotate-6 origin-bottom-left" />
    </div>
  );
}

function ChartBottleGraphic() {
  return (
    <div className="relative w-16 h-20 mx-auto rounded-xl border-4 border-slate-300 bg-white shadow-sm pt-5 px-2">
      <div className="absolute -top-3 left-3 right-3 h-5 rounded-md bg-slate-400" />
      <div className="grid grid-cols-3 gap-1">
        {PAD_CLASSES.slice(0, 6).map((padClass, index) => <span key={index} className={`h-3 rounded-sm ${padClass}`} />)}
      </div>
      <div className="mt-2 h-1.5 rounded bg-slate-200" />
      <div className="mt-1 h-1.5 rounded bg-slate-200 w-2/3" />
    </div>
  );
}

function PreparationVisual({ methodId }: { methodId: string }) {
  const electronic = isElectronic(methodId);
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-center flex flex-col justify-between min-h-32">
        <div className="scale-75 -my-4"><TestChoiceGraphic methodId={methodId} /></div>
        <span className="text-xs font-black text-slate-700">{electronic ? 'Tester ready' : 'Strip ready'}</span>
      </div>
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-center flex flex-col justify-between min-h-32">
        <div className="flex-1 flex items-center justify-center"><SpaOpenGraphic /></div>
        <span className="text-xs font-black text-slate-700">Spa open</span>
      </div>
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-center flex flex-col justify-between min-h-32">
        <div className="flex-1 flex items-center justify-center"><ChartBottleGraphic /></div>
        <span className="text-xs font-black text-slate-700">{electronic ? 'Instructions ready' : 'Bottle / chart'}</span>
      </div>
    </div>
  );
}

function ReadingStripVisual({ padCount }: { padCount: number }) {
  return (
    <div className="relative h-44 rounded-3xl bg-slate-50 border border-slate-200 overflow-hidden flex items-center justify-center gap-7">
      <div className="relative w-44 h-28 flex items-center justify-center">
        <StripBody padCount={padCount} horizontal />
      </div>
      <ChartBottleGraphic />
      <div className="absolute bottom-2 inset-x-0 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">Diagram only - use your own colour chart</div>
    </div>
  );
}

function playCue() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.value = 880;
    gain.gain.value = 0.07;
    oscillator.start();
    oscillator.stop(context.currentTime + 0.14);
  } catch {
    // Visual guidance remains complete if audio is unavailable.
  }
}

export function GuidedWaterTest({ state, updateState, onClose }: GuidedWaterTestProps) {
  const availableMethods = useMemo(() => {
    const knownStrips = ['current-3-way', 'current-7-way']
      .map(id => state.domain.testMethods.find(item => item.id === id))
      .filter((item): item is TestMethodProfile => Boolean(item));
    return [...knownStrips, ELECTRONIC_METHOD];
  }, [state.domain.testMethods]);

  const initialMethodId = availableMethods.some(item => item.id === state.domain.activeTestMethodId)
    ? state.domain.activeTestMethodId
    : (availableMethods[1]?.id ?? availableMethods[0]?.id ?? ELECTRONIC_METHOD.id);

  const [phase, setPhase] = useState<Phase>('choose');
  const [methodId, setMethodId] = useState(initialMethodId);
  const [stepIndex, setStepIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [assessment, setAssessment] = useState<ChemistryAssessment | null>(null);
  const [entryError, setEntryError] = useState('');
  const [controlError, setControlError] = useState('');
  const [mixEndsAt, setMixEndsAt] = useState<number | null>(null);
  const [stripStartedAt, setStripStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [savingDose, setSavingDose] = useState(false);

  const method = useMemo(
    () => (availableMethods.find(item => item.id === methodId) ?? availableMethods[0] ?? ELECTRONIC_METHOD),
    [availableMethods, methodId]
  );
  const waterBody = useMemo(
    () => (state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) ?? state.domain.waterBodies[0])!,
    [state.domain.waterBodies, state.domain.activeWaterBodyId]
  );
  const guideSteps = useMemo(() => guideStepsForMethod(method), [method]);
  const currentStep = guideSteps[stepIndex];
  const padCount = padCountForMethod(method.id);
  const remainingMixSeconds = mixEndsAt ? Math.max(0, Math.ceil((mixEndsAt - clock) / 1000)) : 0;
  const readDeadlineAt = stripStartedAt && method.readBeforeSeconds ? stripStartedAt + method.readBeforeSeconds * 1000 : null;
  const readRemainingSeconds = readDeadlineAt ? Math.max(0, Math.ceil((readDeadlineAt - clock) / 1000)) : null;

  const speak = (text?: string) => {
    if (!speechEnabled || !text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  };

  useEffect(() => {
    if (phase !== 'guide' || !currentStep) return;

    if (currentStep.id === 'dip') {
      setStripStartedAt(previous => previous ?? Date.now());
    }

    speak(currentStep.spokenText);
    const endAt = Date.now() + currentStep.durationMs;
    setSecondsLeft(Math.max(1, Math.ceil(currentStep.durationMs / 1000)));

    const ticker = window.setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((endAt - Date.now()) / 1000)));
    }, 150);

    const timer = window.setTimeout(() => {
      if (currentStep.cueAtEnd) playCue();
      if (stepIndex < guideSteps.length - 1) {
        setStepIndex(stepIndex + 1);
      } else {
        setClock(Date.now());
        setPhase('readings');
      }
    }, currentStep.durationMs);

    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(timer);
    };
  }, [phase, stepIndex, currentStep, guideSteps.length]);

  useEffect(() => {
    if (phase !== 'readings') return;
    playCue();
    speak(isElectronic(method.id) ? 'Enter the readings shown by your tester.' : 'Read the strip now.');
  }, [phase]);

  useEffect(() => {
    if (phase !== 'mixing' && phase !== 'readings') return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  if (!waterBody) return null;

  const startPreparedTest = () => {
    setEntryError('');
    setAssessment(null);
    setStripStartedAt(null);
    setStepIndex(0);
    if (isElectronic(method.id)) {
      setClock(Date.now());
      setPhase('readings');
    } else {
      setPhase('guide');
    }
  };

  const submitReadings = (readings: MeasurementReading[]) => {
    if (readings.length === 0) {
      setEntryError('Record at least one reading.');
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
    setAssessment(null);
    setEntryError('');
    setControlError('');
    setMixEndsAt(null);
    setStripStartedAt(null);
    setStepIndex(0);
    setPhase('prepare');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[96vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Water test</p>
            <h2 className="text-xl font-extrabold text-slate-900">{waterBody.name}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={speechEnabled ? 'Turn spoken cues off' : 'Turn spoken cues on'} onClick={() => setSpeechEnabled(enabled => !enabled)} className={`w-11 h-11 rounded-full flex items-center justify-center ${speechEnabled ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
              {speechEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <button type="button" aria-label="Close" onClick={onClose} className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center"><X className="w-6 h-6" /></button>
          </div>
        </div>

        {phase === 'choose' && (
          <div className="p-5 space-y-5">
            <div>
              <h3 className="text-2xl font-black text-slate-900">How are you testing?</h3>
              <p className="text-slate-500 mt-1">Pick the test in your hand.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {availableMethods.map(item => {
                const selected = methodId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMethodId(item.id)}
                    aria-pressed={selected}
                    className={`relative rounded-3xl border-2 p-3 text-center transition duration-150 overflow-hidden ${selected ? 'border-indigo-600 bg-indigo-50 shadow-lg scale-[1.02]' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                  >
                    {selected && <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center"><CheckCircle2 className="w-5 h-5" /></span>}
                    <TestChoiceGraphic methodId={item.id} />
                    <span className="block text-base sm:text-lg font-black text-slate-900 -mt-1">{displayNameForMethod(item.id, item.name)}</span>
                    <span className="block text-[11px] sm:text-xs leading-tight text-slate-500 mt-1">{item.id === 'current-3-way' ? 'Quick strip' : item.id === 'current-7-way' ? 'Full strip' : 'Digital reading'}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => setPhase('prepare')} className="w-full min-h-16 rounded-2xl bg-indigo-600 text-white text-xl font-extrabold flex items-center justify-center gap-2 shadow-lg">
              Continue <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        )}

        {phase === 'prepare' && (
          <div className="p-5 space-y-5">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-indigo-500">Before you start</p>
              <h3 className="text-3xl font-black text-slate-900 mt-1">Get everything ready</h3>
            </div>
            <PreparationVisual methodId={method.id} />
            <div className="rounded-3xl bg-indigo-50 border border-indigo-100 p-5 text-indigo-950">
              {isElectronic(method.id) ? (
                <>
                  <p className="font-black text-lg">Use your tester’s own procedure.</p>
                  <p className="mt-1 text-sm leading-relaxed text-indigo-800">Electronic testers vary. Prepare, calibrate and use reagents exactly as its manufacturer specifies, then enter the values it displays.</p>
                </>
              ) : (
                <>
                  <p className="font-black text-lg">After Ready, you won’t need to touch the phone.</p>
                  <p className="mt-1 text-sm leading-relaxed text-indigo-800">Put it down where you can see it. We’ll show when to dip, remove, hold and read the strip.</p>
                </>
              )}
            </div>
            <button type="button" onClick={startPreparedTest} className="w-full min-h-16 rounded-2xl bg-indigo-600 text-white text-xl font-extrabold shadow-lg">
              {isElectronic(method.id) ? 'Enter tester readings' : 'I’m ready'}
            </button>
            <button type="button" onClick={() => setPhase('choose')} className="w-full min-h-11 text-slate-500 font-bold">Change test</button>
          </div>
        )}

        {phase === 'guide' && currentStep && (
          <div className="p-5 min-h-[560px] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-black uppercase tracking-wider text-slate-400">Hands free</span>
              <div className="flex gap-1.5" aria-label={`Step ${stepIndex + 1} of ${guideSteps.length}`}>
                {guideSteps.map((step, index) => <span key={step.id} className={`h-2 rounded-full transition-all ${index === stepIndex ? 'w-8 bg-indigo-600' : index < stepIndex ? 'w-4 bg-indigo-200' : 'w-4 bg-slate-200'}`} />)}
              </div>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
              <WaterStage padCount={padCount} visual={currentStep.visual} />
              <div className="mt-5 min-h-28 flex flex-col items-center">
                <h3 className={`leading-none font-black tracking-tight ${currentStep.id === 'dip' || currentStep.id === 'move' || currentStep.id === 'remove' ? 'text-4xl text-indigo-700' : 'text-3xl text-slate-900'}`}>{currentStep.label}</h3>
                {currentStep.detail && <p className="mt-2 text-lg text-slate-500 font-semibold">{currentStep.detail}</p>}
                {currentStep.showCountdown && <div className="mt-4 text-5xl font-black tabular-nums text-indigo-700">{secondsLeft}</div>}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-100 px-4 py-3 text-center text-sm font-bold text-slate-500">No buttons needed - the next instruction will appear automatically.</div>
          </div>
        )}

        {phase === 'readings' && (
          <div className="p-5 space-y-5">
            {isElectronic(method.id) ? (
              <div className="rounded-3xl bg-slate-900 text-white p-5 text-center">
                <ElectronicTesterGraphic />
                <h3 className="text-3xl font-black -mt-2">Read your tester</h3>
                <p className="text-slate-300 mt-2">Set only the measurements your device actually reports.</p>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-indigo-500">Now</p>
                  <h3 className="text-4xl font-black text-slate-900">READ NOW</h3>
                  <p className="text-slate-500 mt-1">Keep the strip level and compare it with your bottle chart.</p>
                </div>
                <ReadingStripVisual padCount={padCount} />
                {readRemainingSeconds !== null && readRemainingSeconds > 0 ? (
                  <div className="rounded-2xl bg-sky-50 border border-sky-100 px-4 py-3 flex items-center justify-between gap-3">
                    <span className="font-bold text-sky-900">Discard strip in</span>
                    <span className="text-2xl font-black tabular-nums text-sky-700">{readRemainingSeconds}s</span>
                  </div>
                ) : readRemainingSeconds === 0 ? (
                  <div className="rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 p-4 flex gap-3">
                    <AlertTriangle className="w-6 h-6 shrink-0" />
                    <div><strong className="block">Discard the strip</strong><span className="text-sm">The timed reading window has ended, so the colours may have changed. You can still enter what you saw.</span></div>
                  </div>
                ) : null}
              </>
            )}

            <WaterTestReadingEntry method={method} onSubmit={submitReadings} />
            {entryError && <div className="rounded-2xl bg-amber-50 text-amber-900 p-4 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /><span>{entryError}</span></div>}
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
