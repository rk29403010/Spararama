import { VoiceMonkeySecretStore, type StoredVoiceMonkeyConfig } from './secret-manager';

const VOICE_MONKEY_ROOT = 'https://api-v3.voicemonkey.io';
const VOICE_MONKEY_REQUEST_TIMEOUT_MS = 10_000;

export interface VoiceMonkeySpeaker {
  id: string;
  name: string;
}

export interface VoiceMonkeyStatus {
  enabled: boolean;
  configured: boolean;
  tokenConfigured: boolean;
  device?: string;
  chimeConfigured: boolean;
  chime?: string;
  source: 'secret-manager' | 'environment' | 'none';
  secretId: string;
  storageError?: string;
}

export interface VoiceMonkeySettingsInput {
  enabled?: boolean;
  token?: string;
  device?: string;
  chime?: string;
}

type VoiceMonkeySecretStoreLike = Pick<VoiceMonkeySecretStore, 'config' | 'load' | 'save'>;

function apiError(action: string, status: number, code: string) {
  switch (code) {
    case 'INVALID_TOKEN': return new Error('Voice Monkey rejected this API key.');
    case 'USER_NOT_FOUND': return new Error('The Voice Monkey account for this API key was not found.');
    case 'DEVICE_NOT_FOUND': return new Error('The selected Alexa speaker was not found. Refresh the speaker list and choose it again.');
    case 'THROTTLED': return new Error('Voice Monkey is temporarily limiting requests. Try again shortly.');
    case 'MONTHLY_QUOTA_EXCEEDED': return new Error('The Voice Monkey monthly request allowance has been used.');
    case 'ALEXA_TRIGGER_FAILED': return new Error('Voice Monkey could not reach Alexa. Try again shortly.');
    default: return new Error(`${action} (${status}).`);
  }
}

function environmentConfig(): StoredVoiceMonkeyConfig {
  return {
    enabled: String(process.env.VOICE_MONKEY_ENABLED || '').toLowerCase() === 'true',
    token: String(process.env.VOICE_MONKEY_TOKEN || '').trim(),
    device: String(process.env.VOICE_MONKEY_DEVICE || '').trim(),
    chime: String(process.env.VOICE_MONKEY_CHIME || '').trim()
  };
}

export class VoiceMonkeyService {
  private config = environmentConfig();
  private source: VoiceMonkeyStatus['source'] = this.config.token || this.config.device ? 'environment' : 'none';
  private storageError: string | undefined;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly secretStore: VoiceMonkeySecretStoreLike = new VoiceMonkeySecretStore(),
    private readonly request: typeof fetch = fetch
  ) {}

  private ensureLoaded() {
    if (!this.loadPromise) this.loadPromise = this.loadSecretManagerConfig();
    return this.loadPromise;
  }

  private async loadSecretManagerConfig() {
    try {
      const stored = await this.secretStore.load();
      if (stored) {
        this.config = stored;
        this.source = 'secret-manager';
      }
      this.storageError = undefined;
    } catch (error: any) {
      this.storageError = error?.message || String(error);
      // Keep environment configuration as a backwards-compatible fallback.
    }
  }

  private currentStatus(): VoiceMonkeyStatus {
    return {
      enabled: this.config.enabled,
      configured: Boolean(this.config.token && this.config.device),
      tokenConfigured: Boolean(this.config.token),
      device: this.config.device || undefined,
      chimeConfigured: Boolean(this.config.chime),
      chime: this.config.chime || undefined,
      source: this.source,
      secretId: this.secretStore.config.secretId,
      storageError: this.storageError
    };
  }

  async status() {
    await this.ensureLoaded();
    return this.currentStatus();
  }

  async configure(input: VoiceMonkeySettingsInput) {
    await this.ensureLoaded();
    const next: StoredVoiceMonkeyConfig = {
      enabled: input.enabled ?? this.config.enabled ?? true,
      token: String(input.token || '').trim() || this.config.token,
      device: input.device === undefined ? this.config.device : String(input.device).trim(),
      chime: input.chime === undefined ? this.config.chime : String(input.chime).trim()
    };

    if (next.enabled && !next.token) throw new Error('Voice Monkey API key is required.');
    if (next.enabled && !next.device) throw new Error('Voice Monkey device/monkey name is required.');

    await this.secretStore.save(next);
    this.config = next;
    this.source = 'secret-manager';
    this.storageError = undefined;
    return this.currentStatus();
  }

  async listSpeakers(candidateToken?: string): Promise<VoiceMonkeySpeaker[]> {
    await this.ensureLoaded();
    const token = String(candidateToken || '').trim() || this.config.token;
    if (!token) throw new Error('Enter a Voice Monkey API key first.');

    let response: Response;
    try {
      response = await this.request(`${VOICE_MONKEY_ROOT}/devices`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(VOICE_MONKEY_REQUEST_TIMEOUT_MS)
      });
    } catch (error: any) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error('Voice Monkey took too long to list speakers. Try again.');
      }
      throw new Error('Voice Monkey speaker lookup is unavailable.');
    }

    const body = await response.json().catch(() => null) as any;
    if (!response.ok) throw apiError('Voice Monkey speaker lookup failed', response.status, String(body?.error || ''));
    if (!Array.isArray(body?.data)) throw new Error('Voice Monkey returned an invalid speaker list.');

    return body.data
      .filter((item: any) => item?.capability === 'speakers' && String(item?.id || '').trim() && String(item?.name || '').trim())
      .map((item: any) => ({ id: String(item.id).trim(), name: String(item.name).trim() }))
      .sort((left: VoiceMonkeySpeaker, right: VoiceMonkeySpeaker) => left.name.localeCompare(right.name));
  }

  async announce(speech: string) {
    await this.ensureLoaded();
    const status = this.currentStatus();
    if (!status.enabled) return { enabled: false, sent: false };
    if (!status.configured) {
      return { enabled: status.enabled, sent: false, error: status.enabled ? 'Voice Monkey API key/device not configured.' : undefined };
    }

    const body: Record<string, string> = {
      token: this.config.token,
      device: this.config.device,
      speech
    };
    if (this.config.chime) body.chime = this.config.chime;

    let response: Response;
    try {
      response = await this.request(`${VOICE_MONKEY_ROOT}/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(VOICE_MONKEY_REQUEST_TIMEOUT_MS)
      });
    } catch (error: any) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error('Voice Monkey took too long to contact Alexa. Try again.');
      }
      throw new Error('Voice Monkey announcements are unavailable.');
    }
    const responseBody = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw apiError('Voice Monkey announcement failed', response.status, String(responseBody?.error || ''));
    }
    return { enabled: true, sent: true };
  }
}
