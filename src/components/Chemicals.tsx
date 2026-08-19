import React, { useEffect, useMemo, useState } from 'react';
import { CameraCapture } from './CameraCapture';
import { GuidedWaterTest } from './GuidedWaterTest';
import type { AppState, ChemicalInventory } from '../types';
import type {
  ChemicalDoseEvent,
  ChemistryAssessment,
  DosingEpisode,
  DosingEpisodeStatus,
  DosingRecommendationSnapshot,
  MeasurementReading,
  WaterTestRecord
} from '../domain/models';
import { assessChemistry } from '../domain/chemistry';
import {
  AlertCircle,
  Beaker,
  Camera,
  CheckCircle2,
  CircleHelp,
  Clock,
  Droplets,
  Flame,
  Loader2,
  ScanBarcode
} from 'lucide-react';
import axios from 'axios';
import { logEvent } from '../lib/firebase';
import { spaApi } from '../lib/spaApi';
import { formatLogDateTime, formatLogTime } from '../lib/dateTime';

interface ChemicalsProps {
  state: AppState;
  updateState: (newState: AppState) => void;
}

const LABELS: Record<string, string> = {
  free_chlorine: 'FC',
  total_chlorine: 'TC',
  bromine: 'BR',
  ph: 'pH',
  total_alkalinity: 'TA',
  calcium_hardness: 'HARD',
  cyanuric_acid: 'CYA'
};

const TERMINAL_EPISODE_STATUSES: DosingEpisodeStatus[] = ['completed', 'abandoned'];
const CHEMISTRY_LEAD_MS = 45 * 60 * 1000;

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

function recommendationSnapshot(assessment: ChemistryAssessment): DosingRecommendationSnapshot {
  const action = assessment.nextAction;
  if (action.kind === 'dose') {
    return {
      kind: 'dose',
      reason: action.reason,
      productId: action.productId,
      productName: action.productName,
      amount: action.amount,
      unit: action.unit,
      measurement: action.measurement,
      mixMinutes: action.mixMinutes,
      circulationRequired: action.circulationRequired
    };
  }
  if (action.kind === 'retest') return { kind: 'retest', reason: action.reason };
  return { kind: 'none', reason: action.reason };
}

function statusForAssessment(assessment: ChemistryAssessment): DosingEpisodeStatus {
  if (assessment.nextAction.kind === 'dose') return 'awaiting_dose';
  if (assessment.nextAction.kind === 'retest') return 'awaiting_retest';
  return 'completed';
}

function isOpenEpisode(episode: DosingEpisode) {
  return !TERMINAL_EPISODE_STATUSES.includes(episode.status);
}

function effectiveStatus(episode: DosingEpisode | undefined, now: number): DosingEpisodeStatus | null {
  if (!episode) return null;
  if (episode.status === 'mixing' && episode.mixEndsAt && episode.mixEndsAt <= now) return 'awaiting_retest';
  return episode.status;
}

function StatusIcon({ status }: { status: DosingEpisodeStatus | null }) {
  if (status === 'completed') return <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
  if (status === 'mixing' || status === 'awaiting_retest') return <Clock className="w-5 h-5 text-sky-600" />;
  if (status === 'uncertain') return <CircleHelp className="w-5 h-5 text-amber-600" />;
  if (status === 'awaiting_dose' || status === 'advice') return <Droplets className="w-5 h-5 text-indigo-600" />;
  return <CircleHelp className="w-5 h-5 text-slate-400" />;
}

function statusLabel(status: DosingEpisodeStatus | null, episode?: DosingEpisode) {
  if (status === 'completed') return 'Water ready - episode complete';
  if (status === 'mixing') return 'Dose added - mixing';
  if (status === 'awaiting_retest') return 'Dose mixed - retest due';
  if (status === 'uncertain') return 'Dose outcome uncertain - retest before adding more';
  if (status === 'awaiting_dose') return episode?.doseResponse === 'not_added' ? 'Dose still due' : 'Dose recommended - not yet confirmed';
  if (status === 'advice') return 'Dosing advice available';
  return 'No dosing episode started';
}

function relevantHeatingSession(state: AppState, timestamp: number) {
  return [...(state.heatingSessions || [])]
    .filter(session => session.targetTime >= timestamp - (2 * 60 * 60 * 1000) && session.targetTime <= timestamp + (24 * 60 * 60 * 1000))
    .sort((a, b) => Math.abs(a.targetTime - timestamp) - Math.abs(b.targetTime - timestamp))[0];
}

function relevantBathingEpisode(state: AppState, timestamp: number) {
  return [...(state.domain.bathingEpisodes || [])]
    .filter(episode => episode.status === 'active' || (episode.endedAt && episode.endedAt >= timestamp - (2 * 60 * 60 * 1000)))
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))[0];
}

function purposeForEpisode(state: AppState, timestamp: number) {
  const bath = relevantBathingEpisode(state, timestamp);
  if (bath?.status === 'completed') return 'post_bath' as const;
  if (relevantHeatingSession(state, timestamp)) return 'pre_bath' as const;
  return 'routine' as const;
}

function assessmentForTest(state: AppState, test: WaterTestRecord | undefined) {
  if (!test) return null;
  if (test.assessment) return test.assessment;
  const waterBody = state.domain.waterBodies.find(item => item.id === test.waterBodyId);
  if (!waterBody) return null;
  return assessChemistry(waterBody, state.domain.products, test.readings);
}

export function Chemicals({ state, updateState }: ChemicalsProps) {
  const [showScanner, setShowScanner] = useState<'barcode' | 'test_strip' | null>(null);
  const [showGuidedTest, setShowGuidedTest] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const activeWaterBody = state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) ?? state.domain.waterBodies[0];
  const sortedTests = useMemo(() => [...state.domain.waterTests].sort((a, b) => b.timestamp - a.timestamp), [state.domain.waterTests]);
  const latestTest = sortedTests.find(test => test.waterBodyId === activeWaterBody?.id);
  const latestAssessment = assessmentForTest(state, latestTest);
  const upcomingHeating = relevantHeatingSession(state, now);

  const episodes = [...(state.domain.dosingEpisodes || [])].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const latestTestEpisode = latestTest
    ? episodes.find(episode => episode.id === latestTest.dosingEpisodeId || episode.testIds.includes(latestTest.id))
    : undefined;
  const activeEpisode = episodes.find(episode => episode.waterBodyId === activeWaterBody?.id && isOpenEpisode(episode));
  const currentEpisode = latestTestEpisode && isOpenEpisode(latestTestEpisode) ? latestTestEpisode : activeEpisode;
  const currentStatus = effectiveStatus(currentEpisode, now);

  useEffect(() => {
    if (currentStatus !== 'mixing') return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [currentStatus, currentEpisode?.mixEndsAt]);

  const syncChemistryState = (candidate: AppState) => {
    const previousTests = state.domain.waterTests;
    const previousDoses = state.domain.chemicalDoses;
    const addedTest = candidate.domain.waterTests.find(test => !previousTests.some(previous => previous.id === test.id));
    const addedDose = candidate.domain.chemicalDoses.find(dose => !previousDoses.some(previous => previous.id === dose.id));

    if (!addedTest && !addedDose) {
      updateState(candidate);
      return;
    }

    let nextDomain = {
      ...candidate.domain,
      waterTests: [...candidate.domain.waterTests],
      chemicalDoses: [...candidate.domain.chemicalDoses],
      dosingEpisodes: [...(candidate.domain.dosingEpisodes || [])],
      bathingEpisodes: [...(candidate.domain.bathingEpisodes || [])]
    };
    let nextEpisodes = [...nextDomain.dosingEpisodes];

    const findOpen = (waterBodyId: string) => nextEpisodes
      .filter(episode => episode.waterBodyId === waterBodyId && isOpenEpisode(episode))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
    const upsert = (episode: DosingEpisode) => {
      nextEpisodes = [episode, ...nextEpisodes.filter(item => item.id !== episode.id)];
    };

    if (addedTest) {
      const waterBody = nextDomain.waterBodies.find(item => item.id === addedTest.waterBodyId);
      if (waterBody) {
        const assessment = assessChemistry(waterBody, nextDomain.products, addedTest.readings);
        const status = statusForAssessment(assessment);
        const existing = findOpen(addedTest.waterBodyId);
        const heating = relevantHeatingSession(candidate, addedTest.timestamp);
        const bathing = relevantBathingEpisode(candidate, addedTest.timestamp);
        const episode: DosingEpisode = existing
          ? {
              ...existing,
              latestTestId: addedTest.id,
              testIds: Array.from(new Set([...existing.testIds, addedTest.id])),
              lastActivityAt: addedTest.timestamp,
              status,
              completedAt: status === 'completed' ? addedTest.timestamp : undefined,
              mixEndsAt: undefined,
              recommendation: recommendationSnapshot(assessment),
              doseResponse: undefined,
              heatingSessionId: existing.heatingSessionId ?? heating?.id,
              bathingEpisodeId: existing.bathingEpisodeId ?? bathing?.id
            }
          : {
              id: crypto.randomUUID(),
              waterBodyId: addedTest.waterBodyId,
              purpose: purposeForEpisode(candidate, addedTest.timestamp),
              startedAt: addedTest.timestamp,
              lastActivityAt: addedTest.timestamp,
              completedAt: status === 'completed' ? addedTest.timestamp : undefined,
              status,
              initialTestId: addedTest.id,
              latestTestId: addedTest.id,
              testIds: [addedTest.id],
              doseEventIds: [],
              heatingSessionId: heating?.id,
              bathingEpisodeId: bathing?.id,
              recommendation: recommendationSnapshot(assessment)
            };

        nextDomain.waterTests = nextDomain.waterTests.map(test => test.id === addedTest.id
          ? { ...test, dosingEpisodeId: episode.id, assessment }
          : test);
        upsert(episode);
      }
    }

    if (addedDose) {
      let episode = findOpen(addedDose.waterBodyId);
      const product = nextDomain.products.find(item => item.id === addedDose.productId);
      if (!episode) {
        episode = {
          id: crypto.randomUUID(),
          waterBodyId: addedDose.waterBodyId,
          purpose: 'corrective',
          startedAt: addedDose.timestamp,
          lastActivityAt: addedDose.timestamp,
          status: 'mixing',
          testIds: [],
          doseEventIds: [],
          heatingSessionId: relevantHeatingSession(candidate, addedDose.timestamp)?.id,
          bathingEpisodeId: relevantBathingEpisode(candidate, addedDose.timestamp)?.id
        };
      }
      const mixMinutes = product?.mixMinutes ?? episode.recommendation?.mixMinutes ?? 15;
      const patchedDose: ChemicalDoseEvent = {
        ...addedDose,
        dosingEpisodeId: episode.id,
        confirmation: addedDose.confirmation ?? 'confirmed_at_time',
        timePrecision: addedDose.timePrecision ?? 'exact'
      };
      nextDomain.chemicalDoses = nextDomain.chemicalDoses.map(dose => dose.id === addedDose.id ? patchedDose : dose);
      upsert({
        ...episode,
        lastActivityAt: addedDose.timestamp,
        status: 'mixing',
        completedAt: undefined,
        mixEndsAt: addedDose.timestamp + (mixMinutes * 60_000),
        doseEventIds: Array.from(new Set([...episode.doseEventIds, addedDose.id])),
        doseResponse: undefined
      });
    }

    nextDomain.dosingEpisodes = nextEpisodes;
    updateState({ ...candidate, domain: nextDomain });
  };

  const startEpisodeFromLatest = () => {
    if (!latestTest || !latestAssessment || !activeWaterBody) return;
    const timestamp = Date.now();
    const status = statusForAssessment(latestAssessment);
    const heating = relevantHeatingSession(state, timestamp);
    const bathing = relevantBathingEpisode(state, timestamp);
    const episode: DosingEpisode = {
      id: crypto.randomUUID(),
      waterBodyId: activeWaterBody.id,
      purpose: purposeForEpisode(state, timestamp),
      startedAt: latestTest.timestamp,
      lastActivityAt: timestamp,
      completedAt: status === 'completed' ? timestamp : undefined,
      status,
      initialTestId: latestTest.id,
      latestTestId: latestTest.id,
      testIds: [latestTest.id],
      doseEventIds: [],
      heatingSessionId: heating?.id,
      bathingEpisodeId: bathing?.id,
      recommendation: recommendationSnapshot(latestAssessment)
    };
    updateState({
      ...state,
      domain: {
        ...state.domain,
        waterTests: state.domain.waterTests.map(test => test.id === latestTest.id
          ? { ...test, dosingEpisodeId: episode.id, assessment: latestAssessment }
          : test),
        dosingEpisodes: [episode, ...(state.domain.dosingEpisodes || [])]
      }
    });
  };

  const updateEpisode = (episode: DosingEpisode) => {
    updateState({
      ...state,
      domain: {
        ...state.domain,
        dosingEpisodes: [episode, ...(state.domain.dosingEpisodes || []).filter(item => item.id !== episode.id)]
      }
    });
  };

  const confirmPendingDose = async (episode: DosingEpisode) => {
    const recommendation = episode.recommendation;
    if (!recommendation || recommendation.kind !== 'dose' || !recommendation.productId || typeof recommendation.amount !== 'number' || !recommendation.unit) return;
    const timestamp = Date.now();
    setError('');
    if (recommendation.circulationRequired) {
      try {
        await spaApi.setFilter(true);
      } catch (err: any) {
        setError(`${err?.message || 'Could not start filtration automatically.'} Dose recorded - start filtration manually.`);
      }
    }
    const dose: ChemicalDoseEvent = {
      id: crypto.randomUUID(),
      timestamp,
      waterBodyId: episode.waterBodyId,
      productId: recommendation.productId,
      amount: recommendation.amount,
      unit: recommendation.unit,
      reason: recommendation.reason,
      dosingEpisodeId: episode.id,
      confirmation: 'confirmed_later',
      timePrecision: 'approximate'
    };
    const mixMinutes = recommendation.mixMinutes ?? 15;
    const updatedEpisode: DosingEpisode = {
      ...episode,
      lastActivityAt: timestamp,
      status: 'mixing',
      mixEndsAt: timestamp + (mixMinutes * 60_000),
      doseEventIds: Array.from(new Set([...episode.doseEventIds, dose.id])),
      doseResponse: undefined
    };
    updateState({
      ...state,
      domain: {
        ...state.domain,
        chemicalDoses: [dose, ...state.domain.chemicalDoses],
        dosingEpisodes: [updatedEpisode, ...(state.domain.dosingEpisodes || []).filter(item => item.id !== episode.id)]
      }
    });
    void logEvent('chemical_dose', dose);
    setNow(timestamp);
  };

  const handleCapture = async (base64: string) => {
    setIsAnalyzing(true);
    setError('');
    const type = showScanner;
    setShowScanner(null);

    try {
      const res = await axios.post('/api/analyze-image', { imageBase64: base64, type });
      const data = res.data;

      if (type === 'barcode') {
        if (data.name) {
          const newItem: ChemicalInventory = {
            id: crypto.randomUUID(),
            name: data.name,
            ingredientType: data.ingredientType || 'Unknown',
            quantity: data.quantity || 'Unknown',
            addedAt: Date.now()
          };
          updateState({ ...state, inventory: [...state.inventory, newItem] });
        } else {
          setError('Could not identify the chemical from the image.');
        }
      } else if (type === 'test_strip') {
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
        const record: WaterTestRecord = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          waterBodyId: activeWaterBody.id,
          testMethodId: 'camera-estimate',
          readings
        };
        syncChemistryState({
          ...state,
          domain: { ...state.domain, waterTests: [record, ...state.domain.waterTests] }
        });
        void logEvent('water_test', { ...record, assessment });
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to analyze image');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const continueDosing = () => {
    if (!currentEpisode) {
      if (latestAssessment?.nextAction.kind === 'dose') startEpisodeFromLatest();
      else setShowGuidedTest(true);
      return;
    }
    const status = effectiveStatus(currentEpisode, Date.now());
    if (status === 'awaiting_retest' || status === 'uncertain') {
      setShowGuidedTest(true);
      return;
    }
    document.getElementById('episode-actions')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const mixMinutesLeft = currentEpisode?.mixEndsAt ? Math.max(0, Math.ceil((currentEpisode.mixEndsAt - now) / 60_000)) : 0;
  const chemistryReady = currentStatus === 'completed' || latestAssessment?.nextAction.kind === 'none';
  const chemistryDueAt = upcomingHeating ? upcomingHeating.targetTime - CHEMISTRY_LEAD_MS : null;
  const testCoversHeatingTarget = Boolean(latestTest && chemistryDueAt && latestTest.timestamp >= chemistryDueAt);

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-6">
      {showGuidedTest && (
        <GuidedWaterTest state={state} updateState={syncChemistryState} onClose={() => setShowGuidedTest(false)} />
      )}

      {showScanner && (
        <CameraCapture
          title={showScanner === 'barcode' ? 'Scan Chemical' : 'Camera Estimate'}
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
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <section id="episode-actions" className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-indigo-500">Current water care</p>
            <h2 className="text-3xl font-black text-slate-900 mt-1">{latestTest ? 'Latest test' : 'Test before dosing'}</h2>
            {latestTest && <p className="text-sm font-bold text-slate-500 mt-1">{formatLogDateTime(latestTest.timestamp, state.config.timeFormat)}</p>}
          </div>
          <StatusIcon status={currentStatus} />
        </div>

        {upcomingHeating && (
          <div className="rounded-2xl bg-orange-50 border border-orange-100 p-4 flex gap-3">
            <Flame className="w-6 h-6 text-orange-600 shrink-0" />
            <div>
              <p className="font-black text-orange-950">{upcomingHeating.targetTemp.toFixed(0)}°C target for {formatLogTime(upcomingHeating.targetTime, state.config.timeFormat)}</p>
              <p className="text-sm text-orange-800 mt-0.5">
                {chemistryReady && testCoversHeatingTarget
                  ? 'Chemistry is ready for this heating target.'
                  : chemistryDueAt && now >= chemistryDueAt
                    ? 'Chemistry check is due now so dosing can finish before bathing.'
                    : chemistryDueAt
                      ? `Aim to test by ${formatLogTime(chemistryDueAt, state.config.timeFormat)} so there is time to dose and retest.`
                      : 'Coordinate testing and dosing with this heating target.'}
              </p>
            </div>
          </div>
        )}

        {latestTest ? (
          <>
            <div className="flex flex-wrap gap-2">
              {latestTest.readings.map(reading => (
                <span key={reading.measurement} className="rounded-full border-2 border-slate-200 bg-slate-50 px-4 py-2 text-base font-black text-slate-900 tabular-nums">
                  {LABELS[reading.measurement] || reading.measurement}: {readingText(reading)}
                </span>
              ))}
            </div>

            {latestAssessment && (
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Advice</p>
                <p className="text-xl font-black text-slate-900 mt-1">{actionText(latestAssessment)}</p>
                <p className="text-sm text-slate-600 mt-1">{latestAssessment.nextAction.reason}</p>
              </div>
            )}

            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 space-y-3">
              <div className="flex items-center gap-2 font-extrabold text-slate-800"><StatusIcon status={currentStatus} /><span>{statusLabel(currentStatus, currentEpisode)}</span></div>

              {!currentEpisode && latestAssessment?.nextAction.kind === 'dose' && (
                <button type="button" onClick={startEpisodeFromLatest} className="w-full min-h-14 rounded-2xl bg-indigo-600 text-white text-lg font-black">Start dosing</button>
              )}

              {currentEpisode && currentStatus === 'awaiting_dose' && currentEpisode.recommendation?.kind === 'dose' && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">{currentEpisode.doseResponse === 'not_added' ? 'The dose is still due. Add it when ready, then confirm below.' : 'After adding the recommended chemical, tell Spararama what happened.'}</p>
                  <button type="button" onClick={() => void confirmPendingDose(currentEpisode)} className="w-full min-h-14 rounded-2xl bg-slate-900 text-white text-lg font-black">I’ve added it</button>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => updateEpisode({ ...currentEpisode, doseResponse: 'not_added', lastActivityAt: Date.now() })} className="min-h-12 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold">Didn't add it</button>
                    <button type="button" onClick={() => updateEpisode({ ...currentEpisode, status: 'uncertain', doseResponse: 'uncertain', lastActivityAt: Date.now() })} className="min-h-12 rounded-xl bg-amber-100 text-amber-950 font-bold">Not sure</button>
                  </div>
                </div>
              )}

              {currentEpisode && currentStatus === 'mixing' && (
                <div className="rounded-2xl bg-sky-50 border border-sky-100 p-4 text-center">
                  <p className="text-3xl font-black text-sky-800">{mixMinutesLeft} min</p>
                  <p className="text-sm font-bold text-sky-700 mt-1">Keep circulating, then retest.</p>
                </div>
              )}

              {currentEpisode && (currentStatus === 'awaiting_retest' || currentStatus === 'uncertain') && (
                <button type="button" onClick={() => setShowGuidedTest(true)} className="w-full min-h-14 rounded-2xl bg-indigo-600 text-white text-lg font-black">Retest now</button>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-5 text-slate-600">No structured water test yet. Start with a test; dosing advice will follow from the result.</div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setShowGuidedTest(true)} className="min-h-20 rounded-3xl bg-indigo-600 text-white text-lg sm:text-xl font-black flex flex-col items-center justify-center gap-1 shadow-sm">
          <Beaker className="w-7 h-7" /> Test water
        </button>
        <button
          type="button"
          disabled={!currentEpisode && latestAssessment?.nextAction.kind !== 'dose'}
          onClick={continueDosing}
          className="min-h-20 rounded-3xl bg-slate-900 disabled:bg-slate-200 disabled:text-slate-400 text-white text-lg sm:text-xl font-black flex flex-col items-center justify-center gap-1 shadow-sm"
        >
          <Droplets className="w-7 h-7" />
          {currentStatus === 'mixing' ? 'Dosing in progress' : currentStatus === 'awaiting_retest' || currentStatus === 'uncertain' ? 'Continue dosing' : currentEpisode || latestAssessment?.nextAction.kind === 'dose' ? 'Continue dosing' : 'No dosing due'}
        </button>
        <button type="button" onClick={() => setShowScanner('test_strip')} className="col-span-2 min-h-11 rounded-xl text-slate-500 font-bold flex items-center justify-center gap-2">
          <Camera className="w-5 h-5" /> Camera estimate
        </button>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-900">Recent Water Tests</h2>
          <span className="text-xs font-bold text-slate-400">{state.domain.waterTests.length} stored</span>
        </div>

        {sortedTests.length === 0 ? (
          <div className="text-center p-8 bg-slate-50 rounded-2xl border border-slate-100 text-slate-500">No structured water tests yet.</div>
        ) : (
          <div className="space-y-3">
            {sortedTests.slice(0, 6).map(test => {
              const assessment = assessmentForTest(state, test);
              const episode = episodes.find(item => item.id === test.dosingEpisodeId || item.testIds.includes(test.id));
              const status = effectiveStatus(episode, now);
              return (
                <div key={test.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="text-sm font-bold text-slate-500">{formatLogDateTime(test.timestamp, state.config.timeFormat)}</span>
                    {episode && <span className="flex items-center gap-1.5 text-xs font-black text-slate-600"><StatusIcon status={status} />{statusLabel(status, episode)}</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {test.readings.map(reading => (
                      <span key={reading.measurement} className="rounded-full border-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-900 tabular-nums">
                        {LABELS[reading.measurement] || reading.measurement}: {readingText(reading)}
                      </span>
                    ))}
                  </div>
                  {assessment && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Advice after this test</p>
                      <p className="text-sm font-extrabold text-slate-800 mt-1">{actionText(assessment)}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <details className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <summary className="cursor-pointer list-none p-4 flex items-center justify-between gap-3 font-extrabold text-slate-800">
          <span>Products & stock <span className="text-slate-400">({state.inventory.length})</span></span>
          <ScanBarcode className="w-5 h-5 text-slate-400" />
        </summary>
        <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-4">
          <button type="button" onClick={() => setShowScanner('barcode')} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium">
            <ScanBarcode className="w-4 h-4" /> Scan chemical
          </button>
          {state.inventory.length === 0 ? (
            <div className="text-center p-6 bg-slate-50 rounded-2xl border border-slate-100 text-slate-500">No chemicals in inventory yet.</div>
          ) : (
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
              {state.inventory.map(item => (
                <div key={item.id} className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-slate-900">{item.name}</p>
                    <p className="text-sm text-slate-500">{item.ingredientType} · {item.quantity}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
