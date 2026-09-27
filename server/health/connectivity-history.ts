import fs from 'node:fs/promises';
import path from 'node:path';

export interface SpaConnectivityEventRecord {
  at: number;
  state: 'online' | 'suspect' | 'offline';
  source?: string;
  transport?: string;
  contactFailureCount?: number;
  lastSuccessfulContactAt?: number;
  suspectSince?: number;
  thresholdMs?: number;
  detail?: string;
}

export interface SpaConnectivityEpisode {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  reachedOffline: boolean;
  alertThresholdMs: number;
  failureObservations: number;
  sources: string[];
  transports: string[];
  maxContactFailureCount: number;
  heatingThreatened: boolean;
  deliverySuppressed: boolean;
  lastSuccessfulContactAt?: number;
}

export interface SpaConnectivityLearningProfile {
  episodeCount: number;
  transientSampleCount: number;
  learnedIdleOfflineAfterMs: number;
  transientP90Ms?: number;
  updatedAt?: number;
}

const MAX_EPISODES_TO_READ = 500;
const MAX_TRANSIENT_DURATION_MS = 10 * 60_000;
const MAX_LEARNED_IDLE_GRACE_MS = 8 * 60_000;
const MIN_LEARNING_SAMPLES = 4;
const EXTRA_GRACE_MS = 60_000;
const ROUND_TO_MS = 30_000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

export class SpaConnectivityHistoryStore {
  readonly baseDir: string;
  readonly eventsPath: string;
  readonly episodesPath: string;
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(baseDir = process.env.SPA_HEALTH_DIR || path.join(process.cwd(), 'data', 'spa-health')) {
    this.baseDir = baseDir;
    this.eventsPath = path.join(baseDir, 'events.ndjson');
    this.episodesPath = path.join(baseDir, 'episodes.ndjson');
  }

  appendEvent(event: SpaConnectivityEventRecord) {
    return this.appendText(this.eventsPath, `${JSON.stringify(event)}\n`);
  }

  appendEpisode(episode: SpaConnectivityEpisode) {
    return this.appendText(this.episodesPath, `${JSON.stringify(episode)}\n`);
  }

  async listRecentEpisodes(limit = 100): Promise<SpaConnectivityEpisode[]> {
    const safeLimit = clamp(Math.floor(limit) || 100, 1, MAX_EPISODES_TO_READ);
    try {
      const text = await fs.readFile(this.episodesPath, 'utf8');
      const episodes: SpaConnectivityEpisode[] = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const episode = JSON.parse(line) as SpaConnectivityEpisode;
          if (
            Number.isFinite(episode?.startedAt)
            && Number.isFinite(episode?.endedAt)
            && Number.isFinite(episode?.durationMs)
          ) episodes.push(episode);
        } catch {
          // Keep the rest of the history useful if one line is damaged.
        }
      }
      return episodes.sort((a, b) => b.endedAt - a.endedAt).slice(0, safeLimit);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async learningProfile(baseOfflineAfterMs: number): Promise<SpaConnectivityLearningProfile> {
    const episodes = await this.listRecentEpisodes(MAX_EPISODES_TO_READ);
    const candidates = episodes
      .filter(episode =>
        episode.durationMs > 0
        && episode.durationMs <= MAX_TRANSIENT_DURATION_MS
        && !episode.heatingThreatened
        && !episode.deliverySuppressed
      )
      .map(episode => episode.durationMs)
      .sort((a, b) => a - b);

    let learnedIdleOfflineAfterMs = baseOfflineAfterMs;
    let transientP90Ms: number | undefined;
    if (candidates.length >= MIN_LEARNING_SAMPLES) {
      const index = Math.min(candidates.length - 1, Math.ceil(candidates.length * 0.9) - 1);
      transientP90Ms = candidates[index];
      learnedIdleOfflineAfterMs = clamp(
        roundUp(transientP90Ms + EXTRA_GRACE_MS, ROUND_TO_MS),
        baseOfflineAfterMs,
        MAX_LEARNED_IDLE_GRACE_MS
      );
    }

    return {
      episodeCount: episodes.length,
      transientSampleCount: candidates.length,
      learnedIdleOfflineAfterMs,
      transientP90Ms,
      updatedAt: episodes[0]?.endedAt
    };
  }

  private appendText(filePath: string, text: string) {
    const run = this.appendQueue.then(async () => {
      await fs.mkdir(this.baseDir, { recursive: true });
      await fs.appendFile(filePath, text, 'utf8');
    });
    this.appendQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}
